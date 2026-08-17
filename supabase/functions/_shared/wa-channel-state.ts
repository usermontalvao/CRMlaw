// O estado do canal com memória — e por que ele precisa de uma.
//
// A Evolution reporta o socket, não o serviço. Um canal cuja sessão está sendo
// disputada (a mesma conta de WhatsApp logada em outro cliente) devolve
// `open`, `close` e `connecting` alternados no intervalo de um segundo, enquanto
// as mensagens continuam entrando e saindo. Lendo esse estado cru:
//   · a inbox jogava o modal "esta conversa não vai enviar" em cima do atendente
//     de segundo em segundo, num canal que estava entregando;
//   · cada evento virava um UPDATE em whatsapp_instances (700+/hora no mesmo
//     registro), com o Realtime replicando tudo isso para todo mundo aberto.
//
// A regra aqui é uma histerese simples: sobe na hora, desce com carência.
// Ver `open` marca conectado imediatamente (voltar tem de ser instantâneo);
// ver qualquer outra coisa só derruba o status se já faz um tempo que o canal
// não é visto aberto. Piscada não muda nada — e, não mudando nada, não escreve.
//
// Módulo SEM imports de propósito: roda igual no Deno das Edge Functions e no
// `node --test` deste repositório (ver wa-channel-state.test.ts).

/** Quanto tempo depois do último `open` uma leitura ruim ainda é piscada. */
export const CHANNEL_FLAP_GRACE_MS = 3 * 60_000;

/** Intervalo mínimo entre dois carimbos de `last_open_at` (evita escrita à toa). */
export const CHANNEL_OPEN_TOUCH_MS = 60_000;

export type WaChannelStatus = 'connected' | 'connecting' | 'disconnected';

/** Estado cru da Evolution → o vocabulário do CRM. */
export function mapWaState(state: string | null | undefined): WaChannelStatus {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  return 'disconnected';
}

export interface ChannelStateInput {
  /** Estado cru vindo da Evolution ('open' | 'connecting' | 'close' | ...). */
  raw: string | null | undefined;
  /** Status guardado hoje em whatsapp_instances. */
  current: string | null | undefined;
  /** ISO do último `open` observado (whatsapp_instances.last_open_at). */
  lastOpenAt: string | null | undefined;
  now?: number;
}

export interface ChannelStateDecision {
  /** O status que deve valer para o CRM depois deste evento. */
  status: WaChannelStatus;
  /** A Evolution disse `open` agora. */
  open: boolean;
  /** O canal foi visto aberto há pouco — leitura ruim é piscada, não queda. */
  withinGrace: boolean;
  /** Carimbar `last_open_at = agora`. */
  touchLastOpen: boolean;
  /** Há algo de fato para gravar (sem isto, o evento é descartado). */
  write: boolean;
}

/**
 * Decide o status do canal a partir de UMA leitura, com a memória do último
 * `open`. Pura de propósito: é a regra que os testes vigiam.
 */
export function decideChannelState(input: ChannelStateInput): ChannelStateDecision {
  const now = input.now ?? Date.now();
  const observed = mapWaState(input.raw);
  const lastOpen = input.lastOpenAt ? Date.parse(input.lastOpenAt) : NaN;
  const sinceOpen = Number.isNaN(lastOpen) ? Infinity : now - lastOpen;

  if (observed === 'connected') {
    // Sobe na hora. `last_open_at` só é recarimbado de tempos em tempos: numa
    // instância que oscila, carimbar todo `open` traria a enxurrada de volta.
    const touchLastOpen = sinceOpen >= CHANNEL_OPEN_TOUCH_MS;
    return {
      status: 'connected',
      open: true,
      withinGrace: true,
      touchLastOpen,
      write: touchLastOpen || input.current !== 'connected',
    };
  }

  const withinGrace = sinceOpen < CHANNEL_FLAP_GRACE_MS;
  // Dentro da carência E já dado como conectado: é o socket respirando. Nada muda.
  if (withinGrace && input.current === 'connected') {
    return { status: 'connected', open: false, withinGrace: true, touchLastOpen: false, write: false };
  }
  return {
    status: observed,
    open: false,
    withinGrace,
    touchLastOpen: false,
    write: input.current !== observed,
  };
}

export interface ChannelRow {
  id: string;
  status?: string | null;
  last_open_at?: string | null;
  connected_at?: string | null;
}

/**
 * Aplica a decisão em whatsapp_instances — gravando SÓ quando há mudança.
 *
 * `admin` é o client de service role (tipado solto de propósito: este módulo não
 * importa o supabase-js para continuar testável fora do Deno).
 */
export async function applyChannelState(
  admin: { from: (t: string) => any },
  channel: ChannelRow,
  raw: string | null | undefined,
  now: number = Date.now(),
): Promise<ChannelStateDecision> {
  const decision = decideChannelState({
    raw, current: channel.status ?? null, lastOpenAt: channel.last_open_at ?? null, now,
  });
  if (!decision.write) return decision;

  const iso = new Date(now).toISOString();
  const patch: Record<string, unknown> = { status: decision.status, updated_at: iso };
  if (decision.touchLastOpen) patch.last_open_at = iso;
  // `connected_at` responde "conectado DESDE quando" — recarimbar a cada evento
  // apagaria justamente essa resposta.
  if (decision.status === 'connected' && channel.status !== 'connected') patch.connected_at = iso;
  if (decision.status !== 'connected' && channel.status === 'connected') patch.connected_at = null;

  await admin.from('whatsapp_instances').update(patch).eq('id', channel.id);
  return decision;
}

/**
 * O erro do envio diz "o socket não estava de pé" — e é o veredito mais honesto
 * que existe sobre o canal, melhor que qualquer estado consultado.
 *
 * Duas famílias, e a segunda foi a que escapou em 17/08/2026: além das frases do
 * Baileys ("Connection Closed"), a Evolution devolve o CÓDIGO CRU de fechamento
 * do WebSocket — um `1006` pelado, sem nenhuma palavra. Sem reconhecê-lo, a
 * mensagem do atendente virava falha definitiva em vez de ficar retida.
 */
export function isWaConnectionFailure(message: string | null | undefined): boolean {
  const bruto = String(message || '').replace(/^Error:\s*/i, '').trim();
  if (!bruto) return false;
  // Código de fechamento pelado (1006, 1005, 428, 408...): a Evolution só devolve
  // número sozinho quando o que caiu foi a conexão.
  if (/^\d{3,4}$/.test(bruto)) return true;
  const lower = bruto.toLowerCase();
  return lower.includes('connection closed')
    || lower.includes('connection lost')
    || lower.includes('connection terminated')
    || lower.includes('connection not open')
    || lower.includes('not connected')
    || lower.includes('no open session')
    || lower.includes('websocket')
    || lower.includes('socket closed')
    || lower.includes('stream errored')
    || lower.includes('timed out');
}
