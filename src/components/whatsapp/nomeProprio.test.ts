import test from 'node:test';
import assert from 'node:assert/strict';
import { nomeProprio } from './nomeProprio.ts';

test('nome gritado vira nome escrito', () => {
  assert.equal(nomeProprio('LISLIANDRA CERQUEIRA INOCENCIO'), 'Lisliandra Cerqueira Inocencio');
  assert.equal(nomeProprio('PAULO HENRIQUE GARCIA BARBOSA'), 'Paulo Henrique Garcia Barbosa');
});

test('partículas ficam minúsculas, menos na primeira palavra', () => {
  assert.equal(nomeProprio('MARIA DE SOUZA DOS SANTOS'), 'Maria de Souza dos Santos');
  assert.equal(nomeProprio('DE LUCCA PEREIRA'), 'De Lucca Pereira');
});

test('o que já tem minúscula não é tocado', () => {
  assert.equal(nomeProprio('Maria de Souza'), 'Maria de Souza');
  assert.equal(nomeProprio('Dra. ANA'), 'Dra. ANA');
});

test('sigla e palavra única continuam em caixa alta', () => {
  assert.equal(nomeProprio('INSS'), 'INSS');
  assert.equal(nomeProprio('TJMT'), 'TJMT');
  assert.equal(nomeProprio('ESCRITORIO INSS'), 'Escritorio INSS');
});

test('hífen e apóstrofo têm duas iniciais', () => {
  assert.equal(nomeProprio('ANA-MARIA D\'ALMEIDA'), "Ana-Maria D'Almeida");
});

test('telefone e vazio passam intactos', () => {
  assert.equal(nomeProprio('+55 (65) 99999-9999'), '+55 (65) 99999-9999');
  assert.equal(nomeProprio(null), '');
  assert.equal(nomeProprio('   '), '');
});
