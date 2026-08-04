// Campanhas (disparo em massa) no WhatsApp do escritório.
//
// Um disparo mal feito não é só incômodo: número que envia centenas de
// mensagens iguais em minutos é banido pelo WhatsApp, e o escritório perde o
// canal de atendimento junto. Por isso a campanha aqui é sempre TRÊS coisas
// separadas — quem entra (público), quem NÃO pode receber (guardas) e em que
// ritmo sai (plano de disparo) — e nenhuma delas é opcional.
//
// PURO DE PROPÓSITO: nenhum import. Ver o cabeçalho de `attendanceRouting.ts`.

// ── Público ──────────────────────────────────────────────────────────

export interface CampaignContact {
  /** Id da conversa ou do contato — é o que volta nos relatórios. */
  id: string;
  phone: string;
  name?: string | null;
  /** Cadastro vinculado; ausente = lead. */
  clientId?: string | null;
  channelId?: string | null;
  departmentId?: string | null;
  labels?: string[] | null;
  status?: string | null;             // 'open' | 'pending' | 'closed'
  isBlocked?: boolean | null;
  /** Pediu para não receber mais campanhas. */
  optOut?: boolean | null;
  /** Última mensagem RECEBIDA do contato (ISO). */
  lastInboundAt?: string | null;
  /** Último disparo de campanha para este contato (ISO). */
  lastCampaignAt?: string | null;
}

export interface AudienceFilter {
  channelId?: string | null;
  departmentId?: string | null;
  /** Basta ter UMA destas etiquetas. */
  includeLabels?: string[];
  /** Ter qualquer uma destas exclui o contato. */
  excludeLabels?: string[];
  /** Só quem tem cadastro de cliente. */
  onlyClients?: boolean;
  /** Só quem ainda não é cliente (lead). */
  onlyLeads?: boolean;
  /** Sem falar conosco há pelo menos N dias (reativação). */
  inactiveForDays?: number;
  /** Falou conosco nos últimos N dias (quem está quente). */
  activeWithinDays?: number;
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now - t) / DAY_MS;
}

/** Aplica a segmentação. Sem filtro nenhum, devolve todo mundo (o caller decide). */
export function buildAudience(
  contacts: CampaignContact[],
  filter: AudienceFilter = {},
  now: number = Date.now(),
): CampaignContact[] {
  return contacts.filter(c => {
    if (filter.channelId && c.channelId !== filter.channelId) return false;
    if (filter.departmentId && c.departmentId !== filter.departmentId) return false;

    const labels = c.labels ?? [];
    if (filter.includeLabels?.length && !filter.includeLabels.some(l => labels.includes(l))) return false;
    if (filter.excludeLabels?.length && filter.excludeLabels.some(l => labels.includes(l))) return false;

    if (filter.onlyClients && !c.clientId) return false;
    if (filter.onlyLeads && c.clientId) return false;

    if (filter.inactiveForDays != null) {
      const d = daysSince(c.lastInboundAt, now);
      // Nunca falou = inativo por definição; entra na reativação.
      if (d != null && d < filter.inactiveForDays) return false;
    }
    if (filter.activeWithinDays != null) {
      const d = daysSince(c.lastInboundAt, now);
      if (d == null || d > filter.activeWithinDays) return false;
    }
    return true;
  });
}

// ── Guardas ──────────────────────────────────────────────────────────

/**
 * Etiqueta que tira o contato de qualquer disparo. Vive aqui, junto da regra
 * que a respeita: se ela morasse só na UI, alguém montaria um público novo sem
 * lembrar de excluí-la e o cliente que pediu para sair receberia de novo.
 */
export const DO_NOT_DISTURB_LABEL = 'Não perturbe';

export interface CampaignGuards {
  /** Não disparar de novo para quem recebeu campanha nos últimos N dias. */
  cooldownDays: number;
  /** Não interromper atendimento vivo (conversa aberta com a equipe). */
  skipOpenConversations: boolean;
  /** Teto de destinatários do disparo. `0` = sem teto. */
  maxRecipients: number;
  /** Contatos que já pediram para sair (ids), além do flag `optOut`. */
  optOutIds?: string[];
}

export const DEFAULT_CAMPAIGN_GUARDS: CampaignGuards = {
  cooldownDays: 14,
  skipOpenConversations: true,
  maxRecipients: 0,
};

export interface CampaignSkip {
  id: string;
  reason: string;
}

export interface CampaignEligibility {
  eligible: CampaignContact[];
  /** Quem ficou de fora e por quê — a auditoria do disparo. */
  skipped: CampaignSkip[];
}

