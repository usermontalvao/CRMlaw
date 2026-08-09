import test from 'node:test';
import assert from 'node:assert/strict';
// Import COM extensão: o runner roda ts-node/ESM, que não resolve caminho
// relativo sem ela (é a convenção dos outros testes deste repositório).
import { isFresh, INSTALLED_TTL_MS, HINT_SNOOZE_MS } from './atendimentoApp.ts';

const AGORA = Date.UTC(2026, 7, 8, 12, 0, 0);
const DIA = 24 * 60 * 60 * 1000;

test('sem marca nenhuma, nada está fresco — o convite aparece', () => {
  assert.equal(isFresh(null, INSTALLED_TTL_MS, AGORA), false);
});

test('app aberto ontem conta como instalado', () => {
  assert.equal(isFresh(AGORA - DIA, INSTALLED_TTL_MS, AGORA), true);
});

test('app sem abrir há mais de 90 dias volta a ser tratado como desinstalado', () => {
  // Ninguém avisa quando a pessoa desinstala: é a expiração que devolve o convite.
  assert.equal(isFresh(AGORA - 91 * DIA, INSTALLED_TTL_MS, AGORA), false);
  assert.equal(isFresh(AGORA - 89 * DIA, INSTALLED_TTL_MS, AGORA), true);
});

test('"agora não" cala o convite por 30 dias, não para sempre', () => {
  assert.equal(isFresh(AGORA - 29 * DIA, HINT_SNOOZE_MS, AGORA), true);
  assert.equal(isFresh(AGORA - 31 * DIA, HINT_SNOOZE_MS, AGORA), false);
});
