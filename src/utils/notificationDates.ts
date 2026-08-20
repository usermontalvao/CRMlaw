const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Interpreta datas sem fuso como datas locais. O construtor nativo trata
 * `YYYY-MM-DD` como UTC, o que pode deslocar o dia no fuso de Cuiabá.
 */
export const parseNotificationDate = (value: string): Date => {
  const raw = value.trim();

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const localDateTime = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/,
  );
  if (localDateTime) {
    return new Date(
      Number(localDateTime[1]),
      Number(localDateTime[2]) - 1,
      Number(localDateTime[3]),
      Number(localDateTime[4]),
      Number(localDateTime[5]),
      Number(localDateTime[6] ?? 0),
    );
  }

  return new Date(raw);
};

const calendarDayNumber = (date: Date) =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;

/** Positivo para o futuro, negativo para o passado e zero para hoje. */
export const getCalendarDayDifference = (value: string, now: Date = new Date()): number => {
  const date = parseNotificationDate(value);
  if (Number.isNaN(date.getTime())) return 0;
  return calendarDayNumber(date) - calendarDayNumber(now);
};

export const formatNotificationDate = (value: string, now: Date = new Date()): string => {
  const date = parseNotificationDate(value);
  if (Number.isNaN(date.getTime())) return '';

  const days = getCalendarDayDifference(value, now);
  if (days === 0) return 'Hoje';
  if (days === -1) return 'Ontem';
  if (days === 1) return 'Amanhã';
  if (days < 0 && days > -7) return `${Math.abs(days)}d atrás`;
  if (days > 0 && days < 7) return `Em ${days}d`;

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
};

/**
 * Itens futuros ficam do mais próximo para o mais distante; itens passados,
 * do mais recente para o mais antigo. A central mostra os futuros primeiro.
 */
export const compareNotificationDates = (a: string, b: string, now: Date = new Date()): number => {
  const aDate = parseNotificationDate(a);
  const bDate = parseNotificationDate(b);
  const aTime = aDate.getTime();
  const bTime = bDate.getTime();

  if (Number.isNaN(aTime)) return Number.isNaN(bTime) ? 0 : 1;
  if (Number.isNaN(bTime)) return -1;

  const nowTime = now.getTime();
  const aFuture = aTime >= nowTime;
  const bFuture = bTime >= nowTime;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  return aFuture ? aTime - bTime : bTime - aTime;
};
