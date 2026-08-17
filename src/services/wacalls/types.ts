// Tipos do WaCalls — espelham o que o servidor Go publica em /api e no SSE.
// Nomes e formas vêm de `cmd/server/broker.go` e `cmd/server/httpapi.go` do
// repositório JotaDev66/WaCalls; mudar aqui sem mudar lá quebra em silêncio.

/** Estado da conexão da conta WhatsApp no WaCalls. */
export type WaCallsSessionState = 'connecting' | 'qr' | 'open' | 'logged_out';

export interface WaCallsSession {
  id: string;
  name: string;
  jid: string;
  state: WaCallsSessionState;
  paired: boolean;
}

/** Status que o servidor conhece. A UI tem estados a mais (ver WaCallPhase). */
export type WaCallsStatus = 'starting' | 'ringing' | 'connected' | 'ended';

export interface WaCallsHistoryRow {
  callId: string;
  peer: string;
  direction: string;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
}

/** Eventos do SSE (`GET /api/events`), todos no evento `message` padrão. */
export type WaCallsEvent =
  | { type: 'session-list'; sessions: WaCallsSession[] }
  | { type: 'session-qr'; sessionId: string; qr: string }
  | { type: 'auth-state'; sessionId: string; paired: boolean; state: WaCallsSessionState; qr?: string }
  | { type: 'call-list'; calls: WaCallsCallRow[] }
  | {
      type: 'call-status'; sessionId: string; id: string; owner: string | null;
      status: WaCallsStatus; peer: string; startedAt: number;
    }
  | { type: 'call-ended'; sessionId: string; id: string; owner: string | null; reason: string; endedAt: number }
  | { type: 'incoming'; sessionId: string; id: string; peer: string; offeredAt: number }
  | { type: 'incoming-claimed'; sessionId: string; id: string; owner: string };

export interface WaCallsCallRow {
  sessionId: string;
  callId: string;
  owner: string | null;
  direction: 'outbound' | 'inbound';
  peer: string;
  startedAt: number;
  status: WaCallsStatus;
  endedAt?: number;
  endReason?: string;
}

/**
 * Estados da chamada na tela. O servidor só conhece quatro; os outros três
 * existem porque a UI precisa dizer algo entre o clique e a primeira resposta
 * (PREPARING), enquanto desliga (ENDING) e quando nada deu certo (FAILED).
 */
export type WaCallPhase =
  | 'PREPARING' | 'CALLING' | 'RINGING' | 'ACTIVE' | 'ENDING' | 'ENDED' | 'FAILED';

/**
 * Uma chamada, modelada por `callId` — nunca como "a chamada do sistema".
 * O WaCalls aguenta várias ao mesmo tempo e o mesmo número pode ser usado por
 * vários operadores; o store guarda um Map e esta é a linha dele.
 */
export interface WaCall {
  callId: string;
  sessionId: string;
  direction: 'outbound' | 'inbound';
  phase: WaCallPhase;
  /** Telefone em dígitos (55 + DDD + número). */
  phone: string;
  /** Quem é do lado de lá, quando o CRM reconheceu o número. */
  contact: WaCallContact | null;
  /** `true` quando esta aba é a dona do áudio (ver clientId em config.ts). */
  mine: boolean;
  /** Início da chamada (ms) — o instante do convite, não o do atendimento. */
  startedAt: number;
  /** Instante em que virou ACTIVE; é daqui que o cronômetro conta. */
  connectedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  muted: boolean;
  /** Mensagem amigável quando a chamada falhou. */
  error: string | null;
}

/** O que o CRM sabe sobre o número da chamada. Tudo opcional: pode ser alguém novo. */
export interface WaCallContact {
  conversationId: string | null;
  clientId: string | null;
  name: string | null;
  avatarUrl: string | null;
}
