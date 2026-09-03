import assert from 'node:assert/strict';
import test from 'node:test';
import { extrairTokenDeAssinatura, lerBuscaDeAssinatura, somenteDigitos } from './buscaDeAssinatura.ts';

const TOKEN = '2cd6a16a-11bd-44bc-85fa-6021cc577fc0';

test('aceita o token solto, como sai da tela de erro', () => {
  assert.equal(extrairTokenDeAssinatura(TOKEN), TOKEN);
  assert.equal(extrairTokenDeAssinatura(`  ${TOKEN}  `), TOKEN);
  assert.equal(extrairTokenDeAssinatura(TOKEN.toUpperCase()), TOKEN);
});

test('aceita o link inteiro — é o que a pessoa encaminha do WhatsApp', () => {
  assert.equal(extrairTokenDeAssinatura(`https://jurius.com.br/#/assinar/${TOKEN}`), TOKEN);
  assert.equal(extrairTokenDeAssinatura(`https://jurius.com.br/assinar/${TOKEN}`), TOKEN);
  assert.equal(extrairTokenDeAssinatura(`https://jurius.com.br/#/assinar/${TOKEN}?x=1`), TOKEN);
});

test('não confunde texto qualquer com token', () => {
  assert.equal(extrairTokenDeAssinatura('CONTRATO DE HONORÁRIOS'), null);
  assert.equal(extrairTokenDeAssinatura(''), null);
  // Parece, mas não é: falta um bloco.
  assert.equal(extrairTokenDeAssinatura('2cd6a16a-11bd-44bc-85fa'), null);
});

test('classifica o termo', () => {
  assert.equal(lerBuscaDeAssinatura('').tipo, 'vazio');
  assert.equal(lerBuscaDeAssinatura('   ').tipo, 'vazio');
  assert.equal(lerBuscaDeAssinatura(TOKEN).tipo, 'token');
  assert.equal(lerBuscaDeAssinatura('045.448.031-93').tipo, 'digitos');
  assert.equal(lerBuscaDeAssinatura('(65) 98404-6375').tipo, 'digitos');
  assert.equal(lerBuscaDeAssinatura('Pedro').tipo, 'texto');
});

test('o piso de 6 dígitos protege a busca de texto', () => {
  // "Contrato 12" tem letra: é texto, e o 12 não vira CPF.
  assert.equal(lerBuscaDeAssinatura('Contrato 12').tipo, 'texto');
  // Poucos dígitos sozinhos também continuam texto.
  assert.equal(lerBuscaDeAssinatura('123').tipo, 'texto');
  assert.equal(lerBuscaDeAssinatura('123456').tipo, 'digitos');
});

test('somenteDigitos limpa a pontuação do CPF', () => {
  assert.equal(somenteDigitos('045.448.031-93'), '04544803193');
  assert.equal(somenteDigitos(null), '');
  assert.equal(somenteDigitos(undefined), '');
});
