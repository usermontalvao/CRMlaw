import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type VerificacaoRegistrada,
  comCanalRecuperado,
  recuperarCanal,
} from './canalRecuperado.ts';

const SIGNER = 'e4e646fe-f0c7-4395-8e13-9a4c2ac663a0';
const ASSINADO_EM = '2026-08-29T03:19:07.935Z';

const v = (over: Partial<VerificacaoRegistrada> = {}): VerificacaoRegistrada => ({
  signerId: SIGNER,
  canal: 'whatsapp',
  identificador: '5565984046375',
  verificadoEm: '2026-08-29T03:18:24.660Z',
  ...over,
});

const assinante = (over: Record<string, unknown> = {}) => ({
  id: SIGNER,
  signed_at: ASSINADO_EM,
  auth_verified_channel: null as string | null,
  ...over,
});

test('recupera o canal quando o signatário não tem — era o caso real', () => {
  const achado = recuperarCanal(assinante(), [v()]);
  assert.equal(achado?.canal, 'whatsapp');
  assert.equal(achado?.identificador, '5565984046375');
});

test('entre várias verificações, vence a mais recente ANTES da assinatura', () => {
  const achado = recuperarCanal(assinante(), [
    v({ verificadoEm: '2026-08-29T03:04:59.325Z' }),
    v({ verificadoEm: '2026-08-29T03:18:24.660Z' }),
    v({ verificadoEm: '2026-08-29T03:05:59.338Z' }),
  ]);
  assert.equal(achado?.verificadoEm, '2026-08-29T03:18:24.660Z');
});

test('verificação POSTERIOR à assinatura não é atribuída a ela', () => {
  // Outra tentativa, depois do ato. Atribuí-la seria afirmar um fato falso.
  const achado = recuperarCanal(assinante(), [
    v({ canal: 'sms', verificadoEm: '2026-08-29T05:00:00.000Z' }),
  ]);
  assert.equal(achado, null);
});

test('quem já tem canal gravado pelo servidor não é tocado', () => {
  const achado = recuperarCanal(assinante({ auth_verified_channel: 'sms' }), [v()]);
  assert.equal(achado, null, 'o registro do servidor manda; recuperar por cima seria sobrescrever prova');
});

test('verificação de OUTRO signatário nunca é aproveitada', () => {
  const achado = recuperarCanal(assinante(), [v({ signerId: 'outro-signatario' })]);
  assert.equal(achado, null);
});

test('sem verificação nenhuma, o relatório continua sem afirmar canal', () => {
  assert.equal(recuperarCanal(assinante(), []), null);
});

test('sem instante de assinatura não dá para dizer o que veio antes', () => {
  assert.equal(recuperarCanal(assinante({ signed_at: null }), [v()]), null);
});

test('data inválida não vira canal', () => {
  assert.equal(recuperarCanal(assinante({ signed_at: 'nao-e-data' }), [v()]), null);
  assert.equal(recuperarCanal(assinante(), [v({ verificadoEm: 'nao-e-data' })]), null);
});

test('identificador vazio não vira prova', () => {
  assert.equal(recuperarCanal(assinante(), [v({ identificador: '  ' })]), null);
});

test('comCanalRecuperado devolve cópia preenchida, sem mutar a original', () => {
  const original = assinante();
  const enriquecido = comCanalRecuperado(original, [v()]) as Record<string, unknown>;

  assert.equal(enriquecido.auth_verified_channel, 'whatsapp');
  assert.equal(enriquecido.auth_verified_identifier, '5565984046375');
  assert.equal(enriquecido.auth_verified_at, '2026-08-29T03:18:24.660Z');
  assert.equal(original.auth_verified_channel, null, 'a original não pode ser mutada');
});

test('quem não precisa de recuperação volta idêntico', () => {
  const original = assinante({ auth_verified_channel: 'whatsapp' });
  assert.equal(comCanalRecuperado(original, [v()]), original);
});

test('canal de e-mail também é recuperado', () => {
  const achado = recuperarCanal(assinante(), [
    v({ canal: 'email', identificador: 'maria@exemplo.com' }),
  ]);
  assert.equal(achado?.canal, 'email');
  assert.equal(achado?.identificador, 'maria@exemplo.com');
});
