//! O estado do serviço e todas as operações de chamada.
//!
//! Uma regra vale para o arquivo inteiro: o `Mutex` NUNCA atravessa um `await`.
//! Tudo que uma operação assíncrona precisa é copiado para fora do cadeado
//! antes de a espera começar; o resultado volta com um segundo cadeado curto.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use log::{debug, info, warn};
use serde_json::json;
use wacore::types::call::{CallAction, IncomingCall};
use wacore::voip::CallEvent;
use whatsapp_rust::prelude::{Client, Jid, Server};
#[cfg(feature = "opus-fallback")]
use log::error;
#[cfg(feature = "opus-fallback")]
use whatsapp_rust::voip::audio::WaOpusDecoder;
use whatsapp_rust::voip::{CallHandle, VideoFrame, VideoState};

use crate::call::{now_ms, phone_from_jid, CallEntry, CallStatus, Direction};
use crate::hub::Hub;
use crate::media::{audio_pipes, spawn_audio_playout, spawn_video_playout, BrowserVideoSource};

/// Cadência padrão da câmera. 15 fps é a cadência de compatibilidade que o
/// WhatsApp mantém no modo de baixa banda; o navegador pode pedir outra.
pub const DEFAULT_VIDEO_FPS: u32 = 15;

/// Pico de amostra (16 bits) a partir do qual um quadro conta como VOZ.
///
/// Cerca de -40 dBFS. Abaixo disso está o silêncio digital e o ruído de
/// conforto que o relay manda antes de existir alguém do outro lado; acima
/// está uma sala com gente, ainda que quieta. Ver `on_peer_media`.
const PICO_DE_VOZ: i32 = 300;

/// Falha de uma operação, já com o status HTTP que o navegador deve ler.
pub struct OpError {
    pub status: u16,
    pub message: String,
}

impl OpError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

pub type OpResult<T> = Result<T, OpError>;

pub struct AppState {
    pub client: Arc<Client>,
    pub hub: Hub,
    /// Token opcional (`JURIUS_CALL_TOKEN`). Ausente = API aberta, como era o
    /// WaCalls.
    pub token: Option<String>,
    pub started_at: i64,
    calls: Mutex<HashMap<String, CallEntry>>,
    /// Quantos navegadores estão acoplados a cada chamada. Sem navegador não há
    /// microfone: uma chamada acoplada a ninguém está muda, e deixá-la de pé
    /// prende a linha do escritório até o outro lado desistir.
    attached: Mutex<HashMap<String, usize>>,
}

