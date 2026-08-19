// Fachada do serviço de chamadas — a VOZ e o VÍDEO do escritório.
//
// Divisão de responsabilidade (não misturar):
//   · Evolution API  → mensagens, mídia, contatos, tudo o que já existia;
//   · Jurius Call    → SOMENTE chamadas de voz e vídeo.
//
// O motor por trás desta fachada mudou: saiu o WaCalls (Go, WebRTC entre
// navegador e servidor) e entrou o **Jurius Call** (Rust, sobre a biblioteca
// whatsapp-rust). O que ficou igual de propósito foi ESTA interface — o
// `callStore`, que é onde mora a lógica de atendimento do escritório, não sabe
// que o servidor trocou.
//
// A tradução acontece em `connectEvents`: os eventos do servidor novo são
// convertidos para as mesmas formas que o store já entende. Duas linguagens
// convivendo num arquivo só, em vez de espalhadas por 1400 linhas de store.
//
// A mídia não passa por aqui: ela vive em `wacalls/socket` (o WebSocket) e em
// `wacalls/audioBridge` / `wacalls/videoBridge` (os codecs do navegador).
import { CALL_BASE_URL, authHeaders, getWaCallsClientId, waCallsLog } from './wacalls/config';
import { callSocket } from './wacalls/socket';
import type {
  WaCallsEvent, WaCallsHistoryRow, WaCallsSession, WaCallsStatus,
} from './wacalls/types';

/** Erro de rede/HTTP do serviço de chamadas, com o status para quem diferencia. */
export class WaCallsError extends Error {
  constructor(message: string, readonly status: number | null, readonly detail = '') {
    super(message);
    this.name = 'WaCallsError';
  }
}

/**
 * O serviço novo atende uma conta só — a que está pareada em `/data`. O id
 * fixo existe para o store continuar falando por sessão sem precisar saber
 * disso.
 */
export const SESSION_ID = 'default';

const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-Client-Id': getWaCallsClientId(),
  ...authHeaders(),
});

