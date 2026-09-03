import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deveMarcarComoConversaInterna,
  envioHumanoRevelaConversa,
  mensagemNovaRevelaConversa,
} from './wa-internal-conversation.ts';

const nova = (overrides: Partial<Parameters<typeof deveMarcarComoConversaInterna>[0]> = {}) => ({
  internalRequested: true,
  existedBeforeSend: false,
  clientId: null,
  assignedUserId: null,
  lastCustomerMessageAt: null,
  ...overrides,
});

test('aviso automático pode esconder somente uma thread realmente nova e vazia', () => {
  assert.equal(deveMarcarComoConversaInterna(nova()), true);
});

test('aviso não esconde conversa humana preexistente, mesmo sem cliente vinculado', () => {
  assert.equal(deveMarcarComoConversaInterna(nova({ existedBeforeSend: true })), false);
  assert.equal(deveMarcarComoConversaInterna(nova({ assignedUserId: 'atendente-1' })), false);
  assert.equal(deveMarcarComoConversaInterna(nova({ lastCustomerMessageAt: '2026-09-02T20:34:20Z' })), false);
});

test('aviso não esconde atendimento de cliente nem envio comum', () => {
  assert.equal(deveMarcarComoConversaInterna(nova({ clientId: 'cliente-1' })), false);
  assert.equal(deveMarcarComoConversaInterna(nova({ internalRequested: false })), false);
});

test('mensagem nova do webhook revela conversa interna, mas eco já salvo não', () => {
  assert.equal(mensagemNovaRevelaConversa(true, false, false), true);
  assert.equal(mensagemNovaRevelaConversa(true, false, true), false);
  assert.equal(mensagemNovaRevelaConversa(false, false, false), false);
  // O eco de um aviso interno pode chegar antes de o evolution-send terminar
  // de persistir a mensagem; nunca deve tornar a thread visível por acidente.
  assert.equal(mensagemNovaRevelaConversa(true, true, false), false);
});

test('envio manual revela conversa interna; automação e sistema não', () => {
  assert.equal(envioHumanoRevelaConversa(true, false, true, false), true);
  assert.equal(envioHumanoRevelaConversa(true, true, false, false), false);
  assert.equal(envioHumanoRevelaConversa(true, false, true, true), false);
  assert.equal(envioHumanoRevelaConversa(false, false, true, false), false);
});
