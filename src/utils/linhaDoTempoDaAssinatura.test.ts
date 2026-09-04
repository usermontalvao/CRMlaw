import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparLinhaDoTempo,
  descreverGrupo,
  type EventoDeAuditoria,
} from './linhaDoTempoDaAssinatura.ts';

const ev = (id: string, action: string, created_at: string, signer_id: string | null = 's1'): EventoDeAuditoria =>
  ({ id, action, created_at, signer_id, description: `${action} do documento` });

test('aberturas seguidas viram uma linha só', () => {
  const itens = agruparLinhaDoTempo([
    ev('1', 'created', '2026-09-01T09:17:00Z', null),
    ev('2', 'viewed', '2026-09-01T15:51:00Z'),
    ev('3', 'viewed', '2026-09-01T16:08:00Z'),
    ev('4', 'viewed', '2026-09-02T10:00:00Z'),
  ]);
  assert.equal(itens.length, 2);
  assert.equal(itens[1].quantidade, 3);
  assert.equal(descreverGrupo(itens[1]), '3 aberturas do documento');
  assert.equal(itens[1].primeiroEm, '2026-09-01T15:51:00Z');
  assert.equal(itens[1].evento.id, '4', 'a linha mostra a abertura mais recente');
});

test('nada é jogado fora — o grupo guarda os eventos originais', () => {
  const itens = agruparLinhaDoTempo([
    ev('2', 'viewed', '2026-09-01T15:51:00Z'),
    ev('3', 'viewed', '2026-09-01T16:08:00Z'),
  ]);
  assert.deepEqual(itens[0].eventos.map((e) => e.id), ['2', '3']);
});

test('um lembrete no meio corta a dobra — a história não some', () => {
  const itens = agruparLinhaDoTempo([
    ev('1', 'viewed', '2026-09-01T15:51:00Z'),
    ev('2', 'reminder_sent', '2026-09-01T19:52:00Z'),
    ev('3', 'viewed', '2026-09-02T09:00:00Z'),
  ]);
  assert.deepEqual(itens.map((i) => i.acao), ['viewed', 'reminder_sent', 'viewed']);
});

test('aberturas de signatários diferentes não se misturam', () => {
  const itens = agruparLinhaDoTempo([
    ev('1', 'viewed', '2026-09-01T15:51:00Z', 's1'),
    ev('2', 'viewed', '2026-09-01T16:00:00Z', 's2'),
  ]);
  assert.equal(itens.length, 2);
});

test('assinatura e recusa nunca são dobradas', () => {
  const itens = agruparLinhaDoTempo([
    ev('1', 'signed', '2026-09-01T15:51:00Z'),
    ev('2', 'signed', '2026-09-01T16:00:00Z'),
  ]);
  assert.equal(itens.length, 2, 'duas assinaturas são dois fatos, não uma repetição');
});

test('lista vazia não inventa linha', () => {
  assert.deepEqual(agruparLinhaDoTempo([]), []);
});
