import assert from 'node:assert/strict';
import test from 'node:test';
import { triggerWaAiAfterTranscription } from './wa-ai-transcription.ts';

test('áudio só aciona a IA depois que a transcrição termina', async () => {
  let finishTranscription!: () => void;
  const order: string[] = [];
  const transcription = new Promise<void>(resolve => { finishTranscription = resolve; })
    .then(() => { order.push('transcrição'); });

  const turn = triggerWaAiAfterTranscription(transcription, async () => {
    order.push('ia');
  });

  await Promise.resolve();
  assert.deepEqual(order, []);
  finishTranscription();
  await turn;
  assert.deepEqual(order, ['transcrição', 'ia']);
});

test('falha de transcrição não elimina o turno da IA', async () => {
  let triggered = false;
  await triggerWaAiAfterTranscription(Promise.reject(new Error('falhou')), async () => {
    triggered = true;
  });
  assert.equal(triggered, true);
});

test('mensagem sem transcrição aciona a IA imediatamente', async () => {
  let triggered = false;
  await triggerWaAiAfterTranscription(null, async () => {
    triggered = true;
  });
  assert.equal(triggered, true);
});
