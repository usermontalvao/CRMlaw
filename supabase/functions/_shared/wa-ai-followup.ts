/**
 * Política de follow-up do Assistente de IA do WhatsApp — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiFollowupPolicy.ts
 *   supabase/functions/_shared/wa-ai-followup.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiFollowupPolicy.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * Duas responsabilidades, ambas sem tocar no banco:
 *   1. QUANDO cai a próxima tentativa (intervalo + janela de dias/horas + fuso);
 *   2. SE ela ainda deve sair (as condições de parada).
 *
 * O fuso é o do canal, nunca o do navegador — mesma regra do resto do CRM
 * (ver src/utils/officeTime.ts).
 */

export type WaAiFollowupStrategy = 'fixed' | 'progressive' | 'custom';

export interface WaAiFollowupPolicy {
  enabled: boolean;
  maxAttempts: number;
  strategy: WaAiFollowupStrategy;
  /** Intervalo base em horas ('fixed' e 'progressive'). */
  intervalHours: number;
  /**
   * Intervalos explícitos em horas, na ordem ('custom'). Ex.: [4, 24, 72].
   * Aceita sequência decrescente sem nenhuma fórmula: [72, 24, 4] é válido.
   */
  customHours: number[];
  /** Dias permitidos. 0 = domingo … 6 = sábado. */
  days: number[];
  /** Minutos desde a meia-noite: início e fim da janela permitida. */
  startMinute: number;
  endMinute: number;
  /** Fuso IANA do canal (ex.: 'America/Cuiaba'). */
  timezone: string;
  /**
   * Silêncio que define a outra parte como INATIVA, em minutos.
   *
   * Não é um degrau da escada: é o marco zero dela. O relógio do primeiro
   * acompanhamento só começa a contar depois deste silêncio — "2 horas" quer
   * dizer duas horas de alguém que já parou de responder, não duas horas a
   * partir da última fala nossa. Da segunda tentativa em diante não se aplica:
   * a essa altura a inatividade já está estabelecida.
   */
  inactivityMinutes: number;
}

export const WA_AI_FOLLOWUP_DEFAULTS: WaAiFollowupPolicy = {
  enabled: false,
  maxAttempts: 3,
  strategy: 'fixed',
  intervalHours: 24,
  customHours: [],
  days: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 18 * 60,
  timezone: 'America/Cuiaba',
  inactivityMinutes: 10,
};

// ── Fuso ────────────────────────────────────────────────────────────────────

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; dow: number }

const DOW_BY_NAME: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hora de parede no fuso informado. Cai para UTC se o fuso for inválido. */
export function localPartsInTz(date: Date, timezone: string): LocalParts {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '';
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour: Number(get('hour')) % 24,
      minute: Number(get('minute')),
      dow: DOW_BY_NAME[get('weekday')] ?? date.getUTCDay(),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      dow: date.getUTCDay(),
    };
  }
}

/** Deslocamento do fuso, em ms, no instante informado (positivo a leste). */
function tzOffsetMs(date: Date, timezone: string): number {
  const p = localPartsInTz(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute,
    date.getUTCSeconds(), date.getUTCMilliseconds());
  return asUtc - date.getTime();
}

/**
 * O instante UTC correspondente a uma hora de parede no fuso.
 *
 * Duas passadas: a primeira usa o deslocamento do palpite, a segunda o corrige
 * quando o palpite caiu do outro lado de uma virada de horário de verão.
 */
export function zonedWallTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - tzOffsetMs(new Date(guess), timezone);
  ts = guess - tzOffsetMs(new Date(ts), timezone);
  return new Date(ts);
}

// ── Normalização ────────────────────────────────────────────────────────────

/**
 * Aparar antes de usar. Uma política vinda do banco pode ter dias repetidos,
 * janela invertida ou lista de intervalos com lixo — e o cálculo do horário não
 * é lugar para descobrir isso.
 */
