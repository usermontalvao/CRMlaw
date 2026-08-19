//! As pontas de mídia: onde o navegador entra e sai do motor do whatsapp-rust.
//!
//! A biblioteca fala PCM 16 kHz mono em quadros de 960 amostras (60 ms) e vídeo
//! H.264 Annex-B em unidades de acesso completas. Nada aqui captura microfone
//! nem codifica pixel: quem faz isso é o navegador, e este módulo só liga os
//! canais dele aos canais dela. É a diferença central para o WaCalls, que
//! terminava num microfone do servidor Linux.
use std::sync::Arc;

use async_channel::{Receiver, Sender};
use log::debug;
use wacore::voip::rtp::VIDEO_CLOCK_RATE;
use whatsapp_rust::voip::{VideoFrame, VideoSource};

use crate::hub::{Hub, FLAG_KEYFRAME, KIND_AUDIO, KIND_VIDEO};
use crate::state::AppState;

/// 60 ms a 16 kHz. O motor DESCARTA qualquer quadro de outro tamanho (nenhum
/// RTP sai), então o navegador tem de entregar exatamente isto.
pub const FRAME_SAMPLES: usize = 960;

/// Fonte de vídeo alimentada pelo navegador. Igual ao canal cru que a
/// biblioteca já aceita, mas com a cadência declarada: o passo de RTP precisa
/// bater com o fps real do encoder, senão o outro lado vê o vídeo correndo ou
/// arrastando.
pub struct BrowserVideoSource {
    rx: Receiver<Vec<u8>>,
    stride: u32,
}

impl BrowserVideoSource {
    pub fn new(rx: Receiver<Vec<u8>>, fps: u32) -> Self {
        let fps = fps.clamp(1, 60);
        Self {
            rx,
            stride: VIDEO_CLOCK_RATE / fps,
        }
    }
}

impl VideoSource for BrowserVideoSource {
    fn frames(&self) -> Receiver<Vec<u8>> {
        self.rx.clone()
    }

    fn rtp_timestamp_stride(&self) -> u32 {
        self.stride
    }
}

/// Os canais de uma chamada, criados juntos porque é assim que eles nascem: o
/// lado que a biblioteca consome e o lado que nós seguramos.
pub struct AudioPipes {
    /// Navegador → motor (nós mandamos).
    pub mic_tx: Sender<Vec<i16>>,
    /// O que entregamos à biblioteca como `AudioSource`.
    pub mic_rx: Receiver<Vec<i16>>,
    /// O que entregamos à biblioteca como `AudioSink`.
    pub speaker_tx: Sender<Vec<i16>>,
    /// Motor → navegador (nós lemos).
    pub speaker_rx: Receiver<Vec<i16>>,
}

pub fn audio_pipes() -> AudioPipes {
    // Fila curta dos dois lados: em voz, um quadro atrasado vale menos que um
    // quadro perdido.
    let (mic_tx, mic_rx) = async_channel::bounded::<Vec<i16>>(8);
    let (speaker_tx, speaker_rx) = async_channel::bounded::<Vec<i16>>(8);
    AudioPipes {
        mic_tx,
        mic_rx,
        speaker_tx,
        speaker_rx,
    }
}

/// Encaminha a voz do outro lado para os navegadores acoplados à chamada.
/// Termina sozinha quando o canal fecha (a chamada acabou).
pub fn spawn_audio_playout(
    state: Arc<AppState>,
    hub: Hub,
    call_id: String,
    rx: Receiver<Vec<i16>>,
) {
    tokio::spawn(async move {
        let mut bytes = Vec::with_capacity(FRAME_SAMPLES * 2);
        while let Ok(frame) = rx.recv().await {
            // O quadro vai INTEIRO para quem decide o que ele significa: um
            // quadro de áudio não prova atendimento, um quadro com VOZ prova.
            // O pico é o que separa os dois, e calculá-lo aqui evita copiar o
            // quadro para o outro lado do `Mutex`. Ver `on_peer_media`.
            let pico = frame
                .iter()
                .map(|s| (*s as i32).abs())
                .max()
                .unwrap_or(0);
            state.on_peer_media(&call_id, pico);
            bytes.clear();
            for sample in &frame {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            hub.media(&call_id, KIND_AUDIO, 0, 0, &bytes);
        }
        debug!("playout de audio encerrado ({call_id})");
    });
}

/// Encaminha o vídeo do outro lado. O sinalizador de keyframe viaja junto
/// porque o decoder do navegador precisa dele para saber onde pode começar.
pub fn spawn_video_playout(hub: Hub, call_id: String, rx: Receiver<VideoFrame>) {
    tokio::spawn(async move {
        // O primeiro quadro do outro lado é a prova de que a perna DELE subiu.
        // Uma linha, uma vez: com ela, "tela preta" deixa de ser ambíguo.
        let mut primeiro = true;
        while let Ok(frame) = rx.recv().await {
            if primeiro {
                primeiro = false;
                log::info!(
                    "primeiro quadro de vídeo do outro lado em {call_id} ({} bytes, keyframe={})",
                    frame.data.len(),
                    frame.keyframe
                );
            }
            let flags = if frame.keyframe { FLAG_KEYFRAME } else { 0 };
            hub.media(&call_id, KIND_VIDEO, flags, frame.orientation, &frame.data);
        }
        debug!("playout de video encerrado ({call_id})");
    });
}

/// Converte o quadro binário do navegador em PCM. Devolve `None` quando o
/// tamanho não é o que o motor aceita — melhor recusar aqui, onde dá para
/// registrar, do que deixar o motor descartar em silêncio.
pub fn pcm_from_bytes(body: &[u8]) -> Option<Vec<i16>> {
    if body.len() != FRAME_SAMPLES * 2 {
        return None;
    }
    let mut frame = Vec::with_capacity(FRAME_SAMPLES);
    for chunk in body.chunks_exact(2) {
        frame.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }
    Some(frame)
}
