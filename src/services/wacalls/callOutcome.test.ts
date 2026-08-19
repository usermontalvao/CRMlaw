import test from 'node:test';
import assert from 'node:assert/strict';
import {
  endReasonMessage, endReasonIsFailure, phaseFromStatus, formatCallTimer, callElapsedSeconds, phaseLabel, outcomeFromEndReason,
  endReasonMeansNeverAnswered, resolveCallOutcome, endedCallLabel,
} from './callOutcome.ts';

test('recusa e ausência de resposta são ditas com todas as letras', () => {
  assert.equal(endReasonMessage('declined', { answered: false, direction: 'outbound' }), 'Chamada recusada.');
  assert.equal(endReasonMessage('timeout', { answered: false, direction: 'outbound' }), 'Chamada não atendida.');
});

test('desligar depois de conversar é encerramento normal, não falha', () => {
  assert.equal(endReasonMessage('user_ended', { answered: true, direction: 'outbound' }), 'Chamada encerrada.');
  assert.equal(endReasonIsFailure('user_ended', true), false);
  assert.equal(endReasonIsFailure('timeout', false), true);
});

test('motivo desconhecido em chamada não atendida ainda avisa o operador', () => {
  assert.equal(endReasonMessage(null, { answered: false, direction: 'outbound' }), 'Chamada não atendida.');
  assert.equal(endReasonMessage('unknown', { answered: true, direction: 'inbound' }), 'Chamada encerrada.');
});

test('o PREPARING não é atropelado pelo "ringing" do servidor', () => {
  assert.equal(phaseFromStatus('ringing', 'outbound', 'PREPARING'), 'PREPARING');
  assert.equal(phaseFromStatus('ringing', 'outbound', 'CALLING'), 'RINGING');
});

test('chamada encerrada não ressuscita com evento atrasado', () => {
  assert.equal(phaseFromStatus('connected', 'inbound', 'ENDED'), 'ENDED');
  assert.equal(phaseFromStatus('ringing', 'outbound', 'FAILED'), 'FAILED');
});

test('connected vira ACTIVE em qualquer direção', () => {
  assert.equal(phaseFromStatus('connected', 'outbound', 'RINGING'), 'ACTIVE');
  assert.equal(phaseFromStatus('connected', 'inbound', 'PREPARING'), 'ACTIVE');
});

test('o cronômetro só conta a partir do atendimento', () => {
  assert.equal(callElapsedSeconds(null, 10_000), 0);
  assert.equal(callElapsedSeconds(10_000, 73_000), 63);
  assert.equal(formatCallTimer(0), '00:00');
  assert.equal(formatCallTimer(63), '01:03');
  assert.equal(formatCallTimer(3661), '1:01:01');
});

test('o rótulo separa quem liga de quem recebe', () => {
  assert.equal(phaseLabel('RINGING', 'outbound'), 'Chamando…');
  assert.equal(phaseLabel('RINGING', 'inbound'), 'Chamada recebida');
  assert.equal(phaseLabel('ACTIVE', 'outbound'), 'Em chamada');
});

test('quem atende não vê "Preparando" e sim "Conectando"', () => {
  assert.equal(phaseLabel('PREPARING', 'outbound'), 'Preparando…');
  assert.equal(phaseLabel('PREPARING', 'inbound'), 'Conectando…');
});

test('queda de internet é dita como queda — e conta como falha mesmo já atendida', () => {
  assert.equal(
    endReasonMessage('connection_lost', { answered: true, direction: 'outbound' }),
    'A chamada caiu: esta máquina ficou sem conexão.',
  );
  assert.equal(endReasonIsFailure('connection_lost', true), true);
  assert.equal(endReasonIsFailure('connection_lost', false), true);
});

test('atendida em outro aparelho NÃO é perdida — era o que enchia o cartão de aviso', () => {
  assert.equal(outcomeFromEndReason('accepted_elsewhere'), 'answered');
});

test('recusa e "não perturbe" são recusa; aborto de protocolo é falha', () => {
  assert.equal(outcomeFromEndReason('declined'), 'declined');
  assert.equal(outcomeFromEndReason('do_not_disturb'), 'declined');
  assert.equal(outcomeFromEndReason('enc'), 'failed');
  assert.equal(outcomeFromEndReason('failed'), 'failed');
});

test('o telefone tocou aqui e ninguém pegou continua sendo perdida', () => {
  for (const motivo of ['user_ended', 'timeout', 'cancelled', 'busy', 'unknown', null]) {
    assert.equal(outcomeFromEndReason(motivo), 'missed', `motivo: ${motivo}`);
  }
});