export function normalizeWaAiFollowupPolicy(input: Partial<WaAiFollowupPolicy> | null | undefined): WaAiFollowupPolicy {
  const src = input || {};
  const days = Array.isArray(src.days)
    ? src.days.map(d => Number(d)).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const uniqueDays: number[] = [];
  for (const d of days) if (uniqueDays.indexOf(d) === -1) uniqueDays.push(d);
  uniqueDays.sort((a, b) => a - b);

  const custom = Array.isArray(src.customHours)
    ? src.customHours.map(h => Number(h)).filter(h => Number.isFinite(h) && h > 0 && h <= 720)
    : [];

  const strategy: WaAiFollowupStrategy =
    src.strategy === 'progressive' || src.strategy === 'custom' ? src.strategy : 'fixed';

  const interval = Number.isFinite(Number(src.intervalHours)) && Number(src.intervalHours) > 0
    ? Math.min(720, Number(src.intervalHours))
    : WA_AI_FOLLOWUP_DEFAULTS.intervalHours;

  const maxAttempts = Number.isInteger(Number(src.maxAttempts))
    ? Math.min(10, Math.max(1, Number(src.maxAttempts)))
    : WA_AI_FOLLOWUP_DEFAULTS.maxAttempts;

  let start = Number.isInteger(Number(src.startMinute)) ? Number(src.startMinute) : WA_AI_FOLLOWUP_DEFAULTS.startMinute;
  let end = Number.isInteger(Number(src.endMinute)) ? Number(src.endMinute) : WA_AI_FOLLOWUP_DEFAULTS.endMinute;
  start = Math.min(1439, Math.max(0, start));
  end = Math.min(1440, Math.max(1, end));
  if (end <= start) { start = WA_AI_FOLLOWUP_DEFAULTS.startMinute; end = WA_AI_FOLLOWUP_DEFAULTS.endMinute; }

  return {
    enabled: src.enabled === true,
    maxAttempts,
    strategy,
    intervalHours: interval,
    customHours: custom,
    days: uniqueDays.length ? uniqueDays : WA_AI_FOLLOWUP_DEFAULTS.days.slice(),
    startMinute: start,
    endMinute: end,
    timezone: typeof src.timezone === 'string' && src.timezone.trim() ? src.timezone.trim() : WA_AI_FOLLOWUP_DEFAULTS.timezone,
    inactivityMinutes: Number.isFinite(Number(src.inactivityMinutes)) && Number(src.inactivityMinutes) >= 0
      ? Math.min(1440, Math.floor(Number(src.inactivityMinutes)))
      : WA_AI_FOLLOWUP_DEFAULTS.inactivityMinutes,
  };
}

// ── Intervalo ───────────────────────────────────────────────────────────────

/**
 * Horas de espera antes da tentativa `attempt` (1 = a primeira).
 *
 * 'custom' usa o intervalo da posição e repete o último quando as tentativas
 * passam da lista — é o que permite [4, 24, 72] descrever exatamente as três
 * primeiras cobranças sem inventar uma fórmula para elas.
 */
export function followupIntervalHours(policy: WaAiFollowupPolicy, attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  if (policy.strategy === 'custom' && policy.customHours.length > 0) {
    return policy.customHours[Math.min(n, policy.customHours.length) - 1];
  }
  if (policy.strategy === 'progressive') {
    return policy.intervalHours * Math.pow(2, n - 1);
  }
  return policy.intervalHours;
}

// ── Janela ──────────────────────────────────────────────────────────────────

/** O instante cai num dia e num horário permitidos? */
export function isWithinFollowupWindow(date: Date, policy: WaAiFollowupPolicy): boolean {
  const p = localPartsInTz(date, policy.timezone);
  if (policy.days.indexOf(p.dow) === -1) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= policy.startMinute && minutes < policy.endMinute;
}

/**
 * O primeiro instante permitido a partir de `from` (inclusive).
 *
 * Varre no máximo 14 dias. Uma política sem nenhum dia marcado não chega aqui
 * (a normalização repõe o padrão), mas se chegasse a varredura devolveria
 * `from` em vez de girar para sempre.
 */
export function nextAllowedSlot(from: Date, policy: WaAiFollowupPolicy): Date {
  const base = localPartsInTz(from, policy.timezone);
  const baseMinutes = base.hour * 60 + base.minute;

  for (let offset = 0; offset <= 14; offset++) {
    // Soma os dias em UTC sobre a data LOCAL: resolve virada de mês e de ano.
    const dayUtc = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const year = dayUtc.getUTCFullYear();
    const month = dayUtc.getUTCMonth() + 1;
    const day = dayUtc.getUTCDate();
    const dow = dayUtc.getUTCDay();

    if (policy.days.indexOf(dow) === -1) continue;

    let slotMinutes = policy.startMinute;
    if (offset === 0) {
      if (baseMinutes >= policy.endMinute) continue;      // janela de hoje já passou
      if (baseMinutes > policy.startMinute) slotMinutes = baseMinutes; // já estamos dentro
    }

    return zonedWallTimeToUtc(year, month, day, Math.floor(slotMinutes / 60), slotMinutes % 60, policy.timezone);
  }

  return from;
}

