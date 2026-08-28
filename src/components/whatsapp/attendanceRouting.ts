// Roteamento e priorização da fila de atendimento do WhatsApp.
//
// Hoje a conversa que chega fica SEM responsável até alguém abrir e clicar em
// "Assumir": quem grita mais alto (ou quem está com a inbox aberta) é atendido
// primeiro, e a conversa que ninguém viu envelhece em silêncio. Este módulo dá
// a regra que faltava — quem recebe o quê e o que a fila deve resolver agora.
//
// PURO DE PROPÓSITO: nenhum import (nem de tipo). É o que permite testar a
// regra com `node --test` e reusá-la no simulador de operação sem arrastar o
// app inteiro junto. Os tipos são estruturais: quem chama monta o recorte a
// partir de `WhatsAppConversation`/`StaffOption`.

// ── Agentes ──────────────────────────────────────────────────────────

/**
 * Disponibilidade operacional do agente. `busy` ainda recebe (só perde na
 * ordenação); `away`/`offline` são descartados — mandar conversa para quem não
 * está lá é o mesmo que não distribuir, só que sem ninguém perceber.
 */
export type AgentAvailability = 'available' | 'busy' | 'away' | 'offline';

export interface RoutingAgent {
  userId: string;
  name: string;
  /** Cargo livre do perfil ("Advogado", "Recepção"…). */
  role?: string | null;
  /** OAB preenchida ou cargo de advogado — quem pode receber assunto jurídico. */
  isLawyer?: boolean;
  availability: AgentAvailability;
  /** Máximo de conversas simultâneas. `0` = sem teto. */
  capacity: number;
  /** Conversas ativas atribuídas a ele agora. */
  openLoad: number;
  /** Setores a que pertence (whatsapp_department_members). */
  departmentIds: string[];
  /** Canais que enxerga; `'*'` quando o acesso é irrestrito. */
  channelIds: string[] | '*';
  /** ISO da última atribuição — desempate round-robin (o mais antigo leva). */
  lastAssignedAt?: string | null;
}

export interface RoutingRequest {
  conversationId: string;
  channelId: string | null;
  departmentId: string | null;
  /** O assunto exige advogado (etapa do funil, classificação da IA, pedido do cliente). */
  requiresLawyer?: boolean;
  /** Continuidade: quem já atendeu este cliente antes. */
  preferredUserId?: string | null;
  /** Quem NÃO pode receber (ex.: quem acabou de devolver a conversa). */
  excludeUserIds?: string[];
}

export interface RoutingCandidate {
  userId: string;
  score: number;
  reason: string;
}

export interface RoutingDecision {
  /** `null` quando ninguém é elegível — a conversa fica na fila do setor. */
  userId: string | null;
  reason: string;
  /** Ordem avaliada, do melhor ao pior — alimenta o "por que este atendente?". */
  ranked: RoutingCandidate[];
  /** Descartados com o motivo: é o diagnóstico de por que a fila não anda. */
  rejected: Array<{ userId: string; reason: string }>;
}

/** Ocupação de 0 a 1. Sem teto declarado, satura em 10 conversas simultâneas. */
export function occupancy(agent: Pick<RoutingAgent, 'capacity' | 'openLoad'>): number {
  const load = Math.max(0, agent.openLoad);
  if (agent.capacity > 0) return Math.min(1, load / agent.capacity);
  return Math.min(1, load / 10);
}

/** O agente ainda cabe mais uma conversa? Sem teto, sempre cabe. */
export function hasSlot(agent: Pick<RoutingAgent, 'capacity' | 'openLoad'>): boolean {
  return agent.capacity <= 0 || agent.openLoad < agent.capacity;
}

function seesChannel(agent: RoutingAgent, channelId: string | null): boolean {
  if (!channelId) return true;
  if (agent.channelIds === '*') return true;
  return agent.channelIds.includes(channelId);
}

/**
 * Escolhe o próximo atendente para uma conversa.
 *
 * A ordem é: continuidade (quem já falou com o cliente) → menor ocupação →
 * disponível na frente de ocupado → quem está há mais tempo sem receber
 * (round-robin real, e não "sempre o primeiro da lista"). O desempate final é
 * o `userId`, para a decisão ser determinística e reproduzível no simulador.
 */
