// Regressão do "conflito de versão" falso: o ETag do proxy vem sem aspas, mas
// o If-Match exige uma entity-tag entre aspas. Sem isso, TODO salvamento no
// Nextcloud devolvia 412.
// Execução: `npx ts-node --esm src/utils/entityTag.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { toEntityTag, sameEntityTag } from './entityTag.ts';

test('toEntityTag põe aspas no ETag cru vindo do proxy', () => {
  assert.equal(toEntityTag('6a1b2c3d4e5f'), '"6a1b2c3d4e5f"');
});

test('toEntityTag não duplica aspas nem quebra o formato fraco', () => {
  assert.equal(toEntityTag('"6a1b2c3d4e5f"'), '"6a1b2c3d4e5f"');
  assert.equal(toEntityTag('W/"6a1b2c3d4e5f"'), 'W/"6a1b2c3d4e5f"');
});

test('toEntityTag devolve null quando não há ETag utilizável', () => {
  assert.equal(toEntityTag(''), null);
  assert.equal(toEntityTag('   '), null);
  assert.equal(toEntityTag(null), null);
  assert.equal(toEntityTag(undefined), null);
  assert.equal(toEntityTag('""'), '""');
});

test('toEntityTag preserva o coringa "*"', () => {
  assert.equal(toEntityTag('*'), '*');
});

test('toEntityTag remove aspas internas que quebrariam o header', () => {
  assert.equal(toEntityTag('ab"cd'), '"abcd"');
});

test('sameEntityTag ignora aspas e prefixo fraco', () => {
  assert.equal(sameEntityTag('abc', '"abc"'), true);
  assert.equal(sameEntityTag('W/"abc"', 'abc'), true);
  assert.equal(sameEntityTag('abc', 'def'), false);
});

test('sameEntityTag é falso quando falta algum dos lados', () => {
  assert.equal(sameEntityTag(null, 'abc'), false);
  assert.equal(sameEntityTag('abc', ''), false);
  assert.equal(sameEntityTag(null, null), false);
});
