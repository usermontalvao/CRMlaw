// Política de reconexão do canal realtime do WhatsApp. Isolada, sem imports,
// para ser testável (o resto da camada de realtime depende do cliente Supabase).

/** Teto do backoff: acima disso não adianta esperar mais para tentar de novo. */
export const REALTIME_RETRY_CEILING_MS = 30_000;

/**
 * Espera antes da tentativa `attempt` (0 = primeira falha). Exponencial a partir
 * de 1s, com teto — rápido o bastante para o atendente não perceber a queda, e
 * espaçado o bastante para não martelar o servidor quando a rede está fora.
 */
export function realtimeRetryDelay(attempt: number): number {
  const safe = Math.max(0, Math.floor(attempt));
  return Math.min(REALTIME_RETRY_CEILING_MS, 1000 * 2 ** safe);
}

/** Estados do canal que significam "não estou mais recebendo eventos". */
export const REALTIME_DEAD_STATUS = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'] as const;

export function isRealtimeDeadStatus(status: string): boolean {
  return (REALTIME_DEAD_STATUS as readonly string[]).includes(status);
}

/** O que fazer com um evento de status vindo de um canal. */
export type RealtimeChannelAction =
  /** Canal no ar: anuncia 'live' e zera o backoff. */
  | 'live'
  /** Canal fora: anuncia 'down' e agenda uma reabertura. */
  | 'down-and-retry'
  /** Evento de um canal que não manda mais nada — descartar em silêncio. */
  | 'ignore';

/**
 * Decide o destino de um evento de status. Existe por causa de uma armadilha
 * concreta: `supabase.removeChannel` faz o canal removido reportar CLOSED, que
 * é indistinguível de uma queda de verdade se olharmos só para o texto do
 * status. Como quem remove canais é a própria rotina de reconexão, tratar esse
 * CLOSED como queda fazia cada tentativa de reconexão provocar a seguinte — um
 * laço que nunca assenta, com o indicador do topo piscando entre "Online" e
 * "Reconectando…" e sockets sendo abertos e fechados por baixo.
 *
 * A saída é numerar os canais: quem fala precisa ser o canal atual. Um canal já
 * aposentado (geração antiga) não tem mais voz, diga o que disser.
 */
export function resolveChannelStatus(
  status: string,
  ctx: { fromGeneration: number; currentGeneration: number; disposed: boolean },
): RealtimeChannelAction {
  if (ctx.disposed) return 'ignore';
  if (ctx.fromGeneration !== ctx.currentGeneration) return 'ignore';
  if (status === 'SUBSCRIBED') return 'live';
  if (isRealtimeDeadStatus(status)) return 'down-and-retry';
  // Estados intermediários ('joining' e afins) não são notícia: nem chegou, nem
  // caiu. Anunciar qualquer um deles seria outra fonte de piscada.
  return 'ignore';
}
