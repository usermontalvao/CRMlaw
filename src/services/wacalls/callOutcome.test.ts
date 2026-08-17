import test from 'node:test';
import assert from 'node:assert/strict';
import {
  endReasonMessage, endReasonIsFailure, phaseFromStatus, formatCallTimer, callElapsedSeconds, phaseLabel,
} from './callOutcome.ts';

test('recusa e ausência de resposta são ditas com todas as letras', () => {
  assert.equal(endReasonMessage('declined', { answered: false, direction: 'outbound' }), 'Chamada recusada.');
  assert.equal(endReasonMessage('timeout', { answered: false, direction: 'outbound' }), 'Chamada não atendida.');
});

test('desligar depois de conversar é encerramento normal, não falha', () => {
  assert.equal(endReasonMessage('user_ended', { answered: true, direction: 'outbound' }), 'Chamada encerrada.');
  assert.equal(endReasonIsFailure('user_ended', true), false);
  assert.equal(endReasonIsFailure('timeout', false), true);
});

test('motivo desconhecido em chamada não atendida ainda avisa o operador', () => {
  assert.equal(endReasonMessage(null, { answered: false, direction: 'outbound' }), 'Chamada não atendida.');
  assert.equal(endReasonMessage('unknown', { answered: true, direction: 'inbound' }), 'Chamada encerrada.');
});

test('o PREPARING não é atropelado pelo "ringing" do servidor', () => {
  assert.equal(phaseFromStatus('ringing', 'outbound', 'PREPARING'), 'PREPARING');
  assert.equal(phaseFromStatus('ringing', 'outbound', 'CALLING'), 'RINGING');
});

test('chamada encerrada não ressuscita com evento atrasado', () => {
  assert.equal(phaseFromStatus('connected', 'inbound', 'ENDED'), 'ENDED');
  assert.equal(phaseFromStatus('ringing', 'outbound', 'FAILED'), 'FAILED');
});

test('connected vira ACTIVE em qualquer direção', () => {
  assert.equal(phaseFromStatus('connected', 'outbound', 'RINGING'), 'ACTIVE');
  assert.equal(phaseFromStatus('connected', 'inbound', 'PREPARING'), 'ACTIVE');
});

test('o cronômetro só conta a partir do atendimento', () => {
  assert.equal(callElapsedSeconds(null, 10_000), 0);
  assert.equal(callElapsedSeconds(10_000, 73_000), 63);
  assert.equal(formatCallTimer(0), '00:00');
  assert.equal(formatCallTimer(63), '01:03');
  assert.equal(formatCallTimer(3661), '1:01:01');
});

test('o rótulo separa quem liga de quem recebe', () => {
  assert.equal(phaseLabel('RINGING', 'outbound'), 'Chamando…');
  assert.equal(phaseLabel('RINGING', 'inbound'), 'Chamada recebida');
  assert.equal(phaseLabel('ACTIVE', 'outbound'), 'Em chamada');
});

test('quem atende não vê "Preparando" e sim "Conectando"', () => {
  assert.equal(phaseLabel('PREPARING', 'outbound'), 'Preparando…');
  assert.equal(phaseLabel('PREPARING', 'inbound'), 'Conectando…');
});
