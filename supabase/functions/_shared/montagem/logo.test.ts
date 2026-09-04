import test from 'node:test';
import assert from 'node:assert/strict';

import { LOGO_LADO, logoPngBytes } from './logo.ts';

test('os bytes decodificados são mesmo um PNG', () => {
  const b = logoPngBytes();
  assert.deepEqual(Array.from(b.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('o cabeçalho IHDR diz 128×128 — o lockup conta com o ícone quadrado', () => {
  // Largura e altura vivem nos bytes 16..23, big-endian, logo depois de "IHDR".
  const b = logoPngBytes();
  const lerU32 = (i: number) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
  assert.equal(lerU32(16), LOGO_LADO);
  assert.equal(lerU32(20), LOGO_LADO);
});

test('o base64 não foi truncado ao ser quebrado em linhas', () => {
  // O modo de falha real: a constante é escrita como concatenação de ~180
  // linhas, e perder uma delas produz um PNG que decodifica pela metade. O
  // `embedPng` do pdf-lib aceita e desenha um ícone cortado, calado.
  const b = logoPngBytes();
  assert.equal(b.length, 12967);
  // "IEND" fecha todo PNG íntegro.
  const fim = String.fromCharCode(...b.subarray(b.length - 8, b.length - 4));
  assert.equal(fim, 'IEND');
});

test('cada chamada devolve um buffer PRÓPRIO', () => {
  // Duas montagens simultâneas não podem compartilhar o mesmo Uint8Array: uma
  // delas embutiria bytes que a outra já consumiu.
  const a = logoPngBytes();
  const b = logoPngBytes();
  assert.notEqual(a, b);
  assert.deepEqual(Array.from(a.subarray(0, 32)), Array.from(b.subarray(0, 32)));
});
