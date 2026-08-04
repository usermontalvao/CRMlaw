import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAudience, applyCampaignGuards, planDispatch, isOptOutMessage, campaignMetrics,
  BUSINESS_WINDOW, DEFAULT_CAMPAIGN_GUARDS, DO_NOT_DISTURB_LABEL,
  type CampaignContact,
} from './campaign.ts';

// Terça-feira, 04/08/2026, 14:00 UTC = 10:00 em Cuiabá (UTC-4).
const NOW = Date.parse('2026-08-04T14:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const contact = (patch: Partial<CampaignContact> & Pick<CampaignContact, 'id'>): CampaignContact => ({
  phone: `5565984${patch.id.replace(/\D/g, '').padStart(6, '0').slice(-6)}`,
  status: 'closed',
  channelId: 'canal-a',
  ...patch,
});

// ── Público ──────────────────────────────────────────────────────────
test('segmenta por etiqueta de inclusão e exclusão', () => {
  const audience = buildAudience([
    contact({ id: '1', labels: ['Novo cliente'] }),
    contact({ id: '2', labels: ['Novo cliente', 'Pagamento pendente'] }),
    contact({ id: '3', labels: ['Em negociação'] }),
  ], { includeLabels: ['Novo cliente'], excludeLabels: ['Pagamento pendente'] }, NOW);
  assert.deepEqual(audience.map(c => c.id), ['1']);
});

test('separa cliente de lead', () => {
  const base = [contact({ id: 'cli', clientId: 'abc' }), contact({ id: 'lead' })];
  assert.deepEqual(buildAudience(base, { onlyClients: true }, NOW).map(c => c.id), ['cli']);
  assert.deepEqual(buildAudience(base, { onlyLeads: true }, NOW).map(c => c.id), ['lead']);
});

test('reativação pega quem sumiu e quem nunca falou', () => {
  const audience = buildAudience([
    contact({ id: 'recente', lastInboundAt: daysAgo(3) }),
    contact({ id: 'sumido', lastInboundAt: daysAgo(120) }),
    contact({ id: 'nunca-falou' }),
  ], { inactiveForDays: 60 }, NOW);
  assert.deepEqual(audience.map(c => c.id).sort(), ['nunca-falou', 'sumido']);
});

test('público quente exige interação recente', () => {
  const audience = buildAudience([
    contact({ id: 'quente', lastInboundAt: daysAgo(2) }),
    contact({ id: 'frio', lastInboundAt: daysAgo(90) }),
    contact({ id: 'nunca' }),
  ], { activeWithinDays: 7 }, NOW);
  assert.deepEqual(audience.map(c => c.id), ['quente']);
});

// ── Guardas ──────────────────────────────────────────────────────────
test('opt-out ganha de qualquer outro motivo no relatório', () => {
  const { eligible, skipped } = applyCampaignGuards(
    [contact({ id: 'x', optOut: true, isBlocked: true, lastCampaignAt: daysAgo(1) })],
    DEFAULT_CAMPAIGN_GUARDS, NOW,
  );
  assert.deepEqual(eligible, []);
  assert.equal(skipped[0].reason, 'pediu para não receber');
});

test('contato bloqueado não recebe campanha', () => {
  const { skipped } = applyCampaignGuards([contact({ id: 'x', isBlocked: true })], DEFAULT_CAMPAIGN_GUARDS, NOW);
  assert.equal(skipped[0].reason, 'contato bloqueado');
});

test('atendimento em andamento não é interrompido por disparo', () => {
  const { eligible, skipped } = applyCampaignGuards(
    [contact({ id: 'aberto', status: 'open' }), contact({ id: 'fechado', status: 'closed' })],
    DEFAULT_CAMPAIGN_GUARDS, NOW,
  );
  assert.deepEqual(eligible.map(c => c.id), ['fechado']);
  assert.equal(skipped[0].reason, 'atendimento em andamento');
});

test('carência evita disparar de novo para quem recebeu há pouco', () => {
  const { eligible, skipped } = applyCampaignGuards([
    contact({ id: 'recente', lastCampaignAt: daysAgo(3) }),
    contact({ id: 'antigo', lastCampaignAt: daysAgo(40) }),
  ], { ...DEFAULT_CAMPAIGN_GUARDS, cooldownDays: 14 }, NOW);
  assert.deepEqual(eligible.map(c => c.id), ['antigo']);
  assert.match(skipped[0].reason, /carência 14d/);
});

test('mesmo número em duas conversas recebe uma vez só', () => {
  const { eligible, skipped } = applyCampaignGuards([
    contact({ id: 'thread-antiga', phone: '5565984046375' }),
    contact({ id: 'thread-nova', phone: '+55 (65) 98404-6375' }),
  ], DEFAULT_CAMPAIGN_GUARDS, NOW);
  assert.deepEqual(eligible.map(c => c.id), ['thread-antiga']);
  assert.equal(skipped[0].reason, 'número duplicado no público');
});

test('telefone inválido é descartado antes do envio', () => {
  const { skipped } = applyCampaignGuards([contact({ id: 'x', phone: '99999' })], DEFAULT_CAMPAIGN_GUARDS, NOW);
  assert.equal(skipped[0].reason, 'telefone inválido');
});

test('teto de destinatários corta o excedente e registra o motivo', () => {
  const audience = Array.from({ length: 5 }, (_, i) => contact({ id: `c${i}`, phone: `55659840463${70 + i}` }));
  const { eligible, skipped } = applyCampaignGuards(
    audience, { ...DEFAULT_CAMPAIGN_GUARDS, maxRecipients: 3 }, NOW,
  );
  assert.equal(eligible.length, 3);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /teto de 3/);
});

