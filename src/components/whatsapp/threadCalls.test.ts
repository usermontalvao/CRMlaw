import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCallDuration, threadCallLabel } from './threadCalls.ts';

test('duração se lê, não se calcula', () => {
  assert.equal(formatCallDuration(42), '42 s');
  assert.equal(formatCallDuration(60), '1 min');
  assert.equal(formatCallDuration(372), '6 min 12 s');
  assert.equal(formatCallDuration(3600), '1 h');
  assert.equal(formatCallDuration(3780), '1 h 3 min');
  assert.equal(formatCallDuration(0), '');
  assert.equal(formatCallDuration(null), '');
  assert.equal(formatCallDuration(-5), '');
});

test('atendida: recebida e realizada se distinguem, e a duração aparece', () => {
  assert.deepEqual(threadCallLabel({ direction: 'inbound', outcome: 'answered', durationSeconds: 372 }), {
    title: 'Chamada de voz recebida', icon: 'incoming', tone: 'atendida', attention: false, duration: '6 min 12 s',
  });
  assert.deepEqual(threadCallLabel({ direction: 'outbound', outcome: 'answered', durationSeconds: 35 }), {
    title: 'Chamada de voz', icon: 'outgoing', tone: 'atendida', attention: false, duration: '35 s',
  });
});

test('PERDIDA recebida é dívida do escritório — vermelha, como no celular', () => {
  const l = threadCallLabel({ direction: 'inbound', outcome: 'missed' });
  assert.equal(l.title, 'Chamada de voz perdida');
  assert.equal(l.icon, 'missed');
  assert.equal(l.tone, 'perdida');
  assert.equal(l.attention, true);
  assert.equal(l.duration, null);
});

test('de saída não atendida é "Sem resposta", e é VERDE — não vermelha', () => {
  const l = threadCallLabel({ direction: 'outbound', outcome: 'missed' });
  assert.equal(l.title, 'Sem resposta');
  assert.equal(l.attention, false, 'o contato não estar lá não é pendência nossa');
  assert.equal(l.tone, 'sem-resposta');
});

test('as DUAS recusas são ditas com todas as letras', () => {
  assert.equal(threadCallLabel({ direction: 'inbound', outcome: 'declined' }).title, 'Chamada recusada');
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'declined' }).title,
    'Chamada recusada pelo contato',
  );
});

test('falha não se confunde com "não atenderam"', () => {
  const l = threadCallLabel({ direction: 'outbound', outcome: 'failed' });
  assert.equal(l.title, 'A chamada falhou');
  assert.equal(l.tone, 'perdida');
  assert.equal(l.attention, true);
});

test('chamada não atendida NUNCA mostra duração', () => {
  for (const outcome of ['missed', 'declined', 'failed'] as const) {
    for (const direction of ['inbound', 'outbound'] as const) {
      // Mesmo que o banco traga um número (o `GREATEST(0, …)` da RPC pode
      // gravar segundos de toque), não houve conversa — dizer "0 s" ou "8 s"
      // sugeriria que alguém atendeu e desligou na cara.
      assert.equal(threadCallLabel({ direction, outcome, durationSeconds: 8 }).duration, null);
    }
  }
});

test('os três desfechos NÃO saem com a mesma cor', () => {
  // A regressão que este teste existe para pegar: a thread desenhava chamada
  // atendida, tentativa sem resposta e ligação perdida com a mesma aparência, e
  // só o texto distinguia uma da outra.
  const tom = (direction: 'inbound' | 'outbound', outcome: 'answered' | 'missed') =>
    threadCallLabel({ direction, outcome, durationSeconds: 60 }).tone;

  assert.equal(tom('outbound', 'answered'), 'atendida');
  assert.equal(tom('outbound', 'missed'), 'sem-resposta');
  assert.equal(tom('inbound', 'missed'), 'perdida');
  assert.equal(new Set([tom('outbound', 'answered'), tom('outbound', 'missed'), tom('inbound', 'missed')]).size, 3);
});

test('a recusa do contato é a nossa tentativa, não uma dívida', () => {
  // Recusar é "vi e não posso agora" — do nosso lado da conversa continua sendo
  // uma tentativa registrada, verde como as outras.
  assert.equal(threadCallLabel({ direction: 'outbound', outcome: 'declined' }).tone, 'sem-resposta');
  assert.equal(threadCallLabel({ direction: 'inbound', outcome: 'declined' }).tone, 'perdida');
});
