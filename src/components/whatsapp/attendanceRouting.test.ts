import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickNextAgent, rankQueue, nextInQueue, stalledTransfers, agentLoads,
  distributeQueue, occupancy, hasSlot, queueHealth, DEFAULT_QUEUE_POLICY,
  type RoutingAgent, type QueueItem,
} from './attendanceRouting.ts';

const NOW = Date.parse('2026-08-04T14:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const agent = (patch: Partial<RoutingAgent> & Pick<RoutingAgent, 'userId'>): RoutingAgent => ({
  name: patch.userId,
  availability: 'available',
  capacity: 5,
  openLoad: 0,
  departmentIds: ['recepcao'],
  channelIds: '*',
  ...patch,
});

const conv = (patch: Partial<QueueItem> & Pick<QueueItem, 'id'>): QueueItem => ({
  status: 'open',
  assignedUserId: null,
  departmentId: null,
  lastMessageDirection: 'in',
  lastMessageAt: minutesAgo(1),
  lastCustomerMessageAt: minutesAgo(1),
  ...patch,
});

// ── Elegibilidade ────────────────────────────────────────────────────
test('agente offline ou ausente não recebe conversa', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', availability: 'offline' }), agent({ userId: 'bia', availability: 'away' })],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, null);
  assert.deepEqual(d.rejected.map(r => r.reason), ['offline', 'ausente']);
});

test('assunto jurídico só cai para advogado', () => {
  const d = pickNextAgent(
    [agent({ userId: 'recepcao1' }), agent({ userId: 'dra-ana', isLawyer: true })],
    { conversationId: 'c1', channelId: null, departmentId: null, requiresLawyer: true },
  );
  assert.equal(d.userId, 'dra-ana');
});

test('agente sem acesso ao canal é descartado', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', channelIds: ['canal-b'] })],
    { conversationId: 'c1', channelId: 'canal-a', departmentId: null },
  );
  assert.equal(d.userId, null);
  assert.equal(d.rejected[0].reason, 'sem acesso ao canal');
});

test('agente fora do setor de destino é descartado', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', departmentIds: ['financeiro'] })],
    { conversationId: 'c1', channelId: null, departmentId: 'juridico' },
  );
  assert.equal(d.userId, null);
  assert.equal(d.rejected[0].reason, 'fora do setor de destino');
});

test('agente lotado não recebe mais uma', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', capacity: 2, openLoad: 2 })],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, null);
  assert.match(d.rejected[0].reason, /lotado/);
});

test('capacidade 0 significa sem teto', () => {
  assert.equal(hasSlot({ capacity: 0, openLoad: 40 }), true);
  assert.equal(occupancy({ capacity: 0, openLoad: 40 }), 1);
  assert.equal(occupancy({ capacity: 4, openLoad: 1 }), 0.25);
});

// ── Ordenação ────────────────────────────────────────────────────────
test('menor carga vence', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', openLoad: 4 }), agent({ userId: 'bia', openLoad: 1 })],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, 'bia');
});

test('continuidade com o cliente vence a carga menor', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', openLoad: 4 }), agent({ userId: 'bia', openLoad: 0 })],
    { conversationId: 'c1', channelId: null, departmentId: null, preferredUserId: 'ana' },
  );
  assert.equal(d.userId, 'ana');
  assert.match(d.ranked[0].reason, /já atendeu este cliente/);
});

test('empate de carga usa round-robin: quem está há mais tempo sem receber', () => {
  const d = pickNextAgent(
    [
      agent({ userId: 'ana', lastAssignedAt: minutesAgo(2) }),
      agent({ userId: 'bia', lastAssignedAt: minutesAgo(50) }),
    ],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, 'bia');
});

test('quem nunca recebeu entra antes de quem já recebeu', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', lastAssignedAt: minutesAgo(999) }), agent({ userId: 'bia' })],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, 'bia');
});

test('ocupado perde para disponível com a mesma carga', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana', availability: 'busy' }), agent({ userId: 'bia' })],
    { conversationId: 'c1', channelId: null, departmentId: null },
  );
  assert.equal(d.userId, 'bia');
});

test('exclusão evita devolver a conversa a quem acabou de passar adiante', () => {
  const d = pickNextAgent(
    [agent({ userId: 'ana' }), agent({ userId: 'bia', openLoad: 3 })],
    { conversationId: 'c1', channelId: null, departmentId: null, excludeUserIds: ['ana'] },
  );
  assert.equal(d.userId, 'bia');
});

