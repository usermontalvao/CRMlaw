import test from 'node:test';
import assert from 'node:assert/strict';
import { float32ToInt16LE, int16LEToFloat32 } from './pcm.ts';

test('o silêncio vira zero e ocupa dois bytes por amostra', () => {
  const buf = float32ToInt16LE(new Float32Array([0, 0, 0]));
  assert.equal(buf.byteLength, 6);
  assert.deepEqual(Array.from(new Int16Array(buf)), [0, 0, 0]);
});

test('os picos saturam nos limites do inteiro de 16 bits', () => {
  const buf = float32ToInt16LE(new Float32Array([1, -1, 2, -2]));
  assert.deepEqual(Array.from(new Int16Array(buf)), [32767, -32768, 32767, -32768]);
});

test('NaN não contamina o quadro — vira silêncio', () => {
  const buf = float32ToInt16LE(new Float32Array([NaN]));
  assert.deepEqual(Array.from(new Int16Array(buf)), [0]);
});

test('a ordem dos bytes é little-endian, que é o que o servidor Go lê', () => {
  const buf = float32ToInt16LE(new Float32Array([1]));
  assert.deepEqual(Array.from(new Uint8Array(buf)), [0xff, 0x7f]);
});

test('ida e volta preserva o sinal dentro do erro de quantização', () => {
  const original = new Float32Array([0, 0.25, -0.25, 0.5, -0.75]);
  const back = int16LEToFloat32(float32ToInt16LE(original));
  assert.equal(back.length, original.length);
  for (let i = 0; i < original.length; i += 1) {
    assert.ok(Math.abs(back[i] - original[i]) < 1e-4, `amostra ${i}: ${back[i]} != ${original[i]}`);
  }
});

test('quadro com byte ímpar sobrando não estoura — a amostra parcial é descartada', () => {
  const out = int16LEToFloat32(new Uint8Array([0x00, 0x40, 0x11]).buffer);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-4);
});