export function pickNextAgent(
  agents: RoutingAgent[],
  request: RoutingRequest,
): RoutingDecision {
  const rejected: Array<{ userId: string; reason: string }> = [];
  const eligible: RoutingAgent[] = [];

  for (const agent of agents) {
    if (request.excludeUserIds?.includes(agent.userId)) {
      rejected.push({ userId: agent.userId, reason: 'excluído desta rodada' });
      continue;
    }
    if (agent.availability === 'offline' || agent.availability === 'away') {
      rejected.push({ userId: agent.userId, reason: agent.availability === 'offline' ? 'offline' : 'ausente' });
      continue;
    }
    if (request.requiresLawyer && !agent.isLawyer) {
      rejected.push({ userId: agent.userId, reason: 'não é advogado' });
      continue;
    }
    if (request.departmentId && !agent.departmentIds.includes(request.departmentId)) {
      rejected.push({ userId: agent.userId, reason: 'fora do setor de destino' });
      continue;
    }
    if (!seesChannel(agent, request.channelId)) {
      rejected.push({ userId: agent.userId, reason: 'sem acesso ao canal' });
      continue;
    }
    if (!hasSlot(agent)) {
      rejected.push({ userId: agent.userId, reason: `lotado (${agent.openLoad}/${agent.capacity})` });
      continue;
    }
    eligible.push(agent);
  }

  const ranked: RoutingCandidate[] = eligible
    .map(agent => {
      const reasons: string[] = [];
      let score = 100;
      if (request.preferredUserId && agent.userId === request.preferredUserId) {
        score += 40;
        reasons.push('já atendeu este cliente');
      }
      const occ = occupancy(agent);
      score += Math.round((1 - occ) * 30);
      reasons.push(agent.capacity > 0 ? `carga ${agent.openLoad}/${agent.capacity}` : `carga ${agent.openLoad}`);
      if (agent.availability === 'busy') {
        score -= 15;
        reasons.push('ocupado');
      }
      if (request.requiresLawyer && agent.isLawyer) reasons.push('advogado');
      return { userId: agent.userId, score, reason: reasons.join(' · ') };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Round-robin: quem está há mais tempo sem receber vai na frente. Nunca
      // ter recebido conta como "há mais tempo de todos".
      const agentA = eligible.find(x => x.userId === a.userId)!;
      const agentB = eligible.find(x => x.userId === b.userId)!;
      const tA = agentA.lastAssignedAt ? Date.parse(agentA.lastAssignedAt) : -Infinity;
      const tB = agentB.lastAssignedAt ? Date.parse(agentB.lastAssignedAt) : -Infinity;
      if (tA !== tB) return tA - tB;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });

  const winner = ranked[0] ?? null;
  return {
    userId: winner?.userId ?? null,
    reason: winner
      ? winner.reason
      : rejected.length > 0
        ? 'nenhum atendente elegível'
        : 'nenhum atendente cadastrado',
    ranked,
    rejected,
  };
}

// ── Fila ─────────────────────────────────────────────────────────────

/** Recorte mínimo da conversa que a fila precisa avaliar. */
export interface QueueItem {
  id: string;
  status: string;                       // 'open' | 'pending' | 'closed'
  /** Canal em que a conversa chegou — define qual expediente mede o SLA dela. */
  channelId?: string | null;
  isBlocked?: boolean | null;
  assignedUserId: string | null;
  departmentId: string | null;
  awaitingAccept?: boolean | null;
  transferPendingSince?: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  lastCustomerMessageAt?: string | null;
  lastMessageAt?: string | null;
  /** Ligação já registrada também transforma o rascunho em atendimento real. */
  lastCallAt?: string | null;
  labels?: string[] | null;
}

export type QueueBucket =
  | 'transferencia_travada'
  | 'sla_estourado'
  | 'urgente'
  | 'sla_atencao'
  | 'fila_setor'
  | 'aguardando_voce'
  | 'normal';

export interface QueuePriority {
  id: string;
  /** Quanto maior, mais urgente. Serve para ordenar e para o badge. */
  score: number;
  bucket: QueueBucket;
  label: string;
  /** Minutos parados aguardando alguém do escritório agir. */
  waitingMinutes: number;
  assignedUserId: string | null;
}

