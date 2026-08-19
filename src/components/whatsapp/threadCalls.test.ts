import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCallDuration, threadCallLabel, conversationPreview, conversationActivityAt,
} from './threadCalls.ts';

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

test('vídeo se anuncia como vídeo — em TODAS as frases', () => {
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'answered', durationSeconds: 35, isVideo: true }).title,
    'Chamada de vídeo',
  );
  assert.equal(
    threadCallLabel({ direction: 'inbound', outcome: 'answered', durationSeconds: 35, isVideo: true }).title,
    'Chamada de vídeo recebida',
  );
  assert.equal(
    threadCallLabel({ direction: 'inbound', outcome: 'missed', isVideo: true }).title,
    'Chamada de vídeo perdida',
  );
  // O meio é dito nos SEIS desfechos, inclusive nos que ninguém atendeu: a
  // linha da inbox não tem ícone de câmera para completar a frase, e perder
  // uma ligação não pede o mesmo retorno que perder uma chamada de vídeo.
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'missed', isVideo: true }).title,
    'Chamada de vídeo sem resposta',
  );
  assert.equal(
    threadCallLabel({ direction: 'inbound', outcome: 'declined', isVideo: true }).title,
    'Chamada de vídeo recusada',
  );
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'declined', isVideo: true }).title,
    'Chamada de vídeo recusada pelo contato',
  );
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'failed', isVideo: true }).title,
    'A chamada de vídeo falhou',
  );
});

test('sem a marca de vídeo, a frase continua sendo a de voz', () => {
  assert.equal(threadCallLabel({ direction: 'outbound', outcome: 'answered', durationSeconds: 4 }).title, 'Chamada de voz');
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'answered', durationSeconds: 4, isVideo: null }).title,
    'Chamada de voz',
  );
});

test('PERDIDA recebida é dívida do escritório — vermelha, como no celular', () => {
  const l = threadCallLabel({ direction: 'inbound', outcome: 'missed' });
  assert.equal(l.title, 'Chamada de voz perdida');
  assert.equal(l.icon, 'missed');
  assert.equal(l.tone, 'perdida');
  assert.equal(l.attention, true);
  assert.equal(l.duration, null);
});

test('de saída não atendida é "sem resposta", e é VERDE — não vermelha', () => {
  const l = threadCallLabel({ direction: 'outbound', outcome: 'missed' });
  assert.equal(l.title, 'Chamada de voz sem resposta');
  assert.equal(l.attention, false, 'o contato não estar lá não é pendência nossa');
  assert.equal(l.tone, 'sem-resposta');
});

test('as DUAS recusas são ditas com todas as letras', () => {
  assert.equal(threadCallLabel({ direction: 'inbound', outcome: 'declined' }).title, 'Chamada de voz recusada');
  assert.equal(
    threadCallLabel({ direction: 'outbound', outcome: 'declined' }).title,
    'Chamada de voz recusada pelo contato',
  );
});

