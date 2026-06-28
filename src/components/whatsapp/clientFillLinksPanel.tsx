import React, { useState } from 'react';
import { FileText, Check, Link2, CheckCircle, Eye, X, Clock } from 'lucide-react';
import { useToastContext } from '../../contexts/ToastContext';
import { signatureService } from '../../services/signature.service';
import { buildPublicFillUrl } from '../../utils/publicAppUrl';
import { formatTime, lastSeenLabel } from './format';

/**
 * Painel de "Acompanhamento do kit": lista os links de preenchimento/assinatura
 * ainda em aberto do cliente, com o estágio atual de cada um (enviado, aberto,
 * preenchido, assinado, recusado…) e atalhos para copiar/reenviar. Componente de
 * apresentação puro — todo o estado vem por props; só guarda o feedback de "copiado".
 */
export const ClientFillLinksPanel: React.FC<{
  links: import('../../services/whatsapp/shared').ClientTemplateFillLink[] | null;
  signatures: import('../../types/signature.types').SignatureRequestWithSigners[] | null;
  onStopTracking?: (linkId: string) => void;
}> = ({ links, signatures, onStopTracking }) => {
  const toast = useToastContext();
  const list = (links ?? []).filter((l) => {
    if (l.followup_stopped || l.status === 'cancelled' || l.status === 'expired') return false;
    const req = (signatures ?? []).find(s => s.id === l.signature_request_id);
    if (!req) return true;
    if (req.status === 'signed' || req.status === 'refused' || req.signed_at) return false;
    if ((req.signers ?? []).some(sg => !!sg.signed_at || !!sg.refused_at)) return false;
    return true;
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  if (list.length === 0) return null;

  const copyText = async (key: string, label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(label);
      setTimeout(() => setCopiedKey(curr => (curr === key ? null : curr)), 1800);
    } catch (e: any) {
      toast.error('Não foi possível copiar o link', e?.message);
    }
  };

  const now = Date.now();

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
        <FileText size={10} /> Acompanhamento do kit
        <span className="ml-auto px-1.5 py-px rounded-full bg-sky-100 text-sky-700 text-[9px] font-bold">{list.length}</span>
      </p>
      <div className="rounded-xl border border-[#e7e5df] divide-y divide-[#f1f0ec] overflow-hidden">
        {list.map((link) => {
          const req = (signatures ?? []).find(s => s.id === link.signature_request_id) ?? null;
          const signer = req?.signers?.find(sg => sg.status !== 'signed' && !sg.refused_at) ?? req?.signers?.[0] ?? null;
          const fillUrl = buildPublicFillUrl(link.public_token);
          const signUrl = signer?.public_token ? signatureService.generatePublicSigningUrl(signer.public_token) : null;
          const activeOnPage = !!link.last_seen_at && (now - new Date(link.last_seen_at).getTime() <= 30_000);

          let stageLabel = 'Link enviado';
          let stageTone = 'bg-slate-100 text-slate-600';
          let stageDetail = `Enviado ${formatTime(link.created_at)}`;
          let stageIcon: 'check' | 'eye' | 'x' | 'clock' = 'clock';

          if (signer?.signed_at || req?.status === 'signed') {
            stageLabel = 'Assinado';
            stageTone = 'bg-emerald-100 text-emerald-700';
            stageDetail = `Assinado ${formatTime(signer?.signed_at || req?.signed_at || link.submitted_at || link.created_at)}`;
            stageIcon = 'check';
          } else if (signer?.refused_at || req?.status === 'refused') {
            stageLabel = 'Recusado';
            stageTone = 'bg-rose-100 text-rose-700';
            stageDetail = `Recusado ${formatTime(signer?.refused_at || link.submitted_at || link.created_at)}`;
            stageIcon = 'x';
          } else if (signer?.last_seen_at && (now - new Date(signer.last_seen_at).getTime() <= 30_000)) {
            stageLabel = 'Página de assinatura aberta';
            stageTone = 'bg-sky-100 text-sky-700';
            stageDetail = 'Está na tela de assinatura agora';
            stageIcon = 'eye';
          } else if (signer?.viewed_at || signer?.opened_at) {
            stageLabel = 'Saiu sem assinar';
            stageTone = 'bg-orange-100 text-orange-700';
            stageDetail = `Abriu e saiu sem assinar — ${lastSeenLabel(signer.last_seen_at || signer.opened_at || signer.viewed_at || link.created_at)}`;
            stageIcon = 'eye';
          } else if (link.submitted_at || req) {
            stageLabel = 'Preenchido';
            stageTone = 'bg-amber-100 text-amber-700';
            stageDetail = `Preencheu e foi para assinatura ${formatTime(link.submitted_at || req?.created_at || link.created_at)}`;
            stageIcon = 'clock';
          } else if (activeOnPage) {
            stageLabel = 'Na tela agora';
            stageTone = 'bg-violet-100 text-violet-700';
            stageDetail = 'Ativo no formulário agora';
            stageIcon = 'eye';
          } else if (link.last_seen_at) {
            // Já saiu da tela — mostra "visto por último" em vez de travar em "aberta".
            stageLabel = 'Saiu da página';
            stageTone = 'bg-blue-100 text-blue-700';
            stageDetail = `Abriu o formulário ${formatTime(link.opened_at || link.last_seen_at)} — ${lastSeenLabel(link.last_seen_at)}`;
            stageIcon = 'eye';
          } else if (link.opened_at) {
            stageLabel = 'Página aberta';
            stageTone = 'bg-blue-100 text-blue-700';
            stageDetail = `Abriu o formulário ${formatTime(link.opened_at)}`;
            stageIcon = 'eye';
          }

          return (
            <div key={link.id} className="px-3 py-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-800 truncate">{link.template_name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{stageDetail}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] font-semibold ${stageTone}`}>
                    {stageIcon === 'check' ? <CheckCircle size={9} /> : stageIcon === 'eye' ? <Eye size={9} /> : stageIcon === 'x' ? <X size={9} /> : <Clock size={9} />}
                    {stageLabel}
                  </span>
                  {onStopTracking && (
                    <button
                      onClick={() => onStopTracking(link.id)}
                      title="Parar de acompanhar este link e interromper os lembretes automáticos"
                      className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-500 hover:bg-rose-600 hover:text-white transition"
                    >
                      <X size={11} strokeWidth={2.75} />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-slate-400 w-14 flex-shrink-0">Preencher</span>
                  <input readOnly value={fillUrl} className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[#e7e5df] bg-slate-50 text-[10.5px] text-slate-500" />
                  <button
                    onClick={() => copyText(`fill:${link.id}`, 'Link de preenchimento copiado.', fillUrl)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 transition"
                  >
                    {copiedKey === `fill:${link.id}` ? <Check size={11} /> : <Link2 size={11} />}
                    {copiedKey === `fill:${link.id}` ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                {signUrl && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-slate-400 w-14 flex-shrink-0">Assinar</span>
                    <input readOnly value={signUrl} className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[#e7e5df] bg-amber-50 text-[10.5px] text-amber-700" />
                    <button
                      onClick={() => copyText(`sign:${link.id}`, 'Link de assinatura copiado.', signUrl)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition"
                    >
                      {copiedKey === `sign:${link.id}` ? <Check size={11} /> : <Link2 size={11} />}
                      {copiedKey === `sign:${link.id}` ? 'Copiado' : 'Reenviar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
