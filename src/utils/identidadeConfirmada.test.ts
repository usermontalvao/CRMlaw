import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lerIdentidadeConfirmada,
  rotuloIdentidadeConfirmada,
  fraseIdentidadeConfirmada,
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
  assert.match(rotuloIdentidadeConfirmada(email!), /por e-mail para cliente@exemplo\.com/);

  const google = lerIdentidadeConfirmada({
    auth_verified_channel: 'google',
    auth_verified_identifier: 'cliente@gmail.com',
  });
  assert.equal(rotuloIdentidadeConfirmada(google!), 'Conta Google autenticada: cliente@gmail.com');
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
    'Código de verificação enviado por WhatsApp para +55 (65) 99999-8888, informado corretamente',
  );
  assert.equal(
    fraseIdentidadeConfirmada(wa),
    'Identidade confirmada por código de verificação enviado por WhatsApp para +55 (65) 99999-8888',
  );
  assert.ok(!rotuloIdentidadeConfirmada(wa).includes('*'), 'o número não pode sair mascarado');
  assert.equal(wa.em, '2026-08-28T12:00:00Z');
});
