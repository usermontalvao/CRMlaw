import assert from 'node:assert/strict';
import test from 'node:test';
import { isWaAiResetCommand, WA_AI_RESET_COMMANDS } from './waAiResetCommand.ts';

test('reconhece os mesmos comandos de reinício usados pela Edge', () => {
  assert.deepEqual([...WA_AI_RESET_COMMANDS], ['/clear', '/limpar', '/zerar', '/reiniciar', '/reset']);
  assert.equal(isWaAiResetCommand(' /CLEAR '), true);
  assert.equal(isWaAiResetCommand('/limpar'), true);
  assert.equal(isWaAiResetCommand('/zerar'), true);
  assert.equal(isWaAiResetCommand('/cleae'), false);
  assert.equal(isWaAiResetCommand('quero limpar'), false);
});
