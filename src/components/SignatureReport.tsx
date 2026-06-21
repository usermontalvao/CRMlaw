import React, { useEffect, useState } from 'react';
import { CheckCircle, Download, FileText, Shield, User, Clock, Hash, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { Signer, SignatureRequest } from '../types/signature.types';
import { supabase } from '../config/supabase';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';

interface SignatureReportProps {
  signer: Signer;
  request: SignatureRequest;
  creator?: { name: string; email: string } | null;
  onClose?: () => void;
}

const fmtFull = (d: string) =>
  new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const fmtShort = (d: string) =>
  new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const parseUA = (ua: string) => ({
  device:  /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop',
  browser: /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Navegador',
  os:      /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone/i.test(ua) ? 'iOS' : /iPad/i.test(ua) ? 'iPadOS' : /Linux/i.test(ua) ? 'Linux' : 'SO',
});

const isPlaceholder = (e?: string | null) => {
  const s = (e || '').trim().toLowerCase();
  return s.startsWith('public+') && s.endsWith('@crm.local');
};

/* ── Linha de dado da tabela ── */
const DataRow: React.FC<{ label: string; value: React.ReactNode; mono?: boolean; last?: boolean }> = ({ label, value, mono, last }) => (
  <div className="flex items-start gap-3 py-2" style={{ borderBottom: last ? 'none' : '1px solid #f1f5f9' }}>
    <span className="flex-shrink-0 text-[11px] font-semibold" style={{ color: '#94a3b8', minWidth: 108 }}>{label}</span>
    <span className={`flex-1 text-right text-[11.5px] break-all leading-snug ${mono ? 'font-mono' : 'font-medium'}`} style={{ color: '#1e293b' }}>
      {value}
    </span>
  </div>
);

/* ── Label de seção ── */
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="w-[3px] h-[13px] rounded-full flex-shrink-0" style={{ background: '#ea580c' }} />
    <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: '#94a3b8' }}>{children}</span>
  </div>
);