/**
 * Quando cai a tentativa `attempt`, contada a partir de `fromIso`.
 * Devolve null quando a política está desligada ou as tentativas acabaram —
 * é a mesma resposta para "não agende" nos dois casos.
 */
export function nextFollowupAt(
  policy: WaAiFollowupPolicy,
  attempt: number,
  fromIso: string | Date,
): Date | null {
  if (!policy.enabled) return null;
  if (attempt > policy.maxAttempts) return null;

  const from = fromIso instanceof Date ? fromIso : new Date(fromIso);
  if (!Number.isFinite(from.getTime())) return null;

  const hours = followupIntervalHours(policy, attempt);
  // O silêncio que define a inatividade entra UMA vez, antes do primeiro degrau.
  // Da segunda tentativa em diante o cliente já está calado há muito tempo, e
  // somar de novo só empurraria a escada inteira para a frente.
  const espera = attempt <= 1 ? policy.inactivityMinutes * 60_000 : 0;
  const target = new Date(from.getTime() + espera + hours * 3_600_000);
  return nextAllowedSlot(target, policy);
}

// ── Parada ──────────────────────────────────────────────────────────────────

export interface WaAiFollowupState {
  /** Tentativa que está prestes a sair (1 = a primeira). */
  attempt: number;
  /**
   * Quando o acompanhamento foi CRIADO — não quando ele vence.
   * É esta a referência de "o cliente respondeu depois que agendamos": a
   * resposta chega justamente no meio, entre a criação e o vencimento.
   */
  createdAtIso: string;
  /** Última mensagem do CLIENTE, se houver. */
  lastCustomerMessageAtIso: string | null;
  conversationStatus: string;
  /** false depois do handoff humano — e não volta sozinho. */
  aiActive: boolean;
  assistantActive: boolean;
  channelAiEnabled: boolean;
  followupEnabled: boolean;
  maxAttempts: number;
  /** Objetivo que motivou o acompanhamento já foi cumprido. */
  goalCompleted?: boolean;
  /** O cliente pediu para parar de receber. Vale mais que qualquer política. */
  optedOut?: boolean;
}

export type WaAiFollowupDecision =
  | { send: true }
  | { send: false; reason: string };

/**
 * Vale a pena mandar este follow-up agora?
 *
 * A ordem das perguntas é a ordem em que o motivo deve aparecer para o
 * operador: primeiro o que ele desligou, depois o que o cliente fez.
 *
 * A comparação com `lastCustomerMessageAt` é o que faz "para quando o cliente
 * responder" funcionar sem depender de ninguém cancelar nada: se o cliente
 * falou DEPOIS do agendamento, o lembrete perdeu o sentido.
 */
export function decideFollowup(state: WaAiFollowupState): WaAiFollowupDecision {
  if (state.optedOut) return { send: false, reason: 'Cliente pediu para não receber mais mensagens.' };
  if (!state.followupEnabled) return { send: false, reason: 'Follow-up desativado no agente.' };
  if (!state.assistantActive) return { send: false, reason: 'Agente inativo.' };
  if (!state.channelAiEnabled) return { send: false, reason: 'IA desativada no canal.' };
  if (!state.aiActive) return { send: false, reason: 'Conversa entregue ao atendimento humano.' };
  if (state.conversationStatus === 'closed') return { send: false, reason: 'Conversa encerrada.' };
  if (state.goalCompleted) return { send: false, reason: 'Objetivo do acompanhamento já concluído.' };
  if (state.attempt > state.maxAttempts) return { send: false, reason: 'Número máximo de tentativas atingido.' };

  if (state.lastCustomerMessageAtIso) {
    const replied = new Date(state.lastCustomerMessageAtIso).getTime();
    const created = new Date(state.createdAtIso).getTime();
    if (Number.isFinite(replied) && Number.isFinite(created) && replied >= created) {
      return { send: false, reason: 'Cliente respondeu.' };
    }
  }

  return { send: true };
}

// ── Piloto automático ───────────────────────────────────────────────────────

