/**
 * Janela anti-spam da mensagem automática fora do horário.
 *
 * A marca pertence à conversa e sobrevive ao encerramento/reabertura. Assim,
 * uma nova mensagem do mesmo cliente poucos minutos depois não recebe o mesmo
 * comunicado novamente.
 */
export const ABSENCE_COOLDOWN_HOURS = 12;
export const ABSENCE_COOLDOWN_MS = ABSENCE_COOLDOWN_HOURS * 60 * 60 * 1_000;

export function isAbsenceCooldownActive(
  lastSentAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastSentAt) return false;
  const sentAtMs = Date.parse(lastSentAt);
  if (!Number.isFinite(sentAtMs)) return false;
  return nowMs - sentAtMs < ABSENCE_COOLDOWN_MS;
}

export function absenceCooldownCutoff(nowMs = Date.now()): string {
  return new Date(nowMs - ABSENCE_COOLDOWN_MS).toISOString();
}
