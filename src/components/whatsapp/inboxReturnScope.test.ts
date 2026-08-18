import test from 'node:test';
import assert from 'node:assert/strict';
import { returnScopeForConversation } from './inboxReturnScope.ts';

test('quem trabalha em "Minhas" volta para "Minhas" quando a conversa é dele', () => {
  const r = returnScopeForConversation({ previous: 'mine', mine: true });
  assert.deepEqual(r, { tab: 'mine' });
});

test('conversa de outro atendente não some: desce para "Todas"', () => {
  const r = returnScopeForConversation({ previous: 'mine', mine: false });
  assert.equal(r.tab, 'all');
});

test('"Não lidas" nunca é destino — abrir a conversa a tiraria de lá', () => {
  const r = returnScopeForConversation({ previous: 'unread', mine: true });
  assert.equal(r.tab, 'all');
});

test('"Todas" continua "Todas"', () => {
  const r = returnScopeForConversation({ previous: 'all', mine: false });
  assert.equal(r.tab, 'all');
});

test('nenhum filtro é trocado na volta — só a aba', () => {
  // O ReturnScope não tem mais como mexer no status: a encerrada que se abriu
  // aparece por ser a aberta, e a fila não herda o arquivo (ver inboxStatusScope).
  const r = returnScopeForConversation({ previous: 'mine', mine: true });
  assert.deepEqual(Object.keys(r), ['tab']);
});
