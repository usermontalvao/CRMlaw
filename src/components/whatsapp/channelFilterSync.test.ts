import test from 'node:test';
import assert from 'node:assert/strict';
import { nextLeadChannelFilter } from './channelFilterSync.ts';

const channels = ['comercial', 'pedro'];

test('canal específico da inbox também seleciona o mesmo funil em Leads', () => {
  assert.equal(nextLeadChannelFilter('comercial', 'pedro', channels), 'pedro');
});

test('Todos na inbox preserva o último canal concreto do quadro', () => {
  assert.equal(nextLeadChannelFilter('pedro', 'all', channels), 'pedro');
});

test('canal indisponível cai para o primeiro funil visível', () => {
  assert.equal(nextLeadChannelFilter('removido', 'removido', channels), 'comercial');
});

test('sem canais com funil ativo limpa a seleção', () => {
  assert.equal(nextLeadChannelFilter('comercial', 'all', []), '');
});
