import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, X, XCircle } from 'lucide-react';
import { supabase } from '../config/supabase';
import { signatureService } from '../services/signature.service';
import { BrandLogo } from './ui/BrandLogo';
import { BRAND_GRADIENT, BRAND_IVORY } from '../constants/brand';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';

// Registro de eventos por signatário — espelha a "TRILHA DE AUDITORIA / REGISTRO
// DE EVENTOS" do PDF (pdfSignature.service.ts): visualização, autenticação,
// biometria facial, localização, aceite dos termos e assinatura, na mesma ordem.
type SignerEvent = { label: string; at: string; sortAt: number; order: number; detail: string };

const buildSignerEvents = (s: any): SignerEvent[] => {
  const ms = (v: any) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0; };
  const name = s.name || 'Signatário';
  const authEmail = String(s.auth_email || '').trim();
  const phone = String(s.phone || '').trim();
  const rawEmail = String(s.email || '').trim();
  const displayContact = authEmail || (s.auth_provider === 'phone' ? phone : '') || rawEmail;
  const contactLabel = authEmail ? 'E-mail' : s.auth_provider === 'phone' ? 'Telefone' : 'E-mail';
  const contact = displayContact ? ` (${contactLabel}: ${displayContact})` : '';
  const cpf = s.cpf ? `, CPF: ${s.cpf}` : '';
  const geo = String(s.geolocation || '').trim();
  const hasGeo = !!geo && /-?\d/.test(geo);
  const ip = String(s.ip_address || '').trim();
  const ipInfo = ip ? ` por meio do IP ${ip}` : '';
  const base = s.auth_provider === 'phone' ? 'Autenticação via Telefone'
    : s.auth_provider === 'email_link' ? 'Autenticação via Link por E-mail'
    : s.auth_provider === 'google' ? 'Autenticação via Google'
    : 'Autenticação no fluxo de assinatura';
  const authSummary = (s.auth_provider === 'google' && s.auth_google_sub) ? `${base}. Google ID: ${s.auth_google_sub}` : base;

  const viewedAt = s.viewed_at || s.opened_at;
  const signedMs = s.signed_at ? ms(s.signed_at) : 0;
  const events: SignerEvent[] = [];
  if (viewedAt) {
    events.push({ label: 'Visualizado', at: viewedAt, sortAt: ms(viewedAt), order: 1, detail: `${name}${cpf} abriu o documento${ipInfo}.` });
    events.push({ label: 'Autenticação', at: viewedAt, sortAt: ms(viewedAt), order: 2, detail: `${name}${cpf}. ${authSummary}${ipInfo ? `${ipInfo}.` : '.'}` });
    if (s.has_facial_biometrics) events.push({ label: 'Biometria facial', at: viewedAt, sortAt: ms(viewedAt), order: 2.5, detail: `${name}${contact}${cpf} concedeu acesso à câmera e teve a selfie capturada para verificação facial.` });
    if (hasGeo) events.push({ label: 'Localização', at: viewedAt, sortAt: ms(viewedAt), order: 3, detail: `${name}${contact}${cpf} ativou a localização com coordenadas ${geo}.` });
  }
  if (s.terms_accepted_at) {
    const v = String(s.terms_version || 'v1');
    const tMs = ms(s.terms_accepted_at);
    events.push({ label: 'Termos', at: s.terms_accepted_at, sortAt: signedMs ? Math.min(tMs, signedMs) : tMs, order: 4, detail: `${name}${contact}${cpf} declarou ter lido e aceitado os Termos de Uso (versão ${v})${ipInfo}. Consulte em ${buildPublicSignatureTermsUrl(v)}` });
  }
  if (s.signed_at) {
    events.push({ label: 'Assinado', at: s.signed_at, sortAt: signedMs, order: 5, detail: `${name}${contact}${cpf} assinou este documento${ipInfo}${hasGeo ? ` localizado em ${geo}` : ''}. ${authSummary}` });
  }
  events.sort((a, b) => a.sortAt - b.sortAt || a.order - b.order);
  return events;
};

interface ForensicDossierProps {
  requestId: string;
  documentName?: string | null;
  onClose?: () => void;
}

// Documento oficial: tipografia sans corporativa (sem serifa "ensaio"), mono para hashes.
const SERIF = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SANS = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"Cascadia Mono", "SF Mono", Consolas, "Courier New", monospace';

