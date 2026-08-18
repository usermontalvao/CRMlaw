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
    title: 'Chamada de voz recebida', icon: 'incoming', attention: false, duration: '6 min 12 s',
  });
  assert.deepEqual(threadCallLabel({ direction: 'outbound', outcome: 'answered', durationSeconds: 35 }), {
    title: 'Chamada de voz', icon: 'outgoing', attention: false, duration: '35 s',
  });
});

test('PERDIDA recebida é dívida do escritório — vermelha, como no celular', () => {
  const l = threadCallLabel({ direction: 'inbound', outcome: 'missed' });
  assert.equal(l.title, 'Chamada de voz perdida');
  assert.equal(l.icon, 'missed');
  assert.equal(l.attention, true);
  assert.equal(l.duration, null);
});

test('de saída não atendida é "Sem resposta", e NÃO é vermelha', () => {
  const l = threadCallLabel({ direction: 'outbound', outcome: 'missed' });
  assert.equal(l.title, 'Sem resposta');
  assert.equal(l.attention, false, 'o contato não estar lá não é pendência nossa');
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