/**
 * Filtra o público pelas regras inegociáveis. A ordem dos motivos importa: o
 * relatório deve dizer "opt-out" mesmo quando o contato também estava em
 * cooldown, porque opt-out é decisão do cliente e cooldown é regra nossa.
 */
export function applyCampaignGuards(
  audience: CampaignContact[],
  guards: CampaignGuards = DEFAULT_CAMPAIGN_GUARDS,
  now: number = Date.now(),
): CampaignEligibility {
  const optOutIds = new Set(guards.optOutIds ?? []);
  const eligible: CampaignContact[] = [];
  const skipped: CampaignSkip[] = [];
  const seenPhones = new Set<string>();

  for (const c of audience) {
    if (c.optOut || optOutIds.has(c.id) || (c.labels ?? []).includes(DO_NOT_DISTURB_LABEL)) {
      skipped.push({ id: c.id, reason: 'pediu para não receber' });
      continue;
    }
    if (c.isBlocked) {
      skipped.push({ id: c.id, reason: 'contato bloqueado' });
      continue;
    }
    const digits = (c.phone || '').replace(/\D/g, '');
    if (digits.length < 12 || digits.length > 13) {
      skipped.push({ id: c.id, reason: 'telefone inválido' });
      continue;
    }
    // O mesmo número pode ter duas conversas (canais diferentes, thread antiga).
    // Disparar duas vezes para a mesma pessoa é o erro que mais irrita.
    if (seenPhones.has(digits)) {
      skipped.push({ id: c.id, reason: 'número duplicado no público' });
      continue;
    }
    if (guards.skipOpenConversations && c.status && c.status !== 'closed') {
      skipped.push({ id: c.id, reason: 'atendimento em andamento' });
      continue;
    }
    if (guards.cooldownDays > 0) {
      const d = daysSince(c.lastCampaignAt, now);
      if (d != null && d < guards.cooldownDays) {
        skipped.push({ id: c.id, reason: `recebeu campanha há ${Math.floor(d)}d (carência ${guards.cooldownDays}d)` });
        continue;
      }
    }
    if (guards.maxRecipients > 0 && eligible.length >= guards.maxRecipients) {
      skipped.push({ id: c.id, reason: `acima do teto de ${guards.maxRecipients} destinatários` });
      continue;
    }
    seenPhones.add(digits);
    eligible.push(c);
  }

  return { eligible, skipped };
}

// ── Plano de disparo ─────────────────────────────────────────────────

export interface DispatchWindow {
  /** Minuto do dia em que a janela abre (ex.: 8h = 480). */
  startMinute: number;
  /** Minuto do dia em que fecha (ex.: 18h = 1080). */
  endMinute: number;
  /** Dias da semana permitidos (0=Dom … 6=Sáb). */
  days: number[];
}

/** Comercial: seg-sex, 8h–18h. Fora disso é mensagem que gera bloqueio, não venda. */
export const BUSINESS_WINDOW: DispatchWindow = {
  startMinute: 8 * 60,
  endMinute: 18 * 60,
  days: [1, 2, 3, 4, 5],
};

export interface DispatchOptions {
  /** Quando a campanha começa a sair (ISO ou epoch ms). */
  startAt: string | number;
  /** Ritmo: mensagens por minuto. Acima de ~10 o risco de banimento sobe muito. */
  perMinute: number;
  /** Janela permitida; ausente = dispara direto, sem respeitar horário. */
  window?: DispatchWindow | null;
  /**
   * Fuso do escritório em minutos de offset do UTC (Cuiabá = -240). A janela é
   * SEMPRE avaliada no horário do escritório: usar o relógio do navegador de
   * quem clicou faria a mesma campanha sair em horários diferentes.
   */
  officeUtcOffsetMinutes?: number;
}

export interface DispatchSlot {
  contactId: string;
  /** ISO UTC do envio planejado. */
  at: string;
  /** Posição na fila (0-based). */
  index: number;
}

const CUIABA_OFFSET_MINUTES = -240;

/** Minuto do dia e dia da semana de um instante, no fuso do escritório. */
function officeClock(ms: number, offsetMinutes: number): { minute: number; day: number } {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  return {
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    day: shifted.getUTCDay(),
  };
}

/** Avança o instante até cair dentro da janela permitida. */
function nextOpenSlot(ms: number, window: DispatchWindow, offsetMinutes: number): number {
  let cursor = ms;
  // No máximo 14 saltos: cobre feriado longo / janela só aos sábados.
  for (let i = 0; i < 14; i += 1) {
    const { minute, day } = officeClock(cursor, offsetMinutes);
    if (window.days.includes(day) && minute >= window.startMinute && minute < window.endMinute) return cursor;
    if (window.days.includes(day) && minute < window.startMinute) {
      cursor += (window.startMinute - minute) * 60_000;
      continue;
    }
    // Depois do fechamento (ou dia não permitido): pula para a abertura do dia seguinte.
    cursor += (24 * 60 - minute + window.startMinute) * 60_000;
  }
  return cursor;
}

