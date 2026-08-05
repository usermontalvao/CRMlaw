import test from 'node:test';
import assert from 'node:assert/strict';
import {
  realtimeRetryDelay, isRealtimeDeadStatus, resolveChannelStatus,
  REALTIME_RETRY_CEILING_MS,
} from './realtimeBackoff.ts';

test('primeira tentativa volta em 1s — queda curta é imperceptível', () => {
  assert.equal(realtimeRetryDelay(0), 1000);
});

test('a espera dobra a cada tentativa', () => {
  assert.equal(realtimeRetryDelay(1), 2000);
  assert.equal(realtimeRetryDelay(2), 4000);
  assert.equal(realtimeRetryDelay(3), 8000);
});

test('a espera para de crescer no teto', () => {
  assert.equal(realtimeRetryDelay(10), REALTIME_RETRY_CEILING_MS);
  assert.equal(realtimeRetryDelay(999), REALTIME_RETRY_CEILING_MS);
});

test('tentativa negativa não vira espera absurda', () => {
  assert.equal(realtimeRetryDelay(-5), 1000);
});

test('estados que significam canal fora', () => {
  assert.equal(isRealtimeDeadStatus('CHANNEL_ERROR'), true);
  assert.equal(isRealtimeDeadStatus('TIMED_OUT'), true);
  assert.equal(isRealtimeDeadStatus('CLOSED'), true);
});

test('canal inscrito não conta como fora', () => {
  assert.equal(isRealtimeDeadStatus('SUBSCRIBED'), false);
});

const doCanalAtual = { fromGeneration: 3, currentGeneration: 3, disposed: false };

test('o canal atual no ar anuncia que está vivo', () => {
  assert.equal(resolveChannelStatus('SUBSCRIBED', doCanalAtual), 'live');
});

test('o canal atual caindo anuncia a queda e agenda a volta', () => {
  assert.equal(resolveChannelStatus('CHANNEL_ERROR', doCanalAtual), 'down-and-retry');
  assert.equal(resolveChannelStatus('TIMED_OUT', doCanalAtual), 'down-and-retry');
  assert.equal(resolveChannelStatus('CLOSED', doCanalAtual), 'down-and-retry');
});

test('o adeus de um canal aposentado é ignorado (era a origem da piscada)', () => {
  // `removeChannel` faz o canal removido reportar CLOSED. Se esse adeus contasse
  // como queda, a reconexão que o removeu provocaria outra reconexão, e assim
  // por diante — "Online" e "Reconectando…" alternando sem parar.
  const doCanalVelho = { fromGeneration: 2, currentGeneration: 3, disposed: false };
  assert.equal(resolveChannelStatus('CLOSED', doCanalVelho), 'ignore');
  // Nem mesmo um SUBSCRIBED atrasado do canal velho pode falar pelo atual.
  assert.equal(resolveChannelStatus('SUBSCRIBED', doCanalVelho), 'ignore');
});

test('depois de desmontado nada mais é anunciado', () => {
  assert.equal(resolveChannelStatus('CLOSED', { ...doCanalAtual, disposed: true }), 'ignore');
  assert.equal(resolveChannelStatus('SUBSCRIBED', { ...doCanalAtual, disposed: true }), 'ignore');
});

test('estado intermediário não é notícia', () => {
  assert.equal(resolveChannelStatus('joining', doCanalAtual), 'ignore');
});
