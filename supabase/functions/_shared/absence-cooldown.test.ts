import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABSENCE_COOLDOWN_HOURS,
  ABSENCE_COOLDOWN_MS,
  isAbsenceCooldownActive,
  absenceSuppressedByAi,
  type WaAbsenceAiState,
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

// ── Aviso fora do horário × agente de IA ────────────────────────────────────

const IA_ATENDENDO: WaAbsenceAiState = {
  channelAiEnabled: true,
  assistantId: '509cc5cf-25eb-4fca-ae5a-05f7ec07e69b',
  assistantActive: true,
  assistantMode: 'auto',
  sessionAiActive: true,
  conversationAssignedUserId: null,
  awaitingAccept: false,
};

test('com a IA atendendo, o aviso comercial não sai', () => {
  // O cliente escreve às 21h e é respondido às 21h: não há silêncio a explicar.
  assert.equal(absenceSuppressedByAi(IA_ATENDENDO), true);
});

test('o aviso volta sempre que a IA NÃO vai responder', () => {
  const sai = (patch: Partial<WaAbsenceAiState>) =>
    absenceSuppressedByAi({ ...IA_ATENDENDO, ...patch }) === false;
  assert.ok(sai({ channelAiEnabled: false }), 'canal sem IA');
  assert.ok(sai({ assistantId: null }), 'canal sem agente vinculado');
  assert.ok(sai({ assistantActive: false }), 'agente desligado');
  // Modo de teste registra o que FARIA e não manda nada: o silêncio é real.
  assert.ok(sai({ assistantMode: 'test' }), 'modo de teste');
  assert.ok(sai({ sessionAiActive: false }), 'conversa já entregue ao humano');
  assert.ok(sai({ conversationAssignedUserId: 'u-1' }), 'conversa com dono');
  assert.ok(sai({ awaitingAccept: true }), 'aguardando aceite de transferência');
});
