// Cobertura do reconhecimento de devolução (bounce) e da checagem de endereço
// antes do envio.
// Execução: `node --test --import ts-node/esm src/utils/emailDelivery.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BounceRecord } from './emailDelivery.ts';
import { detectBounce, findAddressIssue, findAddressIssues, matchBouncesToSent } from './emailDelivery.ts';

// Devolução real recebida em 04/08/2026 pelo relay do provedor de saída.
const BOUNCE_REAL = `This is the mail system at host relay.mailchannels.net.

I'm sorry to have to inform you that your message could not
be delivered to one or more recipients. It's attached below.

For further assistance, please send mail to postmaster.

                   The mail system

<usermontalvoa@gmail.com>: host gmail-smtp-in.l.google.com[142.250.99.27] said:
    550-5.1.1 The email account that you tried to reach does not exist. Please
    try 550-5.1.1 double-checking the recipient's email address for typos or
    550-5.1.1 unnecessary spaces. For more information, go to 550 5.1.1
    https://support.google.com/mail/?p=NoSuchUser
    d9443c01a7336-2d0aa22cdbdsi54919075ad.35 - gsmtp (in reply to RCPT TO
    command)

Reporting-MTA: dns; relay.mailchannels.net
X-Postfix-Queue-ID: E3A1A16247D
X-Postfix-Sender: rfc822; pedro@advcuiaba.com
Arrival-Date: Tue, 04 Aug 2026 23:23:46 +0000 (UTC)

Final-Recipient: rfc822; usermontalvoa@gmail.com
Original-Recipient: rfc822;usermontalvoa@gmail.com
Action: failed
Status: 5.1.1
Remote-MTA: dns; gmail-smtp-in.l.google.com
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does
    not exist.`;

test('devolução do MAILER-DAEMON é reconhecida e o destinatário recusado é extraído', () => {
  const report = detectBounce({
    fromAddress: 'MAILER-DAEMON@mailchannels.net',
    subject: 'Undelivered Mail Returned to Sender',
    bodyText: BOUNCE_REAL,
  });

  assert.ok(report, 'deveria reconhecer a devolução');
  assert.deepEqual(report.failedRecipients, ['usermontalvoa@gmail.com']);
  assert.equal(report.statusCode, '5.1.1');
  assert.equal(report.severity, 'hard');
  assert.match(report.reason, /não existe/);
  assert.match(report.hint ?? '', /digitação/);
});

test('o remetente original não entra na lista de recusados', () => {
  const report = detectBounce({ fromAddress: 'MAILER-DAEMON@mailchannels.net', bodyText: BOUNCE_REAL });
  assert.ok(report);
  assert.ok(!report.failedRecipients.includes('pedro@advcuiaba.com'));
});

test('caixa cheia vira falha definitiva com texto próprio', () => {
  const report = detectBounce({
    fromAddress: 'postmaster@exemplo.com',
    subject: 'Undeliverable',
    bodyText: 'Final-Recipient: rfc822; cliente@exemplo.com\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 mailbox full',
  });
  assert.ok(report);
  assert.equal(report.statusCode, '5.2.2');
  assert.match(report.reason, /caixa do destinatário está cheia/i);
});

test('falha 4.x.x é tratada como temporária', () => {
  const report = detectBounce({
    fromAddress: 'MAILER-DAEMON@advcuiaba.com',
    subject: 'Delivery Status Notification (Delay)',
    bodyText: 'Final-Recipient: rfc822; cliente@exemplo.com\nAction: delayed\nStatus: 4.4.1',
  });
  assert.ok(report);
  assert.equal(report.severity, 'soft');
  assert.match(report.reason, /temporária/i);
});

test('devolução em HTML também é lida', () => {
  const report = detectBounce({
    fromAddress: 'mailer-daemon@exemplo.com',
    subject: 'Mail delivery failed',
    bodyHtml: '<p>Final-Recipient: rfc822; cliente@exemplo.com</p><p>Action: failed</p><p>Status: 5.1.1</p>',
  });
  assert.ok(report);
  assert.deepEqual(report.failedRecipients, ['cliente@exemplo.com']);
});

test('e-mail comum não é confundido com devolução', () => {
  assert.equal(
    detectBounce({
      fromAddress: 'cliente@exemplo.com',
      subject: 'Sobre a audiência',
      bodyText: 'Doutor, a entrega dos documentos falhou ontem. Podemos remarcar?',
    }),
    null
  );
});

test('assunto de devolução sem relatório e sem daemon não basta', () => {
  assert.equal(
    detectBounce({
      fromAddress: 'cliente@exemplo.com',
      subject: 'Undeliverable: proposta',
      bodyText: 'Segue em anexo a proposta revisada.',
    }),
    null
  );
});

test('domínio grande escrito errado gera sugestão', () => {
  const issue = findAddressIssue('fulano@gmial.com');
  assert.ok(issue);
  assert.equal(issue.suggestion, 'fulano@gmail.com');

  assert.equal(findAddressIssue('fulano@hotmail.con')?.suggestion, 'fulano@hotmail.com');
  assert.equal(findAddressIssue('Nome <fulano@outlok.com>')?.suggestion, 'fulano@outlook.com');
});

test('endereço sem domínio completo ou com pontuação estranha é apontado', () => {
  assert.match(findAddressIssue('fulano@gmail')?.message ?? '', /domínio completo/);
  assert.match(findAddressIssue('fulano..silva@gmail.com')?.message ?? '', /ponto sobrando/);
  assert.equal(findAddressIssue('fulano@gmail.com.')?.suggestion, 'fulano@gmail.com');
  assert.match(findAddressIssue('a@b@gmail.com')?.message ?? '', /mais de um @/);
});