// ── Fila ─────────────────────────────────────────────────────────────
test('encerrada e bloqueada ficam fora da fila', () => {
  const ranked = rankQueue([
    conv({ id: 'fechada', status: 'closed' }),
    conv({ id: 'bloqueada', isBlocked: true }),
  ], NOW);
  assert.deepEqual(ranked, []);
});

test('aguardando o cliente com dono não ocupa a fila', () => {
  const ranked = rankQueue([
    conv({ id: 'c1', assignedUserId: 'ana', lastMessageDirection: 'out' }),
  ], NOW);
  assert.deepEqual(ranked, []);
});

test('transferência travada vem antes de SLA estourado', () => {
  const ranked = rankQueue([
    conv({ id: 'sla', lastCustomerMessageAt: minutesAgo(180) }),
    conv({
      id: 'transf', awaitingAccept: true, transferPendingSince: minutesAgo(40),
      lastMessageDirection: 'out',
    }),
  ], NOW);
  assert.deepEqual(ranked.map(r => r.id), ['transf', 'sla']);
  assert.equal(ranked[0].bucket, 'transferencia_travada');
  assert.equal(ranked[1].bucket, 'sla_estourado');
});

test('etiqueta urgente sobe na frente da espera curta', () => {
  const ranked = rankQueue([
    conv({ id: 'comum', lastCustomerMessageAt: minutesAgo(20) }),
    conv({ id: 'urgente', labels: ['Urgente'], lastCustomerMessageAt: minutesAgo(2) }),
  ], NOW);
  assert.deepEqual(ranked.map(r => r.id), ['urgente', 'comum']);
});

test('conversa parada na fila do setor é sinalizada', () => {
  const [p] = rankQueue([
    conv({ id: 'fila', departmentId: 'juridico', lastMessageDirection: 'out', lastMessageAt: minutesAgo(45) }),
  ], NOW);
  assert.equal(p.bucket, 'fila_setor');
  assert.match(p.label, /na fila há 45min/);
});

test('próximo da fila ignora conversa de outro atendente', () => {
  const items = [
    conv({ id: 'da-bia', assignedUserId: 'bia', lastCustomerMessageAt: minutesAgo(300) }),
    conv({ id: 'livre', lastCustomerMessageAt: minutesAgo(20) }),
  ];
  assert.equal(nextInQueue(items, NOW)?.id, 'livre');
});

test('próximo da fila pode retomar as minhas quando pedido', () => {
  const items = [
    conv({ id: 'minha', assignedUserId: 'ana', lastCustomerMessageAt: minutesAgo(300) }),
    conv({ id: 'livre', lastCustomerMessageAt: minutesAgo(20) }),
  ];
  assert.equal(nextInQueue(items, NOW, { agentUserId: 'ana', includeMine: true })?.id, 'minha');
});

test('transferências sem aceite são listadas da mais antiga para a mais nova', () => {
  const travadas = stalledTransfers([
    conv({ id: 'nova', awaitingAccept: true, transferPendingSince: minutesAgo(5) }),
    conv({ id: 'antiga', awaitingAccept: true, transferPendingSince: minutesAgo(90) }),
    conv({ id: 'media', awaitingAccept: true, transferPendingSince: minutesAgo(20) }),
  ], NOW, 15);
  assert.deepEqual(travadas.map(t => t.id), ['antiga', 'media']);
});

test('carga viva conta só conversas ativas', () => {
  const loads = agentLoads([
    conv({ id: '1', assignedUserId: 'ana' }),
    conv({ id: '2', assignedUserId: 'ana', status: 'closed' }),
    conv({ id: '3', assignedUserId: 'ana', isBlocked: true }),
    conv({ id: '4', assignedUserId: 'bia' }),
  ]);
  assert.deepEqual(loads, { ana: 1, bia: 1 });
});

