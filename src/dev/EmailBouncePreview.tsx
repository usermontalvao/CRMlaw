// DEV-ONLY: harness visual do tratamento de devolução de e-mail (?emailbounce=1).
//
// Renderiza o componente real (BounceNotice) alimentado pelo parser real
// (detectBounce) usando a devolução que o escritório recebeu em 04/08/2026 —
// mais os casos vizinhos (atraso, caixa cheia) e os avisos do compose.
import BounceNotice from '../components/email/BounceNotice';
import { detectBounce, findAddressIssues } from '../utils/emailDelivery';

const BOUNCE_REAL = `This is the mail system at host relay.mailchannels.net.

I'm sorry to have to inform you that your message could not
be delivered to one or more recipients. It's attached below.

                   The mail system

<usermontalvoa@gmail.com>: host gmail-smtp-in.l.google.com[142.250.99.27] said:
    550-5.1.1 The email account that you tried to reach does not exist. Please
    try 550-5.1.1 double-checking the recipient's email address for typos or
    550-5.1.1 unnecessary spaces.

Reporting-MTA: dns; relay.mailchannels.net
X-Postfix-Sender: rfc822; pedro@advcuiaba.com

Final-Recipient: rfc822; usermontalvoa@gmail.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.`;

const CASES: { title: string; from: string; subject: string; body: string }[] = [
  {
    title: 'Endereço inexistente (5.1.1) — o caso real',
    from: 'MAILER-DAEMON@mailchannels.net',
    subject: 'Undelivered Mail Returned to Sender',
    body: BOUNCE_REAL,
  },
  {
    title: 'Caixa cheia (5.2.2)',
    from: 'postmaster@exemplo.com',
    subject: 'Undeliverable',
    body: 'Final-Recipient: rfc822; cliente@exemplo.com\nAction: failed\nStatus: 5.2.2\nDiagnostic-Code: smtp; 552 mailbox full',
  },
  {
    title: 'Atraso temporário (4.4.1)',
    from: 'MAILER-DAEMON@advcuiaba.com',
    subject: 'Delivery Status Notification (Delay)',
    body: 'Final-Recipient: rfc822; cliente@exemplo.com\nAction: delayed\nStatus: 4.4.1',
  },
  {
    title: 'Bloqueio por política (5.7.1)',
    from: 'MAILER-DAEMON@advcuiaba.com',
    subject: 'Undelivered Mail Returned to Sender',
    body: 'Final-Recipient: rfc822; contato@empresa.com\nAction: failed\nStatus: 5.7.1\nDiagnostic-Code: smtp; 550 5.7.1 Message rejected due to policy',
  },
];

const COMPOSE_SAMPLES = ['cliente@gmial.com', 'fulano@hotmail.con', 'contato@empresa', 'certo@gmail.com'];

export default function EmailBouncePreview() {
  const issues = findAddressIssues(COMPOSE_SAMPLES);

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-[18px] font-medium text-zinc-900">Devolução de e-mail — harness</h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Faixa mostrada no topo da mensagem devolvida e avisos do compose.
          </p>
        </header>

        <section className="rounded-2xl border border-[#ece7dc] bg-white p-4">
          <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-zinc-400">
            Em "Enviados": a mensagem que voltou
          </div>
          {(() => {
            const report = detectBounce({ fromAddress: 'MAILER-DAEMON@mailchannels.net', bodyText: BOUNCE_REAL });
            if (!report) return <div className="text-[13px] text-red-600">detectBounce retornou null.</div>;
            return (
              <BounceNotice
                report={report}
                context="sent"
                onResend={(failed) => alert(`Reenviar para: ${failed.join(', ')}`)}
                onOpenReport={() => alert('Abriria o relatório do MAILER-DAEMON')}
              />
            );
          })()}
          <div className="text-[13px] text-zinc-500">
            assunto "teste" · para usermontalvoa@gmail.com · 19:23
          </div>
        </section>

        {CASES.map((c) => {
          const report = detectBounce({ fromAddress: c.from, subject: c.subject, bodyText: c.body });
          return (
            <section key={c.title} className="rounded-2xl border border-[#ece7dc] bg-white p-4">
              <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-zinc-400">{c.title}</div>
              {report
                ? <BounceNotice report={report} onResend={(failed) => alert(`Reenviar para: ${failed.join(', ')}`)} />
                : <div className="text-[13px] text-red-600">detectBounce retornou null — não reconheceu a devolução.</div>}
              <div className="mb-1 text-[12px] text-zinc-400">de {c.from} · {c.subject}</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 font-mono text-[11px] text-zinc-600">
                {c.body}
              </pre>
            </section>
          );
        })}

        <section className="rounded-2xl border border-[#ece7dc] bg-white p-4">
          <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-zinc-400">
            Avisos do compose (antes de enviar)
          </div>
          <div className="mb-2 text-[12px] text-zinc-500">Destinatários: {COMPOSE_SAMPLES.join(', ')}</div>
          {issues.length === 0
            ? <div className="text-[13px] text-red-600">Nenhum aviso — esperado pelo menos 3.</div>
            : (
              <ul className="space-y-1 text-[13px] text-amber-800">
                {issues.map((issue) => <li key={issue.address}>• {issue.message}</li>)}
              </ul>
            )}
          <p className="mt-3 text-[12px] text-zinc-400">
            "certo@gmail.com" não deve aparecer na lista.
          </p>
        </section>
      </div>
    </div>
  );
}
