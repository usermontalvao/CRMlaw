//! O WebSocket: sinalização em JSON, mídia em quadros binários.
//!
//! Um socket por aba. Ele recebe TODA a sinalização (para a tela saber que o
//! telefone tocou mesmo sem chamada acoplada) e só a mídia da chamada em que se
//! acoplou — mandar áudio de uma ligação para quem não a atende seria vazamento
//! de conversa, além de banda jogada fora.
//!
//! Áudio e vídeo NUNCA viram JSON/base64: um quadro de 60 ms em base64 custaria
//! 33% a mais e uma volta de parser a cada 60 ms.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use log::{debug, warn};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::broadcast::error::RecvError;

use crate::hub::{Payload, KIND_AUDIO, KIND_VIDEO, MEDIA_HEADER};
use crate::media::pcm_from_bytes;
use crate::state::AppState;

/// Carência entre o último navegador soltar a chamada e ela ser encerrada.
///
/// Recarregar a página fecha o socket e abre outro em menos de um segundo; se a
/// chamada morresse no `onclose`, um F5 no meio da ligação derrubaria o cliente.
/// Dez segundos separa "recarreguei" de "fechei a aba e fui embora" — e sem
/// nenhum navegador acoplado a chamada está muda de qualquer forma.
const CARENCIA_SEM_NAVEGADOR: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    #[serde(rename = "clientId")]
    pub client_id: Option<String>,
}

pub async fn upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(query): Query<WsQuery>,
) -> Response {
    if let Some(esperado) = &state.token {
        if query.token.as_deref() != Some(esperado.as_str()) {
            return axum::response::IntoResponse::into_response((
                axum::http::StatusCode::UNAUTHORIZED,
                "token inválido",
            ));
        }
    }
    ws.on_upgrade(move |socket| run(socket, state, query.client_id))
}

/// Solta a chamada e, se ninguém mais a escuta, agenda o encerramento.
fn soltar_chamada(state: &Arc<AppState>, call_id: String) {
    if state.detach(&call_id) > 0 {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(CARENCIA_SEM_NAVEGADOR).await;
        if state.attached_count(&call_id) > 0 || !state.is_live(&call_id) {
            return;
        }
        warn!("nenhum navegador ouvindo {call_id} — encerrando");
        let _ = state.hangup_call(&call_id).await;
    });
}

async fn run(mut socket: WebSocket, state: Arc<AppState>, client_id: Option<String>) {
    let mut eventos = state.hub.subscribe();
    let acoplado: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // O primeiro quadro entrega o retrato inteiro: quem recarregou a página no
    // meio de uma ligação volta enxergando a chamada, não uma tela vazia.
    let boas_vindas = json!({
        "type": "hello",
        "clientId": client_id,
        "status": state.status(),
        "calls": state.rows(),
    });
    if socket
        .send(Message::Text(boas_vindas.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            entrada = socket.recv() => {
                let Some(Ok(mensagem)) = entrada else { break };
                match mensagem {
                    Message::Text(texto) => {
                        if let Some(resposta) = comando(&state, &acoplado, texto.as_str()) {
                            if socket.send(Message::Text(resposta.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Message::Binary(bytes) => {
                        midia(&state, &acoplado, bytes.as_ref());
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            evento = eventos.recv() => {
                match evento {
                    Ok(frame) => {
                        // Mídia só para quem está acoplado àquela chamada.
                        if let Some(alvo) = &frame.call_id {
                            let meu = acoplado.lock().ok().and_then(|g| g.clone());
                            if meu.as_deref() != Some(alvo.as_str()) {
                                continue;
                            }
                        }
                        let envio = match &frame.payload {
                            Payload::Json(texto) => {
                                socket.send(Message::Text(texto.as_str().to_string().into())).await
                            }
                            Payload::Binary(bytes) => {
                                socket.send(Message::Binary(bytes.as_slice().to_vec().into())).await
                            }
                        };
                        if envio.is_err() { break; }
                    }
                    // Atraso do assinante: perdeu quadros e segue. Em voz, quadro
                    // velho não serve para nada.
                    Err(RecvError::Lagged(perdidos)) => {
                        debug!("socket atrasado, {perdidos} quadros descartados");
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        }
    }
    // A aba foi embora. Se ela era a última ouvindo a chamada, a carência
    // decide entre "recarregou" e "fechou".
    let pendente = acoplado.lock().ok().and_then(|mut guard| guard.take());
    if let Some(call_id) = pendente {
        soltar_chamada(&state, call_id);
    }
    debug!("socket encerrado");
}

/// Interpreta um comando de controle. Devolve a resposta, quando há uma.
fn comando(
    state: &Arc<AppState>,
    acoplado: &Arc<Mutex<Option<String>>>,
    texto: &str,
) -> Option<serde_json::Value> {
    let valor: serde_json::Value = serde_json::from_str(texto).ok()?;
    match valor.get("type").and_then(|v| v.as_str())? {
        "attach" => {
            let call_id = valor.get("callId").and_then(|v| v.as_str())?.to_string();
            if !state.exists(&call_id) {
                return Some(json!({
                    "type": "error",
                    "callId": call_id,
                    "message": "Chamada não encontrada.",
                }));
            }
            let anterior = acoplado
                .lock()
                .ok()
                .and_then(|mut guard| guard.replace(call_id.clone()));
            state.attach(&call_id);
            if let Some(anterior) = anterior {
                if anterior != call_id {
                    soltar_chamada(state, anterior);
                }
            }
            Some(json!({ "type": "attached", "callId": call_id }))
        }
        "detach" => {
            let anterior = acoplado.lock().ok().and_then(|mut guard| guard.take());
            if let Some(anterior) = anterior {
                soltar_chamada(state, anterior);
            }
            Some(json!({ "type": "detached" }))
        }
        "ping" => Some(json!({ "type": "pong", "at": crate::call::now_ms() })),
        outro => {
            warn!("comando desconhecido no socket: {outro}");
            None
        }
    }
}

/// Encaminha um quadro de mídia do navegador para o motor.
fn midia(state: &Arc<AppState>, acoplado: &Arc<Mutex<Option<String>>>, quadro: &[u8]) {
    if quadro.len() <= MEDIA_HEADER {
        return;
    }
    let Some(call_id) = acoplado.lock().ok().and_then(|g| g.clone()) else {
        return;
    };
    let corpo = &quadro[MEDIA_HEADER..];
    match quadro[0] {
        KIND_AUDIO => match pcm_from_bytes(corpo) {
            Some(pcm) => state.push_mic(&call_id, pcm),
            None => debug!("quadro de áudio com {} bytes descartado", corpo.len()),
        },
        KIND_VIDEO => state.push_video(&call_id, corpo.to_vec()),
        outro => debug!("quadro binário de tipo {outro} ignorado"),
    }
}
