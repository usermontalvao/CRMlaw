/** Comandos que reiniciam uma conversa com o Assistente de IA. */
export const WA_AI_RESET_COMMANDS = ['/clear', '/limpar', '/zerar', '/reiniciar', '/reset'] as const;

export function isWaAiResetCommand(value: unknown): boolean {
  const text = String(value ?? '').trim().toLowerCase();
  return WA_AI_RESET_COMMANDS.includes(text as (typeof WA_AI_RESET_COMMANDS)[number]);
}
