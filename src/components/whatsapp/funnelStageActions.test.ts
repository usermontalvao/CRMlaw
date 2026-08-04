import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFunnelStageActions, validateFunnelStageActions } from './funnelStageActionConfig.ts';

test('normaliza a ordem mensagem, transferência e encerramento', () => {
  const actions = normalizeFunnelStageActions([
    { type: 'close_conversation', payload: { reason: '  resolvido  ' } },
    { type: 'send_message', message: '  Olá  ' },
  ]);
  assert.deepEqual(actions, [
    { type: 'send_message', target: null, message: 'Olá' },
    { type: 'close_conversation', target: null, message: null, payload: { reason: 'resolvido' } },
  ]);
});

test('mantém somente um destino de transferência', () => {
  const actions = normalizeFunnelStageActions([
    { type: 'transfer_to_department', target: 'setor-1' },
    { type: 'transfer_to_user', target: 'usuario-1' },
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'transfer_to_department');
});

test('valida mensagem e destino obrigatórios', () => {
  assert.deepEqual(
    validateFunnelStageActions([
      { type: 'send_message', message: ' ' },
      { type: 'transfer_to_user', target: null },
    ]),
    ['Escreva a mensagem automática da etapa.', 'Escolha o destino da transferência automática.'],
  );
});

test('impede transferir e encerrar na mesma etapa', () => {
  assert.deepEqual(
    validateFunnelStageActions([
      { type: 'transfer_to_department', target: 'setor-1' },
      { type: 'close_conversation' },
    ]),
    ['A mesma etapa não pode transferir e encerrar o atendimento.'],
  );
});
