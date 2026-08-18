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
  selected: false,
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
  for (const filter of ['waiting_you', 'waiting_client', 'waiting_internal'] as InboxStatusFilter[]) {
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

test('os dois lados da espera são excludentes — nenhuma conversa cai nos dois', () => {
  // O menu da ampulheta depende disso: os dois números vêm da MESMA lista, e
  // um contato contado duas vezes faria a soma passar do total da aba.
  const cliente = conversa({ liveKey: 'waiting_client' });
  assert.equal(hiddenByStatusFilter({ ...cliente, filter: 'waiting_client' }), false);
  assert.equal(hiddenByStatusFilter({ ...cliente, filter: 'waiting_you' }), true);

  const voce = conversa({ liveKey: 'waiting_you' });
  assert.equal(hiddenByStatusFilter({ ...voce, filter: 'waiting_you' }), false);
  assert.equal(hiddenByStatusFilter({ ...voce, filter: 'waiting_client' }), true);
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

test('a conversa ABERTA na thread nunca some da lista, em nenhum filtro', () => {
  // O caso do dia a dia: abrir uma encerrada pela aba de Ligações estando em
  // "Abertas". A linha dela fica; o resto do arquivo continua fora.
  assert.equal(hiddenByStatusFilter(conversa({ closed: true, selected: true })), false);
  assert.equal(hiddenByStatusFilter(conversa({ closed: true, selected: false })), true);
});

test('a exceção é só da linha aberta — vale até sob "Encerradas"', () => {
  const f: Partial<StatusScopeInput> = { filter: 'closed', closed: false };
  assert.equal(hiddenByStatusFilter(conversa({ ...f, selected: true })), false);
  assert.equal(hiddenByStatusFilter(conversa({ ...f, selected: false })), true);
});