test('falha não se confunde com "não atenderam"', () => {
  const l = threadCallLabel({ direction: 'outbound', outcome: 'failed' });
  assert.equal(l.title, 'A chamada de voz falhou');
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

// ── A mesma ligação na linha da lista de conversas ─────────────

const base = {
  messagePreview: 'Oi', messageAt: '2026-08-19T03:15:48Z', messageDirection: 'out' as const,
  callAt: null, callDirection: null, callOutcome: null, callDurationSeconds: null,
};

test('sem chamada, a linha é a mensagem — e o "Você:" só vale para a mensagem', () => {
  const saiu = conversationPreview(base);
  assert.equal(saiu.kind, 'message');
  assert.equal(saiu.prefix, 'Você: ');
  assert.equal(saiu.text, 'Oi');
  assert.equal(saiu.at, '2026-08-19T03:15:48Z');

  const entrou = conversationPreview({ ...base, messageDirection: 'in' });
  assert.equal(entrou.prefix, '');
});

test('a chamada mais nova ganha da mensagem — e leva a hora junto', () => {
  const linha = conversationPreview({
    ...base,
    callAt: '2026-08-19T04:56:40Z', callDirection: 'outbound',
    callOutcome: 'answered', callDurationSeconds: 4,
  });
  assert.equal(linha.kind, 'call');
  assert.equal(linha.text, '📞 Chamada de voz · 4 s');
  assert.equal(linha.prefix, '');
  assert.equal(linha.at, '2026-08-19T04:56:40Z');
  assert.equal(linha.attention, false);
});

test('a mensagem mais nova ganha da chamada antiga', () => {
  const linha = conversationPreview({
    ...base,
    messageAt: '2026-08-19T05:00:00Z',
    callAt: '2026-08-19T04:56:40Z', callDirection: 'inbound', callOutcome: 'answered',
  });
  assert.equal(linha.kind, 'message');
  assert.equal(linha.text, 'Oi');
});

test('as palavras são as da thread: recebida, perdida, sem resposta, recusada', () => {
  const diz = (direction: string, outcome: string, seg: number | null = null) =>
    conversationPreview({ ...base, messageAt: null, messagePreview: null,
      callAt: '2026-08-19T04:00:00Z', callDirection: direction, callOutcome: outcome,
      callDurationSeconds: seg }).text;

  assert.equal(diz('inbound', 'answered', 372), '📞 Chamada de voz recebida · 6 min 12 s');
  assert.equal(diz('inbound', 'missed'), '📞 Chamada de voz perdida');
  assert.equal(diz('outbound', 'missed'), '📞 Chamada de voz sem resposta');
  assert.equal(diz('inbound', 'declined'), '📞 Chamada de voz recusada');
  assert.equal(diz('outbound', 'declined'), '📞 Chamada de voz recusada pelo contato');
  assert.equal(diz('outbound', 'failed'), '📞 A chamada de voz falhou');
});

test('a perdida recebida é a única que pede retorno', () => {
  const perdida = conversationPreview({ ...base, messageAt: null,
    callAt: '2026-08-19T04:00:00Z', callDirection: 'inbound', callOutcome: 'missed' });
  assert.equal(perdida.attention, true);
  const semResposta = conversationPreview({ ...base, messageAt: null,
    callAt: '2026-08-19T04:00:00Z', callDirection: 'outbound', callOutcome: 'missed' });
  assert.equal(semResposta.attention, false);
});

test('desfecho desconhecido não vira "atendida" por acidente', () => {
  const linha = conversationPreview({ ...base, messageAt: null,
    callAt: '2026-08-19T04:00:00Z', callDirection: 'inbound', callOutcome: null });
  assert.equal(linha.text, '📞 Chamada de voz perdida');
});

test('chamada sem sentido conhecido é ignorada — a mensagem continua valendo', () => {
  const linha = conversationPreview({ ...base, callAt: '2026-08-19T04:56:40Z', callDirection: null });
  assert.equal(linha.kind, 'message');
});

test('conversa sem nada não inventa linha', () => {
  assert.equal(conversationPreview({
    messagePreview: null, messageAt: null, messageDirection: null,
    callAt: null, callDirection: null, callOutcome: null, callDurationSeconds: null,
  }).kind, 'empty');
});

test('a ordem da fila é a última atividade, venha de onde vier', () => {
  assert.equal(conversationActivityAt({ last_message_at: '2026-08-19T03:00:00Z', last_call_at: '2026-08-19T04:00:00Z' }),
    '2026-08-19T04:00:00Z');
  assert.equal(conversationActivityAt({ last_message_at: '2026-08-19T05:00:00Z', last_call_at: '2026-08-19T04:00:00Z' }),
    '2026-08-19T05:00:00Z');
  assert.equal(conversationActivityAt({ last_message_at: null, last_call_at: null, created_at: '2026-08-01T00:00:00Z' }),
    '2026-08-01T00:00:00Z');
});
