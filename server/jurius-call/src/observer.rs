//! A ponte entre os eventos do WhatsApp e o estado do serviço.
//!
//! Toda a sinalização de chamada chega como `Event::IncomingCall` — inclusive o
//! `accept`, o `reject` e o `terminate` das chamadas que NÓS fizemos. O nome do
//! evento engana; o que separa um caso do outro é a `CallAction`.
use std::sync::Arc;

use log::info;
use wacore::types::call::CallAction;
use wacore::types::events::{Event, EventHandler, EventInterest, EventKind};

use crate::state::AppState;

pub struct CallObserver {
    state: Arc<AppState>,
}

impl CallObserver {
    pub fn new(state: Arc<AppState>) -> Self {
        Self { state }
    }
}

impl EventHandler for CallObserver {
    fn interest(&self) -> EventInterest {
        EventInterest::of(&[
            EventKind::IncomingCall,
            EventKind::MissedCall,
            EventKind::CallEndedElsewhere,
            EventKind::Connected,
            EventKind::Disconnected,
            EventKind::LoggedOut,
        ])
    }

    fn handle_event(&self, event: Arc<Event>) {
        match &*event {
            Event::IncomingCall(call) => match &call.action {
                CallAction::Offer { .. } => {
                    // Convite que chegou da fila offline é chamada morta: não há
                    // relay para conectar e atender só faria o operador falar
                    // sozinho.
                    if call.offline {
                        info!("convite offline ignorado ({})", call.action.call_id());
                        return;
                    }
                    self.state.on_offer(call.clone());
                }
                CallAction::Accept { call_id, .. } => self.state.on_peer_accept(call_id),
                CallAction::Reject {
                    call_id, reason, ..
                } => self.state.on_peer_reject(call_id, reason.clone()),
                CallAction::Terminate {
                    call_id, reason, ..
                } => self.state.on_peer_terminate(call_id, reason.clone()),
                // A MESMA sinalização de vídeo chega por dois caminhos: aqui,
                // crua, e no fluxo da chamada (`CallEvent::VideoStateChanged`),
                // que vem com o token do upgrade. Tendo mídia de pé, quem manda
                // é o outro caminho — senão cada `UpgradeRequestV2`,
                // `UpgradeReject` ou `Disabled` virava dois logs e dois
                // `video_state` iguais no CRM. Sem handle (convite ainda
                // tocando) este é o único caminho, e ele continua valendo.
                CallAction::VideoState {
                    call_id, state, ..
                } => {
                    if !self.state.has_handle(call_id) {
                        self.state.on_peer_video_state(call_id, *state);
                    }
                }
                // O `preaccept` é a PROVA de que o aparelho do contato recebeu a
                // oferta e a entendeu — ele sai do celular antes de a tela de
                // chamada aparecer. É o que separa "a oferta não chegou lá" de
                // "chegou e o aparelho decidiu não tocar", e é a única pergunta
                // que sobra na chamada de vídeo de saída, que o servidor aceita,
                // aloca relay, e mesmo assim não faz telefone nenhum tocar.
                CallAction::PreAccept { call_id, .. } => {
                    info!("preaccept de {call_id}: o aparelho do contato recebeu a oferta");
                }
                // Candidato ICE e keepalive passam às dezenas por chamada: no log
                // eles só afogariam o resto.
                CallAction::Transport { .. } => {}
                outra => info!(
                    "ação de chamada sem tratamento em {}: {outra:?}",
                    outra.call_id()
                ),
            },
            Event::MissedCall(missed) => {
                info!("chamada perdida {} de {}", missed.call_id, missed.from);
                self.state.hub.json(&serde_json::json!({
                    "type": "missed_call",
                    "callId": missed.call_id,
                    "from": missed.from.to_string(),
                    "reason": format!("{:?}", missed.reason),
                }));
                self.state.finish(&missed.call_id, "missed");
            }
            Event::CallEndedElsewhere(elsewhere) => {
                // Outro aparelho do escritório resolveu: NÃO é chamada perdida, e
                // o CRM depende dessa diferença para não inventar um aviso.
                self.state.hub.json(&serde_json::json!({
                    "type": "call_elsewhere",
                    "callId": elsewhere.call_id,
                    "outcome": format!("{:?}", elsewhere.outcome),
                }));
                self.state.finish(
                    &elsewhere.call_id,
                    format!("{:?}_elsewhere", elsewhere.outcome).to_lowercase(),
                );
            }
            Event::Connected(_) | Event::Disconnected(_) | Event::LoggedOut(_) => {
                self.state.emit_status();
            }
            _ => {}
        }
    }
}
