// Tempo decorrido em HORÁRIO ÚTIL.
//
// Todo o SLA do módulo media no relógio de parede. O efeito prático: a cliente
// que escreve 18h05 de sexta aparece na segunda às 8h como "parada há 62h" — a
// fila inteira nasce vermelha toda segunda, o TMR do dashboard vira ficção, e a
// ordenação por urgência promove mensagens da madrugada na frente de quem está
// esperando de verdade desde as 8h. Ninguém deixou de responder: o escritório
// estava fechado.
//
// Aqui o tempo só corre dentro do expediente, no fuso do ESCRITÓRIO — nunca no
// do navegador de quem abriu a tela (a mesma âncora que a agenda usa).
//
// FUSO POR OFFSET FIXO: a agenda guarda o deslocamento em minutos, resolvido a
// partir do IANA do canal (`utcOffsetMinutesOf`) no momento em que é montada.
// Isso mantém o módulo puro e determinístico. O limite: num fuso que ainda
// pratique horário de verão, um instante do outro lado da virada é lido com o
// offset de hoje — erro de 1h em janelas de poucos dias por ano. O escritório
// (America/Cuiaba, UTC-4 fixo desde 2019) não é um deles; se algum canal passar
// a ficar num fuso com DST, o caminho é resolver o offset por instante aqui,
// não espalhar `Intl` pelos componentes.
//
// PURO DE PROPÓSITO: nenhum import. Ver o cabeçalho de `attendanceRouting.ts`.

/** Uma janela de atendimento num dia da semana. */
export interface BusinessDay {
  /** 0=Dom … 6=Sáb. */
  dayOfWeek: number;
  /** Minutos desde 00:00 no fuso do escritório (8h = 480). */
  startMinute: number;
  endMinute: number;
}

