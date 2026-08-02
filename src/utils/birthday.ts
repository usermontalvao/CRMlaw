// Atraso para o cadastro obrigatório da data de nascimento: o formulário não
// pode interromper o login. Ele aparece só depois que a pessoa já entrou e
// teve tempo de começar a trabalhar.
export const BIRTHDAY_GATE_DELAY_MS = 40_000;

// Atraso do convite ("chegou uma correspondência") no dia do aniversário.
export const BIRTHDAY_INVITE_DELAY_MS = 30_000;

export const BIRTHDAY_SESSION_KEY_PREFIX = 'crm-birthday-celebrated:';

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function parseIsoCalendarDate(value: string | null | undefined): CalendarDate | null {
  const match = String(value || '').match(ISO_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function validateBirthDate(
  value: string | null | undefined,
  today = new Date(),
): string | null {
  const parsed = parseIsoCalendarDate(value);
  if (!value) return 'Informe sua data de nascimento para continuar.';
  if (!parsed) return 'Informe uma data de nascimento válida.';

  const numericDate = parsed.year * 10_000 + parsed.month * 100 + parsed.day;
  const todayKey = getLocalDateKey(today).replace(/-/g, '');
  const numericToday = Number(todayKey);

  if (numericDate < 19_000_101) return 'A data de nascimento deve ser posterior a 01/01/1900.';
  if (numericDate > numericToday) return 'A data de nascimento não pode estar no futuro.';
  return null;
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function isBirthdayToday(
  birthDate: string | null | undefined,
  today = new Date(),
): boolean {
  const parsed = parseIsoCalendarDate(birthDate);
  if (!parsed) return false;

  const month = today.getMonth() + 1;
  const day = today.getDate();
  if (parsed.month === month && parsed.day === day) return true;

  // Nascidos em 29/02: em ano comum essa data não existe, e sem este caso a
  // pessoa só seria homenageada de quatro em quatro anos. Comemora em 28/02.
  if (parsed.month === 2 && parsed.day === 29 && month === 2 && day === 28) {
    return !isLeapYear(today.getFullYear());
  }

  return false;
}

/**
 * Janela de recuperação: quantos dias depois do aniversário a homenagem ainda
 * pode aparecer. Sem ela, a celebração só acontece se a pessoa logar no dia
 * exato — e aniversário em fim de semana, feriado ou férias passaria em branco,
 * silenciosamente. Sete dias cobrem esses casos sem soar atrasado demais.
 */
export const BIRTHDAY_CATCH_UP_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Data efetiva do aniversário num dado ano (29/02 vira 28/02 em ano comum). */
function occurrenceUtc(year: number, month: number, day: number): number {
  const effectiveDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return Date.UTC(year, month - 1, effectiveDay);
}

export type BirthdayOccurrence = {
  /** 0 = hoje; 1..N = quantos dias atrás foi o aniversário. */
  daysSince: number;
  /**
   * Ano DO ANIVERSÁRIO, que não é necessariamente o ano de hoje: quem nasceu
   * em 30/12 e só entra no sistema em 03/01 é homenageado pelo aniversário do
   * ano anterior. É este o ano gravado em celebrated_year — usar o ano de hoje
   * marcaria o aniversário seguinte como já comemorado.
   */
  occurrenceYear: number;
};

/** Aniversário de hoje ou dentro da janela de recuperação; null fora dela. */
export function getBirthdayOccurrence(
  birthDate: string | null | undefined,
  today = new Date(),
  windowDays = BIRTHDAY_CATCH_UP_DAYS,
): BirthdayOccurrence | null {
  const parsed = parseIsoCalendarDate(birthDate);
  if (!parsed) return null;

  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  // Ano corrente primeiro; se o aniversário ainda não chegou, o candidato é o
  // do ano passado (caso da virada de ano).
  for (const year of [today.getFullYear(), today.getFullYear() - 1]) {
    const occurrence = occurrenceUtc(year, parsed.month, parsed.day);
    if (occurrence > todayUtc) continue;
    const daysSince = Math.round((todayUtc - occurrence) / MS_PER_DAY);
    return daysSince <= windowDays ? { daysSince, occurrenceYear: year } : null;
  }

  return null;
}

export function canStartBirthdaySplash({
  birthdayToday,
  pinSetupResolved,
  pinModalOpen,
}: {
  birthdayToday: boolean;
  pinSetupResolved: boolean;
  pinModalOpen: boolean;
}): boolean {
  return birthdayToday && pinSetupResolved && !pinModalOpen;
}

/**
 * A celebração é única: uma vez aberta, o ano fica registrado no banco e ela
 * não volta a ser oferecida — nem em outra sessão, nem em outro dispositivo.
 */
export function canOfferBirthdayInvite({
  occurrence,
  pinSetupResolved,
  pinModalOpen,
  celebratedYear,
  isActive,
}: {
  occurrence: BirthdayOccurrence | null;
  pinSetupResolved: boolean;
  pinModalOpen: boolean;
  celebratedYear: number | null | undefined;
  /** Só colaborador ativo é homenageado — desligado nunca vê a celebração. */
  isActive: boolean;
}): boolean {
  if (!isActive || !occurrence) return false;
  if (!canStartBirthdaySplash({ birthdayToday: true, pinSetupResolved, pinModalOpen })) return false;
  return celebratedYear !== occurrence.occurrenceYear;
}

export function getBirthdaySessionKey(userId: string, today = new Date()): string {
  return `${BIRTHDAY_SESSION_KEY_PREFIX}${userId}:${getLocalDateKey(today)}`;
}

export function getFirstName(name: string | null | undefined): string {
  return String(name || '').trim().split(/\s+/)[0] || 'você';
}

export function getInitials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Idade completa no dia de hoje (retorna null se a data for inválida). */
export function getAge(birthDate: string | null | undefined, today = new Date()): number | null {
  const parsed = parseIsoCalendarDate(birthDate);
  if (!parsed) return null;

  let age = today.getFullYear() - parsed.year;
  const monthDiff = today.getMonth() + 1 - parsed.month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.day)) age -= 1;
  return age >= 0 ? age : null;
}

/** "30 de julho" — usado nas legendas do vídeo. */
export function formatDayAndMonth(birthDate: string | null | undefined): string {
  const parsed = parseIsoCalendarDate(birthDate);
  if (!parsed) return '';
  return `${parsed.day} de ${MONTH_NAMES_PT[parsed.month - 1]}`;
}

/**
 * "?aniversariodenovo=1" — destrava a experiência para poder rever.
 *
 * Existe porque a trava de "já vi" mora no sessionStorage do navegador: zerar
 * o banco não a desfaz, e sem isso a única saída era abrir o console. Também
 * encurta o atraso do aviso, para não esperar 30 s a cada tentativa.
 */
export const BIRTHDAY_REPLAY_PARAM = 'aniversariodenovo';
export const BIRTHDAY_REPLAY_DELAY_MS = 3_000;

export function isBirthdayReplayRequested(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).has(BIRTHDAY_REPLAY_PARAM);
}

export function clearBirthdayCelebrationSession(): void {
  if (typeof window === 'undefined') return;

  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(BIRTHDAY_SESSION_KEY_PREFIX)) {
      window.sessionStorage.removeItem(key);
    }
  }
}
