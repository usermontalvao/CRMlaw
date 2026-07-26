import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, relativeTimeRefreshDelay } from './relativeTime.ts';

const NOW = new Date('2026-07-26T12:00:00.000Z').getTime();
const ago = (milliseconds: number) => new Date(NOW - milliseconds).toISOString();

test('formatRelativeTime cobre segundos, minutos, horas, dias, meses e anos', () => {
  assert.equal(formatRelativeTime(ago(500), NOW), 'agora');
  assert.equal(formatRelativeTime(ago(1_000), NOW), 'há 1 segundo');
  assert.equal(formatRelativeTime(ago(42_000), NOW), 'há 42 segundos');
  assert.equal(formatRelativeTime(ago(60_000), NOW), 'há 1 minuto');
  assert.equal(formatRelativeTime(ago(5 * 60_000), NOW), 'há 5 minutos');
  assert.equal(formatRelativeTime(ago(60 * 60_000), NOW), 'há 1 hora');
  assert.equal(formatRelativeTime(ago(8 * 60 * 60_000), NOW), 'há 8 horas');
  assert.equal(formatRelativeTime(ago(24 * 60 * 60_000), NOW), 'há 1 dia');
  assert.equal(formatRelativeTime(ago(12 * 24 * 60 * 60_000), NOW), 'há 12 dias');
  assert.equal(formatRelativeTime(ago(30 * 24 * 60 * 60_000), NOW), 'há 1 mês');
  assert.equal(formatRelativeTime(ago(180 * 24 * 60 * 60_000), NOW), 'há 6 meses');
  assert.equal(formatRelativeTime(ago(365 * 24 * 60 * 60_000), NOW), 'há 1 ano');
  assert.equal(formatRelativeTime(ago(3 * 365 * 24 * 60 * 60_000), NOW), 'há 3 anos');
});

test('formatRelativeTime trata data ausente, inválida e futura com segurança', () => {
  assert.equal(formatRelativeTime(null, NOW), '—');
  assert.equal(formatRelativeTime('data inválida', NOW), '—');
  assert.equal(formatRelativeTime(new Date(NOW + 10_000), NOW), 'agora');
});

test('relativeTimeRefreshDelay agenda a próxima mudança do rótulo', () => {
  assert.equal(relativeTimeRefreshDelay(ago(42_250), NOW), 800);
  assert.equal(relativeTimeRefreshDelay(ago(5 * 60_000 + 15_000), NOW), 45_050);
  assert.equal(relativeTimeRefreshDelay(null, NOW), null);
});
