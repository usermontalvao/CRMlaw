import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTotp, hotp, verifyTotp, counterFor, normalizeAlgorithm, normalizeDigits, normalizePeriod } from './totp.ts';
import { base32Decode, base32Encode, isValidBase32, normalizeBase32 } from './base32.ts';

// Os segredos do apêndice B do RFC 6238 são ASCII repetido até o tamanho do
// bloco de cada hash.
const ascii = (value: string) => new TextEncoder().encode(value);
const SEED_SHA1 = ascii('12345678901234567890');
const SEED_SHA256 = ascii('12345678901234567890123456789012');
const SEED_SHA512 = ascii('1234567890123456789012345678901234567890123456789012345678901234');

// Tabela oficial do RFC 6238 (8 dígitos, período 30).
const RFC_VECTORS: [number, string, string, string][] = [
  [59,          '94287082', '46119246', '90693936'],
  [1111111109,  '07081804', '68084774', '25091201'],
  [1111111111,  '14050471', '67062674', '99943326'],
  [1234567890,  '89005924', '91819424', '93441116'],
  [2000000000,  '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

test('RFC 6238 — SHA1, SHA256 e SHA512 com 8 dígitos', async () => {
  for (const [seconds, sha1, sha256, sha512] of RFC_VECTORS) {
    const at = seconds * 1000;
    assert.equal(
      (await generateTotp({ secret: SEED_SHA1, algorithm: 'SHA1', digits: 8, period: 30, timestampMs: at })).code,
      sha1,
      `SHA1 em t=${seconds}`,
    );
    assert.equal(
      (await generateTotp({ secret: SEED_SHA256, algorithm: 'SHA256', digits: 8, period: 30, timestampMs: at })).code,
      sha256,
      `SHA256 em t=${seconds}`,
    );
    assert.equal(
      (await generateTotp({ secret: SEED_SHA512, algorithm: 'SHA512', digits: 8, period: 30, timestampMs: at })).code,
      sha512,
      `SHA512 em t=${seconds}`,
    );
  }
});

test('6 dígitos são os 6 últimos do vetor de 8', async () => {
  const seis = await generateTotp({ secret: SEED_SHA1, digits: 6, period: 30, timestampMs: 59_000 });
  assert.equal(seis.code, '287082');
  assert.equal(seis.digits, 6);
});

test('RFC 4226 — os dez códigos HOTP do apêndice D', async () => {
  const esperados = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  for (let counter = 0; counter < esperados.length; counter += 1) {
    assert.equal(await hotp(SEED_SHA1, counter, 'SHA1', 6), esperados[counter]);
  }
});

test('mudar o período muda a janela e o código', async () => {
  const at = 59_000;
  const p30 = await generateTotp({ secret: SEED_SHA1, digits: 8, period: 30, timestampMs: at });
  const p60 = await generateTotp({ secret: SEED_SHA1, digits: 8, period: 60, timestampMs: at });
  assert.notEqual(p30.code, p60.code);
  assert.equal(counterFor(at, 30), 1);
  assert.equal(counterFor(at, 60), 0);
});

test('o contador regressivo bate com o relógio', async () => {
  // t = 1000s, período 30 → janela começou em 990s, faltam 20s.
  const r = await generateTotp({ secret: SEED_SHA1, period: 30, timestampMs: 1_000_000 });
  assert.equal(r.expiresIn, 20);
  assert.equal(r.validFrom, 990_000);

  // No instante exato em que a janela vira, sobra o período inteiro.
  const virada = await generateTotp({ secret: SEED_SHA1, period: 30, timestampMs: 1_020_000 });
  assert.equal(virada.expiresIn, 30);
});

test('verificação aceita a janela vizinha e recusa código alheio', async () => {
  const at = 1_234_567_890_000;
  const atual = (await generateTotp({ secret: SEED_SHA1, timestampMs: at })).code;
  const anterior = (await generateTotp({ secret: SEED_SHA1, timestampMs: at - 30_000 })).code;

  assert.equal(await verifyTotp(atual, { secret: SEED_SHA1, timestampMs: at }), true);
  assert.equal(await verifyTotp(anterior, { secret: SEED_SHA1, timestampMs: at }), true);
  assert.equal(await verifyTotp(anterior, { secret: SEED_SHA1, timestampMs: at, tolerance: 0 }), false);
  assert.equal(await verifyTotp('000000', { secret: SEED_SHA512, timestampMs: at }), false);
});

test('base32 vai e volta, e recusa lixo', () => {
  assert.equal(base32Encode(ascii('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), SEED_SHA1);

  // Minúsculas, espaços e padding são coisa de quem digitou — não erro.
  assert.equal(normalizeBase32('jbsw y3dp ehpk 3pxp='), 'JBSWY3DPEHPK3PXP');
  assert.deepEqual(base32Decode('jbsw y3dp ehpk 3pxp'), base32Decode('JBSWY3DPEHPK3PXP'));

  assert.equal(isValidBase32('JBSWY3DPEHPK3PXP'), true);
  assert.equal(isValidBase32('JBSW1Y3DP'), false, '1 não existe no alfabeto');
  assert.equal(isValidBase32(''), false);
  assert.equal(isValidBase32('A'), false, 'sobra bit demais para formar byte');
  assert.throws(() => base32Decode('!!!'));
});

test('parâmetros fora do padrão são recusados na entrada', () => {
  assert.equal(normalizeAlgorithm('sha-256'), 'SHA256');
  assert.equal(normalizeAlgorithm(undefined), 'SHA1');
  assert.throws(() => normalizeAlgorithm('MD5'));

  assert.equal(normalizeDigits(undefined), 6);
  assert.equal(normalizeDigits('8'), 8);
  assert.throws(() => normalizeDigits(7));

  assert.equal(normalizePeriod(undefined), 30);
  assert.equal(normalizePeriod('60'), 60);
  assert.throws(() => normalizePeriod(5));
  assert.throws(() => normalizePeriod(999));
});
