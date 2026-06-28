// Detecção PURA de "canal fora" (desconectado/reconectando). Isolada sem imports
// para ser testável e compartilhada entre o serviço resiliente (frontend) e — em
// espírito — o whatsapp-scheduler (que replica a mesma regra em Deno).
//
// Regra crítica: uma mensagem só entra na auto-fila por reconexão quando o erro
// vem desse estado. A detecção primária é a flag estruturada `reconnect_pending`
// devolvida pelo evolution-send; o casamento por texto é só fallback de
// compatibilidade enquanto o edge não é redeployado.

// Espelha as mensagens que o evolution-send devolve quando o canal não está pronto.
export const RECONNECT_TEXT_HINTS = [
  'canal desconectado',
  'reconectando automaticamente',
  'aguarde alguns segundos',
  'não reconectou sozinho',
];

/** True quando o erro indica canal desconectado/reconectando (mensagem deve ir para a fila). */
export function isReconnectPendingError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const anyErr = err as { reconnectPending?: boolean; body?: { reconnect_pending?: boolean } };
    if (anyErr.reconnectPending === true || anyErr.body?.reconnect_pending === true) return true;
  }
  const msg = err instanceof Error ? err.message : String(err || '');
  const lower = msg.toLowerCase();
  return RECONNECT_TEXT_HINTS.some(h => lower.includes(h));
}
