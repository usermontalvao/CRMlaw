import React, { useEffect, useState } from 'react';
import { BrandLogo } from './ui';
import {
  ShieldCheck, ShieldAlert, Download, X, FileText, User, MapPin,
  Fingerprint, Clock, Hash, Link2, AlertTriangle,
} from 'lucide-react';
import { signatureService } from '../services/signature.service';

interface ForensicDossierProps {
  requestId: string;
  documentName?: string | null;
  onClose?: () => void;
}

const fmtFull = (d?: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : '—';

const fmtShort = (d?: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

const parseUA = (ua?: string | null) => {
  const s = ua || '';
  if (!s) return '—';
  const device = /iPad|Tablet/i.test(s) ? 'Tablet' : /Mobile|Android|iPhone/i.test(s) ? 'Mobile' : 'Desktop';
  const browser = /Edg\//i.test(s) ? 'Edge' : /OPR\//i.test(s) ? 'Opera' : /Firefox\//i.test(s) ? 'Firefox' : /Chrome\//i.test(s) ? 'Chrome' : /Safari\//i.test(s) ? 'Safari' : 'Navegador';
  const os = /Windows/i.test(s) ? 'Windows' : /Mac OS X/i.test(s) && !/iPhone|iPad/i.test(s) ? 'macOS' : /Android/i.test(s) ? 'Android' : /iPhone/i.test(s) ? 'iOS' : /iPad/i.test(s) ? 'iPadOS' : /Linux/i.test(s) ? 'Linux' : 'SO';
  return `${device} · ${browser} · ${os}`;
};

const mapsUrl = (geo?: string | null) => {
  const g = String(geo || '').trim();
  if (!g || !/-?\d/.test(g)) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(g)}`;
};

const authLabel = (method?: string | null, provider?: string | null) => {
  const parts: string[] = [];
  if (provider === 'google') parts.push('Conta Google');
  else if (provider === 'email_link') parts.push('Verificação por e-mail (OTP)');
  else if (provider === 'phone') parts.push('Verificação por telefone (OTP)');
  if (method === 'signature_facial' || method === 'signature_facial_document') parts.push('Biometria facial');
  if (method === 'signature_facial_document') parts.push('Documento com foto');
  if (!parts.length) parts.push('Assinatura eletrônica');
  return parts.join(' + ');
};

const Card: React.FC<{ title: string; icon?: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden break-inside-avoid" style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
    <div className="px-5 py-3.5 flex items-center gap-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
      <div className="w-[3px] h-[13px] rounded-full flex-shrink-0" style={{ background: '#ea580c' }} />
      {Icon && <Icon className="w-[14px] h-[14px]" style={{ color: '#94a3b8' }} />}
      <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#64748b' }}>{title}</span>
    </div>
    <div className="px-5 py-4">{children}</div>
  </div>
);

const Field: React.FC<{ label: React.ReactNode; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.08em]" style={{ color: '#94a3b8' }}>{label}</p>
    <div className={`text-[12.5px] leading-snug break-all ${mono ? 'font-mono' : 'font-medium'}`} style={{ color: '#0f172a' }}>{value ?? '—'}</div>
  </div>
);

const ForensicDossier: React.FC<ForensicDossierProps> = ({ requestId, documentName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const data = await signatureService.getForensicReport(requestId);
        if (!alive) return;
        if (!data) { setError('Envelope não encontrado ou sem permissão de acesso.'); return; }
        setReport(data);
      } catch (e) {
        if (alive) setError((e as Error)?.message || 'Falha ao gerar o dossiê.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [requestId]);

  const env = report?.envelope;
  const chain = report?.chain_integrity;
  const docs: any[] = report?.documents || [];
  const signers: any[] = report?.signers || [];
  const trail: any[] = report?.audit_trail || [];
  const verified = chain?.verified === true;

  return (
    <div className="min-h-screen print:bg-white" style={{ background: '#e8edf2' }}>
      {/* Barra de ações (não imprime) */}
      <div className="print:hidden sticky top-0 z-20" style={{ background: 'white', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,23,42,0.07)' }}>
        <div className="max-w-5xl mx-auto px-5 h-[52px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-[5px] h-[5px] rounded-full" style={{ background: '#ea580c' }} />
            <span className="text-[13px] font-bold" style={{ color: '#0f172a' }}>JURIUS</span>
            <span className="text-[12px]" style={{ color: '#94a3b8' }}>· Dossiê Probatório</span>
            <span className="hidden sm:inline text-[12px] truncate max-w-[280px]" style={{ color: '#cbd5e1' }}>· {documentName || env?.document_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} disabled={!report}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition disabled:opacity-40"
              style={{ background: '#ea580c' }}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Imprimir / PDF</span><span className="sm:hidden">PDF</span>
            </button>
            {onClose && (
              <button onClick={onClose} className="w-[30px] h-[30px] rounded-lg flex items-center justify-center transition" style={{ border: '1px solid #e2e8f0', color: '#94a3b8' }}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="max-w-5xl mx-auto px-6 py-24 text-center text-[13px]" style={{ color: '#64748b' }}>Montando o dossiê probatório…</div>
      )}
      {error && !loading && (
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: '#dc2626' }} />
          <p className="text-[13px] font-medium" style={{ color: '#0f172a' }}>{error}</p>
        </div>
      )}

      {report && !loading && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 print:p-0 print:max-w-none">
          {/* Cabeçalho */}
          <div className="rounded-2xl overflow-hidden mb-4 print:rounded-none break-inside-avoid" style={{ background: '#0f172a', boxShadow: '0 2px 12px rgba(15,23,42,0.18)' }}>
            <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #9a3412, #ea580c, #f97316)' }} />
            <div className="px-6 sm:px-8 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <BrandLogo iconOnly size="sm" variant="reversed" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-0.5" style={{ color: '#ea580c' }}>jurius.com.br</p>
                  <h1 className="text-[17px] font-bold leading-tight" style={{ color: 'white' }}>Dossiê Probatório de Assinatura Eletrônica</h1>
                  <p className="text-[10.5px] mt-0.5" style={{ color: '#475569' }}>MP 2.200-2/2001 · Lei 14.063/2020</p>
                </div>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#475569' }}>Emitido em</p>
                <p className="text-[12px] font-medium" style={{ color: '#94a3b8' }}>{fmtFull(report?.report?.generated_at)}</p>
              </div>
            </div>
          </div>

          {/* Veredito de integridade — destaque */}
          <div className="rounded-2xl overflow-hidden mb-4 print:rounded-none break-inside-avoid"
            style={{ background: verified ? '#f0fdf4' : '#fef2f2', border: `1px solid ${verified ? '#bbf7d0' : '#fecaca'}` }}>
            <div className="px-6 py-4 flex items-start gap-3">
              {verified
                ? <ShieldCheck className="w-7 h-7 flex-shrink-0" style={{ color: '#16a34a' }} />
                : <ShieldAlert className="w-7 h-7 flex-shrink-0" style={{ color: '#dc2626' }} />}
              <div className="flex-1">
                <p className="text-[14px] font-bold" style={{ color: verified ? '#15803d' : '#b91c1c' }}>
                  {verified ? 'Cadeia de auditoria ÍNTEGRA' : 'Cadeia de auditoria COMPROMETIDA'}
                </p>
                <p className="text-[12px] mt-1 leading-relaxed" style={{ color: verified ? '#166534' : '#991b1b' }}>
                  {verified
                    ? 'A trilha de auditoria deste envelope foi verificada no servidor no momento da emissão deste dossiê. Todos os eventos estão encadeados por hash e nenhuma alteração foi detectada — qualquer edição ou remoção posterior de um evento quebraria a cadeia e seria identificável.'
                    : `Foram detectadas ${chain?.broken_count} inconsistência(s) na cadeia de eventos. Isto indica que o histórico pode ter sido alterado após o registro.`}
                </p>
                {!verified && Array.isArray(chain?.broken_entries) && chain.broken_entries.length > 0 && (
                  <ul className="mt-2 text-[11px] font-mono list-disc pl-4" style={{ color: '#991b1b' }}>
                    {chain.broken_entries.map((b: any, i: number) => (
                      <li key={i}>{fmtShort(b.created_at)} — {b.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {/* Envelope */}
            <Card title="Envelope" icon={FileText}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Field label="Documento" value={env?.document_name} />
                <Field label="Cliente" value={env?.client_name} />
                <Field label="Protocolo do envelope" value={env?.protocol} mono />
                <Field label="Código de verificação" value={env?.envelope_verification_code} mono />
                <Field label="Modelo" value={env?.signature_model === 'per_document' ? 'Um PDF assinado por documento' : 'Documento consolidado'} />
                <Field label="Autenticação exigida" value={authLabel(env?.auth_method)} />
                <Field label="Criado em" value={fmtFull(env?.created_at)} />
                <Field label="Concluído em" value={fmtFull(env?.signed_at)} />
                {env?.process_number && <Field label="Processo" value={env.process_number} />}
                <Field label="Situação" value={env?.status} />
              </div>
            </Card>

            {/* Documentos */}
            <Card title={`Documentos assinados (${docs.length})`} icon={Hash}>
              <div className="flex flex-col gap-4">
                {docs.map((d, i) => (
                  <div key={i} className="pb-4 break-inside-avoid" style={{ borderBottom: i < docs.length - 1 ? '1px solid #eef2f6' : 'none' }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-[13px] font-bold" style={{ color: '#0f172a' }}>{d.display_name || d.document_key}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#eef2f6', color: '#64748b' }}>
                        {d.document_type === 'main' ? 'Principal' : 'Anexo'}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: d.hash_source === 'server' ? '#ecfdf5' : '#fff7ed', color: d.hash_source === 'server' ? '#047857' : '#c2410c' }}>
                        {d.hash_source === 'server' ? 'hash servidor' : 'hash cliente'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Código de verificação" value={d.verification_code} mono />
                      <Field label="Páginas" value={d.page_count ?? '—'} />
                      <Field label="SHA-256 do PDF assinado" value={d.signed_pdf_sha256} mono />
                      <Field label="SHA-256 do documento-fonte" value={d.source_document_sha256} mono />
                    </div>
                  </div>
                ))}
                {docs.length === 0 && <p className="text-[12px]" style={{ color: '#94a3b8' }}>Nenhum documento individual persistido (envelope consolidado ou legado).</p>}
              </div>
            </Card>

            {/* Signatários */}
            {signers.map((s, i) => (
              <Card key={i} title={`Signatário ${signers.length > 1 ? `${i + 1}/${signers.length}` : ''} — prova do ato`} icon={User}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="Nome" value={s.name} />
                  <Field label="CPF" value={s.cpf} />
                  <Field label="E-mail" value={s.email} />
                  <Field label="Telefone" value={s.phone} />
                  <Field label="Papel" value={s.role} />
                  <Field label="Situação" value={s.status === 'signed' ? 'Assinado' : s.status} />
                  <Field label="Autenticação" value={authLabel(s.auth_method, s.auth_provider)} />
                  <Field label="Biometria facial" value={s.has_facial_biometrics ? 'Sim (selfie capturada)' : 'Não'} />
                  <Field label={<span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />Endereço IP</span>} value={s.ip_address} mono />
                  <Field label="Dispositivo" value={parseUA(s.user_agent)} />
                  <Field label="Geolocalização" value={
                    mapsUrl(s.geolocation)
                      ? <a href={mapsUrl(s.geolocation)!} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{s.geolocation}</a>
                      : (s.geolocation || '—')
                  } mono />
                  <Field label="Google ID (sub)" value={s.auth_provider === 'google' ? (s.auth_email || '—') : '—'} />
                  <Field label={<span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />Abriu em</span>} value={fmtFull(s.viewed_at || s.opened_at)} />
                  <Field label={<span className="inline-flex items-center gap-1"><Fingerprint className="w-3 h-3" />Assinou em</span>} value={fmtFull(s.signed_at)} />
                  <Field label="Termos de uso aceitos" value={s.terms_accepted_at ? `${fmtShort(s.terms_accepted_at)} (${s.terms_version || 'v1'})` : '—'} />
                  <Field label="Hash de verificação do signatário" value={s.signer_verification_hash} mono />
                </div>
              </Card>
            ))}

            {/* Trilha de auditoria encadeada */}
            <Card title={`Trilha de auditoria encadeada (${trail.length} eventos)`} icon={Link2}>
              <div className="flex flex-col">
                {trail.map((e, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5 break-inside-avoid" style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}>
                    <div className="w-[64px] flex-shrink-0">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: '#eef2f6', color: '#475569' }}>{e.action}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px]" style={{ color: '#0f172a' }}>{e.description}</p>
                      <p className="text-[10.5px] mt-0.5" style={{ color: '#94a3b8' }}>
                        {fmtFull(e.created_at)}{e.ip_address ? ` · IP ${e.ip_address}` : ''}
                      </p>
                      <p className="text-[9.5px] font-mono mt-0.5 break-all" style={{ color: '#cbd5e1' }}>
                        hash: {e.entry_hash?.slice(0, 24)}… {e.prev_hash ? `← ${e.prev_hash.slice(0, 12)}…` : '(início da cadeia)'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Metodologia */}
            <div className="rounded-2xl print:rounded-none px-5 py-4 break-inside-avoid" style={{ background: '#f8fafc', border: '1px solid #eef2f6' }}>
              <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] mb-1.5" style={{ color: '#94a3b8' }}>Metodologia</p>
              <p className="text-[11px] leading-relaxed" style={{ color: '#64748b' }}>{report?.report?.methodology}</p>
              <p className="text-[10px] mt-2" style={{ color: '#cbd5e1' }}>
                Cada documento pode ser validado publicamente pelo seu código de verificação. A integridade de um arquivo é confirmada recalculando seu SHA-256 e comparando com o hash registrado neste dossiê.
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:rounded-none { border-radius: 0 !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:max-w-none { max-width: none !important; }
          .print\\:bg-white { background: white !important; }
          .break-inside-avoid { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default ForensicDossier;
