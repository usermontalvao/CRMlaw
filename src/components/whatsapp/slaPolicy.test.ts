import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLA_POLICY,
  slaPolicyFromRow,
  slaPolicyForChannels,
  queueThresholdsFor,
} from './slaPolicy.ts';

test('linha ausente cai no padrão, e o padrão é o mesmo do banco', () => {
  assert.deepEqual(slaPolicyFromRow(null), DEFAULT_SLA_POLICY);
  assert.equal(DEFAULT_SLA_POLICY.warnMinutes, 15);
  assert.equal(DEFAULT_SLA_POLICY.breachMinutes, 60);
  assert.equal(DEFAULT_SLA_POLICY.businessHoursOnly, true);
});

test('o canal manda: os números da linha vencem o padrão', () => {
  const p = slaPolicyFromRow({
    sla_warn_minutes: 5, sla_breach_minutes: 20,
    sla_queue_warn_minutes: 10, sla_queue_breach_minutes: 40,
    sla_transfer_accept_minutes: 3, sla_abandoned_minutes: 90,
    sla_business_hours_only: false,
  });
  assert.deepEqual(p, {
    warnMinutes: 5, breachMinutes: 20,
    queueWarnMinutes: 10, queueBreachMinutes: 40,
    transferAcceptMinutes: 3, abandonedMinutes: 90,
    businessHoursOnly: false,
  });
});

test('âmbar nunca depois do vermelho, mesmo com a linha invertida', () => {
  // Sem esta trava a conversa pularia de "sem sinal" direto para "estourada".
  const p = slaPolicyFromRow({ sla_warn_minutes: 90, sla_breach_minutes: 30 });
  assert.equal(p.warnMinutes, 90);
  assert.equal(p.breachMinutes, 90);
  const q = slaPolicyFromRow({ sla_queue_warn_minutes: 200, sla_queue_breach_minutes: 60 });
  assert.equal(q.queueBreachMinutes, 200);
});

test('valor sujo (zero, negativo, texto, nulo) não zera o SLA', () => {
  const p = slaPolicyFromRow({
    sla_warn_minutes: 0,
    sla_breach_minutes: -5,
    sla_queue_warn_minutes: null,
    sla_abandoned_minutes: Number.NaN,
  });
  assert.equal(p.warnMinutes, 15);
  assert.equal(p.breachMinutes, 60);
  assert.equal(p.queueWarnMinutes, 30);
  assert.equal(p.abandonedMinutes, 240);
});

test('só `false` desliga o tempo útil; ausente continua ligado', () => {
  assert.equal(slaPolicyFromRow({}).businessHoursOnly, true);
  assert.equal(slaPolicyFromRow({ sla_business_hours_only: null }).businessHoursOnly, true);
  assert.equal(slaPolicyFromRow({ sla_business_hours_only: false }).businessHoursOnly, false);
});

test('cada canal com a sua regra; conversa órfã de canal cai no padrão', () => {
  const For = slaPolicyForChannels({
    plantao:   { sla_warn_minutes: 2, sla_breach_minutes: 5 },
    comercial: { sla_warn_minutes: 30, sla_breach_minutes: 120 },
  });
  assert.equal(For('plantao').breachMinutes, 5);
  assert.equal(For('comercial').breachMinutes, 120);
  assert.equal(For(null).breachMinutes, 60);
  assert.equal(For('canal-que-sumiu').breachMinutes, 60);
  // memoiza: a mesma referência volta na segunda chamada
  assert.equal(For('plantao'), For('plantao'));
});

test('a tradução para o vocabulário da fila preserva os números do canal', () => {
  const t = queueThresholdsFor(slaPolicyForChannels({ plantao: { sla_warn_minutes: 2, sla_breach_minutes: 5, sla_transfer_accept_minutes: 1 } }));
  assert.deepEqual(t('plantao'), {
    slaWarnMinutes: 2, slaBreachMinutes: 5, queueWarnMinutes: 30, transferAcceptTimeoutMinutes: 1,
  });
});
