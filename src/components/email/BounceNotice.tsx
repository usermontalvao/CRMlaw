import { MailX } from 'lucide-react';
import type { BounceReport } from '../../utils/emailDelivery';

/**
 * Faixa de devolução (bounce). Aparece em dois lugares:
 *  - no relatório do MAILER-DAEMON, traduzindo o motivo (`context="report"`);
 *  - na própria mensagem em Enviados que voltou (`context="sent"`) — sem isso
 *    o e-mail que falhou continua com cara de entregue, que é justamente como
 *    o erro passa despercebido.
 */
export default function BounceNotice({
  report,
  context = 'report',
  onResend,
  onOpenReport,
}: {
  report: BounceReport;
  context?: 'report' | 'sent';
  onResend?: (failed: string[]) => void;
  onOpenReport?: () => void;
}) {
  const soft = report.severity === 'soft';
  const title = soft
    ? 'Entrega atrasada'
    : context === 'sent'
      ? 'Esta mensagem não chegou ao destinatário'
      : 'Este e-mail não foi entregue';

  return (
    <div className={`mb-3 rounded-lg border px-3 py-2 text-[12px] ${soft ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <MailX className="h-4 w-4 flex-none" />
        <span className="font-medium">{title}</span>
        {report.statusCode && <span className="opacity-70">· código {report.statusCode}</span>}
      </div>
      {report.failedRecipients.length > 0 && (
        <div className="mt-1">
          <span className="opacity-70">Destinatário recusado: </span>
          <span className="break-all font-medium">{report.failedRecipients.join(', ')}</span>
        </div>
      )}
      <div className="mt-1">{report.reason}</div>
      {report.hint && <div className="mt-0.5 opacity-80">{report.hint}</div>}
      {(onResend && report.retryLabel && report.failedRecipients.length > 0) || onOpenReport ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {onResend && report.retryLabel && report.failedRecipients.length > 0 && (
            <button
              type="button"
              onClick={() => onResend(report.failedRecipients)}
              className="rounded-md border border-current px-2 py-0.5 hover:bg-white/40">
              {report.retryLabel}
            </button>
          )}
          {onOpenReport && (
            <button
              type="button"
              onClick={onOpenReport}
              className="rounded-md border border-current px-2 py-0.5 hover:bg-white/40">
              Ver relatório do servidor
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