test('endereço correto não gera aviso', () => {
  assert.equal(findAddressIssue('usermontalvao@gmail.com'), null);
  assert.equal(findAddressIssue('pedro@advcuiaba.com'), null);
  assert.equal(findAddressIssue('contato@escritorio.adv.br'), null);
});

test('erro só na parte antes do @ não é detectável — fica para o aviso de destinatário novo', () => {
  // Foi exatamente este o caso da devolução real: domínio certo, usuário errado.
  assert.equal(findAddressIssue('usermontalvoa@gmail.com'), null);
});

test('lista de endereços não repete o mesmo aviso', () => {
  const issues = findAddressIssues(['a@gmial.com', 'A@GMIAL.COM', 'ok@gmail.com']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].suggestion, 'a@gmail.com');
});

test('o botão de reenvio só fala em corrigir endereço quando é o endereço que está errado', () => {
  const naoExiste = detectBounce({ fromAddress: 'MAILER-DAEMON@x.com', bodyText: BOUNCE_REAL });
  assert.equal(naoExiste?.retryLabel, 'Reenviar corrigindo o endereço');

  const cheia = detectBounce({
    fromAddress: 'MAILER-DAEMON@x.com',
    bodyText: 'Final-Recipient: rfc822; a@b.com\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 mailbox full',
  });
  assert.equal(cheia?.retryLabel, 'Escrever de novo para este endereço');

  // Falha temporária: o servidor retenta sozinho, reenviar na mão só duplica.
  const atraso = detectBounce({
    fromAddress: 'MAILER-DAEMON@x.com',
    bodyText: 'Final-Recipient: rfc822; a@b.com\nAction: delayed\nStatus: 4.4.1',
  });
  assert.equal(atraso?.retryLabel, null);
});

// --- ligação devolução → mensagem em "Enviados" ---------------------------

function bounceOf(bodyText: string, receivedAt: string, id = 'bounce-1'): BounceRecord {
  const report = detectBounce({ fromAddress: 'MAILER-DAEMON@mailchannels.net', bodyText });
  assert.ok(report, 'fixture deveria ser reconhecida como devolução');
  return { bounceMessageId: id, receivedAt, report };
}

test('a devolução marca o e-mail enviado para o endereço recusado', () => {
  // Cenário real: "teste" para o endereço com typo, e um envio antigo para o
  // endereço certo — só o primeiro pode ser marcado.
  const matches = matchBouncesToSent(
    [bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z')],
    [
      { id: 'sent-typo', subject: 'teste', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-04T23:23:40Z' },
      { id: 'sent-ok', subject: 'teste', recipients: ['usermontalvao@gmail.com'], sentAt: '2026-06-22T12:00:00Z' },
    ]
  );

  assert.equal(matches.size, 1);
  assert.ok(matches.has('sent-typo'));
  assert.equal(matches.get('sent-typo')?.report.statusCode, '5.1.1');
});

test('Message-ID original vence qualquer heurística', () => {
  const body = `${BOUNCE_REAL}\n\nMessage-ID: <original-123@advcuiaba.com>\nSubject: outro assunto`;
  const matches = matchBouncesToSent(
    [bounceOf(body, '2026-08-04T23:23:46Z')],
    [
      { id: 'certo', messageId: '<original-123@advcuiaba.com>', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-01T10:00:00Z' },
      { id: 'mais-recente', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-04T23:23:40Z' },
    ]
  );
  assert.deepEqual([...matches.keys()], ['certo']);
});

test('entre vários envios ao mesmo endereço, marca o último antes da devolução', () => {
  const matches = matchBouncesToSent(
    [bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z')],
    [
      { id: 'antigo', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-01T09:00:00Z' },
      { id: 'ultimo', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-04T23:23:40Z' },
      { id: 'posterior', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-05T08:00:00Z' },
    ]
  );
  assert.deepEqual([...matches.keys()], ['ultimo']);
});

test('envio fora da janela de 14 dias não é marcado', () => {
  const matches = matchBouncesToSent(
    [bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z')],
    [{ id: 'muito-antigo', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-05-01T09:00:00Z' }]
  );
  assert.equal(matches.size, 0);
});

test('sem destinatário em comum não marca nada', () => {
  const matches = matchBouncesToSent(
    [bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z')],
    [{ id: 'outro', recipients: ['cliente@exemplo.com'], sentAt: '2026-08-04T23:00:00Z' }]
  );
  assert.equal(matches.size, 0);
});

test('destinatário em cópia também conta', () => {
  const matches = matchBouncesToSent(
    [bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z')],
    [{ id: 'com-copia', recipients: ['cliente@exemplo.com', 'Nome <usermontalvoa@gmail.com>'], sentAt: '2026-08-04T23:23:40Z' }]
  );
  assert.deepEqual([...matches.keys()], ['com-copia']);
});

test('duas devoluções para envios diferentes marcam cada uma o seu', () => {
  const outro = 'Final-Recipient: rfc822; cliente@exemplo.com\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 mailbox full';
  const matches = matchBouncesToSent(
    [
      bounceOf(BOUNCE_REAL, '2026-08-04T23:23:46Z', 'b1'),
      bounceOf(outro, '2026-08-04T20:00:00Z', 'b2'),
    ],
    [
      { id: 'sent-a', recipients: ['usermontalvoa@gmail.com'], sentAt: '2026-08-04T23:23:40Z' },
      { id: 'sent-b', recipients: ['cliente@exemplo.com'], sentAt: '2026-08-04T19:00:00Z' },
    ]
  );
  assert.equal(matches.get('sent-a')?.bounceMessageId, 'b1');
  assert.equal(matches.get('sent-b')?.bounceMessageId, 'b2');
});