// ── Plano de disparo ─────────────────────────────────────────────────
test('throttling espaça os envios pelo ritmo pedido', () => {
  const slots = planDispatch(
    [contact({ id: 'a' }), contact({ id: 'b' }), contact({ id: 'c' })],
    { startAt: NOW, perMinute: 6 },
  );
  const times = slots.map(s => Date.parse(s.at));
  assert.equal(times[1] - times[0], 10_000);
  assert.equal(times[2] - times[1], 10_000);
});

test('disparo fora da janela comercial é empurrado para a abertura', () => {
  // 03:00 UTC de terça = 23:00 de segunda em Cuiabá — fora da janela.
  const slots = planDispatch([contact({ id: 'a' })], {
    startAt: Date.parse('2026-08-04T03:00:00.000Z'),
    perMinute: 6,
    window: BUSINESS_WINDOW,
  });
  // Deve sair às 08:00 de Cuiabá na terça = 12:00 UTC.
  assert.equal(slots[0].at, '2026-08-04T12:00:00.000Z');
});

test('campanha iniciada no sábado só sai na segunda', () => {
  // Sábado, 08/08/2026, 15:00 UTC = 11:00 em Cuiabá.
  const slots = planDispatch([contact({ id: 'a' })], {
    startAt: Date.parse('2026-08-08T15:00:00.000Z'),
    perMinute: 6,
    window: BUSINESS_WINDOW,
  });
  const out = new Date(slots[0].at);
  assert.equal(out.getUTCDay(), 1);              // segunda
  assert.equal(out.toISOString(), '2026-08-10T12:00:00.000Z');
});

test('lote que estoura o fim do expediente continua no dia seguinte', () => {
  // 17:59 em Cuiabá (21:59 UTC), 3 mensagens a 1/min.
  const slots = planDispatch(
    [contact({ id: 'a' }), contact({ id: 'b' }), contact({ id: 'c' })],
    { startAt: Date.parse('2026-08-04T21:59:00.000Z'), perMinute: 1, window: BUSINESS_WINDOW },
  );
  assert.equal(slots[0].at, '2026-08-04T21:59:00.000Z');   // ainda hoje
  assert.equal(slots[1].at, '2026-08-05T12:00:00.000Z');   // abertura de quarta
  assert.equal(slots[2].at, '2026-08-05T12:01:00.000Z');
});

test('sem janela configurada o disparo sai direto', () => {
  const slots = planDispatch([contact({ id: 'a' })], {
    startAt: Date.parse('2026-08-04T03:00:00.000Z'), perMinute: 6,
  });
  assert.equal(slots[0].at, '2026-08-04T03:00:00.000Z');
});

// ── Opt-out ──────────────────────────────────────────────────────────
test('frase explícita de descadastro é reconhecida', () => {
  assert.equal(isOptOutMessage('Não quero mais receber essas mensagens, por favor.'), true);
  assert.equal(isOptOutMessage('me tira da lista'), true);
  assert.equal(isOptOutMessage('CANCELAR INSCRIÇÃO'), true);
});

test('palavra solta em mensagem curta conta como opt-out', () => {
  assert.equal(isOptOutMessage('Parar'), true);
  assert.equal(isOptOutMessage('sair'), true);
  assert.equal(isOptOutMessage('stop'), true);
});

test('a mesma palavra dentro de uma frase de atendimento NÃO é opt-out', () => {
  assert.equal(isOptOutMessage('Vamos parar por aqui e retomo amanhã, doutor'), false);
  assert.equal(isOptOutMessage('Pode cancelar a audiência de quinta?'), false);
  assert.equal(isOptOutMessage('Não consegui enviar o documento'), false);
});

test('mensagem vazia não é opt-out', () => {
  assert.equal(isOptOutMessage(''), false);
  assert.equal(isOptOutMessage(null), false);
  assert.equal(isOptOutMessage('   '), false);
});

// ── Métricas ─────────────────────────────────────────────────────────
test('métricas contam contato único, não evento repetido', () => {
  const m = campaignMetrics([
    { contactId: 'a', kind: 'sent' }, { contactId: 'b', kind: 'sent' },
    { contactId: 'a', kind: 'delivered' }, { contactId: 'a', kind: 'delivered' },
    { contactId: 'b', kind: 'delivered' },
    { contactId: 'a', kind: 'read' },
    { contactId: 'a', kind: 'replied' },
    { contactId: 'a', kind: 'converted' },
    { contactId: 'b', kind: 'opted_out' },
  ]);
  assert.equal(m.sent, 2);
  assert.equal(m.delivered, 2);
  assert.equal(m.deliveryRate, 1);
  assert.equal(m.readRate, 0.5);
  assert.equal(m.replyRate, 0.5);
  assert.equal(m.optOutRate, 0.5);
  assert.equal(m.conversionRate, 1);
});

test('métricas sem envio não dividem por zero', () => {
  const m = campaignMetrics([]);
  assert.equal(m.deliveryRate, 0);
  assert.equal(m.conversionRate, 0);
});

test('etiqueta "Não perturbe" tira o contato do disparo', () => {
  const { eligible, skipped } = applyCampaignGuards(
    [contact({ id: 'x', labels: [DO_NOT_DISTURB_LABEL] })],
    DEFAULT_CAMPAIGN_GUARDS, NOW,
  );
  assert.deepEqual(eligible, []);
  assert.equal(skipped[0].reason, 'pediu para não receber');
});

test('a etiqueta de descadastro é a mesma escrita pela conversa', () => {
  // Se este texto mudar de um lado só, o público volta a incluir quem pediu
  // para sair — e o teste é o que trava isso.
  assert.equal(DO_NOT_DISTURB_LABEL, 'Não perturbe');
  assert.equal(isOptOutMessage('não quero mais receber'), true);
});
