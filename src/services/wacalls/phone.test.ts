import test from 'node:test';
import assert from 'node:assert/strict';
import { toWaCallsPhone, phoneFromWaCallsPeer } from './phone.ts';

test('o número que o WhatsApp guarda já sai pronto', () => {
  assert.equal(toWaCallsPhone('5565999999999'), '5565999999999');
});

test('máscara, espaço e "+" caem fora — o servidor só quer dígitos', () => {
  assert.equal(toWaCallsPhone('+55 (65) 99999-9999'), '5565999999999');
});

test('sem código do país, assume Brasil (celular e fixo)', () => {
  assert.equal(toWaCallsPhone('65999999999'), '5565999999999');
  assert.equal(toWaCallsPhone('6533334444'), '556533334444');
});

test('número antigo de 8 dígitos com o 55 continua valendo', () => {
  assert.equal(toWaCallsPhone('556533334444'), '556533334444');
});

test('o que não dá número devolve vazio em vez de discar errado', () => {
  assert.equal(toWaCallsPhone(''), '');
  assert.equal(toWaCallsPhone(null), '');
  assert.equal(toWaCallsPhone('123'), '');
  assert.equal(toWaCallsPhone('5565999999999999'), '');
});

test('o peer dos eventos vem como JID e volta como dígitos', () => {
  assert.equal(phoneFromWaCallsPeer('5565999999999@s.whatsapp.net'), '5565999999999');
  assert.equal(phoneFromWaCallsPeer('5565999999999:12@s.whatsapp.net'), '5565999999999');
  assert.equal(phoneFromWaCallsPeer(null), '');
});
