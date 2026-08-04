// DEV-ONLY: motor da simulação de operação do WhatsApp.
//
// Simula um dia de atendimento do escritório minuto a minuto: contatos que
// chegam, vários atendentes com capacidade e ritmo diferentes, distribuição
// automática, encaminhamento para advogado com aceite (ou aceite que nunca
// vem), campanha de reativação e o SLA correndo por trás de tudo.
//
// A graça é que ele NÃO reimplementa regra nenhuma: distribuição, fila,
// transferência e campanha vêm dos mesmos módulos que o app usa. Se a regra
// muda, o resultado da simulação muda junto — é aqui que dá para ver o efeito
// de "aumentar a capacidade da recepção" ou "encurtar o timeout de aceite"
// antes de mexer na operação de verdade.
//
// Determinístico: a mesma semente produz exatamente o mesmo dia.
import {
  distributeQueue, rankQueue, stalledTransfers, agentLoads,
  DEFAULT_QUEUE_POLICY,
  type RoutingAgent, type QueueItem, type QueuePolicy,
} from '../components/whatsapp/attendanceRouting';
import {
  suggestLawyers, validateTransfer, buildHandoffNote,
  type TransferStaff,
} from '../components/whatsapp/transferPolicy';
import {
  buildAudience, applyCampaignGuards, planDispatch, isOptOutMessage, campaignMetrics,
  BUSINESS_WINDOW,
  type CampaignContact, type CampaignEvent, type CampaignMetrics, type DispatchSlot,
} from '../components/whatsapp/campaign';

// ── Aleatoriedade reproduzível ───────────────────────────────────────
/** mulberry32: gerador simples e determinístico — mesma semente, mesmo dia. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Domínio da simulação ─────────────────────────────────────────────

export const SIM_CHANNEL = 'canal-principal';

export interface SimAgent {
  userId: string;
  name: string;
  role: string;
  isLawyer: boolean;
  departmentIds: string[];
  capacity: number;
  availability: RoutingAgent['availability'];
  /** Minutos médios para redigir uma resposta (vira probabilidade por minuto). */
  responseMinutes: number;
  /** Chance por minuto de aceitar uma transferência que chegou para ele. */
  acceptRate: number;
  lastAssignedAt: string | null;
  stats: {
    received: number;
    answered: number;
    closed: number;
    transferredOut: number;
    accepted: number;
  };
}

export type SimTopic = 'previdenciario' | 'trabalhista' | 'financeiro' | 'documentos' | 'informacao';

export interface SimConversation {
  id: string;
  contactName: string;
  phone: string;
  channelId: string;
  departmentId: string | null;
  assignedUserId: string | null;
  status: 'open' | 'closed';
  awaitingAccept: boolean;
  transferPendingSince: string | null;
  pendingTargetUserId: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  lastCustomerMessageAt: string | null;
  lastMessageAt: string | null;
  labels: string[];
  topic: SimTopic;
  /** Assunto que exige advogado (o motor encaminha sozinho). */
  requiresLawyer: boolean;
  origin: 'entrada' | 'campanha';
  clientId: string | null;
  createdAt: string;
  firstResponseAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** Trocas já feitas × trocas necessárias para resolver o caso. */
  exchanges: number;
  needed: number;
  /** Atendentes que já passaram pela conversa (continuidade + ping-pong). */
  touchedBy: string[];
  transfers: Array<{ fromUserId: string | null; toUserId: string | null; toDepartmentId: string | null; at: string }>;
  optOut: boolean;
  lastCampaignAt: string | null;
  /** A reação ao disparo já foi sorteada (uma vez por destinatário, nunca por minuto). */
  campaignReacted: boolean;
  isBlocked: boolean;
}

export type SimEventTone = 'info' | 'ok' | 'warn' | 'danger' | 'campaign';

export interface SimEvent {
  minute: number;
  at: string;
  tone: SimEventTone;
  text: string;
  conversationId?: string;
  agentId?: string;
}

