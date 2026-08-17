// Estado das chamadas de voz — fonte única, fora do React.
//
// Modelado por `callId` num Map, e não como "a chamada do sistema": o WaCalls
// aguenta várias ao mesmo tempo e o mesmo número vai ser usado por mais de um
// operador. Cada navegador é dono do áudio das SUAS chamadas (ver `mine`), e a
// ponte de áudio de uma chamada nunca é compartilhada com outra.
//
// O padrão é o do `services/whatsapp/muteStore`: singleton com
// `subscribe`/`getSnapshot` para `useSyncExternalStore`, sem contexto React.
// Assim o mesmo estado serve o CRM completo e a janela /atendimento.
import { waCallsService, WaCallsError } from '../wacalls.service';
import { whatsappService } from '../whatsapp.service';
import { getWaCallsClientId, waCallsLog } from './config';
import { openCallAudio, openMicrophone, MicrophoneError, type WaCallAudioBridge } from './audioBridge';
import { phoneFromWaCallsPeer, toWaCallsPhone } from './phone';
import { endReasonIsFailure, endReasonMessage, phaseFromStatus } from './callOutcome';
import type { WaCall, WaCallContact, WaCallsEvent, WaCallsSession, WaCallsStatus } from './types';

/** Quanto tempo o cartão de uma chamada encerrada fica na tela antes de sumir. */
const ENDED_LINGER_MS = 2500;
const FAILED_LINGER_MS = 4500;

/** Aviso para a UI mostrar como toast. O store não conhece o sistema de toasts. */
export interface WaCallsNotice {
  kind: 'error' | 'info' | 'success';
  message: string;
  description?: string;
}

export interface WaCallsSnapshot {
  /** Já tentamos falar com o WaCalls pelo menos uma vez. */
  ready: boolean;
  /** O serviço respondeu na última tentativa. */
  available: boolean;
  sessions: WaCallsSession[];
  /** `activeWaCallsSessionId` — a conta usada para ligar. */
  sessionId: string | null;
  /** Todas as chamadas conhecidas, da mais recente para a mais antiga. */
  calls: WaCall[];
}

const calls = new Map<string, WaCall>();
/**
 * Status que chegou pelo SSE antes de a chamada existir aqui.
 *
 * O servidor publica o `call-status` no MESMO instante em que cria a chamada —
 * quer dizer, antes de a resposta do POST chegar ao navegador. Numa ligação
 * atendida no primeiro toque, o "connected" pode passar na frente do nosso
 * `upsert` e a tela ficaria eternamente em "Chamando…". Guardamos o último
 * status órfão e aplicamos assim que a chamada entra no mapa.
 */
const orphanStatus = new Map<string, WaCallsStatus>();
const bridges = new Map<string, WaCallAudioBridge>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const noticeListeners = new Set<(notice: WaCallsNotice) => void>();

let sessions: WaCallsSession[] = [];
let sessionId: string | null = null;
let ready = false;
let available = false;
let initializing: Promise<void> | null = null;
let closeEvents: (() => void) | null = null;
let snapshot: WaCallsSnapshot = { ready: false, available: false, sessions: [], sessionId: null, calls: [] };

function emit(): void {
  snapshot = {
    ready,
    available,
    sessions,
    sessionId,
    calls: Array.from(calls.values()).sort((a, b) => b.startedAt - a.startedAt),
  };
  listeners.forEach(fn => fn());
}

function notify(notice: WaCallsNotice): void {
  noticeListeners.forEach(fn => fn(notice));
}

/**
 * A conta que pode ligar: pareada e com a conexão aberta.
 *
 * Havendo uma só, ela é usada sem perguntar nada. Havendo mais, a primeira
 * serve de padrão e a lista fica no snapshot — é o gancho para, no futuro, o
 * operador escolher por qual número ligar (`setSessionId`).
 */
function callableSessions(list: WaCallsSession[]): WaCallsSession[] {
  return list.filter(s => s.paired && s.state === 'open');
}

function applySessions(list: WaCallsSession[]): void {
  sessions = list;
  const callable = callableSessions(list);
  // Mantém a escolha atual enquanto ela continuar válida.
  if (sessionId && callable.some(s => s.id === sessionId)) return;
  sessionId = callable[0]?.id ?? null;
}

function upsert(call: WaCall): void {
  calls.set(call.callId, call);
  emit();
  const pending = orphanStatus.get(call.callId);
  if (pending) {
    orphanStatus.delete(call.callId);
    applyStatus(call.callId, pending);
  }
}

