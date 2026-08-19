import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dialBlockMessage, dialableDigits, formatDialed, isPhoneQuery, nationalDigits, readDial,
} from './dialerInput.ts';

test('o número se escreve enquanto se digita, sem solavanco', () => {
  assert.equal(formatDialed('6'), '(6');
  assert.equal(formatDialed('65'), '(65');
  assert.equal(formatDialed('659'), '(65) 9');
  assert.equal(formatDialed('659961'), '(65) 9961');
  assert.equal(formatDialed('65996128'), '(65) 9961-28');
  assert.equal(formatDialed('65996128787'), '(65) 99612-8787');
  assert.equal(formatDialed('6530254410'), '(65) 3025-4410');
});

test('colar com o código do país dá no mesmo número que digitar sem ele', () => {
  assert.equal(formatDialed('+55 65 99612-8787'), '(65) 99612-8787');
  assert.equal(dialableDigits('+55 (65) 99612-8787'), '5565996128787');
  assert.equal(dialableDigits('65996128787'), '5565996128787');
});

test('um começo de DDD 55 não é confundido com código do país', () => {
  // "5565" ainda é alguém digitando o DDD 55 (RS) — cortar aqui escreveria (65).
  assert.equal(nationalDigits('5565'), '5565');
  assert.equal(formatDialed('5565'), '(55) 65');
});

test('nome não é telefone, nem quando tem número no meio', () => {
  assert.equal(isPhoneQuery('Lisliandra'), false);
  assert.equal(isPhoneQuery('João 2'), false);
  assert.equal(isPhoneQuery('(65) 99612-8787'), true);
  assert.equal(isPhoneQuery('65'), false, 'dois dígitos ainda podem ser o começo de um nome curto');
  assert.equal(isPhoneQuery('659'), true);
  assert.equal(isPhoneQuery(''), false);
});

test('só disca número inteiro, e sem adivinhar DDD', () => {
  assert.equal(dialableDigits('996128787'), '', 'nove dígitos sem DDD erram a cidade');
  assert.equal(dialableDigits('6530254410'), '556530254410', 'fixo com DDD vale');
  assert.equal(dialableDigits('659961287870'), '', 'dígitos demais');
});

test('o estado do campo é lido de uma vez só', () => {
  const vazio = readDial('   ');
  assert.equal(vazio.ready, false);
  assert.equal(vazio.block, 'vazio');
  assert.equal(vazio.searching, false);

  const nome = readDial('montal');
  assert.equal(nome.searching, true);
  assert.equal(nome.ready, false);
  assert.equal(nome.block, 'nome');
  assert.equal(nome.text, 'montal', 'nome não vira máscara de telefone');

  const meio = readDial('65996');
  assert.equal(meio.ready, false);
  assert.equal(meio.block, 'curto');
  assert.equal(meio.text, '(65) 996');

  const pronto = readDial('65 99612-8787');
  assert.equal(pronto.ready, true);
  assert.equal(pronto.block, null);
  assert.equal(pronto.phone, '5565996128787');
});

test('o botão apagado sempre diz por quê', () => {
  assert.match(dialBlockMessage('vazio'), /Digite um número/);
  assert.match(dialBlockMessage('nome'), /Escolha um contato/);
  assert.match(dialBlockMessage('curto', '65996'), /Faltam \d+ dígitos/);
  assert.match(dialBlockMessage('longo'), /Dígitos demais/);
  assert.equal(dialBlockMessage(null), '');
});
