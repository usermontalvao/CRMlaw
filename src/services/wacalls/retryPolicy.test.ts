import test from 'node:test';
import assert from 'node:assert/strict';
import { canDial, retryDelay, shouldRetry, RETRY_STEPS_MS } from './retryPolicy.ts';
import type { RetryState } from './retryPolicy.ts';

/** O estado de quem está com a linha verde — o ponto de partida de cada teste. */
const verde: RetryState = {
  ready: true, online: true, available: true, hasLine: true,
  busy: false, hidden: false, inCall: false, preview: false,
};

test('linha verde não precisa de tentativa nenhuma', () => {
  assert.ok(canDial(verde));
  assert.ok(!shouldRetry(verde));
});

test('as três causas do amarelo levam à mesma sala de espera', () => {
  // Era esta a falha: a volta automática vigiava só a primeira.
  assert.ok(shouldRetry({ ...verde, available: false }));  // serviço fora
  assert.ok(shouldRetry({ ...verde, hasLine: false }));    // conta não conectada
  // "Sem linha" também é o caso de quem ainda não foi incluído no canal — e é
  // por insistir aqui que o discador acende sozinho quando o admin inclui.
  assert.ok(shouldRetry({ ...verde, hasLine: false, available: true }));
});

test('carregando não é amarelo: antes do primeiro contato não se insiste', () => {
  assert.ok(!shouldRetry({ ...verde, ready: false, available: false, hasLine: false }));
});

test('sem rede não se insiste — quem avisa é o navegador', () => {
  assert.ok(!shouldRetry({ ...verde, online: false, hasLine: false }));
});

test('em ligação não se mexe em nada', () => {
  assert.ok(!shouldRetry({ ...verde, available: false, inCall: true }));
});

test('aba escondida não bate no servidor', () => {
  // Vezes o escritório inteiro com o CRM aberto no outro monitor, isso seria
  // tráfego puro para acertar um indicador que ninguém está olhando.
  assert.ok(!shouldRetry({ ...verde, available: false, hidden: true }));
});

test('tentativa em curso não vira duas', () => {
  assert.ok(!shouldRetry({ ...verde, available: false, busy: true }));
});

test('a bancada de desenvolvimento fica fora da sala de espera', () => {
  assert.ok(!shouldRetry({ ...verde, available: false, preview: true }));
});

test('a escada sobe e para no teto', () => {
  assert.equal(retryDelay(0), 10_000);
  assert.equal(retryDelay(1), 20_000);
  assert.equal(retryDelay(4), 120_000);
  // Depois do último degrau, insiste para sempre de dois em dois minutos: é o
  // que mantém viva a recuperação que depende de outra pessoa (o admin incluir
  // alguém no canal).
  assert.equal(retryDelay(99), 120_000);
  assert.equal(retryDelay(-3), RETRY_STEPS_MS[0]);
});
