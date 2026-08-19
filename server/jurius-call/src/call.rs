//! A linha de uma chamada: o que o servidor sabe dela e o que o navegador lê.
//!
//! Uma chamada é identificada pelo `call_id` do WhatsApp — nunca por "a chamada
//! atual". O escritório pode ter várias tocando ao mesmo tempo, e o dono
//! (`owner`, o `X-Client-Id` da aba) é o que decide de quem é o áudio.
use std::sync::Arc;

use async_channel::{Receiver, Sender};
use serde::Serialize;
use wacore::types::call::IncomingCall;
use whatsapp_rust::prelude::{Jid, Server};
use whatsapp_rust::voip::{CallHandle, VideoUpgradeToken};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Inbound,
    Outbound,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inbound => "inbound",
            Self::Outbound => "outbound",
        }
    }
}

/// O que o servidor consegue afirmar sobre a chamada.
///
/// `Ringing` é o convite (tocando de um lado ou do outro), `Connecting` é do
/// aceite até o relay responder, `Active` é mídia viva. A UI tem estados a mais
/// — eles são dela, não daqui.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CallStatus {
    Ringing,
    Connecting,
    Active,
    Ended,
}

impl CallStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ringing => "ringing",
            Self::Connecting => "connecting",
            Self::Active => "active",
            Self::Ended => "ended",
        }
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Uma chamada viva (ou recém-encerrada) e tudo que ela precisa para continuar.
pub struct CallEntry {
    pub call_id: String,
    pub direction: Direction,
    pub status: CallStatus,
    /// JID do outro lado, como o WhatsApp o endereçou.
    pub peer: String,
    /// Telefone em dígitos, quando existe. Vem do `caller_pn` do convite ou do
    /// número que discamos — jamais de um `@lid`, que não é telefone.
    pub phone: Option<String>,
    /// O apelido interno (`<n>@lid`) desta chamada, quando ela chegou por ele.
    pub lid: Option<String>,
    /// A aba dona do áudio (`X-Client-Id`). `None` enquanto ninguém reivindicou.
    pub owner: Option<String>,
    /// O convite foi de vídeo desde o início.
    pub is_video: bool,
    /// Nossa câmera está subindo agora.
    pub video_active: bool,
    /// O outro lado está mandando vídeo.
    pub peer_video: bool,
    pub muted: bool,
    /// O relay já respondeu e a mídia tem por onde passar.
    ///
    /// NÃO é atendimento. Numa chamada de SAÍDA o relay sobe menos de um
    /// segundo depois de discar, com o telefone do contato ainda tocando —
    /// enquanto isto virava `Active`, o CRM cronometrava e registrava como
    /// atendida uma conversa que não aconteceu. Fica guardado porque o aceite
    /// pode chegar DEPOIS: é ele que, junto com este sinal, faz a chamada
    /// virar `Active`.
    pub relay_ready: bool,
    /// Quando chegou o PRIMEIRO quadro de áudio do outro lado, e qual era o
    /// pico dele. Diagnóstico: numa chamada que o contato nunca atendeu isso
    /// aparece a um segundo da discagem, e é o que separa voz de gente de
    /// ruído de relay. Ver `AppState::on_peer_media`.
    pub first_audio_at: Option<i64>,
    /// Já registramos no log a chegada do primeiro áudio? Uma vez por chamada.
    pub first_audio_logged: bool,
    /// Quando chegou o ÚLTIMO quadro do outro lado. É o pulso da chamada: se ele
    /// para depois de atendida, a conversa acabou — mesmo sem `<terminate>`.
    pub last_media_at: Option<i64>,
    pub started_at: i64,
    pub accepted_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub end_reason: Option<String>,

    /// O convite guardado, para o `accept` acontecer quando o operador clicar —
    /// e não automaticamente, como fazia o `listen` do voip-cli.
    pub incoming: Option<Box<IncomingCall>>,
    /// O controle da chamada, depois que a mídia subiu.
    pub handle: Option<Arc<CallHandle>>,
    /// Microfone do navegador → motor.
    pub audio_in: Option<Sender<Vec<i16>>>,
    /// A MESMA fila, do lado de quem lê. Existe para descartar o quadro mais
    /// VELHO quando a fila enche: manter o velho e jogar fora o novo (que é o
    /// que `try_send` faz sozinho) fixaria meio segundo de atraso na voz para o
    /// resto da chamada.
    pub audio_drain: Option<Receiver<Vec<i16>>>,
    /// Câmera do navegador → motor. Só existe com o plano de vídeo de pé.
    pub video_in: Option<Sender<Vec<u8>>>,
    /// O pedido de vídeo do outro lado que ainda espera resposta.
    pub pending_video: Option<VideoUpgradeToken>,
    /// Já registramos a primeira unidade de vídeo vinda do navegador? A marca
    /// existe para o log dizer UMA vez que a câmera daqui começou a subir —
    /// "tela preta" sem isso não distingue quem parou de mandar.
    pub video_out_logged: bool,
}

impl CallEntry {
    pub fn new(call_id: String, direction: Direction, peer: String) -> Self {
        Self {
            call_id,
            direction,
            status: CallStatus::Ringing,
            peer,
            phone: None,
            lid: None,
            owner: None,
            is_video: false,
            video_active: false,
            peer_video: false,
            muted: false,
            relay_ready: false,
            first_audio_at: None,
            first_audio_logged: false,
            last_media_at: None,
            started_at: now_ms(),
            accepted_at: None,
            ended_at: None,
            end_reason: None,
            incoming: None,
            handle: None,
            audio_in: None,
            audio_drain: None,
            video_in: None,
            pending_video: None,
            video_out_logged: false,
        }
    }

    /// A chamada como o navegador a lê. Uma forma só, usada tanto na listagem
    /// HTTP quanto nos eventos do WebSocket — duas formas divergiriam em
    /// silêncio.
    pub fn row(&self) -> serde_json::Value {
        serde_json::json!({
            "callId": self.call_id,
            "sessionId": "default",
            "direction": self.direction.as_str(),
            "status": self.status.as_str(),
            "peer": self.peer,
            "phone": self.phone,
            "lid": self.lid,
            "owner": self.owner,
            "isVideo": self.is_video,
            "videoActive": self.video_active,
            "peerVideo": self.peer_video,
            "muted": self.muted,
            "startedAt": self.started_at,
            "acceptedAt": self.accepted_at,
            "endedAt": self.ended_at,
            "endReason": self.end_reason,
        })
    }

    /// Solta a mídia sem tocar na sinalização: fechar os canais faz as tarefas
    /// de encaminhamento terminarem sozinhas.
    pub fn release_media(&mut self) {
        self.audio_in = None;
        self.audio_drain = None;
        self.video_in = None;
        self.video_active = false;
        self.pending_video = None;
        self.video_out_logged = false;
    }
}

/// Extrai os dígitos de um JID de telefone. Um `@lid` NÃO é telefone e por isso
/// não sai daqui como número: devolver o apelido interno como se fosse um
/// número é o caminho curto para discar para o nada.
pub fn phone_from_jid(jid: &Jid) -> Option<String> {
    if jid.server != Server::Pn && jid.server != Server::Hosted {
        return None;
    }
    let digits: String = jid.user.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}
