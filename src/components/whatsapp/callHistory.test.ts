import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_HISTORY_UNKNOWN,
  callHistoryIdentity,
  formatCallPhone,
  unreturnedMissedIds,
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

test('perdida sem retorno fica em aberto; com retorno depois, não', () => {
  const abertas = unreturnedMissedIds([
    chamada({ id: 'perdida', startedAt: '2026-08-18T09:00:00Z' }),
    chamada({ id: 'retorno', direction: 'outbound', outcome: 'missed', startedAt: '2026-08-18T09:30:00Z' }),
    chamada({ id: 'outra', phone: '5565999990000', startedAt: '2026-08-18T10:00:00Z' }),
  ]);
  assert.equal(abertas.has('perdida'), false, 'ligamos de volta — está resolvida');
  assert.equal(abertas.has('outra'), true, 'ninguém retornou este número');
});

test('retorno ANTES da perdida não conta — a dívida é a de agora', () => {
  const abertas = unreturnedMissedIds([
    chamada({ id: 'retorno-velho', direction: 'outbound', startedAt: '2026-08-18T08:00:00Z' }),
    chamada({ id: 'perdida', startedAt: '2026-08-18T09:00:00Z' }),
  ]);
  assert.equal(abertas.has('perdida'), true);
});

test('tentar já é retornar, mesmo que o contato não atenda', () => {
  const abertas = unreturnedMissedIds([
    chamada({ id: 'perdida', startedAt: '2026-08-18T09:00:00Z' }),
    chamada({ id: 'tentativa', direction: 'outbound', outcome: 'missed', startedAt: '2026-08-18T09:10:00Z' }),
  ]);
  assert.equal(abertas.has('perdida'), false, 'o escritório fez a parte dele');
});

test('chamada ATENDIDA não é pendência de ninguém', () => {
  const abertas = unreturnedMissedIds([chamada({ id: 'falada', outcome: 'answered' })]);
  assert.equal(abertas.size, 0);
});

test('a nossa ligação sem resposta não vira dívida', () => {
  // Se virasse, todo número que não atendeu ficaria preso no distintivo.
  const abertas = unreturnedMissedIds([
    chamada({ id: 'nossa', direction: 'outbound', outcome: 'missed' }),
  ]);
  assert.equal(abertas.size, 0);
});

test('perdida SEM telefone continua em aberto — é a que mais precisa de olho', () => {
  const abertas = unreturnedMissedIds([
    chamada({ id: 'anonima', phone: '', peerLid: '252677908865131' }),
    // Uma saída para outro número não resolve o que não dá nem para discar.
    chamada({ id: 'saida', direction: 'outbound', startedAt: '2026-08-18T13:00:00Z' }),
  ]);
  assert.equal(abertas.has('anonima'), true);
});

test('recusada e falhada também são perdidas quando vieram de fora', () => {
  const abertas = unreturnedMissedIds([
    chamada({ id: 'recusada', outcome: 'declined', phone: '5565999991111' }),
    chamada({ id: 'falhou', outcome: 'failed', phone: '5565999992222' }),
  ]);
  assert.equal(abertas.size, 2);
});
