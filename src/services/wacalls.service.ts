// Fachada do WaCalls — o provedor de VOZ do escritório.
//
// Divisão de responsabilidade (não misturar):
//   · Evolution API  → mensagens, mídia, contatos, tudo o que já existia;
//   · WaCalls        → SOMENTE as chamadas de voz.
//
// Aqui mora todo o HTTP e o SSE. Nenhum componente chama `fetch` para o
// WaCalls: a URL, os cabeçalhos e o formato das rotas ficam neste arquivo, do
// mesmo jeito que o WhatsApp tem a sua fachada em `whatsapp.service.ts`.
//
// A negociação de áudio (WebRTC + DataChannel PCM) vive em `wacalls/audioBridge`
// porque é uma peça de mídia, não de rede HTTP; o estado das chamadas vive em
// `wacalls/callStore`.
import { WACALLS_BASE_URL, authHeaders, getWaCallsClientId } from './wacalls/config';
import type {
  WaCallsEvent, WaCallsHistoryRow, WaCallsSession,
} from './wacalls/types';

/** Erro de rede/HTTP do WaCalls, com o status para quem quiser diferenciar. */
export class WaCallsError extends Error {
  constructor(message: string, readonly status: number | null, readonly detail = '') {
    super(message);
    this.name = 'WaCallsError';
  }
}

const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-Client-Id': getWaCallsClientId(),
  ...authHeaders(),
});

const url = (path: string) => `${WACALLS_BASE_URL}${path}`;

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
    throw new WaCallsError(messageForStatus(response.status), response.status, detail);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

/** Traduz o status HTTP do WaCalls para o que o operador precisa ler. */
function messageForStatus(status: number): string {
  if (status === 404) return 'Chamada ou número não encontrado no serviço de chamadas.';
  if (status === 409) return 'Você já está em uma chamada.';
  if (status === 429) return 'Limite de chamadas simultâneas atingido.';
  if (status === 503) return 'Nenhum WhatsApp disponível para chamadas.';
  if (status >= 500) return 'Serviço de chamadas indisponível. Tente novamente.';
  return 'Não foi possível completar a ação no serviço de chamadas.';
}

export const waCallsService = {
  /** Contas WhatsApp conhecidas pelo WaCalls. */
  async getSessions(): Promise<WaCallsSession[]> {
    const data = await request<{ sessions: WaCallsSession[] }>('/api/sessions');
    return data?.sessions ?? [];
  },

  /**
   * Abre a chamada de saída. `phone` já vem em dígitos (ver `wacalls/phone`).
   *
   * `duration_ms` é o teto que o cliente oficial manda (5 min) e `record` fica
   * desligado — o escritório não grava áudio de ligação. Devolve o `callId`,
   * que é a chave de tudo daqui para a frente.
   */
  async startCall(sessionId: string, phone: string, options?: { durationMs?: number; record?: boolean }): Promise<string> {
    const data = await request<{ call: { callId: string } }>(`/api/sessions/${sessionId}/calls`, {
      method: 'POST',
      body: JSON.stringify({
        phone,
        duration_ms: options?.durationMs ?? 300_000,
        record: options?.record ?? false,
      }),
    });
    const callId = data?.call?.callId;
    if (!callId) throw new WaCallsError('O serviço de chamadas não devolveu a chamada.', null);
    return callId;
  },

  /** Aceita uma chamada recebida e reivindica a posse dela para esta aba. */
  async acceptCall(sessionId: string, callId: string): Promise<string> {
    const data = await request<{ call: { callId: string } }>(
      `/api/sessions/${sessionId}/calls/${callId}/accept`,
      { method: 'POST', body: '{}' },
    );
    return data?.call?.callId ?? callId;
  },

  /** Recusa a chamada recebida. */
  async rejectCall(sessionId: string, callId: string): Promise<void> {
    await request(`/api/sessions/${sessionId}/calls/${callId}/reject`, { method: 'POST', body: '{}' });
  },

  /** Encerra a chamada no servidor. O cleanup local é do callStore. */
  async endCall(sessionId: string, callId: string): Promise<void> {
    await request(`/api/sessions/${sessionId}/calls/${callId}`, { method: 'DELETE' });
  },

  /** Troca de SDP: manda a oferta do navegador, recebe a resposta da ponte Go. */
  async negotiateWebRTC(sessionId: string, callId: string, sdpOffer: string): Promise<string> {
    const data = await request<{ sdp_answer: string }>(
      `/api/sessions/${sessionId}/calls/${callId}/webrtc`,
      { method: 'POST', body: JSON.stringify({ sdp_offer: sdpOffer }) },
    );
    const answer = data?.sdp_answer;
    if (!answer) throw new WaCallsError('Falha na negociação de áudio.', null);
    return answer;
  },

  /** Histórico recente da conta. Ainda sem tela — o serviço já responde. */
  async getHistory(sessionId: string, limit = 50): Promise<WaCallsHistoryRow[]> {
    const data = await request<{ rows: WaCallsHistoryRow[] }>(
      `/api/sessions/${sessionId}/history?limit=${limit}`,
    );
    return data?.rows ?? [];
  },

  /**
   * Abre a escuta de eventos. UMA por aba — quem chama é o callStore, e é ele
   * que distribui para a UI.
   *
   * O `EventSource` já reconecta sozinho; não montamos laço de retentativa por
   * cima disso. `onError` serve só para a UI saber que o serviço oscilou.
   */
  connectEvents(handlers: {
    onEvent: (event: WaCallsEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  }): () => void {
    const source = new EventSource(
      url(`/api/events?clientId=${encodeURIComponent(getWaCallsClientId())}`),
    );
    source.onopen = () => handlers.onOpen?.();
    source.onmessage = (message: MessageEvent<string>) => {
      try {
        handlers.onEvent(JSON.parse(message.data) as WaCallsEvent);
      } catch {
        // Evento malformado não pode derrubar a escuta.
      }
    };
    source.onerror = () => handlers.onError?.();
    return () => source.close();
  },
};

export type { WaCallsSession, WaCallsHistoryRow, WaCallsEvent } from './wacalls/types';
export type { WaCall, WaCallPhase, WaCallContact } from './wacalls/types';
