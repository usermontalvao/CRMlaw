import test from 'node:test';
import assert from 'node:assert/strict';
import { pickInitialChannel, isPreferredChannel, togglePreferred } from './preferredChannel.ts';

const conectados = ['canal-pedro', 'canal-comercial'];

test('o canal preferido abre selecionado', () => {
  assert.equal(pickInitialChannel('canal-comercial', conectados), 'canal-comercial');
});

test('sem preferência, segue valendo o primeiro canal', () => {
  assert.equal(pickInitialChannel(null, conectados), 'canal-pedro');
});

test('preferido removido (ou desconectado hoje) cai para o primeiro, não para vazio', () => {
  assert.equal(pickInitialChannel('canal-apagado', conectados), 'canal-pedro');
});

test('sem canal nenhum não há o que pré-selecionar', () => {
  assert.equal(pickInitialChannel('canal-pedro', []), '');
});

test('o botão só aparece marcado no canal que é de fato o padrão', () => {
  assert.equal(isPreferredChannel('canal-pedro', 'canal-pedro'), true);
  assert.equal(isPreferredChannel('canal-pedro', 'canal-comercial'), false);
  assert.equal(isPreferredChannel(null, 'canal-pedro'), false);
});

test('clicar marca o canal atual como padrão', () => {
  assert.equal(togglePreferred(null, 'canal-pedro'), 'canal-pedro');
  assert.equal(togglePreferred('canal-comercial', 'canal-pedro'), 'canal-pedro');
});

test('clicar de novo no que já é padrão desmarca', () => {
  assert.equal(togglePreferred('canal-pedro', 'canal-pedro'), null);
});

test('sem canal selecionado o clique não apaga a preferência que existe', () => {
  assert.equal(togglePreferred('canal-pedro', ''), 'canal-pedro');
});