/** Aplica um status do servidor sobre a chamada local, respeitando a fase atual. */
function applyStatus(callId: string, status: WaCallsStatus): void {
  const current = calls.get(callId);
  if (!current) return;
  const phase = phaseFromStatus(status, current.direction, current.phase);
  if (phase === current.phase) return;
  const connectedAt = phase === 'ACTIVE' && !current.connectedAt ? Date.now() : current.connectedAt;
  if (phase === 'ACTIVE' && !current.connectedAt) waCallsLog('call ACTIVE', { callId });
  patch(callId, { phase, connectedAt });
}

function patch(callId: string, changes: Partial<WaCall>): WaCall | null {
  const current = calls.get(callId);
  if (!current) return null;
  const next = { ...current, ...changes };
  calls.set(callId, next);
  emit();
  return next;
}

/** Fecha a ponte de áudio e solta os recursos daquela chamada — e só dela. */
function closeBridge(callId: string): void {
  const bridge = bridges.get(callId);
  if (!bridge) return;
  bridges.delete(callId);
  bridge.close();
}

function scheduleRemoval(callId: string, delay: number): void {
  const previous = removalTimers.get(callId);
  if (previous) clearTimeout(previous);
  removalTimers.set(callId, setTimeout(() => {
    removalTimers.delete(callId);
    calls.delete(callId);
    orphanStatus.delete(callId);
    emit();
  }, delay));
}

/** Encerramento local completo: áudio liberado, cartão em estado final. */
function finishCall(callId: string, endReason: string | null, failed = false): void {
  closeBridge(callId);
  const call = calls.get(callId);
  if (!call) return;
  const answered = call.connectedAt !== null;
  const updated = patch(callId, {
    phase: failed ? 'FAILED' : 'ENDED',
    endedAt: Date.now(),
    endReason,
    error: failed ? call.error : null,
  });
  if (!updated) return;
  waCallsLog('call ended', { callId, endReason });
  if (!failed) {
    const message = endReasonMessage(endReason, { answered, direction: call.direction });
    notify({ kind: endReasonIsFailure(endReason, answered) ? 'error' : 'info', message });
  }
  scheduleRemoval(callId, failed ? FAILED_LINGER_MS : ENDED_LINGER_MS);
}

/** Descobre quem é o número — sem travar a chamada se a consulta demorar. */
async function resolveContact(phone: string): Promise<WaCallContact | null> {
  try {
    const found = await whatsappService.findConversationByPhone(phone);
    if (!found) return null;
    return {
      conversationId: found.conversationId,
      clientId: found.clientId,
      name: found.name,
      avatarUrl: found.avatarUrl,
    };
  } catch {
    return null;
  }
}

function handleEvent(event: WaCallsEvent): void {
  const me = getWaCallsClientId();
  switch (event.type) {
    case 'session-list':
      applySessions(event.sessions ?? []);
      emit();
      break;

    case 'auth-state': {
      const next = sessions.map(s => (
        s.id === event.sessionId ? { ...s, paired: event.paired, state: event.state } : s
      ));
      applySessions(next);
      emit();
      break;
    }

    case 'incoming': {
      // Só interessa a conta que este CRM usa; um segundo número conectado ao
      // mesmo WaCalls não deve tocar aqui.
      if (sessionId && event.sessionId !== sessionId) return;
      if (calls.has(event.id)) return;
      const phone = phoneFromWaCallsPeer(event.peer);
      upsert({
        callId: event.id,
        sessionId: event.sessionId,
        direction: 'inbound',
        phase: 'RINGING',
        phone,
        contact: null,
        mine: false,
        startedAt: event.offeredAt || Date.now(),
        connectedAt: null,
        endedAt: null,
        endReason: null,
        muted: false,
        error: null,
      });
      waCallsLog('incoming call', { callId: event.id });
      void resolveContact(phone).then(contact => { if (contact) patch(event.id, { contact }); });
      break;
    }

    case 'incoming-claimed':
      // Outro operador atendeu antes: o convite some daqui sem alarde.
      if (event.owner !== me && calls.get(event.id)?.mine === false) {
        calls.delete(event.id);
        emit();
      }
      break;

    case 'call-status': {
      const existing = calls.get(event.id);
      const mine = event.owner === me;
      if (!existing) {
        // Chamada de outro operador no mesmo número: nada a fazer aqui — o
        // áudio e o cartão são da aba dona dela. Sendo nossa, o status espera
        // o `upsert` (ver orphanStatus).
        if (mine) orphanStatus.set(event.id, event.status);
        return;
      }
      if (mine && !existing.mine) patch(event.id, { mine: true });
      applyStatus(event.id, event.status);
      break;
    }

    case 'call-ended':
      if (!calls.has(event.id)) return;
      finishCall(event.id, event.reason ?? null);
      break;

    default:
      break;
  }
}