const SignatureReport: React.FC<SignatureReportProps> = ({ signer, request, creator, onClose }) => {
  const [sigUrl,    setSigUrl]    = useState<string | null>(null);
  const [faceUrl,   setFaceUrl]   = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);

  const verificationUrl = signer.verification_hash
    ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
    : null;

  useEffect(() => {
    (async () => {
      try {
        const getUrl = async (path: string) => {
          for (const b of ['document-templates', 'generated-documents', 'signatures']) {
            try {
              const { data, error } = await supabase.storage.from(b).createSignedUrl(path, 3600);
              if (!error && data?.signedUrl) return data.signedUrl;
            } catch { /* skip */ }
          }
          return null;
        };
        if (signer.signature_image_path) setSigUrl(await getUrl(signer.signature_image_path));
        if (signer.facial_image_path)    setFaceUrl(await getUrl(signer.facial_image_path));
        if (verificationUrl) {
          setQrDataUrl(await QRCode.toDataURL(verificationUrl, { width: 200, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }));
        }
      } finally { setLoading(false); }
    })();
  }, []);

  const ua      = signer.signer_user_agent ? parseUA(signer.signer_user_agent) : null;
  const geo     = signer.signer_geolocation?.split(',').map(s => s.trim());
  const contact = (() => {
    const ae = (signer.auth_email || '').trim();
    const ph = (signer.phone || '').trim();
    const re = (signer.email || '').trim();
    return ae || (signer.auth_provider === 'phone' ? ph : '') || (!isPlaceholder(re) ? re : '') || '';
  })();

  const authItems: string[] = [];
  if (signer.signature_image_path)  authItems.push('Assinatura manuscrita');
  if (signer.facial_image_path)     authItems.push('Biometria facial');
  if (signer.auth_provider === 'google')      authItems.push(`Google OAuth 2.0`);
  if (signer.auth_provider === 'email_link')  authItems.push(`E-mail OTP`);
  if (signer.auth_provider === 'phone')       authItems.push(`SMS OTP`);
  if (signer.signer_geolocation)    authItems.push('Geolocalização GPS');
  if (signer.signer_ip)             authItems.push('IP registrado');

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f1f5f9' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-[3px] border-t-transparent animate-spin"
          style={{ borderColor: '#ea580c', borderTopColor: 'transparent' }} />
        <p className="text-[13px]" style={{ color: '#94a3b8' }}>Carregando certificado…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen print:bg-[#f8f7f5]" style={{ background: '#e8edf2' }}>

      {/* ── Toolbar ── */}
      <div className="print:hidden sticky top-0 z-20"
        style={{ background: 'white', borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,23,42,0.07)' }}>
        <div className="max-w-6xl mx-auto px-5 h-[52px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-[5px] h-[5px] rounded-full" style={{ background: '#ea580c' }} />
            <span className="text-[13px] font-bold" style={{ color: '#0f172a' }}>JURIUS</span>
            <span className="text-[12px]" style={{ color: '#94a3b8' }}>· Certificado de Assinatura</span>
            <span className="hidden sm:inline text-[12px] truncate max-w-[300px]" style={{ color: '#cbd5e1' }}>
              · {request.document_name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition"
              style={{ background: '#ea580c' }}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Imprimir / PDF</span>
              <span className="sm:hidden">PDF</span>
            </button>
            {onClose && (
              <button onClick={onClose} className="w-[30px] h-[30px] rounded-lg flex items-center justify-center transition"
                style={{ border: '1px solid #e2e8f0', color: '#94a3b8' }}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 print:p-0 print:max-w-none">

        {/* ════ CABEÇALHO ════ */}
        <div className="rounded-2xl overflow-hidden mb-4 print:rounded-none"
          style={{ background: '#0f172a', boxShadow: '0 2px 12px rgba(15,23,42,0.18)' }}>
          {/* Faixa laranja */}
          <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #9a3412, #ea580c, #f97316)' }} />
          <div className="px-6 sm:px-8 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-[4px] h-[40px] rounded-full flex-shrink-0" style={{ background: '#ea580c' }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-0.5" style={{ color: '#ea580c' }}>JURIUS CRM</p>
                <h1 className="text-[17px] font-bold leading-tight" style={{ color: 'white' }}>
                  Certificado de Assinatura Eletrônica
                </h1>
                <p className="text-[10.5px] mt-0.5" style={{ color: '#475569' }}>
                  MP 2.200-2/2001 · Lei 14.063/2020
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#475569' }}>Emitido em</p>
                <p className="text-[12px] font-medium" style={{ color: '#94a3b8' }}>{fmtShort(new Date().toISOString())}</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#10b981' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#34d399' }}>
                  Assinado · Válido
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ════ GRID PRINCIPAL — 2 colunas no desktop ════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── COLUNA ESQUERDA (2/3) ── */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Card: Documento */}
            <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden"
              style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
              <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <SectionLabel>Documento</SectionLabel>
              </div>
              <div className="px-5 py-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                  <FileText className="w-[17px] h-[17px]" style={{ color: '#ea580c' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[15px] break-words leading-snug" style={{ color: '#0f172a' }}>
                    {request.document_name}
                  </p>
                  <p className="text-[11px] font-mono mt-1" style={{ color: '#94a3b8' }}>ID: {request.id}</p>
                  {creator && (
                    <p className="text-[12px] mt-0.5" style={{ color: '#64748b' }}>
                      Solicitado por <strong style={{ color: '#334155' }}>{creator.name}</strong>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Card: Signatário */}
            <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden"
              style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
                <SectionLabel>Signatário</SectionLabel>
              </div>

              {/* Perfil */}
              <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid #f8fafc' }}>
                {faceUrl ? (
                  <div className="relative w-12 h-12 flex-shrink-0">
                    <img src={faceUrl} alt="Foto" className="w-12 h-12 rounded-xl object-cover"
                      style={{ border: '2px solid #f1f5f9', transform: 'scaleX(-1)' }} />
                    <div className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                      style={{ background: '#10b981', border: '2px solid white' }}>
                      <CheckCircle className="w-2.5 h-2.5 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                    <User className="w-5 h-5" style={{ color: '#94a3b8' }} />
                    <div className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                      style={{ background: '#10b981', border: '2px solid white' }}>
                      <CheckCircle className="w-2.5 h-2.5 text-white" />
                    </div>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[15px]" style={{ color: '#0f172a' }}>{signer.name}</p>
                  {signer.role && <p className="text-[12px]" style={{ color: '#64748b' }}>{signer.role}</p>}
                  {contact && <p className="text-[12px]" style={{ color: '#94a3b8' }}>{contact}</p>}
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                    <CheckCircle className="w-3 h-3" />
                    Assinado
                  </span>
                  <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
                    {signer.signed_at ? fmtShort(signer.signed_at) : '—'}
                  </p>
                </div>
              </div>

              {/* Tabela de dados técnicos */}
              <div className="px-5 py-3">
                {[
                  signer.cpf                        && { k: 'CPF',         v: signer.cpf,                                   mono: true  },
                  signer.signed_at                  && { k: 'Data/Hora',   v: fmtFull(signer.signed_at),                    mono: false },
                  signer.signer_ip                  && { k: 'IP',          v: signer.signer_ip,                             mono: true  },
                  geo?.[0] && geo?.[1]              && { k: 'Coordenadas', v: `${geo[0]}, ${geo[1]}`,                       mono: true  },
                  ua                                && { k: 'Dispositivo', v: `${ua.device} · ${ua.browser} · ${ua.os}`,   mono: false },
                  signer.terms_accepted_at          && { k: 'Termos de Uso', v: (
                    <>
                      Aceitos em {fmtFull(signer.terms_accepted_at)}{' '}
                      <a
                        href={buildPublicSignatureTermsUrl(signer.terms_version || 'v1')}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline"
                        style={{ color: '#ea580c' }}
                      >
                        (ver {signer.terms_version || 'v1'})
                      </a>
                    </>
                  ), mono: false },
                ].filter(Boolean).map((row: any, i, arr) => (
                  <DataRow key={i} label={row.k} value={row.v} mono={row.mono} last={i === arr.length - 1} />
                ))}
              </div>

              {/* Fatores de autenticação */}
              {authItems.length > 0 && (
                <div className="px-5 pb-4" style={{ borderTop: '1px solid #f8fafc' }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] mt-3 mb-2" style={{ color: '#94a3b8' }}>
                    Fatores de autenticação
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {authItems.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                        style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                        <CheckCircle className="w-2.5 h-2.5 flex-shrink-0" />
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Assinatura manuscrita */}
              {sigUrl && (
                <div className="px-5 pb-4" style={{ borderTop: '1px solid #f8fafc' }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] mt-3 mb-2" style={{ color: '#94a3b8' }}>
                    Assinatura manuscrita
                  </p>
                  <div className="inline-flex items-center justify-center px-6 py-3 rounded-xl"
                    style={{ background: '#fafafa', border: '1.5px dashed #e2e8f0' }}>
                    <img src={sigUrl} alt="Assinatura" className="max-h-14 max-w-[220px] object-contain" />
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* ── COLUNA DIREITA (1/3) ── */}
          <div className="flex flex-col gap-4">

            {/* Card: Código de verificação */}
            {signer.verification_hash && (
              <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden"
                style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <SectionLabel>Código de verificação</SectionLabel>
                </div>
                <div className="px-5 py-4">
                  <p className="font-mono text-[18px] font-bold tracking-[0.08em] break-all leading-relaxed" style={{ color: '#0f172a' }}>
                    {signer.verification_hash}
                  </p>
                  <p className="text-[11px] mt-2" style={{ color: '#94a3b8' }}>
                    Use este código para verificar a autenticidade do documento a qualquer momento.
                  </p>
                </div>
              </div>
            )}

            {/* Card: QR Code */}
            {qrDataUrl && verificationUrl && (
              <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden"
                style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <SectionLabel>QR de verificação</SectionLabel>
                </div>
                <div className="px-5 py-4 flex flex-col items-center gap-3">
                  <div className="p-2 rounded-xl bg-[#f8f7f5]" style={{ border: '1px solid #e2e8f0' }}>
                    <img src={qrDataUrl} alt="QR Code" className="w-[120px] h-[120px] block" />
                  </div>
                  <a href={verificationUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10.5px] font-mono text-center break-all underline underline-offset-2"
                    style={{ color: '#ea580c' }}>
                    {verificationUrl}
                  </a>
                </div>
              </div>
            )}

            {/* Card: Hash SHA-256 */}
            {signer.signed_pdf_sha256 && (
              <div className="bg-[#f8f7f5] rounded-2xl print:rounded-none overflow-hidden"
                style={{ border: '1px solid #e8edf2', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
                <div className="px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <SectionLabel>Integridade · SHA-256</SectionLabel>
                </div>
                <div className="px-5 py-4">
                  <p className="font-mono text-[10px] break-all leading-relaxed" style={{ color: '#475569' }}>
                    {signer.signed_pdf_sha256}
                  </p>
                  <p className="text-[10.5px] mt-2" style={{ color: '#94a3b8' }}>
                    Garante que o documento não foi alterado após a assinatura.
                  </p>
                </div>
              </div>
            )}

            {/* Card: Aviso legal */}
            <div className="rounded-2xl px-5 py-4" style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
              <p className="text-[10.5px] leading-relaxed" style={{ color: '#94a3b8' }}>
                Assinatura eletrônica com validade jurídica conforme a{' '}
                <strong style={{ color: '#64748b' }}>MP 2.200-2/2001</strong> e a{' '}
                <strong style={{ color: '#64748b' }}>Lei 14.063/2020</strong>.
              </p>
              <p className="text-[10px] mt-2 font-mono" style={{ color: '#cbd5e1' }}>
                {request.id}
              </p>
            </div>

          </div>
        </div>

        {/* ── Rodapé ── */}
        <div className="mt-4 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-[5px] h-[5px] rounded-full" style={{ background: '#ea580c' }} />
            <span className="text-[11px] font-semibold" style={{ color: '#64748b' }}>JURIUS · Assinatura Digital Certificada</span>
          </div>
          <span className="text-[11px]" style={{ color: '#94a3b8' }}>
            Emitido em {fmtShort(new Date().toISOString())} · UTC-4 (Manaus)
          </span>
        </div>
      </div>

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .print\\:rounded-none { border-radius: 0 !important; }
          .print\\:p-0 { padding: 0 !important; }
          .print\\:max-w-none { max-width: none !important; }
        }
      `}</style>
    </div>
  );
};

export default SignatureReport;