// Paleta de status de integridade (verde = integro, vermelho = nao integro).
const integrityMeta = (status?: 'checking' | 'valid' | 'mismatch' | 'unavailable') => {
  switch (status) {
    case 'valid':
      return { label: 'ÍNTEGRO', color: '#15803d', bg: '#dcfce7', border: '#86efac' };
    case 'mismatch':
      return { label: 'NÃO ÍNTEGRO', color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' };
    case 'checking':
      return { label: 'CONFERINDO', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' };
    default:
      return { label: 'INDISPONÍVEL', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' };
  }
};

const fmtFull = (d?: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) : '-';

const fmtShort = (d?: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Manaus',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) : '-';

const parseUA = (ua?: string | null) => {
  const s = ua || '';
  if (!s) return '-';
  const device = /iPad|Tablet/i.test(s) ? 'Tablet' : /Mobile|Android|iPhone/i.test(s) ? 'Mobile' : 'Desktop';
  const browser = /Edg\//i.test(s) ? 'Edge' : /OPR\//i.test(s) ? 'Opera' : /Firefox\//i.test(s) ? 'Firefox' : /Chrome\//i.test(s) ? 'Chrome' : /Safari\//i.test(s) ? 'Safari' : 'Navegador';
  const os = /Windows/i.test(s) ? 'Windows' : /Mac OS X/i.test(s) && !/iPhone|iPad/i.test(s) ? 'macOS' : /Android/i.test(s) ? 'Android' : /iPhone/i.test(s) ? 'iOS' : /iPad/i.test(s) ? 'iPadOS' : /Linux/i.test(s) ? 'Linux' : 'SO';
  return `${device} / ${browser} / ${os}`;
};

const mapsUrl = (geo?: string | null) => {
  const g = String(geo || '').trim();
  if (!g || !/-?\d/.test(g)) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(g)}`;
};

const authLabel = (method?: string | null, provider?: string | null) => {
  const parts: string[] = [];
  if (provider === 'google') parts.push('Autenticação via Google');
  else if (provider === 'email_link') parts.push('Autenticação por e-mail');
  else if (provider === 'phone') parts.push('Autenticação por telefone');
  if (method === 'signature_facial' || method === 'signature_facial_document') parts.push('Verificação facial');
  if (method === 'signature_facial_document') parts.push('Documento com foto');
  if (!parts.length) parts.push('Assinatura eletrônica');
  return parts.join(' + ');
};

const storageBuckets = ['document-templates', 'generated-documents', 'signatures', 'assinados'];

const storageObjectExists = async (bucket: string, path: string): Promise<boolean> => {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return false;
  const lastSlash = cleanPath.lastIndexOf('/');
  const folder = lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : '';
  const filename = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
  try {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { search: filename, limit: 5 });
    if (error || !data) return false;
    return data.some((item) => item.name === filename);
  } catch {
    return false;
  }
};

const createSignedStorageUrl = async (path?: string | null, expiresIn = 3600): Promise<string | null> => {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return null;
  for (const bucket of storageBuckets) {
    try {
      const exists = await storageObjectExists(bucket, cleanPath);
      if (!exists) continue;
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanPath, expiresIn);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {}
  }
  return null;
};

const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const printDocument = (title: string, content: string) => {
  // IMPORTANT: nao usar 'noopener'/'noreferrer' aqui — com essas flags o
  // window.open retorna null e abre apenas uma aba em branco, sem conteudo.
  const win = window.open('', '_blank', 'width=1200,height=900');
  if (!win) {
    alert('Nao foi possivel abrir a janela de impressao. Habilite os pop-ups para este site e tente novamente.');
    return;
  }
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) => node.outerHTML).join('\n');
  win.document.open();
  win.document.write(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        ${styles}
        <style>
          html, body { margin: 0; padding: 0; background: #fff; }
          body { color: #111827; font-family: ${SERIF}; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          @page { size: A4; margin: 16mm 18mm; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            a { color: #1d4ed8 !important; text-decoration: none; }
          }
        </style>
      </head>
      <body>${content}
        <script>
          function __doPrint(){ try { window.focus(); window.print(); } catch (e) {} }
          // Aguarda imagens (assinaturas/selfies) carregarem antes de imprimir,
          // com timeout de seguranca para nao travar a impressao.
          window.onload = function () {
            var imgs = Array.prototype.slice.call(document.images || []);
            var pending = imgs.filter(function (img) { return !img.complete; }).length;
            if (!pending) { setTimeout(__doPrint, 200); return; }
            var done = false;
            var finish = function () { if (done) return; done = true; __doPrint(); };
            imgs.forEach(function (img) {
              if (img.complete) return;
              img.addEventListener('load', function () { if (--pending <= 0) finish(); });
              img.addEventListener('error', function () { if (--pending <= 0) finish(); });
            });
            setTimeout(finish, 2500);
          };
        </script>
      </body>
    </html>
  `);
  win.document.close();
};

const INK = '#1a1a1a';
const MUTED = '#6b7280';
const HAIR = '#dcdcdc';

const SectionTitle: React.FC<{ index: string; title: string }> = ({ index, title }) => (
  <div className="break-inside-avoid" style={{ marginTop: 30, marginBottom: 14, borderBottom: `1.5px solid ${INK}`, paddingBottom: 7, display: 'flex', alignItems: 'baseline', gap: 12 }}>
    <span style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: INK, minWidth: 26 }}>{index}.</span>
    <span style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, letterSpacing: '0.02em', color: INK, textTransform: 'uppercase' }}>
      {title}
    </span>
  </div>
);

const KVRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '215px 1fr', gap: 18, padding: '6px 0', borderBottom: `1px solid ${HAIR}` }}>
    <div style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, lineHeight: 1.5, paddingTop: 1 }}>{label}</div>
    <div style={{ fontFamily: mono ? MONO : SERIF, fontSize: mono ? 12 : 13.5, lineHeight: 1.55, color: INK, wordBreak: 'break-word' }}>{value ?? '-'}</div>
  </div>
);

const StatusPill: React.FC<{ status?: 'checking' | 'valid' | 'mismatch' | 'unavailable' }> = ({ status }) => {
  const m = integrityMeta(status);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: SANS, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em',
      color: m.color, background: m.bg, border: `1px solid ${m.border}`,
      padding: '3px 9px', borderRadius: 3,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      {m.label}
    </span>
  );
};

const ForensicDossier: React.FC<ForensicDossierProps> = ({ requestId, documentName, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any | null>(null);
  const [signerAssets, setSignerAssets] = useState<Record<string, { signatureUrl: string | null; facialUrl: string | null }>>({});
  const [documentIntegrity, setDocumentIntegrity] = useState<Record<string, { status: 'checking' | 'valid' | 'mismatch' | 'unavailable'; currentHash?: string | null; error?: string | null }>>({});
  const printRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await signatureService.getForensicReport(requestId);
        if (!alive) return;
        if (!data) {
          setError('Envelope não encontrado ou sem permissão de acesso.');
          return;
        }
        setReport(data);
      } catch (e) {
        if (alive) setError((e as Error)?.message || 'Falha ao gerar o laudo.');
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
  const verifyPortalUrl = `${window.location.origin}/#/verificar`;
  const envelopeVerifyUrl = env?.envelope_verification_code ? `${verifyPortalUrl}/${env.envelope_verification_code}` : verifyPortalUrl;
  const signersEffectKey = useMemo(() => JSON.stringify(signers.map((s: any) => ({
    key: s.signer_verification_hash || s.email || s.name || '',
    signature_image_path: s.signature_image_path || '',
    facial_image_path: s.facial_image_path || '',
  }))), [signers]);
  const docsEffectKey = useMemo(() => JSON.stringify(docs.map((d: any) => ({
    key: d.verification_code || d.document_key || '',
    signed_file_path: d.signed_file_path || '',
    signed_pdf_sha256: d.signed_pdf_sha256 || '',
  }))), [docs]);

  // Integridade dos arquivos (conferida no cliente) por documento.
  const docIntegrityStatuses = useMemo(
    () => docs.map((d: any, i: number) => documentIntegrity[d.verification_code || d.document_key || String(i)]?.status),
    [docs, documentIntegrity],
  );
  const mismatchCount = docIntegrityStatuses.filter((s) => s === 'mismatch').length;
  const checkingDocs = docs.length > 0 && docIntegrityStatuses.some((s) => s === 'checking' || s === undefined);
  const unavailableDocs = docIntegrityStatuses.some((s) => s === 'unavailable');

  // Veredito GLOBAL = cadeia de auditoria integra E arquivos sem divergencia.
  const overallStatus: 'valid' | 'mismatch' | 'checking' | 'unavailable' = useMemo(() => {
    if (!verified || mismatchCount > 0) return 'mismatch';
    if (checkingDocs) return 'checking';
    if (unavailableDocs) return 'unavailable';
    return 'valid';
  }, [verified, mismatchCount, checkingDocs, unavailableDocs]);

  const opinionText = useMemo(() => {
    if (!report) return '';
    const parts: string[] = [];
    if (!verified) {
      parts.push(`Foram identificadas ${chain?.broken_count || 0} inconsistência(s) na cadeia cronológica de auditoria.`);
    }
    if (mismatchCount > 0) {
      parts.push(`A reconferência criptográfica identificou divergência entre o hash atual e o hash originalmente registrado em ${mismatchCount} documento(s), indicando que o arquivo armazenado foi alterado após a assinatura.`);
    }
    if (parts.length) {
      parts.push('Recomenda-se ressalva e revisão manual antes de uso probatório definitivo.');
      return parts.join(' ');
    }
    if (overallStatus === 'checking') {
      return 'Reconferência criptográfica dos arquivos assinados em andamento.';
    }
    if (overallStatus === 'unavailable') {
      return 'Não foram constatadas rupturas na cadeia de auditoria; contudo, um ou mais arquivos não puderam ser reconferidos automaticamente neste momento.';
    }
    return 'Não foram constatadas rupturas na cadeia cronológica de auditoria do envelope analisado, e a reconferência criptográfica dos arquivos assinados não apresentou divergência em relação aos hashes registrados.';
  }, [report, verified, chain?.broken_count, mismatchCount, overallStatus]);

  const verdictMeta = integrityMeta(overallStatus);
  const VerdictIcon = overallStatus === 'valid' ? CheckCircle2 : overallStatus === 'mismatch' ? XCircle : AlertTriangle;
  const verdictLabel = overallStatus === 'valid' ? 'ÍNTEGRO'
    : overallStatus === 'mismatch' ? 'NÃO ÍNTEGRO'
    : overallStatus === 'checking' ? 'CONFERINDO' : 'INCONCLUSIVO';
  const verdictSub = overallStatus === 'valid' ? 'Cadeia de auditoria e arquivos validados'
    : overallStatus === 'mismatch' ? 'Divergência de integridade detectada'
    : overallStatus === 'checking' ? 'Reconferência dos arquivos em andamento'
    : 'Não foi possível reconferir todos os arquivos';

  const handlePrint = () => {
    if (!printRef.current || !env) return;
    printDocument(`Laudo-${String(env.document_name || env.protocol || requestId).replace(/[^\w.-]+/g, '-')}`, printRef.current.innerHTML);
  };

  useEffect(() => {
    if (!Array.isArray(signers) || signers.length === 0) {
      setSignerAssets({});
      return;
    }
    let alive = true;
    (async () => {
      const missingPaths = signers.every((signer: any) => !signer.signature_image_path && !signer.facial_image_path);
      const fallbackByKey = new Map<string, { signature_image_path?: string | null; facial_image_path?: string | null }>();
      if (missingPaths) {
        const { data } = await supabase
          .from('signature_signers')
          .select('verification_hash,email,name,signature_image_path,facial_image_path')
          .eq('signature_request_id', requestId);
        for (const row of data || []) {
          const key = (row as any).verification_hash || (row as any).email || (row as any).name;
          if (key) {
            fallbackByKey.set(String(key), {
              signature_image_path: (row as any).signature_image_path,
              facial_image_path: (row as any).facial_image_path,
            });
          }
        }
      }
      const entries = await Promise.all(signers.map(async (signer: any, index: number) => {
        const key = signer.signer_verification_hash || signer.email || signer.name || String(index);
        const fallback = fallbackByKey.get(String(key));
        const [signatureUrl, facialUrl] = await Promise.all([
          createSignedStorageUrl(signer.signature_image_path || fallback?.signature_image_path),
          createSignedStorageUrl(signer.facial_image_path || fallback?.facial_image_path),
        ]);
        return [key, { signatureUrl, facialUrl }] as const;
      }));
      if (alive) setSignerAssets(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [requestId, signersEffectKey]);

  useEffect(() => {
    if (!Array.isArray(docs) || docs.length === 0) {
      setDocumentIntegrity({});
      return;
    }
    let alive = true;
    setDocumentIntegrity(Object.fromEntries(docs.map((doc: any, index: number) => [
      doc.verification_code || doc.document_key || String(index),
      { status: 'checking' as const, currentHash: null, error: null },
    ])));
    (async () => {
      const updates = await Promise.all(docs.map(async (doc: any, index: number) => {
        const key = doc.verification_code || doc.document_key || String(index);
        const expectedHash = String(doc.signed_pdf_sha256 || '').trim().toLowerCase();
        const signedUrl = await createSignedStorageUrl(doc.signed_file_path, 900);
        if (!expectedHash || !signedUrl) {
          return [key, { status: 'unavailable' as const, currentHash: null, error: signedUrl ? 'Hash registrado ausente.' : 'Arquivo assinado indisponivel para conferencia.' }] as const;
        }
        try {
          const response = await fetch(signedUrl);
          if (!response.ok) {
            return [key, { status: 'unavailable' as const, currentHash: null, error: `Falha ao baixar arquivo (${response.status}).` }] as const;
          }
          const currentHash = (await sha256Hex(await response.arrayBuffer())).toLowerCase();
          return [key, {
            status: currentHash === expectedHash ? 'valid' as const : 'mismatch' as const,
            currentHash,
            error: currentHash === expectedHash ? null : 'O hash atual do arquivo diverge do hash registrado.',
          }] as const;
        } catch (err) {
          return [key, { status: 'unavailable' as const, currentHash: null, error: (err as Error)?.message || 'Falha ao recalcular o hash do arquivo.' }] as const;
        }
      }));
      if (alive) setDocumentIntegrity(Object.fromEntries(updates));
    })();
    return () => { alive = false; };
  }, [docsEffectKey]);

  return (
    <div className="min-h-screen" style={{ background: '#e5e7eb' }}>
      <div className="print:hidden sticky top-0 z-20" style={{ background: 'rgba(255,255,255,0.97)', borderBottom: '1px solid #d1d5db' }}>
        <div className="max-w-6xl mx-auto px-5 h-[56px] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#6b7280' }}>Jurius | laudo de inspeção</div>
            <div className="truncate" style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: '#111827' }}>{documentName || env?.document_name || 'Assinatura digital'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} disabled={!report} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-white text-[12px] font-semibold disabled:opacity-40" style={{ background: '#111827' }}>
              <Download className="w-4 h-4" />
              Imprimir / PDF
            </button>
            {onClose ? (
              <button onClick={onClose} className="w-[34px] h-[34px] rounded-md flex items-center justify-center" style={{ border: '1px solid #d1d5db', color: '#4b5563', background: '#ffffff' }}>
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {loading && (
        <div className="max-w-6xl mx-auto px-6 py-24 text-center" style={{ color: '#4b5563', fontFamily: SANS, fontSize: 13 }}>
          Montando o laudo de inspeção...
        </div>
      )}

      {error && !loading && (
        <div className="max-w-6xl mx-auto px-6 py-24 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: '#b91c1c' }} />
          <p style={{ margin: 0, fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#111827' }}>{error}</p>
        </div>
      )}

      {report && !loading && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <div ref={printRef} style={{ background: '#ffffff', border: '1px solid #d1d5db', boxShadow: '0 12px 40px rgba(15,23,42,0.08)' }}>
            <div style={{ height: 4, background: BRAND_GRADIENT }} />
            <div style={{ background: BRAND_IVORY, padding: '18px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: `1px solid ${HAIR}` }}>
              <BrandLogo variant="light" size="md" showTagline={false} />
              <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8C7E72' }}>
                Laudo de Inspeção &middot; Prova Digital
              </span>
            </div>

            <div style={{ padding: '28px 48px 20px' }}>
              <h1 style={{ margin: 0, fontFamily: SERIF, fontSize: 23, lineHeight: 1.25, fontWeight: 800, color: INK, letterSpacing: '0.005em' }}>
                Laudo de Inspeção de Integridade e Autenticidade
                <br />de Assinatura Eletrônica
              </h1>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginTop: 18, border: `1px solid ${HAIR}`, borderRadius: 4, overflow: 'hidden' }}>
                {[
                  { k: 'Emissão do laudo', v: fmtFull(report?.report?.generated_at) },
                  { k: 'Protocolo do envelope', v: env?.protocol || '-' },
                ].map((it, i) => (
                  <div key={i} style={{ padding: '11px 15px', borderLeft: i > 0 ? `1px solid ${HAIR}` : 'none', background: '#f8fafc' }}>
                    <div style={{ fontFamily: SANS, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: MUTED }}>{it.k}</div>
                    <div style={{ marginTop: 3, fontFamily: SERIF, fontSize: 12, lineHeight: 1.45, fontWeight: 600, color: INK }}>{it.v}</div>
                  </div>
                ))}
              </div>
              <p style={{ margin: '16px 0 0', fontFamily: SERIF, fontSize: 13, lineHeight: 1.65, color: '#374151', textAlign: 'justify' }}>
                Documento destinado a demonstrar autoria, autenticação empregada, integridade criptográfica, cadeia cronológica de auditoria e meios de verificação pública do envelope examinado.
              </p>
            </div>

            <div style={{ padding: '8px 48px 40px' }}>
              <div className="break-inside-avoid" style={{ display: 'flex', alignItems: 'stretch', border: `2px solid ${verdictMeta.color}`, borderRadius: 4, overflow: 'hidden', background: '#ffffff' }}>
                <div style={{ width: 88, flexShrink: 0, background: verdictMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <VerdictIcon style={{ width: 44, height: 44, color: '#ffffff' }} strokeWidth={2.2} />
                </div>
                <div style={{ padding: '16px 22px', flex: 1 }}>
                  <div style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
                    Parecer conclusivo
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: SANS, fontSize: 26, fontWeight: 800, letterSpacing: '0.02em', color: verdictMeta.color }}>
                      {verdictLabel}
                    </span>
                    <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: INK }}>
                      {verdictSub}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 13, lineHeight: 1.65, color: '#374151', textAlign: 'justify' }}>
                    {opinionText}
                  </div>
                </div>
              </div>

              <SectionTitle index="I" title="Identificação do envelope e verificação pública" />
              <KVRow label="Documento principal" value={env?.document_name || '-'} />
              <KVRow label="Cliente" value={env?.client_name || '-'} />
              <KVRow label="Protocolo do envelope" value={env?.protocol || '-'} mono />
              <KVRow label="Código de verificação do envelope" value={env?.envelope_verification_code || '-'} mono />
              <KVRow label="Consulta pública do envelope" value={<a href={envelopeVerifyUrl} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>{envelopeVerifyUrl}</a>} mono />
              <KVRow label="Portal público de verificação" value={<a href={verifyPortalUrl} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>{verifyPortalUrl}</a>} mono />
              <KVRow label="Modelo de assinatura" value={env?.signature_model === 'per_document' ? 'Um PDF assinado por documento' : 'Documento consolidado'} />
              <KVRow label="Autenticação exigida" value={authLabel(env?.auth_method)} />
              <KVRow label="Criado em" value={fmtFull(env?.created_at)} />
              <KVRow label="Concluído em" value={fmtFull(env?.signed_at)} />
              <KVRow label="Situação" value={env?.status === 'signed' ? 'Assinado / concluído' : (env?.status || '-')} />

              <SectionTitle index="II" title={`Documentos vinculados (${docs.length})`} />
              {docs.length === 0 ? (
                <p style={{ margin: 0, fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.7, color: '#374151' }}>
                  Não há documentos individuais persistidos para este envelope.
                </p>
              ) : null}
              {docs.map((d, index) => {
                const docVerifyUrl = d.verification_code ? `${verifyPortalUrl}/${d.verification_code}` : verifyPortalUrl;
                const docKey = d.verification_code || d.document_key || String(index);
                const integrity = documentIntegrity[docKey];
                return (
                  <div key={index} className="break-inside-avoid" style={{ marginTop: 16, border: `1px solid ${HAIR}`, padding: '14px 18px' }}>
                    <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700, color: INK }}>
                        {d.display_name || d.document_key}
                      </span>
                      <StatusPill status={integrity?.status} />
                    </div>
                    <KVRow label="Tipo" value={d.document_type === 'main' ? 'Documento principal' : 'Documento anexo'} />
                    <KVRow label="Paginação" value={d.page_count ? `${d.page_count} página(s)` : 'Não informada'} />
                    <KVRow label="Origem do hash" value={d.hash_source === 'server' ? 'Calculado no servidor' : 'Calculado no cliente'} />
                    <KVRow label="Código de verificação individual" value={d.verification_code || '-'} mono />
                    <KVRow label="Consulta individual" value={<a href={docVerifyUrl} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>{docVerifyUrl}</a>} mono />
                    <KVRow label="SHA-256 do PDF assinado" value={d.signed_pdf_sha256 || '-'} mono />
                    <KVRow label="SHA-256 do documento-fonte" value={d.source_document_sha256 || '-'} mono />
                    <KVRow label="Hash atual do arquivo salvo" value={integrity?.currentHash || 'Não calculado'} mono />
                    <KVRow label="Situação da integridade" value={<StatusPill status={integrity?.status} />} />
                    <KVRow label="Observação" value={integrity?.error || 'Conferência sem divergência detectada.'} />
                  </div>
                );
              })}

              <SectionTitle index="III" title={`Signatários (${signers.length})`} />
              {signers.map((s, index) => {
                const assetKey = s.signer_verification_hash || s.email || s.name || String(index);
                const assets = signerAssets[assetKey];
                return (
                  <div key={index} className="break-inside-avoid" style={{ marginTop: 16, border: `1px solid ${HAIR}`, padding: '14px 18px' }}>
                    <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${HAIR}`, fontFamily: SERIF, fontSize: 15, fontWeight: 700, color: INK }}>
                      {s.name}
                    </div>
                    {(assets?.facialUrl || assets?.signatureUrl) ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 18, marginBottom: 18 }}>
                        {assets?.facialUrl ? (
                          <div style={{ flexShrink: 0 }}>
                            <div style={{ marginBottom: 6, fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Foto do signatário</div>
                            <div style={{ width: 180, height: 180, border: `1px solid ${HAIR}`, borderRadius: 3, overflow: 'hidden', background: '#f8fafc' }}>
                              <img src={assets.facialUrl} alt={`Foto de ${s.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </div>
                          </div>
                        ) : null}
                        {assets?.signatureUrl ? (
                          <div style={{ flex: '1 1 260px', minWidth: 260 }}>
                            <div style={{ marginBottom: 6, fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Assinatura capturada</div>
                            <div style={{ height: 180, border: `1px solid ${HAIR}`, borderRadius: 3, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                              <img src={assets.signatureUrl} alt={`Assinatura de ${s.name}`} style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', display: 'block' }} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <KVRow label="CPF" value={s.cpf || '-'} />
                    <KVRow label="E-mail" value={s.email || '-'} />
                    <KVRow label="Telefone" value={s.phone || '-'} />
                    <KVRow label="Papel" value={s.role || 'Signatário'} />
                    <KVRow label="Situação" value={s.status === 'signed' ? 'Assinado' : (s.status || '-')} />
                    <KVRow label="Autenticação aplicada" value={authLabel(s.auth_method, s.auth_provider)} />
                    <KVRow label="Conta autenticada" value={s.auth_provider === 'google' ? (s.auth_email || 'Conta Google sem e-mail retornado') : (s.auth_email || '-')} />
                    {s.auth_provider === 'google' ? (
                      <KVRow label="ID da conta Google" value={s.auth_google_sub || '-'} mono />
                    ) : null}
                    <KVRow label="Verificação facial" value={s.has_facial_biometrics ? 'Sim, com selfie capturada' : 'Não'} />
                    <KVRow label="Geolocalização" value={mapsUrl(s.geolocation) ? <a href={mapsUrl(s.geolocation)!} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>{s.geolocation}</a> : (s.geolocation || '-')} mono />
                    <KVRow label="Endereço IP" value={s.ip_address || '-'} mono />
                    <KVRow label="Dispositivo" value={parseUA(s.user_agent)} />
                    <KVRow label="Código de verificação do signatário" value={s.signer_verification_hash || '-'} mono />

                    {(() => {
                      const events = buildSignerEvents(s);
                      if (!events.length) return null;
                      return (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ marginBottom: 12, fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Trilha da assinatura (registro de eventos)</div>
                          <div style={{ position: 'relative', paddingLeft: 24 }}>
                            <div style={{ position: 'absolute', left: 5, top: 5, bottom: 5, width: 2, background: HAIR }} />
                            {events.map((ev, si) => {
                              const last = si === events.length - 1;
                              return (
                                <div key={si} className="break-inside-avoid" style={{ position: 'relative', paddingBottom: last ? 0 : 16 }}>
                                  <div style={{ position: 'absolute', left: -24, top: 2, width: 12, height: 12, borderRadius: '50%', background: last ? '#15803d' : INK, border: '2px solid #fff', boxShadow: `0 0 0 1px ${HAIR}` }} />
                                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: SANS, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fff', background: last ? '#15803d' : INK, padding: '2px 7px', borderRadius: 2 }}>
                                      {ev.label}
                                    </span>
                                    <span style={{ fontFamily: SANS, fontSize: 11, color: MUTED }}>{fmtFull(ev.at)}</span>
                                  </div>
                                  <div style={{ marginTop: 5, fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.55, color: INK, wordBreak: 'break-word' }}>{ev.detail}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              <SectionTitle index="IV" title={`Trilha cronológica de auditoria (${trail.length} eventos)`} />
              <div style={{ border: `1px solid ${HAIR}` }}>
                {trail.map((e, index) => (
                  <div key={index} className="break-inside-avoid" style={{ padding: '13px 16px', borderTop: index > 0 ? `1px solid ${HAIR}` : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: SANS, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fff', background: INK, padding: '2px 7px', borderRadius: 2 }}>
                        {e.action}
                      </span>
                      <span style={{ fontFamily: SANS, fontSize: 11, color: MUTED }}>
                        {fmtFull(e.created_at)}{e.ip_address ? ` · IP ${e.ip_address}` : ''}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.6, color: INK }}>{e.description}</div>
                    <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10.5, color: '#374151', wordBreak: 'break-word' }}>
                      hash: {e.entry_hash || '-'}
                    </div>
                    <div style={{ marginTop: 2, fontFamily: MONO, fontSize: 10.5, color: MUTED, wordBreak: 'break-word' }}>
                      anterior: {e.prev_hash || 'início da cadeia'}
                    </div>
                  </div>
                ))}
              </div>

              <SectionTitle index="V" title="Metodologia e conclusao" />
              <div style={{ border: `1px solid ${HAIR}`, padding: '16px 18px' }}>
                <p style={{ margin: 0, fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.75, color: '#374151', textAlign: 'justify' }}>
                  {report?.report?.methodology}
                </p>
                <p style={{ margin: '12px 0 0', fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.75, color: '#374151', textAlign: 'justify' }}>
                  O presente laudo deve ser lido em conjunto com o portal público de verificação, no qual o protocolo do envelope e os códigos individuais de documento permitem reprodução independente da consulta.
                </p>
                <p style={{ margin: '12px 0 0', fontFamily: SERIF, fontSize: 14, lineHeight: 1.75, fontWeight: 700, color: INK, textAlign: 'justify' }}>
                  Conclusão: {overallStatus === 'valid'
                    ? 'não há evidência de adulteração da trilha de auditoria examinada, nem divergência detectada na reconferência criptográfica dos arquivos assinados.'
                    : overallStatus === 'mismatch'
                      ? 'foram detectadas divergências de integridade que recomendam ressalva e revisão manual antes de uso probatório definitivo.'
                      : 'a conferência automática dos arquivos ainda não foi concluída; recomenda-se reemitir o laudo após a verificação completa.'}
                </p>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #d1d5db', padding: '16px 42px 20px', background: '#fafafa' }}>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div style={{ fontFamily: SANS, fontSize: 11, color: '#4b5563' }}>
                  Jurius | Documento emitido para conferência e preservação de prova digital.
                </div>
                <a href={verifyPortalUrl} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 11, color: '#1d4ed8', wordBreak: 'break-word' }}>
                  {verifyPortalUrl}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default ForensicDossier;
