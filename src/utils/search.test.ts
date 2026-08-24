import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchTextVariants,
  includesNormalizedSearch,
  matchesNormalizedSearch,
  normalizeSearchText,
  replaceNormalizedSearch,
} from './search.ts';

test('normaliza acentos e caixa para pesquisa em português', () => {
  assert.equal(normalizeSearchText('  AÇÃO PREVIDENCIÁRIA  '), 'acao previdenciaria');
});

test('encontra texto mesmo quando somente um dos lados tem acento', () => {
  assert.equal(matchesNormalizedSearch('Joao', ['João da Silva']), true);
  assert.equal(matchesNormalizedSearch('audiência', ['Audiencia de conciliação']), true);
});

test('preserva pesquisa por números e pontuação', () => {
  assert.equal(includesNormalizedSearch('Processo 123.456-7', '123.456'), true);
});

test('gera variações para servidores que diferenciam acentos', () => {
  const actionVariants = buildSearchTextVariants('acao');
  const nameVariants = buildSearchTextVariants('João');

  assert.equal(actionVariants.includes('ação'), true);
  assert.equal(nameVariants.includes('joao'), true);
  assert.equal(nameVariants.includes('joão'), true);
  assert.ok(actionVariants.length <= 24);
});

test('substitui ocorrências sem diferenciar acento', () => {
  assert.equal(replaceNormalizedSearch('Ação e outra ação.docx', 'acao', 'Petição'), 'Petição e outra Petição.docx');
});
