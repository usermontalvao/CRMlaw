import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_FLAP_GRACE_MS,
  CHANNEL_OPEN_TOUCH_MS,
  applyChannelState,
  decideChannelState,
  isWaConnectionFailure,
  mapWaState,
} from './wa-channel-state.ts';

const AGORA = Date.parse('2026-08-17T21:00:00.000Z');
const haMs = (ms: number) => new Date(AGORA - ms).toISOString();

test('open marca conectado na hora, mesmo vindo de desconectado', () => {
  const d = decideChannelState({ raw: 'open', current: 'disconnected', lastOpenAt: null, now: AGORA });
  assert.equal(d.status, 'connected');
  assert.equal(d.write, true);
  assert.equal(d.touchLastOpen, true);
});

test('sequência de open num canal já conectado não gera escrita', () => {
  const d = decideChannelState({
    raw: 'open', current: 'connected', lastOpenAt: haMs(CHANNEL_OPEN_TOUCH_MS - 1_000), now: AGORA,
  });
  assert.equal(d.write, false, 'era a enxurrada de UPDATE no mesmo registro');
});

test('a piscada do socket (close/connecting logo após um open) não derruba o canal', () => {
  for (const raw of ['connecting', 'close']) {
    const d = decideChannelState({ raw, current: 'connected', lastOpenAt: haMs(5_000), now: AGORA });
    assert.equal(d.status, 'connected', raw);
    assert.equal(d.write, false, raw);
  }
});

test('queda de verdade (carência vencida) derruba o status', () => {
  const d = decideChannelState({
    raw: 'close', current: 'connected', lastOpenAt: haMs(CHANNEL_FLAP_GRACE_MS + 1_000), now: AGORA,
  });
  assert.equal(d.status, 'disconnected');
  assert.equal(d.write, true);
});

test('canal que nunca abriu não ganha carência', () => {
  const d = decideChannelState({ raw: 'connecting', current: 'disconnected', lastOpenAt: null, now: AGORA });
  assert.equal(d.status, 'connecting');
  assert.equal(d.withinGrace, false);
});

test('estado cru vira o vocabulário do CRM', () => {
  assert.equal(mapWaState('open'), 'connected');
  assert.equal(mapWaState('connecting'), 'connecting');
  assert.equal(mapWaState('close'), 'disconnected');
  assert.equal(mapWaState(undefined), 'disconnected');
});

test('applyChannelState só toca o banco quando há mudança', async () => {
  const escritas: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: async () => { escritas.push(patch); } }) }),
  };

  // piscada: nada
  await applyChannelState(admin, { id: 'c1', status: 'connected', last_open_at: haMs(5_000) }, 'close', AGORA);
  assert.equal(escritas.length, 0);

  // queda de verdade: grava e limpa o "conectado desde"
  await applyChannelState(
    admin, { id: 'c1', status: 'connected', last_open_at: haMs(CHANNEL_FLAP_GRACE_MS + 1) }, 'close', AGORA);
  assert.equal(escritas.length, 1);
  assert.equal(escritas[0].status, 'disconnected');
  assert.equal(escritas[0].connected_at, null);

  // volta: carimba last_open_at e o "conectado desde"
  await applyChannelState(admin, { id: 'c1', status: 'disconnected', last_open_at: null }, 'open', AGORA);
  assert.equal(escritas.length, 2);
  assert.equal(escritas[1].status, 'connected');
  assert.equal(escritas[1].last_open_at, new Date(AGORA).toISOString());
  assert.equal(escritas[1].connected_at, new Date(AGORA).toISOString());
});

test('código de fechamento pelado conta como canal fora — o "1006" que virou falha definitiva', () => {
  for (const erro of ['1006', 'Error: 1006', '1005', '428', ' 408 ']) {
    assert.equal(isWaConnectionFailure(erro), true, erro);
  }
});

test('frases do Baileys também contam', () => {
  for (const erro of ['Error: Connection Closed', 'Connection Terminated', 'Timed Out', 'websocket error']) {
    assert.equal(isWaConnectionFailure(erro), true, erro);
  }
});

test('erro de negócio NÃO vira retenção — a mensagem tem de falhar mesmo', () => {
  for (const erro of ['O número não possui WhatsApp ativo', 'Contato bloqueado', '', null]) {
    assert.equal(isWaConnectionFailure(erro), false, String(erro));
  }
});
