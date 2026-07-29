// Cobertura da regra que decide quando a IA pode julgar contatos duplicados —
// e do quanto dois CPFs "quase iguais" contam como erro de digitação.
// Execução: `node --test --import ts-node/esm src/utils/clientDuplicates.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CPF_TYPO_TOLERANCE,
  cpfTypoDistance,
  isCertainDuplicate,
  looksLikeCpfTypo,
  needsAiJudgement,
} from './clientDuplicateGating.ts';

test('distância de CPF conta dígitos trocados', () => {
  assert.equal(cpfTypoDistance('04544803193', '04544803193'), 0);
  assert.equal(cpfTypoDistance('04544803193', '04574803193'), 1, 'um dígito diferente');
  assert.equal(cpfTypoDistance('04544803193', '04574803194'), 2);
  assert.equal(cpfTypoDistance('11111111111', '99999999999'), 11);
});

test('dois dígitos vizinhos invertidos contam como um erro só', () => {
  // 45 -> 54 na mesma posição: erro clássico de digitação.
  assert.equal(cpfTypoDistance('04545803193', '04554803193'), 1);
});

test('CPFs de tamanhos diferentes não são comparáveis', () => {
  assert.equal(cpfTypoDistance('0454480319', '04544803193'), Infinity);
});

test('CPF parecido só vira suspeita com nome E contato batendo', () => {
  const base = { cpfA: '04544803193', cpfB: '04574803193' };

  assert.equal(looksLikeCpfTypo({ ...base, sameName: true, sameContact: true }), true);
  assert.equal(looksLikeCpfTypo({ ...base, sameName: true, sameContact: false }), false, 'nome igual sozinho não basta');
  assert.equal(looksLikeCpfTypo({ ...base, sameName: false, sameContact: true }), false, 'contato igual sozinho não basta');
});

test('CPFs realmente distintos nunca passam por erro de digitação', () => {
  assert.equal(
    looksLikeCpfTypo({ cpfA: '11111111111', cpfB: '99999999999', sameName: true, sameContact: true }),
    false,
  );
});

test('CPF idêntico não é caso de IA — é caso de regra', () => {
  const group = { reasons: ['CPF igual', 'Nome igual'] };
  assert.equal(isCertainDuplicate(group), true);
  assert.equal(needsAiJudgement(group), false);
});

test('indícios ambíguos acionam a IA', () => {
  assert.equal(needsAiJudgement({ reasons: ['CPF parecido', 'Nome igual', 'Telefone igual'] }), true);
  assert.equal(needsAiJudgement({ reasons: ['Nome igual'] }), true);
  assert.equal(needsAiJudgement({ reasons: ['Telefone igual'] }), true);
});

test('sem nenhum indício a IA não é acionada', () => {
  assert.equal(needsAiJudgement({ reasons: [] }), false);
  assert.equal(needsAiJudgement({ reasons: ['Outro motivo qualquer'] }), false);
});

test('a tolerância de digitação é estreita de propósito', () => {
  assert.ok(CPF_TYPO_TOLERANCE <= 2, 'tolerância larga misturaria pessoas diferentes');
});
