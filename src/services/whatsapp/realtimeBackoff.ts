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