impl AppState {
    pub fn new(client: Arc<Client>, token: Option<String>) -> Self {
        Self {
            client,
            hub: Hub::new(),
            token,
            started_at: now_ms(),
            calls: Mutex::new(HashMap::new()),
            attached: Mutex::new(HashMap::new()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, CallEntry>> {
        self.calls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_attached(&self) -> std::sync::MutexGuard<'_, HashMap<String, usize>> {
        self.attached
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Um navegador passou a ouvir esta chamada.
    pub fn attach(&self, call_id: &str) {
        let mut mapa = self.lock_attached();
        *mapa.entry(call_id.to_string()).or_insert(0) += 1;
    }

    /// Um navegador soltou a chamada. Devolve quantos ainda a escutam.
    pub fn detach(&self, call_id: &str) -> usize {
        let mut mapa = self.lock_attached();
        let restantes = match mapa.get_mut(call_id) {
            Some(n) => {
                *n = n.saturating_sub(1);
                *n
            }
            None => 0,
        };
        if restantes == 0 {
            mapa.remove(call_id);
        }
        restantes
    }

    pub fn attached_count(&self, call_id: &str) -> usize {
        self.lock_attached().get(call_id).copied().unwrap_or(0)
    }

    /// A chamada ainda está viva?
    pub fn is_live(&self, call_id: &str) -> bool {
        self.lock()
            .get(call_id)
            .is_some_and(|c| c.status != CallStatus::Ended)
    }

    // ---------------------------------------------------------------- leitura

    /// A conta e o serviço, como o painel os mostra.
    pub fn status(&self) -> serde_json::Value {
        let calls = self.lock();
        let ativas = calls
            .values()
            .filter(|c| c.status != CallStatus::Ended)
            .count();
        json!({
            "backend": "whatsapp-rust",
            "service": "jurius-call",
            "version": env!("CARGO_PKG_VERSION"),
            "connected": self.client.is_connected(),
            "jid": self.client.pn().map(|j| j.to_string()),
            "lid": self.client.lid().map(|j| j.to_string()),
            "pushName": self.client.push_name(),
            "phone": self.client.pn().as_ref().and_then(phone_from_jid),
            "activeCalls": ativas,
            "startedAt": self.started_at,
            "now": now_ms(),
        })
    }

    /// Todas as chamadas conhecidas, da mais antiga para a mais nova.
    pub fn rows(&self) -> Vec<serde_json::Value> {
        let calls = self.lock();
        let mut entries: Vec<&CallEntry> = calls.values().collect();
        entries.sort_by_key(|c| c.started_at);
        entries.iter().map(|c| c.row()).collect()
    }

    pub fn row(&self, call_id: &str) -> Option<serde_json::Value> {
        self.lock().get(call_id).map(|c| c.row())
    }

    // ---------------------------------------------------------------- eventos

    fn emit(&self, kind: &str, call_id: &str) {
        let row = self.lock().get(call_id).map(|c| c.row());
        if let Some(row) = row {
            self.hub.json(&json!({ "type": kind, "call": row }));
        }
    }

    pub fn emit_status(&self) {
        let status = self.status();
        self.hub.json(&json!({ "type": "status", "status": status }));
    }

    fn emit_error(&self, call_id: &str, message: &str) {
        self.hub.json(&json!({
            "type": "error",
            "callId": call_id,
            "message": message,
        }));
    }

    // ------------------------------------------------- sinalização recebida

    /// Chegou um convite. Ele NÃO é atendido nem recusado aqui: fica guardado
    /// tocando até alguém decidir na tela — era exatamente isso que o `listen`
    /// com recusa automática impedia.
    pub fn on_offer(&self, incoming: IncomingCall) {
        let (call_id, is_video, caller_pn) = match &incoming.action {
            CallAction::Offer {
                call_id,
                is_video,
                caller_pn,
                ..
            } => (call_id.clone(), *is_video, caller_pn.clone()),
            _ => return,
        };
        if call_id.is_empty() {
            return;
        }
        let from = incoming.from.clone();
        let mut entry = CallEntry::new(call_id.clone(), Direction::Inbound, from.to_string());
        entry.is_video = is_video;
        // O telefone de verdade sai do `caller_pn` do convite; o `from` pode ser
        // um `@lid`, que é apelido interno e nunca deve virar número na tela.
        entry.phone = caller_pn
            .as_ref()
            .and_then(phone_from_jid)
            .or_else(|| phone_from_jid(&from));
        entry.lid = if from.server == Server::Lid {
            Some(from.to_string())
        } else {
            None
        };
        // Um convite de VÍDEO já chega com a câmera do outro lado ligada — é o
        // que `is_video` significa. Sem espelhar isso aqui, `peer_video` só
        // ficaria verdadeiro num upgrade no meio da chamada, e o primeiro
        // `call_update` do servidor apagava o vídeo do cartão: o convite
        // aparecia no CRM como chamada de voz.
        entry.peer_video = is_video;
        entry.incoming = Some(Box::new(incoming));
        self.lock().insert(call_id.clone(), entry);
        info!("convite recebido {call_id} (video={is_video})");
        self.emit("incoming_call", &call_id);
    }

    /// O outro lado atendeu a NOSSA chamada.
    ///
    /// ESTE é o atendimento de uma chamada de saída — não a subida do relay.
    /// Com a mídia já pronta (o caso normal, porque o relay sobe antes de o
    /// telefone do contato tocar), a chamada vai direto a `Active`.
    pub fn on_peer_accept(&self, call_id: &str) {
        {
            let mut calls = self.lock();
            let Some(entry) = calls.get_mut(call_id) else {
                return;
            };
            if entry.status == CallStatus::Ended {
                return;
            }
            entry.status = if entry.relay_ready {
                CallStatus::Active
            } else {
                CallStatus::Connecting
            };
            entry.accepted_at = Some(now_ms());
        }
        info!("chamada {call_id} atendida do outro lado");
        self.emit("call_accepted", call_id);
    }

    /// Chegou áudio do outro lado. Chamada A CADA QUADRO — quem decide o que
    /// aquilo significa é esta função, não o playout.
    ///
    /// Rede de segurança do atendimento, para o `accept` que se perde: o
    /// WhatsApp não manda VOZ de quem ainda não atendeu. Mas manda quadro: o
    /// teste de 19/08/2026 registrou "áudio do outro lado" um segundo depois de
    /// discar, em chamadas de vídeo que o telefone do contato nunca chegou a
    /// tocar — e uma delas chegou ANTES do próprio relay subir. Quadro de áudio
    /// não é atendimento; VOZ é. Daí as duas travas:
    ///
    ///   · o relay tem de estar de pé (antes dele não há de onde vir voz);
    ///   · o quadro tem de ter sinal — ruído de conforto e keepalive do relay
    ///     decodificam em silêncio digital, e silêncio não prova que alguém
    ///     está do outro lado.
    ///
    /// O primeiro quadro é registrado no log com o tempo desde a discagem e o
    /// pico, sempre. É esse par que diz, na próxima ligação, se o que chega
    /// antes do atendimento é silêncio (e a trava basta) ou o tom de chamada
    /// (e aí a trava precisa de outro critério).
    pub fn on_peer_media(&self, call_id: &str, pico: i32) {
        let mut primeiro: Option<(i64, bool)> = None;
        let mut atendeu: Option<i64> = None;
        {
            let mut calls = self.lock();
            let Some(entry) = calls.get_mut(call_id) else {
                return;
            };
            if entry.status == CallStatus::Ended {
                return;
            }
            let agora = now_ms();
            let apos = agora - entry.started_at;
            entry.last_media_at = Some(agora);
            if entry.first_audio_at.is_none() {
                entry.first_audio_at = Some(agora);
            }
            if !entry.first_audio_logged {
                entry.first_audio_logged = true;
                primeiro = Some((apos, entry.relay_ready));
            }
            if entry.accepted_at.is_none() && entry.relay_ready && pico >= PICO_DE_VOZ {
                entry.accepted_at = Some(agora);
                entry.status = CallStatus::Active;
                atendeu = Some(apos);
            }
        }
        if let Some((apos_ms, relay)) = primeiro {
            info!(
                "primeiro áudio do outro lado em {call_id}: {apos_ms} ms após discar, pico={pico}, relay={relay}"
            );
        }
        if let Some(apos_ms) = atendeu {
            info!(
                "voz do outro lado em {call_id}: a chamada foi atendida ({apos_ms} ms após discar, pico={pico})"
            );
            self.emit("call_active", call_id);
        }
    }

    /// O outro lado recusou.
    pub fn on_peer_reject(&self, call_id: &str, reason: Option<String>) {
        let motivo = reason.unwrap_or_else(|| "rejected".into());
        // `busy` NÃO é o contato recusando: é aquele aparelho não podendo
        // atender (já em outra chamada, ou um companion que não faz voz). Os
        // outros aparelhos dele continuam tocando.
        info!("recusa em {call_id}: {motivo}");
        self.finish(call_id, motivo);
    }

    /// O outro lado encerrou (ou desistiu de esperar).
    pub fn on_peer_terminate(&self, call_id: &str, reason: Option<String>) {
        // `end_reason` vem CRU do WhatsApp: `accepted_elsewhere` não é chamada
        // perdida, e quem traduz isso é o CRM, não este serviço.
        self.finish(call_id, reason.unwrap_or_else(|| "terminate".into()));
    }

    /// Marca a chamada como encerrada e solta a mídia. Idempotente.
    pub fn finish(&self, call_id: &str, reason: impl Into<String>) {
        let (handle, motivo, atendida, duracao) = {
            let mut calls = self.lock();
            let Some(entry) = calls.get_mut(call_id) else {
                return;
            };
            if entry.status == CallStatus::Ended {
                return;
            }
            let motivo = reason.into();
            entry.status = CallStatus::Ended;
            entry.ended_at = Some(now_ms());
            entry.end_reason = Some(motivo.clone());
            entry.release_media();
            entry.incoming = None;
            let atendida = entry.accepted_at.is_some();
            let duracao = (now_ms() - entry.started_at) / 1000;
            (entry.handle.take(), motivo, atendida, duracao)
        };
        // O DESFECHO é a linha que separa "ninguém atendeu" de "atenderam e
        // caiu" — sem ela, um vídeo que não aparece e uma chamada que ninguém
        // pegou têm exatamente o mesmo log.
        info!(
            "fim de {call_id}: motivo={motivo}, atendida={atendida}, {duracao}s"
        );
        self.emit("call_ended", call_id);
        if let Some(handle) = handle {
            // Desliga o plano de mídia local; o `<terminate>` já foi (ou veio) —
            // aqui só resta parar de gastar relay.
            tokio::spawn(async move {
                handle.hangup().await;
            });
        }
    }

    /// Remove chamadas encerradas há mais de dez minutos. Chamado do laço de
    /// manutenção — não do caminho quente.
    pub fn prune(&self) {
        let limite = now_ms() - 600_000;
        let mut calls = self.lock();
        calls.retain(|_, entry| {
            entry.status != CallStatus::Ended || entry.ended_at.unwrap_or(0) > limite
        });
    }

    /// Sinalização de vídeo do outro lado.
    pub fn on_peer_video_state(&self, call_id: &str, state: VideoState) {
        {
            let mut calls = self.lock();
            let Some(entry) = calls.get_mut(call_id) else {
                return;
            };
            entry.peer_video = !state.is_inactive_for_call_mode();
            // O pedido do outro lado MORREU (recusado, cancelado, vencido por
            // tempo). Guardar o token depois disso é pior do que não ter
            // nenhum: o próximo clique em "Vídeo" tentaria aceitar um pedido
            // que não existe mais e falharia sempre, em vez de simplesmente
            // abrir um upgrade novo.
            if state.is_inactive_for_call_mode() {
                entry.pending_video = None;
            }
        }
        info!("vídeo do outro lado em {call_id}: {state:?}");
        self.hub.json(&json!({
            "type": "video_state",
            "callId": call_id,
            "state": format!("{state:?}"),
            "call": self.row(call_id),
        }));
    }

    // -------------------------------------------------------------- operações

    /// Coloca uma chamada de saída. `phone` já vem em dígitos.
    pub async fn place_call(
        self: &Arc<Self>,
        phone: &str,
        video: bool,
        fps: u32,
        owner: Option<String>,
    ) -> OpResult<String> {
        if !self.client.is_connected() {
            return Err(OpError::new(503, "WhatsApp desconectado."));
        }
        let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() < 8 {
            return Err(OpError::new(400, "Número inválido."));
        }
        // Uma chamada de saída por dono, como no WaCalls: duas ao mesmo tempo na
        // mesma aba seriam duas linhas de áudio disputando o mesmo microfone.
        if let Some(owner) = owner.as_deref() {
            let calls = self.lock();
            if calls
                .values()
                .any(|c| c.status != CallStatus::Ended && c.owner.as_deref() == Some(owner))
            {
                return Err(OpError::new(409, "Você já está em uma chamada."));
            }
        }

        let peer = Jid::pn(digits.clone());
        let pipes = audio_pipes();
        let (video_tx, video_rx) = async_channel::bounded::<Vec<u8>>(4);
        let (frame_tx, frame_rx) = async_channel::bounded::<VideoFrame>(2);

        let handle = {
            let voip = self.client.voip();
            let mut builder = voip
                .call(&peer)
                .audio(pipes.mic_rx.clone(), pipes.speaker_tx.clone());
            if video {
                builder = builder.video(BrowserVideoSource::new(video_rx.clone(), fps), frame_tx);
            }
            builder
                .start()
                .await
                .map_err(|e| OpError::new(502, format!("Não foi possível ligar: {e}")))?
        };

        let call_id = handle.call_id().to_string();
        let handle = Arc::new(handle);
        let mut entry = CallEntry::new(call_id.clone(), Direction::Outbound, peer.to_string());
        entry.phone = Some(digits);
        entry.owner = owner;
        entry.is_video = video;
        entry.video_active = video;
        entry.handle = Some(handle.clone());
        entry.audio_in = Some(pipes.mic_tx);
        entry.audio_drain = Some(pipes.mic_rx.clone());
        if video {
            entry.video_in = Some(video_tx);
        }
        self.lock().insert(call_id.clone(), entry);

        spawn_audio_playout(self.clone(), self.hub.clone(), call_id.clone(), pipes.speaker_rx);
        if video {
            spawn_video_playout(self.hub.clone(), call_id.clone(), frame_rx);
        }
        self.spawn_call_events(handle.clone(), pipes.speaker_tx);
        self.spawn_end_watch(handle, call_id.clone());

        info!("chamada de saída {call_id} para {phone} (video={video})");
        self.emit("outgoing_call", &call_id);
        Ok(call_id)
    }

    /// Atende um convite guardado.
    pub async fn accept_call(
        self: &Arc<Self>,
        call_id: &str,
        video: bool,
        fps: u32,
        owner: Option<String>,
    ) -> OpResult<()> {
        let incoming = {
            let mut calls = self.lock();
            let entry = calls
                .get_mut(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
            if entry.status == CallStatus::Ended {
                return Err(OpError::new(409, "A chamada já terminou."));
            }
            if entry.handle.is_some() {
                return Err(OpError::new(409, "A chamada já foi atendida."));
            }
            if let (Some(dono), Some(novo)) = (entry.owner.as_deref(), owner.as_deref()) {
                if dono != novo {
                    return Err(OpError::new(409, "Outro atendente já pegou esta chamada."));
                }
            }
            entry.owner = owner.clone().or_else(|| entry.owner.clone());
            let incoming = entry
                .incoming
                .clone()
                .ok_or_else(|| OpError::new(409, "O convite não está mais disponível."))?;
            entry.status = CallStatus::Connecting;
            *incoming
        };
        // O convite só oferece vídeo quando ele nasceu de vídeo; anunciar
        // `<video>` numa oferta de áudio é recusado pela própria biblioteca.
        let com_video = video
            && matches!(
                &incoming.action,
                CallAction::Offer { is_video: true, .. }
            );

        let pipes = audio_pipes();
        let (video_tx, video_rx) = async_channel::bounded::<Vec<u8>>(4);
        let (frame_tx, frame_rx) = async_channel::bounded::<VideoFrame>(2);

        let handle = {
            let voip = self.client.voip();
            let mut builder = voip
                .accept(&incoming)
                .audio(pipes.mic_rx.clone(), pipes.speaker_tx.clone());
            if com_video {
                builder = builder.video(BrowserVideoSource::new(video_rx.clone(), fps), frame_tx);
            }
            match builder.start().await {
                Ok(handle) => handle,
                Err(e) => {
                    self.finish(call_id, "accept_failed");
                    return Err(OpError::new(502, format!("Não foi possível atender: {e}")));
                }
            }
        };

        let handle = Arc::new(handle);
        {
            let mut calls = self.lock();
            if let Some(entry) = calls.get_mut(call_id) {
                entry.handle = Some(handle.clone());
                entry.audio_in = Some(pipes.mic_tx);
                entry.audio_drain = Some(pipes.mic_rx.clone());
                entry.accepted_at = Some(now_ms());
                entry.status = CallStatus::Active;
                entry.video_active = com_video;
                if com_video {
                    entry.video_in = Some(video_tx);
                }
                entry.incoming = None;
            }
        }

        spawn_audio_playout(self.clone(), self.hub.clone(), call_id.to_string(), pipes.speaker_rx);
        if com_video {
            spawn_video_playout(self.hub.clone(), call_id.to_string(), frame_rx);
        }
        self.spawn_call_events(handle.clone(), pipes.speaker_tx);
        self.spawn_end_watch(handle, call_id.to_string());

        info!("chamada {call_id} atendida (video={com_video})");
        self.emit("call_accepted", call_id);
        Ok(())
    }

    /// Recusa um convite que ainda está tocando.
    pub async fn reject_call(self: &Arc<Self>, call_id: &str) -> OpResult<()> {
        let incoming = {
            let calls = self.lock();
            let entry = calls
                .get(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
            entry.incoming.clone()
        };
        match incoming {
            Some(incoming) => {
                if let Err(e) = self.client.voip().reject(&incoming).await {
                    warn!("recusa de {call_id} falhou: {e}");
                }
            }
            // Sem convite guardado só resta encerrar como qualquer chamada.
            None => return self.hangup_call(call_id).await,
        }
        self.finish(call_id, "rejected_local");
        Ok(())
    }

    /// Encerra a chamada avisando o outro lado.
    pub async fn hangup_call(self: &Arc<Self>, call_id: &str) -> OpResult<()> {
        let (handle, incoming) = {
            let calls = self.lock();
            let entry = calls
                .get(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
            (entry.handle.clone(), entry.incoming.clone())
        };
        if let Some(handle) = handle {
            // O `<terminate>` faz o outro lado ver um desligamento normal em vez
            // de esperar o transporte expirar.
            if let Err(e) = self
                .client
                .voip()
                .terminate(call_id, &handle.peer_jid(), handle.call_creator())
                .await
            {
                warn!("terminate de {call_id} falhou ({e}); derrubando localmente");
                handle.hangup().await;
            }
        } else if let Some(incoming) = incoming {
            if let Err(e) = self.client.voip().reject(&incoming).await {
                warn!("recusa de {call_id} falhou: {e}");
            }
        }
        self.finish(call_id, "hangup_local");
        Ok(())
    }

    pub fn set_muted(&self, call_id: &str, muted: bool) -> OpResult<()> {
        let mut calls = self.lock();
        let entry = calls
            .get_mut(call_id)
            .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
        entry.muted = muted;
        // Mudo NÃO é parar de mandar quadro: com o motor mudo ele emite conforto
        // (DTX) e o transporte segue de pé. Uma linha que emudece de vez faz o
        // outro lado achar que a ligação caiu.
        if let Some(handle) = &entry.handle {
            handle.set_muted(muted);
        }
        drop(calls);
        self.emit("call_update", call_id);
        Ok(())
    }

    /// Liga a câmera no meio da chamada — aceitando o pedido do outro lado, se
    /// houver um, ou pedindo o upgrade.
    pub async fn enable_video(self: &Arc<Self>, call_id: &str, fps: u32) -> OpResult<()> {
        let (handle, pendente, ja_ligado) = {
            let calls = self.lock();
            let entry = calls
                .get(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
            (
                entry.handle.clone(),
                entry.pending_video,
                entry.video_active,
            )
        };
        if ja_ligado {
            return Ok(());
        }
        let handle = handle.ok_or_else(|| OpError::new(409, "A chamada ainda não tem mídia."))?;

        let (video_tx, video_rx) = async_channel::bounded::<Vec<u8>>(4);
        let (frame_tx, frame_rx) = async_channel::bounded::<VideoFrame>(2);
        let source = BrowserVideoSource::new(video_rx, fps);

        let resultado = match pendente {
            Some(token) => handle.accept_video(token, source, frame_tx).await,
            None => handle.start_video(source, frame_tx).await,
        };
        resultado.map_err(|e| OpError::new(502, format!("Não foi possível ligar a câmera: {e}")))?;
        info!(
            "vídeo ligado em {call_id} (fps={fps}, {})",
            if pendente.is_some() {
                "aceitando o pedido do outro lado"
            } else {
                "pedindo upgrade"
            }
        );

        {
            let mut calls = self.lock();
            if let Some(entry) = calls.get_mut(call_id) {
                entry.video_in = Some(video_tx);
                entry.video_active = true;
                entry.pending_video = None;
            }
        }
        spawn_video_playout(self.hub.clone(), call_id.to_string(), frame_rx);
        self.emit("call_update", call_id);
        Ok(())
    }

    /// Encerra a chamada em que o outro lado parou de mandar mídia.
    ///
    /// Rede de segurança para o `<terminate>` que não chega: quando o contato
    /// desliga no celular e o aviso se perde, o cartão do operador ficava
    /// contando os minutos de uma conversa que já tinha acabado — e ele só
    /// descobria falando sozinho. Depois de ATENDIDA, mídia do outro lado é o
    /// pulso da chamada: parou, acabou.
    ///
    /// A carência é generosa de propósito. Uma queda de rede de poucos segundos
    /// não pode derrubar uma conversa que ia voltar, e o silêncio só conta
    /// depois do atendimento — antes dele o relay manda quadros vazios de
    /// qualquer forma (ver `on_peer_media`).
    pub fn sweep_dead_media(&self) {
        const SEM_MIDIA_MS: i64 = 12_000;
        let limite = now_ms() - SEM_MIDIA_MS;
        let mortas: Vec<String> = {
            let calls = self.lock();
            calls
                .values()
                .filter(|entry| {
                    entry.status != CallStatus::Ended
                        && entry.accepted_at.is_some()
                        && entry.last_media_at.is_some_and(|visto| visto < limite)
                })
                .map(|entry| entry.call_id.clone())
                .collect()
        };
        for call_id in mortas {
            warn!("{call_id}: o outro lado parou de mandar mídia — encerrando");
            self.finish(&call_id, "media_timeout");
        }
    }

    /// Anuncia ao outro lado a rotação da NOSSA câmera, em quartos de volta.
    ///
    /// A biblioteca guarda o valor mesmo com a chamada ainda tocando e o anuncia
    /// junto da stanza que liga o vídeo; com o vídeo já no ar, ela manda na hora.
    pub async fn set_video_orientation(
        self: &Arc<Self>,
        call_id: &str,
        orientation: u8,
    ) -> OpResult<()> {
        let handle = {
            let calls = self.lock();
            calls
                .get(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?
                .handle
                .clone()
        };
        let handle = handle.ok_or_else(|| OpError::new(409, "A chamada ainda não tem mídia."))?;
        handle
            .set_video_orientation(orientation)
            .await
            .map_err(|e| OpError::new(502, format!("Não foi possível girar a câmera: {e}")))?;
        info!("orientação da nossa câmera em {call_id}: {orientation}");
        self.emit("call_update", call_id);
        Ok(())
    }

    /// Desliga a nossa câmera. O outro lado pode continuar mandando a dele.
    pub async fn disable_video(self: &Arc<Self>, call_id: &str) -> OpResult<()> {
        let handle = {
            let calls = self.lock();
            let entry = calls
                .get(call_id)
                .ok_or_else(|| OpError::new(404, "Chamada não encontrada."))?;
            entry.handle.clone()
        };
        if let Some(handle) = handle {
            if let Err(e) = handle.stop_video().await {
                warn!("stop_video de {call_id} falhou: {e}");
            }
        }
        info!("vídeo desligado em {call_id}");
        {
            let mut calls = self.lock();
            if let Some(entry) = calls.get_mut(call_id) {
                entry.video_in = None;
                entry.video_active = false;
            }
        }
        self.emit("call_update", call_id);
        Ok(())
    }

    // ------------------------------------------------------------------ mídia

    /// Um quadro de microfone vindo do navegador.
    ///
    /// Com a fila cheia, o quadro descartado é o mais VELHO, não o que acabou de
    /// chegar. A diferença não é de gosto: `try_send` sozinho recusa o novo e
    /// preserva os antigos, e como o motor consome em tempo real (um quadro a
    /// cada 60 ms) a fila nunca mais esvaziaria — meio segundo de atraso ficaria
    /// grudado na voz até o fim da chamada.
    pub fn push_mic(&self, call_id: &str, frame: Vec<i16>) {
        let calls = self.lock();
        let Some(entry) = calls.get(call_id) else {
            return;
        };
        let Some(tx) = &entry.audio_in else {
            return;
        };
        if let Err(async_channel::TrySendError::Full(frame)) = tx.try_send(frame) {
            if let Some(drain) = &entry.audio_drain {
                let _ = drain.try_recv();
            }
            let _ = tx.try_send(frame);
        }
    }

    /// Uma unidade de acesso H.264 vinda da câmera do navegador.
    pub fn push_video(&self, call_id: &str, au: Vec<u8>) {
        let mut calls = self.lock();
        let Some(entry) = calls.get_mut(call_id) else {
            return;
        };
        let Some(tx) = &entry.video_in else {
            return;
        };
        if !entry.video_out_logged {
            entry.video_out_logged = true;
            info!(
                "primeira unidade de vídeo do navegador em {call_id} ({} bytes)",
                au.len()
            );
        }
        let _ = tx.try_send(au);
    }

    pub fn exists(&self, call_id: &str) -> bool {
        self.lock().contains_key(call_id)
    }

    /// Esta chamada já tem mídia nossa de pé?
    ///
    /// É o que separa os DOIS caminhos por onde a mesma sinalização de vídeo
    /// chega: o fluxo da chamada (`CallEvent::VideoStateChanged`, que traz o
    /// token do upgrade) e o evento cru do WhatsApp (`CallAction::VideoState`).
    /// Ver `observer.rs`.
    pub fn has_handle(&self, call_id: &str) -> bool {
        self.lock()
            .get(call_id)
            .is_some_and(|entry| entry.handle.is_some())
    }

    // ------------------------------------------------------------- bastidores

    /// Escuta os eventos do motor de UMA chamada. É por aqui que o relay avisa
    /// que a mídia subiu e que o outro lado pediu vídeo.
    fn spawn_call_events(
        self: &Arc<Self>,
        handle: Arc<CallHandle>,
        speaker: async_channel::Sender<Vec<i16>>,
    ) {
        let state = self.clone();
        let events = handle.events();
        let call_id = handle.call_id().to_string();
        let fallback = spawn_opus_fallback(speaker);
        tokio::spawn(async move {
            while let Ok(event) = events.recv().await {
                match event {
                    CallEvent::RelayAllocated => {
                        // Mídia pronta NÃO é chamada atendida. Numa ligação de
                        // saída o relay sobe em menos de um segundo, antes de o
                        // contato sequer ver o telefone tocar; marcar `Active`
                        // aqui fazia o CRM cronometrar "Em chamada 00:07" e
                        // registrar na ficha uma conversa que nunca houve — e
                        // ainda matava o toque de chamada do operador. Quem
                        // atendeu é `accepted_at`: o aceite do outro lado, ou o
                        // nosso, quando somos nós que pegamos o convite.
                        let ativa = {
                            let mut calls = state.lock();
                            match calls.get_mut(&call_id) {
                                Some(entry) if entry.status != CallStatus::Ended => {
                                    entry.relay_ready = true;
                                    if entry.accepted_at.is_some() {
                                        entry.status = CallStatus::Active;
                                        true
                                    } else {
                                        false
                                    }
                                }
                                _ => false,
                            }
                        };
                        if ativa {
                            info!("mídia viva em {call_id}");
                            state.emit("call_active", &call_id);
                        } else {
                            info!("mídia pronta em {call_id}, esperando o atendimento");
                            state.emit("call_update", &call_id);
                        }
                    }
                    CallEvent::RelayAllocateFailed(code) => {
                        state.emit_error(&call_id, &format!("O relay recusou a mídia ({code})."));
                        state.finish(&call_id, "relay_failed");
                    }
                    CallEvent::RelayAllocateTimedOut | CallEvent::RelayReconnectTimedOut => {
                        state.emit_error(&call_id, "O relay não respondeu.");
                        state.finish(&call_id, "relay_timeout");
                    }
                    CallEvent::AudioFormatMismatch { expected_rate, .. } => {
                        state.emit_error(
                            &call_id,
                            &format!("Codec de áudio incompatível (esperado {expected_rate} Hz)."),
                        );
                    }
                    CallEvent::ForeignAudio(payload) => {
                        if let Some(tx) = &fallback {
                            let _ = tx.try_send(payload);
                        }
                    }
                    CallEvent::VideoStateChanged {
                        state: vs,
                        upgrade_token,
                        ..
                    } => {
                        if vs.is_upgrade_request() {
                            let mut calls = state.lock();
                            if let Some(entry) = calls.get_mut(&call_id) {
                                entry.pending_video = upgrade_token;
                            }
                        }
                        state.on_peer_video_state(&call_id, vs);
                    }
                    CallEvent::OutboundMediaDropped {
                        video_access_units,
                        packets,
                    } => {
                        debug!(
                            "backpressure em {call_id}: {video_access_units} AUs / {packets} pacotes"
                        );
                    }
                    _ => {}
                }
            }
        });
    }

    /// Quando a tarefa de mídia da biblioteca termina, a chamada acabou — mesmo
    /// que nenhum `<terminate>` tenha chegado (queda de transporte, por exemplo).
    fn spawn_end_watch(self: &Arc<Self>, handle: Arc<CallHandle>, call_id: String) {
        let state = self.clone();
        tokio::spawn(async move {
            handle.wait_ended().await;
            state.finish(&call_id, "media_ended");
        });
    }

}

/// Decodifica o Opus que o outro lado às vezes embute no perfil MLOW. Sem isto
/// esses quadros chegam e não viram som nenhum — e o defeito é indistinguível de
/// "o alto-falante está errado".
#[cfg(feature = "opus-fallback")]
fn spawn_opus_fallback(
    speaker: async_channel::Sender<Vec<i16>>,
) -> Option<async_channel::Sender<Bytes>> {
    let mut decoder = match WaOpusDecoder::new() {
        Ok(decoder) => decoder,
        Err(error) => {
            error!("decoder Opus de reserva indisponível: {error}");
            return None;
        }
    };
    let (tx, rx) = async_channel::bounded::<Bytes>(3);
    tokio::task::spawn_blocking(move || {
        while let Ok(payload) = rx.recv_blocking() {
            match decoder.decode_mlow_escape(&payload) {
                Ok(pcm) => {
                    let _ = speaker.try_send(pcm.to_vec());
                }
                Err(error) => debug!("Opus de reserva não decodificou: {error}"),
            }
        }
    });
    Some(tx)
}

/// Sem o decodificador compilado, o quadro embutido é descartado — a chamada
/// segue, com o silêncio anotado no log de depuração.
#[cfg(not(feature = "opus-fallback"))]
fn spawn_opus_fallback(
    _speaker: async_channel::Sender<Vec<i16>>,
) -> Option<async_channel::Sender<Bytes>> {
    None
}
