import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowPrivateAiHandoffSummary } from './waAiHandoffSummary.ts';

test('mostra o resumo somente ao atendente responsável depois do handoff', () => {
  assert.equal(canShowPrivateAiHandoffSummary({
    currentUserId: 'destino', assignedUserId: 'destino', status: 'handed_off',
  }), true);
  assert.equal(canShowPrivateAiHandoffSummary({
    currentUserId: 'colega', assignedUserId: 'destino', status: 'handed_off',
  }), false);
  assert.equal(canShowPrivateAiHandoffSummary({
    currentUserId: 'destino', assignedUserId: 'destino', status: 'active',
  }), false);
});

test('transferência para setor só revela depois que alguém aceitar e virar responsável', () => {
  assert.equal(canShowPrivateAiHandoffSummary({
    currentUserId: 'membro', assignedUserId: null, status: 'handed_off',
  }), false);
  assert.equal(canShowPrivateAiHandoffSummary({
    currentUserId: null, assignedUserId: 'destino', status: 'handed_off',
  }), false);
});

