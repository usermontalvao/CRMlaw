import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMISSOR_DO_SISTEMA,
  montarTrilhaDeEventos,
  resumoDeAutenticacaoDaTrilha,
  sufixoDeContatoDoSignatario,
  type LinhaDeAuditoria,
  type LinhaDeSignatario,
} from './trilhaDeEventos.ts';

const urlDosTermos = (v: string) => `https://jurius.com.br/#/termos-assinatura/${v}`;

const base = (extra: Partial<LinhaDeSignatario> = {}): LinhaDeSignatario => ({
  id: 's1',
  name: 'Pedro Rodrigues',
  cpf: '045.448.031-93',
  signed_at: '2026-09-02T23:34:00.000Z',
  ...extra,
});

const montar = (
  signatarios: LinhaDeSignatario[],
  auditoria: LinhaDeAuditoria[] = [],
  extra: { criadoEm?: string; nomeDoEmissor?: string | null } = {},
) => montarTrilhaDeEventos({
  criadoEm: extra.criadoEm ?? '2026-09-02T23:30:00.000Z',
  nomeDoEmissor: extra.nomeDoEmissor,
  signatarios,
  auditoria,
  urlDosTermos,
});

const rotulos = (eventos: { rotulo: string }[]) => eventos.map((e) => e.rotulo);

// ── O que a trilha AFIRMA ───────────────────────────────────────────────────

test('sem canal confirmado pelo servidor, a trilha não afirma WhatsApp nem SMS', () => {
  // A regra que mais importa deste módulo: um laudo que diz "código enviado via
  // WhatsApp" sem que o servidor tenha registrado o canal está afirmando mais
  // do que provou, num documento que pode ir a juízo.
  const frase = resumoDeAutenticacaoDaTrilha(base({ auth_provider: 'phone', phone: '65984046375' }));
  assert.ok(!/whatsapp/i.test(frase), frase);
  assert.ok(!/\bSMS\b/.test(frase), frase);
  assert.match(frase, /código enviado ao número/);
});

test('com o canal confirmado, a trilha diz qual foi', () => {
  const frase = resumoDeAutenticacaoDaTrilha(base({
    auth_provider: 'phone',
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565984046375',
  }));
  assert.match(frase, /via WhatsApp para \+55 \(65\) 98404-6375/);
});

test('Google confirmado leva o identificador externo junto', () => {
  const frase = resumoDeAutenticacaoDaTrilha(base({
    auth_provider: 'google',
    auth_google_sub: '118273645500192837465',
    auth_verified_channel: 'google',
    auth_verified_identifier: 'pedro@escritorio.adv.br',
  }));
  assert.match(frase, /Google ID: 118273645500192837465/);
});

test('identidade confirmada não repete o número entre parênteses', () => {
  // A frase de autenticação já diz o número; repetir deixa o evento com cara de
  // formulário preenchido duas vezes.
  const comConfirmacao = sufixoDeContatoDoSignatario(base({
    auth_provider: 'phone',
    phone: '65984046375',
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565984046375',
  }));
  assert.equal(comConfirmacao, '');

  const semConfirmacao = sufixoDeContatoDoSignatario(base({
    auth_provider: 'phone', phone: '65984046375',
  }));
  assert.equal(semConfirmacao, ' (Telefone informado: +55 (65) 98404-6375)');
});

test('o e-mail interno do fluxo público nunca vira contato no laudo', () => {
  const sufixo = sufixoDeContatoDoSignatario(base({ email: 'public+abc@crm.local' }));
  assert.equal(sufixo, '');
});

// ── A ordem ─────────────────────────────────────────────────────────────────

test('Termos jamais aparece depois de Assinado, nem gravado depois', () => {
  // O relógio do aparelho pode gravar o aceite com valor igual ou POSTERIOR ao
  // da assinatura (fuso, latência, ajuste manual). Um laudo que mostra a
  // assinatura antes do aceite é munição para a outra parte.
  const eventos = montar([base({
    signed_at: '2026-09-02T23:34:00.000Z',
    terms_accepted_at: '2026-09-02T23:34:02.000Z',
    terms_version: 'v1',
  })]);
  const ordem = rotulos(eventos);
  assert.ok(ordem.indexOf('Termos') < ordem.indexOf('Assinado'), ordem.join(' → '));
});

