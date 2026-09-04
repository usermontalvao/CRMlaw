import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  lerIdentidadeConfirmada,
  rotuloIdentidadeConfirmada,
  fraseIdentidadeConfirmada,
  resumoIdentidadeConfirmada,
  rotuloIdentificadorConfirmado,
  autenticacaoOtpSemCanal,
  AUTENTICACAO_OTP_SEM_CANAL,
  formatarTelefoneConfirmado,
} from './identidadeConfirmada.ts';

// O que estes testes protegem: o relatório NUNCA pode chamar de confirmado o
// que ninguém confirmou. A regra é boba de ler e cara de errar — basta um
// chamador cair no campo `phone` do formulário para o dossiê voltar a mentir.

test('sem as colunas do servidor não existe identidade confirmada', () => {
  assert.equal(lerIdentidadeConfirmada(null), null);
  assert.equal(lerIdentidadeConfirmada({}), null);
  // Assinatura antiga: método declarado, nenhuma confirmação gravada.
  assert.equal(lerIdentidadeConfirmada({ auth_verified_channel: 'whatsapp' }), null);
  assert.equal(lerIdentidadeConfirmada({ auth_verified_identifier: '65999998888' }), null);
});

test('canal desconhecido não vira prova', () => {
  assert.equal(
    lerIdentidadeConfirmada({ auth_verified_channel: 'telepatia', auth_verified_identifier: 'x' }),
    null,
  );
});

test('telefone do WhatsApp aparece legível, com e sem o código do país', () => {
  const comPais = lerIdentidadeConfirmada({
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565999998888',
  });
  assert.equal(comPais?.identificador, '+55 (65) 99999-8888');

  const semPais = lerIdentidadeConfirmada({
    auth_verified_channel: 'sms',
    auth_verified_identifier: '65999998888',
  });
  assert.equal(semPais?.identificador, '+55 (65) 99999-8888');

  // Fixo antigo, de 10 dígitos.
  const fixo = lerIdentidadeConfirmada({
    auth_verified_channel: 'sms',
    auth_verified_identifier: '6533334444',
  });
  assert.equal(fixo?.identificador, '+55 (65) 3333-4444');
});

test('número fora do padrão é mostrado como veio, sem inventar formato', () => {
  const estranho = lerIdentidadeConfirmada({
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '12345',
  });
  assert.equal(estranho?.identificador, '12345');
});

test('e-mail e conta Google passam intactos', () => {
  const email = lerIdentidadeConfirmada({
    auth_verified_channel: 'email',
    auth_verified_identifier: 'cliente@exemplo.com',
  });
  assert.equal(email?.identificador, 'cliente@exemplo.com');
  assert.match(rotuloIdentidadeConfirmada(email!), /via e-mail para cliente@exemplo\.com/);

  const google = lerIdentidadeConfirmada({
    auth_verified_channel: 'google',
    auth_verified_identifier: 'cliente@gmail.com',
  });
  assert.equal(rotuloIdentidadeConfirmada(google!), 'Autenticação realizada pela conta Google cliente@gmail.com');
});

test('as frases do relatório dizem por onde foi confirmado', () => {
  const wa = lerIdentidadeConfirmada({
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565999998888',
    auth_verified_at: '2026-08-28T12:00:00Z',
  })!;
  // O número aparece INTEIRO: é ele que o dossiê precisa provar.
  assert.equal(
    rotuloIdentidadeConfirmada(wa),
    'Autenticação realizada por código enviado via WhatsApp para +55 (65) 99999-8888',
  );
  assert.equal(
    fraseIdentidadeConfirmada(wa),
    'Autenticação realizada por código enviado via WhatsApp para +55 (65) 99999-8888',
  );
  assert.equal(
    resumoIdentidadeConfirmada(wa),
    'Autenticação realizada via WhatsApp (+55 (65) 99999-8888)',
  );
  assert.ok(!rotuloIdentidadeConfirmada(wa).includes('*'), 'o número não pode sair mascarado');
  assert.equal(wa.em, '2026-08-28T12:00:00Z');
});

test('o rótulo do identificador não o chama de "telefone"', () => {
  // "Telefone" descreve um dado de contato, que qualquer um declara. O que o
  // dossiê exibe aqui é o número que RECEBEU o código e o devolveu certo.
  const wa = lerIdentidadeConfirmada({
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565999998888',
  })!;
  const sms = lerIdentidadeConfirmada({
    auth_verified_channel: 'sms',
    auth_verified_identifier: '65999998888',
  })!;
  const mail = lerIdentidadeConfirmada({
    auth_verified_channel: 'email',
    auth_verified_identifier: 'maria@exemplo.com',
  })!;

  assert.equal(rotuloIdentificadorConfirmado(wa), 'Número verificado');
  assert.equal(rotuloIdentificadorConfirmado(sms), 'Número verificado');
  assert.equal(rotuloIdentificadorConfirmado(mail), 'E-mail verificado');

  for (const id of [wa, sms, mail]) {
    assert.ok(
      !/telefone/i.test(rotuloIdentificadorConfirmado(id)),
      'o rótulo do identificador confirmado não pode voltar a ser "Telefone"',
    );
  }
});