/**
 * Medição de tempo decorrido injetada na fila. Estruturalmente igual à
 * `ElapsedMinutes` de `businessTime` — declarada aqui, e não importada, porque
 * este módulo não tem imports de propósito (ver o cabeçalho).
 */
export type ElapsedMinutes = (fromMs: number, toMs: number, channelId?: string | null) => number;

export interface QueuePolicy {
  /** A partir daqui a espera do cliente vira "atenção". */
  slaWarnMinutes: number;
  /** A partir daqui a espera do cliente é violação de SLA. */
  slaBreachMinutes: number;
  /** Conversa parada na fila de um setor, sem dono, por tempo demais. */
  queueWarnMinutes: number;
  /** Transferência sem aceite por mais que isto está travada. */
  transferAcceptTimeoutMinutes: number;
  /** Etiquetas que empurram a conversa para o topo da fila. */
  urgentLabels: string[];
  /**
   * Como medir tempo decorrido. Ausente = relógio de parede.
   *
   * Injetar `businessTime.elapsedMinutesForChannels(agendas)` aqui faz TODA a
   * fila passar a raciocinar em horário útil: a mensagem de sexta 18h05 deixa
   * de chegar na segunda marcada como "parada há 62h" e a ordenação para de
   * promover a madrugada na frente de quem espera desde as 8h. Fica como
   * parâmetro (e não como import) para este módulo continuar sem dependências
   * e testável isoladamente. O `channelId` do item é repassado para cada
   * conversa ser medida no expediente do próprio canal.
   */
  elapsedMinutes?: ElapsedMinutes;
  /**
   * Patamares POR CANAL. Ausente = valem os números soltos acima.
   *
   * Mesma injeção do `elapsedMinutes`, e pelo mesmo motivo: este módulo não
   * importa nada, e quem sabe ler a linha do canal é o `slaPolicy`
   * (`queueThresholdsFor`). Sem isto, o plantão 24h e o comercial 8h–18h
   * dividiriam o mesmo prazo de resposta — e o número que a fila usa
   * divergiria do que o badge da conversa mostra.
   */
  thresholdsFor?: (channelId?: string | null) => QueueThresholds;
}

/** Os patamares que a fila consulta a cada item. */
export interface QueueThresholds {
  slaWarnMinutes: number;
  slaBreachMinutes: number;
  queueWarnMinutes: number;
  transferAcceptTimeoutMinutes: number;
}

export const DEFAULT_QUEUE_POLICY: QueuePolicy = {
  slaWarnMinutes: 15,
  slaBreachMinutes: 60,
  queueWarnMinutes: 30,
  transferAcceptTimeoutMinutes: 15,
  urgentLabels: ['Urgente'],
};

/**
 * A fila só pode operar sobre atendimentos que realmente começaram.
 *
 * Uma linha sem mensagem e sem ligação é apenas o rascunho criado ao abrir
 * "Nova conversa". A inbox já a oculta; deixá-la entrar no roteamento fazia o
 * botão "Próximo da fila" abrir um contato que não constava na lista.
 */
export function hasQueueActivity(item: Pick<QueueItem, 'lastMessageAt' | 'lastCallAt'>): boolean {
  return !!(item.lastMessageAt || item.lastCallAt);
}

function minutesSince(
  iso: string | null | undefined,
  now: number,
  elapsed?: ElapsedMinutes,
  channelId?: string | null,
): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  if (elapsed) return Math.max(0, elapsed(t, now, channelId ?? null));
  return Math.max(0, (now - t) / 60000);
}