/**
 * Distribui os envios no tempo. Não é enfeite: é o que separa uma campanha de
 * um flood. Com `perMinute = 6`, 300 contatos levam 50 minutos — e o número
 * continua vivo amanhã.
 */
export function planDispatch(
  eligible: CampaignContact[],
  opts: DispatchOptions,
): DispatchSlot[] {
  const perMinute = Math.max(1, Math.floor(opts.perMinute));
  const gapMs = 60_000 / perMinute;
  const offset = opts.officeUtcOffsetMinutes ?? CUIABA_OFFSET_MINUTES;
  const start = typeof opts.startAt === 'number' ? opts.startAt : Date.parse(opts.startAt);

  let cursor = Number.isNaN(start) ? Date.now() : start;
  if (opts.window) cursor = nextOpenSlot(cursor, opts.window, offset);

  return eligible.map((c, index) => {
    if (index > 0) {
      cursor += gapMs;
      if (opts.window) cursor = nextOpenSlot(cursor, opts.window, offset);
    }
    return { contactId: c.id, at: new Date(Math.round(cursor)).toISOString(), index };
  });
}

// ── Opt-out ──────────────────────────────────────────────────────────

const OPT_OUT_EXACT = [
  'sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover',
  'sai', 'para', 'chega', 'nao', 'não',
];

const OPT_OUT_PHRASES = [
  'nao quero receber', 'não quero receber',
  'nao quero mais receber', 'não quero mais receber',
  'para de mandar', 'pare de mandar', 'pare de me mandar',
  'me tira da lista', 'me tire da lista', 'tirar da lista',
  'nao me mande', 'não me mande', 'nao envie mais', 'não envie mais',
  'cancelar inscricao', 'cancelar inscrição', 'descadastrar',
  'nao tenho interesse', 'não tenho interesse',
];

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * O contato pediu para sair da lista?
 *
 * Frase explícita ("não quero mais receber") sempre conta. Palavra solta
 * ("parar") só conta em mensagem CURTA: num atendimento de verdade, "vamos
 * parar por aqui e retomo amanhã" não é descadastro, e tratar como tal
 * silenciaria um cliente ativo.
 */
export function isOptOutMessage(text: string | null | undefined): boolean {
  const raw = (text || '').trim();
  if (!raw) return false;
  const normalized = stripAccents(raw.toLowerCase()).replace(/[.!?,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  if (OPT_OUT_PHRASES.some(p => normalized.includes(stripAccents(p)))) return true;

  const words = normalized.split(' ');
  if (words.length <= 2 && words.some(w => OPT_OUT_EXACT.includes(w))) return true;

  return false;
}

// ── Métricas ─────────────────────────────────────────────────────────

export type CampaignEventKind =
  | 'queued' | 'sent' | 'failed' | 'delivered' | 'read' | 'replied' | 'opted_out' | 'converted';

export interface CampaignEvent {
  contactId: string;
  kind: CampaignEventKind;
  at?: string;
}

export interface CampaignMetrics {
  queued: number;
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  replied: number;
  optedOut: number;
  converted: number;
  /** Percentuais 0–1 sobre a base honesta de cada etapa. */
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  optOutRate: number;
  conversionRate: number;
}

const rate = (num: number, den: number) => (den > 0 ? num / den : 0);

/**
 * Consolida os eventos por CONTATO (não por evento): três "delivered" do mesmo
 * destinatário são uma entrega, senão a taxa passa de 100% e ninguém confia
 * mais no relatório.
 */
export function campaignMetrics(events: CampaignEvent[]): CampaignMetrics {
  const byKind: Record<CampaignEventKind, Set<string>> = {
    queued: new Set(), sent: new Set(), failed: new Set(), delivered: new Set(),
    read: new Set(), replied: new Set(), opted_out: new Set(), converted: new Set(),
  };
  for (const e of events) byKind[e.kind]?.add(e.contactId);

  const sent = byKind.sent.size;
  const delivered = byKind.delivered.size;
  const read = byKind.read.size;
  const replied = byKind.replied.size;

  return {
    queued: byKind.queued.size,
    sent,
    failed: byKind.failed.size,
    delivered,
    read,
    replied,
    optedOut: byKind.opted_out.size,
    converted: byKind.converted.size,
    deliveryRate: rate(delivered, sent),
    readRate: rate(read, delivered),
    replyRate: rate(replied, delivered),
    optOutRate: rate(byKind.opted_out.size, delivered),
    conversionRate: rate(byKind.converted.size, replied),
  };
}
