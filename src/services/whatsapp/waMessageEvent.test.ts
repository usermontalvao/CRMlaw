import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizarBroadcast, normalizarPostgres } from './waMessageEvent.ts';

test('broadcast: mensagem nova manda reler a thread', () => {
  const e = normalizarBroadcast({
    op: 'INSERT', id: 'm1', conversation_id: 'c1',
    direction: 'in', type: 'audio', status: 'delivered', content: '', refresh: true,
  });
  assert.equal(e?.op, 'INSERT');
  assert.equal(e?.conversation_id, 'c1');
  assert.equal(e?.direction, 'in');
  assert.equal(e?.refresh, true);
});

test('broadcast: mudança só de status mescla no lugar', () => {
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'read', refresh: false,
  });
  assert.equal(e?.refresh, false);
  assert.equal(e?.status, 'read');
});

test('broadcast: transcrição pronta manda reler — o que o postgres_changes não conseguia', () => {
  // O gatilho no banco marca refresh=true porque transcription_text mudou.
  const e = normalizarBroadcast({
    op: 'UPDATE', id: 'm1', conversation_id: 'c1', status: 'read', refresh: true,
  });
  assert.equal(e?.refresh, true);
});

test('broadcast: refresh ausente conta como "precisa reler"', () => {
  // Errar para o lado de uma requisição a mais é barato; não atualizar a tela
  // devolveria o bug de "sair da conversa e entrar de novo".
  const e = normalizarBroadcast({ op: 'UPDATE', id: 'm1', conversation_id: 'c1' });
  assert.equal(e?.refresh, true);
});

test('broadcast: DELETE carrega só a chave', () => {
  const e = normalizarBroadcast({ op: 'DELETE', id: 'm9', conversation_id: 'c1' });
  assert.equal(e?.op, 'DELETE');
  assert.equal(e?.id, 'm9');
});

test('broadcast: payload sem op ou sem id é descartado', () => {
  assert.equal(normalizarBroadcast({ id: 'm1' }), null);
  assert.equal(normalizarBroadcast({ op: 'INSERT' }), null);
  assert.equal(normalizarBroadcast({ op: 'TRUNCATE', id: 'm1' }), null);
  assert.equal(normalizarBroadcast(null), null);
});

test('rede postgres_changes: UPDATE com status mescla, sem status relê', () => {
  const comStatus = normalizarPostgres({
    eventType: 'UPDATE', new: { id: 'm1', conversation_id: 'c1', status: 'read' },
  });
  assert.equal(comStatus?.refresh, false);

  const semStatus = normalizarPostgres({
    eventType: 'UPDATE', new: { id: 'm1', conversation_id: 'c1', status: null },
  });
  assert.equal(semStatus?.refresh, true);
});

test('rede postgres_changes: INSERT sempre relê', () => {
  const e = normalizarPostgres({
    eventType: 'INSERT', new: { id: 'm1', conversation_id: 'c1', status: 'delivered', direction: 'in' },
  });
  assert.equal(e?.refresh, true);
  assert.equal(e?.direction, 'in');
});

test('rede postgres_changes: DELETE traz só a chave primária', () => {
  const e = normalizarPostgres({ eventType: 'DELETE', old: { id: 'm9' } });
  assert.equal(e?.op, 'DELETE');
  assert.equal(e?.id, 'm9');
  assert.equal(e?.conversation_id, null);
});

test('rede postgres_changes: linha sem id é descartada', () => {
  assert.equal(normalizarPostgres({ eventType: 'INSERT', new: {} }), null);
  assert.equal(normalizarPostgres({ eventType: 'DELETE', old: {} }), null);
});
