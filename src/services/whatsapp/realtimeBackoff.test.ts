import test from 'node:test';
import assert from 'node:assert/strict';
import {
  realtimeRetryDelay, isRealtimeDeadStatus, REALTIME_RETRY_CEILING_MS,
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
