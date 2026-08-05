import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWaRich, waPlainText, stripAgentSignature } from './waRichText.ts';

test('marca simples vira trecho estilizado', () => {
  assert.deepEqual(parseWaRich('ola *mundo*'), [
    { text: 'ola ' },
    { text: 'mundo', bold: true },
  ]);
});

test('formatos encadeados acumulam estilo', () => {
  // O que a barra de formatacao produz ao clicar B, I e S no mesmo trecho.
  assert.deepEqual(parseWaRich('*_~tudo bem~_*'), [
    { text: 'tudo bem', bold: true, italic: true, strike: true },
  ]);
});

test('monoespacado nao interpreta o que esta dentro', () => {
  assert.deepEqual(parseWaRich('```a*b*c```'), [{ text: 'a*b*c', mono: true }]);
});

test('marca sem par fica como texto comum', () => {
  assert.deepEqual(parseWaRich('2 * 3 = 6'), [{ text: '2 * 3 = 6' }]);
  assert.deepEqual(parseWaRich('*sozinho'), [{ text: '*sozinho' }]);
});

test('espaco colado na marca nao formata', () => {
  // "* texto *" nao renderiza no WhatsApp; aqui tambem nao pode.
  assert.deepEqual(parseWaRich('* texto *'), [{ text: '* texto *' }]);
});

test('underline no meio da palavra nao vira italico', () => {
  assert.deepEqual(parseWaRich('nome_do_arquivo'), [{ text: 'nome_do_arquivo' }]);
  assert.deepEqual(parseWaRich('_de fato_'), [{ text: 'de fato', italic: true }]);
});

test('texto puro devolve as marcas removidas', () => {
  assert.equal(waPlainText('*_~tudo bem meu chapa~_*'), 'tudo bem meu chapa');
  assert.equal(waPlainText(''), '');
});

test('assinatura do atendente sai da primeira linha', () => {
  assert.equal(stripAgentSignature('*Pedro Montalvão:*\nbom dia'), 'bom dia');
  // Sem assinatura, nada muda — inclusive quando a mensagem comeca em negrito.
  assert.equal(stripAgentSignature('*bom dia*'), '*bom dia*');
});
