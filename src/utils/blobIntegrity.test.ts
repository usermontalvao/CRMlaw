import assert from 'node:assert/strict';
import test from 'node:test';
import { blobContentsEqual } from './blobIntegrity.ts';

test('blobContentsEqual confirma blobs com o mesmo conteúdo', async () => {
  const expected = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const actual = new Blob([new Uint8Array([1, 2, 3, 4])]);

  assert.equal(await blobContentsEqual(expected, actual), true);
});

test('blobContentsEqual rejeita conteúdo diferente com o mesmo tamanho', async () => {
  const expected = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const actual = new Blob([new Uint8Array([1, 2, 9, 4])]);

  assert.equal(await blobContentsEqual(expected, actual), false);
});

test('blobContentsEqual rejeita blobs com tamanhos diferentes', async () => {
  const expected = new Blob([new Uint8Array([1, 2, 3])]);
  const actual = new Blob([new Uint8Array([1, 2, 3, 4])]);

  assert.equal(await blobContentsEqual(expected, actual), false);
});
