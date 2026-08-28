import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waAiFactHasCustomerEvidence } from './waAiTurnPolicy.ts';

test('o espelho da política de turno é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiTurnPolicy.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-turn-policy.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src);
});

const empregador = {
  key: 'empregador', label: 'Empregador', type: 'texto',
  ask: 'para quem trabalhava', question: 'Qual é o nome da empresa ou pessoa?',
};

test('sim, todos, empresa e duração não viram nome de empregador', () => {
  for (const resposta of ['Sim', 'Todos', 'Empresa', 'Um ano']) {
    assert.equal(waAiFactHasCustomerEvidence(empregador, resposta, resposta), false, resposta);
  }
});

test('nome presente na fala pode preencher identidade, inclusive em fragmentos', () => {
  assert.equal(waAiFactHasCustomerEvidence(
    empregador, 'Madeireira Pinheiro', 'É de madeira. Pinheiro.',
  ), true);
  assert.equal(waAiFactHasCustomerEvidence(
    { ...empregador, key: 'nome', label: 'Nome' }, 'Marisa Richter', 'Marisa richter',
  ), true);
});

test('valor sem número ou unidade monetária continua pendente', () => {
  const pagamento = {
    key: 'pagamento', label: 'Pagamento', type: 'texto',
    ask: 'quanto recebia', question: 'Quanto te pagavam por mês?',
  };
  assert.equal(waAiFactHasCustomerEvidence(pagamento, 'só pagamento', 'só pagamento'), false);
  assert.equal(waAiFactHasCustomerEvidence(pagamento, 'R$ 2.000 por mês', 'dois mil por mês'), true);
});

test('texto narrativo comum não é bloqueado pela política de identidade ou valor', () => {
  assert.equal(waAiFactHasCustomerEvidence(
    { key: 'problema', label: 'Problema', type: 'texto', ask: 'o que aconteceu' },
    'Fiquei doente e não recebi auxílio', 'Fiquei doente e não recebi auxílio',
  ), true);
});
