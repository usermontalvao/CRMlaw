//! O barramento que leva evento e mídia do motor até os navegadores conectados.
//!
//! Um único `broadcast` carrega as duas coisas, e cada WebSocket filtra pelo
//! `call_id`: sinalização (`call_id: None`) vai para todo mundo, mídia vai só
//! para quem está acoplado àquela chamada. O `call_id` viaja no Rust, nunca nos
//! bytes — o quadro binário fica com o cabeçalho mínimo de 4 bytes e o áudio
//! continua alinhado para virar `Int16Array` no navegador sem cópia.
use std::sync::Arc;

use tokio::sync::broadcast;

/// Áudio PCM 16 kHz mono, Int16 little-endian.
pub const KIND_AUDIO: u8 = 1;
/// Unidade de acesso H.264 Annex-B completa (com start codes).
pub const KIND_VIDEO: u8 = 2;

/// Cabeçalho de todo quadro binário: `[kind, flags, orientation, reservado]`.
/// Quatro bytes de propósito: o áudio começa num deslocamento par, que é o que
/// `new Int16Array(buffer, 4)` exige do lado do navegador.
pub const MEDIA_HEADER: usize = 4;

/// Bit 0 de `flags`: a unidade de vídeo é um keyframe (IDR/SPS/PPS).
pub const FLAG_KEYFRAME: u8 = 1;

#[derive(Clone)]
pub enum Payload {
    /// Sinalização/controle, já serializado.
    Json(Arc<String>),
    /// Mídia crua, com o cabeçalho já montado.
    Binary(Arc<Vec<u8>>),
}

#[derive(Clone)]
pub struct Frame {
    /// `None` = interessa a todos os navegadores; `Some(id)` = só a quem está
    /// acoplado a essa chamada.
    pub call_id: Option<String>,
    pub payload: Payload,
}

#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<Frame>,
}

impl Hub {
    pub fn new() -> Self {
        // Fôlego para ~5 segundos de mídia de uma chamada (áudio a 16,7 q/s,
        // vídeo a 15-20 q/s). Um assinante que atrase mais que isso perde
        // quadros — que é o comportamento certo para voz: chegar tarde é pior
        // do que não chegar.
        let (tx, _) = broadcast::channel(512);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Frame> {
        self.tx.subscribe()
    }

    /// Publica um evento de sinalização para todos os navegadores.
    pub fn json(&self, value: &serde_json::Value) {
        let text = value.to_string();
        let _ = self.tx.send(Frame {
            call_id: None,
            payload: Payload::Json(Arc::new(text)),
        });
    }

    /// Publica mídia de uma chamada. Só quem está acoplado a ela recebe.
    pub fn media(&self, call_id: &str, kind: u8, flags: u8, orientation: u8, body: &[u8]) {
        let mut buffer = Vec::with_capacity(MEDIA_HEADER + body.len());
        buffer.push(kind);
        buffer.push(flags);
        buffer.push(orientation);
        buffer.push(0);
        buffer.extend_from_slice(body);
        let _ = self.tx.send(Frame {
            call_id: Some(call_id.to_string()),
            payload: Payload::Binary(Arc::new(buffer)),
        });
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}
