/**
 * Fuso-âncora do escritório.
 *
 * Um compromisso pertence ao fuso do foro, não ao fuso de quem digita. Uma
 * audiência às 14:00 em Cuiabá é 14:00 em Cuiabá — esteja o advogado em Cuiabá,
 * em Bern ou em Tóquio.
 *
 * Antes desta camada, `calendar.service` carimbava o horário digitado com o
 * offset do NAVEGADOR (`getTimezoneOffset()`). Quem cadastrasse um compromisso
 * de fora do país gravava, sem perceber, um instante deslocado: "14:00" digitado
 * na Suíça virava 08:00 em Cuiabá, e um evento de dia inteiro (00:00) pulava
 * para as 18:00 do dia anterior.
 *
 * Este módulo é intencionalmente livre de imports — é a camada mais baixa e
 * precisa rodar tanto no app quanto nos testes de `node --test`.
 */

/**
 * Fuso do escritório. Ponto único de troca: quando `preferences.timezone`
 * (Configurações › Preferências) for de fato aplicado, basta alimentar
 * `setOfficeTimeZone()` na inicialização do app.
 */
const DEFAULT_OFFICE_TIME_ZONE = 'America/Cuiaba';

let officeTimeZone = DEFAULT_OFFICE_TIME_ZONE;

export const getOfficeTimeZone = (): string => officeTimeZone;

/** Troca o fuso-âncora em runtime. Ignora valores inválidos e mantém o anterior. */
export const setOfficeTimeZone = (timeZone?: string | null): void => {
  if (!timeZone) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    officeTimeZone = timeZone;
  } catch {
    // Fuso inválido (IANA desconhecido): mantém o que já estava valendo.
  }
};

export const getPartsInTimeZone = (instant: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const bag: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }

  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
};

/** Offset do escritório, em minutos, vigente NO instante informado. */
const offsetMinutesAtInstant = (instant: Date): number => {
  const p = getPartsInTimeZone(instant, officeTimeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - instant.getTime()) / 60000);
};

/**
 * Offset do escritório vigente para uma HORA DE PAREDE (ex: "2026-11-14T00:00").
 *
 * Cuiabá é -04:00 fixo desde 2019, mas a conta é feita de forma genérica para
 * que trocar o fuso-âncora por um com horário de verão continue correto. A
 * segunda passada refina o palpite inicial perto das transições de DST.
 */
const offsetMinutesForWallTime = (wallTime: string): number => {
  const base = Date.parse(`${wallTime}Z`);
  if (Number.isNaN(base)) return 0;
  const firstGuess = offsetMinutesAtInstant(new Date(base));
  return offsetMinutesAtInstant(new Date(base - firstGuess * 60000));
};

const formatOffset = (minutes: number): string => {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
};

/** Já traz fuso explícito (Z, +hh:mm ou -hh:mm) depois do horário? */
export const hasExplicitOffset = (value: string): boolean =>
  /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());

/** "2026-07-29T14:00" ou "2026-07-29T14:00:00" → normaliza para segundos. */
const normalizeWallTime = (value: string): string | null => {
  const trimmed = value.trim().replace(' ', 'T');
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(trimmed);
  if (!match) return null;
  const [, date, hour = '00', minute = '00', second = '00'] = match;
  return `${date}T${hour}:${minute}:${second}`;
};

/**
 * Converte a data/hora digitada pelo usuário (sem fuso) em um timestamp
 * ancorado no fuso do escritório.
 *
 *   toOfficeTimestamp('2026-07-29T14:00')  → '2026-07-29T14:00:00-04:00'
 *   toOfficeTimestamp('2026-07-29T00:00')  → '2026-07-29T00:00:00-04:00'
 *
 * Strings que já vêm com fuso explícito são devolvidas intactas: o chamador já
 * sabia qual instante queria.
 */
export const toOfficeTimestamp = (value: string): string => {
  if (!value) return value;
  if (hasExplicitOffset(value)) return value;

  const wallTime = normalizeWallTime(value);
  if (!wallTime) return value;

  return `${wallTime}${formatOffset(offsetMinutesForWallTime(wallTime))}`;
};

/**
 * Soma minutos a uma hora de parede e devolve outra hora de parede — usado para
 * derivar `end_at` a partir de `start_at` sem passar pelo fuso do navegador.
 *
 *   addMinutesToWallTime('2026-07-29T14:00', 120) → '2026-07-29T16:00:00'
 */
