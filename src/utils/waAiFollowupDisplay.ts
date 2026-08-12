export interface WaAiFollowupDisplayPolicy {
  enabled: boolean;
  strategy: 'fixed' | 'progressive' | 'custom';
  intervalHours: number;
  customHours: number[];
  maxAttempts: number;
  days: number[];
  startMinute: number;
  endMinute: number;
  timezone: string;
  /** Silêncio que dispara a contagem. Ausente = comportamento antigo (0). */
  inactivityMinutes?: number;
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function formatWaAiFollowupDuration(hours: number): string {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 1) return `${Math.round(value * 60)}min`;
  if (value < 24) return `${Number(value.toFixed(2))}h`;
  const days = Number((value / 24).toFixed(2));
  return `${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function waAiFollowupIntervals(policy: WaAiFollowupDisplayPolicy): number[] {
  if (policy.strategy === 'custom' && policy.customHours.length > 0) {
    return policy.customHours.slice(0, Math.max(1, policy.maxAttempts));
  }
  return Array.from({ length: Math.max(1, policy.maxAttempts) }, (_, i) =>
    policy.strategy === 'progressive'
      ? policy.intervalHours * Math.pow(2, i)
      : policy.intervalHours);
}

/** Texto curto que cabe no cabeçalho recolhido do painel. */
export function compactWaAiFollowupLabel(
  policy: WaAiFollowupDisplayPolicy,
  attemptsDone: number,
): string {
  const attempt = Math.min(Math.max(0, attemptsDone), Math.max(0, policy.maxAttempts - 1));
  const intervals = waAiFollowupIntervals(policy);
  const hours = intervals[Math.min(attempt, intervals.length - 1)] ?? policy.intervalHours;
  return `Follow-up ${attempt + 1}º em ${formatWaAiFollowupDuration(hours)}`;
}

export function describeWaAiFollowupSchedule(policy: WaAiFollowupDisplayPolicy): string {
  const intervals = waAiFollowupIntervals(policy);
  // O limiar vem primeiro porque é o marco zero: sem ele a escada parece contar
  // da última fala do escritório, que é justamente o que ela NÃO faz.
  const limiar = Number(policy.inactivityMinutes) > 0
    ? `Começa a contar após ${formatWaAiFollowupDuration(Number(policy.inactivityMinutes) / 60)} sem resposta · `
    : '';
  if (policy.strategy === 'fixed') {
    return `${limiar}A cada ${formatWaAiFollowupDuration(policy.intervalHours)} · até ${policy.maxAttempts} tentativa${policy.maxAttempts === 1 ? '' : 's'}`;
  }
  if (policy.strategy === 'progressive') {
    return `${limiar}Começa em ${formatWaAiFollowupDuration(policy.intervalHours)} e dobra a cada tentativa · até ${policy.maxAttempts}`;
  }
  return limiar + intervals.map(formatWaAiFollowupDuration).join(' · ');
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function describeWaAiFollowupWindow(policy: WaAiFollowupDisplayPolicy): string {
  const days = [...new Set(policy.days)].sort((a, b) => a - b);
  const dayLabel = days.join(',') === '1,2,3,4,5'
    ? 'Seg–sex'
    : days.length === 7
      ? 'Todos os dias'
      : days.map(day => WEEKDAY_SHORT[day] || String(day)).join(', ');
  const timezone = policy.timezone === 'America/Cuiaba' ? 'Cuiabá' : policy.timezone;
  return `${dayLabel} · ${hhmm(policy.startMinute)}–${hhmm(policy.endMinute)} · ${timezone}`;
}

// ── O que o painel mostra AGORA ─────────────────────────────────────────────

/**
 * A conta regressiva até a próxima retomada.
 *
 * Uma data absoluta ("13:29") não responde a pergunta que o atendente faz de
 * verdade, que é "quanto tempo eu tenho antes de a IA cobrar sozinha?". Por
 * isso as duas coisas aparecem juntas no painel.
 */
export function waAiFollowupCountdown(scheduledAtIso: string | null, nowMs = Date.now()): string | null {
  if (!scheduledAtIso) return null;
  const alvo = new Date(scheduledAtIso).getTime();
  if (!Number.isFinite(alvo)) return null;

  const diff = alvo - nowMs;
  const atrasado = diff < 0;
  const minutos = Math.floor(Math.abs(diff) / 60_000);

  let texto: string;
  if (minutos < 1) return atrasado ? 'saindo agora' : 'em instantes';
  if (minutos < 60) texto = `${minutos}min`;
  else if (minutos < 24 * 60) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    texto = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  } else {
    const dias = Math.floor(minutos / (24 * 60));
    const h = Math.floor((minutos % (24 * 60)) / 60);
    texto = h === 0 ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : `${dias}d ${h}h`;
  }
  return atrasado ? `atrasado ${texto}` : `em ${texto}`;
}

/** As partes de uma data no fuso do canal — nunca no do navegador. */
function partesNoFuso(date: Date, timezone: string) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (t: string) => p.find(x => x.type === t)?.value || '';
    return { ymd: `${get('year')}-${get('month')}-${get('day')}`, dm: `${get('day')}/${get('month')}`, hm: `${get('hour')}:${get('minute')}` };
  } catch {
    const iso = date.toISOString();
    return { ymd: iso.slice(0, 10), dm: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, hm: iso.slice(11, 16) };
  }
}

/** "hoje 13:29", "amanhã 08:00", "17/08 08:00" — sempre no fuso do canal. */
export function formatWaAiFollowupWhen(
  scheduledAtIso: string | null, timezone: string, nowMs = Date.now(),
): string | null {
  if (!scheduledAtIso) return null;
  const alvo = new Date(scheduledAtIso);
  if (!Number.isFinite(alvo.getTime())) return null;

  const a = partesNoFuso(alvo, timezone);
  const hoje = partesNoFuso(new Date(nowMs), timezone);
  const amanha = partesNoFuso(new Date(nowMs + 86_400_000), timezone);

  if (a.ymd === hoje.ymd) return `hoje ${a.hm}`;
  if (a.ymd === amanha.ymd) return `amanhã ${a.hm}`;
  return `${a.dm} ${a.hm}`;
}

export interface WaAiFollowupStatus {
  /**
   * 'appointment' = hora marcada pelo cliente (a escada está pausada);
   * 'scheduled' = cobrança da escada; 'configured' = política sem pendente.
   */
  tone: 'appointment' | 'scheduled' | 'configured' | 'off';
  /** Título curto: o que dizer no banner e no cabeçalho do painel. */
  label: string;
  /** "2ª de 8", quando há pendente. */
  attempt: string | null;
  /** "hoje 13:29", quando há pendente. */
  when: string | null;
  /** "em 1h32", quando há pendente. */
  countdown: string | null;
  /** A frase pronta para uma linha só. */
  detail: string;
}

/**
 * O estado do acompanhamento em uma linha, do jeito que o operador precisa ler.
 *
 * A diferença entre "configurado" e "agendado" é a que mais importa: até
 * 12/08/2026 o painel dizia que o follow-up estava ativo enquanto o banco não
 * tinha linha pendente nenhuma — e ninguém tinha como perceber.
 */
export function describeWaAiFollowupStatus(input: {
  policy: WaAiFollowupDisplayPolicy | null;
  attemptsDone: number;
  pending: { attempt: number; scheduledAt: string; kind?: string | null } | null;
  nowMs?: number;
}): WaAiFollowupStatus {
  const now = input.nowMs ?? Date.now();
  const policy = input.policy;

  if (!policy || !policy.enabled) {
    return { tone: 'off', label: 'Sem follow-up automático', attempt: null, when: null, countdown: null, detail: 'Este agente não retoma o contato sozinho.' };
  }

  if (input.pending) {
    const when = formatWaAiFollowupWhen(input.pending.scheduledAt, policy.timezone, now);
    const countdown = waAiFollowupCountdown(input.pending.scheduledAt, now);

    // Compromisso marcado pelo cliente. Chamar isto de "2ª tentativa de 8" é
    // errado nos dois sentidos: não é cobrança, e a escada está PAUSADA — as
    // tentativas continuam todas disponíveis para depois.
    if (input.pending.kind === 'appointment') {
      return {
        tone: 'appointment',
        label: 'Contato agendado',
        attempt: null, when, countdown,
        detail: ['Contato marcado pelo cliente', when, countdown].filter(Boolean).join(' · '),
      };
    }

    const attempt = `${input.pending.attempt}ª de ${policy.maxAttempts}`;
    return {
      tone: 'scheduled',
      label: 'Follow-up ativo',
      attempt, when, countdown,
      detail: [`${attempt} tentativa`, when, countdown].filter(Boolean).join(' · '),
    };
  }

  const restantes = Math.max(0, policy.maxAttempts - Math.max(0, input.attemptsDone));
  return {
    tone: 'configured',
    label: 'Follow-up ativo',
    attempt: null, when: null, countdown: null,
    detail: restantes === 0
      ? 'Todas as tentativas de retomada já foram usadas.'
      : 'Follow-up configurado, ainda não agendado.',
  };
}

// ── O chip da lista de conversas ────────────────────────────────────────────

export interface WaAiListChipInput {
  /** A IA ainda responde esta conversa (false depois do handoff). */
  aiActive: boolean;
  /** 'appointment' quando o pendente é hora marcada pelo cliente. */
  kind?: string | null;
  /** Vale a invariante: preenchido ⟺ existe follow-up pendente. */
  nextFollowupAt: string | null;
  /** Acompanhamentos JÁ ENVIADOS — a próxima tentativa é este número + 1. */
  attemptsDone: number;
  maxAttempts: number;
  nowMs?: number;
}

export interface WaAiListChip {
  /** Curto por obrigação: divide a linha com canal, setor e etiquetas. */
  label: string;
  /** A frase inteira, para o title do chip. */
  title: string;
}

/**
 * O que a linha da inbox diz quando a IA está com a conversa.
 *
 * UM chip no lugar de quatro. Enquanto o agente responde, "Aguardando setor",
 * "Aguardando você" e "na fila há 2h07" são todos falsos — ninguém está
 * esperando um humano, e o atendente que lê aquilo procura um problema que não
 * existe. O que ele precisa saber é outra coisa: a IA está com isso, e quando
 * ela volta a falar se o cliente sumir.
 */
export function waAiListChip(input: WaAiListChipInput): WaAiListChip | null {
  if (!input.aiActive) return null;
  const now = input.nowMs ?? Date.now();

  const countdown = waAiFollowupCountdown(input.nextFollowupAt, now);
  if (!countdown) return { label: 'IA ativa', title: 'Assistente de IA conduzindo esta conversa' };

  if (input.kind === 'appointment') {
    return {
      label: `IA · contato ${countdown}`,
      title: 'Assistente de IA · contato marcado pelo cliente (a escada de follow-up está pausada)',
    };
  }

  const tentativa = Math.min(Math.max(0, input.attemptsDone) + 1, Math.max(1, input.maxAttempts));
  return {
    label: `IA · ${tentativa}ª ${countdown}`,
    title: `Assistente de IA · retomada ${tentativa} de ${input.maxAttempts} ${countdown}`,
  };
}
