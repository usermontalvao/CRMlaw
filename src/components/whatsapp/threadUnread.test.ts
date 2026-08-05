import test from 'node:test';
import assert from 'node:assert/strict';
import { countNewBelow, emptySeenMark, markAllSeen, type CountableMessage } from './threadUnread.ts';

const msg = (id: string, direction: 'in' | 'out', ts: string): CountableMessage =>
  ({ id, direction, wa_timestamp: ts });

test('conta só o que chegou depois da marca, e só o que foi recebido', () => {
  const inicial = [
    msg('a', 'in', '2026-08-04T10:00:00Z'),
    msg('b', 'out', '2026-08-04T10:01:00Z'),
  ];
  const marca = markAllSeen(emptySeenMark(), inicial);
  assert.equal(countNewBelow(inicial, marca), 0);

  const depois = [
    ...inicial,
    msg('c', 'in', '2026-08-04T10:05:00Z'),
    msg('d', 'out', '2026-08-04T10:06:00Z'), // resposta do próprio atendente
    msg('e', 'in', '2026-08-04T10:07:00Z'),
  ];
  assert.equal(countNewBelow(depois, marca), 2);
});

test('histórico paginado não vira "mensagem nova"', () => {
  // O atendente está no fim, sobe para reler e pede "carregar mais": chegam
  // mensagens ANTIGAS no começo da lista, que ele nunca viu nesta sessão.
  const janela = [
    msg('novo-1', 'in', '2026-08-04T10:00:00Z'),
    msg('novo-2', 'out', '2026-08-04T10:01:00Z'),
  ];
  const marca = markAllSeen(emptySeenMark(), janela);

  const comHistorico = [
    msg('velho-1', 'in', '2026-07-30T08:00:00Z'),
    msg('velho-2', 'in', '2026-07-30T08:01:00Z'),
    ...janela,
  ];
  assert.equal(countNewBelow(comHistorico, marca), 0);

  // E uma mensagem que chega de verdade depois disso ainda é contada.
  const comNova = [...comHistorico, msg('nova', 'in', '2026-08-04T10:09:00Z')];
  assert.equal(countNewBelow(comNova, marca), 1);
});

test('sem marca nenhuma, tudo que foi recebido conta', () => {
  const lista = [
    msg('a', 'in', '2026-08-04T10:00:00Z'),
    msg('b', 'out', '2026-08-04T10:01:00Z'),
    msg('c', 'in', '2026-08-04T10:02:00Z'),
  ];
  assert.equal(countNewBelow(lista, emptySeenMark()), 2);
});

test('marcar como visto avança o piso e é acumulativo', () => {
  const primeira = markAllSeen(emptySeenMark(), [msg('a', 'in', '2026-08-04T10:00:00Z')]);
  assert.equal(primeira.floorTs, '2026-08-04T10:00:00Z');

  const segunda = markAllSeen(primeira, [msg('b', 'in', '2026-08-04T10:05:00Z')]);
  assert.equal(segunda.floorTs, '2026-08-04T10:05:00Z');
  assert.ok(segunda.ids.has('a') && segunda.ids.has('b'));

  // Marcar uma leva mais antiga não pode puxar o piso para trás.
  const terceira = markAllSeen(segunda, [msg('c', 'in', '2026-07-01T09:00:00Z')]);
  assert.equal(terceira.floorTs, '2026-08-04T10:05:00Z');
});

test('a marca anterior não é mutada (o estado antigo continua válido)', () => {
  const antes = markAllSeen(emptySeenMark(), [msg('a', 'in', '2026-08-04T10:00:00Z')]);
  markAllSeen(antes, [msg('b', 'in', '2026-08-04T10:05:00Z')]);
  assert.equal(antes.ids.has('b'), false);
  assert.equal(antes.floorTs, '2026-08-04T10:00:00Z');
});