/**
 * O estado do turno que acabou de acontecer, para decidir se o BACKEND deve
 * garantir um acompanhamento pendente.
 *
 * POR QUE ISTO EXISTE: o agendamento não pode depender de o modelo lembrar de
 * chamar `agendar_followup`. O modelo só roda quando o cliente escreve — e
 * nesse instante ele não tem como saber que o cliente vai sumir depois. Quem
 * sabe disso é o relógio, e o relógio é do servidor.
 */
export interface WaAiAutoFollowupContext {
  mode: 'test' | 'auto';
  /** Houve mensagem realmente entregue ao cliente neste turno. */
  replySent: boolean;
  policyEnabled: boolean;
  maxAttempts: number;
  /** Quantos acompanhamentos JÁ SAÍRAM nesta conversa. */
  attemptsDone: number;
  assistantActive: boolean;
  channelAiEnabled: boolean;
  aiActive: boolean;
  sessionStatus: string;
  conversationStatus: string;
  conversationBlocked: boolean;
  assignedUserId: string | null;
  awaitingAccept: boolean;
  /** Ação terminal (handoff/transferência) executada neste turno. */
  handedOff: boolean;
  /** O próprio assistente cancelou o acompanhamento nesta execução. */
  followupCancelled?: boolean;
  goalCompleted?: boolean;
  /**
   * O cliente pediu para parar. Vem antes de tudo: é a única condição em que
   * insistir não é só inútil, é o que faz a pessoa bloquear o número.
   */
  optedOut?: boolean;
}

export type WaAiAutoFollowupDecision =
  | { schedule: true; attempt: number }
  | { schedule: false; reason: string };

/**
 * Vale a pena GARANTIR um acompanhamento agora?
 *
 * Mesma lista de paradas de `decideFollowup`, um passo antes: lá se decide se o
 * lembrete já agendado ainda deve sair; aqui, se ele deve nascer.
 */
export function decideAutoFollowup(ctx: WaAiAutoFollowupContext): WaAiAutoFollowupDecision {
  if (ctx.optedOut) return { schedule: false, reason: 'Cliente pediu para não receber mais mensagens.' };
  if (ctx.mode === 'test') return { schedule: false, reason: 'Modo de teste: nada é agendado.' };
  if (!ctx.policyEnabled) return { schedule: false, reason: 'Follow-up desativado no agente.' };
  if (!ctx.replySent) return { schedule: false, reason: 'Nenhuma mensagem foi entregue ao cliente neste turno.' };
  if (ctx.followupCancelled) return { schedule: false, reason: 'O assistente cancelou o acompanhamento nesta execução.' };
  if (!ctx.assistantActive) return { schedule: false, reason: 'Agente inativo.' };
  if (!ctx.channelAiEnabled) return { schedule: false, reason: 'IA desativada no canal.' };
  if (ctx.handedOff) return { schedule: false, reason: 'Atendimento entregue ao humano nesta execução.' };
  if (!ctx.aiActive) return { schedule: false, reason: 'Conversa entregue ao atendimento humano.' };
  if (ctx.sessionStatus && ctx.sessionStatus !== 'active') {
    return { schedule: false, reason: `Sessão da IA em "${ctx.sessionStatus}".` };
  }
  if (ctx.conversationStatus === 'closed') return { schedule: false, reason: 'Conversa encerrada.' };
  if (ctx.conversationBlocked) return { schedule: false, reason: 'Contato bloqueado.' };
  if (ctx.assignedUserId) return { schedule: false, reason: 'Conversa assumida por um atendente.' };
  if (ctx.awaitingAccept) return { schedule: false, reason: 'Conversa aguardando aceite de transferência.' };
  if (ctx.goalCompleted) return { schedule: false, reason: 'Objetivo do acompanhamento já concluído.' };

  const attempt = Math.max(0, Math.floor(ctx.attemptsDone)) + 1;
  if (attempt > ctx.maxAttempts) return { schedule: false, reason: 'Número máximo de tentativas atingido.' };

  return { schedule: true, attempt };
}

// ── Texto da retomada ───────────────────────────────────────────────────────

/** Teto do CHECK de `whatsapp_ai_followups.message`. */
export const WA_AI_FOLLOWUP_MESSAGE_MAX = 1200;

/**
 * O primeiro nome do contato, quando o que está gravado é mesmo um nome.
 *
 * Contato sem agenda chega como número ("5566...") e como apelido do próprio
 * WhatsApp. Chamar alguém de "5566" é pior do que não chamar de nada.
 */
