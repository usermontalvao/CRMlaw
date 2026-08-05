import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWaFormat, formatFromKey } from './composerFormat.ts';

test('envolve o trecho selecionado com a marca do WhatsApp', () => {
  const r = applyWaFormat('ola mundo', 0, 3, 'bold');
  assert.equal(r.text, '*ola* mundo');
  assert.equal(r.changed, true);
  // A seleção volta sobre o texto, sem as marcas, para encadear outro formato.
  assert.equal(r.text.slice(r.selectionStart, r.selectionEnd), 'ola');
});

test('cada formato usa a sua marca', () => {
  assert.equal(applyWaFormat('ola', 0, 3, 'italic').text, '_ola_');
  assert.equal(applyWaFormat('ola', 0, 3, 'strike').text, '~ola~');
  assert.equal(applyWaFormat('ola', 0, 3, 'mono').text, '```ola```');
});

test('espaco nas pontas fica fora das marcas', () => {
  // Selecionar arrastando quase sempre leva um espaco junto; "* mundo *" nao
  // renderiza no WhatsApp.
  const r = applyWaFormat('ola mundo', 3, 9, 'bold');
  assert.equal(r.text, 'ola *mundo*');
  assert.equal(r.text.slice(r.selectionStart, r.selectionEnd), 'mundo');
});

test('reaplicar desmarca quando as marcas estao dentro da selecao', () => {
  const r = applyWaFormat('*ola* mundo', 0, 5, 'bold');
  assert.equal(r.text, 'ola mundo');
  assert.equal(r.text.slice(r.selectionStart, r.selectionEnd), 'ola');
});

test('reaplicar desmarca quando as marcas ficaram fora da selecao', () => {
  // O usuario seleciona so a palavra, sem os asteriscos — o caso comum.
  const r = applyWaFormat('*ola* mundo', 1, 4, 'bold');
  assert.equal(r.text, 'ola mundo');
  assert.equal(r.text.slice(r.selectionStart, r.selectionEnd), 'ola');
});

test('desmarcar monoespacado leva as tres crases dos dois lados', () => {
  const r = applyWaFormat('```codigo```', 0, 12, 'mono');
  assert.equal(r.text, 'codigo');
});

test('formatos diferentes se encadeiam', () => {
  const negrito = applyWaFormat('ola mundo', 0, 3, 'bold');
  const italico = applyWaFormat(negrito.text, negrito.selectionStart, negrito.selectionEnd, 'italic');
  assert.equal(italico.text, '*_ola_* mundo');
});

test('selecao vazia ou so de espaco nao mexe no texto', () => {
  const vazia = applyWaFormat('ola mundo', 4, 4, 'bold');
  assert.equal(vazia.changed, false);
  assert.equal(vazia.text, 'ola mundo');
  const espaco = applyWaFormat('ola mundo', 3, 4, 'bold');
  assert.equal(espaco.changed, false, 'selecionar so o espaco nao formata nada');
});

test('selecao invertida (arrastada da direita para a esquerda) funciona igual', () => {
  assert.equal(applyWaFormat('ola mundo', 3, 0, 'bold').text, '*ola* mundo');
});

test('limites fora do texto nao quebram', () => {
  assert.equal(applyWaFormat('ola', -5, 2, 'bold').changed, false);
  assert.equal(applyWaFormat('ola', 0, 99, 'bold').changed, false);
});

test('atalhos de teclado do compositor', () => {
  assert.equal(formatFromKey('b', true, false), 'bold');
  assert.equal(formatFromKey('B', true, false), 'bold');
  assert.equal(formatFromKey('i', true, false), 'italic');
  assert.equal(formatFromKey('x', true, true), 'strike');
  // Sem Ctrl/Cmd nao e atalho: e a letra sendo digitada.
  assert.equal(formatFromKey('b', false, false), null);
  // Ctrl+X sozinho continua sendo recortar.
  assert.equal(formatFromKey('x', true, false), null);
});
