import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hiddenByStatusFilter, searchRank,
  type InboxStatusFilter, type StatusScopeInput,
} from './inboxStatusScope.ts';

const conversa = (patch: Partial<StatusScopeInput> = {}): StatusScopeInput => ({
  filter: 'open',
  closed: false,
  reopened: false,
  liveKey: 'waiting_you',
  searching: false,
  ...patch,
});

test('"Abertas" esconde encerrada enquanto ninguém está buscando', () => {
  assert.equal(hiddenByStatusFilter(conversa({ closed: true })), true);
  assert.equal(hiddenByStatusFilter(conversa({ closed: false })), false);
});

test('buscando, "Abertas" deixa a encerrada aparecer', () => {
  assert.equal(hiddenByStatusFilter(conversa({ closed: true, searching: true })), false);
});

test('"Encerradas" continua só encerradas, mesmo buscando', () => {
  const arquivo = { filter: 'closed' as const, searching: true };
  assert.equal(hiddenByStatusFilter(conversa({ ...arquivo, closed: false })), true);
  assert.equal(hiddenByStatusFilter(conversa({ ...arquivo, closed: true })), false);
});

test('estados de trabalho não são ampliados pela busca', () => {
  // Escolher "Aguardando você" é dizer o que se quer fazer agora; a busca não
  // pode desfazer esse pedido trazendo conversas de outro estado.
  for (const filter of ['waiting_you', 'waiting_internal'] as InboxStatusFilter[]) {
    assert.equal(
      hiddenByStatusFilter(conversa({ filter, liveKey: 'outro', searching: true })),
      true,
      `${filter} deveria continuar restrito durante a busca`,
    );
    assert.equal(
      hiddenByStatusFilter(conversa({ filter, liveKey: filter, searching: true })),
      false,
    );
  }
});

test('"Reaberta" exige reabertura e conversa ainda aberta', () => {
  const f = { filter: 'reopened' as const };
  assert.equal(hiddenByStatusFilter(conversa({ ...f, reopened: false })), true);
  assert.equal(hiddenByStatusFilter(conversa({ ...f, reopened: true })), false);
  // Reaberta e fechada de novo não conta como reaberta.
  assert.equal(hiddenByStatusFilter(conversa({ ...f, reopened: true, closed: true })), true);
  // Nem buscando: o filtro continua sendo sobre o estado de trabalho.
  assert.equal(
    hiddenByStatusFilter(conversa({ ...f, reopened: true, closed: true, searching: true })),
    true,
  );
});

test('"Todas" não esconde nada', () => {
  assert.equal(hiddenByStatusFilter(conversa({ filter: 'all', closed: true })), false);
  assert.equal(hiddenByStatusFilter(conversa({ filter: 'all', closed: false })), false);
});

test('a encerrada trazida pela busca desce para o fim da lista', () => {
  assert.equal(searchRank({ closed: true, searching: true }), 1);
  assert.equal(searchRank({ closed: false, searching: true }), 0);
});

test('fora da busca ninguém desce — a ordem por data é a que vale', () => {
  assert.equal(searchRank({ closed: true, searching: false }), 0);
  assert.equal(searchRank({ closed: false, searching: false }), 0);
});
