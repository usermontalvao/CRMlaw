import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MasterKeyring,
  VaultCryptoError,
  sealSecret,
  openSecret,
  rewrapDek,
  fingerprintSecret,
  bytesToPgHex,
  pgHexToBytes,
  randomToken,
  sha256Hex,
  CRYPTO_VERSION,
} from './vault-crypto.ts';

const keyV1 = new Uint8Array(32).fill(7);
const keyV2 = new Uint8Array(32).fill(9);
const pepper = new Uint8Array(32).fill(3);
const SECRET = 'JBSWY3DPEHPK3PXP';

test('o chaveiro recusa chave de tamanho errado e versão ativa inexistente', () => {
  assert.throws(() => new MasterKeyring({ 1: new Uint8Array(16) }), VaultCryptoError);
  assert.throws(() => new MasterKeyring({}), VaultCryptoError);
  assert.throws(() => new MasterKeyring({ 1: keyV1 }, 2), VaultCryptoError);
  assert.equal(new MasterKeyring({ 1: keyV1, 2: keyV2 }).activeVersion, 2, 'a mais nova é a ativa');
  assert.equal(new MasterKeyring({ 1: keyV1, 2: keyV2 }, 1).activeVersion, 1);
});

test('selar e abrir devolve o mesmo segredo', async () => {
  const keyring = new MasterKeyring({ 1: keyV1 });
  const id = crypto.randomUUID();
  const sealed = await sealSecret(keyring, id, SECRET);

  assert.equal(sealed.keyVersion, 1);
  assert.equal(sealed.cryptoVersion, CRYPTO_VERSION);
  assert.equal(sealed.secretIv.length, 12);
  assert.equal(sealed.dekIv.length, 12);
  // 32 bytes de DEK + 16 de tag GCM.
  assert.equal(sealed.wrappedDek.length, 48);
  assert.equal(await openSecret(keyring, sealed), SECRET);
});

test('o ciphertext não contém o segredo em texto puro', async () => {
  const keyring = new MasterKeyring({ 1: keyV1 });
  const sealed = await sealSecret(keyring, crypto.randomUUID(), SECRET);
  const asText = new TextDecoder().decode(sealed.secretCiphertext);
  assert.ok(!asText.includes(SECRET));
  assert.ok(!bytesToPgHex(sealed.secretCiphertext).includes(Buffer.from(SECRET).toString('hex')));
});

test('cada credencial tem DEK próprio: dois segredos iguais dão ciphertext diferente', async () => {
  const keyring = new MasterKeyring({ 1: keyV1 });
  const a = await sealSecret(keyring, crypto.randomUUID(), SECRET);
  const b = await sealSecret(keyring, crypto.randomUUID(), SECRET);
  assert.notDeepEqual(a.secretCiphertext, b.secretCiphertext);
  assert.notDeepEqual(a.wrappedDek, b.wrappedDek);
});

test('mover o ciphertext para outra linha não entrega o segredo', async () => {
  const keyring = new MasterKeyring({ 1: keyV1 });
  const vitima = await sealSecret(keyring, crypto.randomUUID(), SECRET);
  const atacante = await sealSecret(keyring, crypto.randomUUID(), 'GEZDGNBVGY3TQOJQ');

  // O AAD amarra o ciphertext ao id da linha: colar um no outro falha.
  await assert.rejects(openSecret(keyring, { ...atacante, secretCiphertext: vitima.secretCiphertext, secretIv: vitima.secretIv }));
  await assert.rejects(openSecret(keyring, { ...vitima, credentialId: atacante.credentialId }));
});

test('adulterar um byte do ciphertext falha (GCM autentica)', async () => {
  const keyring = new MasterKeyring({ 1: keyV1 });
  const sealed = await sealSecret(keyring, crypto.randomUUID(), SECRET);
  const mexido = new Uint8Array(sealed.secretCiphertext);
  mexido[0] ^= 0xff;
  await assert.rejects(openSecret(keyring, { ...sealed, secretCiphertext: mexido }));
});

test('a chave errada não abre', async () => {
  const cofreCerto = new MasterKeyring({ 1: keyV1 });
  const cofreErrado = new MasterKeyring({ 1: keyV2 });
  const sealed = await sealSecret(cofreCerto, crypto.randomUUID(), SECRET);
  await assert.rejects(openSecret(cofreErrado, sealed));
});

test('rotação: reembrulha o DEK sem tocar no ciphertext do segredo', async () => {
  const keyring = new MasterKeyring({ 1: keyV1, 2: keyV2 }, 2);
  const id = crypto.randomUUID();
  const sealed = await sealSecret(keyring, id, SECRET, 1);
  assert.equal(sealed.keyVersion, 1);

  const rewrapped = await rewrapDek(keyring, sealed, 2);
  assert.equal(rewrapped.keyVersion, 2);

  const depois = { ...sealed, ...rewrapped };
  assert.deepEqual(depois.secretCiphertext, sealed.secretCiphertext, 'o segredo não é recifrado');
  assert.equal(await openSecret(keyring, depois), SECRET);

  // Aposentar a v1 não deixa a credencial ilegível.
  const soV2 = new MasterKeyring({ 2: keyV2 });
  assert.equal(await openSecret(soV2, depois), SECRET);
  await assert.rejects(openSecret(soV2, sealed), VaultCryptoError);
});

test('impressão digital é estável, sensível e depende do pepper', async () => {
  const a = await fingerprintSecret(pepper, SECRET);
  assert.equal(a, await fingerprintSecret(pepper, 'jbsw y3dp ehpk 3pxp='), 'normaliza espaço, caixa e padding');
  assert.notEqual(a, await fingerprintSecret(pepper, 'GEZDGNBVGY3TQOJQ'));
  assert.notEqual(a, await fingerprintSecret(new Uint8Array(32).fill(4), SECRET));
  assert.equal(a.length, 64);
  await assert.rejects(fingerprintSecret(new Uint8Array(8), SECRET), VaultCryptoError);
});

test('bytea vai e volta', () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 255]);
  assert.equal(bytesToPgHex(bytes), '\\x00010f10ff');
  assert.deepEqual(pgHexToBytes('\\x00010f10ff'), bytes);
  assert.deepEqual(pgHexToBytes('00010f10ff'), bytes);
});

test('token opaco tem 256 bits e o hash é estável', async () => {
  const token = randomToken(32);
  assert.equal(token.length, 64);
  assert.notEqual(token, randomToken(32));
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
