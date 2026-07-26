const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

type RelativeTimeUnit = {
  milliseconds: number;
  singular: string;
  plural: string;
};

function parseTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unitForElapsed(elapsedMs: number): RelativeTimeUnit {
  if (elapsedMs < MINUTE_MS) {
    return { milliseconds: SECOND_MS, singular: 'segundo', plural: 'segundos' };
  }
  if (elapsedMs < HOUR_MS) {
    return { milliseconds: MINUTE_MS, singular: 'minuto', plural: 'minutos' };
  }
  if (elapsedMs < DAY_MS) {
    return { milliseconds: HOUR_MS, singular: 'hora', plural: 'horas' };
  }
  if (elapsedMs < MONTH_MS) {
    return { milliseconds: DAY_MS, singular: 'dia', plural: 'dias' };
  }
  if (elapsedMs < YEAR_MS) {
    return { milliseconds: MONTH_MS, singular: 'mês', plural: 'meses' };
  }
  return { milliseconds: YEAR_MS, singular: 'ano', plural: 'anos' };
}

/**
 * Formata uma data passada como tempo decorrido em português.
 * Meses e anos usam durações médias de 30 e 365 dias, respectivamente.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now = Date.now(),
): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return '—';

  const elapsedMs = Math.max(0, now - timestamp);
  if (elapsedMs < SECOND_MS) return 'agora';

  const unit = unitForElapsed(elapsedMs);
  const amount = Math.floor(elapsedMs / unit.milliseconds);
  return `há ${amount} ${amount === 1 ? unit.singular : unit.plural}`;
}

/**
 * Informa quando o rótulo relativo poderá mudar. O limite de um dia evita
 * timers longos demais e também corrige mudanças de relógio/fuso do sistema.
 */
export function relativeTimeRefreshDelay(
  value: string | Date | null | undefined,
  now = Date.now(),
): number | null {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return null;

  const elapsedMs = Math.max(0, now - timestamp);
  const unit = unitForElapsed(elapsedMs);
  const untilNextUnit = unit.milliseconds - (elapsedMs % unit.milliseconds);

  return Math.min(DAY_MS, Math.max(250, untilNextUnit + 50));
}
