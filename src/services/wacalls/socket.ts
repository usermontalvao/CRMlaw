// O ÚNICO canal vivo entre o navegador e o Jurius Call.
//
// Ele carrega duas coisas por dentro do MESMO WebSocket que o Cloudflare já
// publica em `call.jurius-api.com`: sinalização (texto JSON) e mídia (quadros
// binários). Não há WebRTC, ICE, STUN ou TURN entre o navegador e o servidor —
// era exatamente aí que a ligação ficava muda quando o container anunciava o IP
// da rede interna do Docker.
//
// Áudio e vídeo NUNCA viajam como JSON/base64: um quadro de 60 ms em base64
// custaria 33% a mais de banda e uma volta de parser a cada 60 ms.
import { CALL_BASE_URL, CALL_TOKEN, getWaCallsClientId, waCallsLog } from './config';

/** Áudio PCM 16 kHz mono, Int16 little-endian. */
export const KIND_AUDIO = 1;
/** Unidade de acesso H.264 Annex-B completa (com start codes). */
export const KIND_VIDEO = 2;

/**
 * Cabeçalho de todo quadro binário: `[kind, flags, orientation, reservado]`.
 *
 * Quatro bytes de propósito. O áudio começa num deslocamento múltiplo de 2, que
 * é o que `new Int16Array(buffer, 4)` exige — com 1 ou 3 bytes o navegador
 * lançaria em cada quadro.
 */
const HEADER = 4;
/** Bit 0 de `flags`: a unidade de vídeo é keyframe. */
const FLAG_KEYFRAME = 1;

/** Um quadro de mídia já separado do cabeçalho. */
export interface MediaFrame {
  kind: number;
  keyframe: boolean;
  orientation: number;
  body: ArrayBuffer;
}

type EventListener = (event: Record<string, unknown>) => void;
type MediaListener = (frame: MediaFrame) => void;

let socket: WebSocket | null = null;
let desired = false;
let attachedCall: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

const eventListeners = new Set<EventListener>();
const mediaListeners = new Set<MediaListener>();
const openListeners = new Set<() => void>();
const closeListeners = new Set<() => void>();

function wsUrl(): string {
  const base = CALL_BASE_URL.replace(/^http/, 'ws');
  const params = new URLSearchParams({ clientId: getWaCallsClientId() });
  if (CALL_TOKEN) params.set('token', CALL_TOKEN);
  return `${base}/ws?${params.toString()}`;
}

function scheduleReconnect(): void {
  if (!desired || reconnectTimer !== null) return;
  // Degraus curtos no começo (a queda mais comum é um deploy de segundos) e
  // teto de 15 s para não martelar o servidor quando ele está mesmo fora.
  const espera = Math.min(15000, 500 * 2 ** Math.min(attempt, 5));
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, espera);
}

function open(): void {
  if (!desired || socket) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch (err) {
    waCallsLog('não foi possível abrir o socket', err);
    scheduleReconnect();
    return;
  }
  ws.binaryType = 'arraybuffer';
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    waCallsLog('socket aberto');
    // Recarregar a página ou cair a rede não pode custar o áudio da ligação em
    // curso: o acoplamento é refeito assim que a conexão volta.
    if (attachedCall) sendJson({ type: 'attach', callId: attachedCall });
    openListeners.forEach(fn => fn());
  };

  ws.onmessage = (message: MessageEvent<string | ArrayBuffer>) => {
    if (typeof message.data === 'string') {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(message.data) as Record<string, unknown>;
      } catch {
        return; // Um quadro malformado não pode derrubar a escuta.
      }
      eventListeners.forEach(fn => fn(parsed));
      return;
    }
    if (!(message.data instanceof ArrayBuffer) || message.data.byteLength <= HEADER) return;
    const head = new Uint8Array(message.data, 0, HEADER);
    const frame: MediaFrame = {
      kind: head[0],
      keyframe: (head[1] & FLAG_KEYFRAME) !== 0,
      orientation: head[2],
      body: message.data.slice(HEADER),
    };
    mediaListeners.forEach(fn => fn(frame));
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    waCallsLog('socket fechado');
    closeListeners.forEach(fn => fn());
    scheduleReconnect();
  };

  ws.onerror = () => {
    // O `onclose` vem logo atrás e é lá que a reconexão é agendada.
  };
}

function sendJson(payload: Record<string, unknown>): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

export const callSocket = {
  /** Liga o canal. Idempotente: chamar duas vezes não abre dois sockets. */
  start(): void {
    desired = true;
    open();
  },

  /** Desliga de vez (nenhuma reconexão). */
  stop(): void {
    desired = false;
    attachedCall = null;
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { socket?.close(); } catch { /* já fechado */ }
    socket = null;
  },

  isOpen(): boolean {
    return socket?.readyState === WebSocket.OPEN;
  },

  /**
   * Passa a receber (e a poder mandar) a mídia desta chamada. O servidor só
   * entrega áudio e vídeo a quem está acoplado — voz de uma ligação não vaza
   * para a aba que não a atende.
   */
  attach(callId: string): void {
    attachedCall = callId;
    sendJson({ type: 'attach', callId });
  },

  /** Solta a chamada, sem fechar o canal (a sinalização continua chegando). */
  detach(callId?: string): void {
    if (callId && attachedCall !== callId) return;
    attachedCall = null;
    sendJson({ type: 'detach' });
  },

  attachedCallId(): string | null {
    return attachedCall;
  },

  /** Um quadro de microfone: PCM Int16 LE, exatamente 960 amostras. */
  sendAudio(pcm: ArrayBuffer): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const quadro = new Uint8Array(HEADER + pcm.byteLength);
    quadro[0] = KIND_AUDIO;
    quadro.set(new Uint8Array(pcm), HEADER);
    socket.send(quadro);
  },

  /** Uma unidade de acesso H.264 Annex-B completa, já codificada pela câmera. */
  sendVideo(au: Uint8Array, keyframe: boolean): void {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const quadro = new Uint8Array(HEADER + au.byteLength);
    quadro[0] = KIND_VIDEO;
    quadro[1] = keyframe ? FLAG_KEYFRAME : 0;
    quadro.set(au, HEADER);
    socket.send(quadro);
  },

  onEvent(fn: EventListener): () => void {
    eventListeners.add(fn);
    return () => { eventListeners.delete(fn); };
  },

  onMedia(fn: MediaListener): () => void {
    mediaListeners.add(fn);
    return () => { mediaListeners.delete(fn); };
  },

  onOpen(fn: () => void): () => void {
    openListeners.add(fn);
    return () => { openListeners.delete(fn); };
  },

  onClose(fn: () => void): () => void {
    closeListeners.add(fn);
    return () => { closeListeners.delete(fn); };
  },
};