export const waCallsStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  getSnapshot(): WaCallsSnapshot {
    return snapshot;
  },

  /** Avisos para virar toast na UI (ver WaCallsHost). */
  onNotice(fn: (notice: WaCallsNotice) => void): () => void {
    noticeListeners.add(fn);
    return () => { noticeListeners.delete(fn); };
  },

  /**
   * Carrega as sessões e liga a escuta de eventos. Idempotente.
   *
   * UMA conexão SSE por aba, aberta aqui e distribuída daqui. O `EventSource`
   * reconecta sozinho; não empilhamos retentativa por cima. Se o serviço
   * estiver fora, `available` fica falso e o botão de ligar sabe explicar.
   */
  async init(): Promise<void> {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        applySessions(await waCallsService.getSessions());
        available = true;
        waCallsLog('session loaded', { sessionId, total: sessions.length });
      } catch {
        available = false;
        waCallsLog('serviço de chamadas indisponível');
      } finally {
        ready = true;
        emit();
      }
      if (!available || closeEvents) return;
      closeEvents = waCallsService.connectEvents({
        onEvent: handleEvent,
        onOpen: () => { available = true; emit(); },
        onError: () => { available = false; emit(); },
      });
    })();
    return initializing;
  },

  /** Nova tentativa depois de o serviço ter falhado (o operador clicou de novo). */
  async refresh(): Promise<void> {
    initializing = null;
    await this.init();
  },

  /** Escolha manual da conta — pronto para quando houver mais de um número. */
  setSessionId(id: string | null): void {
    sessionId = id;
    emit();
  },

  /**
   * Liga para um número a partir da conversa.
   *
   * Ordem: sessão → microfone → chamada no WaCalls → negociação → ponte. O
   * microfone vem ANTES de criar a chamada de propósito: descobrir a permissão
   * bloqueada depois que o telefone do cliente já tocou seria pior.
   */
  async placeCall(params: { phone: string; contact?: WaCallContact | null }): Promise<string | null> {
    await this.init();
    if (!available) {
      notify({ kind: 'error', message: 'Serviço de chamadas indisponível.', description: 'Tente novamente em instantes.' });
      return null;
    }
    const sid = sessionId;
    if (!sid) {
      notify({ kind: 'error', message: 'Nenhum WhatsApp disponível para chamadas.', description: 'Nenhuma conta pareada e conectada no serviço de chamadas.' });
      return null;
    }
    const phone = toWaCallsPhone(params.phone);
    if (!phone) {
      notify({ kind: 'error', message: 'Número inválido para chamada.' });
      return null;
    }
    if (Array.from(calls.values()).some(c => c.mine && c.phase !== 'ENDED' && c.phase !== 'FAILED')) {
      notify({ kind: 'error', message: 'Você já está em uma chamada.' });
      return null;
    }

    let micStream: MediaStream;
    try {
      micStream = await openMicrophone();
    } catch (err) {
      const message = err instanceof MicrophoneError
        ? err.message
        : 'Não foi possível acessar o microfone. Verifique a permissão do navegador.';
      notify({ kind: 'error', message });
      return null;
    }

    // Cartão provisório: o operador vê "Preparando…" enquanto o servidor
    // responde. A chave definitiva só existe depois do POST.
    let callId: string;
    try {
      callId = await waCallsService.startCall(sid, phone);
      waCallsLog('outgoing call created', { callId });
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
      const message = err instanceof WaCallsError ? err.message : 'Não foi possível iniciar a chamada.';
      notify({ kind: 'error', message });
      return null;
    }

    upsert({
      callId,
      sessionId: sid,
      direction: 'outbound',
      phase: 'PREPARING',
      phone,
      contact: params.contact ?? null,
      mine: true,
      startedAt: Date.now(),
      connectedAt: null,
      endedAt: null,
      endReason: null,
      muted: false,
      error: null,
    });
    if (!params.contact) {
      void resolveContact(phone).then(contact => { if (contact) patch(callId, { contact }); });
    }

    await this.attachAudio(sid, callId, micStream);
    return callId;
  },

  /**
   * Atende uma chamada recebida: reivindica a posse no servidor e sobe o áudio.
   * O microfone é pedido antes do accept — se ele falhar, o cliente continua
   * chamando e outro operador ainda pode atender.
   */
  async acceptCall(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    let micStream: MediaStream;
    try {
      micStream = await openMicrophone();
    } catch (err) {
      const message = err instanceof MicrophoneError
        ? err.message
        : 'Permissão de microfone necessária para atender a chamada.';
      notify({ kind: 'error', message });
      return;
    }
    patch(callId, { phase: 'PREPARING', mine: true });
    try {
      await waCallsService.acceptCall(call.sessionId, callId);
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
      if (err instanceof WaCallsError && err.status === 409) {
        // Outro operador chegou primeiro. Sem erro na cara de ninguém.
        calls.delete(callId);
        emit();
        return;
      }
      patch(callId, { error: err instanceof WaCallsError ? err.message : 'Não foi possível atender.' });
      finishCall(callId, 'failed', true);
      return;
    }
    await this.attachAudio(call.sessionId, callId, micStream);
  },

  /**
   * Sobe a ponte WebRTC/DataChannel de uma chamada que já existe no servidor.
   * Falhando aqui, a chamada é derrubada também no servidor — deixá-la de pé
   * faria o telefone do cliente tocar sem ninguém do outro lado.
   */
  async attachAudio(sid: string, callId: string, micStream: MediaStream): Promise<void> {
    try {
      const bridge = await openCallAudio({
        callId,
        micStream,
        negotiate: sdpOffer => waCallsService.negotiateWebRTC(sid, callId, sdpOffer),
        onDisconnected: () => { void this.hangUp(callId); },
      });
      bridges.set(callId, bridge);
      const current = calls.get(callId);
      // Subir a ponte leva alguns instantes, e nesse meio-tempo a chamada pode
      // ter caído (o cliente desistiu) ou o operador ter clicado em encerrar.
      // Sem esta guarda, o microfone continuaria aberto depois do fim.
      if (!current || current.phase === 'ENDING' || current.phase === 'ENDED' || current.phase === 'FAILED') {
        bridges.delete(callId);
        bridge.close();
        return;
      }
      // "Chamando…" só vale para quem discou; numa chamada recebida a fase
      // segue em PREPARING ("Conectando…") até o servidor dizer connected.
      if (current.phase === 'PREPARING' && current.direction === 'outbound') {
        patch(callId, { phase: 'CALLING' });
      }
    } catch (err) {
      micStream.getTracks().forEach(t => t.stop());
      console.error('[WaCalls] falha ao abrir o áudio da chamada', err);
      patch(callId, { error: 'Não foi possível abrir o áudio da chamada.' });
      notify({ kind: 'error', message: 'Não foi possível abrir o áudio da chamada.', description: 'A chamada foi encerrada.' });
      try { await waCallsService.endCall(sid, callId); } catch { /* já pode ter caído */ }
      finishCall(callId, 'failed', true);
    }
  },

  /** Recusa a chamada recebida e tira o alerta da tela. */
  async rejectCall(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    calls.delete(callId);
    emit();
    try {
      await waCallsService.rejectCall(call.sessionId, callId);
    } catch {
      // O convite já sumiu da tela; insistir no erro não ajuda o operador.
    }
  },

  /** Desliga. O cleanup local acontece aqui e também quando o fim vem pelo SSE. */
  async hangUp(callId: string): Promise<void> {
    const call = calls.get(callId);
    if (!call) return;
    patch(callId, { phase: 'ENDING' });
    try {
      await waCallsService.endCall(call.sessionId, callId);
    } catch {
      // Mesmo sem confirmação do servidor, o lado de cá tem de ser liberado.
    }
    // O evento `call-ended` normalmente chega e fecha tudo; este finish garante
    // o encerramento se o SSE estiver fora do ar.
    if (calls.get(callId)?.phase === 'ENDING') finishCall(callId, 'user_ended');
  },

  /**
   * Muta/desmuta. O corte é no ENVIO dos quadros PCM: como o áudio sai por
   * DataChannel a partir do worklet, desligar a track do microfone sozinha não
   * garantiria silêncio do outro lado.
   */
  setMuted(callId: string, muted: boolean): void {
    bridges.get(callId)?.setMuted(muted);
    patch(callId, { muted });
  },

  /**
   * Solta tudo: pontes de áudio, timers e a escuta de eventos. Chamado quando
   * o host global desmonta (a aba está indo embora) — o microfone não pode
   * ficar aberto porque a página trocou.
   */
  shutdown(): void {
    for (const callId of Array.from(bridges.keys())) closeBridge(callId);
    for (const timer of removalTimers.values()) clearTimeout(timer);
    removalTimers.clear();
    closeEvents?.();
    closeEvents = null;
    initializing = null;
  },
};
