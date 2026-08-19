//! Jurius Call — voz e vídeo do WhatsApp para dentro do navegador do escritório.
//!
//! O que este serviço faz e o antigo WaCalls não fazia: o áudio e o vídeo do
//! operador viajam pelo MESMO WebSocket HTTPS que o Cloudflare já publica. Não
//! há ICE, STUN, TURN nem WebRTC entre o navegador e o Docker — era exatamente
//! aí que a ligação ficava muda quando o container anunciava o IP da rede
//! interna. Do servidor para a Meta, quem cuida do transporte é o whatsapp-rust.
//!
//!   navegador ──WSS──► Jurius Call ──► whatsapp-rust VoIP ──► relays da Meta
//!
//! A sessão pareada continua onde sempre esteve (`/data/whatsapp.db`); este
//! processo apenas a abre. Só UM processo pode manter a sessão de pé — subir
//! este serviço junto com o voip-cli faz os dois brigarem pelo socket.
mod api;
mod call;
mod hub;
mod media;
mod observer;
mod state;
mod trace;
mod ws;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use log::{info, warn};
use whatsapp_rust::prelude::*;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(
        // O encerramento normal de uma chamada faz o DTLS registrar um "Close
        // Notify" que parece erro e não é; calar essas duas caixas mantém o log
        // legível sem esconder problema de verdade.
        env_logger::Env::default().default_filter_or("info,webrtc_sctp=error,webrtc_dtls=error"),
    )
    .init();

    let banco = std::env::var("JURIUS_CALL_DB").unwrap_or_else(|_| "/data/whatsapp.db".into());
    let porta = std::env::var("JURIUS_CALL_BIND").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let token = std::env::var("JURIUS_CALL_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    info!("Jurius Call iniciando — sessão em {banco}");
    if token.is_none() {
        warn!("JURIUS_CALL_TOKEN não definido: a API está aberta.");
    }

    let store = SqliteStore::new(&banco)
        .await
        .map_err(|e| anyhow!("abrindo {banco}: {e}"))?;

    let bot = Bot::builder()
        .with_backend(store)
        .on_qr_code(|code, timeout| async move {
            // Se um QR aparecer, a sessão de /data sumiu — vale gritar no log,
            // porque significa que o pareamento se perdeu.
            warn!(
                "PAREAMENTO PERDIDO: leia este QR em {}s\n{code}",
                timeout.as_secs()
            );
        })
        .on_connected(|_client| async {
            info!("conectado ao WhatsApp");
        })
        .build()
        .await
        .map_err(|e| anyhow!("iniciando o cliente: {e}"))?;

    let client = bot.client();
    let state = Arc::new(state::AppState::new(client.clone(), token));
    let observer = Arc::new(observer::CallObserver::new(state.clone()));
    // A inscrição precisa continuar viva enquanto o processo roda; largá-la
    // cancelaria a escuta de chamadas.
    let _inscricao = client.subscribe_handler(observer);
    // A stanza de chamada que SAI daqui, no log. A lease é o que abre a
    // torneira na biblioteca (sem ela o `Event::SentFrame` não é emitido e nada
    // é clonado); as duas precisam continuar vivas enquanto o processo roda.
    // Ver `trace.rs` para o que é filtrado e o que é mascarado.
    let _torneira = client.acquire_sent_frame_forwarding();
    let _rastro = client.subscribe_handler(Arc::new(trace::SentCallTrace));

    let listener = tokio::net::TcpListener::bind(&porta)
        .await
        .map_err(|e| anyhow!("porta {porta}: {e}"))?;
    info!("HTTP e WebSocket ouvindo em {porta}");
    let app = api::router(state.clone());

    let manutencao = {
        let state = state.clone();
        async move {
            // Cinco segundos por causa do vigia de mídia: uma chamada que já
            // acabou não pode ficar um minuto de pé no cartão do operador. A
            // limpeza e o status continuam de minuto em minuto — eles não têm
            // pressa e custam mais.
            let mut tick = tokio::time::interval(Duration::from_secs(5));
            let mut voltas: u32 = 0;
            loop {
                tick.tick().await;
                state.sweep_dead_media();
                voltas += 1;
                if voltas % 12 == 0 {
                    state.prune();
                    state.emit_status();
                }
            }
        }
    };

    tokio::select! {
        _ = bot.run() => warn!("o cliente do WhatsApp terminou"),
        resultado = axum::serve(listener, app) => {
            if let Err(e) = resultado { warn!("servidor HTTP caiu: {e}") }
        }
        _ = manutencao => {}
        _ = shutdown_signal() => info!("encerrando"),
    }
    Ok(())
}
