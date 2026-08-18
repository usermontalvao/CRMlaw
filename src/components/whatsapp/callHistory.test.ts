import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_HISTORY_UNKNOWN,
  callHistoryIdentity,
  formatCallPhone,
  newestCallAt,
  unseenMissedCount,
  type CallHistoryInput,
} from './callHistory.ts';

const chamada = (patch: Partial<CallHistoryInput> & { id: string }): CallHistoryInput => ({
  direction: 'inbound',
  outcome: 'missed',
  phone: '556596128787',
  startedAt: '2026-08-18T12:00:00Z',
  ...patch,
});

test('número brasileiro se lê como número brasileiro', () => {
  assert.equal(formatCallPhone('556596128787'), '(65) 9612-8787');
  assert.equal(formatCallPhone('5565996128787'), '(65) 99612-8787');
  assert.equal(formatCallPhone(''), '');
  assert.equal(formatCallPhone(null), '');
});

test('o que não é reconhecido volta cru, sem DDD inventado', () => {
  // Um número estrangeiro vestido de brasileiro é pior do que os dígitos.
  assert.equal(formatCallPhone('351912345678'), '351912345678', 'Portugal não tem DDD de Cuiabá');
  assert.equal(formatCallPhone('12025550123'), '12025550123');
});

test('o nome do contato ganha do número', () => {
  const i = callHistoryIdentity(chamada({ id: 'a', contactName: 'Lisliandra Inocêncio' }));
  assert.equal(i.title, 'Lisliandra Inocêncio');
  assert.equal(i.unknown, false);
  assert.equal(i.callable, true);
});

test('sem nome, o número — formatado', () => {
  const i = callHistoryIdentity(chamada({ id: 'a' }));
  assert.equal(i.title, '(65) 9612-8787');
  assert.equal(i.callable, true);
});

test('LID NUNCA vira telefone na tela nem no botão de discar', () => {
  // O defeito de origem: o apelido interno virava "+252677908865131" e o
  // escritório discava para a Somália.
  const i = callHistoryIdentity(chamada({ id: 'a', phone: '', peerLid: '252677908865131' }));
  assert.equal(i.title, CALL_HISTORY_UNKNOWN);
  assert.equal(i.unknown, true);
  assert.equal(i.callable, false, 'sem telefone não existe "ligar de novo"');
});

test('o distintivo conta só o que ainda não foi visto', () => {
  const lista = [
    chamada({ id: 'nova', startedAt: '2026-08-18T15:00:00Z' }),
    chamada({ id: 'velha', startedAt: '2026-08-18T09:00:00Z' }),
  ];
  assert.equal(unseenMissedCount(lista, null), 2, 'sem marca, tudo é novidade');
  assert.equal(unseenMissedCount(lista, '2026-08-18T12:00:00Z'), 1);
  assert.equal(unseenMissedCount(lista, '2026-08-18T15:00:00Z'), 0, 'abriu a aba: zerou');
});

test('ATENDIDA nunca acende o distintivo — alguém falou com a pessoa', () => {
  // Era o incômodo relatado: a ligação tinha sido recebida e atendida, e o
  // vermelho continuava aceso no menu.
  assert.equal(unseenMissedCount([chamada({ id: 'a', outcome: 'answered' })], null), 0);
});

test('recusada não é novidade: quem recusou viu a chamada', () => {
  assert.equal(unseenMissedCount([chamada({ id: 'a', outcome: 'declined' })], null), 0);
  // Falhada, sim: ninguém escolheu aquilo e ninguém falou com a pessoa.
  assert.equal(unseenMissedCount([chamada({ id: 'b', outcome: 'failed' })], null), 1);
});

test('a nossa ligação não atendida não acende nada', () => {
  assert.equal(unseenMissedCount([
    chamada({ id: 'nossa', direction: 'outbound', outcome: 'missed' }),
  ], null), 0);
});

test('LIGAR DE VOLTA NÃO APAGA A PERDIDA do histórico', () => {
  // O erro que esta versão corrigiu: a tela inferia "retornada" de uma ligação
  // nossa posterior e marcava/desmarcava pendência sozinha. Não existe mais
  // esse conceito — a perdida é um fato, e só ter sido VISTA muda o distintivo.
  const lista = [
    chamada({ id: 'perdida', startedAt: '2026-08-18T09:00:00Z' }),
    chamada({ id: 'retorno', direction: 'outbound', outcome: 'answered', startedAt: '2026-08-18T09:30:00Z' }),
  ];
  assert.equal(unseenMissedCount(lista, null), 1, 'a perdida continua sendo novidade até ser vista');
  assert.equal(unseenMissedCount(lista, '2026-08-18T09:30:00Z'), 0);
});

test('a marca é a chamada mais recente, não o relógio', () => {
  // Com `Date.now()`, uma chamada gravada no servidor enquanto a consulta
  // voltava nasceria com horário anterior à marca e nunca seria contada.
  assert.equal(newestCallAt([
    chamada({ id: 'a', startedAt: '2026-08-18T09:00:00Z' }),
    chamada({ id: 'b', startedAt: '2026-08-18T15:00:00Z' }),
    chamada({ id: 'c', startedAt: '2026-08-18T11:00:00Z' }),
  ]), '2026-08-18T15:00:00Z');
  assert.equal(newestCallAt([]), null);
  assert.equal(newestCallAt([chamada({ id: 'x', startedAt: 'data inválida' })]), null);
});