function humanMinutes(m: number): string {
  const total = Math.floor(m);
  if (total < 60) return `${total}min`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  if (h < 24) return `${h}h${String(rest).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Pontua uma conversa na fila. `null` = está fora da fila (encerrada,
 * bloqueada, ou aguardando o CLIENTE responder — nesse caso a bola não é
 * nossa e ocupar o topo da fila com ela só esconde o que precisa de ação).
 */
export function scoreQueueItem(
  item: QueueItem,
  now: number,
  policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
): QueuePriority | null {
  if (!hasQueueActivity(item)) return null;
  if (item.isBlocked) return null;
  if (item.status === 'closed') return null;

  // Um resolve por item: os quatro patamares vêm do canal DELE.
  const limite: QueueThresholds = policy.thresholdsFor?.(item.channelId) ?? policy;

  const waiting = item.lastMessageDirection === 'in'
    ? minutesSince(item.lastCustomerMessageAt || item.lastMessageAt, now, policy.elapsedMinutes, item.channelId)
    : 0;
  const isUrgent = (item.labels ?? []).some(l => policy.urgentLabels.includes(l));

  // 1) Transferência sem aceite estourada: ninguém é dono e o cliente acha que
  // está sendo atendido. É o pior estado possível — vai na frente de tudo.
  if (item.awaitingAccept) {
    const pending = minutesSince(item.transferPendingSince, now, policy.elapsedMinutes, item.channelId);
    if (pending >= limite.transferAcceptTimeoutMinutes) {
      return {
        id: item.id, bucket: 'transferencia_travada',
        score: 900 + Math.min(99, Math.floor(pending)),
        label: `transferência sem aceite há ${humanMinutes(pending)}`,
        waitingMinutes: waiting, assignedUserId: item.assignedUserId,
      };
    }
  }

  // 2) SLA estourado com o cliente esperando.
  if (waiting >= limite.slaBreachMinutes) {
    return {
      id: item.id, bucket: 'sla_estourado',
      score: 800 + Math.min(99, Math.floor(waiting / 10)),
      label: `parada há ${humanMinutes(waiting)}`,
      waitingMinutes: waiting, assignedUserId: item.assignedUserId,
    };
  }

  // 3) Etiqueta urgente aplicada pela equipe.
  if (isUrgent) {
    return {
      id: item.id, bucket: 'urgente',
      score: 700 + Math.min(99, Math.floor(waiting)),
      label: waiting > 0 ? `urgente · ${humanMinutes(waiting)}` : 'urgente',
      waitingMinutes: waiting, assignedUserId: item.assignedUserId,
    };
  }

  // 4) Espera do cliente em zona de atenção.
  if (waiting >= limite.slaWarnMinutes) {
    return {
      id: item.id, bucket: 'sla_atencao',
      score: 600 + Math.min(99, Math.floor(waiting)),
      label: `parada há ${humanMinutes(waiting)}`,
      waitingMinutes: waiting, assignedUserId: item.assignedUserId,
    };
  }

  // 5) Na fila de um setor, sem dono, envelhecendo.
  if (!item.assignedUserId && item.departmentId && !item.awaitingAccept) {
    const queued = minutesSince(item.lastMessageAt, now, policy.elapsedMinutes, item.channelId);
    if (queued >= limite.queueWarnMinutes) {
      return {
        id: item.id, bucket: 'fila_setor',
        score: 500 + Math.min(99, Math.floor(queued / 2)),
        label: `na fila há ${humanMinutes(queued)}`,
        waitingMinutes: waiting, assignedUserId: item.assignedUserId,
      };
    }
  }

  // 6) Cliente falou por último e ainda está dentro do prazo.
  if (item.lastMessageDirection === 'in') {
    return {
      id: item.id, bucket: 'aguardando_voce',
      score: 300 + Math.min(99, Math.floor(waiting)),
      label: waiting >= 1 ? `aguardando há ${humanMinutes(waiting)}` : 'aguardando você',
      waitingMinutes: waiting, assignedUserId: item.assignedUserId,
    };
  }

  // 7) Sem dono e sem setor: existe, mas não pressiona ninguém ainda.
  if (!item.assignedUserId) {
    return {
      id: item.id, bucket: 'normal', score: 100,
      label: 'sem responsável',
      waitingMinutes: waiting, assignedUserId: null,
    };
  }

  return null;
}

/** Fila ordenada do mais urgente ao menos urgente (empate: id, para estabilidade). */
export function rankQueue(
  items: QueueItem[],
  now: number,
  policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
): QueuePriority[] {
  return items
    .map(item => scoreQueueItem(item, now, policy))
    .filter((p): p is QueuePriority => p !== null)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * O que o atendente deve pegar agora. Por padrão só oferece o que está sem
 * dono — puxar a conversa de um colega no meio do atendimento é atropelo, não
 * produtividade. `includeMine` permite retomar as próprias que estão paradas.
 */
export function nextInQueue(
  items: QueueItem[],
  now: number,
  opts: { agentUserId?: string | null; includeMine?: boolean; policy?: QueuePolicy } = {},
): QueuePriority | null {
  const ranked = rankQueue(items, now, opts.policy);
  for (const p of ranked) {
    if (!p.assignedUserId) return p;
    if (opts.includeMine && opts.agentUserId && p.assignedUserId === opts.agentUserId) return p;
  }
  return null;
}

/**
 * Transferências que o destino nunca aceitou. É o vazamento clássico da
 * operação: a conversa some do radar de quem transferiu e nunca entrou no de
 * quem deveria receber. Devolver para a fila é o desfecho correto.
 */
export function stalledTransfers(
  items: QueueItem[],
  now: number,
  timeoutMinutes: number = DEFAULT_QUEUE_POLICY.transferAcceptTimeoutMinutes,
  elapsed?: ElapsedMinutes,
): Array<{ id: string; pendingMinutes: number }> {
  const out: Array<{ id: string; pendingMinutes: number }> = [];
  for (const item of items) {
    if (!hasQueueActivity(item)) continue;
    if (!item.awaitingAccept || item.isBlocked || item.status === 'closed') continue;
    // Também em horário útil: encaminhar às 17h55 e o destino aceitar às 8h05
    // do dia seguinte são 10 minutos de espera real, não 14 horas de abandono.
    const pending = minutesSince(item.transferPendingSince, now, elapsed, item.channelId);
    if (pending >= timeoutMinutes) out.push({ id: item.id, pendingMinutes: pending });
  }
  return out.sort((a, b) => b.pendingMinutes - a.pendingMinutes);
}

/** Carga viva por atendente: conversas ativas (não encerradas, não bloqueadas). */
export function agentLoads(items: QueueItem[]): Record<string, number> {
  const loads: Record<string, number> = {};
  for (const item of items) {
    if (!hasQueueActivity(item)) continue;
    if (!item.assignedUserId) continue;
    if (item.status === 'closed' || item.isBlocked) continue;
    loads[item.assignedUserId] = (loads[item.assignedUserId] ?? 0) + 1;
  }
  return loads;
}

// ── Diagnóstico da fila ──────────────────────────────────────────────

export interface QueueHealthBucket {
  bucket: QueueBucket;
  count: number;
  /** Espera do item mais antigo do grupo — o que dói de verdade. */
  oldestMinutes: number;
}

export interface QueueHealth {
  /** Conversas que a fila considera pendentes de alguma ação nossa. */
  total: number;
  /** Dessas, quantas não têm responsável. */
  unassigned: number;
  buckets: QueueHealthBucket[];
  stalled: Array<{ id: string; pendingMinutes: number }>;
  /**
   * O que está errado, em ordem de quem precisa agir primeiro.
   *
   * Falha de processo vem antes de problema de vazão: uma fila com capacidade
   * de sobra mas com transferências que ninguém aceitou NÃO é saudável — ali o
   * cliente já está esperando por um atendimento que ninguém assumiu. Só depois
   * de descartadas as falhas é que faz sentido perguntar se a equipe dá conta
   * do volume, e aí a distinção importa: parada com todo mundo lotado é
   * dimensionamento, parada com gente livre é roteamento.
   */
  diagnosis:
    | 'vazia'
    | 'transferencias_travadas'
    | 'sla_estourado'
    | 'ninguem_disponivel'
    | 'equipe_lotada'
    | 'acumulando'
    | 'saudavel';
  /** Atendentes sem vaga agora. */
  saturatedAgents: string[];
  /** Atendentes com vaga sobrando enquanto a fila espera. */
  idleAgents: string[];
}

/**
 * Fotografia da fila para o painel de operação: quantos estão em cada estado,
 * há quanto tempo, e — o que a inbox nunca disse — POR QUE está assim.
 */
export function queueHealth(
  items: QueueItem[],
  agents: RoutingAgent[],
  now: number,
  policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
): QueueHealth {
  const ranked = rankQueue(items, now, policy);
  const stalled = stalledTransfers(items, now, policy.transferAcceptTimeoutMinutes, policy.elapsedMinutes);
  const loads = agentLoads(items);

  const byBucket = new Map<QueueBucket, QueueHealthBucket>();
  for (const p of ranked) {
    const entry = byBucket.get(p.bucket) ?? { bucket: p.bucket, count: 0, oldestMinutes: 0 };
    entry.count += 1;
    entry.oldestMinutes = Math.max(entry.oldestMinutes, p.waitingMinutes);
    byBucket.set(p.bucket, entry);
  }

  const unassigned = ranked.filter(p => !p.assignedUserId).length;
  const reachable = agents.filter(a => a.availability !== 'offline' && a.availability !== 'away');
  const withSlot = reachable.filter(a => hasSlot({ ...a, openLoad: loads[a.userId] ?? a.openLoad }));

  const breached = ranked.filter(p => p.bucket === 'sla_estourado').length;

  let diagnosis: QueueHealth['diagnosis'] = 'saudavel';
  if (ranked.length === 0) diagnosis = 'vazia';
  else if (stalled.length > 0) diagnosis = 'transferencias_travadas';
  else if (breached > 0) diagnosis = 'sla_estourado';
  else if (unassigned > 0 && reachable.length === 0) diagnosis = 'ninguem_disponivel';
  else if (unassigned > 0 && withSlot.length === 0) diagnosis = 'equipe_lotada';
  else if (unassigned > withSlot.length) diagnosis = 'acumulando';

  // Ordem do painel = ordem da urgência, não a de inserção.
  const bucketOrder: QueueBucket[] = [
    'transferencia_travada', 'sla_estourado', 'urgente', 'sla_atencao',
    'fila_setor', 'aguardando_voce', 'normal',
  ];

  return {
    total: ranked.length,
    unassigned,
    buckets: bucketOrder.map(b => byBucket.get(b)).filter((b): b is QueueHealthBucket => !!b),
    stalled,
    diagnosis,
    saturatedAgents: reachable
      .filter(a => !hasSlot({ ...a, openLoad: loads[a.userId] ?? a.openLoad }))
      .map(a => a.userId),
    idleAgents: withSlot
      .filter(a => (loads[a.userId] ?? a.openLoad) === 0)
      .map(a => a.userId),
  };
}

export interface DistributionAssignment {
  conversationId: string;
  userId: string;
  reason: string;
}

export interface DistributionResult {
  assignments: DistributionAssignment[];
  /** Conversas que ficaram sem dono e por quê — a fila explicada. */
  unassigned: Array<{ conversationId: string; reason: string }>;
}

/**
 * Distribui, em ordem de urgência, todas as conversas sem dono entre os
 * agentes elegíveis. A carga é atualizada A CADA atribuição: sem isso, uma
 * rodada com 5 conversas jogaria as 5 no mesmo atendente "menos carregado".
 */
export function distributeQueue(
  items: QueueItem[],
  agents: RoutingAgent[],
  now: number,
  opts: {
    policy?: QueuePolicy;
    /** Canal da conversa, quando não vier no próprio item. */
    channelOf?: (conversationId: string) => string | null;
    /** Conversa que exige advogado. */
    requiresLawyer?: (conversationId: string) => boolean;
    /** Continuidade: quem já atendeu aquele cliente. */
    preferredAgentOf?: (conversationId: string) => string | null;
  } = {},
): DistributionResult {
  const working = agents.map(a => ({ ...a }));
  const assignments: DistributionAssignment[] = [];
  const unassigned: Array<{ conversationId: string; reason: string }> = [];
  const byId = new Map(items.map(i => [i.id, i]));
  const nowIso = new Date(now).toISOString();

  for (const p of rankQueue(items, now, opts.policy)) {
    if (p.assignedUserId) continue;
    const item = byId.get(p.id);
    if (!item) continue;
    if (item.awaitingAccept) continue; // já tem destino esperando aceite
    const decision = pickNextAgent(working, {
      conversationId: item.id,
      channelId: opts.channelOf?.(item.id) ?? item.channelId ?? null,
      departmentId: item.departmentId,
      requiresLawyer: opts.requiresLawyer?.(item.id) ?? false,
      preferredUserId: opts.preferredAgentOf?.(item.id) ?? null,
    });
    if (!decision.userId) {
      unassigned.push({ conversationId: item.id, reason: decision.reason });
      continue;
    }
    const agent = working.find(a => a.userId === decision.userId)!;
    agent.openLoad += 1;
    agent.lastAssignedAt = nowIso;
    assignments.push({ conversationId: item.id, userId: decision.userId, reason: decision.reason });
  }

  return { assignments, unassigned };
}
