import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autenticacaoDaFicha,
  contatoDaFicha,
  fichaDaLinha,
  identidadeParaACapa,
  provasDoSignatario,
  type LinhaDeSignatarioNoLaudo,
} from './dossieDoSignatario.ts';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';

const linha = (extra: Partial<LinhaDeSignatarioNoLaudo> = {}): LinhaDeSignatarioNoLaudo => ({
  id: 's1',
  name: 'Pedro Rodrigues',
  signed_at: '2026-09-02T23:34:00.000Z',
  ...extra,
});

const valorDe = (ficha: [string, string][], rotulo: string) =>
  ficha.find(([r]) => r === rotulo)?.[1];

// ── A capa ──────────────────────────────────────────────────────────────────

test('a primeira prova é sempre o ATO, e o aparelho é sempre o último', () => {
  const provas = provasDoSignatario(linha({
    auth_provider: 'phone', phone: '65984046375',
    signer_ip: '200.1.2.3',
    signer_geolocation: '-15.6, -56.0|Cuiabá - MT',
    facial_image_path: 'selfies/s1.jpg',
    signer_user_agent: UA_IPHONE,
  }));
  assert.equal(provas[0], 'Assinatura manuscrita digital');
  assert.match(provas[provas.length - 1], /^Dispositivo: /);
});

test('sem confirmação do servidor o método é DESCRITO, nunca dado por verificado', () => {
  const provas = provasDoSignatario(linha({ auth_provider: 'phone', phone: '65984046375' }));
  const frase = provas.find((p) => /Autenticação/.test(p))!;
  assert.match(frase, /código enviado ao número/);
  assert.ok(!/whatsapp/i.test(frase));
  assert.ok(!/\bSMS\b/.test(frase));
});

test('com confirmação, o canal entra na capa — e o Google ID vira linha própria', () => {
  const { frase, googleId } = identidadeParaACapa(linha({
    auth_provider: 'google',
    auth_google_sub: '11827364550',
    auth_verified_channel: 'google',
    auth_verified_identifier: 'pedro@escritorio.adv.br',
  }));
  assert.match(frase!, /conta Google pedro@escritorio\.adv\.br/);
  assert.equal(googleId, '11827364550');

  const provas = provasDoSignatario(linha({
    auth_provider: 'google',
    auth_google_sub: '11827364550',
    auth_verified_channel: 'google',
    auth_verified_identifier: 'pedro@escritorio.adv.br',
  }));
  assert.ok(provas.includes('Google ID: 11827364550'));
});

test('assinatura antiga, sem provedor nenhum, não ganha frase inventada', () => {
  const provas = provasDoSignatario(linha());
  assert.deepEqual(provas, ['Assinatura manuscrita digital']);
});

test('sem selfie não se afirma verificação facial', () => {
  const provas = provasDoSignatario(linha({ signer_user_agent: UA_IPHONE }));
  assert.ok(!provas.includes('Verificação facial (selfie)'));
});

// ── A ficha ─────────────────────────────────────────────────────────────────

test('o identificador CONFIRMADO vence qualquer contato declarado', () => {
  const contato = contatoDaFicha(linha({
    auth_provider: 'phone',
    phone: '65911112222',
    email: 'digitado@exemplo.com',
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565984046375',
  }));
  assert.equal(contato, '+55 (65) 98404-6375');
});

test('o e-mail interno do fluxo público não vira contato', () => {
  assert.equal(contatoDaFicha(linha({ email: 'public+abc@crm.local' })), '—');
});

test('a ficha traz os dez campos, na ordem, e "Assinar" vira "Signatário"', () => {
  const ficha = fichaDaLinha(linha({ role: 'Assinar' }), '02/09/2026, 20:34:00');
  assert.deepEqual(ficha.map(([r]) => r), [
    'Nome', 'Papel', 'Contato', 'CPF', 'Endereço IP',
    'Localização', 'Dispositivo', 'Autenticação', 'Termos de Uso', 'Assinado em',
  ]);
  assert.equal(valorDe(ficha, 'Papel'), 'Signatário');
  assert.equal(valorDe(ficha, 'Assinado em'), '02/09/2026, 20:34:00');
});

test('o papel de verdade é preservado', () => {
  const ficha = fichaDaLinha(linha({ role: 'Contratante' }), 'x');
  assert.equal(valorDe(ficha, 'Papel'), 'Contratante');
});

test('capa e ficha descrevem o aparelho DIFERENTE — e é assim no cliente', () => {
  // Não é engano do porte: a capa monta `aparelho - navegador - sistema` e a
  // ficha monta `navegador · sistema · aparelho`. Uniformizar mudaria o
  // conteúdo do laudo, o que é decisão de quem aprova, não efeito colateral.
  const s = linha({ signer_user_agent: UA_IPHONE });
  const naCapa = provasDoSignatario(s).find((p) => p.startsWith('Dispositivo: '));
  const naFicha = valorDe(fichaDaLinha(s, 'x'), 'Dispositivo');
  assert.equal(naCapa, 'Dispositivo: iPhone - Safari - macOS');
  assert.equal(naFicha, 'Safari · macOS · iPhone');
});

test('sem termos aceitos a ficha diz travessão, não inventa aceite', () => {
  assert.equal(valorDe(fichaDaLinha(linha(), 'x'), 'Termos de Uso'), '—');
  const comTermos = fichaDaLinha(
    linha({ terms_accepted_at: '2026-09-02T23:33:00.000Z', terms_version: 'v2' }), 'x');
  assert.equal(valorDe(comTermos, 'Termos de Uso'), 'Aceitos · versão v2');
});

test('a linha "Autenticação" da ficha é resumo, e some quando não há provedor', () => {
  assert.equal(autenticacaoDaFicha(linha()), 'Assinatura direta');
  assert.equal(
    autenticacaoDaFicha(linha({ auth_provider: 'email_link', auth_email: 'a@b.c' })),
    'E-mail (a@b.c)',
  );
  assert.match(
    autenticacaoDaFicha(linha({
      auth_verified_channel: 'sms', auth_verified_identifier: '5565984046375',
    })),
    /via SMS \(\+55 \(65\) 98404-6375\)/,
  );
});