test('ligação que o CRM matou por falta de áudio é falha, nunca perdida', () => {
  // A tentação é chamar de perdida: ninguém conversou. Mas perdida é a que
  // acende o cartão de aviso pedindo retorno, e aqui não há a quem retornar —
  // o telefone do contato tocou, ele atendeu, e quem desligou fomos nós.
  assert.equal(outcomeFromEndReason('connection_lost'), 'failed');
});

test('o motivo do fim desmente o cronômetro quando ninguém atendeu', () => {
  // O caso real: ligação de saída, o relay sobe em 0,3 s, o painel mostra
  // "Em chamada 00:07" — e o contato apenas recusou. A ficha registrava
  // "Atendida, 16 s" de uma conversa que nunca houve.
  assert.equal(endReasonMeansNeverAnswered('rejected'), true);
  assert.equal(resolveCallOutcome('rejected', { connected: true, failed: false }), 'declined');
  assert.equal(resolveCallOutcome('timeout', { connected: true, failed: false }), 'missed');
  assert.equal(resolveCallOutcome('busy', { connected: true, failed: false }), 'missed');
});

test('quem conversou de verdade continua atendida, mesmo com fim torto', () => {
  assert.equal(endReasonMeansNeverAnswered('terminate'), false);
  assert.equal(endReasonMeansNeverAnswered('user_ended'), false);
  assert.equal(endReasonMeansNeverAnswered('connection_lost'), false);
  assert.equal(resolveCallOutcome('terminate', { connected: true, failed: false }), 'answered');
  assert.equal(resolveCallOutcome(null, { connected: true, failed: false }), 'answered');
  assert.equal(resolveCallOutcome('terminate', { connected: false, failed: false }), 'missed');
  assert.equal(resolveCallOutcome('desconhecido', { connected: false, failed: true }), 'failed');
});

test('a recusa do Jurius Call ("rejected") é recusa, e é dita na tela', () => {
  // O servidor inventa este motivo quando o WhatsApp recusa sem dizer por quê.
  // Enquanto ele era desconhecido aqui, a recusa virava "perdida" na ficha e
  // "Chamada encerrada." no aviso — o atendente não tinha como saber que o
  // contato tinha visto a ligação e dito não.
  assert.equal(outcomeFromEndReason('rejected'), 'declined');
  assert.equal(endReasonMessage('rejected', { answered: true, direction: 'outbound' }), 'Chamada recusada.');
  assert.equal(endedCallLabel('rejected', { answered: true, direction: 'outbound' }), 'Chamada recusada pelo contato');
  assert.equal(endedCallLabel('declined', { answered: false, direction: 'inbound' }), 'Chamada recusada');
});

test('defeito de mídia é falha, não desprezo do contato', () => {
  for (const motivo of ['relay_failed', 'relay_timeout', 'accept_failed']) {
    assert.equal(outcomeFromEndReason(motivo), 'failed', `motivo: ${motivo}`);
  }
  assert.equal(
    endReasonMessage('relay_timeout', { answered: false, direction: 'outbound' }),
    'A chamada falhou: o áudio não pôde ser aberto.',
  );
});

test('o que outro aparelho resolveu não aconteceu nesta mesa', () => {
  assert.equal(endReasonMeansNeverAnswered('accepted_elsewhere'), true);
  assert.equal(resolveCallOutcome('accepted_elsewhere', { connected: true, failed: false }), 'answered');
  assert.equal(outcomeFromEndReason('rejected_elsewhere'), 'declined');
  assert.equal(
    endReasonMessage('accepted_elsewhere', { answered: false, direction: 'inbound' }),
    'Chamada atendida em outro aparelho.',
  );
});

test('o cartão do fim diz o desfecho, não um "encerrada" para tudo', () => {
  assert.equal(endedCallLabel('user_ended', { answered: true, direction: 'inbound' }), 'Chamada encerrada');
  assert.equal(endedCallLabel('timeout', { answered: false, direction: 'outbound' }), 'Sem resposta');
  assert.equal(endedCallLabel('timeout', { answered: false, direction: 'inbound' }), 'Chamada perdida');
  assert.equal(endedCallLabel('connection_lost', { answered: true, direction: 'outbound' }), 'A chamada caiu');
  assert.equal(endedCallLabel('relay_timeout', { answered: false, direction: 'outbound' }), 'Chamada não completada');
});

test('o "starting" do servidor não rebobina uma chamada que já toca', () => {
  assert.equal(phaseFromStatus('starting', 'outbound', 'RINGING'), 'RINGING');
  assert.equal(phaseFromStatus('starting', 'outbound', 'PREPARING'), 'PREPARING');
  assert.equal(phaseFromStatus('starting', 'inbound', 'ACTIVE'), 'CALLING');
});