// ── Distribuição ─────────────────────────────────────────────────────
test('distribuição espalha a rodada em vez de empilhar no mesmo agente', () => {
  const items = [
    conv({ id: 'c1', lastCustomerMessageAt: minutesAgo(30) }),
    conv({ id: 'c2', lastCustomerMessageAt: minutesAgo(25) }),
    conv({ id: 'c3', lastCustomerMessageAt: minutesAgo(20) }),
    conv({ id: 'c4', lastCustomerMessageAt: minutesAgo(18) }),
  ];
  const { assignments } = distributeQueue(items, [agent({ userId: 'ana' }), agent({ userId: 'bia' })], NOW);
  const perAgent = assignments.reduce<Record<string, number>>((acc, a) => {
    acc[a.userId] = (acc[a.userId] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(perAgent, { ana: 2, bia: 2 });
});

test('distribuição respeita o teto e explica quem sobrou', () => {
  const items = [conv({ id: 'c1' }), conv({ id: 'c2' }), conv({ id: 'c3' })];
  const { assignments, unassigned } = distributeQueue(
    items, [agent({ userId: 'ana', capacity: 2 })], NOW,
  );
  assert.equal(assignments.length, 2);
  assert.equal(unassigned.length, 1);
  assert.equal(unassigned[0].reason, 'nenhum atendente elegível');
});

test('distribuição não rouba conversa já atribuída nem a que aguarda aceite', () => {
  const items = [
    conv({ id: 'com-dono', assignedUserId: 'bia' }),
    conv({ id: 'em-aceite', awaitingAccept: true, transferPendingSince: minutesAgo(60) }),
  ];
  const { assignments } = distributeQueue(items, [agent({ userId: 'ana' })], NOW);
  assert.deepEqual(assignments, []);
});

test('distribuição manda o assunto jurídico para o advogado', () => {
  const items = [conv({ id: 'processo' }), conv({ id: 'boleto' })];
  const { assignments } = distributeQueue(
    items,
    [agent({ userId: 'recepcao1' }), agent({ userId: 'dra-ana', isLawyer: true })],
    NOW,
    { requiresLawyer: id => id === 'processo' },
  );
  assert.equal(assignments.find(a => a.conversationId === 'processo')?.userId, 'dra-ana');
});

// ── Saúde da fila ────────────────────────────────────────────────────
test('fila vazia é diagnosticada como vazia, não como saudável genérica', () => {
  const h = queueHealth([], [agent({ userId: 'ana' })], NOW);
  assert.equal(h.diagnosis, 'vazia');
  assert.equal(h.total, 0);
});

test('fila com gente livre e pouca espera é saudável', () => {
  const h = queueHealth(
    [conv({ id: 'c1' })],
    [agent({ userId: 'ana' }), agent({ userId: 'bia' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'saudavel');
  assert.equal(h.unassigned, 1);
});

test('capacidade de sobra NÃO torna saudável uma fila com transferência travada', () => {
  const h = queueHealth(
    [conv({ id: 'travada', awaitingAccept: true, transferPendingSince: minutesAgo(60) })],
    [agent({ userId: 'ana' }), agent({ userId: 'bia' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'transferencias_travadas');
});

test('cliente esperando acima do prazo pesa mais que a vazão da equipe', () => {
  const h = queueHealth(
    [conv({ id: 'c1', lastCustomerMessageAt: minutesAgo(200) })],
    [agent({ userId: 'ana' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'sla_estourado');
});

test('falha de processo vem antes de falta de gente', () => {
  const h = queueHealth(
    [conv({ id: 'travada', awaitingAccept: true, transferPendingSince: minutesAgo(60) }), conv({ id: 'c2' })],
    [agent({ userId: 'ana', availability: 'offline' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'transferencias_travadas');
});

test('todo mundo lotado é diagnosticado como equipe lotada', () => {
  const h = queueHealth(
    [conv({ id: 'c1' }), conv({ id: 'c2' })],
    [agent({ userId: 'ana', capacity: 1, openLoad: 1 })],
    NOW,
  );
  assert.equal(h.diagnosis, 'equipe_lotada');
  assert.deepEqual(h.saturatedAgents, ['ana']);
});

test('fila esperando com todo mundo offline aponta ninguém disponível', () => {
  const h = queueHealth(
    [conv({ id: 'c1' })],
    [agent({ userId: 'ana', availability: 'offline' }), agent({ userId: 'bia', availability: 'away' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'ninguem_disponivel');
});

test('mais conversas sem dono do que atendentes com vaga = acumulando', () => {
  const h = queueHealth(
    [conv({ id: 'c1' }), conv({ id: 'c2' }), conv({ id: 'c3' })],
    [agent({ userId: 'ana' })],
    NOW,
  );
  assert.equal(h.diagnosis, 'acumulando');
});

test('carga vinda da fila prevalece sobre a declarada no agente', () => {
  // O agente diz openLoad 0, mas a fila mostra 2 conversas dele: vale a fila.
  const h = queueHealth(
    [conv({ id: 'c1', assignedUserId: 'ana' }), conv({ id: 'c2', assignedUserId: 'ana' }), conv({ id: 'c3' })],
    [agent({ userId: 'ana', capacity: 2, openLoad: 0 })],
    NOW,
  );
  assert.deepEqual(h.saturatedAgents, ['ana']);
  assert.equal(h.diagnosis, 'equipe_lotada');
});

test('atendente ocioso é nomeado enquanto a fila espera', () => {
  const h = queueHealth(
    [conv({ id: 'c1', assignedUserId: 'ana' }), conv({ id: 'c2' })],
    [agent({ userId: 'ana' }), agent({ userId: 'bia' })],
    NOW,
  );
  assert.deepEqual(h.idleAgents, ['bia']);
});

test('grupos vêm em ordem de urgência, com a espera mais antiga de cada um', () => {
  const h = queueHealth([
    conv({ id: 'nova', lastCustomerMessageAt: minutesAgo(2) }),
    conv({ id: 'estourada', lastCustomerMessageAt: minutesAgo(200) }),
    conv({ id: 'atencao', lastCustomerMessageAt: minutesAgo(20) }),
    conv({ id: 'travada', awaitingAccept: true, transferPendingSince: minutesAgo(40), lastMessageDirection: 'out' }),
  ], [agent({ userId: 'ana' })], NOW);
  assert.deepEqual(
    h.buckets.map(b => b.bucket),
    ['transferencia_travada', 'sla_estourado', 'sla_atencao', 'aguardando_voce'],
  );
  assert.equal(Math.round(h.buckets[1].oldestMinutes), 200);
});

test('transferências travadas entram no diagnóstico com o tempo parado', () => {
  const h = queueHealth([
    conv({ id: 'travada', awaitingAccept: true, transferPendingSince: minutesAgo(90) }),
  ], [agent({ userId: 'ana' })], NOW);
  assert.equal(h.stalled.length, 1);
  assert.equal(Math.round(h.stalled[0].pendingMinutes), 90);
});

// ── Fila em horário útil ─────────────────────────────────────────────
// Só o expediente conta: seg–sex, 8h–18h, fuso do escritório (UTC-4).
const SO_EXPEDIENTE = (fromMs: number, toMs: number) => {
  let total = 0;
  const DIA = 86_400_000;
  let cursor = fromMs;
  while (cursor < toMs && total < 100_000) {
    const local = new Date(cursor - 4 * 3_600_000);
    const dow = local.getUTCDay();
    const min = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (dow >= 1 && dow <= 5 && min >= 480 && min < 1080) total += 1;
    cursor += 60_000;
    if (cursor - fromMs > 30 * DIA) break;
  }
  return total;
};

// 07/08/2026 é sexta; 10/08/2026 é segunda.
const SEX_18H05 = Date.parse('2026-08-07T18:05:00-04:00');
const SEG_08H10 = Date.parse('2026-08-10T08:10:00-04:00');

test('sem a política de horário útil, a segunda de manhã nasce com SLA estourado', () => {
  const [p] = rankQueue(
    [conv({ id: 'sexta-tarde', lastCustomerMessageAt: new Date(SEX_18H05).toISOString() })],
    SEG_08H10,
  );
  assert.equal(p.bucket, 'sla_estourado');
});

test('com horário útil, a mesma conversa é só uma espera de 10min', () => {
  const [p] = rankQueue(
    [conv({ id: 'sexta-tarde', lastCustomerMessageAt: new Date(SEX_18H05).toISOString() })],
    SEG_08H10,
    { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: SO_EXPEDIENTE },
  );
  assert.equal(p.bucket, 'aguardando_voce');
  assert.equal(Math.round(p.waitingMinutes), 10);
});

test('horário útil não perdoa quem realmente ficou parado no expediente', () => {
  const terca10h = Date.parse('2026-08-04T10:00:00-04:00');
  const terca16h = Date.parse('2026-08-04T16:00:00-04:00');
  const [p] = rankQueue(
    [conv({ id: 'parada-mesmo', lastCustomerMessageAt: new Date(terca10h).toISOString() })],
    terca16h,
    { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: SO_EXPEDIENTE },
  );
  assert.equal(p.bucket, 'sla_estourado');
  assert.equal(Math.round(p.waitingMinutes), 360);
});

test('transferência aberta no fim do expediente não conta a noite como travada', () => {
  const travadas = stalledTransfers(
    [conv({ id: 't', awaitingAccept: true, transferPendingSince: new Date(SEX_18H05).toISOString() })],
    SEG_08H10, 15, SO_EXPEDIENTE,
  );
  assert.deepEqual(travadas, []);
});

// A inbox mistura canais na mesma lista: a medição recebe o canal do item para
// o plantão 24h não ser lido com o relógio do comercial (e vice-versa).
const POR_CANAL = (fromMs: number, toMs: number, channelId?: string | null) =>
  (channelId === 'plantao' ? (toMs - fromMs) / 60_000 : SO_EXPEDIENTE(fromMs, toMs));

test('cada conversa é medida no expediente do próprio canal', () => {
  const desde = new Date(SEX_18H05).toISOString();
  const ranked = rankQueue(
    [
      conv({ id: 'a-comercial', channelId: 'comercial', lastCustomerMessageAt: desde }),
      conv({ id: 'b-plantao', channelId: 'plantao', lastCustomerMessageAt: desde }),
    ],
    SEG_08H10,
    { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: POR_CANAL },
  );
  const byId = new Map(ranked.map(p => [p.id, p]));
  // Mesma mensagem, mesma hora: fechada para um canal, ininterrupta para o outro.
  assert.equal(byId.get('a-comercial')!.bucket, 'aguardando_voce');
  assert.equal(Math.round(byId.get('a-comercial')!.waitingMinutes), 10);
  assert.equal(byId.get('b-plantao')!.bucket, 'sla_estourado');
  // E o plantão vai na frente na ordenação, que é o ponto da fila.
  assert.equal(ranked[0].id, 'b-plantao');
});

test('conversa sem canal não empresta o expediente de outra', () => {
  const [p] = rankQueue(
    [conv({ id: 'sem-canal', channelId: null, lastCustomerMessageAt: new Date(SEX_18H05).toISOString() })],
    SEG_08H10,
    { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: POR_CANAL },
  );
  // Sem canal, cai no fallback da medição — aqui, o expediente padrão.
  assert.equal(p.bucket, 'aguardando_voce');
  assert.equal(Math.round(p.waitingMinutes), 10);
});

test('a transferência travada também é medida no canal dela', () => {
  const pendingSince = new Date(SEX_18H05).toISOString();
  const travadas = stalledTransfers(
    [
      conv({ id: 'comercial', channelId: 'comercial', awaitingAccept: true, transferPendingSince: pendingSince }),
      conv({ id: 'plantao', channelId: 'plantao', awaitingAccept: true, transferPendingSince: pendingSince }),
    ],
    SEG_08H10, 15, POR_CANAL,
  );
  assert.deepEqual(travadas.map(t => t.id), ['plantao']);
});

test('a fila do setor envelhece em horário útil, não no relógio', () => {
  // Sexta 18h05 na fila de um setor: na segunda às 8h10 são 10min úteis, longe
  // dos 30min que acendem o alerta de "parada na fila".
  const item = conv({
    id: 'fila', channelId: 'comercial', departmentId: 'recepcao', assignedUserId: null,
    lastMessageDirection: 'out',
    lastMessageAt: new Date(SEX_18H05).toISOString(),
    lastCustomerMessageAt: new Date(SEX_18H05).toISOString(),
  });
  const [comHorario] = rankQueue([item], SEG_08H10, { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: POR_CANAL });
  assert.equal(comHorario.bucket, 'normal');
  const [semHorario] = rankQueue([item], SEG_08H10);
  assert.equal(semHorario.bucket, 'fila_setor');
});

test('a distribuição usa o canal do próprio item para filtrar quem enxerga', () => {
  const { assignments, unassigned } = distributeQueue(
    [conv({ id: 'c1', channelId: 'plantao', departmentId: null })],
    [agent({ userId: 'ana', channelIds: ['comercial'], departmentIds: [] })],
    NOW,
  );
  assert.deepEqual(assignments, []);
  assert.equal(unassigned[0].reason, 'nenhum atendente elegível');
});

test('o diagnóstico da fila também respeita o horário útil', () => {
  const h = queueHealth(
    [conv({ id: 'sexta-tarde', lastCustomerMessageAt: new Date(SEX_18H05).toISOString() })],
    [agent({ userId: 'ana' })],
    SEG_08H10,
    { ...DEFAULT_QUEUE_POLICY, elapsedMinutes: SO_EXPEDIENTE },
  );
  assert.equal(h.diagnosis, 'saudavel');
});
