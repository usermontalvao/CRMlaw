import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABSENCE_COOLDOWN_HOURS,
  ABSENCE_COOLDOWN_MS,
  absenceCooldownCutoff,
  isAbsenceCooldownActive,
} from './absence-cooldown.ts';

const NOW = Date.parse('2026-08-04T23:00:00.000Z');

test('mantém o aviso em cooldown por 12 horas', () => {
  assert.equal(ABSENCE_COOLDOWN_HOURS, 12);
  assert.equal(
    isAbsenceCooldownActive(new Date(NOW - ABSENCE_COOLDOWN_MS + 1).toISOString(), NOW),
    true,
  );
});

test('libera novo aviso ao completar a janela', () => {
  assert.equal(
    isAbsenceCooldownActive(new Date(NOW - ABSENCE_COOLDOWN_MS).toISOString(), NOW),
    false,
  );
  assert.equal(isAbsenceCooldownActive(null, NOW), false);
  assert.equal(isAbsenceCooldownActive('data-invalida', NOW), false);
});

test('calcula o corte usado na reserva atômica', () => {
  assert.equal(
    absenceCooldownCutoff(NOW),
    new Date(NOW - ABSENCE_COOLDOWN_MS).toISOString(),
  );
});