export function waAiFirstName(contactName: string | null | undefined): string | null {
  const raw = String(contactName || '').trim();
  if (!raw) return null;
  const first = raw.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '');
  if (first.length < 2) return null;
  if (!/\p{L}/u.test(first)) return null;
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1);
}

/**
 * A última pergunta que a IA fez, extraída do texto que ela enviou.
 *
 * É o que transforma "ainda tem interesse?" em "ficou faltando você me dizer o
 * mês e o ano" — a retomada precisa lembrar o ponto exato onde a conversa parou.
 */
export function waAiLastQuestion(text: string | null | undefined): string | null {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const perguntas = clean.match(/[^.!?\n]+\?/g);
  if (!perguntas || perguntas.length === 0) return null;
  const last = perguntas[perguntas.length - 1].trim();
  if (last.length < 3) return null;
  return last.length > 200 ? `${last.slice(0, 199)}…` : last;
}

function juntarPt(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/**
 * As aberturas giram com a tentativa: a segunda cobrança não pode chegar com a
 * mesma frase da primeira — é o que faz o lembrete parecer robô travado.
 */
const WA_AI_FOLLOWUP_OPENINGS: ((nome: string | null) => string)[] = [
  nome => `Oi${nome ? `, ${nome}` : ''}! Podemos continuar?`,
  nome => `${nome || 'Oi'}, voltando aqui para retomarmos de onde paramos.`,
  nome => `Oi${nome ? `, ${nome}` : ''}! Continuo por aqui quando você puder responder.`,
  nome => `${nome || 'Olá'}, ainda dá para seguirmos com o seu atendimento.`,
];

/**
 * Até onde uma pendência ainda é uma frase que se lê no WhatsApp.
 *
 * A pendência vem do campo `ask` do roteiro, e esse campo tem dois patrões: ele
 * orienta o MODELO a perguntar e, aqui, entra na frase que o CLIENTE lê
 * ("Ficou faltando ..."). Enquanto o texto é curto os dois usos convivem. Mas
 * em produção o roteiro de rescisão indireta guarda em `ask` um parágrafo de
 * 577 caracteres com instruções ramificadas ("Se for FGTS, pergunte de modo
 * natural se consultou o extrato..."). Mandar isso para o cliente é entregar a
 * ele o manual do atendente.
 *
 * Acima deste limite a pendência é DESCARTADA da frase — não truncada, porque
 * meia instrução é tão ruim quanto a instrução inteira. Sobrando nenhuma, a
 * retomada repete a última pergunta feita, que é a segunda melhor coisa a
 * dizer e continua sendo específica.
 */
export const WA_AI_PENDING_ITEM_READABLE_MAX = 120;

export interface WaAiFollowupMessageInput {
  firstName: string | null;
  /** A última pergunta da IA, se houver. */
  lastQuestion: string | null;
  /** O que a IA anotou que está aguardando. Tem prioridade sobre a pergunta. */
  pendingItems: string[];
  attempt: number;
}

/**
 * A retomada determinística: usada quando o modelo não escreveu nenhuma.
 *
 * Nunca genérica. Ou nomeia a pendência anotada, ou repete a pergunta que ficou
 * sem resposta — porque uma retomada que não diz o que falta obriga o cliente a
 * rolar a conversa para descobrir, e ele simplesmente não rola.
 */
export function buildWaAiFollowupMessage(input: WaAiFollowupMessageInput): string {
  const nome = input.firstName ? input.firstName.trim() : null;
  const abertura = WA_AI_FOLLOWUP_OPENINGS[
    Math.max(0, Math.floor(input.attempt) - 1) % WA_AI_FOLLOWUP_OPENINGS.length](nome);

  const pendencias = (input.pendingItems || [])
    .map(item => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(item => item.length > 0 && item.length <= WA_AI_PENDING_ITEM_READABLE_MAX)
    .slice(0, 3);

  let complemento: string;
  if (pendencias.length > 0) {
    complemento = `Ficou faltando ${juntarPt(pendencias)}.`;
  } else if (input.lastQuestion) {
    const pergunta = input.lastQuestion.trim();
    complemento = `Ficou faltando você me responder: "${pergunta}"`;
  } else {
    complemento = 'Se ainda fizer sentido, é só me responder por aqui que eu sigo com o seu atendimento.';
  }

  const texto = `${abertura} ${complemento}`.trim();
  return texto.length > WA_AI_FOLLOWUP_MESSAGE_MAX
    ? `${texto.slice(0, WA_AI_FOLLOWUP_MESSAGE_MAX - 1)}…`
    : texto;
}

// ── Memória mínima garantida ────────────────────────────────────────────────

/** Corta no limite sem partir a última palavra no meio. */
function trecho(text: string | null | undefined, max: number): string | null {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * O resumo e a pendência que o BACKEND deriva quando o modelo não anota nada.
 *
 * Mesma lição do acompanhamento: `registrar_memoria` é uma ferramenta, e o
 * modelo simplesmente não a chama (na conversa de 12/08/2026 foram seis
 * execuções seguidas com `requested_actions` vazio). O painel "Memória da IA"
 * ficava dizendo "a IA ainda não registrou um resumo" enquanto a IA conduzia o
 * atendimento inteiro.
 *
 * Nada aqui é inventado: são as duas últimas falas, transcritas. Um resumo
 * derivado de fatos é infinitamente mais útil do que um campo vazio, e não
 * corre o risco de afirmar algo que não aconteceu.
 */
export function buildWaAiAutoMemory(input: {
  lastCustomerText: string | null;
  lastQuestion: string | null;
}): { summary: string; pendingItems: string[] } {
  const cliente = trecho(input.lastCustomerText, 220);
  const pergunta = trecho(input.lastQuestion, 220);

  // A pergunta NÃO entra no resumo: ela é a pendência, e o painel já mostra as
  // duas coisas uma embaixo da outra. Repetir enche a coluna de texto igual.
  const frases = ['Resumo automático — o agente não registrou o dele.'];
  if (cliente) frases.push(`Última mensagem do cliente: "${cliente}".`);
  else if (pergunta) frases.push(`A IA perguntou: "${pergunta}".`);

  return {
    summary: frases.join(' '),
    pendingItems: pergunta ? [trecho(`responder: "${pergunta}"`, 200)!] : [],
  };
}

// ── Hora marcada pelo cliente ───────────────────────────────────────────────

/**
 * O que o cliente pediu, em hora de parede. Estrutural de propósito: quem
 * produz isto é `waAiIntent.ts`, e os dois arquivos são puros e sem imports.
 */
export interface WaAiRequestedSlot {
  /** -1 quando a pessoa deu o dia mas não a hora ("amanhã"). */
  hour: number;
  minute: number;
  dayOffset: number;
  weekday: number | null;
}

/**
 * "Me chama às 14h" vira um instante UTC, dentro da janela do canal.
 *
 * Três correções que a conta ingênua erra:
 *   - hora que já passou hoje é amanhã (às 11h, "às 9" não é daqui a -2h);
 *   - dia da semana nomeado é a PRÓXIMA ocorrência dele;
 *   - o pedido ainda passa pela janela do canal, então "me chama às 22h" cai no
 *     primeiro horário útil seguinte em vez de acordar o cliente.
 */
export function requestedSlotToUtc(
  req: WaAiRequestedSlot, fromIso: string | Date, policy: WaAiFollowupPolicy,
): Date | null {
  const from = fromIso instanceof Date ? fromIso : new Date(fromIso);
  if (!Number.isFinite(from.getTime())) return null;

  const base = localPartsInTz(from, policy.timezone);
  const hour = req.hour >= 0 ? req.hour : Math.floor(policy.startMinute / 60);
  const minute = req.hour >= 0 ? req.minute : policy.startMinute % 60;

  let offset = Math.max(0, Math.floor(req.dayOffset));
  if (req.weekday !== null) {
    const diff = (req.weekday - base.dow + 7) % 7;
    offset = diff;
  }

  const construir = (dias: number) => {
    const dayUtc = new Date(Date.UTC(base.year, base.month - 1, base.day + dias));
    return zonedWallTimeToUtc(
      dayUtc.getUTCFullYear(), dayUtc.getUTCMonth() + 1, dayUtc.getUTCDate(),
      hour, minute, policy.timezone);
  };

  let alvo = construir(offset);
  // Hora que já passou: quem diz "às 9" às 11h está falando de amanhã (ou da
  // próxima semana, se nomeou o dia).
  if (alvo.getTime() <= from.getTime()) alvo = construir(offset + (req.weekday !== null ? 7 : 1));

  return nextAllowedSlot(alvo, policy);
}
