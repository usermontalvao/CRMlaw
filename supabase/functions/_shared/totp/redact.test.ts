import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, scrubText, REDACTED } from './redact.ts';

test('campos sensíveis somem, por nome', () => {
  const limpo = redact({
    email: 'pedro@advcuiaba.com',
    password: 'senha-do-crm',
    pin: '481902',
    secret: 'JBSWY3DPEHPK3PXP',
    refreshToken: 'abc123',
    access_token: 'xyz',
    authorization: 'Bearer abc',
    code: '593281',
    credentialId: 'uuid-ok',
  }) as Record<string, unknown>;

  assert.equal(limpo.email, 'pedro@advcuiaba.com', 'e-mail não é segredo — é o que identifica a linha de log');
  assert.equal(limpo.credentialId, 'uuid-ok');
  for (const chave of ['password', 'pin', 'secret', 'refreshToken', 'access_token', 'authorization', 'code']) {
    assert.equal(limpo[chave], REDACTED, chave);
  }
});

test('o corpo inteiro da requisição pode ser logado sem medo', () => {
  const body = {
    action: 'import',
    items: [{ name: 'Cloudflare', secret: 'JBSWY3DPEHPK3PXP', digits: 6 }],
    nested: { deep: { token: 'segredo' } },
  };
  const texto = JSON.stringify(redact(body));
  assert.ok(!texto.includes('JBSWY3DPEHPK3PXP'));
  assert.ok(!texto.includes('segredo'));
  assert.ok(texto.includes('Cloudflare'), 'o que não é sensível continua legível');
  assert.ok(texto.includes('"digits":6'));
});

test('URI de otpauth e QR de migração não sobrevivem em texto solto', () => {
  assert.equal(
    scrubText('falhou ao importar otpauth://totp/X?secret=JBSWY3DPEHPK3PXP'),
    'falhou ao importar otpauth://[redigido]',
  );
  assert.equal(
    scrubText('otpauth-migration://offline?data=CjEKCkhlbGxv'),
    'otpauth-migration://[redigido]',
  );
  assert.match(scrubText('Authorization: Bearer eyJhbGciOi'), /Bearer \[redigido\]/);
});

test('sequência que parece base32 é apagada mesmo sem nome de campo', () => {
  assert.equal(scrubText('o valor GEZDGNBVGY3TQOJQ falhou'), `o valor ${REDACTED} falhou`);
  assert.equal(scrubText('CPF 12345678900 falhou'), 'CPF 12345678900 falhou', 'número não é base32');
});

test('estrutura profunda ou estranha não escapa por recursão', () => {
  let deep: Record<string, unknown> = { secret: 'x' };
  for (let i = 0; i < 12; i += 1) deep = { level: deep };
  assert.ok(!JSON.stringify(redact(deep)).includes('"x"'));

  assert.equal(redact(() => 'x'), REDACTED, 'função não vira log');
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(null), null);
});