export interface SimConfig {
  seed: number;
  /** Contatos novos por hora no pico. */
  arrivalsPerHour: number;
  /** Minuto (desde o início) em que a campanha dispara. `null` = sem campanha. */
  campaignAtMinute: number | null;
  /** Mensagens por minuto da campanha. */
  campaignPerMinute: number;
  /** Teto de destinatários da campanha. */
  campaignMaxRecipients: number;
  /** Timeout de aceite da transferência (min). */
  transferAcceptTimeout: number;
  /** Devolver automaticamente à fila quando o aceite estoura. */
  autoReturnStalled: boolean;
  /** Distribuir automaticamente (desligado = fila manual, como hoje). */
  autoDistribute: boolean;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  seed: 20260804,
  arrivalsPerHour: 14,
  campaignAtMinute: 120,
  campaignPerMinute: 6,
  campaignMaxRecipients: 40,
  transferAcceptTimeout: 15,
  autoReturnStalled: true,
  autoDistribute: true,
};

export interface SimState {
  config: SimConfig;
  /** Minutos decorridos desde a abertura do expediente. */
  minute: number;
  /** Instante simulado (ISO). */
  now: string;
  agents: SimAgent[];
  conversations: SimConversation[];
  events: SimEvent[];
  campaign: {
    launched: boolean;
    plan: DispatchSlot[];
    dispatched: number;
    skipped: Array<{ id: string; reason: string }>;
    events: CampaignEvent[];
  };
  /** Contadores acumulados que não dá para reconstruir do estado final. */
  counters: {
    arrived: number;
    firstResponses: number;
    firstResponseTotalMinutes: number;
    resolutionTotalMinutes: number;
    abandoned: number;
    slaBreached: number;
    transfersMade: number;
    transfersAccepted: number;
    transfersExpired: number;
    optOuts: number;
  };
  rngState: number;
}

// Expediente começa às 08:00 de Cuiabá (UTC-4) = 12:00 UTC.
const DAY_START_ISO = '2026-08-04T12:00:00.000Z';
const DAY_START_MS = Date.parse(DAY_START_ISO);

// Assunto jurídico entra pela RECEPÇÃO, como no escritório de verdade: ninguém
// sabe que é caso previdenciário antes de alguém perguntar. É a triagem que
// descobre e encaminha — e é justamente esse encaminhamento que a simulação
// existe para medir. Financeiro, esse sim, é roteado direto.
const TOPICS: Array<{ topic: SimTopic; weight: number; lawyer: boolean; department: string; label: string }> = [
  { topic: 'previdenciario', weight: 30, lawyer: true, department: 'recepcao', label: 'Aposentadoria / INSS' },
  { topic: 'trabalhista', weight: 18, lawyer: true, department: 'recepcao', label: 'Verbas rescisórias' },
  { topic: 'financeiro', weight: 16, lawyer: false, department: 'financeiro', label: 'Boleto / honorários' },
  { topic: 'documentos', weight: 20, lawyer: false, department: 'recepcao', label: 'Envio de documentos' },
  { topic: 'informacao', weight: 16, lawyer: false, department: 'recepcao', label: 'Andamento do processo' },
];

