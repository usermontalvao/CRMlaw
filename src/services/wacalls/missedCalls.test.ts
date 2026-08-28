import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSED_CALL_WINDOW_MS,
  formatMissedCallTime,
  groupMissedCalls,
  mergeMissedCalls,
  missedCallPeerKey,
  missedCallsHeadline,
  parseStoredDismissed,
  parseStoredMissedCalls,
  pruneDismissed,
  reconcileMissedCalls,
  type MissedCall,
} from './missedCalls.ts';

const AGORA = Date.UTC(2026, 7, 18, 15, 0, 0);

const perdida = (over: Partial<MissedCall> & { callId: string }): MissedCall => ({
  phone: '5565996128787',
  lid: null,
  name: null,
  avatarUrl: null,
  avatarPath: null,
  conversationId: null,
  clientId: null,
  startedAt: AGORA - 60_000,
  ...over,
});

test('a mesma chamada vista duas vezes é uma só — e a segunda completa a primeira', () => {
  const doEvento = perdida({ callId: 'c1', name: null });
  const doHistorico = perdida({ callId: 'c1', name: 'Lisliandra', avatarPath: 'avatars/x.jpg' });
  const lista = mergeMissedCalls([doEvento], [doHistorico], { now: AGORA });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].name, 'Lisliandra');
  assert.equal(lista[0].avatarPath, 'avatars/x.jpg');
});

test('o que o histórico traz vazio não apaga o que o evento já sabia', () => {
  const comNome = perdida({ callId: 'c1', name: 'Lisliandra' });
  const semNome = perdida({ callId: 'c1', name: null, phone: '' });
  const lista = mergeMissedCalls([comNome], [semNome], { now: AGORA });
  assert.equal(lista[0].name, 'Lisliandra');
  assert.equal(lista[0].phone, '5565996128787');
});

test('fora da janela de tempo não é aviso, é histórico', () => {
  const velha = perdida({ callId: 'c1', startedAt: AGORA - MISSED_CALL_WINDOW_MS - 1 });
  const nova = perdida({ callId: 'c2', startedAt: AGORA - 5 * 60_000 });
  const lista = mergeMissedCalls([], [velha, nova], { now: AGORA });
  assert.deepEqual(lista.map(c => c.callId), ['c2']);
});

test('dispensada não volta', () => {
  const lista = mergeMissedCalls([], [perdida({ callId: 'c1' })], { now: AGORA, dismissed: ['c1'] });
  assert.deepEqual(lista, []);
});

test('a marca de "já vi as ligações" apaga o aviso do que é anterior a ela', () => {
  const antes = perdida({ callId: 'c1', startedAt: AGORA - 30 * 60_000 });
  const depois = perdida({ callId: 'c2', startedAt: AGORA - 60_000 });
  const lista = mergeMissedCalls([], [antes, depois], {
    now: AGORA,
    seenUntil: AGORA - 10 * 60_000,
  });
  assert.deepEqual(lista.map(c => c.callId), ['c2']);
});

test('mais recente primeiro, com teto', () => {
  const entrada = [1, 2, 3, 4].map(i => perdida({ callId: `c${i}`, startedAt: AGORA - i * 60_000 }));
  const lista = mergeMissedCalls([], entrada, { now: AGORA, max: 2 });
  assert.deepEqual(lista.map(c => c.callId), ['c1', 'c2']);
});

test('linha sem horário ou do futuro não entra', () => {
  const semHora = perdida({ callId: 'c1', startedAt: NaN });
  const doFuturo = perdida({ callId: 'c2', startedAt: AGORA + 10 * 60_000 });
  assert.deepEqual(mergeMissedCalls([], [semHora, doFuturo], { now: AGORA }), []);
});

test('quem ligou três vezes é UMA linha com três chamadas', () => {
  const calls = [
    perdida({ callId: 'c1', startedAt: AGORA - 60_000 }),
    perdida({ callId: 'c2', startedAt: AGORA - 120_000 }),
    perdida({ callId: 'c3', startedAt: AGORA - 180_000 }),
  ];
  const grupos = groupMissedCalls(calls);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].count, 3);
  assert.equal(grupos[0].call.callId, 'c1', 'a cara do grupo é a mais recente');
  assert.deepEqual(grupos[0].callIds.sort(), ['c1', 'c2', 'c3']);
});

test('o nono dígito à parte, telefones diferentes são pessoas diferentes', () => {
  const grupos = groupMissedCalls([
    perdida({ callId: 'c1', phone: '5565996128787' }),
    perdida({ callId: 'c2', phone: '5565999998888' }),
  ]);
  assert.equal(grupos.length, 2);
});

