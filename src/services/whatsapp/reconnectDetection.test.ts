// Cobertura mínima da REGRA CRÍTICA da auto-fila por reconexão: o que faz uma
// mensagem ser retida (e reenviada pelo scheduler) vs. falhar de verdade.
// Execução: `npx ts-node --esm src/services/whatsapp/reconnectDetection.test.ts`
// (não há framework de testes no stack — node:test embutido + ts-node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isReconnectPendingError } from './reconnectDetection';

test('flag estruturada reconnect_pending entra na fila', () => {
  assert.equal(isReconnectPendingError({ reconnectPending: true }), true);
  assert.equal(isReconnectPendingError({ body: { reconnect_pending: true } }), true);
});

test('fallback por texto (compatibilidade com edge não redeployado)', () => {
  assert.equal(isReconnectPendingError(new Error('Canal desconectado e não reconectou sozinho.')), true);
  assert.equal(isReconnectPendingError(new Error('Canal reconectando automaticamente. Aguarde alguns segundos e tente novamente.')), true);
});

test('erros comuns NÃO entram na fila (não são reconexão)', () => {
  assert.equal(isReconnectPendingError(new Error('Contato bloqueado. Desbloqueie para enviar mensagens.')), false);
  assert.equal(isReconnectPendingError(new Error('O número não possui WhatsApp ativo.')), false);
  assert.equal(isReconnectPendingError({ reconnectPending: false }), false);
  assert.equal(isReconnectPendingError(null), false);
  assert.equal(isReconnectPendingError(undefined), false);
});