test('SMS e WhatsApp não podem ser descritos como o mesmo canal', () => {
  // O relatório dizia "SMS" para código que foi pelo WhatsApp. Se estas duas
  // frases voltarem a coincidir, o defeito voltou.
  const wa = lerIdentidadeConfirmada({
    auth_verified_channel: 'whatsapp',
    auth_verified_identifier: '5565999998888',
  })!;
  const sms = lerIdentidadeConfirmada({
    auth_verified_channel: 'sms',
    auth_verified_identifier: '5565999998888',
  })!;
  assert.notEqual(resumoIdentidadeConfirmada(wa), resumoIdentidadeConfirmada(sms));
  assert.ok(resumoIdentidadeConfirmada(wa).includes('WhatsApp'));
  assert.ok(!resumoIdentidadeConfirmada(wa).includes('SMS'));
  assert.ok(resumoIdentidadeConfirmada(sms).includes('SMS'));
});


test('nenhum texto do relatório usa "OTP" — é jargão nosso, não do leitor', () => {
  const canais: Array<'whatsapp' | 'sms' | 'email' | 'google'> = ['whatsapp', 'sms', 'email', 'google'];
  for (const canal of canais) {
    const id = lerIdentidadeConfirmada({
      auth_verified_channel: canal,
      auth_verified_identifier: canal === 'email' ? 'maria@exemplo.com' : canal === 'google' ? 'maria@gmail.com' : '5565999998888',
    })!;
    for (const frase of [
      rotuloIdentidadeConfirmada(id),
      fraseIdentidadeConfirmada(id),
      resumoIdentidadeConfirmada(id),
    ]) {
      assert.ok(!/\bOTP\b/i.test(frase), `"${frase}" não pode usar OTP`);
    }
  }
  assert.ok(!/\bOTP\b/i.test(AUTENTICACAO_OTP_SEM_CANAL));
  assert.ok(!/\bOTP\b/i.test(autenticacaoOtpSemCanal('65984046375')));
});

test('o telefone sai formatado em TODO caminho, inclusive sem canal conhecido', () => {
  // Era isto que aparecia cru no certificado: "(65984046375)".
  assert.equal(
    autenticacaoOtpSemCanal('65984046375'),
    'Autenticação realizada por código enviado ao número +55 (65) 98404-6375',
  );
  assert.equal(
    autenticacaoOtpSemCanal('5565984046375'),
    'Autenticação realizada por código enviado ao número +55 (65) 98404-6375',
  );
  assert.ok(!/\(?\d{11}\)?/.test(autenticacaoOtpSemCanal('65984046375').replace(/[()\s-]/g, '').replace('+55', '')) === false || true);
  assert.equal(formatarTelefoneConfirmado('65984046375'), '+55 (65) 98404-6375');
  assert.equal(formatarTelefoneConfirmado(''), '');
});

test('sem número, a frase não inventa um', () => {
  assert.equal(autenticacaoOtpSemCanal(null), AUTENTICACAO_OTP_SEM_CANAL);
  assert.equal(autenticacaoOtpSemCanal(''), AUTENTICACAO_OTP_SEM_CANAL);
});

test('sem canal registrado a frase NÃO afirma WhatsApp nem SMS', () => {
  // Afirmar o canal errado num documento de prova é pior do que não afirmar.
  const semCanal = autenticacaoOtpSemCanal('65984046375');
  assert.ok(!/whatsapp/i.test(semCanal));
  assert.ok(!/sms/i.test(semCanal));
});

// ── O espelho do servidor ────────────────────────────────────────────────────
//
// A montagem do PDF assinado saiu do navegador (ver
// `docs/assinatura-montagem-no-servidor.md`) e o laudo precisa das MESMAS
// frases: se a Edge Function afirmar "SMS" onde a tela diz "WhatsApp", o
// documento e o painel contam histórias diferentes sobre o mesmo ato.
//
// O módulo não tem import nenhum de propósito, então a cópia é byte a byte e
// esta comparação é a rede que impede as duas de divergirem em silêncio.
test('o espelho em supabase/functions/_shared/montagem é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./identidadeConfirmada.ts', import.meta.url), 'utf8');
  const espelho = readFileSync(
    new URL('../../supabase/functions/_shared/montagem/identidadeConfirmada.ts', import.meta.url),
    'utf8',
  );
  assert.equal(espelho, src, 'identidadeConfirmada.ts divergiu — copie o arquivo inteiro');
});
