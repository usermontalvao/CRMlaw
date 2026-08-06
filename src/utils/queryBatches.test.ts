// Cobertura da quebra em lotes das consultas `in.(...)`.
// Execução: `node --test --import ts-node/esm src/utils/queryBatches.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { TAMANHO_LOTE_IN, dividirEmLotes } from './queryBatches.ts';

test('lista vazia não gera lote nenhum', () => {
  assert.deepEqual(dividirEmLotes([], 10), []);
});

test('lista menor que o teto cabe num lote só', () => {
  assert.deepEqual(dividirEmLotes([1, 2, 3], 10), [[1, 2, 3]]);
});

test('divisão exata não deixa lote vazio na ponta', () => {
  assert.deepEqual(dividirEmLotes([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);
});

test('o resto vira o último lote', () => {
  assert.deepEqual(dividirEmLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('nenhum item se perde nem se repete', () => {
  const itens = Array.from({ length: 837 }, (_, i) => i);
  const lotes = dividirEmLotes(itens, TAMANHO_LOTE_IN);
  assert.deepEqual(lotes.flat(), itens);
  assert.equal(new Set(lotes.flat()).size, itens.length);
});

test('nenhum lote passa do teto', () => {
  const itens = Array.from({ length: 837 }, (_, i) => i);
  for (const lote of dividirEmLotes(itens, TAMANHO_LOTE_IN)) {
    assert.ok(lote.length <= TAMANHO_LOTE_IN, `lote com ${lote.length} itens`);
  }
});

test('o caso real cabe na URL: 837 UUIDs em lotes abaixo de 8 kB', () => {
  // 36 do UUID + 3 do separador já codificado (%2C).
  const porItem = 39;
  const itens = Array.from({ length: 837 }, (_, i) => i);
  for (const lote of dividirEmLotes(itens, TAMANHO_LOTE_IN)) {
    assert.ok(lote.length * porItem < 8000, `lote geraria ${lote.length * porItem} bytes de filtro`);
  }
});

test('teto inválido não gera laço infinito nem lote vazio', () => {
  assert.deepEqual(dividirEmLotes([1, 2, 3], 0), [[1], [2], [3]]);
  assert.deepEqual(dividirEmLotes([1, 2, 3], -5), [[1], [2], [3]]);
  assert.deepEqual(dividirEmLotes([1, 2, 3], 1.9), [[1], [2], [3]]);
});
