import test from 'node:test';
import assert from 'node:assert/strict';
import { neighbourId, resolveInboxKey, isTypingTarget, type InboxKeyContext } from './inboxKeyboard.ts';

const FILA = ['a', 'b', 'c'];

const ctx = (patch: Partial<InboxKeyContext> = {}): InboxKeyContext => ({
  visibleIds: FILA,
  selectedId: 'b',
  typing: false,
  inSearch: false,
  hasSearch: false,
  dialogOpen: false,
  ...patch,
});

// ── Vizinho na lista ─────────────────────────────────────────────────
test('desce e sobe uma posição', () => {
  assert.equal(neighbourId(FILA, 'b', 1), 'c');
  assert.equal(neighbourId(FILA, 'b', -1), 'a');
});

test('não circula nas pontas', () => {
  assert.equal(neighbourId(FILA, 'c', 1), null);
  assert.equal(neighbourId(FILA, 'a', -1), null);
});

test('sem conversa aberta, entra pela ponta do sentido', () => {
  assert.equal(neighbourId(FILA, null, 1), 'a');
  assert.equal(neighbourId(FILA, null, -1), 'c');
});

test('conversa que saiu do filtro é tratada como nenhuma', () => {
  assert.equal(neighbourId(FILA, 'sumiu', 1), 'a');
});

test('lista vazia não escolhe nada', () => {
  assert.equal(neighbourId([], 'b', 1), null);
  assert.equal(neighbourId([], null, -1), null);
});

// ── Setas ────────────────────────────────────────────────────────────
test('setas andam pela fila quando não se está digitando', () => {
  assert.deepEqual(resolveInboxKey({ key: 'ArrowDown' }, ctx()), { kind: 'select', conversationId: 'c' });
  assert.deepEqual(resolveInboxKey({ key: 'ArrowUp' }, ctx()), { kind: 'select', conversationId: 'a' });
});

test('digitando, a seta pura é do campo de texto', () => {
  assert.equal(resolveInboxKey({ key: 'ArrowDown' }, ctx({ typing: true })), null);
  assert.equal(resolveInboxKey({ key: 'ArrowUp' }, ctx({ typing: true })), null);
});

test('digitando, Alt+seta troca de conversa sem sair do compositor', () => {
  assert.deepEqual(
    resolveInboxKey({ key: 'ArrowDown', altKey: true }, ctx({ typing: true })),
    { kind: 'select', conversationId: 'c' },
  );
});

test('na ponta da fila a tecla não vira ação', () => {
  assert.equal(resolveInboxKey({ key: 'ArrowDown' }, ctx({ selectedId: 'c' })), null);
});

// ── Busca ────────────────────────────────────────────────────────────
test('Ctrl/Cmd+K vai para a busca, mesmo digitando', () => {
  assert.deepEqual(resolveInboxKey({ key: 'k', ctrlKey: true }, ctx({ typing: true })), { kind: 'focusSearch' });
  assert.deepEqual(resolveInboxKey({ key: 'K', metaKey: true }, ctx()), { kind: 'focusSearch' });
});

test('Esc na busca limpa; com a busca já vazia, devolve o foco', () => {
  assert.deepEqual(resolveInboxKey({ key: 'Escape' }, ctx({ inSearch: true, hasSearch: true })), { kind: 'clearSearch' });
  assert.deepEqual(resolveInboxKey({ key: 'Escape' }, ctx({ inSearch: true, hasSearch: false })), { kind: 'blurSearch' });
});

// ── Esc: a pilha do que está aberto ──────────────────────────────────
// A ordem é o contrato: cada Esc desfaz UM item, do mais recente para o mais
// antigo. Os testes abaixo empilham tudo de uma vez justamente para provar a
// precedência — é o que impede um Esc de fechar a conversa quando o que a
// pessoa queria era só parar a gravação.
test('Esc gravando descarta a gravação, antes de qualquer outra coisa', () => {
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ recording: true, overlayOpen: true, composing: true, inSearch: true, hasSearch: true })),
    { kind: 'cancelRecording' },
  );
});

test('Esc fecha o menu aberto antes de cancelar a composição', () => {
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ overlayOpen: true, composing: true })),
    { kind: 'closeOverlay' },
  );
});

test('Esc sai da edição/resposta antes de mexer na busca', () => {
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ composing: true, inSearch: true, hasSearch: true })),
    { kind: 'cancelCompose' },
  );
});