export const addMinutesToWallTime = (value: string, minutes: number): string => {
  const wallTime = normalizeWallTime(value);
  if (!wallTime) return value;
  const shifted = new Date(Date.parse(`${wallTime}Z`) + minutes * 60000);
  const p = getPartsInTimeZone(shifted, 'UTC');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
};

export type OfficeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Componentes de um instante já traduzidos para o fuso do escritório. */
export const getOfficeParts = (value: string | Date | null | undefined): OfficeParts | null => {
  if (!value) return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return getPartsInTimeZone(instant, officeTimeZone);
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "29/07/2026" no fuso do escritório. */
export const formatOfficeDate = (value: string | Date | null | undefined): string => {
  const p = getOfficeParts(value);
  return p ? `${pad2(p.day)}/${pad2(p.month)}/${p.year}` : '';
};

/** "14:00" no fuso do escritório. */
export const formatOfficeTime = (value: string | Date | null | undefined): string => {
  const p = getOfficeParts(value);
  return p ? `${pad2(p.hour)}:${pad2(p.minute)}` : '';
};

/** "29/07/2026 às 14:00" no fuso do escritório. */
export const formatOfficeDateTime = (value: string | Date | null | undefined): string => {
  const p = getOfficeParts(value);
  return p ? `${pad2(p.day)}/${pad2(p.month)}/${p.year} às ${pad2(p.hour)}:${pad2(p.minute)}` : '';
};

/** "2026-07-29" no fuso do escritório — chave estável para agrupar por dia. */
export const toOfficeDateKey = (value: string | Date | null | undefined): string => {
  const p = getOfficeParts(value);
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : '';
};

/** "2026-07-29T14:00" no fuso do escritório — chave de minuto para deduplicação. */
export const toOfficeMinuteKey = (value: string | Date | null | undefined): string => {
  const p = getOfficeParts(value);
  return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}` : '';
};

/** O evento tem hora marcada, ou é de dia inteiro? Avaliado no fuso do escritório. */
export const isOfficeMidnight = (value: string | Date | null | undefined): boolean => {
  const p = getOfficeParts(value);
  return !!p && p.hour === 0 && p.minute === 0;
};

/** Data de hoje no fuso do escritório, como "2026-07-29". */
export const officeTodayKey = (): string => toOfficeDateKey(new Date());

/**
 * O `Date` que representa a meia-noite (hora de parede) de um dia do escritório.
 * Use para comparações de intervalo — o instante devolvido é absoluto e correto
 * em qualquer navegador.
 */
export const officeDayStart = (dateKey: string): Date =>
  new Date(toOfficeTimestamp(`${dateKey}T00:00:00`));

/**
 * O usuário está com o relógio fora do fuso do escritório? Serve para avisar na
 * interface que os horários exibidos são os do foro, não os do relógio local.
 */
export const isBrowserOutsideOfficeZone = (): boolean => {
  const now = new Date();
  return offsetMinutesAtInstant(now) !== -now.getTimezoneOffset();
};

/** Rótulo curto do fuso do navegador, ex: "Europe/Zurich (+02:00)". */
export const describeBrowserZone = (): string => {
  const now = new Date();
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    zone = '';
  }
  return `${zone ? `${zone} ` : ''}(${formatOffset(-now.getTimezoneOffset())})`;
};

/** Rótulo curto do fuso do escritório, ex: "America/Cuiaba (-04:00)". */
export const describeOfficeZone = (): string =>
  `${officeTimeZone} (${formatOffset(offsetMinutesAtInstant(new Date()))})`;

/** Fuso IANA do navegador. `local` é o fallback aceito pelo FullCalendar. */
export const getBrowserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
};

/**
 * Converte uma data/hora digitada no relógio local do usuário em um instante
 * absoluto. Assim, "14:00" digitado em Zurique é armazenado como 12:00Z no
 * verão e será exibido como 08:00 para alguém em Cuiabá.
 */
export const toBrowserTimestamp = (value: string): string => {
  if (!value || hasExplicitOffset(value)) return value;
  const wallTime = normalizeWallTime(value);
  if (!wallTime) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wallTime);
  if (!match) return value;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
};

export const formatBrowserDateTime = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(instant);
};

export const formatBrowserDate = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? '' : instant.toLocaleDateString('pt-BR');
};

export const formatBrowserTime = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime())
    ? ''
    : instant.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

export const isBrowserMidnight = (value: string | Date | null | undefined): boolean => {
  if (!value) return false;
  const instant = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(instant.getTime()) && instant.getHours() === 0 && instant.getMinutes() === 0;
};
