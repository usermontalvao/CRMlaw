import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPorCanalPermitido } from './canaisPermitidos.ts';

const conversa = (id: string, canal: string | null) => ({ id, instance_id: canal });

test('deixa passar só as conversas de canal permitido', () => {
  const linhas = [conversa('a', 'c1'), conversa('b', 'c2'), conversa('c', 'c1')];
  const fora = filtrarPorCanalPermitido(linhas, ['c1']);
  assert.deepEqual(fora.map(l => l.id), ['a', 'c']);
});

test('conversa sem canal passa: quem decide sobre ela é a policy', () => {
  const linhas = [conversa('a', null), conversa('b', 'proibido')];
  assert.deepEqual(filtrarPorCanalPermitido(linhas, ['c1']).map(l => l.id), ['a']);
});

test('lista de canais vazia não filtra — vazio sob RLS é "ainda não sei"', () => {
  const linhas = [conversa('a', 'c1'), conversa('b', 'c2')];
  assert.equal(filtrarPorCanalPermitido(linhas, []).length, 2);
  assert.equal(filtrarPorCanalPermitido(linhas, null).length, 2);
  assert.equal(filtrarPorCanalPermitido(linhas, undefined).length, 2);
});

test('sem linhas devolve lista vazia, nunca nulo', () => {
  assert.deepEqual(filtrarPorCanalPermitido(null, ['c1']), []);
  assert.deepEqual(filtrarPorCanalPermitido(undefined, ['c1']), []);
});

test('não altera a lista recebida', () => {
  const linhas = [conversa('a', 'c1'), conversa('b', 'c2')];
  filtrarPorCanalPermitido(linhas, ['c1']);
  assert.equal(linhas.length, 2);
});

test('todo canal permitido devolve tudo, na mesma ordem', () => {
  const linhas = [conversa('a', 'c1'), conversa('b', 'c2')];
  assert.deepEqual(filtrarPorCanalPermitido(linhas, ['c2', 'c1']).map(l => l.id), ['a', 'b']);
});
