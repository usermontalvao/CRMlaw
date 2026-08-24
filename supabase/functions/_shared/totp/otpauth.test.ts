import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOtpauthUri,
  buildOtpauthUri,
  buildDisplayName,
  parseGoogleAuthenticatorMigration,
  parseImportPayload,
  OtpauthParseError,
} from './otpauth.ts';
import { base32Decode } from './base32.ts';

test('URI simples: issuer no label e no parâmetro', () => {
  const entry = parseOtpauthUri('otpauth://totp/Cloudflare:pedro%40advcuiaba.com?secret=JBSWY3DPEHPK3PXP&issuer=Cloudflare');
  assert.equal(entry.issuer, 'Cloudflare');
  assert.equal(entry.accountLabel, 'pedro@advcuiaba.com');
  assert.equal(entry.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(entry.algorithm, 'SHA1');
  assert.equal(entry.digits, 6);
  assert.equal(entry.period, 30);
  assert.equal(entry.name, 'Cloudflare (pedro@advcuiaba.com)');
});

test('o parâmetro issuer ganha do label quando divergem', () => {
  const entry = parseOtpauthUri('otpauth://totp/Antigo:conta?secret=JBSWY3DPEHPK3PXP&issuer=Novo');
  assert.equal(entry.issuer, 'Novo');
});

test('parâmetros não-padrão são respeitados', () => {
  const entry = parseOtpauthUri('otpauth://totp/AWS:root?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA512&digits=8&period=60');
  assert.equal(entry.algorithm, 'SHA512');
  assert.equal(entry.digits, 8);
  assert.equal(entry.period, 60);
});

test('entrada inválida vira erro claro, não credencial torta', () => {
  assert.throws(() => parseOtpauthUri('https://exemplo.com'), OtpauthParseError);
  assert.throws(() => parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'), /HOTP/);
  assert.throws(() => parseOtpauthUri('otpauth://totp/x?secret=nada!'), /base32/);
  assert.throws(() => parseOtpauthUri('otpauth://totp/x'), /base32/);
});

test('ida e volta pela URI preserva tudo que importa', () => {
  const original = parseOtpauthUri('otpauth://totp/Jurius:servidor?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=45');
  const roundTrip = parseOtpauthUri(buildOtpauthUri(original));
  assert.deepEqual(roundTrip, original);
});

test('nome de exibição não repete o issuer', () => {
  assert.equal(buildDisplayName('Google', 'Google'), 'Google');
  assert.equal(buildDisplayName('Google', null), 'Google');
  assert.equal(buildDisplayName(null, 'conta@x'), 'conta@x');
  assert.equal(buildDisplayName(null, null), 'Sem nome');
});

// ── QR de transferência do Google Authenticator ─────────────────────────────
//
// Monta-se o protobuf aqui mesmo: é a única forma honesta de testar o leitor
// sem colar um payload real (e payload real de migração É segredo).

function varint(value: number): number[] {
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint((field << 3) | wire);
}

function lengthDelimited(field: number, bytes: Uint8Array | number[]): number[] {
  const data = [...bytes];
  return [...tag(field, 2), ...varint(data.length), ...data];
}

function otpParameters(opts: {
  secret: Uint8Array; name: string; issuer: string; algorithm: number; digits: number; type: number;
}): number[] {
  const enc = new TextEncoder();
  return [
    ...lengthDelimited(1, opts.secret),
    ...lengthDelimited(2, enc.encode(opts.name)),
    ...lengthDelimited(3, enc.encode(opts.issuer)),
    ...tag(4, 0), ...varint(opts.algorithm),
    ...tag(5, 0), ...varint(opts.digits),
    ...tag(6, 0), ...varint(opts.type),
  ];
}

function migrationUri(entries: number[][], batchSize = 1, batchIndex = 0): string {
  const body = [
    ...entries.flatMap((entry) => lengthDelimited(1, entry)),
    ...tag(2, 0), ...varint(1),
    ...tag(3, 0), ...varint(batchSize),
    ...tag(4, 0), ...varint(batchIndex),
  ];
  const base64 = Buffer.from(Uint8Array.from(body)).toString('base64');
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

test('QR de transferência devolve todas as contas TOTP', () => {
  const uri = migrationUri([
    otpParameters({ secret: base32Decode('JBSWY3DPEHPK3PXP'), name: 'pedro@advcuiaba.com', issuer: 'Cloudflare', algorithm: 1, digits: 1, type: 2 }),
    otpParameters({ secret: base32Decode('GEZDGNBVGY3TQOJQ'), name: 'AWS:root', issuer: '', algorithm: 2, digits: 2, type: 2 }),
  ], 1, 0);

  const result = parseGoogleAuthenticatorMigration(uri);
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 0);

  assert.equal(result.entries[0].issuer, 'Cloudflare');
  assert.equal(result.entries[0].secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(result.entries[0].algorithm, 'SHA1');
  assert.equal(result.entries[0].digits, 6);
  assert.equal(result.entries[0].period, 30);

  // Sem campo issuer, o `Issuer:conta` do nome resolve.
  assert.equal(result.entries[1].issuer, 'AWS');
  assert.equal(result.entries[1].accountLabel, 'root');
  assert.equal(result.entries[1].algorithm, 'SHA256');
  assert.equal(result.entries[1].digits, 8);
});

test('conta HOTP e MD5 são puladas com motivo, sem derrubar o lote', () => {
  const uri = migrationUri([
    otpParameters({ secret: base32Decode('JBSWY3DPEHPK3PXP'), name: 'ok', issuer: 'Boa', algorithm: 1, digits: 1, type: 2 }),
    otpParameters({ secret: base32Decode('JBSWY3DPEHPK3PXP'), name: 'contador', issuer: 'Velha', algorithm: 1, digits: 1, type: 1 }),
    otpParameters({ secret: base32Decode('JBSWY3DPEHPK3PXP'), name: 'md5', issuer: 'Estranha', algorithm: 4, digits: 1, type: 2 }),
  ]);

  const result = parseGoogleAuthenticatorMigration(uri);
  assert.equal(result.entries.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0].reason, /HOTP/);
  assert.match(result.skipped[1].reason, /MD5/);
});

test('payload inválido não vira credencial silenciosa', () => {
  assert.throws(() => parseGoogleAuthenticatorMigration('otpauth-migration://offline'), OtpauthParseError);
  assert.throws(() => parseGoogleAuthenticatorMigration('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP'), OtpauthParseError);
});

test('colar várias linhas importa cada uma e reporta as ruins', () => {
  const payload = [
    'otpauth://totp/A:um?secret=JBSWY3DPEHPK3PXP',
    'lixo colado sem querer',
    'otpauth://totp/B:dois?secret=GEZDGNBVGY3TQOJQ&digits=8',
  ].join('\n');

  const result = parseImportPayload(payload);
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.entries[1].digits, 8);
});

test('importar nada é erro, não lista vazia', () => {
  assert.throws(() => parseImportPayload('   '), /Nada para importar/);
  assert.throws(() => parseImportPayload('só lixo'), OtpauthParseError);
});