test('cada abertura da trilha de auditoria vira um cartão próprio', () => {
  const eventos = montar(
    [base({ viewed_at: '2026-09-02T23:31:00.000Z' })],
    [
      { signer_id: 's1', action: 'viewed', ip_address: '200.1.2.3', created_at: '2026-09-02T23:30:30.000Z' },
      { signer_id: 's1', action: 'viewed', ip_address: '200.1.2.3', created_at: '2026-09-02T23:31:10.000Z' },
      { signer_id: 's1', action: 'signed', created_at: '2026-09-02T23:34:00.000Z' },
      { signer_id: 'outro', action: 'viewed', created_at: '2026-09-02T23:32:00.000Z' },
    ],
  );
  assert.equal(rotulos(eventos).filter((r) => r === 'Visualizado').length, 2);
});

test('sem trilha de auditoria, o viewed_at do signatário é a reserva', () => {
  const eventos = montar([base({ viewed_at: '2026-09-02T23:31:00.000Z' })], []);
  assert.equal(rotulos(eventos).filter((r) => r === 'Visualizado').length, 1);
});

test('o agente de usuário vai INTEIRO para a trilha, não resumido', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1';
  const eventos = montar([base({ signer_user_agent: ua, viewed_at: '2026-09-02T23:31:00.000Z' })]);
  const assinado = eventos.find((e) => e.rotulo === 'Assinado');
  assert.ok(assinado?.detalhe.includes(ua), 'a cadeia crua é o dado; o resumo é cortesia');
});

// ── Presença e ausência de eventos ──────────────────────────────────────────

test('sem selfie não existe evento de biometria', () => {
  const semFoto = montar([base({ viewed_at: '2026-09-02T23:31:00.000Z' })]);
  assert.ok(!rotulos(semFoto).includes('Biometria facial'));

  const comFoto = montar([base({
    viewed_at: '2026-09-02T23:31:00.000Z',
    facial_image_path: 'selfies/s1.jpg',
    facial_captured_at: '2026-09-02T23:33:00.000Z',
  })]);
  assert.ok(rotulos(comFoto).includes('Biometria facial'));
});

test('sem coordenada não existe evento de localização', () => {
  const eventos = montar([base({ viewed_at: '2026-09-02T23:31:00.000Z' })]);
  assert.ok(!rotulos(eventos).includes('Localização'));
});

test('registro antigo sem instantes próprios ancora na primeira visualização', () => {
  // Aproximação, não invenção: o ato aconteceu DEPOIS de abrir o documento.
  const eventos = montar(
    [base({ signer_geolocation: '-15.6, -56.0|Cuiabá - MT' })],
    [{ signer_id: 's1', action: 'viewed', created_at: '2026-09-02T23:30:30.000Z' }],
  );
  const auth = eventos.find((e) => e.rotulo === 'Autenticação');
  const local = eventos.find((e) => e.rotulo === 'Localização');
  assert.equal(auth?.instante, new Date('2026-09-02T23:30:30.000Z').getTime());
  assert.equal(local?.instante, new Date('2026-09-02T23:30:30.000Z').getTime());
});

test('o instante REAL vence a âncora quando o servidor o registrou', () => {
  const eventos = montar(
    [base({ auth_at: '2026-09-02T23:32:00.000Z' })],
    [{ signer_id: 's1', action: 'viewed', created_at: '2026-09-02T23:30:30.000Z' }],
  );
  const auth = eventos.find((e) => e.rotulo === 'Autenticação');
  assert.equal(auth?.instante, new Date('2026-09-02T23:32:00.000Z').getTime());
});

test('envelope sem criador creditado nomeia o sistema, não deixa em branco', () => {
  const eventos = montar([base()], [], { nomeDoEmissor: null });
  const criado = eventos.find((e) => e.rotulo === 'Criado');
  assert.equal(criado?.detalhe, `Documento emitido por ${EMISSOR_DO_SISTEMA}.`);
});

test('dois signatários geram duas assinaturas, ordenadas pelo instante', () => {
  const eventos = montar([
    base({ id: 's2', name: 'Maria Souza', signed_at: '2026-09-03T12:00:00.000Z' }),
    base({ id: 's1', name: 'Pedro Rodrigues', signed_at: '2026-09-02T23:34:00.000Z' }),
  ]);
  const assinaturas = eventos.filter((e) => e.rotulo === 'Assinado');
  assert.equal(assinaturas.length, 2);
  assert.match(assinaturas[0].detalhe, /Pedro Rodrigues/);
  assert.match(assinaturas[1].detalhe, /Maria Souza/);
});

test('o link dos Termos leva a versão aceita, não a genérica', () => {
  const eventos = montar([base({
    terms_accepted_at: '2026-09-02T23:33:50.000Z', terms_version: 'v2',
  })]);
  const termos = eventos.find((e) => e.rotulo === 'Termos');
  assert.match(termos!.detalhe, /termos-assinatura\/v2/);
});
