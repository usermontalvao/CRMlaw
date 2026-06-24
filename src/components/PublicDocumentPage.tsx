import React, { useEffect, useRef, useState } from 'react';
import { BrandLogo } from './ui';
import {
  CheckCircle, Clock, Lock, Download, Eye, FileText, ShieldCheck,
  Copy, X, MapPin, Monitor, Wifi, ChevronDown, ExternalLink, Printer,
  Maximize2, Paperclip, FileSignature, Fingerprint,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Document, Page, pdfjs } from 'react-pdf';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import type { SignatureRequestWithSigners } from '../types/signature.types';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Props { token: string }

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const BRAND = '#ea580c';

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Manaus' });

const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' });

const parseDevice = (ua: string) => {
  const device  = /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : /iPad|Tablet/i.test(ua) ? 'Tablet' : 'Desktop';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Navegador';
  const os      = /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone/i.test(ua) ? 'iOS' : 'Linux';
  return `${device} · ${browser} · ${os}`;
};

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();

const isPlaceholderEmail = (e?: string | null) =>
  (e || '').toLowerCase().startsWith('public+') && (e || '').toLowerCase().endsWith('@crm.local');

// PDF embutido via <iframe> não renderiza em mobile (Android/iOS mostram só a
// 1ª página ou forçam download). Renderiza todas as páginas como canvas com
// react-pdf, escalando à largura do container — responsivo e com scroll único.
const isPdfUrl = (u?: string | null) => !!u && /\.pdf$/i.test(u.split('?')[0]);

const PdfCanvas: React.FC<{ url: string; dark?: boolean }> = ({ url, dark }) => {
  const [numPages, setNumPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(es => setW(Math.floor(es[0].contentRect.width)));
    ro.observe(wrapRef.current);
    setW(Math.floor(wrapRef.current.offsetWidth));
    return () => ro.disconnect();
  }, []);

  const pageW = w > 0 ? Math.min(w - 24, 900) : 0;

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', background: dark ? '#334155' : '#525659', WebkitOverflowScrolling: 'touch' }}>
      {failed ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>
          <p style={{ margin: '0 0 12px' }}>Não foi possível exibir o documento aqui.</p>
          <a href={url} target="_blank" rel="noopener noreferrer" style={ST.viewerBtnPrimary as React.CSSProperties}>Abrir em nova aba</a>
        </div>
      ) : (
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={() => setFailed(true)}
          loading={<div style={{ padding: 40, textAlign: 'center', color: '#cbd5e1', fontSize: 13 }}>Carregando documento…</div>}
          error={null}
        >
          {pageW > 0 && Array.from({ length: numPages }, (_, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: '12px 12px 0' }}>
              <div style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.4)', lineHeight: 0 }}>
                <Page
                  pageNumber={i + 1}
                  width={pageW}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={null}
                />
              </div>
            </div>
          ))}
          <div style={{ height: 12 }} />
        </Document>
      )}
    </div>
  );
};

/* ─── shared chrome ───────────────────────────────────────────────────────── */
const Navbar: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <nav className="no-print" style={ST.nav}>
    <div style={ST.navInner}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <BrandLogo iconOnly size="sm" />
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>JURIUS</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em' }}>ASSINATURA DIGITAL</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>{children}</div>
    </div>
  </nav>
);