export interface BusinessSchedule {
  days: BusinessDay[];
  /** Offset do escritório em relação ao UTC, em minutos (Cuiabá = -240). */
  utcOffsetMinutes: number;
  /** Feriados como 'YYYY-MM-DD' no fuso do escritório. Dia inteiro fechado. */
  holidays?: string[];
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Expediente padrão do escritório: seg–sex, 8h–18h, fuso de Cuiabá. */
export const DEFAULT_BUSINESS_SCHEDULE: BusinessSchedule = {
  days: [1, 2, 3, 4, 5].map(dayOfWeek => ({ dayOfWeek, startMinute: 8 * 60, endMinute: 18 * 60 })),
  utcOffsetMinutes: -240,
};

/** Instante deslocado para o "relógio do escritório", para ler dia/hora nele. */
function officeDate(ms: number, schedule: BusinessSchedule): Date {
  return new Date(ms + schedule.utcOffsetMinutes * MINUTE_MS);
}

/** 'YYYY-MM-DD' do dia, no fuso do escritório. */
function officeDateKey(ms: number, schedule: BusinessSchedule): string {
  const d = officeDate(ms, schedule);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Meia-noite (no escritório) do dia que contém `ms`, devolvida em epoch UTC. */
function officeMidnight(ms: number, schedule: BusinessSchedule): number {
  const d = officeDate(ms, schedule);
  const midnightShifted = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnightShifted - schedule.utcOffsetMinutes * MINUTE_MS;
}

/** Janelas de atendimento de um dia, já em epoch UTC [início, fim). */
function windowsForDay(midnightMs: number, schedule: BusinessSchedule): Array<[number, number]> {
  if (schedule.holidays?.includes(officeDateKey(midnightMs, schedule))) return [];
  const dow = officeDate(midnightMs, schedule).getUTCDay();
  return schedule.days
    .filter(d => d.dayOfWeek === dow && d.endMinute > d.startMinute)
    .map(d => [midnightMs + d.startMinute * MINUTE_MS, midnightMs + d.endMinute * MINUTE_MS] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

/** O instante cai dentro do expediente? */
export function isWithinBusinessHours(ms: number, schedule: BusinessSchedule = DEFAULT_BUSINESS_SCHEDULE): boolean {
  return windowsForDay(officeMidnight(ms, schedule), schedule).some(([open, close]) => ms >= open && ms < close);
}

// Teto de dias varridos numa conta. Protege contra agenda vazia (nenhum dia
// ativo) sem travar a interface num laço infinito.
const MAX_DAYS_SCAN = 400;

/**
 * Minutos de EXPEDIENTE entre dois instantes. Madrugada, fim de semana e
 * feriado não contam. Devolve 0 quando `to <= from`.
 */
export function businessMinutesBetween(
  fromMs: number,
  toMs: number,
  schedule: BusinessSchedule = DEFAULT_BUSINESS_SCHEDULE,
): number {
  if (!(toMs > fromMs)) return 0;
  if (schedule.days.length === 0) return 0;

  let total = 0;
  let cursor = officeMidnight(fromMs, schedule);

  for (let i = 0; i < MAX_DAYS_SCAN && cursor < toMs; i += 1) {
    for (const [open, close] of windowsForDay(cursor, schedule)) {
      const start = Math.max(open, fromMs);
      const end = Math.min(close, toMs);
      if (end > start) total += (end - start) / MINUTE_MS;
    }
    // Avança um dia pelo relógio do escritório. Somar 24h direto erraria o dia
    // em fusos com horário de verão.
    cursor = officeMidnight(cursor + DAY_MS + 2 * 3600_000, schedule);
  }

  return total;
}

/**
 * Próximo instante em que o escritório abre. Se já estiver aberto, devolve o
 * próprio `fromMs`. Usado para prometer retorno ("respondemos a partir de…")
 * sem prometer madrugada.
 */
export function nextBusinessOpening(
  fromMs: number,
  schedule: BusinessSchedule = DEFAULT_BUSINESS_SCHEDULE,
): number | null {
  if (schedule.days.length === 0) return null;
  let cursor = officeMidnight(fromMs, schedule);

  for (let i = 0; i < MAX_DAYS_SCAN; i += 1) {
    for (const [open, close] of windowsForDay(cursor, schedule)) {
      if (fromMs >= open && fromMs < close) return fromMs;  // já aberto
      if (open > fromMs) return open;
    }
    cursor = officeMidnight(cursor + DAY_MS + 2 * 3600_000, schedule);
  }
  return null;
}

/**
 * Instante em que caem N minutos de expediente a partir de `fromMs`. É o prazo
 * real de um SLA: "responder em 30min úteis" a partir das 17h50 vence às 8h20
 * do dia seguinte, não às 18h20 de uma sala vazia.
 */
export function addBusinessMinutes(
  fromMs: number,
  minutes: number,
  schedule: BusinessSchedule = DEFAULT_BUSINESS_SCHEDULE,
): number | null {
  if (schedule.days.length === 0) return null;
  if (minutes <= 0) return nextBusinessOpening(fromMs, schedule);

  let remaining = minutes * MINUTE_MS;
  let cursor = officeMidnight(fromMs, schedule);

  for (let i = 0; i < MAX_DAYS_SCAN; i += 1) {
    for (const [open, close] of windowsForDay(cursor, schedule)) {
      const start = Math.max(open, fromMs);
      if (close <= start) continue;
      const available = close - start;
      if (available >= remaining) return start + remaining;
      remaining -= available;
    }
    cursor = officeMidnight(cursor + DAY_MS + 2 * 3600_000, schedule);
  }
  return null;
}

/** 'HH:MM' → minutos desde 00:00. `null` quando não é um horário válido. */
function parseMinute(hhmm: string): number | null {
  const m = /^(\d{1,2}):([0-5]\d)/.exec(hhmm || '');
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour > 24) return null;
  const value = hour * 60 + Number(m[2]);
  return Number.isFinite(value) ? value : null;
}

/** Minutos desde 00:00 → 'HH:MM' (para exibir o horário de volta ao usuário). */
export function formatMinuteOfDay(minute: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)));
  return `${String(Math.floor(clamped / 60) % 24).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Monta a agenda a partir das linhas de `whatsapp_business_hours` do canal.
 * Linha inativa ou com horário ilegível é descartada — configuração pela metade
 * não pode virar "expediente 24h" por acidente.
 *
 * Jornada que vira o dia (22h→02h) é quebrada em duas janelas: o resto de hoje
 * e o começo de amanhã. O banco só guarda dois `TIME` por dia da semana, então é
 * aqui — e não no componente — que "fim menor que início" ganha significado.
 */
export function scheduleFromRows(
  rows: Array<{ day_of_week: number; start_time: string; end_time: string; is_active: boolean }>,
  utcOffsetMinutes: number,
  holidays?: string[],
): BusinessSchedule {
  const days: BusinessDay[] = [];
  for (const row of rows) {
    if (!row.is_active) continue;
    if (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6) continue;
    const startMinute = parseMinute(row.start_time);
    const endMinute = parseMinute(row.end_time);
    if (startMinute == null || endMinute == null) continue;
    // Janela de duração zero é configuração inválida, não "fechado o dia todo
    // menos um instante": descarta.
    if (endMinute === startMinute) continue;
    if (endMinute > startMinute) {
      days.push({ dayOfWeek: row.day_of_week, startMinute, endMinute });
      continue;
    }
    // Atravessa a meia-noite.
    days.push({ dayOfWeek: row.day_of_week, startMinute, endMinute: 24 * 60 });
    if (endMinute > 0) days.push({ dayOfWeek: (row.day_of_week + 1) % 7, startMinute: 0, endMinute });
  }
  return { days, utcOffsetMinutes, holidays };
}

// ── Consulta de estado do expediente ─────────────────────────────────

export interface BusinessHoursStatus {
  /** O instante está dentro de alguma janela de atendimento. */
  open: boolean;
  /** Janelas do dia (no fuso do escritório), já em 'HH:MM'. Vazio = dia fechado. */
  windows: Array<{ start: string; end: string }>;
  /** Próxima abertura em epoch; `null` quando a agenda não abre nunca. */
  nextOpening: number | null;
}

/**
 * Estado do expediente num instante: aberto/fechado + as janelas do dia. É o
 * que a mensagem de ausência precisa dizer ("atendemos das 08:00 às 18:00") sem
 * que o componente volte a fatiar `start_time`/`end_time` na mão.
 */
export function businessHoursStatus(
  ms: number,
  schedule: BusinessSchedule = DEFAULT_BUSINESS_SCHEDULE,
): BusinessHoursStatus {
  const windows = windowsForDay(officeMidnight(ms, schedule), schedule);
  return {
    open: windows.some(([open, close]) => ms >= open && ms < close),
    windows: windows.map(([open, close]) => ({
      start: formatMinuteOfDay((open - officeMidnight(ms, schedule)) / MINUTE_MS),
      end: formatMinuteOfDay((close - officeMidnight(ms, schedule)) / MINUTE_MS),
    })),
    nextOpening: nextBusinessOpening(ms, schedule),
  };
}

/**
 * Assinatura da medição de tempo decorrido usada pela fila e pelos badges. O
 * `channelId` é o que impede a agenda de um número ser aplicada às conversas de
 * outro: a inbox mistura canais na mesma lista.
 */
export type ElapsedMinutes = (fromMs: number, toMs: number, channelId?: string | null) => number;

/** Relógio de parede: o comportamento histórico, e o fallback de tudo aqui. */
const wallClockMinutes: ElapsedMinutes = (fromMs, toMs) => Math.max(0, (toMs - fromMs) / MINUTE_MS);

/**
 * Função de tempo decorrido para injetar na fila. Sem agenda configurada,
 * devolve o relógio de parede — comportamento histórico, para um canal sem
 * horário cadastrado não passar a reportar "0min de espera" para sempre.
 */
export function elapsedMinutesFor(schedule: BusinessSchedule | null | undefined): ElapsedMinutes {
  if (!schedule || schedule.days.length === 0) return wallClockMinutes;
  return (fromMs, toMs) => businessMinutesBetween(fromMs, toMs, schedule);
}

/**
 * Tempo decorrido resolvendo a agenda POR CANAL. Cada conversa é medida no
 * expediente do número em que ela chegou; o escritório pode ter um WhatsApp de
 * plantão 24h ao lado do comercial 8h–18h sem que um contamine o outro.
 *
 * `fallback` cobre a conversa sem canal conhecido (importações antigas, canal
 * removido). Sem agenda aplicável, relógio de parede — nada muda em relação ao
 * que a inbox fazia antes.
 */
export function elapsedMinutesForChannels(
  byChannel: Readonly<Record<string, BusinessSchedule | null | undefined>>,
  fallback?: BusinessSchedule | null,
): ElapsedMinutes {
  const cache = new Map<string, ElapsedMinutes>();
  const fallbackFn = elapsedMinutesFor(fallback);
  return (fromMs, toMs, channelId) => {
    if (!channelId) return fallbackFn(fromMs, toMs);
    let fn = cache.get(channelId);
    if (!fn) {
      const schedule = byChannel[channelId];
      fn = schedule && schedule.days.length > 0 ? elapsedMinutesFor(schedule) : fallbackFn;
      cache.set(channelId, fn);
    }
    return fn(fromMs, toMs);
  };
}
