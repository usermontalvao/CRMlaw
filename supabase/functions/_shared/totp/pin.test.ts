import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePin,
  verifyPin,
  validatePinFormat,
  timingSafeEqualHex,
  pinLockOnCheck,
  pinLockOnFailure,
  pinLockOnSuccess,
  PIN_KDF,
  PIN_MAX_ATTEMPTS,
  PIN_BLOCK_LADDER_SECONDS,
  type PinLockState,
} from './pin.ts';

const pepper = new Uint8Array(32).fill(11);

test('formato: 6 a 8 dígitos, sem sequência óbvia', () => {
  assert.equal(validatePinFormat('481902'), null);
  assert.equal(validatePinFormat('48190237'), null);
  assert.match(String(validatePinFormat('12345')), /6 a 8/);
  assert.match(String(validatePinFormat('123456789')), /6 a 8/);
  assert.match(String(validatePinFormat('abc123')), /6 a 8/);
  assert.match(String(validatePinFormat('123456')), /simples/);
  assert.match(String(validatePinFormat('111111')), /simples/);
  assert.match(String(validatePinFormat('7777777')), /simples/);
});

test('o PIN não é recuperável a partir do que fica guardado', async () => {
  const stored = await derivePin(pepper, '481902');
  assert.equal(stored.kdf, PIN_KDF);
  assert.equal(stored.salt.length, 32, '16 bytes de salt em hex');
  assert.equal(stored.hash.length, 64, '256 bits em hex');
  assert.ok(!stored.hash.includes('481902'));
  assert.ok(!stored.salt.includes('481902'));
});

test('cada administrador tem salt próprio: o mesmo PIN dá hash diferente', async () => {
  const a = await derivePin(pepper, '481902');
  const b = await derivePin(pepper, '481902');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('verificação aceita o certo e recusa o errado', async () => {
  const stored = await derivePin(pepper, '481902');
  assert.equal(await verifyPin(pepper, '481902', stored), true);
  assert.equal(await verifyPin(pepper, '481903', stored), false);
  assert.equal(await verifyPin(pepper, '', stored), false);
});

test('sem o pepper o dump do banco não serve para nada', async () => {
  const stored = await derivePin(pepper, '481902');
  const outroPepper = new Uint8Array(32).fill(12);
  assert.equal(await verifyPin(outroPepper, '481902', stored), false);
});

test('pepper curto e esquema desconhecido falham alto, não em silêncio', async () => {
  await assert.rejects(derivePin(new Uint8Array(8), '481902'), /pepper/);
  const stored = await derivePin(pepper, '481902');
  await assert.rejects(verifyPin(pepper, '481902', { ...stored, kdf: 'md5' }), /desconhecido/);
});

test('comparação em tempo constante', () => {
  assert.equal(timingSafeEqualHex('abcd', 'abcd'), true);
  assert.equal(timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(timingSafeEqualHex('abcd', 'abcde'), false);
  assert.equal(timingSafeEqualHex('', ''), true);
});

// ── escada de bloqueio ──────────────────────────────────────────────────────

const inicial: PinLockState = { failedAttempts: 0, lockRound: 0, lockedUntilMs: null };
const AGORA = 1_700_000_000_000;

test('cinco erros bloqueiam; antes disso o contador avisa quanto falta', () => {
  let state = inicial;
  for (let tentativa = 1; tentativa < PIN_MAX_ATTEMPTS; tentativa += 1) {
    const d = pinLockOnFailure(state, AGORA);
    assert.equal(d.blocked, false, `tentativa ${tentativa}`);
    assert.equal(d.attemptsRemaining, PIN_MAX_ATTEMPTS - tentativa);
    state = d.next;
  }

  const quinta = pinLockOnFailure(state, AGORA);
  assert.equal(quinta.blocked, true);
  assert.equal(quinta.retryAfterSeconds, PIN_BLOCK_LADDER_SECONDS[0]);
  assert.equal(quinta.next.lockRound, 1);
  assert.equal(quinta.next.lockedUntilMs, AGORA + 300_000);
});

test('durante o bloqueio nem se testa o PIN', () => {
  const bloqueado: PinLockState = { failedAttempts: 0, lockRound: 1, lockedUntilMs: AGORA + 120_000 };
  const d = pinLockOnCheck(bloqueado, AGORA);
  assert.equal(d.blocked, true);
  assert.equal(d.retryAfterSeconds, 120);
});

test('o bloqueio é progressivo: cada rodada dura mais que a anterior', () => {
  let state = inicial;
  const duracoes: number[] = [];

  for (let rodada = 0; rodada < PIN_BLOCK_LADDER_SECONDS.length + 2; rodada += 1) {
    for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i += 1) state = pinLockOnFailure(state, AGORA).next;
    const bloqueio = pinLockOnFailure(state, AGORA);
    duracoes.push(bloqueio.retryAfterSeconds);
    // Passa o tempo do bloqueio e recomeça.
    state = pinLockOnCheck(bloqueio.next, AGORA + bloqueio.retryAfterSeconds * 1000 + 1).next;
  }

  assert.deepEqual(duracoes.slice(0, PIN_BLOCK_LADDER_SECONDS.length), PIN_BLOCK_LADDER_SECONDS);
  const teto = PIN_BLOCK_LADDER_SECONDS[PIN_BLOCK_LADDER_SECONDS.length - 1];
  assert.equal(duracoes[duracoes.length - 1], teto, 'a escada estaciona no teto de 24h');
});

test('bloqueio vencido zera as tentativas mas guarda a rodada', () => {
  const vencido: PinLockState = { failedAttempts: 4, lockRound: 2, lockedUntilMs: AGORA - 1 };
  const d = pinLockOnCheck(vencido, AGORA);
  assert.equal(d.blocked, false);
  assert.equal(d.next.failedAttempts, 0);
  assert.equal(d.next.lockRound, 2, 'quem já apanhou duas vezes não volta ao começo');
});

test('acerto limpa tudo, inclusive a rodada', () => {
  assert.deepEqual(
    pinLockOnSuccess({ failedAttempts: 3, lockRound: 4, lockedUntilMs: AGORA }),
    inicial,
  );
});