const Footer = () => (
  <footer style={{ borderTop: '1px solid #e8eef3', background: '#fff', padding: '20px 16px', marginTop: 40 }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BrandLogo iconOnly size="xs" />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>JURIUS · Assinatura Digital Certificada</span>
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>Plataforma jurídica · MP 2.200-2/2001 · Lei 14.063/2020</span>
    </div>
  </footer>
);

/* ─── main component ──────────────────────────────────────────────────────── */
export default function PublicDocumentPage({ token }: Props) {
  const [req,        setReq]        = useState<SignatureRequestWithSigners | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [signedUrl,  setSignedUrl]  = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [qrMap,      setQrMap]      = useState<Record<string, string>>({});
  const [copied,     setCopied]     = useState(false);
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [viewerUrl,      setViewerUrl]      = useState<string | null>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null);

  // Roteia as leituras de storage (incl. getSignedPdfUrl) pela edge
  // token-scoped, sem acesso anon direto aos buckets.
  useEffect(() => {
    pdfSignatureService.setPublicFileResolver((path) => signatureService.getPublicFileUrl(token, path));
    return () => pdfSignatureService.setPublicFileResolver(null);
  }, [token]);

  // Resolve um path de documento via edge token-scoped, com fallback para o
  // caminho anon antigo enquanto o acesso anon ainda estiver aberto (pré-migration 3).
  const resolveDocUrl = async (path: string): Promise<string | null> => {
    const viaEdge = await signatureService.getPublicFileUrl(token, path).catch(() => null);
    if (viaEdge) return viaEdge;
    return signatureService.getDocumentPreviewUrl(path).catch(() => null);
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await signatureService.getRequestByToken(token);
        if (!data) { setError('not_found'); return; }
        if ((data as any).blocked_at) { setError('blocked'); return; }
        setReq(data);

        const latestSigned = [...data.signers]
          .filter(s => s.status === 'signed' && s.signed_document_path)
          .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime())[0];

        if (latestSigned?.signed_document_path) {
          const url = await pdfSignatureService.getSignedPdfUrl(latestSigned.signed_document_path).catch(() => null);
          if (url) { setSignedUrl(url); setPreviewUrl(url); }
        } else if (data.document_path && !/\.(docx?|doc)$/i.test(data.document_path)) {
          const url = await resolveDocUrl(data.document_path);
          if (url) setPreviewUrl(url);
        }

        const qrs: Record<string, string> = {};
        for (const s of data.signers) {
          if (s.verification_hash) {
            const vu = `${window.location.origin}/#/verificar/${s.verification_hash}`;
            qrs[s.id] = await QRCode.toDataURL(vu, { width: 160, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }).catch(() => '');
          }
        }
        setQrMap(qrs);
      } catch {
        setError('load_error');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const toggle = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const copyLink = () =>
    navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2200); });

  const downloadPdf = () => {
    if (!signedUrl) return;
    const a = document.createElement('a'); a.href = signedUrl; a.download = `${req?.document_name || 'documento'}.pdf`; a.click();
  };

  // Print: fetch PDF as blob → same-origin blob URL → iframe.contentWindow.print()
  // This avoids both the cross-origin block AND exposing the Supabase URL.
  const handlePrint = async (url?: string) => {
    const target = url || previewUrl;
    if (!target) return;
    try {
      const resp = await fetch(target);
      if (!resp.ok) throw new Error('Falha ao baixar PDF para impressão');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);

      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;visibility:hidden;';
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Rare fallback — should not happen with blob URLs
          window.open(blobUrl, '_blank');
        }
        // Cleanup after a minute (print dialog may stay open)
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch { /* already removed */ }
          URL.revokeObjectURL(blobUrl);
        }, 60_000);
      };
      iframe.src = blobUrl;
    } catch (e: any) {
      console.error('Erro ao imprimir:', e);
    }
  };

  /* ── loading ── */
  if (loading) return (
    <div style={ST.centered}>
      <style>{CSS}</style>
      <div style={ST.spinner} />
      <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', fontWeight: 500 }}>Carregando documento…</p>
    </div>
  );

  /* ── error / blocked ── */
  if (error || !req) {
    const blocked = error === 'blocked';
    return (
      <div style={{ minHeight: '100vh', background: '#eef2f6', display: 'flex', flexDirection: 'column', fontFamily: ST.font }}>
        <style>{CSS}</style>
        <Navbar />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={ST.stateCard}>
            {/* Glow ring */}
            <div style={{ position: 'relative', width: 88, height: 88, margin: '0 auto 22px' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: blocked ? 'rgba(239,68,68,0.10)' : 'rgba(100,116,139,0.10)' }} />
              <div style={{ position: 'absolute', inset: 12, borderRadius: '50%', background: blocked ? 'rgba(239,68,68,0.14)' : 'rgba(100,116,139,0.14)' }} />
              <div style={{ position: 'absolute', inset: 24, borderRadius: '50%', background: blocked ? '#fef2f2' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${blocked ? '#fecaca' : '#e2e8f0'}` }}>
                {blocked ? <Lock style={{ width: 22, height: 22, color: '#dc2626' }} /> : <FileText style={{ width: 22, height: 22, color: '#64748b' }} />}
              </div>
            </div>

            <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              {blocked ? 'Documento protegido' : 'Documento não encontrado'}
            </h1>
            <p style={{ margin: '0 auto 8px', fontSize: 14, color: '#64748b', lineHeight: 1.65, maxWidth: 380 }}>
              {blocked
                ? 'O escritório responsável desativou o acesso público a este documento.'
                : 'O link informado é inválido ou o documento não está mais disponível.'}
            </p>
            {blocked && (
              <p style={{ margin: '0 auto 24px', fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, maxWidth: 380 }}>
                A assinatura permanece registrada e <strong style={{ color: '#64748b' }}>auditável</strong>. Use o código de verificação no rodapé do documento para confirmar sua autenticidade a qualquer momento.
              </p>
            )}

            <a href={`${window.location.origin}/#/verificar`} style={ST.statePrimaryBtn} className="btn-hover">
              <ShieldCheck style={{ width: 16, height: 16 }} />
              Verificar autenticidade por código
            </a>

            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f1f5f9', fontSize: 11.5, color: '#94a3b8' }}>
              Protegido por <strong style={{ color: '#64748b' }}>JURIUS</strong> · Assinatura Digital Certificada
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const allSigned  = req.signers.length > 0 && req.signers.every(s => s.status === 'signed');
  const signedCnt  = req.signers.filter(s => s.status === 'signed').length;
  const totalCnt   = req.signers.length;
  const pct        = totalCnt > 0 ? Math.round((signedCnt / totalCnt) * 100) : 0;
  const isWordFile = (p: string) => /\.(docx?|doc)$/i.test(p);
  const attachments: string[] = ((req as any).attachment_paths as string[] ?? []).filter(p => !isWordFile(p));

  const accent = allSigned ? '#16a34a' : '#d97706';
  const accentBg = allSigned ? '#f0fdf4' : '#fffbeb';
  const accentBd = allSigned ? '#bbf7d0' : '#fde68a';

  return (
    <div className="jurius-page-root" style={{ minHeight: '100vh', background: '#eef2f6', fontFamily: ST.font }}>
      <style>{CSS}</style>

      {/* ══ FULLSCREEN VIEWER ══ */}
      {viewerUrl && (
        <div className="jurius-fullscreen-viewer" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,23,42,0.85)', display: 'flex', flexDirection: 'column', backdropFilter: 'blur(6px)' }}>
          <div className="jurius-fullscreen-toolbar" style={{ height: 54, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', flexShrink: 0, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <FileText style={{ width: 16, height: 16, color: BRAND, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.document_name}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handlePrint(viewerUrl!)} style={ST.viewerBtnGhost}>
                <Printer style={{ width: 13, height: 13 }} />Imprimir
              </button>
              {signedUrl && viewerUrl === previewUrl && (
                <button onClick={downloadPdf} style={ST.viewerBtnPrimary}><Download style={{ width: 13, height: 13 }} />Baixar</button>
              )}
              <button onClick={() => setViewerUrl(null)} style={ST.viewerIconBtn}><X style={{ width: 16, height: 16, color: '#cbd5e1' }} /></button>
            </div>
          </div>
          {isPdfUrl(viewerUrl) ? (
            <PdfCanvas url={viewerUrl} dark />
          ) : (
            <iframe ref={fullscreenIframeRef} src={viewerUrl + '#toolbar=0&navpanes=0'} style={{ flex: 1, width: '100%', border: 'none', background: '#525659' }} title="Documento" />
          )}
        </div>
      )}

      {/* ══ NAVBAR ══ */}
      <Navbar>
        <button onClick={copyLink} style={copied ? ST.btnCopied : ST.btnGhost} className="btn-hover">
          {copied ? <CheckCircle style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
          <span className="hide-sm">{copied ? 'Copiado!' : 'Copiar link'}</span>
        </button>
        {previewUrl && (
          <button onClick={() => handlePrint(previewUrl)} style={ST.btnGhost} className="btn-hover">
            <Printer style={{ width: 14, height: 14 }} /><span className="hide-sm">Imprimir</span>
          </button>
        )}
        {signedUrl && (
          <button onClick={downloadPdf} style={ST.btnPrimary} className="btn-hover">
            <Download style={{ width: 14, height: 14 }} /><span className="hide-sm">Baixar PDF</span>
          </button>
        )}
      </Navbar>

      {/* ══ STATUS RIBBON ══ */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e8eef3' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ ...ST.fileGlyph, borderColor: accentBd, background: accentBg }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, background: accentBd, borderBottomLeftRadius: 6 }} />
            <FileSignature style={{ width: 20, height: 20, color: accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ margin: '0 0 5px', fontSize: 19, fontWeight: 800, color: '#0f172a', lineHeight: 1.3, letterSpacing: '-0.01em' }}>{req.document_name}</h1>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 12.5, color: '#64748b' }}>
              <span>Criado em {fmtDate(req.created_at)}</span>
              {req.client_name && <span>· {req.client_name}</span>}
            </div>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 99, fontSize: 13, fontWeight: 700, color: accent, background: accentBg, border: `1.5px solid ${accentBd}` }}>
            {allSigned ? <CheckCircle style={{ width: 15, height: 15 }} /> : <Clock style={{ width: 15, height: 15 }} />}
            {allSigned ? 'Documento assinado' : `Aguardando · ${signedCnt}/${totalCnt}`}
          </span>
        </div>
      </div>

      {/* ══ MAIN GRID ══ */}
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px' }}>
        <div className="doc-layout">

          {/* ── LEFT: Document preview ── */}
          <div className="doc-preview">
            <div style={ST.previewShell}>
              {/* Preview toolbar */}
              <div style={ST.previewBar}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: '#cbd5e1', minWidth: 0 }}>
                  <FileText style={{ width: 13, height: 13, color: BRAND, flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Documento</span>
                </span>
                {previewUrl && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setViewerUrl(previewUrl)} style={ST.previewBtn} className="btn-hover" title="Tela cheia">
                      <Maximize2 style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={() => handlePrint(previewUrl!)} style={ST.previewBtn} className="btn-hover" title="Imprimir">
                      <Printer style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                )}
              </div>
              {/* Preview body */}
              {previewUrl ? (
                <PdfCanvas url={previewUrl} />
              ) : (
                <div style={ST.previewEmpty}>
                  <FileText style={{ width: 40, height: 40, color: '#cbd5e1' }} />
                  <p style={{ margin: '12px 0 0', fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
                    {allSigned ? 'Pré-visualização indisponível' : 'O documento ainda não foi assinado'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Sidebar ── */}
          <aside className="doc-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Progress card */}
            {totalCnt > 0 && (
              <div style={ST.card}>
                <div style={{ padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>{signedCnt} de {totalCnt} {totalCnt === 1 ? 'assinante' : 'assinantes'}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: accent, letterSpacing: '-0.02em' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, ${allSigned ? '#4ade80' : '#fbbf24'})`, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
                {(signedUrl || attachments.length > 0) && (
                  <div style={{ borderTop: '1px solid #f1f5f9', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {signedUrl && (
                      <button onClick={() => setViewerUrl(previewUrl)} style={ST.sideBtnPrimary} className="btn-hover">
                        <Eye style={{ width: 14, height: 14 }} />Visualizar documento assinado
                      </button>
                    )}
                    {attachments.map((path, i) => {
                      const raw  = path.split('/').pop() ?? `Anexo ${i + 1}`;
                      const name = raw.replace(/^\d{10,}_/, '').replace(/_\d{10,}[_.]/g, (m) => m[m.length - 1]);
                      return (
                        <button key={path} onClick={async () => {
                          const url = await resolveDocUrl(path);
                          if (url) setViewerUrl(url);
                        }} style={ST.sideBtnGhost} className="btn-hover">
                          <Paperclip style={{ width: 13, height: 13, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || `Anexo ${i + 1}`}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Signers */}
            <div style={ST.card}>
              <div style={ST.cardHead}>
                <span style={ST.cardHeadLabel}>Signatários</span>
                <span style={ST.countPill}>{totalCnt}</span>
              </div>
              <div>
                {req.signers.map((signer, idx) => {
                  const signed = signer.status === 'signed';
                  const open   = expanded.has(signer.id);
                  const geo    = signer.signer_geolocation?.split(',').map(s => s.trim());
                  const contact = (() => {
                    const ae = (signer.auth_email || '').trim();
                    const ph = (signer.phone || '').trim();
                    const re = (signer.email || '').trim();
                    return ae || (signer.auth_provider === 'phone' ? ph : '') || (!isPlaceholderEmail(re) ? re : '') || '';
                  })();
                  const authItems = [
                    signer.signature_image_path  && 'Assinatura manuscrita',
                    signer.facial_image_path     && 'Biometria facial',
                    signer.auth_provider === 'google'     && 'Google OAuth',
                    signer.auth_provider === 'email_link' && 'E-mail OTP',
                    signer.auth_provider === 'phone'      && 'SMS OTP',
                    signer.signer_geolocation             && 'Geolocalização GPS',
                    signer.signer_ip                      && 'IP registrado',
                  ].filter(Boolean) as string[];
                  const verifyUrl = signer.verification_hash ? `${window.location.origin}/#/verificar/${signer.verification_hash}` : null;
                  const last = idx === req.signers.length - 1;

                  return (
                    <div key={signer.id} style={{ borderBottom: !last || open ? '1px solid #f1f5f9' : 'none' }}>
                      <button onClick={() => signed && toggle(signer.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: signed ? 'pointer' : 'default', textAlign: 'left' }}>
                        {/* Avatar with status ring */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ width: 40, height: 40, borderRadius: '50%', background: signed ? '#ecfdf5' : '#f8fafc', border: `2px solid ${signed ? '#6ee7b7' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: signed ? '#047857' : '#94a3b8' }}>
                            {initials(signer.name)}
                          </div>
                          <div style={{ position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: signed ? '#16a34a' : signer.viewed_at ? '#d97706' : '#94a3b8', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {signed ? <CheckCircle style={{ width: 9, height: 9, color: '#fff' }} /> : signer.viewed_at ? <Eye style={{ width: 8, height: 8, color: '#fff' }} /> : <Clock style={{ width: 8, height: 8, color: '#fff' }} />}
                          </div>
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signer.name}</p>
                          <p style={{ margin: '1px 0 0', fontSize: 11.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {signed && signer.signed_at ? `Assinou em ${fmtDateTime(signer.signed_at)}` : contact || signer.role || 'Aguardando assinatura'}
                          </p>
                        </div>
                        {signed
                          ? <ChevronDown style={{ width: 15, height: 15, color: '#cbd5e1', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                          : <span style={{ fontSize: 10, fontWeight: 700, color: signer.viewed_at ? '#d97706' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{signer.viewed_at ? 'Visto' : 'Pendente'}</span>}
                      </button>

                      {/* Expanded */}
                      {signed && open && (
                        <div style={{ padding: '4px 16px 18px', background: '#fafbfc' }}>
                          {/* Data rows */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 14, background: '#fff', borderRadius: 10, border: '1px solid #eef2f6', overflow: 'hidden' }}>
                            {[
                              signer.cpf           && ['CPF', signer.cpf, null],
                              signer.signed_at     && ['Data / Hora', fmtDateTime(signer.signed_at), null],
                              signer.signer_ip     && ['IP', signer.signer_ip, <Wifi style={{ width: 11, height: 11 }} />],
                              geo?.[0] && geo?.[1] && ['Local', `${geo[0]}, ${geo[1]}`, <MapPin style={{ width: 11, height: 11 }} />],
                              signer.signer_user_agent && ['Dispositivo', parseDevice(signer.signer_user_agent), <Monitor style={{ width: 11, height: 11 }} />],
                            ].filter(Boolean).map((row: any, i, arr) => (
                              <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 12px', borderBottom: i < arr.length - 1 ? '1px solid #f5f7fa' : 'none' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#94a3b8', fontWeight: 600, minWidth: 78, flexShrink: 0 }}>{row[2]}{row[0]}</span>
                                <span style={{ fontSize: 11.5, color: '#334155', fontWeight: 500, wordBreak: 'break-all', fontFamily: ['CPF','IP','Local'].includes(row[0]) ? 'monospace' : 'inherit' }}>{row[1]}</span>
                              </div>
                            ))}
                          </div>

                          {/* Auth factors */}
                          {authItems.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                              <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <Fingerprint style={{ width: 11, height: 11 }} />Autenticação
                              </p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {authItems.map((a, i) => (
                                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 10.5, fontWeight: 600, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                                    <CheckCircle style={{ width: 9, height: 9 }} />{a}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Verification + QR */}
                          {signer.verification_hash && (
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 10, background: '#fff', border: '1px solid #eef2f6' }}>
                              {qrMap[signer.id] && (
                                <img src={qrMap[signer.id]} alt="QR" style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 6, border: '1px solid #f1f5f9' }} />
                              )}
                              <div style={{ minWidth: 0 }}>
                                <p style={{ margin: '0 0 2px', fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Código de verificação</p>
                                <p style={{ margin: 0, fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: '#0f172a', letterSpacing: '0.06em' }}>{signer.verification_hash}</p>
                                {verifyUrl && (
                                  <a href={verifyUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 10.5, color: BRAND, textDecoration: 'none', fontWeight: 700 }}>
                                    <ExternalLink style={{ width: 10, height: 10 }} />Verificar
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Validity */}
            <div style={{ ...ST.card, background: 'linear-gradient(135deg, #fffbf7, #fff)' }}>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: '#fff7ed', border: '1px solid #fed7aa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ShieldCheck style={{ width: 17, height: 17, color: BRAND }} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Validade jurídica</p>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                  Assinatura eletrônica com validade jurídica conforme a <strong>MP 2.200-2/2001</strong> e a <strong>Lei 14.063/2020</strong>.
                </p>
                <div style={{ paddingTop: 12, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>ID {req.id.slice(0, 8)}</span>
                  <a href={`${window.location.origin}/#/verificar`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: BRAND, textDecoration: 'none', fontWeight: 700, flexShrink: 0 }}>
                    <ShieldCheck style={{ width: 12, height: 12 }} />Portal de verificação
                  </a>
                </div>
              </div>
            </div>

          </aside>
        </div>
      </main>

      <Footer />
    </div>
  );
}

/* ─── styles ──────────────────────────────────────────────────────────────── */
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const ST = {
  font: FONT,
  centered: { minHeight: '100vh', background: '#eef2f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 24, fontFamily: 'Inter, sans-serif' },
  spinner: { width: 40, height: 40, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#ea580c', animation: 'spin 0.8s linear infinite' },
  nav: { background: '#fff', borderBottom: '1px solid #e8eef3', position: 'sticky', top: 0, zIndex: 50 },
  navInner: { maxWidth: 1180, margin: '0 auto', padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  logoMark: { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg, #ea580c, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(234,88,12,0.25)' },
  logoMarkSm: { width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg, #ea580c, #f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  fileGlyph: { width: 46, height: 46, borderRadius: 11, border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', overflow: 'hidden' },
  card: { background: '#fff', borderRadius: 14, border: '1px solid #e8eef3', boxShadow: '0 1px 3px rgba(15,23,42,0.04)', overflow: 'hidden' },
  cardHead: { padding: '13px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 },
  cardHeadLabel: { fontSize: 11, fontWeight: 800, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase' },
  countPill: { fontSize: 10.5, fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '1px 8px', borderRadius: 99 },
  previewShell: { background: '#1e293b', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(15,23,42,0.10)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 80, height: 'calc(100vh - 200px)', minHeight: 480 },
  previewBar: { height: 44, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0, gap: 10 },
  previewBtn: { width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)', color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  previewFrame: { flex: 1, width: '100%', border: 'none', background: '#525659' },
  previewEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' },
  stateCard: { background: '#fff', borderRadius: 22, padding: '44px 40px', maxWidth: 460, width: '100%', textAlign: 'center', border: '1px solid #e8eef3', boxShadow: '0 8px 40px rgba(15,23,42,0.08)' },
  statePrimaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 11, fontSize: 13.5, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, #ea580c, #f97316)', border: 'none', cursor: 'pointer', textDecoration: 'none', boxShadow: '0 4px 14px rgba(234,88,12,0.28)' },
  btnGhost: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.15s' },
  btnCopied: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #86efac', cursor: 'pointer', transition: 'all 0.15s' },
  btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#fff', background: '#ea580c', border: 'none', cursor: 'pointer', transition: 'all 0.15s' },
  sideBtnPrimary: { width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, color: '#fff', background: '#ea580c', border: 'none', cursor: 'pointer', transition: 'all 0.15s' },
  sideBtnGhost: { width: '100%', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#475569', background: '#f8fafc', border: '1px solid #e8eef3', cursor: 'pointer', transition: 'all 0.15s' },
  viewerBtnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#fff', background: '#ea580c', border: 'none', cursor: 'pointer' },
  viewerBtnGhost: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#cbd5e1', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer' },
  viewerIconBtn: { width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
} as Record<string, React.CSSProperties> & { font: string };

const CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  * { box-sizing: border-box; }
  .doc-layout { display: grid; grid-template-columns: 1fr 384px; gap: 20px; align-items: start; }
  @media (max-width: 920px) {
    .doc-layout { grid-template-columns: 1fr; }
    .doc-preview { order: 2; }
    .doc-sidebar { order: 1; }
    .doc-preview [style*="position: sticky"], .doc-preview > div { position: relative !important; top: auto !important; height: 70vh !important; }
  }
  @media (max-width: 560px) { .hide-sm { display: none; } }
  .btn-hover:hover { opacity: 0.9; transform: translateY(-1px); }

  @media print { .no-print { display: none !important; } }
`;
