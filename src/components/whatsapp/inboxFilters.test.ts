import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeChannelFilter, sanitizeDeptFilter, sanitizeLabelFilter, canSanitize,
} from './inboxFilters.ts';

const canais = ['canal-pedro', 'canal-comercial'];
const setores = ['setor-previdenciario', 'setor-financeiro'];
const etiquetas = ['Novo', 'Documentação pendente'];

// ── Canal ─────────────────────────────────────────────────────────────
test('canal salvo é restaurado quando ainda existe', () => {
  assert.equal(sanitizeChannelFilter('canal-pedro', canais), 'canal-pedro');
});

test('canal removido cai para "todos" em vez de esvaziar a lista', () => {
  assert.equal(sanitizeChannelFilter('canal-apagado', canais), 'all');
});

test('sem nada salvo o canal é "todos"', () => {
  assert.equal(sanitizeChannelFilter(null, canais), 'all');
});

// ── Setor ─────────────────────────────────────────────────────────────
test('setor salvo é restaurado quando ainda existe', () => {
  assert.equal(sanitizeDeptFilter('setor-financeiro', setores), 'setor-financeiro');
});

test('"sem setor" é uma escolha válida, não um id órfão', () => {
  assert.equal(sanitizeDeptFilter('none', setores), 'none');
});

test('setor removido cai para "todos"', () => {
  assert.equal(sanitizeDeptFilter('setor-apagado', setores), 'all');
});

// ── Etiqueta ──────────────────────────────────────────────────────────
test('etiqueta salva é restaurada quando ainda existe no funil', () => {
  assert.equal(sanitizeLabelFilter('Novo', etiquetas), 'Novo');
});

test('etiqueta que saiu do funil deixa de filtrar', () => {
  assert.equal(sanitizeLabelFilter('Etiqueta antiga', etiquetas), '');
});

test('sem etiqueta salva não há filtro de etiqueta', () => {
  assert.equal(sanitizeLabelFilter(null, etiquetas), '');
});

// ── Momento da conferência ────────────────────────────────────────────
test('não confere enquanto as listas ainda não chegaram', () => {
  assert.equal(canSanitize([]), false);
  assert.equal(canSanitize(canais), true);
});
