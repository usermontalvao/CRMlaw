// Cobertura da geração de nomes anti-conflito ("manter ambos").
// Execução: `npx ts-node --esm src/utils/nextcloudNames.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitNameExt, nextAvailableName, joinPath } from './nextcloudNames.ts';

test('splitNameExt separa base e extensão', () => {
  assert.deepEqual(splitNameExt('doc.pdf'), { base: 'doc', ext: '.pdf' });
  assert.deepEqual(splitNameExt('sem-extensao'), { base: 'sem-extensao', ext: '' });
  assert.deepEqual(splitNameExt('.oculto'), { base: '.oculto', ext: '' });
  assert.deepEqual(splitNameExt('a.b.c'), { base: 'a.b', ext: '.c' });
});

test('nextAvailableName devolve o próprio nome quando livre', () => {
  assert.equal(nextAvailableName('doc.pdf', new Set()), 'doc.pdf');
});

test('nextAvailableName aplica "(cópia)" e incrementa sem colidir', () => {
  assert.equal(nextAvailableName('doc.pdf', new Set(['doc.pdf'])), 'doc (cópia).pdf');
  assert.equal(
    nextAvailableName('doc.pdf', new Set(['doc.pdf', 'doc (cópia).pdf'])),
    'doc (cópia 2).pdf',
  );
  assert.equal(
    nextAvailableName('doc.pdf', new Set(['doc.pdf', 'doc (cópia).pdf', 'doc (cópia 2).pdf'])),
    'doc (cópia 3).pdf',
  );
});

test('nextAvailableName preserva extensão em nomes sem ela', () => {
  assert.equal(nextAvailableName('pasta', new Set(['pasta'])), 'pasta (cópia)');
});

test('joinPath ignora segmentos vazios', () => {
  assert.equal(joinPath('', 'a.pdf'), 'a.pdf');
  assert.equal(joinPath('Clientes/2026', 'a.pdf'), 'Clientes/2026/a.pdf');
});