test('Esc com rascunho escrito não faz nada — texto digitado não se perde por tecla', () => {
  assert.equal(resolveInboxKey({ key: 'Escape' }, ctx({ hasDraft: true, typing: true })), null);
});

test('Esc sem nada por cima fecha a conversa aberta', () => {
  assert.deepEqual(resolveInboxKey({ key: 'Escape' }, ctx()), { kind: 'closeConversation' });
  // Sem conversa aberta não sobra nada para desfazer.
  assert.equal(resolveInboxKey({ key: 'Escape' }, ctx({ selectedId: null })), null);
});

test('Esc continua sendo do modal quando há um aberto', () => {
  assert.equal(resolveInboxKey({ key: 'Escape' }, ctx({ dialogOpen: true, recording: true })), null);
});

// ── Não atrapalhar ───────────────────────────────────────────────────
test('com um modal aberto, o teclado é do modal', () => {
  assert.equal(resolveInboxKey({ key: 'ArrowDown' }, ctx({ dialogOpen: true })), null);
  assert.equal(resolveInboxKey({ key: 'k', ctrlKey: true }, ctx({ dialogOpen: true })), null);
});

test('atalhos do navegador passam direto', () => {
  for (const key of ['a', 'c', 'v', 'f', 'r', 'Home', 'End', 'PageDown', 'Tab', 'Enter', ' ']) {
    assert.equal(resolveInboxKey({ key, ctrlKey: true }, ctx()), null, `Ctrl+${key}`);
  }
  assert.equal(resolveInboxKey({ key: 'ArrowLeft' }, ctx()), null);
  assert.equal(resolveInboxKey({ key: 'PageDown' }, ctx()), null);
});

// ── Alvo de digitação ────────────────────────────────────────────────
test('reconhece campos de texto e contenteditable', () => {
  const fake = (tagName: string, editable = false) =>
    ({ tagName, isContentEditable: editable }) as unknown as Element;
  assert.equal(isTypingTarget(fake('INPUT')), true);
  assert.equal(isTypingTarget(fake('TEXTAREA')), true);
  assert.equal(isTypingTarget(fake('SELECT')), true);
  assert.equal(isTypingTarget(fake('DIV', true)), true);
  assert.equal(isTypingTarget(fake('DIV')), false);
  assert.equal(isTypingTarget(fake('BUTTON')), false);
  assert.equal(isTypingTarget(null), false);
});

// ── O último degrau: fechar a janela que hospeda a inbox ─────────────
// Só existe no widget. O contrato que interessa é a ORDEM: um Esc volta ao
// início, o próximo fecha — nunca os dois de uma vez, e nunca por cima de algo
// que a pessoa estava fazendo.

test('no widget, o Esc na lista fecha a janela', () => {
  const acao = resolveInboxKey({ key: 'Escape' }, ctx({ selectedId: null, canExitSurface: true }));
  assert.deepEqual(acao, { kind: 'exitSurface' });
});

test('com a conversa aberta, o primeiro Esc volta à lista e não fecha a janela', () => {
  const acao = resolveInboxKey({ key: 'Escape' }, ctx({ selectedId: 'b', canExitSurface: true }));
  assert.deepEqual(acao, { kind: 'closeConversation' });
});

test('em tela cheia não há janela para fechar: o Esc na lista não faz nada', () => {
  const acao = resolveInboxKey({ key: 'Escape' }, ctx({ selectedId: null }));
  assert.equal(acao, null);
});

test('rascunho escrito segura a escada inteira — nem a janela fecha', () => {
  const acao = resolveInboxKey(
    { key: 'Escape' },
    ctx({ selectedId: 'b', hasDraft: true, canExitSurface: true }),
  );
  assert.equal(acao, null);
});

test('o que está por cima é desfeito antes, mesmo no widget', () => {
  const base = { selectedId: null, canExitSurface: true } as const;
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ ...base, recording: true })),
    { kind: 'cancelRecording' },
  );
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ ...base, overlayOpen: true })),
    { kind: 'closeOverlay' },
  );
  assert.deepEqual(
    resolveInboxKey({ key: 'Escape' }, ctx({ ...base, inSearch: true, hasSearch: true })),
    { kind: 'clearSearch' },
  );
});

test('com um diálogo aberto, nem o último degrau vale', () => {
  const acao = resolveInboxKey(
    { key: 'Escape' },
    ctx({ selectedId: null, canExitSurface: true, dialogOpen: true }),
  );
  assert.equal(acao, null);
});
