import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyScope } from './notifyScope.ts';

function reset() {
  for (const id of ['modulo', 'widget', 'janela']) notifyScope.clear(id);
}

test('sem nenhuma tela de WhatsApp aberta, tudo avisa no nível do CRM', () => {
  reset();
  assert.equal(notifyScope.tierFor('c1', { inModule: false, documentVisible: true }), 'global');
});

test('no módulo, a conversa aberta toca diferente das outras', () => {
  reset();
  notifyScope.publish('modulo', { kind: 'full', threadIds: ['c1', 'c1-outro-canal'] });
  const opts = { inModule: true, documentVisible: true };
  assert.equal(notifyScope.tierFor('c1', opts), 'in-chat');
  assert.equal(notifyScope.tierFor('c1-outro-canal', opts), 'in-chat');
  assert.equal(notifyScope.tierFor('c2', opts), 'inbox');
});

test('módulo montado mas escondido (keep-alive) não conta como tela aberta', () => {
  reset();
  notifyScope.publish('modulo', { kind: 'full', threadIds: ['c1'] });
  assert.equal(notifyScope.tierFor('c1', { inModule: false, documentVisible: true }), 'global');
});

test('aba escondida sempre cai no aviso mais forte, mesmo com a conversa aberta', () => {
  reset();
  notifyScope.publish('modulo', { kind: 'full', threadIds: ['c1'] });
  assert.equal(notifyScope.tierFor('c1', { inModule: true, documentVisible: false }), 'global');
});

test('widget flutuante conta por estar montado, em qualquer módulo', () => {
  reset();
  notifyScope.publish('widget', { kind: 'embedded', threadIds: ['c9'] });
  const opts = { inModule: false, documentVisible: true };
  assert.equal(notifyScope.tierFor('c9', opts), 'in-chat');
  assert.equal(notifyScope.tierFor('c2', opts), 'inbox');
});

test('widget sem conversa selecionada ainda segura o aviso na inbox', () => {
  reset();
  notifyScope.publish('widget', { kind: 'embedded', threadIds: [] });
  assert.equal(notifyScope.tierFor('c2', { inModule: false, documentVisible: true }), 'inbox');
});

test('fechar uma tela não apaga o registro da outra', () => {
  reset();
  notifyScope.publish('widget', { kind: 'embedded', threadIds: ['c9'] });
  notifyScope.publish('janela', { kind: 'embedded', threadIds: ['c7'] });
  notifyScope.clear('widget');
  const opts = { inModule: false, documentVisible: true };
  assert.equal(notifyScope.tierFor('c7', opts), 'in-chat');
  assert.equal(notifyScope.tierFor('c9', opts), 'inbox');
});
