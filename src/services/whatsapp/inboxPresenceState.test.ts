import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readViewers, viewersByConversation, viewersLabel,
  type RawPresenceState, type Viewer,
} from './inboxPresenceState.ts';

const meta = (patch: Record<string, unknown> = {}) => ({
  userId: 'u1', userName: 'Ana', conversationId: 'c1', since: 1000, ...patch,
});

test('normaliza o estado cru do Presence', () => {
  const state: RawPresenceState = {
    s1: [meta()],
    s2: [meta({ userId: 'u2', userName: 'Bruno', conversationId: 'c2', since: 2000 })],
  };
  const viewers = readViewers(state);
  assert.equal(viewers.length, 2);
  assert.deepEqual(
    viewers.map(v => [v.userId, v.conversationId]).sort(),
    [['u1', 'c1'], ['u2', 'c2']],
  );
});

test('entrada malformada é descartada sem derrubar o resto', () => {
  const state = {
    s1: [meta()],
    s2: [{ userName: 'Sem id' }],            // sem userId
    s3: [null as unknown as Record<string, unknown>],
    s4: 'não é lista' as unknown as Array<Record<string, unknown>>,
  } as RawPresenceState;
  const viewers = readViewers(state);
  assert.equal(viewers.length, 1);
  assert.equal(viewers[0].userId, 'u1');
});

test('sem conversa aberta o atendente fica sem conversationId', () => {
  const viewers = readViewers({ s1: [meta({ conversationId: '' })] });
  assert.equal(viewers[0].conversationId, null);
});

test('nome ausente cai num rótulo neutro em vez de vazio', () => {
  const viewers = readViewers({ s1: [meta({ userName: '   ' })] });
  assert.equal(viewers[0].userName, 'Outro atendente');
});

test('a própria pessoa nunca aparece como "também está aqui"', () => {
  const viewers = readViewers({
    s1: [meta({ userId: 'eu' })],
    s2: [meta({ userId: 'eu' })],           // segunda aba da mesma pessoa
  });
  const mapa = viewersByConversation(viewers, 'eu');
  assert.equal(mapa.has('c1'), false);
});

test('uma pessoa em várias abas conta uma vez, pela mais antiga', () => {
  const viewers = readViewers({
    s1: [meta({ userId: 'u1', since: 5000 })],
    s2: [meta({ userId: 'u1', since: 1000 })],
    s3: [meta({ userId: 'u2', userName: 'Bruno', since: 3000 })],
  });
  const aqui = viewersByConversation(viewers, 'eu').get('c1')!;
  assert.equal(aqui.length, 2);
  // Ordenado por chegada: quem estava antes vem antes.
  assert.deepEqual(aqui.map(v => v.userName), ['Ana', 'Bruno']);
  assert.equal(aqui[0].since, 1000);
});

test('agrupa por conversa sem misturar', () => {
  const viewers = readViewers({
    s1: [meta({ userId: 'u1', conversationId: 'c1' })],
    s2: [meta({ userId: 'u2', userName: 'Bruno', conversationId: 'c2' })],
  });
  const mapa = viewersByConversation(viewers, null);
  assert.deepEqual([...mapa.get('c1')!].map(v => v.userId), ['u1']);
  assert.deepEqual([...mapa.get('c2')!].map(v => v.userId), ['u2']);
});

test('quem está na inbox sem abrir conversa não entra em conversa nenhuma', () => {
  const viewers = readViewers({ s1: [meta({ conversationId: null })] });
  assert.equal(viewersByConversation(viewers, null).size, 0);
});

const v = (userName: string): Viewer =>
  ({ key: userName, userId: userName, userName, conversationId: 'c1', since: 0 });

test('a frase do indicador cresce sem virar lista', () => {
  assert.equal(viewersLabel([]), '');
  assert.equal(viewersLabel([v('Ana')]), 'Ana também está aqui');
  assert.equal(viewersLabel([v('Ana'), v('Bruno')]), 'Ana e Bruno também estão aqui');
  assert.equal(viewersLabel([v('Ana'), v('Bruno'), v('Caio')]), 'Ana e mais 2 estão aqui');
});
