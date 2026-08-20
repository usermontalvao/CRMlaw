import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agruparReacoes, aplicarReacao, proximaReacao, reacaoDe, MAX_REACOES, type WaReacao } from './waReactions.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waReactions.ts', import.meta.url), 'utf8');
  const espelho = readFileSync(
    new URL('../../supabase/functions/_shared/wa-reactions.ts', import.meta.url), 'utf8');
  assert.equal(espelho, src, 'wa-reactions.ts divergiu — copie o arquivo inteiro');
});

const r = (actor: string, emoji: string, from: 'in' | 'out' = 'out', name?: string): WaReacao =>
  ({ actor, emoji, from, name, at: '2026-08-20T12:00:00.000Z' });

test('cada pessoa tem uma reação só: reagir de novo troca a anterior', () => {
  let lista = aplicarReacao([], r('ana', '👍'));
  lista = aplicarReacao(lista, r('ana', '❤️'));
  assert.deepEqual(lista.map(x => x.emoji), ['❤️']);
});

test('gravar duas vezes o mesmo emoji não desfaz (reentrega do webhook)', () => {
  const lista = aplicarReacao(aplicarReacao([], r('ana', '👍')), r('ana', '👍'));
  assert.deepEqual(lista.map(x => x.emoji), ['👍']);
});

test('a alternância é da tela: clicar na própria pastilha manda vazio', () => {
  assert.equal(proximaReacao('👍', '👍'), '');
  assert.equal(proximaReacao('👍', '❤️'), '❤️');
  assert.equal(proximaReacao(null, '🙏'), '🙏');
});

test('emoji vazio remove — é como o WhatsApp avisa que desfizeram', () => {
  const lista = aplicarReacao(aplicarReacao([], r('contato', '😂', 'in')), r('contato', '', 'in'));
  assert.deepEqual(lista, []);
});

test('reações de pessoas diferentes convivem', () => {
  let lista = aplicarReacao(null, r('ana', '👍'));
  lista = aplicarReacao(lista, r('contato', '👍', 'in'));
  lista = aplicarReacao(lista, r('bruno', '🙏'));
  assert.equal(lista.length, 3);
  assert.equal(reacaoDe(lista, 'bruno'), '🙏');
  assert.equal(reacaoDe(lista, 'ninguem'), null);
});

test('a lista tem teto — grupo grande não vira linha infinita', () => {
  let lista: WaReacao[] = [];
  for (let i = 0; i < MAX_REACOES + 10; i++) lista = aplicarReacao(lista, r(`p${i}`, '👍'));
  assert.equal(lista.length, MAX_REACOES);
});

test('agrupa por emoji na ordem da primeira reação e marca a minha', () => {
  let lista = aplicarReacao([], r('contato', '❤️', 'in'));
  lista = aplicarReacao(lista, r('ana', '👍', 'out', 'Ana'));
  lista = aplicarReacao(lista, r('bruno', '❤️', 'out', 'Bruno'));
  const chips = agruparReacoes(lista, 'ana');
  assert.deepEqual(chips.map(c => [c.emoji, c.total, c.minha]), [['❤️', 2, false], ['👍', 1, true]]);
  assert.deepEqual(chips[0].quem, ['Contato', 'Bruno']);
});