const url = (path: string) => `${CALL_BASE_URL}${path}`;

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url(path), { ...init, headers: headers() });
  } catch (err) {
    // Servidor fora, DNS, rede do escritório caída: tudo cai aqui.
    throw new WaCallsError('Serviço de chamadas indisponível. Tente novamente.', null, String(err));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new WaCallsError(messageForStatus(response.status, detail), response.status, detail);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

/**
 * Traduz o status HTTP para o que o operador precisa ler. O corpo do erro do
 * Jurius Call já vem em português (`{"error":"..."}`); quando ele existe, é ele
 * que vale — quem escreveu a mensagem sabia mais do que o código de status.
 */
function messageForStatus(status: number, detail: string): string {
  try {
    const corpo = JSON.parse(detail) as { error?: string };
    if (corpo?.error) return corpo.error;
  } catch { /* corpo não era JSON */ }
  if (status === 404) return 'Chamada ou número não encontrado no serviço de chamadas.';
  if (status === 409) return 'Você já está em uma chamada.';
  if (status === 429) return 'Limite de chamadas simultâneas atingido.';
  if (status === 503) return 'Nenhum WhatsApp disponível para chamadas.';
  if (status >= 500) return 'Serviço de chamadas indisponível. Tente novamente.';
  return 'Não foi possível completar a ação no serviço de chamadas.';
}

/** O retrato da conta que o `/api/status` devolve. */
interface CallServiceStatus {
  connected: boolean;
  jid: string | null;
  pushName: string;
  phone: string | null;
  activeCalls: number;
}

/** A linha de chamada que o servidor publica. */
interface CallRow {
  callId: string;
  direction: 'inbound' | 'outbound';
  status: 'ringing' | 'connecting' | 'active' | 'ended';
  peer: string;
  phone: string | null;
  lid: string | null;
  owner: string | null;
  isVideo: boolean;
  videoActive: boolean;
  peerVideo: boolean;
  muted: boolean;
  startedAt: number;
  acceptedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
}

/**
 * O estado do servidor → o estado que o store conhece.
 *
 * `connecting` vira `starting` porque é o mesmo instante: o aceite já saiu e a
 * mídia ainda não subiu.
 */
function toStoreStatus(status: CallRow['status']): WaCallsStatus {
  switch (status) {
    case 'active': return 'connected';
    case 'connecting': return 'starting';
    case 'ended': return 'ended';
    default: return 'ringing';
  }
}

/**
 * O endereço do outro lado, na forma que o store sabe ler.
 *
 * Preferimos o TELEFONE quando o servidor conseguiu resolvê-lo (ele sai do
 * `caller_pn` do próprio convite). Sem telefone vai o endereço cru — que pode
 * ser um `@lid`, e é assim que o store sabe que precisa procurar o mapeamento
 * em vez de fingir que tem um número.
 */
function peerOf(call: CallRow): string {
  if (call.phone) return `${call.phone}@s.whatsapp.net`;
  return call.lid || call.peer;
}

function sessionFrom(status: CallServiceStatus): WaCallsSession {
  return {
    id: SESSION_ID,
    name: status.pushName || 'Jurius',
    jid: status.jid || '',
    state: status.connected ? 'open' : 'connecting',
    paired: !!status.jid,
  };
}

export const waCallsService = {
  /** A conta WhatsApp que o serviço mantém pareada. */
  async getSessions(): Promise<WaCallsSession[]> {
    const status = await request<CallServiceStatus>('/api/status');
    if (!status) return [];
    return [sessionFrom(status)];
  },

  /**
   * Abre a chamada de saída. `phone` já vem em dígitos (ver `wacalls/phone`).
   * Devolve o `callId`, que é a chave de tudo daqui para a frente.
   *
   * `video: true` faz a chamada NASCER em vídeo: o servidor monta a sessão VoIP
   * com o plano de vídeo e o telefone do contato toca como chamada de vídeo
   * desde o primeiro toque. É diferente de `enableVideo`, que é o upgrade de
   * uma ligação de voz que já está de pé.
   */
  async startCall(
    _sessionId: string,
    phone: string,
    options?: { video?: boolean },
  ): Promise<string> {
    const data = await request<{ callId: string }>('/api/calls', {
      method: 'POST',
      body: JSON.stringify({ to: phone, video: options?.video ?? false }),
    });
    const callId = data?.callId;
    if (!callId) throw new WaCallsError('O serviço de chamadas não devolveu a chamada.', null);
    return callId;
  },

  /** Aceita uma chamada recebida e reivindica a posse dela para esta aba. */
  async acceptCall(_sessionId: string, callId: string, options?: { video?: boolean }): Promise<string> {
    await request(`/api/calls/${encodeURIComponent(callId)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ video: options?.video ?? false }),
    });
    return callId;
  },

  /** Recusa a chamada recebida. */
  async rejectCall(_sessionId: string, callId: string): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/reject`, { method: 'POST', body: '{}' });
  },

  /** Encerra a chamada no servidor. O cleanup local é do callStore. */
  async endCall(_sessionId: string, callId: string): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', body: '{}' });
  },

  /**
   * Mudo NO SERVIDOR. O corte local (parar de mandar quadro) continua no
   * `audioBridge`; este avisa o motor para ele emitir conforto em vez de
   * silêncio absoluto — uma linha que emudece de vez faz o outro lado achar
   * que a ligação caiu.
   */
  async setMuted(callId: string, muted: boolean): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/mute`, {
      method: 'POST',
      body: JSON.stringify({ muted }),
    });
  },

  /**
   * UPGRADE: liga a câmera no meio de uma chamada de voz já em curso (ou aceita
   * o pedido do outro lado). NÃO serve para começar uma chamada de vídeo —
   * essa declara o vídeo na própria oferta, em `startCall({ video: true })`.
   */
  async enableVideo(callId: string, fps = 15): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/video/enable`, {
      method: 'POST',
      body: JSON.stringify({ fps }),
    });
  },

  /**
   * Gira a NOSSA câmera para o outro lado, em quartos de volta (0..3).
   *
   * A webcam do escritório entrega um quadro deitado e o aparelho do contato
   * desenha girado. Quem sabe qual é o certo é quem está olhando para os dois
   * lados ao mesmo tempo — por isso é um botão na tela, e a escolha fica
   * guardada para as próximas chamadas.
   */
  async setVideoOrientation(callId: string, orientation: number): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/video/orientation`, {
      method: 'POST',
      body: JSON.stringify({ orientation }),
    });
  },

  /** Desliga a nossa câmera. O outro lado pode continuar mandando a dele. */
  async disableVideo(callId: string): Promise<void> {
    await request(`/api/calls/${encodeURIComponent(callId)}/video/disable`, {
      method: 'POST',
      body: '{}',
    });
  },

  /**
   * Histórico. O Jurius Call não guarda registro — quem guarda é o CRM, em
   * `call_logs`. Continua devolvendo lista vazia para não quebrar quem chama.
   */
  async getHistory(_sessionId: string, _limit = 50): Promise<WaCallsHistoryRow[]> {
    return [];
  },

  /**
   * Abre a escuta de eventos. UMA por aba — quem chama é o callStore, e é ele
   * que distribui para a UI.
   *
   * Aqui mora a tradução: o servidor fala "incoming_call/call_active/..." e o
   * store fala "incoming/call-status/...". O socket reconecta sozinho.
   */
  connectEvents(handlers: {
    onEvent: (event: WaCallsEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  }): () => void {
    const emitirStatus = (call: CallRow) => {
      handlers.onEvent({
        type: 'call-status',
        sessionId: SESSION_ID,
        id: call.callId,
        owner: call.owner,
        status: toStoreStatus(call.status),
        peer: peerOf(call),
        startedAt: call.startedAt,
      });
      // O vídeo anda em ritmo próprio: a câmera vai e volta várias vezes dentro
      // da mesma chamada, e o `call-status` não muda por isso.
      handlers.onEvent({
        type: 'call-video',
        sessionId: SESSION_ID,
        id: call.callId,
        videoOn: call.videoActive,
        peerVideo: call.peerVideo,
      });
    };

    const emitirEntrada = (call: CallRow) => {
      handlers.onEvent({
        type: 'incoming',
        sessionId: SESSION_ID,
        id: call.callId,
        peer: peerOf(call),
        offeredAt: call.startedAt,
      });
      // Um convite de VÍDEO precisa se anunciar como tal antes de alguém
      // atender: quem aceita achando que é voz aparece na tela do cliente sem
      // ter escolhido isso.
      if (call.isVideo) {
        handlers.onEvent({
          type: 'call-video',
          sessionId: SESSION_ID,
          id: call.callId,
          videoOn: false,
          peerVideo: true,
        });
      }
    };

    const soltarEvento = callSocket.onEvent(raw => {
      const tipo = String(raw.type || '');
      const call = raw.call as CallRow | undefined;
      switch (tipo) {
        case 'hello': {
          const status = raw.status as CallServiceStatus | undefined;
          if (status) handlers.onEvent({ type: 'session-list', sessions: [sessionFrom(status)] });
          // Quem recarregou a página no meio de uma ligação volta enxergando
          // as chamadas vivas, e não uma tela vazia.
          for (const linha of (raw.calls as CallRow[] | undefined) ?? []) {
            if (linha.status === 'ended') continue;
            if (linha.direction === 'inbound' && linha.status === 'ringing') emitirEntrada(linha);
            else emitirStatus(linha);
          }
          break;
        }

        case 'status': {
          const status = raw.status as CallServiceStatus | undefined;
          if (!status) break;
          handlers.onEvent({
            type: 'auth-state',
            sessionId: SESSION_ID,
            paired: !!status.jid,
            state: status.connected ? 'open' : 'connecting',
          });
          break;
        }

        case 'incoming_call':
          if (call) emitirEntrada(call);
          break;

        case 'call_accepted':
          if (!call) break;
          // Quem atendeu virou dono: as outras abas tiram o convite da tela.
          if (call.direction === 'inbound' && call.owner) {
            handlers.onEvent({
              type: 'incoming-claimed', sessionId: SESSION_ID, id: call.callId, owner: call.owner,
            });
          }
          emitirStatus(call);
          break;

        case 'outgoing_call':
        case 'call_active':
        case 'call_update':
        case 'video_state':
          if (call) emitirStatus(call);
          break;

        case 'call_ended':
          if (!call) break;
          handlers.onEvent({
            type: 'call-ended',
            sessionId: SESSION_ID,
            id: call.callId,
            owner: call.owner,
            reason: call.endReason ?? '',
            endedAt: call.endedAt ?? Date.now(),
          });
          break;

        case 'error':
          waCallsLog('o serviço de chamadas reportou um erro', raw);
          break;

        default:
          break;
      }
    });

    const soltarAbertura = callSocket.onOpen(() => handlers.onOpen?.());
    const soltarQueda = callSocket.onClose(() => handlers.onError?.());
    callSocket.start();

    return () => {
      soltarEvento();
      soltarAbertura();
      soltarQueda();
      callSocket.stop();
    };
  },
};

export type { WaCallsSession, WaCallsHistoryRow, WaCallsEvent } from './wacalls/types';
export type { WaCall, WaCallPhase, WaCallContact } from './wacalls/types';