test('duas anônimas não viram a mesma pessoa', () => {
  const a = perdida({ callId: 'c1', phone: '', lid: null });
  const b = perdida({ callId: 'c2', phone: '', lid: null });
  assert.notEqual(missedCallPeerKey(a), missedCallPeerKey(b));
  assert.equal(groupMissedCalls([a, b]).length, 2);
});

test('duas chamadas do mesmo apelido interno são da mesma pessoa', () => {
  const a = perdida({ callId: 'c1', phone: '', lid: '252677908865131' });
  const b = perdida({ callId: 'c2', phone: '', lid: '252677908865131' });
  assert.equal(groupMissedCalls([a, b]).length, 1);
});

test('título no singular e no plural, sem "(s)"', () => {
  assert.equal(missedCallsHeadline(1), 'Chamada perdida');
  assert.equal(missedCallsHeadline(4), '4 chamadas perdidas');
});

test('a hora é escrita como no celular', () => {
  const hoje = new Date(2026, 7, 18, 15, 0, 0).getTime();
  assert.equal(formatMissedCallTime(hoje - 30_000, hoje), 'agora mesmo');
  assert.equal(formatMissedCallTime(hoje - 5 * 60_000, hoje), 'há 5 min');
  assert.equal(formatMissedCallTime(new Date(2026, 7, 18, 9, 5).getTime(), hoje), '09:05');
  assert.equal(formatMissedCallTime(new Date(2026, 7, 17, 18, 40).getTime(), hoje), 'ontem 18:40');
  assert.equal(formatMissedCallTime(new Date(2026, 7, 14, 8, 3).getTime(), hoje), '14/08 08:03');
});

test('a lista guardada no navegador é lida com desconfiança', () => {
  assert.deepEqual(parseStoredMissedCalls(null), []);
  assert.deepEqual(parseStoredMissedCalls('nada disso'), []);
  assert.deepEqual(parseStoredMissedCalls('{"callId":"c1"}'), []);
  assert.deepEqual(parseStoredMissedCalls('[{"callId":"c1"}]'), [], 'sem horário não entra');
  const lida = parseStoredMissedCalls(JSON.stringify([
    { callId: 'c1', startedAt: AGORA, phone: '5565996128787', name: 'Ana', lid: 5 },
  ]));
  assert.equal(lida.length, 1);
  assert.equal(lida[0].name, 'Ana');
  assert.equal(lida[0].lid, null, 'campo com tipo errado vira nulo, não quebra a tela');
});

test('as dispensadas envelhecem e a lista não cresce para sempre', () => {
  assert.deepEqual(parseStoredDismissed('[{"callId":"c1"}]'), []);
  const guardadas = [
    { callId: 'antiga', at: AGORA - MISSED_CALL_WINDOW_MS * 3 },
    { callId: 'recente', at: AGORA - 60_000 },
  ];
  assert.deepEqual(pruneDismissed(guardadas, AGORA).map(d => d.callId), ['recente']);
  const muitas = Array.from({ length: 300 }, (_, i) => ({ callId: `c${i}`, at: AGORA }));
  assert.equal(pruneDismissed(muitas, AGORA).length, 200);
});

test('o que o registro deixou de chamar de perdida sai do cartão', () => {
  // O caso de 27/08/2026: três ligações recusadas no botão vermelho foram
  // gravadas como perdidas por engano. Corrigido o registro, o cartão continuava
  // anunciando as três a cada abertura do CRM — ele vive no navegador e só
  // sabia somar.
  const atuais = [
    perdida({ callId: 'recusada', startedAt: AGORA - 3 * 3_600_000 }),
    perdida({ callId: 'perdida-mesmo', startedAt: AGORA - 2 * 3_600_000 }),
  ];
  const vivas = reconcileMissedCalls(atuais, new Set(['perdida-mesmo']), { now: AGORA, completa: true });
  assert.deepEqual(vivas.map(c => c.callId), ['perdida-mesmo']);
});

test('a que acabou de tocar tem tempo de chegar ao registro', () => {
  const atuais = [perdida({ callId: 'agorinha', startedAt: AGORA - 30_000 })];
  const vivas = reconcileMissedCalls(atuais, new Set(), { now: AGORA, completa: true });
  assert.deepEqual(vivas.map(c => c.callId), ['agorinha']);
});

test('releitura truncada não dá baixa em ninguém', () => {
  // Sem a janela inteira, "não veio na consulta" pode ser só o teto do limite —
  // e dar baixa por isso apagaria avisos legítimos.
  const atuais = [perdida({ callId: 'antiga', startedAt: AGORA - 6 * 3_600_000 })];
  const vivas = reconcileMissedCalls(atuais, new Set(['outra']), { now: AGORA, completa: false });
  assert.deepEqual(vivas.map(c => c.callId), ['antiga']);
});
