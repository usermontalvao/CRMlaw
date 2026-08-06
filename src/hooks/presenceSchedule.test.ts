import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAY_AFTER_MS,
  REFRESH_MS,
  applyWrite,
  createPresenceState,
  decideOnActivity,
  decideOnInactivity,
  decideOnLeave,
  decideOnMount,
  decideOnRefresh,
  type PresenceStatus,
} from './presenceSchedule.ts';

const MIN = 60 * 1000;

/** Roda a máquina de estados como o hook faz e conta o que foi para o banco. */
function simular(now: number) {
  const state = createPresenceState(now);
  const escritas: Array<{ em: number; status: PresenceStatus }> = [];

  const write = (status: PresenceStatus | null, em: number) => {
    if (!status) return;
    applyWrite(state, status, em);
    escritas.push({ em, status });
  };

  return { state, escritas, write };
}

test('entrar no sistema grava presença uma vez', () => {
  const { escritas, write } = simular(0);
  write(decideOnMount(), 0);
  assert.equal(escritas.length, 1);
  assert.equal(escritas[0].status, 'online');
});

test('trabalhar sem parar não grava a cada evento, só nas reconfirmações', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);

  // Uma hora de trabalho, com atividade a cada 10 segundos.
  for (let t = 10_000; t <= 60 * MIN; t += 10_000) {
    write(decideOnActivity(state, t), t);
    if (t % REFRESH_MS === 0) write(decideOnRefresh(state), t);
  }

  // 1 ao entrar + 1 reconfirmação a cada 5 min durante 60 min.
  assert.equal(escritas.length, 1 + 12);
  // O heartbeat antigo, de 2 em 2 minutos, teria gravado 30 vezes na mesma hora.
  assert.ok(escritas.length < 30);
});

test('aba aberta e parada não gera escrita nenhuma depois de ficar ausente', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);

  // Nenhuma atividade. Vira ausente uma vez, e pronto.
  write(decideOnInactivity(state), AWAY_AFTER_MS);

  for (let t = REFRESH_MS; t <= 8 * 60 * MIN; t += REFRESH_MS) {
    write(decideOnRefresh(state), t);
  }

  assert.deepEqual(
    escritas.map((e) => e.status),
    ['online', 'away'],
  );
});

test('voltar de ausente grava online na hora', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);
  write(decideOnInactivity(state), AWAY_AFTER_MS);
  assert.equal(state.status, 'away');

  const volta = AWAY_AFTER_MS + 3 * MIN;
  write(decideOnActivity(state, volta), volta);

  assert.equal(state.status, 'online');
  assert.deepEqual(
    escritas.map((e) => e.status),
    ['online', 'away', 'online'],
  );
});

test('reconfirmação só escreve se houve atividade desde a última escrita', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);

  // Primeira batida sem nenhuma atividade: não escreve.
  write(decideOnRefresh(state), REFRESH_MS);
  assert.equal(escritas.length, 1);

  // Houve um clique; a batida seguinte reconfirma.
  write(decideOnActivity(state, REFRESH_MS + MIN), REFRESH_MS + MIN);
  write(decideOnRefresh(state), 2 * REFRESH_MS);
  assert.equal(escritas.length, 2);

  // Nova batida sem atividade nova: silêncio de novo.
  write(decideOnRefresh(state), 3 * REFRESH_MS);
  assert.equal(escritas.length, 2);
});

test('estar ausente cancela a reconfirmação mesmo com atividade registrada antes', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);
  write(decideOnActivity(state, MIN), MIN);
  write(decideOnInactivity(state), AWAY_AFTER_MS);

  const antes = escritas.length;
  write(decideOnRefresh(state), REFRESH_MS);
  assert.equal(escritas.length, antes);
});

test('ficar ausente duas vezes seguidas grava uma vez só', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);
  write(decideOnInactivity(state), AWAY_AFTER_MS);
  write(decideOnInactivity(state), 2 * AWAY_AFTER_MS);

  assert.equal(escritas.filter((e) => e.status === 'away').length, 1);
});

test('sair grava offline, e pagehide seguido de desmontagem não grava duas vezes', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);

  write(decideOnLeave(state), 10 * MIN);
  write(decideOnLeave(state), 10 * MIN + 1);

  assert.equal(escritas.filter((e) => e.status === 'offline').length, 1);
});

test('um dia de trabalho grava muito menos que o heartbeat de 2 minutos', () => {
  const { state, escritas, write } = simular(0);
  write(decideOnMount(), 0);

  // 8 horas com a aba aberta, mas ativo só nos primeiros 10 min de cada hora.
  const JORNADA = 8 * 60 * MIN;
  for (let t = 10_000; t <= JORNADA; t += 10_000) {
    const minutoDaHora = Math.floor(t / MIN) % 60;
    if (minutoDaHora < 10) write(decideOnActivity(state, t), t);
    if (t % AWAY_AFTER_MS === 0 && t - state.lastActivityAt >= AWAY_AFTER_MS) {
      write(decideOnInactivity(state), t);
    }
    if (t % REFRESH_MS === 0) write(decideOnRefresh(state), t);
  }
  write(decideOnLeave(state), JORNADA);

  const heartbeatAntigo = JORNADA / (2 * MIN); // 240 escritas
  assert.equal(heartbeatAntigo, 240);
  assert.ok(
    escritas.length < heartbeatAntigo / 4,
    `esperava bem menos que ${heartbeatAntigo} escritas, veio ${escritas.length}`,
  );
});