const FIRST_NAMES = ['Maria', 'José', 'Ana', 'Carlos', 'Fernanda', 'Rafael', 'Luciana', 'Marcos', 'Patrícia', 'Rodrigo', 'Juliana', 'Vicente', 'Eliane', 'Douglas', 'Sandra', 'Wesley'];
const LAST_NAMES = ['Souza', 'Oliveira', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Nogueira', 'Barbosa', 'Teixeira', 'Moraes'];

export function createAgents(): SimAgent[] {
  const base = (patch: Partial<SimAgent> & Pick<SimAgent, 'userId' | 'name' | 'role'>): SimAgent => ({
    isLawyer: false,
    departmentIds: ['recepcao'],
    capacity: 6,
    availability: 'available',
    responseMinutes: 4,
    acceptRate: 0.35,
    lastAssignedAt: null,
    stats: { received: 0, answered: 0, closed: 0, transferredOut: 0, accepted: 0 },
    ...patch,
  });
  return [
    base({ userId: 'carla', name: 'Carla', role: 'Recepção', capacity: 7, responseMinutes: 3 }),
    base({ userId: 'bruno', name: 'Bruno', role: 'Recepção', capacity: 6, responseMinutes: 5 }),
    base({ userId: 'ellen', name: 'Ellen', role: 'Financeiro', departmentIds: ['financeiro'], capacity: 5, responseMinutes: 6 }),
    base({
      userId: 'dra-ana', name: 'Dra. Ana', role: 'Advogada', isLawyer: true,
      departmentIds: ['juridico'], capacity: 5, responseMinutes: 9, acceptRate: 0.3,
    }),
    base({
      userId: 'dr-pedro', name: 'Dr. Pedro', role: 'Advogado', isLawyer: true,
      departmentIds: ['juridico', 'recepcao'], capacity: 4, responseMinutes: 12, acceptRate: 0.18,
    }),
  ];
}

export function createWorld(config: Partial<SimConfig> = {}): SimState {
  const merged = { ...DEFAULT_SIM_CONFIG, ...config };
  return {
    config: merged,
    minute: 0,
    now: DAY_START_ISO,
    agents: createAgents(),
    conversations: [],
    events: [{
      minute: 0, at: DAY_START_ISO, tone: 'info',
      text: 'Expediente aberto — 08:00 (America/Cuiaba).',
    }],
    campaign: { launched: false, plan: [], dispatched: 0, skipped: [], events: [] },
    counters: {
      arrived: 0, firstResponses: 0, firstResponseTotalMinutes: 0, resolutionTotalMinutes: 0,
      abandoned: 0, slaBreached: 0, transfersMade: 0, transfersAccepted: 0, transfersExpired: 0, optOuts: 0,
    },
    rngState: merged.seed >>> 0,
  };
}

// ── Adaptadores para os módulos reais ────────────────────────────────

function toQueueItem(c: SimConversation): QueueItem {
  return {
    id: c.id,
    status: c.status,
    isBlocked: c.isBlocked,
    assignedUserId: c.assignedUserId,
    departmentId: c.departmentId,
    awaitingAccept: c.awaitingAccept,
    transferPendingSince: c.transferPendingSince,
    lastMessageDirection: c.lastMessageDirection,
    lastCustomerMessageAt: c.lastCustomerMessageAt,
    lastMessageAt: c.lastMessageAt,
    labels: c.labels,
  };
}

function toRoutingAgent(a: SimAgent, load: number): RoutingAgent {
  return {
    userId: a.userId,
    name: a.name,
    role: a.role,
    isLawyer: a.isLawyer,
    availability: a.availability,
    capacity: a.capacity,
    openLoad: load,
    departmentIds: a.departmentIds,
    channelIds: '*',
    lastAssignedAt: a.lastAssignedAt,
  };
}

function toTransferStaff(a: SimAgent, load: number): TransferStaff {
  return {
    userId: a.userId,
    name: a.name,
    role: a.role,
    isActive: true,
    availability: a.availability,
    capacity: a.capacity,
    openLoad: load,
    departmentIds: a.departmentIds,
    channelIds: '*',
  };
}

function toCampaignContact(c: SimConversation): CampaignContact {
  return {
    id: c.id,
    phone: c.phone,
    name: c.contactName,
    clientId: c.clientId,
    channelId: c.channelId,
    departmentId: c.departmentId,
    labels: c.labels,
    status: c.status,
    isBlocked: c.isBlocked,
    optOut: c.optOut,
    lastInboundAt: c.lastCustomerMessageAt,
    lastCampaignAt: c.lastCampaignAt,
  };
}

const QUEUE_POLICY: QueuePolicy = { ...DEFAULT_QUEUE_POLICY };

// ── Passo da simulação ───────────────────────────────────────────────

/** Avança UM minuto simulado. Sempre devolve um estado novo (nunca muta). */
export function stepWorld(prev: SimState): SimState {
  // Cada minuto tem seu próprio fluxo, derivado de (semente, minuto). Isso
  // mantém o dia reproduzível sem precisar carregar o estado interno do
  // gerador de um passo para o outro.
  const rng = mulberry32((prev.rngState ^ (prev.minute * 2654435761)) >>> 0);

  const minute = prev.minute + 1;
  const nowMs = DAY_START_MS + minute * 60_000;
  const now = new Date(nowMs).toISOString();
  const nowIso = now;

  const agents = prev.agents.map(a => ({ ...a, stats: { ...a.stats } }));
  let conversations = prev.conversations.map(c => ({ ...c }));
  const events: SimEvent[] = [];
  const counters = { ...prev.counters };
  const campaign = {
    ...prev.campaign,
    plan: prev.campaign.plan,
    skipped: prev.campaign.skipped,
    events: [...prev.campaign.events],
  };

  const log = (tone: SimEventTone, text: string, extra?: { conversationId?: string; agentId?: string }) => {
    events.push({ minute, at: now, tone, text, ...extra });
  };
  const agentById = (id: string | null) => agents.find(a => a.userId === id) ?? null;
  const nameOf = (id: string | null) => agentById(id)?.name ?? '—';

  // Horário do ESCRITÓRIO (Cuiabá, UTC-4) — nunca o do navegador de quem abre
  // o simulador. É a mesma âncora de fuso que a agenda do CRM usa.
  const office = new Date(nowMs - 4 * 3600_000);
  const officeMinuteOfDay = office.getUTCHours() * 60 + office.getUTCMinutes();
  const withinBusinessHours = BUSINESS_WINDOW.days.includes(office.getUTCDay())
    && officeMinuteOfDay >= BUSINESS_WINDOW.startMinute
    && officeMinuteOfDay < BUSINESS_WINDOW.endMinute;

  // ── 1. Chegada de novos contatos ───────────────────────────────────
  // Fora do expediente ainda chega mensagem (o cliente não olha o relógio),
  // mas num ritmo bem menor.
  const arrivalChance = (prev.config.arrivalsPerHour / 60) * (withinBusinessHours ? 1 : 0.2);
  if (rng() < arrivalChance) {
    const roll = rng() * TOPICS.reduce((s, t) => s + t.weight, 0);
    let acc = 0;
    const picked = TOPICS.find(t => (acc += t.weight) >= roll) ?? TOPICS[0];
    const name = `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]}`;
    const id = `c${String(counters.arrived + 1).padStart(3, '0')}`;
    const urgent = rng() < 0.08;
    conversations.push({
      id,
      contactName: name,
      phone: `55659${String(80_000_000 + Math.floor(rng() * 9_000_000))}`,
      channelId: SIM_CHANNEL,
      departmentId: picked.department,
      assignedUserId: null,
      status: 'open',
      awaitingAccept: false,
      transferPendingSince: null,
      pendingTargetUserId: null,
      lastMessageDirection: 'in',
      lastCustomerMessageAt: now,
      lastMessageAt: now,
      labels: urgent ? ['Urgente'] : [],
      topic: picked.topic,
      requiresLawyer: picked.lawyer,
      origin: 'entrada',
      clientId: rng() < 0.45 ? `cli-${id}` : null,
      createdAt: now,
      firstResponseAt: null,
      closedAt: null,
      closeReason: null,
      exchanges: 0,
      needed: 2 + Math.floor(rng() * 3),
      touchedBy: [],
      transfers: [],
      optOut: false,
      lastCampaignAt: null,
      campaignReacted: false,
      isBlocked: false,
    });
    counters.arrived += 1;
    log('info', `${name} entrou em contato — ${picked.label}${urgent ? ' (urgente)' : ''}`, { conversationId: id });
  }

  // ── 2. Cliente responde / desiste ──────────────────────────────────
  for (const c of conversations) {
    if (c.status === 'closed') continue;

    // Esperamos a resposta do cliente: ele volta em algum momento.
    if (c.lastMessageDirection === 'out' && c.assignedUserId && !c.awaitingAccept) {
      if (rng() < 0.12) {
        c.lastMessageDirection = 'in';
        c.lastCustomerMessageAt = now;
        c.lastMessageAt = now;
        if (c.origin === 'campanha') {
          campaign.events.push({ contactId: c.id, kind: 'replied', at: now });
        }
      }
      continue;
    }

    // O cliente está esperando por nós há muito tempo: alguns desistem.
    if (c.lastMessageDirection === 'in') {
      const waited = (nowMs - Date.parse(c.lastCustomerMessageAt ?? c.createdAt)) / 60_000;
      if (waited > 45 && rng() < 0.02) {
        c.status = 'closed';
        c.closedAt = now;
        c.closeReason = 'cliente desistiu de esperar';
        counters.abandoned += 1;
        log('danger', `${c.contactName} desistiu depois de ${Math.round(waited)}min sem resposta`, { conversationId: c.id });
      }
    }
  }

  // ── 3. Distribuição automática ─────────────────────────────────────
  if (prev.config.autoDistribute) {
    const loads = agentLoads(conversations.map(toQueueItem));
    const routingAgents = agents.map(a => toRoutingAgent(a, loads[a.userId] ?? 0));
    const { assignments } = distributeQueue(
      conversations.map(toQueueItem),
      routingAgents,
      nowMs,
      {
        policy: QUEUE_POLICY,
        channelOf: () => SIM_CHANNEL,
        requiresLawyer: () => false, // a triagem humana encaminha depois
        preferredAgentOf: id => {
          const conv = conversations.find(x => x.id === id);
          return conv?.touchedBy[conv.touchedBy.length - 1] ?? null;
        },
      },
    );
    for (const a of assignments) {
      const conv = conversations.find(x => x.id === a.conversationId);
      const agent = agentById(a.userId);
      if (!conv || !agent) continue;
      conv.assignedUserId = a.userId;
      if (!conv.touchedBy.includes(a.userId)) conv.touchedBy.push(a.userId);
      agent.lastAssignedAt = nowIso;
      agent.stats.received += 1;
      log('info', `Fila → ${agent.name} recebeu ${conv.contactName} (${a.reason})`, { conversationId: conv.id, agentId: agent.userId });
    }
  }

  // ── 4. Aceite das transferências pendentes ─────────────────────────
  for (const c of conversations) {
    if (!c.awaitingAccept || c.status === 'closed') continue;
    const target = agentById(c.pendingTargetUserId);
    if (!target) continue;
    if (target.availability === 'offline' || target.availability === 'away') continue;
    if (rng() < target.acceptRate) {
      c.awaitingAccept = false;
      c.transferPendingSince = null;
      c.assignedUserId = target.userId;
      c.pendingTargetUserId = null;
      if (!c.touchedBy.includes(target.userId)) c.touchedBy.push(target.userId);
      target.stats.accepted += 1;
      target.stats.received += 1;
      target.lastAssignedAt = nowIso;
      counters.transfersAccepted += 1;
      log('ok', `${target.name} aceitou o atendimento de ${c.contactName}`, { conversationId: c.id, agentId: target.userId });
    }
  }

  // ── 5. Transferências travadas ─────────────────────────────────────
  const stalled = stalledTransfers(conversations.map(toQueueItem), nowMs, prev.config.transferAcceptTimeout);
  for (const s of stalled) {
    const c = conversations.find(x => x.id === s.id);
    if (!c) continue;
    counters.transfersExpired += 1;
    if (prev.config.autoReturnStalled) {
      const target = nameOf(c.pendingTargetUserId);
      c.awaitingAccept = false;
      c.transferPendingSince = null;
      c.pendingTargetUserId = null;
      c.assignedUserId = null;
      log('warn', `Aceite de ${target} estourou (${Math.round(s.pendingMinutes)}min) — ${c.contactName} devolvido à fila`, { conversationId: c.id });
    } else {
      log('danger', `${c.contactName} está há ${Math.round(s.pendingMinutes)}min sem ninguém aceitar`, { conversationId: c.id });
    }
  }

  // ── 6. Trabalho dos atendentes ─────────────────────────────────────
  const ranked = rankQueue(conversations.map(toQueueItem), nowMs, QUEUE_POLICY);
  const rankIndex = new Map(ranked.map((p, i) => [p.id, i]));

  for (const agent of agents) {
    if (agent.availability === 'offline' || agent.availability === 'away') continue;
    // Cada atendente cuida da SUA conversa mais urgente por vez.
    const mine = conversations
      .filter(c => c.status !== 'closed' && !c.awaitingAccept && c.assignedUserId === agent.userId && c.lastMessageDirection === 'in')
      .sort((a, b) => (rankIndex.get(a.id) ?? 999) - (rankIndex.get(b.id) ?? 999));
    const target = mine[0];
    if (!target) continue;
    if (rng() > 1 / agent.responseMinutes) continue;

    // Assunto jurídico na mão de quem não é advogado → encaminha.
    if (target.requiresLawyer && !agent.isLawyer && target.exchanges >= 1) {
      const loads = agentLoads(conversations.map(toQueueItem));
      const staff = agents.map(a => toTransferStaff(a, loads[a.userId] ?? 0));
      const suggestions = suggestLawyers(
        staff,
        { channelId: SIM_CHANNEL, currentAssignee: agent.userId },
        { previousAgentIds: target.touchedBy, departmentId: 'juridico', topic: target.topic },
      );
      const choice = suggestions[0];
      if (choice) {
        const validation = validateTransfer(
          {
            conversationId: target.id,
            channelId: SIM_CHANNEL,
            currentAssignee: agent.userId,
            currentDepartment: target.departmentId,
            awaitingAccept: target.awaitingAccept,
            status: target.status,
            isBlocked: target.isBlocked,
            history: target.transfers,
          },
          { toUserId: choice.userId, toDepartmentId: 'juridico', byUserId: agent.userId },
          staff,
          nowMs,
        );
        if (validation.ok) {
          target.awaitingAccept = true;
          target.transferPendingSince = now;
          target.pendingTargetUserId = choice.userId;
          target.departmentId = 'juridico';
          target.assignedUserId = choice.userId;
          target.transfers.push({ fromUserId: agent.userId, toUserId: choice.userId, toDepartmentId: 'juridico', at: now });
          // A nota de handoff é o que evita o cliente repetir o caso do zero.
          void buildHandoffNote({
            fromName: agent.name, clientName: target.contactName, topic: target.topic,
            summary: `${target.exchanges} trocas na triagem`,
          });
          agent.stats.transferredOut += 1;
          counters.transfersMade += 1;
          const why = validation.warnings.length ? ` (${validation.warnings[0].message})` : '';
          log('warn', `${agent.name} encaminhou ${target.contactName} para ${choice.name}${why}`, { conversationId: target.id, agentId: agent.userId });
          continue;
        }
        log('danger', `${agent.name} não conseguiu encaminhar ${target.contactName}: ${validation.blocks[0]?.message}`, { conversationId: target.id });
      }
    }

    // Resposta normal.
    if (!target.firstResponseAt) {
      target.firstResponseAt = now;
      const waited = (nowMs - Date.parse(target.createdAt)) / 60_000;
      counters.firstResponses += 1;
      counters.firstResponseTotalMinutes += waited;
      if (waited > QUEUE_POLICY.slaBreachMinutes) counters.slaBreached += 1;
    }
    target.lastMessageDirection = 'out';
    target.lastMessageAt = now;
    target.exchanges += 1;
    agent.stats.answered += 1;

    if (target.exchanges >= target.needed) {
      target.status = 'closed';
      target.closedAt = now;
      target.closeReason = 'atendimento concluído';
      counters.resolutionTotalMinutes += (nowMs - Date.parse(target.createdAt)) / 60_000;
      agent.stats.closed += 1;
      log('ok', `${agent.name} concluiu o atendimento de ${target.contactName}`, { conversationId: target.id, agentId: agent.userId });
    }
  }

  // ── 7. Campanha ────────────────────────────────────────────────────
  if (prev.config.campaignAtMinute != null && !campaign.launched && minute >= prev.config.campaignAtMinute) {
    const audience = buildAudience(
      conversations.map(toCampaignContact),
      { channelId: SIM_CHANNEL, inactiveForDays: 0 },
      nowMs,
    );
    const { eligible, skipped } = applyCampaignGuards(
      audience,
      { cooldownDays: 14, skipOpenConversations: true, maxRecipients: prev.config.campaignMaxRecipients },
      nowMs,
    );
    const plan = planDispatch(eligible, {
      startAt: nowMs,
      perMinute: prev.config.campaignPerMinute,
      window: BUSINESS_WINDOW,
    });
    campaign.launched = true;
    campaign.plan = plan;
    campaign.skipped = skipped;
    for (const slot of plan) campaign.events.push({ contactId: slot.contactId, kind: 'queued', at: slot.at });
    log('campaign', `Campanha de reativação disparada: ${eligible.length} destinatários, ${skipped.length} fora das regras (${prev.config.campaignPerMinute}/min).`);
  }

  if (campaign.launched && campaign.dispatched < campaign.plan.length) {
    for (let i = campaign.dispatched; i < campaign.plan.length; i += 1) {
      const slot = campaign.plan[i];
      if (Date.parse(slot.at) > nowMs) break;
      campaign.dispatched = i + 1;
      const c = conversations.find(x => x.id === slot.contactId);
      if (!c) continue;
      campaign.events.push({ contactId: c.id, kind: 'sent', at: now });
      c.lastCampaignAt = now;
      c.campaignReacted = false;
      c.origin = 'campanha';
      c.status = 'open';
      c.closedAt = null;
      c.closeReason = null;
      c.assignedUserId = null;
      c.lastMessageDirection = 'out';
      c.lastMessageAt = now;
      c.exchanges = 0;
      c.needed = 2;
      c.firstResponseAt = null;
      // Entrega quase sempre acontece; leitura, nem tanto.
      if (rng() < 0.96) {
        campaign.events.push({ contactId: c.id, kind: 'delivered', at: now });
        if (rng() < 0.62) campaign.events.push({ contactId: c.id, kind: 'read', at: now });
      } else {
        campaign.events.push({ contactId: c.id, kind: 'failed', at: now });
      }
    }
  }

  // Reação dos destinatários: SORTEADA UMA VEZ por destinatário, ~15min após o
  // disparo. Sortear a cada minuto durante horas seria composição — a chance
  // acumularia até quase 100% e a taxa de opt-out do relatório viraria ficção.
  if (campaign.launched) {
    for (const c of conversations) {
      if (c.origin !== 'campanha' || c.campaignReacted || !c.lastCampaignAt) continue;
      const sinceSend = (nowMs - Date.parse(c.lastCampaignAt)) / 60_000;
      if (sinceSend < 15) continue;
      c.campaignReacted = true;
      if (c.lastMessageDirection === 'in') continue;
      const roll = rng();
      if (roll < 0.03) {
        // "não quero mais receber" — passa pelo mesmo detector que o app usa.
        const text = 'Não quero mais receber essas mensagens';
        if (isOptOutMessage(text)) {
          c.optOut = true;
          c.status = 'closed';
          c.closedAt = now;
          c.closeReason = 'pediu para não receber campanhas';
          counters.optOuts += 1;
          campaign.events.push({ contactId: c.id, kind: 'opted_out', at: now });
          log('warn', `${c.contactName} pediu para sair da lista de campanhas`, { conversationId: c.id });
        }
      } else if (roll < 0.28) {
        // Reabre no colo de quem atendeu por último, como o módulo real faz.
        // Repare no efeito: reabertura NÃO passa pela distribuição, então ela
        // fura a capacidade do atendente — é assim que "6/5" aparece no painel.
        c.lastMessageDirection = 'in';
        c.lastCustomerMessageAt = now;
        c.lastMessageAt = now;
        c.status = 'open';
        campaign.events.push({ contactId: c.id, kind: 'replied', at: now });
        log('campaign', `${c.contactName} respondeu à campanha`, { conversationId: c.id });
      }
    }
  }

  // Conversões: quem respondeu e foi concluído pela equipe.
  for (const c of conversations) {
    if (c.origin !== 'campanha' || c.status !== 'closed' || c.closeReason !== 'atendimento concluído') continue;
    const already = campaign.events.some(e => e.contactId === c.id && e.kind === 'converted');
    if (!already) campaign.events.push({ contactId: c.id, kind: 'converted', at: now });
  }

  // A lista de eventos é um log de operação: mantém só o recente.
  const allEvents = [...prev.events, ...events].slice(-400);

  return {
    config: prev.config,
    minute,
    now,
    agents,
    conversations,
    events: allEvents,
    campaign,
    counters,
    rngState: prev.rngState,
  };
}

/** Avança N minutos de uma vez (usado pelo botão "pular para…"). */
export function runMinutes(state: SimState, minutes: number): SimState {
  let out = state;
  for (let i = 0; i < minutes; i += 1) out = stepWorld(out);
  return out;
}

// ── Leitura do estado (para a UI) ────────────────────────────────────

export interface SimSnapshot {
  clock: string;
  open: number;
  queued: number;
  awaitingAccept: number;
  closed: number;
  abandoned: number;
  avgFirstResponse: number | null;
  avgResolution: number | null;
  slaBreached: number;
  transfersMade: number;
  transfersAccepted: number;
  transfersExpired: number;
  campaign: CampaignMetrics & { skipped: number; planned: number; dispatched: number };
  queue: Array<{ id: string; name: string; label: string; bucket: string; assignedTo: string | null }>;
  loads: Record<string, number>;
}

export function snapshot(state: SimState): SimSnapshot {
  const nowMs = Date.parse(state.now);
  const items = state.conversations.map(toQueueItem);
  const ranked = rankQueue(items, nowMs, QUEUE_POLICY);
  const loads = agentLoads(items);
  const byId = new Map(state.conversations.map(c => [c.id, c]));
  const nameOf = (id: string | null) => state.agents.find(a => a.userId === id)?.name ?? null;

  const open = state.conversations.filter(c => c.status !== 'closed').length;
  const closed = state.conversations.filter(c => c.status === 'closed' && c.closeReason === 'atendimento concluído').length;

  // Relógio no fuso do escritório (UTC-4), que é onde a operação acontece.
  const office = new Date(nowMs - 4 * 3600_000);
  const clock = `${String(office.getUTCHours()).padStart(2, '0')}:${String(office.getUTCMinutes()).padStart(2, '0')}`;

  return {
    clock,
    open,
    queued: state.conversations.filter(c => c.status !== 'closed' && !c.assignedUserId).length,
    awaitingAccept: state.conversations.filter(c => c.awaitingAccept).length,
    closed,
    abandoned: state.counters.abandoned,
    avgFirstResponse: state.counters.firstResponses > 0
      ? state.counters.firstResponseTotalMinutes / state.counters.firstResponses : null,
    avgResolution: closed > 0 ? state.counters.resolutionTotalMinutes / closed : null,
    slaBreached: state.counters.slaBreached,
    transfersMade: state.counters.transfersMade,
    transfersAccepted: state.counters.transfersAccepted,
    transfersExpired: state.counters.transfersExpired,
    campaign: {
      ...campaignMetrics(state.campaign.events),
      skipped: state.campaign.skipped.length,
      planned: state.campaign.plan.length,
      dispatched: state.campaign.dispatched,
    },
    queue: ranked.slice(0, 12).map(p => ({
      id: p.id,
      name: byId.get(p.id)?.contactName ?? p.id,
      label: p.label,
      bucket: p.bucket,
      assignedTo: nameOf(p.assignedUserId),
    })),
    loads,
  };
}
