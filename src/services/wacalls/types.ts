// Tipos do subsistema de chamadas do CRM.
//
// Estas formas são as que o `callStore` fala. Elas NÃO são mais o que o
// servidor publica: o motor virou o Jurius Call (Rust/whatsapp-rust), e a
// tradução do que ele manda para o que está aqui acontece em
// `wacalls.service.ts` — um lugar só, para o store não ter de saber de dois
// vocabulários.
import type { CallDegree, CallRoute } from './callRouting';

/** Estado da conexão da conta WhatsApp no serviço de chamadas. */
export type WaCallsSessionState = 'connecting' | 'qr' | 'open' | 'logged_out';

export interface WaCallsSession {
  id: string;
  name: string;
  jid: string;
  /**
   * O telefone da conta, quando o serviço informa. É por ELE que a conta de voz
   * encontra o canal do CRM (ver `callLine.ts`) — os dois mundos não têm id em
   * comum. Nulo quando o serviço não soube dizer; aí o JID é a fonte.
   */
  phone: string | null;
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

/** Eventos que o store consome (traduzidos do WebSocket em `wacalls.service`). */
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
  | { type: 'incoming-claimed'; sessionId: string; id: string; owner: string }
  /**
   * Estado do vídeo da chamada. Separado do `call-status` porque as duas coisas
   * mudam em ritmos diferentes: a câmera vai e volta várias vezes dentro de uma
   * chamada que continua no mesmo estado.
   */
  | { type: 'call-video'; sessionId: string; id: string; videoOn: boolean; peerVideo: boolean };

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
  /**
   * Telefone em dígitos (55 + DDD + número). Fica VAZIO quando o convite chegou
   * endereçado só por LID e o CRM não tem mapeamento para o número real — é
   * assim que a tela sabe que não deve mostrar (nem discar) coisa nenhuma.
   */
  phone: string;
  /**
   * O apelido interno do WhatsApp (`<n>@lid`) desta chamada, quando ela chegou
   * por ele. NUNCA é telefone: existe para procurar o mapeamento, para o
   * diagnóstico e para o cartão explicar por que o número não apareceu.
   */
  lid: string | null;
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
  /**
   * Para quem esta chamada toca (ver `callRouting`). `null` enquanto o CRM
   * ainda está descobrindo de quem é a conversa — nesse intervalo o cartão
   * aparece calado, e o som entra assim que a decisão chega.
   */
  route: CallRoute | null;
  /**
   * A escada de atendimento desta chamada (ver `callRouting`), guardada aqui
   * para o aviso de perdida saber de quem ela é sem refazer as consultas
   * depois que o telefone já parou de tocar.
   */
  ladder?: CallDegree[];
  /**
   * A NOSSA câmera está no ar. Ela entra por dois caminhos: a chamada NASCE em
   * vídeo (o botão de câmera; o vídeo vai na própria oferta e o telefone do
   * contato toca como vídeo) ou uma chamada de voz em curso é promovida no
   * meio (o upgrade). Ver `callStore.startVideo`.
   */
  videoOn: boolean;
  /** O outro lado está mandando vídeo. */
  peerVideo: boolean;
  /**
   * Esta chamada foi de VÍDEO em algum momento. Pegajosa: a câmera pode entrar
   * e sair, e o registro (que só nasce quando a chamada acaba) precisa saber o
   * que ela foi — senão a ligação de vídeo vira "Chamada de voz" na conversa e
   * na ficha do cliente.
   */
  wasVideo: boolean;
  /** Gravando AGORA (o operador ligou a gravação). */
  recording: boolean;
  /** Esta chamada já produziu uma gravação — só uma por chamada. */
  recorded: boolean;
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
