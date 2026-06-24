import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Camera, Check, CheckCircle, ChevronLeft, Clock, Copy, Download, ExternalLink, Eye, FileText, Loader2, Lock, MapPin, PenTool, RotateCcw, Share2, User, X, Shield, AlertTriangle, Mail } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';
import { buildWhatsappUrl } from '../utils/whatsapp';
import { SIGNATURE_TERMS_VERSION, SIGNATURE_TERMS_TITLE, SIGNATURE_TERMS_TEXT, SELFIE_PROFILE_CONSENT_VERSION, SELFIE_PROFILE_CONSENT_LABEL, parseSignatureTermsText } from '../constants/signatureTerms';
import { googleAuthService, type GoogleUser } from '../services/googleAuth.service';
import { useToastContext } from '../contexts/ToastContext';
import type { SignDocumentDTO, SignatureAuditLog, SignatureField, Signer, SignatureRequest } from '../types/signature.types';
import SignatureReport from './SignatureReport';
import { renderAsync } from 'docx-preview';
import { Document, Page, pdfjs } from 'react-pdf';
import { supabase } from '../config/supabase';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PublicSigningPageProps {
  token: string;
}

type SigningStep = 'loading' | 'success' | 'error' | 'already_signed';
type ModalStep = 'google_auth' | 'phone_otp' | 'email_otp' | 'data' | 'signature' | 'location' | 'facial' | 'confirm';

type PublicAuthConfig = { google: boolean; email: boolean; phone: boolean };

interface SignerData {
  name: string;
  cpf: string;
  phone: string;
}

interface FacialAIValidationResult {
  valid: boolean;
  score: number;
  issues: string[];
  message: string;
}

const formatCpf = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  const part1 = digits.slice(0, 3);
  const part2 = digits.slice(3, 6);
  const part3 = digits.slice(6, 9);
  const part4 = digits.slice(9, 11);

  let formatted = part1;
  if (part2) formatted += `.${part2}`;
  if (part3) formatted += `.${part3}`;
  if (part4) formatted += `-${part4}`;
  return formatted;
};

// ── Rascunho do fluxo público de assinatura ──────────────────────────────────
// Persiste o progresso no localStorage por até 24h (sobrevive a refresh/fechar a
// aba) e é apagado assim que o documento é assinado. Por segurança/LGPD NÃO
// guarda a identidade verificada (OTP/Google) — refeita a cada sessão — nem a
// selfie (biometria). O OTP obrigatório é o cadeado que protege os demais dados.
const SIGNING_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface SigningDraft {
  signerData: SignerData;
  signatureData: string | null;
  locationData: { lat: number; lng: number } | null;
}

const readSigningDraft = (key: string): SigningDraft | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(key); // expirado → descarta
      return null;
    }
    const sd = parsed.signerData ?? {};
    const loc = parsed.locationData;
    return {
      signerData: {
        name: typeof sd.name === 'string' ? sd.name : '',
        cpf: typeof sd.cpf === 'string' ? sd.cpf : '',
        phone: typeof sd.phone === 'string' ? sd.phone : '',
      },
      signatureData: typeof parsed.signatureData === 'string' ? parsed.signatureData : null,
      locationData:
        loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
          ? { lat: loc.lat, lng: loc.lng }
          : null,
    };
  } catch {
    return null;
  }
};

const writeSigningDraft = (key: string, draft: SigningDraft): void => {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...draft, expiresAt: Date.now() + SIGNING_DRAFT_TTL_MS }),
    );
  } catch { /* storage indisponível — ignora */ }
};

const clearSigningDraft = (key: string): void => {
  try { window.localStorage.removeItem(key); } catch { /* ignora */ }
};

// Número lógico da etapa (1–6) para o indicador do cabeçalho do modal.
const signStepNumber = (s: ModalStep): number =>
  (s === 'google_auth' || s === 'phone_otp' || s === 'email_otp') ? 1
  : s === 'data' ? 2
  : s === 'signature' ? 3
  : s === 'location' ? 4
  : s === 'facial' ? 5
  : 6;

// Stepper visual do fluxo de assinatura: círculos com ícone ligados por linhas.
const SIGN_STEPS: { icon: React.ElementType; label: string }[] = [
  { icon: Shield,      label: 'Identidade' },
  { icon: User,        label: 'Dados' },
  { icon: PenTool,     label: 'Assinatura' },
  { icon: MapPin,      label: 'Localização' },
  { icon: Camera,      label: 'Foto' },
  { icon: CheckCircle, label: 'Confirmar' },
];

const SignStepper: React.FC<{ current: number }> = ({ current }) => (
  <div className="flex-shrink-0 bg-[#f8f7f5] px-5 pt-5 pb-1">
    <div className="flex items-start">
      {SIGN_STEPS.map((st, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        const isLast = i === SIGN_STEPS.length - 1;
        const Icon = st.icon;
        return (
          <div key={n} className="relative flex-1 flex flex-col items-center">
            {/* Linha conectora até o próximo nó */}
            {!isLast && (
              <div
                className={`absolute top-4 left-1/2 w-full h-[2px] -translate-y-1/2 transition-colors ${
                  done ? 'bg-orange-500' : 'bg-slate-200'
                }`}
              />
            )}
            {/* Nó (círculo com ícone) */}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                done
                  ? 'bg-orange-500 text-white'
                  : active
                    ? 'bg-white text-orange-600 border-2 border-orange-500 shadow-sm shadow-orange-500/20'
                    : 'bg-white text-slate-300 border border-slate-200'
              }`}
            >
              {done ? (
                <Check className="w-4 h-4" strokeWidth={3} />
              ) : (
                <Icon className="w-[15px] h-[15px]" strokeWidth={2} />
              )}
            </div>
            {/* Rótulo */}
            <span
              className={`mt-1.5 text-[10px] font-semibold tracking-tight text-center leading-tight ${
                active ? 'text-slate-700' : done ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              {st.label}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

// Caixa de seleção laranja (etapa de confirmação). O visual é controlado pelo
// estado React — não depende do pseudo `:checked`, garantindo o fundo laranja +
// check branco ao marcar (e branco/cinza quando desmarcado).
const OrangeCheckbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span
    aria-hidden="true"
    className="flex items-center justify-center flex-shrink-0 rounded-md border-2 transition-colors"
    style={{
      width: 20,
      height: 20,
      backgroundColor: checked ? '#f97316' : '#ffffff',
      borderColor: checked ? '#f97316' : '#d1d5db',
    }}
  >
    {checked && <Check className="w-3 h-3 text-white" strokeWidth={3.5} />}
  </span>
);

// Componente que renderiza todas as páginas de um PDF como canvas (sem iframe, sem scroll duplo)
interface PdfRendererProps {
  url: string;
  onLoad?: () => void;
}
const PdfRenderer: React.FC<PdfRendererProps> = ({ url, onLoad }) => {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(containerRef.current);
    setContainerWidth(Math.floor(containerRef.current.offsetWidth));
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full bg-[#f8f7f5]">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => { setNumPages(n); onLoad?.(); }}
        loading={null}
        error={null}
      >
        {containerWidth > 0 && Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i}
            pageNumber={i + 1}
            width={containerWidth}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="block"
          />
        ))}
      </Document>
    </div>
  );
};

// Componente auxiliar para renderizar a lista de documentos anexos
interface AttachmentsListProps {
  attachments: { name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[];
  attachmentRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

const AttachmentsList: React.FC<AttachmentsListProps> = ({ attachments, attachmentRefs }) => {
  if (attachments.length === 0) return null;
  return (
    <div>
      {attachments.map((attach, idx) => {
        const nameLower = attach.name.toLowerCase().split('?')[0];
        const isPdf = nameLower.endsWith('.pdf');
        const isImg = nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.png') || nameLower.endsWith('.gif') || nameLower.endsWith('.webp') || nameLower.endsWith('.bmp');
        return (
          <div key={`attach-${idx}`}>
            {attach.isDocx ? (
              // DOCX: div preenchida pelo renderAsync
              <div
                ref={el => { attachmentRefs.current[idx] = el; }}
                className="bg-[#f8f7f5] docx-responsive"
                style={{ width: '100%', overflow: 'auto' }}
              />
            ) : isPdf ? (
              // PDF: canvas via react-pdf, sem iframe, sem scroll interno
              <PdfRenderer url={attach.url} />
            ) : isImg ? (
              // Imagem: tag <img> sem decoração
              <img
                src={attach.url}
                alt={attach.name}
                className="w-full h-auto block"
                style={{ maxWidth: '100%' }}
              />
            ) : (
              // Outro tipo: link para download
              <div className="p-4 text-center">
                <a
                  href={attach.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
                >
                  <Download className="w-4 h-4" />
                  Baixar {attach.name}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── Inject loading animation keyframes once at module load (never remounts) ───
(() => {
  const styleId = 'public-signing-loading-animations';
  if (typeof document === 'undefined' || document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes iconBreath {
      0%, 100% { transform: scale(1);    box-shadow: 0 0 0 0   rgba(194,65,12,0.14), 0 16px 40px -8px rgba(194,65,12,0.30); }
      50%       { transform: scale(1.04); box-shadow: 0 0 0 10px rgba(194,65,12,0),   0 20px 48px -8px rgba(194,65,12,0.40); }
    }
    @keyframes ringPulse {
      0%   { transform: scale(1);   opacity: 0.45; }
      100% { transform: scale(1.75); opacity: 0; }
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes arcSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes docPass {
      0%   { transform: translateX(0) translateY(0) rotate(var(--doc-rot)); opacity: 0; }
      8%   { opacity: 1; }
      88%  { opacity: 0.85; }
      100% { transform: translateX(var(--doc-tx)) translateY(var(--doc-ty)) rotate(var(--doc-rot-end)); opacity: 0; }
    }
    @keyframes shimmerBar {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(600%);  }
    }
    @keyframes progressPulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.7; }
    }
  `;
  document.head.appendChild(style);
})();

// ─── LoadingScreen — defined at MODULE level so React never remounts it ────────
const LOADING_STEPS = [
  { label: 'Validando credenciais de acesso', doneAt: 1.8 },
  { label: 'Carregando seu documento',        doneAt: 4.2 },
  { label: 'Preparando ambiente seguro',      doneAt: 9.0 },
];

const FLOATING_DOCS = [
  { delay: '0s',    dur: '3.2s', tx: '160px', ty: '-18px', rot: '-6deg',  rotEnd: '2deg',  left: '-20px', top: '22px',  w: '64px' },
  { delay: '1.1s',  dur: '3.4s', tx: '170px', ty: '10px',  rot: '4deg',   rotEnd: '-3deg', left: '-10px', top: '6px',   w: '58px' },
  { delay: '2.0s',  dur: '3.0s', tx: '165px', ty: '-8px',  rot: '-2deg',  rotEnd: '5deg',  left: '-16px', top: '34px',  w: '60px' },
  { delay: '0.55s', dur: '3.6s', tx: '155px', ty: '14px',  rot: '6deg',   rotEnd: '-4deg', left: '-24px', top: '14px',  w: '62px' },
  { delay: '1.7s',  dur: '3.1s', tx: '158px', ty: '-12px', rot: '-4deg',  rotEnd: '3deg',  left: '-18px', top: '28px',  w: '56px' },
];

const LoadingScreen: React.FC<{ docName?: string; allDocNames?: string[]; signerName?: string }> = ({ docName, allDocNames, signerName }) => {
  const [elapsed, setElapsed] = useState(0);
  const mountRef = useRef(Date.now());
  // Guarda o nome assim que chegar — nunca volta para vazio
  const [resolvedName, setResolvedName] = useState(signerName || '');
  useEffect(() => {
    if (signerName && !resolvedName) setResolvedName(signerName);
  }, [signerName, resolvedName]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed((Date.now() - mountRef.current) / 1000);
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  const pct       = Math.min(96, (elapsed / 10) * 96);
  const firstName = resolvedName ? resolvedName.split(' ')[0] : '';

  return (
    <div className="min-h-[100dvh] flex flex-col select-none overflow-hidden" style={{ background: '#f8fafc' }}>

      {/* ── Faixa laranja fixa no topo — identidade JURIUS ── */}
      <div className="h-[4px] w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, #ea580c 0%, #f97316 45%, #fb923c 100%)' }} />

      {/* ── Barra de progresso ── */}
      <div className="h-[3px] w-full flex-shrink-0 relative overflow-hidden" style={{ background: '#e2e8f0' }}>
        <div
          className="absolute left-0 top-0 h-full"
          style={{ width: `${pct}%`, transition: 'width 200ms ease-out', background: 'linear-gradient(90deg, #c2410c 0%, #ea580c 60%, #f97316 100%)' }}
        />
        <div
          className="absolute top-0 h-full w-[80px] pointer-events-none"
          style={{
            left: `${Math.max(0, pct - 8)}%`,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
            animation: 'shimmerBar 1.8s ease-in-out infinite',
          }}
        />
      </div>

      {/* ── Conteúdo central ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">

        {/* Logomarca / Ícone com ripple */}
        <div className="relative flex items-center justify-center mb-5" style={{ animation: 'fadeUp 0.5s ease-out both' }}>
          <div className="absolute w-[88px] h-[88px] rounded-full" style={{ border: '1.5px solid rgba(234,88,12,0.20)', animation: 'ringPulse 2.6s ease-out infinite' }} />
          <div className="absolute w-[88px] h-[88px] rounded-full" style={{ border: '1.5px solid rgba(234,88,12,0.10)', animation: 'ringPulse 2.6s ease-out infinite 0.9s' }} />
          <div
            className="relative w-[64px] h-[64px] rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, #9a3412 0%, #c2410c 50%, #ea580c 100%)',
              boxShadow: '0 12px 32px -6px rgba(194,65,12,0.40), 0 0 0 1px rgba(234,88,12,0.12)',
              animation: 'iconBreath 3.2s ease-in-out infinite',
            }}
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
        </div>

        {/* Eyebrow — laranja da marca */}
        <p className="text-[10px] font-bold tracking-[0.22em] uppercase mb-3" style={{ color: '#ea580c', animation: 'fadeUp 0.5s ease-out 0.10s both' }}>
          Assinatura Digital · JURIUS
        </p>

        {/* Título */}
        <div style={{ animation: 'fadeUp 0.45s ease-out both', textAlign: 'center' }}>
          <h1 className="text-[23px] font-bold tracking-tight text-center mb-1.5" style={{ color: '#0f172a', letterSpacing: '-0.3px' }}>
            Carregando documento
          </h1>
          <p className="text-[13px] text-center leading-relaxed" style={{ maxWidth: 270, color: '#94a3b8' }}>
            Autenticando sessão e preparando<br />o ambiente seguro.
          </p>
        </div>

        {/* Chips de documentos */}
        {docName && (
          <div className="flex flex-col gap-1.5 w-full max-w-[300px] mt-4 mb-1" style={{ animation: 'fadeUp 0.4s ease-out 0.28s both' }}>
            {(allDocNames && allDocNames.length > 0 ? allDocNames : [docName]).map((name, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-xl"
                style={{
                  background: idx === 0 ? '#fff7ed' : '#f8fafc',
                  border: `1px solid ${idx === 0 ? '#fed7aa' : '#e2e8f0'}`,
                  animation: `fadeUp 0.35s ease-out ${idx * 0.07}s both`,
                }}
              >
                <svg viewBox="0 0 24 24" style={{ flexShrink: 0, width: 13, height: 13, color: idx === 0 ? '#ea580c' : '#94a3b8' }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[11px] font-medium truncate leading-tight flex-1" style={{ color: idx === 0 ? '#c2410c' : '#64748b' }}>{name}</span>
                {idx === 0 && <span className="text-[9px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: '#fb923c' }}>Principal</span>}
                {idx > 0  && <span className="text-[9px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#cbd5e1' }}>Anexo</span>}
              </div>
            ))}
          </div>
        )}

        {/* ── Animação de documentos flutuando ── */}
        <div
          className="relative w-[220px] h-[58px] my-5"
          style={{ animation: 'fadeUp 0.5s ease-out 0.32s both' }}
        >
          {FLOATING_DOCS.map((d, i) => (
            <div
              key={i}
              className="absolute rounded-[5px] overflow-hidden"
              style={{
                left: d.left, top: d.top, width: d.w, height: '40px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 8px rgba(15,23,42,0.07)',
                '--doc-rot': d.rot, '--doc-rot-end': d.rotEnd, '--doc-tx': d.tx, '--doc-ty': d.ty,
                animation: `docPass ${d.dur} ease-in-out ${d.delay} infinite`,
              } as React.CSSProperties}
            >
              {/* Tarja laranja do documento — identidade JURIUS */}
              <div className="h-[4px] w-full" style={{ background: 'linear-gradient(90deg, #ea580c, #f97316)' }} />
              <div className="px-[6px] pt-[5px] space-y-[3px]">
                <div className="h-[2px] w-[70%] rounded-full" style={{ background: '#e2e8f0' }} />
                <div className="h-[2px] w-full  rounded-full" style={{ background: '#f1f5f9' }} />
                <div className="h-[2px] w-[50%] rounded-full" style={{ background: '#dbeafe' }} />
              </div>
            </div>
          ))}
          {/* Seta central */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <svg width="28" height="10" viewBox="0 0 32 12" fill="none" style={{ opacity: 0.15 }}>
              <path d="M0 6h24M20 2l6 4-6 4" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* ── Steps de carregamento ── */}
        <div className="w-full max-w-[260px] space-y-2.5 mb-6" style={{ animation: 'fadeUp 0.5s ease-out 0.38s both' }}>
          {LOADING_STEPS.map((s, i) => {
            const done   = elapsed >= s.doneAt;
            const active = !done && (i === 0 ? true : elapsed >= LOADING_STEPS[i - 1].doneAt);
            return (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="flex-shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all duration-300"
                  style={{
                    background:   done   ? '#10b981' : 'transparent',
                    border:       done   ? 'none' : active ? '2px solid #ea580c' : '2px solid #e2e8f0',
                  }}
                >
                  {done && (
                    <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                    </svg>
                  )}
                  {active && (
                    <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#ea580c', animation: 'progressPulse 1s ease-in-out infinite' }} />
                  )}
                </div>
                <span
                  className="text-[12.5px] transition-colors duration-300"
                  style={{
                    color:       done   ? '#cbd5e1' : active ? '#0f172a' : '#cbd5e1',
                    fontWeight:  active ? 600 : 400,
                    textDecorationLine: done ? 'line-through' : 'none',
                    textDecorationColor: '#e2e8f0',
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Spinner + porcentagem */}
        <div className="flex items-center gap-2.5" style={{ animation: 'fadeUp 0.5s ease-out 0.46s both' }}>
          <svg width="20" height="20" viewBox="0 0 32 32" style={{ animation: 'arcSpin 1s linear infinite' }}>
            <circle cx="16" cy="16" r="13" fill="none" stroke="#f1f5f9" strokeWidth="3" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="#ea580c" strokeWidth="3" strokeLinecap="round" strokeDasharray="26 56" />
          </svg>
          <span className="text-[11px] tabular-nums font-medium" style={{ color: '#94a3b8' }}>{Math.round(pct)}%</span>
        </div>

      </div>

      {/* ── Rodapé de confiança ── */}
      <div className="flex-shrink-0 pb-7 pt-2 flex flex-col items-center gap-2" style={{ animation: 'fadeUp 0.5s ease-out 0.54s both' }}>
        <div className="flex items-center gap-4" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1.5">
            <Lock className="w-[11px] h-[11px]" />
            <span className="text-[10.5px]">AES-256</span>
          </div>
          <span className="w-[3px] h-[3px] rounded-full flex-shrink-0" style={{ background: '#e2e8f0' }} />
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="text-[10.5px]">SSL / TLS</span>
          </div>
          <span className="w-[3px] h-[3px] rounded-full bg-slate-200 flex-shrink-0" />
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
            </svg>
            <span className="text-[10.5px]">MP 2.200-2/2001</span>
          </div>
        </div>
        <p className="text-[9px] font-semibold tracking-[0.18em] uppercase text-slate-300">
          JURIUS · Assinatura Digital Certificada
        </p>
      </div>
    </div>
  );
};

// ─── SigningScreen — tela de envio da assinatura (módulo-nível) ───────────────
const SIGNING_STEPS = [
  { label: 'Enviando foto, assinatura e geolocalização', doneAt: 2.2 },
  { label: 'Conferindo identidade',                      doneAt: 4.0 },
  { label: 'Registrando assinatura',                     doneAt: 5.8 },
  { label: 'Finalizando…',                               doneAt: 7.2 },
];

const SigningScreen: React.FC<{ docName?: string }> = ({ docName }) => {
  const [elapsed, setElapsed] = useState(0);
  const mountRef = useRef(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed((Date.now() - mountRef.current) / 1000);
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  const pct = Math.min(96, (elapsed / 8) * 96);

  return (
    <div className="min-h-[100dvh] flex flex-col select-none overflow-hidden" style={{ background: '#f8fafc' }}>

      {/* Barra de progresso determinista */}
      <div className="h-[3px] w-full flex-shrink-0 relative overflow-hidden" style={{ background: '#e2e8f0' }}>
        <div
          className="absolute left-0 top-0 h-full"
          style={{ width: `${pct}%`, transition: 'width 200ms ease-out', background: 'linear-gradient(90deg, #c2410c 0%, #ea580c 60%, #f97316 100%)' }}
        />
        <div
          className="absolute top-0 h-full w-[60px] pointer-events-none"
          style={{
            left: `${Math.max(0, pct - 10)}%`,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
            animation: 'shimmerBar 1.8s ease-in-out infinite',
          }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">

        {/* Ícone de envio */}
        <div className="relative flex items-center justify-center mb-8" style={{ animation: 'fadeUp 0.5s ease-out both' }}>
          <div className="absolute w-[88px] h-[88px] rounded-full" style={{ border: '1.5px solid rgba(234,88,12,0.20)', animation: 'ringPulse 2.6s ease-out infinite' }} />
          <div className="absolute w-[88px] h-[88px] rounded-full" style={{ border: '1.5px solid rgba(234,88,12,0.10)', animation: 'ringPulse 2.6s ease-out infinite 0.9s' }} />
          <div
            className="relative w-[64px] h-[64px] rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, #9a3412 0%, #c2410c 50%, #ea580c 100%)',
              boxShadow: '0 12px 32px -8px rgba(194,65,12,0.40)',
              animation: 'iconBreath 3s ease-in-out infinite',
            }}
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <polyline points="5 12 12 5 19 12" />
              <path d="M5 19h14" strokeWidth="1.8" opacity="0.6" />
            </svg>
          </div>
        </div>

        {/* Eyebrow */}
        <p
          className="text-[10px] font-bold tracking-[0.22em] uppercase mb-2"
          style={{ color: '#ea580c', animation: 'fadeUp 0.5s ease-out 0.1s both' }}
        >
          Assinatura Digital · JURIUS
        </p>

        {/* Título */}
        <h1
          className="text-[21px] font-bold tracking-tight text-center mb-1"
          style={{ color: '#0f172a', letterSpacing: '-0.3px', animation: 'fadeUp 0.5s ease-out 0.18s both' }}
        >
          Enviando assinatura
        </h1>

        {/* Nome do documento */}
        {docName ? (
          <div
            className="flex items-center gap-2 mt-2 mb-6 px-3.5 py-1.5 rounded-full max-w-[280px]"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa', animation: 'fadeUp 0.35s ease-out both' }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flexShrink: 0, color: '#ea580c' }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-[11.5px] font-medium truncate leading-tight" style={{ color: '#c2410c' }}>{docName}</span>
          </div>
        ) : (
          <p
            className="text-sm text-center max-w-[240px] mt-1 mb-6"
            style={{ color: '#94a3b8', animation: 'fadeUp 0.5s ease-out 0.26s both' }}
          >
            Não feche esta janela. Processando com segurança.
          </p>
        )}

        {/* Steps */}
        <div
          className="w-full max-w-[290px] space-y-3 mb-7"
          style={{ animation: 'fadeUp 0.5s ease-out 0.34s both' }}
        >
          {SIGNING_STEPS.map((s, i) => {
            const done   = elapsed >= s.doneAt;
            const active = !done && (i === 0 ? true : elapsed >= SIGNING_STEPS[i - 1].doneAt);
            return (
              <div key={i} className="flex items-center gap-3">
                <div
                  className="flex-shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all duration-300"
                  style={{
                    background: done ? '#10b981' : 'transparent',
                    border:     done ? 'none' : active ? '2px solid #ea580c' : '2px solid #e2e8f0',
                  }}
                >
                  {done && (
                    <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 5l2.5 2.5 4.5-4.5" />
                    </svg>
                  )}
                  {active && (
                    <div className="w-[6px] h-[6px] rounded-full" style={{ background: '#ea580c', animation: 'progressPulse 1s ease-in-out infinite' }} />
                  )}
                </div>
                <span
                  className="text-[12.5px] transition-colors duration-300"
                  style={{
                    color:      done ? '#cbd5e1' : active ? '#0f172a' : '#cbd5e1',
                    fontWeight: active ? 600 : 400,
                    textDecoration: done ? 'line-through' : 'none',
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Spinner + percentagem */}
        <div className="flex items-center gap-2.5" style={{ animation: 'fadeUp 0.5s ease-out 0.42s both' }}>
          <svg width="20" height="20" viewBox="0 0 32 32" style={{ animation: 'arcSpin 1s linear infinite' }}>
            <circle cx="16" cy="16" r="13" fill="none" stroke="#f1f5f9" strokeWidth="3" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="#ea580c" strokeWidth="3" strokeLinecap="round" strokeDasharray="26 56" />
          </svg>
          <span className="text-[11px] tabular-nums font-medium" style={{ color: '#94a3b8' }}>{Math.round(pct)}%</span>
        </div>
      </div>

      {/* Trust strip */}
      <div
        className="flex-shrink-0 pb-8 pt-2 flex items-center justify-center gap-3"
        style={{ animation: 'fadeUp 0.5s ease-out 0.5s both' }}
      >
        <div className="flex items-center gap-1.5 text-slate-400">
          <Lock className="w-3 h-3" />
          <span className="text-[11px]">Conexão segura</span>
        </div>
        <span className="w-[3px] h-[3px] rounded-full bg-slate-200 flex-shrink-0" />
        <span className="text-[11px] text-slate-400">SSL / TLS</span>
      </div>
    </div>
  );
};

const PublicSigningPage: React.FC<PublicSigningPageProps> = ({ token }) => {
  const toast = useToastContext();

  // Roteia as leituras de storage da geração do PDF assinado pela edge
  // token-scoped (`public-signing-file`), em vez do acesso anon direto aos
  // buckets. É isso que permite fechar o acesso anon a `document-templates` /
  // `assinados` (migration 3) sem quebrar a assinatura pública.
  useEffect(() => {
    pdfSignatureService.setPublicFileResolver((path) => signatureService.getPublicFileUrl(token, path));
    // Dados do relatório (co-signatários + trilha de auditoria) via RPC
    // token-scoped, evitando os 401 das leituras anon diretas nas tabelas.
    pdfSignatureService.setPublicReportDataProvider({
      signers: () => signatureService.getPublicReportSigners(token),
      auditLog: () => signatureService.getPublicReportAuditLog(token) as any,
    });
    // Gravação do PDF assinado/relatório via edge token-scoped (sem INSERT anon).
    pdfSignatureService.setPublicUploadResolver(({ path, bytes, contentType }) =>
      signatureService.uploadSignedFilePublic(token, path, bytes, contentType));
    return () => {
      pdfSignatureService.setPublicFileResolver(null);
      pdfSignatureService.setPublicReportDataProvider(null);
      pdfSignatureService.setPublicUploadResolver(null);
    };
  }, [token]);

  const isSignerDataComplete = (data: SignerData) => data.name.trim().length >= 3 && data.cpf.replace(/\D/g, '').length === 11;

  const isTemplateFillSigner = (email?: string | null) => {
    const e = (email || '').trim().toLowerCase();
    return e.startsWith('public+') && e.endsWith('@crm.local');
  };

  const [allowSkipSignerDataStep, setAllowSkipSignerDataStep] = useState(false);

  useEffect(() => {
    const styleId = 'public-signing-docx-responsive-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .docx-responsive .docx-wrapper-wrapper {
        background: transparent !important;
        padding: 0 !important;
        display: flex !important;
        justify-content: center !important;
      }
      .docx-responsive .docx-wrapper {
        max-width: none !important;
        width: auto !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        box-shadow: none !important;
        margin: 0 !important;
        background: transparent !important;
        transform-origin: top center !important;
      }
      /* FORÇAR A4 FIXO (largura) para layout idêntico ao da criação */
      .docx-responsive .docx-wrapper > section,
      .docx-responsive .docx-wrapper > section > article {
        width: 794px !important; /* A4 @ 96dpi */
        min-width: 794px !important;
        max-width: 794px !important;
        background: white !important;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
        margin-bottom: 20px !important;
        box-sizing: border-box !important;
        padding: 40px !important; /* Mesma padding do SignatureModule */
      }
      /* Colapsa a altura: docx-preview força min-height de página A4 inteira
         (inline), gerando um vão enorme em páginas curtas — tanto no documento
         principal quanto nos ANEXOS (que podem renderizar como <article> direto).
         Cobre qualquer nível (section/article). Só afeta o preview on-screen
         (.docx-responsive); a geração do PDF assinado usa host próprio. */
      .docx-responsive .docx-wrapper section,
      .docx-responsive .docx-wrapper article {
        min-height: 0 !important;
        height: auto !important;
      }

      /* Scrollbar */
      .docx-responsive::-webkit-scrollbar {
        height: 8px;
      }
      .docx-responsive::-webkit-scrollbar-track {
        background: #f1f5f9;
      }
      .docx-responsive::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }

      @media (max-width: 820px) {
        .docx-responsive {
          overflow-x: hidden !important;
          padding: 12px !important;
          align-items: flex-start !important;
        }

        .docx-responsive .docx-wrapper > section,
        .docx-responsive .docx-wrapper > section > article {
          width: 794px !important;
          min-width: 794px !important;
          max-width: 794px !important;
          padding: 24px !important;
        }

        /* Escala automática para caber no celular sem quebrar o layout do DOCX */
        .docx-responsive .docx-wrapper {
          transform: scale(calc((100vw - 24px) / 794)) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const [step, setStep] = useState<SigningStep>('loading');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  // Ordem sequencial: nome do signatário anterior ainda pendente (null = é a vez deste).
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [signatureFields, setSignatureFields] = useState<SignatureField[]>([]);
  const [signerData, setSignerData] = useState<SignerData>({ name: '', cpf: '', phone: '' });
  // Chave do rascunho por token. Ver helpers readSigningDraft/writeSigningDraft.
  const signingDraftKey = `signing-draft:${token}`;
  const draftLoadedRef = useRef(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [facialValidating, setFacialValidating] = useState(false);
  const [facialValidation, setFacialValidation] = useState<FacialAIValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const signingStatusMessages = useMemo(
    () => ['Enviando assinatura…', 'Estamos preparando tudo…', 'Mais um instante…', 'Estamos confirmando a autenticidade…', 'Finalizando…'],
    []
  );
  const [signingStatusIndex, setSigningStatusIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Telefone/WhatsApp do escritório (fonte central office_identity via RPC anon).
  // null = não configurado → botões de WhatsApp ficam ocultos.
  const [officeWhatsapp, setOfficeWhatsapp] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDocx, setIsDocx] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  const [pdfFrameLoaded, setPdfFrameLoaded] = useState(false);
  const [docxRendered, setDocxRendered] = useState(false);

  const [authConfig, setAuthConfig] = useState<PublicAuthConfig>({ google: true, email: true, phone: true });

  // Carrega o telefone do escritório (fonte central) para os botões de ajuda no WhatsApp.
  useEffect(() => {
    let mounted = true;
    signatureService.getOfficeWhatsapp()
      .then((phone) => { if (mounted) setOfficeWhatsapp(phone); })
      .catch(() => { if (mounted) setOfficeWhatsapp(null); });
    return () => { mounted = false; };
  }, []);

  const docxContainerRef = useRef<HTMLDivElement>(null);
  const [queuedOpenSignModal, setQueuedOpenSignModal] = useState(false);
  
  // Documentos anexos
  const [attachments, setAttachments] = useState<{ name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[]>([]);
  const attachmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const attachmentBlobRef = useRef<(Blob | null)[]>([]);
  const attachmentObjectUrlRef = useRef<(string | null)[]>([]);
  const attachmentRenderTokenRef = useRef(0);
  const attachmentRenderInProgressRef = useRef<Set<number>>(new Set());
  const attachmentRenderedRef = useRef<Set<number>>(new Set());
  const presenceStartedRef = useRef(false);

  const [activeTab, setActiveTab] = useState<'signers' | 'history'>('signers');
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>('google_auth');
  const [isRefuseModalOpen, setIsRefuseModalOpen] = useState(false);
  const [refuseReason, setRefuseReason] = useState('');
  const [refusing, setRefusing] = useState(false);
  const [refuseError, setRefuseError] = useState<string | null>(null);
  const [creator, setCreator] = useState<{ name: string } | null>(null);
  // Aceite dos Termos de Uso (LGPD) — obrigatório para enviar a assinatura
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  // Consentimento SEPARADO e OPCIONAL p/ usar a selfie como foto cadastral (default OFF)
  const [allowSelfieForProfile, setAllowSelfieForProfile] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(1); // TODO: detectar páginas do PDF
  const [zoom, setZoom] = useState(100);
  const [showReport, setShowReport] = useState(false);

  // Página 100% carregada: step success + documento carregado + anexos DOCX todos renderizados
  const allAttachmentsRendered = attachments.length === 0 || attachments.every(a => !a.isDocx || a.rendered);
  const mainDocLoaded = isDocx ? (!docxLoading && docxRendered) : (!!pdfUrl && pdfFrameLoaded);
  const isFullyLoaded = step === 'success' && !!signer && !!request && mainDocLoaded && allAttachmentsRendered;

  const canOpenSignModal = isFullyLoaded;

  // ── Overlay de carregamento: visível desde o início, tempo mínimo de 10 s ──
  const [overlayVisible, setOverlayVisible] = useState(true);   // começa visível
  const [overlayFading, setOverlayFading] = useState(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageLoadTimeRef  = useRef<number>(Date.now());           // marca o momento do mount

  // Dispensa o overlay imediatamente quando ocorre erro ou já assinado
  useEffect(() => {
    if (step === 'error' || step === 'already_signed') {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      setOverlayFading(true);
      overlayTimerRef.current = setTimeout(() => {
        setOverlayVisible(false);
        setOverlayFading(false);
      }, 420);
    }
  }, [step]);

  // Dispensa o overlay depois que a página carregou completamente E o tempo mínimo passou
  useEffect(() => {
    if (isFullyLoaded && overlayVisible && !overlayFading) {
      const elapsed   = Date.now() - pageLoadTimeRef.current;
      const remaining = Math.max(0, 10_000 - elapsed);
      overlayTimerRef.current = setTimeout(() => {
        setOverlayFading(true);
        overlayTimerRef.current = setTimeout(() => {
          setOverlayVisible(false);
          setOverlayFading(false);
        }, 600);
      }, remaining);
    }
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [isFullyLoaded, overlayVisible, overlayFading]);

  useEffect(() => {
    if (!loading) return;
    setSigningStatusIndex(0);
    const id = window.setInterval(() => {
      setSigningStatusIndex((i) => (i + 1) % signingStatusMessages.length);
    }, 1700);
    return () => window.clearInterval(id);
  }, [loading, signingStatusMessages.length]);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Location
  const [locationData, setLocationData] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Signed document viewer
  const [signedDocumentUrl, setSignedDocumentUrl] = useState<string | null>(null);
  const [downloadingAlreadySigned, setDownloadingAlreadySigned] = useState(false);
  // Visualizador interno (iframe) do PDF assinado — não expõe a URL do Supabase.
  const [signedViewerUrl, setSignedViewerUrl] = useState<string | null>(null);

  // Google Auth
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitAttemptsRef = useRef(0);
  const googleAuthInitTokenRef = useRef(0);
  const googleAuthInitInFlightRef = useRef(false);
  const googleAuthPreloadedRef = useRef(false);

  // Phone OTP
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpExpiresAt, setPhoneOtpExpiresAt] = useState<string | null>(null);
  const [phoneOtpVerified, setPhoneOtpVerified] = useState(false);
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false);
  const [phoneOtpError, setPhoneOtpError] = useState<string | null>(null);

  // Email OTP
  const [emailToVerify, setEmailToVerify] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpExpiresAt, setEmailOtpExpiresAt] = useState<string | null>(null);
  const [emailOtpVerified, setEmailOtpVerified] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [showEmailAnimation, setShowEmailAnimation] = useState(false);
  const [emailOtpRemaining, setEmailOtpRemaining] = useState<number>(0);

  // Contador regressivo da validade do código de e-mail.
  useEffect(() => {
    if (!emailOtpSent || !emailOtpExpiresAt) {
      setEmailOtpRemaining(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(emailOtpExpiresAt).getTime() - Date.now()) / 1000));
      setEmailOtpRemaining(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [emailOtpSent, emailOtpExpiresAt]);

  // Persiste o rascunho (formulário + assinatura desenhada + localização) a cada
  // mudança. Só grava após o carregamento inicial, pra não sobrescrever um
  // rascunho existente com o estado vazio. Renova a validade de 24h a cada escrita.
  useEffect(() => {
    if (!draftLoadedRef.current || step === 'success') return;
    writeSigningDraft(signingDraftKey, { signerData, signatureData, locationData });
  }, [signerData, signatureData, locationData, step, signingDraftKey]);

  // Documento assinado → limpa o rascunho.
  useEffect(() => {
    if (step === 'success') clearSigningDraft(signingDraftKey);
  }, [step, signingDraftKey]);

  useEffect(() => {
    loadSignerData();
  }, [token]);

  useEffect(() => {
    if (!request?.id) return;
    let cancelled = false;
    const run = async () => {
      try {
        setAuditLogLoading(true);
        setAuditLogError(null);
        // Fluxo PÚBLICO: via RPC token-scoped (sem leitura anon direta → sem 401).
        const data = (await signatureService.getPublicReportAuditLog(token)) ?? [];
        if (cancelled) return;
        // Deduplicar itens idênticos no mesmo minuto (evita poluição por logs duplicados)
        const seen = new Set<string>();
        const deduped: SignatureAuditLog[] = [];
        for (const item of data) {
          const minuteKey = (item.created_at || '').slice(0, 16);
          const key = `${item.action}|${item.description}|${item.ip_address || ''}|${item.user_agent || ''}|${minuteKey}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(item);
        }
        setAuditLog(deduped);
      } catch (e: any) {
        if (cancelled) return;
        setAuditLogError(e?.message || 'Não foi possível carregar o histórico.');
      } finally {
        if (!cancelled) setAuditLogLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [request?.id]);

  useEffect(() => {
    return () => {
      // Cleanup de object URLs gerados no prefetch
      for (const url of attachmentObjectUrlRef.current) {
        if (url) {
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
      }
    };
  }, []);

  // Renderizar DOCX quando a URL estiver disponível
  useEffect(() => {
    if (!pdfUrl || !isDocx) {
      return;
    }
    
    if (step !== 'success') {
      return;
    }
    
    const renderDocx = async () => {
      try {
        setDocxLoading(true);
        setDocxRendered(false);
        
        // Adicionar estilos para formatação A4 consistente (igual ao SignatureModule)
        const styleId = 'docx-page-break-styles-public';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            .docx-wrapper {
              background: #e2e8f0 !important;
              padding: 24px !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
            }
            /* Estilo para sections (páginas) - FORÇAR A4 FIXO */
            .docx-wrapper > section,
            .docx-wrapper article {
              width: 794px !important; /* A4 width at 96 DPI */
              min-width: 794px !important;
              max-width: 794px !important;
              background: white !important;
              box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
              margin-bottom: 30px !important;
              border-radius: 4px !important;
              position: relative !important;
              padding: 40px !important;
            }

            @media (max-width: 820px) {
              .docx-wrapper > section,
              .docx-wrapper article {
                width: calc(100vw - 32px) !important;
                min-width: 0 !important;
                max-width: calc(100vw - 32px) !important;
                padding: 20px !important;
              }
            }
            /* Separador visual entre páginas */
            .docx-wrapper > section::after,
            .docx-wrapper article::after {
              content: '— Fim da Página —' !important;
              display: block !important;
              text-align: center !important;
              padding: 16px !important;
              margin-top: 20px !important;
              color: #64748b !important;
              font-size: 12px !important;
              font-weight: 500 !important;
              border-top: 2px dashed #cbd5e1 !important;
            }
            .docx-wrapper > section:last-child::after,
            .docx-wrapper article:last-child::after {
              content: '— Última Página —' !important;
              border-top-color: #f97316 !important;
              color: #f97316 !important;
            }
          `;
          document.head.appendChild(style);
        }
        
        const response = await fetch(pdfUrl);
        
        if (!response.ok) {
          console.error('❌ Erro ao baixar DOCX:', response.status, response.statusText);
          return;
        }
        
        const blob = await response.blob();
        
        // Aguardar o container estar disponível
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (docxContainerRef.current) {
          docxContainerRef.current.innerHTML = '';
          await renderAsync(blob, docxContainerRef.current, undefined, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true, // Habilitar quebra de páginas (igual ao SignatureModule)
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
          });
          setDocxRendered(true);
        } else {
          console.error('❌ Container ref não disponível');
        }
      } catch (err) {
        console.error('❌ Erro ao renderizar DOCX:', err);
      } finally {
        setDocxLoading(false);
      }
    };
    
    renderDocx();
  }, [pdfUrl, isDocx, step]);

  useEffect(() => {
    setPdfFrameLoaded(false);
    if (!isDocx) {
      setDocxRendered(false);
    }
  }, [pdfUrl, isDocx]);

  // Renderizar anexos DOCX quando carregados
  // Usamos attachments.length como dependência para evitar loops infinitos
  const attachmentsLengthRef = useRef(0);
  useEffect(() => {
    if (attachments.length === 0) return;
    // Só re-executar se o número de anexos mudou (evita loop ao marcar rendered)
    if (attachments.length === attachmentsLengthRef.current) return;
    attachmentsLengthRef.current = attachments.length;

    attachmentRenderTokenRef.current += 1;
    const token = attachmentRenderTokenRef.current;
    let cancelled = false;
    let retryTimer: number | null = null;

    const renderAttachments = async () => {
      if (cancelled) return;
      if (token !== attachmentRenderTokenRef.current) return;

      let needsRetry = false;
      const renderedIdx = new Set<number>();

      for (let i = 0; i < attachments.length; i++) {
        if (cancelled) return;
        if (token !== attachmentRenderTokenRef.current) return;

        const attach = attachments[i];
        // Usar ref para checar se já renderizou (evita depender do state)
        if (attachmentRenderedRef.current.has(i)) continue;
        if (attach.rendered) {
          attachmentRenderedRef.current.add(i);
          continue;
        }

        // Verificar se é DOCX
        const isDocxFile = !!attach.isDocx;
        if (!isDocxFile) {
          attachmentRenderedRef.current.add(i);
          continue;
        }

        const container = attachmentRefs.current[i];
        if (!container) {
          needsRetry = true;
          continue;
        }

        if (attachmentRenderInProgressRef.current.has(i)) {
          needsRetry = true;
          continue;
        }
        attachmentRenderInProgressRef.current.add(i);

        try {
          console.log(`📎 Renderizando anexo ${i + 1}:`, attach.name);
          let blob = attachmentBlobRef.current[i];
          if (!blob) {
            const response = await fetch(attach.url);
            if (!response.ok) {
              console.error(`❌ Erro ao baixar anexo ${i + 1}:`, response.status);
              attachmentRenderInProgressRef.current.delete(i);
              continue;
            }
            blob = await response.blob();
            attachmentBlobRef.current[i] = blob;
          }

          container.innerHTML = '';
          await renderAsync(blob, container, undefined, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
          });

          attachmentRenderedRef.current.add(i);
          renderedIdx.add(i);
          console.log(`✅ Anexo ${i + 1} renderizado com sucesso!`);
        } catch (err) {
          console.error(`❌ Erro ao renderizar anexo ${i + 1}:`, err);
        } finally {
          attachmentRenderInProgressRef.current.delete(i);
        }
      }

      if (renderedIdx.size > 0) {
        setAttachments((prev) => {
          if (token !== attachmentRenderTokenRef.current) return prev;
          return prev.map((a, idx) => (renderedIdx.has(idx) ? { ...a, rendered: true } : a));
        });
      }

      if (needsRetry) {
        retryTimer = window.setTimeout(renderAttachments, 120);
      }
    };

    void renderAttachments();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [attachments.length]);

  useEffect(() => {
    if (!queuedOpenSignModal) return;
    if (!canOpenSignModal) return;
    if (isSignModalOpen) return;
    if (loading) return;
    setQueuedOpenSignModal(false);
    openSignModal();
  }, [queuedOpenSignModal, canOpenSignModal, isSignModalOpen]);

  useEffect(() => {
    if (!isFullyLoaded) return;
    if (googleAuthPreloadedRef.current) return;
    googleAuthPreloadedRef.current = true;

    const preload = () => {
      googleAuthService.initialize().catch(() => {
        // ignore
      });
    };

    const w = window as any;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(preload, { timeout: 1500 });
      return () => {
        try {
          w.cancelIdleCallback?.(id);
        } catch {
          // ignore
        }
      };
    }

    const id = window.setTimeout(preload, 800);
    return () => window.clearTimeout(id);
  }, [isFullyLoaded]);

  useEffect(() => {
    if (isSignModalOpen && modalStep === 'signature' && canvasRef.current) {
      initCanvas();
      // Redesenha a assinatura restaurada do rascunho sobre o canvas recém-limpo.
      if (signatureData) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const rect = canvas.getBoundingClientRect();
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
          img.src = signatureData;
        }
      }
    }
  }, [isSignModalOpen, modalStep]);

  useEffect(() => {
    if (!isSignModalOpen) {
      stopCamera();
      return;
    }

    if (modalStep !== 'facial') {
      stopCamera();
    }
    return () => stopCamera();
  }, [isSignModalOpen, modalStep]);

  useEffect(() => {
    if (!cameraActive) return;
    if (modalStep !== 'facial') return;
    if (!videoRef.current) return;
    if (!cameraStreamRef.current) return;

    if (videoRef.current.srcObject !== cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraActive, modalStep]);

  // Foto aprovada → avança automaticamente para a etapa de autorização/confirmação.
  // Mostra "Foto aprovada!" por um instante antes de avançar.
  useEffect(() => {
    if (modalStep !== 'facial') return;
    if (!facialData) return;
    if (facialValidating) return;
    if (facialValidation?.valid === false) return;
    const t = window.setTimeout(() => setModalStep('confirm'), 1000);
    return () => window.clearTimeout(t);
  }, [modalStep, facialData, facialValidating, facialValidation]);

  
  // Inicializar Google Auth quando modal abre na etapa de autenticação
  useEffect(() => {
    if (isSignModalOpen && modalStep === 'google_auth' && !googleUser) {
      googleAuthInitTokenRef.current += 1;
      const token = googleAuthInitTokenRef.current;

      let cancelled = false;
      let tries = 0;

      const tick = () => {
        if (cancelled) return;
        if (!isSignModalOpen || modalStep !== 'google_auth' || googleUser) return;

        const el = googleButtonRef.current;
        if (el) {
          window.requestAnimationFrame(() => {
            void initGoogleAuth(token, el);
          });
          return;
        }

        tries += 1;
        if (tries <= 30) {
          window.setTimeout(tick, 60);
        }
      };

      const timer = window.setTimeout(tick, 240);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
  }, [isSignModalOpen, modalStep, googleUser]);

  
  const initGoogleAuth = async (initToken: number, buttonEl: HTMLDivElement) => {
    if (!buttonEl?.isConnected) return;

    if (googleAuthInitInFlightRef.current) return;
    googleAuthInitInFlightRef.current = true;

    try {
      setGoogleAuthLoading(true);
      setGoogleAuthError(null);
      await googleAuthService.initialize();

      if (initToken !== googleAuthInitTokenRef.current) return;
      if (!buttonEl?.isConnected) return;

      buttonEl.innerHTML = '';
      
      // @ts-ignore - Google Identity Services global
      if (typeof google !== 'undefined' && google.accounts?.id) {
        googleInitAttemptsRef.current = 0;
        // @ts-ignore
        google.accounts.id.initialize({
          client_id: '249483607462-bgh9hg63orddsjdai5tuicl5gd9p1jj0.apps.googleusercontent.com',
          callback: handleGoogleCallback,
          auto_select: false,
        });
        
        const containerW = Math.floor(
          buttonEl.parentElement?.getBoundingClientRect().width ||
            buttonEl.getBoundingClientRect().width ||
            320
        );
        const width = Math.max(280, Math.min(420, containerW));

        // @ts-ignore
        google.accounts.id.renderButton(buttonEl, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width,
        });
      } else {
        setGoogleAuthError('Não foi possível carregar o botão do Google. Use o login alternativo.');
      }
    } catch (err: any) {
      console.error('Erro ao inicializar Google Auth:', err);
      if (initToken !== googleAuthInitTokenRef.current) return;
      setGoogleAuthError('Erro ao carregar autenticação Google');
    } finally {
      googleAuthInitInFlightRef.current = false;
      if (initToken !== googleAuthInitTokenRef.current) return;
      setGoogleAuthLoading(false);
    }
  };

  const handleSendEmailOtp = async () => {
    try {
      setEmailOtpLoading(true);
      setEmailOtpError(null);
      setShowEmailAnimation(true);

      const email = (emailToVerify || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Informe um e-mail válido');
      }

      const res = await signatureService.sendEmailOtp({ token, email });
      setEmailOtpSent(true);
      setEmailOtpExpiresAt(res.expires_at ?? null);
      toast.success('Código enviado por e-mail');
      
      // Manter animação por 1.5s antes de esconder
      setTimeout(() => setShowEmailAnimation(false), 1500);
    } catch (e: any) {
      setEmailOtpError(e?.message || 'Não foi possível enviar o código');
      setShowEmailAnimation(false);
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    try {
      setEmailOtpLoading(true);
      setEmailOtpError(null);

      const code = emailOtp.replace(/\D/g, '');
      if (code.length < 4) {
        throw new Error('Informe o código recebido');
      }

      const res = await signatureService.verifyEmailOtp({ token, code });
      setEmailOtpVerified(true);
      if (res.email) {
        setVerifiedEmail(res.email);
      }
      toast.success('E-mail verificado com sucesso!');
      setModalStep(allowSkipSignerDataStep && isSignerDataComplete(signerData) ? 'signature' : 'data');
    } catch (e: any) {
      setEmailOtpError(e?.message || 'Código inválido');
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const finalizeGoogleUser = (user: GoogleUser) => {
    setGoogleUser(user);

    const next: SignerData = {
      ...signerData,
      name: (signerData.name || user.name || '').toString(),
    };
    setSignerData(next);

    setModalStep(allowSkipSignerDataStep && isSignerDataComplete(next) ? 'signature' : 'data');
    toast.success('Autenticação realizada com sucesso!');
  };

  const handleGoogleCallback = (response: any) => {
    try {
      if (!response?.credential) {
        throw new Error('Resposta inválida do Google');
      }

      const base64Url = response.credential.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);

      const user: GoogleUser = {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        sub: payload.sub,
      };

      finalizeGoogleUser(user);
    } catch (err) {
      console.error('Erro ao processar resposta do Google:', err);
      setGoogleAuthError('Erro ao processar autenticação');
    }
  };

  const handleGooglePopupLogin = async () => {
    try {
      setGoogleAuthLoading(true);
      setGoogleAuthError(null);
      const user = await googleAuthService.signInWithPopup();
      finalizeGoogleUser(user);
    } catch (err: any) {
      console.error('Erro no login popup:', err);
      setGoogleAuthError(err?.message || 'Não foi possível autenticar com Google');
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  const handleSkipGoogleAuth = () => {
    // Permitir pular autenticação Google (opcional)
    setModalStep(allowSkipSignerDataStep && isSignerDataComplete(signerData) ? 'signature' : 'data');
  };

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const ensureOffscreenDocxStyle = (styleId: string) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .docx-wrapper {
        background: #ffffff !important;
        padding: 0 !important;
      }
      .docx-wrapper > section,
      .docx-wrapper article,
      .docx-wrapper .docx {
        width: 794px !important;
        min-width: 794px !important;
        max-width: 794px !important;
        background: #ffffff !important;
      }
      .docx-wrapper,
      .docx-wrapper *,
      .docx-wrapper p,
      .docx-wrapper span {
        overflow-wrap: normal !important;
        word-wrap: normal !important;
        word-break: normal !important;
        hyphens: none !important;
        -webkit-hyphens: none !important;
      }
    `;
    document.head.appendChild(style);
  };

  const renderDocxOffscreen = async (docxUrl: string, styleId: string) => {
    ensureOffscreenDocxStyle(styleId);
    const res = await fetch(docxUrl);
    if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
    const blob = await res.blob();

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.width = '794px';
    host.style.background = '#ffffff';
    host.style.zIndex = '-1';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);

    await renderAsync(blob, host, undefined, {
      className: 'docx-wrapper',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    });

    await sleep(500);
    return host;
  };

  const generateSignedDocumentForSigner = async (
    currentRequest: SignatureRequest,
    currentSigner: Signer,
  ): Promise<string | null> => {
    let signedPdfPath: string;
    let signedPdfSha256: string | null = null;
    let signedIntegritySha256: string | null = null;

    const attachmentPdfItems = attachments
      .map((a, i) => ({ a, i }))
      .filter((x) => x.a.url && x.a.name.toLowerCase().endsWith('.pdf'))
      .map((x) => ({ documentId: `attachment-${x.i}`, url: x.a.url }));

    let originalPdfUrlToUse = pdfUrl;
    if (!originalPdfUrlToUse && currentRequest.document_path) {
      originalPdfUrlToUse = await signatureService.getPublicFileUrl(token,currentRequest.document_path);
    }

    const docPath = currentRequest.document_path?.toLowerCase() || '';
    const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');

    if (originalPdfUrlToUse && !isDocxFile) {
      const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedPdfToStorage({
        request: currentRequest,
        signer: currentSigner,
        originalPdfUrl: originalPdfUrlToUse,
        creator,
        attachmentPdfItems,
        fieldsOverride: signatureFields,
      });
      signedPdfPath = filePath;
      signedPdfSha256 = sha256;
      signedIntegritySha256 = integritySha256;
    } else if (isDocxFile) {
      const cleanupHosts: HTMLElement[] = [];
      try {
        const mainDocUrl = originalPdfUrlToUse || await signatureService.getPublicFileUrl(token,currentRequest.document_path!);
        if (!mainDocUrl) throw new Error('Erro ao obter URL do documento principal');

        const mainHost = await renderDocxOffscreen(mainDocUrl, 'docx-offscreen-style-public-regenerate');
        cleanupHosts.push(mainHost);

        const attachmentDocxItems: { documentId: string; container: HTMLElement }[] = [];
        const pdfAttachmentItems: { documentId: string; url: string }[] = [];

        for (let i = 0; i < attachments.length; i++) {
          const attach = attachments[i];
          if (!attach.url) continue;
          const lower = attach.name.toLowerCase();

          if (lower.endsWith('.pdf')) {
            pdfAttachmentItems.push({ documentId: `attachment-${i}`, url: attach.url });
            continue;
          }

          if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
            const host = await renderDocxOffscreen(attach.url, 'docx-offscreen-style-public-regenerate');
            cleanupHosts.push(host);
            attachmentDocxItems.push({ documentId: `attachment-${i}`, container: host });
          }
        }

        const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
          request: currentRequest,
          signer: currentSigner,
          creator,
          docxContainer: mainHost,
          attachmentDocxItems,
          attachmentPdfItems: pdfAttachmentItems,
          fieldsOverride: signatureFields,
        });
        signedPdfPath = filePath;
        signedPdfSha256 = sha256;
        signedIntegritySha256 = integritySha256;
      } finally {
        for (const el of cleanupHosts) {
          try { el.remove(); } catch { /* noop */ }
        }
      }
    } else {
      const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignatureReportToStorage({
        request: currentRequest,
        signer: currentSigner,
        creator,
      });
      signedPdfPath = filePath;
      signedPdfSha256 = sha256;
      signedIntegritySha256 = integritySha256;
    }

    await signatureService.attachSignedPdfPublic(token, signedPdfPath, signedPdfSha256, signedIntegritySha256);

    const signedUrl = await signatureService.getPublicFileUrl(token,signedPdfPath);
    if (signedUrl) {
      setSignedDocumentUrl(signedUrl);
      setSigner((prev) => (prev && prev.id === currentSigner.id
        ? { ...prev, signed_document_path: signedPdfPath, signed_pdf_sha256: signedPdfSha256 ?? null, integrity_sha256: signedIntegritySha256 ?? null }
        : prev));
    }
    return signedUrl;
  };

  const waitForSignedDocumentUrl = async (options?: { attempts?: number; delayMs?: number }) => {
    const attempts = options?.attempts ?? 8;
    const delayMs = options?.delayMs ?? 1500;
    let latestBundle: Awaited<ReturnType<typeof signatureService.getPublicSigningBundle>> | null = null;

    // Tenta primeiro o que já está em memória.
    if (signer?.signed_document_path) {
      const directUrl = signedDocumentUrl || (await signatureService.getPublicFileUrl(token,signer.signed_document_path));
      if (directUrl) {
        if (!signedDocumentUrl) setSignedDocumentUrl(directUrl);
        return directUrl;
      }
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const data = await signatureService.getPublicSigningBundle(token);
        latestBundle = data;
        if (data?.signer) {
          setSigner(data.signer);
          setRequest(data.request);
          setWaitingFor(data.waiting_for ?? null);

          if (data.signer.signed_document_path) {
            const readyUrl = await signatureService.getPublicFileUrl(token,data.signer.signed_document_path);
            if (readyUrl) {
              setSignedDocumentUrl(readyUrl);
              return readyUrl;
            }
          }
        }
      } catch (err) {
        console.warn('[PUBLIC SIGNING] Erro ao aguardar documento assinado:', err);
      }

      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }

    const fallbackSigner = latestBundle?.signer ?? signer;
    const fallbackRequest = latestBundle?.request ?? request;
    if (fallbackSigner?.status === 'signed' && fallbackRequest) {
      try {
        return await generateSignedDocumentForSigner(fallbackRequest, fallbackSigner);
      } catch (err) {
        console.error('[PUBLIC SIGNING] Falha ao regenerar documento assinado:', err);
      }
    }

    return null;
  };

  // Abre o PDF assinado num visualizador interno (iframe), sem expor a URL do
  // Supabase: busca o arquivo e exibe via blob: — o link assinado nunca vai
  // para o DOM/barra de endereços. Fallback: usa a própria URL se o fetch falhar.
  const openSignedDocumentViewer = async (setLoading: (b: boolean) => void) => {
    if (!request || !signer) return;
    try {
      setLoading(true);
      const url = await waitForSignedDocumentUrl();
      if (!url) {
        toast.error('O documento foi assinado, mas ainda está sendo finalizado. Tente novamente em alguns segundos.');
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        setSignedViewerUrl(URL.createObjectURL(blob));
      } catch {
        setSignedViewerUrl(url);
      }
    } catch (e) {
      console.error('Erro ao abrir documento assinado:', e);
      toast.error('Erro ao abrir documento assinado');
    } finally {
      setLoading(false);
    }
  };

  const closeSignedViewer = () => {
    setSignedViewerUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
  };

  useEffect(() => () => {
    if (signedViewerUrl && signedViewerUrl.startsWith('blob:')) URL.revokeObjectURL(signedViewerUrl);
  }, [signedViewerUrl]);

  // Modal do visualizador — compartilhado entre as telas "já assinado" e "sucesso".
  const signedDocViewer = signedViewerUrl ? (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-900/70 backdrop-blur-sm" onClick={closeSignedViewer}>
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-slate-900 text-white shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="text-sm font-medium truncate">{request?.document_name || 'Documento assinado'}</span>
        </div>
        <button
          onClick={closeSignedViewer}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
          Fechar
        </button>
      </div>
      <iframe
        title="Documento assinado"
        src={signedViewerUrl}
        className="flex-1 w-full bg-white"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  ) : null;

  const loadSignerData = async () => {
    try {
      setStep('loading');
      const data = await signatureService.getPublicSigningBundle(token);
      
      if (!data) {
        setError('Link de assinatura inválido ou expirado.');
        setStep('error');
        return;
      }

      setSigner(data.signer);
      setRequest(data.request);
      setWaitingFor(data.waiting_for ?? null);
      setSignatureFields(data.fields ?? []);
      if (data.auth_config) {
        setAuthConfig({
          google: !!data.auth_config.google,
          email: !!data.auth_config.email,
          phone: !!data.auth_config.phone,
        });
      } else {
        setAuthConfig({ google: true, email: true, phone: true });
      }
      setAllowSkipSignerDataStep(isTemplateFillSigner((data.signer as any)?.email ?? null));
      // Restaura rascunho salvo (refresh no meio do fluxo, validade de 24h) —
      // dados do formulário têm prioridade sobre os valores pré-preenchidos.
      // Identidade (OTP) e selfie NÃO são restauradas: refeitas a cada sessão.
      const draft = data.signer.status !== 'signed' ? readSigningDraft(signingDraftKey) : null;
      setSignerData(draft?.signerData ?? {
        name: data.signer.name || '',
        cpf: formatCpf(data.signer.cpf || ''),
        phone: data.signer.phone || '',
      });
      if (draft?.signatureData) {
        setSignatureData(draft.signatureData);
        setHasSignature(true);
      }
      if (draft?.locationData) setLocationData(draft.locationData);
      draftLoadedRef.current = true;
      if (data.creator) setCreator(data.creator);
      if (data.signer.status !== 'signed') {
        const viewedKey = `public_signing_viewed_${data.signer.id}`;
        const alreadyLogged = typeof window !== 'undefined' ? window.sessionStorage.getItem(viewedKey) : null;
        if (!alreadyLogged) {
          try {
            window.sessionStorage.setItem(viewedKey, String(Date.now()));
          } catch {
            // noop
          }
          void signatureService.markSignerAsViewed(token, undefined, navigator.userAgent);
        }
      }

      // Tentar carregar preview do documento principal
      if (data.request.document_path) {
        try {
          // Verificar se é DOCX
          const docPath = data.request.document_path.toLowerCase();
          const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
          setIsDocx(isDocxFile);

          const url = await signatureService.getPublicFileUrl(token,data.request.document_path);

          if (url) setPdfUrl(url);
        } catch (e) {
          console.warn('Não foi possível carregar preview do documento:', e);
        }
      }
      
      // Carregar documentos anexos
      if (data.request.attachment_paths && data.request.attachment_paths.length > 0) {
        const attachPaths = data.request.attachment_paths;

        const results = await Promise.all(
          attachPaths.map(async (attachPath) => {
            try {
              const attachUrl = await signatureService.getPublicFileUrl(token,attachPath);
              if (!attachUrl) return null;
              const fileName = attachPath.split('/').pop() || 'Anexo';
              const lower = fileName.toLowerCase();
              const isDocxFile = lower.endsWith('.docx') || lower.endsWith('.doc');
              return {
                name: fileName,
                url: attachUrl,
                rendered: false,
                prefetched: false,
                isDocx: isDocxFile,
              };
            } catch (e) {
              console.warn('Erro ao carregar anexo:', attachPath, e);
              return null;
            }
          })
        );

        const loadedAttachments = results.filter(Boolean) as { name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[];
        setAttachments(loadedAttachments);

        // Prefetch DOCX em paralelo (para renderizar sem esperar fetch sequencial)
        const prefetchTargets = loadedAttachments
          .map((a, i) => ({ a, i }))
          .filter((x) => !!x.a.isDocx);

        const concurrency = 3;
        let cursor = 0;
        const workers = new Array(Math.min(concurrency, prefetchTargets.length)).fill(0).map(async () => {
          while (cursor < prefetchTargets.length) {
            const current = prefetchTargets[cursor++];
            try {
              if (attachmentBlobRef.current[current.i]) continue;
              const res = await fetch(current.a.url);
              if (!res.ok) continue;
              const blob = await res.blob();
              attachmentBlobRef.current[current.i] = blob;
              setAttachments((prev) => prev.map((p, idx) => (idx === current.i ? { ...p, prefetched: true } : p)));
            } catch {
              // ignore
            }
          }
        });

        await Promise.all(workers);
      }

      if (data.signer.status === 'signed') {
        setStep('already_signed');
      } else {
        // Registrar visualização (capturar IP + plataforma)
        const viewedKey = `public_signing_viewed_${data.signer.id}`;
        const alreadyLogged = typeof window !== 'undefined' ? window.sessionStorage.getItem(viewedKey) : null;
        if (!alreadyLogged) {
          const userAgent = navigator.userAgent;
          let ipAddress: string | undefined;
          try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            const ipData = await ipResponse.json();
            ipAddress = ipData.ip;
          } catch (e) {
            // Não bloquear o fluxo
          }

          await signatureService.markSignerAsViewed(token, ipAddress, userAgent);
          try {
            window.sessionStorage.setItem(viewedKey, String(Date.now()));
          } catch {
            // noop
          }
        }
        setStep('success');
      }
    } catch (e: any) {
      console.error('Erro ao carregar dados do signatário:', e);
      setError(e?.message || 'Erro ao carregar dados do signatário.');
      setStep('error');
    }
  };

  const getFirstAuthStep = (cfg: PublicAuthConfig): ModalStep => {
    if (cfg.google) return 'google_auth';
    if (cfg.email) return 'email_otp';
    if (cfg.phone) return 'phone_otp';
    return 'data';
  };

  useEffect(() => {
    if (!isSignModalOpen) return;

    const authStepDisabled =
      (modalStep === 'google_auth' && !authConfig.google) ||
      (modalStep === 'email_otp' && !authConfig.email) ||
      (modalStep === 'phone_otp' && !authConfig.phone);

    if (!authStepDisabled) return;
    setModalStep(getFirstAuthStep(authConfig));
  }, [isSignModalOpen, modalStep, authConfig]);

  useEffect(() => {
    if (!signer?.id || signer.status !== 'pending') return;

    let cancelled = false;
    let intervalId: number | null = null;

    const touch = async () => {
      if (cancelled) return;
      await signatureService.heartbeatSignerPresence(token);
    };

    const start = () => {
      if (intervalId !== null) return;
      void touch();
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') void touch();
      }, 10000);
    };

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (!presenceStartedRef.current) {
      presenceStartedRef.current = true;
      if (document.visibilityState === 'visible') start();
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      presenceStartedRef.current = false;
    };
  }, [signer?.id, signer?.status]);

  const initCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    // Style
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    saveSignature();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    setSignatureData(canvas.toDataURL('image/png'));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureData(null);
  };

  // ========== CAMERA ==========
  const startCamera = async () => {
    try {
      setCameraError(null);
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      cameraStreamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Erro ao acessar câmera:', err);
      setCameraError('Não foi possível acessar a câmera. Verifique as permissões.');
      cameraStreamRef.current = null;
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const validateFacialPhotoWithAI = async (imageBase64: string): Promise<FacialAIValidationResult | null> => {
    try {
      setFacialValidating(true);
      const { data, error } = await supabase.functions.invoke('analyze-facial-photo', {
        body: { token, imageBase64 },
      });

      if (error) {
        console.error('Erro ao validar selfie:', error);
        return null;
      }

      return data as FacialAIValidationResult;
    } catch (err) {
      console.error('Erro ao validar selfie:', err);
      return null;
    } finally {
      setFacialValidating(false);
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg', 0.85);
    setFacialValidation(null);
    setFacialData(imageData);
    stopCamera();

    const result = await validateFacialPhotoWithAI(imageData);
    if (result) {
      setFacialValidation(result);
    }
  };

  const retakePhoto = () => {
    setFacialData(null);
    setFacialValidation(null);
  };

  // ========== LOCATION ==========
  const requestLocation = () => {
    setLocationLoading(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError('Geolocalização não suportada pelo navegador.');
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationData({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationLoading(false);
        setModalStep('facial');
      },
      (error) => {
        console.error('Erro ao obter localização:', error);
        setLocationError('Não foi possível obter sua localização. Verifique as permissões.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const skipLocation = () => {
    setModalStep('facial');
  };

  // ========== SUBMIT ==========
  const handleSign = async () => {
    if (!signer || !signatureData) return;
    if (!termsAccepted) {
      toast.error('É necessário aceitar os Termos de Uso para assinar.');
      return;
    }

    try {
      setLoading(true);
      
      // Capturar IP e User Agent
      const userAgent = navigator.userAgent;
      let ipAddress: string | undefined;
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip;
      } catch (e) {
        console.warn('Não foi possível capturar IP:', e);
      }

      const payload: SignDocumentDTO = {
        signature_image: signatureData,
        facial_image: facialData || undefined,
        geolocation: locationData ? `${locationData.lat}, ${locationData.lng}` : undefined,
        signer_name: signerData.name || undefined,
        signer_cpf: signerData.cpf || undefined,
        signer_phone: signerData.phone || undefined,
        // Dados de autenticação
        auth_provider: googleUser ? 'google' : (emailOtpVerified ? 'email_link' : 'phone'),
        auth_email: googleUser?.email || (emailOtpVerified ? (verifiedEmail || emailToVerify || undefined) : undefined),
        auth_google_sub: googleUser?.sub || undefined,
        auth_google_picture: googleUser?.picture || undefined,
        // Aceite dos Termos de Uso (LGPD)
        terms_accepted: true,
        terms_version: SIGNATURE_TERMS_VERSION,
        // Consentimento OPCIONAL p/ usar a selfie como foto cadastral (não afeta a assinatura)
        allow_signature_selfie_for_profile: allowSelfieForProfile,
        selfie_profile_consent_version: SELFIE_PROFILE_CONSENT_VERSION,
      };

      // Usar signDocumentPublic (Edge Function) para evitar erros de RLS em página pública
      const result = await signatureService.signDocumentPublic(
        token, 
        payload,
        ipAddress,
        userAgent
      );
      
      // Gerar e salvar o PDF COMPILADO no storage
      // Inclui: documento principal + anexos PDF + relatório com selfie no final
      if (request) {
        try {
          let signedPdfPath: string;
          let signedPdfSha256: string | null = null;
          let signedIntegritySha256: string | null = null;
          
          // Coletar URLs dos anexos PDF para compilar
          const attachmentPdfItems = attachments
            .map((a, i) => ({ a, i }))
            .filter((x) => x.a.url && x.a.name.toLowerCase().endsWith('.pdf'))
            .map((x) => ({ documentId: `attachment-${x.i}`, url: x.a.url }));
          
          // Tentar obter URL do documento original se não tiver
          let originalPdfUrlToUse = pdfUrl;
          if (!originalPdfUrlToUse && request.document_path) {
            try {
              originalPdfUrlToUse = await signatureService.getPublicFileUrl(token,request.document_path);
              console.log('[ASSINATURA] URL do documento obtida:', originalPdfUrlToUse ? 'OK' : 'FALHOU');
            } catch (e) {
              console.warn('[ASSINATURA] Erro ao obter URL do documento:', e);
            }
          }
          
          // Verificar se é DOCX pelo path
          const docPath = request.document_path?.toLowerCase() || '';
          const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
          
          if (originalPdfUrlToUse && !isDocxFile) {
            // Documento original é PDF - gerar PDF completo (documento + anexos + relatório)
            const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedPdfToStorage({
              request,
              signer: result,
              originalPdfUrl: originalPdfUrlToUse,
              creator,
              attachmentPdfItems,
              fieldsOverride: signatureFields,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
            signedIntegritySha256 = integritySha256;
          } else if (isDocxFile) {
            // Documento original é DOCX - renderizar offscreen e converter para PDF
            console.log('[ASSINATURA] Convertendo DOCX para PDF (offscreen)...');

            const ensureOffscreenDocxStyle = () => {
              const styleId = 'docx-offscreen-style-public';
              if (document.getElementById(styleId)) return;
              const style = document.createElement('style');
              style.id = styleId;
              style.textContent = `
                .docx-wrapper {
                  background: #ffffff !important;
                  padding: 0 !important;
                }
                .docx-wrapper > section,
                .docx-wrapper article,
                .docx-wrapper .docx {
                  width: 794px !important;
                  min-width: 794px !important;
                  max-width: 794px !important;
                  background: #ffffff !important;
                }
                /* Impede o docx-preview de quebrar palavras no meio (overflow-wrap:
                   break-word / hyphens: auto). Sem isso, html2canvas parte palavras
                   como "Trabalhista" → "Trabal" + "hista" no PDF gerado. */
                .docx-wrapper,
                .docx-wrapper *,
                .docx-wrapper p,
                .docx-wrapper span {
                  overflow-wrap: normal !important;
                  word-wrap: normal !important;
                  word-break: normal !important;
                  hyphens: none !important;
                  -webkit-hyphens: none !important;
                }
              `;
              document.head.appendChild(style);
            };

            const renderDocxOffscreen = async (docxUrl: string) => {
              ensureOffscreenDocxStyle();
              const res = await fetch(docxUrl);
              if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
              const blob = await res.blob();

              const host = document.createElement('div');
              host.style.position = 'fixed';
              host.style.left = '-100000px';
              host.style.top = '0';
              host.style.width = '794px';
              host.style.background = '#ffffff';
              host.style.zIndex = '-1';
              host.style.pointerEvents = 'none';
              document.body.appendChild(host);

              await renderAsync(blob, host, undefined, {
                className: 'docx-wrapper',
                inWrapper: true,
                ignoreWidth: false,
                ignoreHeight: false,
                breakPages: true,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
              });

              // Aguardar renderização completa
              await new Promise(r => setTimeout(r, 500));
              console.log('[ASSINATURA] DOCX renderizado, innerHTML length:', host.innerHTML.length);

              return host;
            };

            const cleanupHosts: HTMLElement[] = [];
            try {
              const mainDocUrl = originalPdfUrlToUse || await signatureService.getPublicFileUrl(token,request.document_path!);
              if (!mainDocUrl) throw new Error('Erro ao obter URL do documento principal');
              console.log('[ASSINATURA] URL do documento principal:', mainDocUrl);

              const mainHost = await renderDocxOffscreen(mainDocUrl);
              cleanupHosts.push(mainHost);
              console.log('[ASSINATURA] Documento principal renderizado offscreen');

              const attachmentDocxItems: { documentId: string; container: HTMLElement }[] = [];
              const pdfAttachmentItems: { documentId: string; url: string }[] = [];

              console.log('[ASSINATURA] Total de anexos:', attachments.length);
              for (let i = 0; i < attachments.length; i++) {
                const attach = attachments[i];
                console.log('[ASSINATURA] Anexo', i, ':', attach.name, 'URL:', attach.url ? 'OK' : 'MISSING');
                if (!attach.url) continue;
                const lower = attach.name.toLowerCase();

                if (lower.endsWith('.pdf')) {
                  pdfAttachmentItems.push({ documentId: `attachment-${i}`, url: attach.url });
                  console.log('[ASSINATURA] Anexo PDF adicionado:', `attachment-${i}`);
                  continue;
                }

                if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
                  console.log('[ASSINATURA] Renderizando anexo DOCX offscreen:', attach.name);
                  const host = await renderDocxOffscreen(attach.url);
                  cleanupHosts.push(host);
                  attachmentDocxItems.push({ documentId: `attachment-${i}`, container: host });
                  console.log('[ASSINATURA] Anexo DOCX adicionado:', `attachment-${i}`);
                }
              }

              console.log('[ASSINATURA] Anexos DOCX:', attachmentDocxItems.length, 'Anexos PDF:', pdfAttachmentItems.length);
              console.log('[ASSINATURA] Campos de assinatura:', signatureFields.length);
              console.log('[ASSINATURA] Campos detalhes:', signatureFields.map(f => ({ doc: f.document_id, page: f.page_number, type: f.field_type })));

              const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
                request,
                signer: result,
                creator,
                docxContainer: mainHost,
                attachmentDocxItems,
                attachmentPdfItems: pdfAttachmentItems,
                fieldsOverride: signatureFields,
              });
              signedPdfPath = filePath;
              signedPdfSha256 = sha256;
              signedIntegritySha256 = integritySha256;
            } finally {
              for (const el of cleanupHosts) {
                try { el.remove(); } catch { /* noop */ }
              }
            }
          } else {
            // Fallback - gerar apenas relatório de assinatura
            const { filePath, sha256, integritySha256 } = await pdfSignatureService.saveSignatureReportToStorage({
              request,
              signer: result,
              creator,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
            signedIntegritySha256 = integritySha256;
          }

          // Atualizar o signer com o path do PDF assinado
          await signatureService.attachSignedPdfPublic(token, signedPdfPath, signedPdfSha256, signedIntegritySha256);
          result.signed_document_path = signedPdfPath;
          (result as any).signed_pdf_sha256 = signedPdfSha256;
          (result as any).integrity_sha256 = signedIntegritySha256;
          console.log('[ASSINATURA] PDF compilado salvo com sucesso:', signedPdfPath);

          try {
            const signedUrl = await signatureService.getPublicFileUrl(token,signedPdfPath);
            if (signedUrl) {
              setSignedDocumentUrl(signedUrl);
            }
          } catch {
            // Não bloquear
          }
        } catch (pdfErr) {
          console.error('Erro ao salvar PDF assinado:', pdfErr);
          // Não bloquear o fluxo se falhar
        }
      }
      
      setIsSignModalOpen(false);
      // Atualizar signer com os dados retornados do servidor
      setSigner(result);
      setStep('success');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao assinar documento.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  // ========== RECUSA ==========
  const handleRefuse = async () => {
    if (!signer) return;
    const reason = refuseReason.trim();
    if (reason.length < 3) {
      setRefuseError('Por favor, descreva o motivo da recusa.');
      return;
    }
    try {
      setRefusing(true);
      setRefuseError(null);
      const userAgent = navigator.userAgent;
      let ipAddress: string | undefined;
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip;
      } catch { /* não bloquear por IP */ }

      const updated = await signatureService.refuseDocumentPublic(token, reason, ipAddress, userAgent);
      setSigner(updated);
      setIsRefuseModalOpen(false);
      setStep('success');
    } catch (err: any) {
      console.error(err);
      setRefuseError(err.message || 'Erro ao recusar o documento.');
    } finally {
      setRefusing(false);
    }
  };

  // ========== HELPERS ==========
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const requireCpfMatch = !!(request as any)?.require_cpf;
  const expectedCpfDigits = (signer?.cpf || '').replace(/\D/g, '');
  const enteredCpfDigits = signerData.cpf.replace(/\D/g, '');
  const cpfMismatch = requireCpfMatch && expectedCpfDigits.length === 11 && enteredCpfDigits.length === 11 && enteredCpfDigits !== expectedCpfDigits;
  const canProceedFromData = signerData.name.trim().length >= 3 && enteredCpfDigits.length === 11 && !cpfMismatch;

  const closeSignModal = () => {
    setIsSignModalOpen(false);
    setModalStep(getFirstAuthStep(authConfig));
    setGoogleUser(null);
    setGoogleAuthError(null);
    setGoogleAuthLoading(false);

    setPhoneOtp('');
    setPhoneOtpSent(false);
    setPhoneOtpExpiresAt(null);
    setPhoneOtpVerified(false);
    setPhoneOtpLoading(false);
    setPhoneOtpError(null);

    setEmailToVerify('');
    setEmailOtp('');
    setEmailOtpSent(false);
    setEmailOtpExpiresAt(null);
    setEmailOtpVerified(false);
    setEmailOtpLoading(false);
    setEmailOtpError(null);
    setVerifiedEmail(null);
    setShowEmailAnimation(false);
  };

  const handleSendPhoneOtp = async () => {
    try {
      setPhoneOtpLoading(true);
      setPhoneOtpError(null);

      const phoneRaw = signerData.phone || '';
      const digits = phoneRaw.replace(/\D/g, '');
      if (digits.length < 10) {
        throw new Error('Informe um telefone válido');
      }

      const res = await signatureService.sendPhoneOtp({ token, phone: digits });
      setPhoneOtpSent(true);
      setPhoneOtpExpiresAt(res.expires_at ?? null);
      toast.success('Código enviado por SMS');
    } catch (e: any) {
      setPhoneOtpError(e?.message || 'Não foi possível enviar o código');
    } finally {
      setPhoneOtpLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    try {
      setPhoneOtpLoading(true);
      setPhoneOtpError(null);

      const code = phoneOtp.replace(/\D/g, '');
      if (code.length < 4) {
        throw new Error('Informe o código recebido');
      }

      const res = await signatureService.verifyPhoneOtp({ token, code });
      setPhoneOtpVerified(true);
      if (res.phone) {
        setSignerData((prev) => ({ ...prev, phone: res.phone || prev.phone }));
      }
      toast.success('Telefone verificado com sucesso!');
      setModalStep(
        allowSkipSignerDataStep && isSignerDataComplete({ ...signerData, phone: res.phone || signerData.phone })
          ? 'signature'
          : 'data'
      );
    } catch (e: any) {
      setPhoneOtpError(e?.message || 'Código inválido');
    } finally {
      setPhoneOtpLoading(false);
    }
  };

  const openSignModal = () => {
    if (loading || isSignModalOpen) {
      return;
    }
    if (!canOpenSignModal) {
      setQueuedOpenSignModal(true);
      toast.info('Carregando documento… Abriremos a assinatura assim que estiver pronto.');
      return;
    }
    setModalStep(getFirstAuthStep(authConfig));
    setSignatureData(null);
    setFacialData(null);
    setHasSignature(false);
    setGoogleUser(null);
    setGoogleAuthError(null);

    setPhoneOtp('');
    setPhoneOtpSent(false);
    setPhoneOtpExpiresAt(null);
    setPhoneOtpVerified(false);
    setPhoneOtpLoading(false);
    setPhoneOtpError(null);

    setEmailToVerify('');
    setEmailOtp('');
    setEmailOtpSent(false);
    setEmailOtpExpiresAt(null);
    setEmailOtpVerified(false);
    setEmailOtpLoading(false);
    setEmailOtpError(null);
    setVerifiedEmail(null);

    setIsSignModalOpen(true);
  };

  // ── Portal de carregamento (posição fixa na árvore → nunca desmonta o LoadingScreen) ──
  const loadingPortal = overlayVisible
    ? createPortal(
        <div
          className="fixed inset-0 z-[9999]"
          style={{
            opacity: overlayFading ? 0 : 1,
            transition: 'opacity 600ms cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: overlayFading ? 'none' : 'auto',
          }}
        >
          <LoadingScreen
            docName={request?.document_name}
            signerName={signer?.name}
            allDocNames={request ? [
              request.document_name,
              ...((request as any).attachment_paths as string[] | null | undefined ?? [])
                .map((p: string) => p.split('/').pop()?.replace(/_\d+_/, ' ').replace(/_/g, ' ') ?? p)
            ] : undefined}
          />
        </div>,
        document.body
      )
    : null;

  if (step === 'loading') {
    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] bg-[#f8f7f5]" />
      </>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-5">
        <div className="w-full max-w-lg relative">

          <div className="relative bg-white rounded-2xl border border-slate-200 shadow-[0_20px_60px_rgba(15,23,42,0.08)] overflow-hidden">
            <div className="h-1 w-full bg-orange-500" />

            <div className="p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-600/80">
                    Assinatura Digital
                  </div>
                  <h1 className="mt-1 text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
                    Link inválido ou expirado
                  </h1>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {error || 'Não foi possível carregar este link de assinatura.'}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Se você recebeu este link há muito tempo, solicite um novo ao escritório.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-[#e7e5df] bg-slate-50 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Token</div>
                <div className="mt-1 font-mono text-xs text-slate-700 break-all">{token}</div>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={loadSignerData}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:bg-orange-700 transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  Tentar novamente
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(token);
                      toast.success('Token copiado.');
                    } catch {
                      toast.error('Não foi possível copiar o token.');
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f8f7f5] border border-[#e7e5df] px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  <Copy className="w-4 h-4" />
                  Copiar token
                </button>
                {(() => {
                  const waUrl = buildWhatsappUrl(officeWhatsapp, `Olá! Preciso de um novo link para assinatura. Token: ${token}`);
                  if (!waUrl) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => window.open(waUrl, '_blank')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Pedir ajuda no WhatsApp
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => window.location.assign('/')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f8f7f5] border border-[#e7e5df] px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Voltar ao início
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  // Already signed
  if (step === 'already_signed') {
    if (!request || !signer) {
      return (
        <>
          {loadingPortal}
          <div className="min-h-[100dvh] bg-[#f8f7f5]" />
        </>
      );
    }

    if (showReport && request && signer) {
      return (
        <SignatureReport
          signer={signer}
          request={request}
          creator={creator}
          onClose={() => setShowReport(false)}
        />
      );
    }

    const handleCopyVerificationCode = async () => {
      try {
        const code = (signer?.verification_hash || '').trim();
        if (!code) return;
        await navigator.clipboard.writeText(code);
        toast.success('Código copiado.');
      } catch {
        toast.error('Não foi possível copiar o código.');
      }
    };

    const handleCopySignerToken = async () => {
      try {
        const t = (signer?.public_token || '').trim();
        if (!t) return;
        await navigator.clipboard.writeText(t);
        toast.success('Token copiado.');
      } catch {
        toast.error('Não foi possível copiar o token.');
      }
    };

    const verificationUrl = signer?.verification_hash ? `${window.location.origin}/#/verificar/${signer.verification_hash}` : null;
    const termsUrl = buildPublicSignatureTermsUrl();

    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] flex flex-col" style={{ background: '#f4f7f9' }}>
          <div className="h-[3px] w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg,#ea580c,#f97316 45%,#fb923c)' }} />

          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-[400px]">
              <div className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-[0_10px_34px_-12px_rgba(15,23,42,0.18)]">
                <div className="h-1" style={{ background: 'linear-gradient(90deg,#ea580c,#f59e0b)' }} />

                <div className="p-5 sm:p-6">
                  {/* Topo: marca + selo */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md flex items-center justify-center text-white font-extrabold text-[13px]" style={{ background: 'linear-gradient(150deg,#FF7A33,#EA5310)' }}>J</div>
                      <span className="text-[15px] font-black tracking-tight text-slate-900">JURIUS</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                      <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-emerald-700">Assinado</span>
                    </span>
                  </div>

                  <h1 className="text-[18px] font-bold text-slate-900 leading-tight">Documento assinado</h1>
                  <p className="text-[12.5px] text-slate-500 mt-0.5">Uma cópia assinada está disponível para você.</p>

                  {/* Documento */}
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                      <FileText className="w-4 h-4" style={{ color: '#ea580c' }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-slate-900 truncate">{request?.document_name}</div>
                      <div className="text-[11.5px] text-slate-400 mt-0.5 truncate">
                        {signer?.name || 'Signatário'}{signer?.signed_at ? ` · ${formatDate(signer.signed_at)}` : ''}
                      </div>
                    </div>
                  </div>

                  {/* Código de autenticação */}
                  {signer?.verification_hash && (
                    <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Código de autenticação</span>
                        <button type="button" onClick={handleCopyVerificationCode} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-orange-600 hover:text-orange-700">
                          <Copy className="w-3 h-3" />Copiar
                        </button>
                      </div>
                      <div className="font-mono text-[13px] font-semibold tracking-wider text-slate-800 break-all mt-1">{signer.verification_hash}</div>
                      {verificationUrl && (
                        <a href={verificationUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 hover:text-orange-600">
                          <ExternalLink className="w-3 h-3" />Verificar autenticidade
                        </a>
                      )}
                    </div>
                  )}

                  {/* Ações */}
                  <button
                    type="button"
                    onClick={() => openSignedDocumentViewer(setDownloadingAlreadySigned)}
                    disabled={downloadingAlreadySigned}
                    className="mt-4 w-full bg-orange-600 text-white px-4 py-3 rounded-xl font-semibold text-[13.5px] flex items-center justify-center gap-2 hover:bg-orange-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {downloadingAlreadySigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    Abrir documento assinado
                  </button>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button type="button" onClick={() => setShowReport(true)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition">
                      <FileText className="w-3.5 h-3.5" />Ver relatório
                    </button>
                    {signer?.public_token && (
                      <button type="button" onClick={handleCopySignerToken} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition">
                        <Shield className="w-3.5 h-3.5" />Copiar token
                      </button>
                    )}
                  </div>
                </div>

                <div className="px-5 sm:px-6 py-3 border-t border-slate-100 flex items-center gap-2">
                  <Lock className="w-3 h-3 text-slate-300 flex-shrink-0" />
                  <p className="text-[10px] text-slate-400 leading-relaxed">Guarde o código de autenticação para conferência futura.</p>
                </div>
              </div>

              <div className="text-center mt-3">
                <a href={termsUrl} className="text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-400 hover:text-orange-600 transition">Termos de Uso</a>
              </div>
            </div>
          </div>
        </div>
        {signedDocViewer}
      </>
    );
  }

  // Ordem sequencial: ainda não é a vez deste signatário (há signatário anterior pendente).
  // Bloqueia a UI de assinatura e explica o motivo. O servidor (edge function) também
  // recusa qualquer tentativa fora de ordem como backstop.
  if (step === 'success' && signer?.status === 'pending' && waitingFor) {
    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-slate-100 flex items-center justify-center">
              <Clock className="w-8 h-8 text-slate-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Ainda não é a sua vez</h1>
            <p className="text-sm text-slate-600 mb-2">
              Este documento exige assinatura <span className="font-semibold">em ordem</span>.
            </p>
            <p className="text-sm text-slate-600">
              Aguardando a assinatura de <span className="font-semibold">{waitingFor}</span>. Você
              receberá um novo aviso quando for a sua vez de assinar
              {request?.document_name ? <> <span className="font-semibold">{request.document_name}</span></> : null}.
            </p>
            <button
              onClick={loadSignerData}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition"
            >
              Verificar novamente
            </button>
          </div>
        </div>
      </>
    );
  }

  // Success (após assinar)
  if (step === 'success' && signer?.status === 'refused') {
    return (
      <>
        {loadingPortal}
        <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-rose-100 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-rose-100 flex items-center justify-center">
              <X className="w-8 h-8 text-rose-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Assinatura recusada</h1>
            <p className="text-sm text-slate-600 mb-4">
              Você recusou a assinatura de <span className="font-semibold">{request?.document_name}</span>. O responsável pelo documento foi notificado.
            </p>
            {signer?.refusal_reason && (
              <div className="text-left bg-rose-50 border border-rose-100 rounded-xl p-4">
                <div className="text-xs font-semibold text-rose-700 mb-1">Motivo informado</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{signer.refusal_reason}</div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  if (step === 'success' && signer?.status === 'signed') {
    // Mostrar relatório de assinatura
    if (showReport && request) {
      return (
        <SignatureReport
          signer={signer}
          request={request}
          creator={creator}
          onClose={() => setShowReport(false)}
        />
      );
    }
    
    // Abre o documento assinado no visualizador interno (iframe), sem expor a URL do Supabase.
    const handleDownload = () => openSignedDocumentViewer(setDownloading);

    const handleShare = async () => {
      if (!request || !signer) {
        toast.error('Documento assinado indisponível para compartilhamento no momento.');
        return;
      }

      try {
        const url = await waitForSignedDocumentUrl();
        if (!url) {
          toast.error('O documento assinado ainda está sendo finalizado.');
          return;
        }

        const baseName = (request.document_name || 'documento_assinado')
          .replace(/\.[^/.]+$/, '')
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
          .trim()
          .slice(0, 80);
        const fileName = `${baseName || 'documento_assinado'}.pdf`;

        const shareText = `Documento assinado: "${request.document_name}"`;

        if (typeof navigator.share === 'function') {
          try {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Falha ao baixar PDF: ${response.status}`);
            }
            const blob = await response.blob();
            const file = new File([blob], fileName, { type: blob.type || 'application/pdf' });

            const canShareFiles =
              typeof (navigator as any).canShare === 'function' && (navigator as any).canShare({ files: [file] });

            if (canShareFiles) {
              await navigator.share({
                title: 'Documento Assinado',
                text: shareText,
                files: [file],
              } as any);
              return;
            }
          } catch (e) {
            console.log('Falha ao compartilhar arquivo, usando link como fallback:', e);
          }

          await navigator.share({
            title: 'Documento Assinado',
            text: shareText,
            url,
          });
          return;
        }

        await navigator.clipboard.writeText(url);
        toast.success('Link do documento assinado copiado.');
      } catch (e) {
        console.log('Compartilhamento cancelado/erro:', e);
      }
    };

    return (
      <>
        {loadingPortal}
        <div className="relative min-h-[100dvh] overflow-hidden flex items-center justify-center p-3 sm:p-6" style={{ background: '#eceae5' }}>
          {/* Brilho âmbar de ambiente */}
          <div aria-hidden="true" className="pointer-events-none fixed" style={{ left: '-8%', top: '-10%', width: 560, height: 560, zIndex: 0, background: 'radial-gradient(circle, rgba(249,115,22,0.08), transparent 65%)' }} />

          {/* Cartão dividido em dois painéis */}
          <div className="relative z-10 w-full max-w-3xl rounded-[28px] overflow-hidden flex flex-col md:flex-row" style={{ boxShadow: '0 30px 80px -30px rgba(15,23,42,0.35), 0 0 0 1px rgba(15,23,42,0.05)' }}>

            {/* ══ PAINEL DE MARCA (escuro, editorial) ══ */}
            <div
              className="relative md:w-[44%] flex-shrink-0 flex flex-col justify-between gap-4 md:gap-0 p-5 sm:p-9 text-white overflow-hidden"
              style={{
                backgroundColor: '#0C1320',
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px),radial-gradient(520px 420px at 10% 105%, rgba(242,99,26,0.22), transparent 60%)',
                backgroundSize: '64px 64px, 64px 64px, 100% 100%',
              }}
            >
              {/* Monograma "J" ao fundo */}
              <div aria-hidden="true" className="pointer-events-none select-none absolute" style={{ right: -42, bottom: -78, fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif", fontSize: 340, lineHeight: 1, fontWeight: 400, color: 'rgba(255,255,255,0.04)', zIndex: 0 }}>J</div>

              {/* Logo */}
              <div className="relative z-10 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-extrabold text-base flex-shrink-0" style={{ background: 'linear-gradient(150deg,#FF7A33,#EA5310)', boxShadow: '0 8px 20px -6px rgba(242,99,26,0.6)' }}>J</div>
                <div className="leading-none">
                  <div className="font-bold text-[14px]">jurius<span style={{ color: '#8893a8' }}>.com.br</span></div>
                  <div className="text-[9px] tracking-[0.22em] uppercase font-semibold mt-1" style={{ color: '#5e6a82' }}>Assinatura</div>
                </div>
              </div>

              {/* Núcleo editorial */}
              <div className="relative z-10">
                <div className="w-11 h-11 md:w-14 md:h-14 rounded-2xl flex items-center justify-center mb-3 md:mb-5" style={{ background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.35)' }}>
                  <Check className="w-6 h-6 md:w-7 md:h-7" strokeWidth={3} style={{ color: '#34d399' }} />
                </div>
                <div className="mb-3 md:mb-[18px]" style={{ width: 30, height: 2, background: '#F2631A', opacity: 0.9 }} />
                <h1 style={{ fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif", fontWeight: 400, fontSize: 'clamp(26px,7vw,40px)', lineHeight: 1.08, letterSpacing: '-0.015em', color: '#F5F2EB' }}>
                  Documento<br /><span style={{ fontStyle: 'italic', color: '#FF9259' }}>assinado</span>.
                </h1>
                <p className="hidden md:block text-[13px] leading-relaxed mt-4 max-w-[260px]" style={{ color: '#97a1b4' }}>
                  Assinatura registrada e validada com sucesso, com trilha de auditoria completa.
                </p>
              </div>

              {/* Meta do documento */}
              <div className="relative z-10 pt-4 md:pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] mb-1.5" style={{ color: '#5e6a82' }}>Documento</div>
                <div className="text-[13px] font-semibold text-white truncate">{request?.document_name}</div>
                {signer?.signed_at && <div className="text-[11px] mt-0.5" style={{ color: '#8893a8' }}>{formatDate(signer.signed_at)}</div>}
              </div>
            </div>

            {/* ══ PAINEL DE AÇÕES (claro) ══ */}
            <div className="flex-1 min-w-0 bg-white p-5 sm:p-9 flex flex-col">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" style={{ boxShadow: '0 0 6px rgba(16,185,129,0.6)' }} />
                <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-emerald-600">Válido · Autêntico</span>
              </div>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Comprovante de assinatura</h2>
              <p className="text-[13px] text-slate-500 mt-1">Guarde o código abaixo para validar quando quiser.</p>

              {/* Código de autenticação */}
              {signer?.verification_hash && (
                <div className="mt-4 rounded-xl px-4 py-3 bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      Código de autenticação
                    </span>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(signer.verification_hash || ''); toast.success('Código copiado.'); }
                        catch { /* ignore */ }
                      }}
                      className="flex items-center gap-1 text-[10.5px] font-semibold text-orange-600 hover:text-orange-700 transition-colors"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                  </div>
                  <div className="font-mono text-[14px] font-bold tracking-[0.08em] text-slate-800 break-all">
                    {signer.verification_hash}
                  </div>
                </div>
              )}

              {/* Ações */}
              <div className="mt-4 space-y-2.5">
                {signer?.signed_document_path && (
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="group w-full flex items-center justify-center gap-2.5 px-5 py-3.5 text-white rounded-xl font-bold text-[14.5px] transition-all disabled:opacity-70 active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, #FB8C3E 0%, #EA5310 100%)',
                      boxShadow: '0 12px 26px -8px rgba(234,88,12,0.5)',
                    }}
                  >
                    {downloading ? (
                      <><Loader2 className="w-[18px] h-[18px] animate-spin" />Abrindo documento...</>
                    ) : (
                      <><Download className="w-[18px] h-[18px]" />Abrir documento assinado</>
                    )}
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => setShowReport(true)}
                    className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all active:scale-[0.98]"
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    Ver relatório
                  </button>

                  {signer?.signed_document_path && (
                    <button
                      onClick={handleShare}
                      className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-[13px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all active:scale-[0.98]"
                    >
                      <Share2 className="w-4 h-4 flex-shrink-0" />
                      Compartilhar
                    </button>
                  )}
                </div>
              </div>

              {/* Rodapé */}
              <div className="mt-auto pt-4 md:pt-6 flex items-start gap-2">
                <Shield className="w-3.5 h-3.5 flex-shrink-0 mt-px text-slate-300" />
                <p className="text-[10.5px] leading-relaxed text-slate-400">
                  Uma cópia ficará disponível para download.
                  {signer?.verification_hash && <> Verifique a autenticidade a qualquer momento pelo código acima.</>}
                </p>
              </div>
            </div>
          </div>
        </div>
        {signedDocViewer}
      </>
    );
  }

  return (
    <>
      {loadingPortal}
      <div className="min-h-[100dvh] h-[100dvh] bg-slate-900 flex flex-col overflow-hidden overscroll-none">
      {/* Header compacto */}
      <header className="bg-gradient-to-r from-[#4a1f14] via-[#3f190f] to-[#2f120b] px-3 py-2 flex items-center justify-between border-b border-black/30 safe-area-top">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/6 rounded-lg flex items-center justify-center ring-1 ring-white/10">
            <PenTool className="w-3.5 h-3.5 text-white/90" />
          </div>
          <div className="leading-tight">
            <div className="text-white font-semibold text-sm">Jurius</div>
            <div className="text-[11px] text-white/68">Assinatura</div>
          </div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs text-white/62 truncate max-w-[160px]">
            {request?.document_name}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 hover:bg-white/8 text-white/88 text-xs font-medium transition border border-white/6"
            title="Histórico"
          >
            <Clock className="w-3.5 h-3.5" />
            Histórico
          </button>
        </div>
      </header>

      {/* Document Viewer - Ocupa toda a tela */}
      <main className="flex-1 min-h-0 relative overflow-y-auto bg-[#f8f7f5]">
        {pdfUrl ? (
          isDocx ? (
            // Renderizar DOCX com docx-preview
            <div className="w-full bg-[#f8f7f5] pb-24">
              {docxLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
                    <p className="text-sm text-slate-600">Carregando documento...</p>
                  </div>
                </div>
              )}
              {/* Documento Principal DOCX */}
              <div
                ref={docxContainerRef}
                className="bg-slate-100 docx-responsive flex flex-col items-center"
                style={{ width: '100%', minHeight: '400px', padding: '20px' }}
              />

              {/* Documentos Anexos */}
              {attachments.length > 0 && (
                <AttachmentsList
                  attachments={attachments}
                  attachmentRefs={attachmentRefs}
                />
              )}
            </div>
          ) : (
            // PDF: canvas via react-pdf, sem iframe, scroll único no <main>
            <div className="w-full bg-[#f8f7f5] pb-24">
              <PdfRenderer
                url={pdfUrl!}
                onLoad={() => setPdfFrameLoaded(true)}
              />
              {attachments.length > 0 && (
                <AttachmentsList
                  attachments={attachments}
                  attachmentRefs={attachmentRefs}
                />
              )}
            </div>
          )
        ) : (
          <div className="w-full h-full bg-[#f8f7f5]" />
        )}
      </main>

      {loading && createPortal(
        <div className="fixed inset-0 z-[9998]">
          <SigningScreen docName={request?.document_name} />
        </div>,
        document.body
      )}

      {/* Botão Assinar - Flutuante estilizado */}
      {signer?.status !== 'signed' && (
        (() => {
          const isWaiting = !canOpenSignModal || queuedOpenSignModal;
          const isButtonDisabled = loading || isSignModalOpen;
          const buttonClass = `fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-7 py-3.5 text-white font-bold text-sm rounded-full transition-all duration-200 whitespace-nowrap ${isButtonDisabled ? 'bg-slate-400 cursor-not-allowed opacity-80 shadow-none ring-0' : isWaiting ? 'bg-orange-600/70 hover:bg-orange-600/70 cursor-wait shadow-[0_10px_24px_rgba(234,88,12,0.24)] ring-1 ring-white/10' : 'bg-orange-600 hover:bg-orange-700 shadow-[0_16px_30px_rgba(234,88,12,0.28),0_6px_18px_rgba(15,23,42,0.14)] ring-1 ring-white/12 hover:-translate-x-1/2 hover:-translate-y-0.5 hover:shadow-[0_20px_36px_rgba(234,88,12,0.32),0_10px_22px_rgba(15,23,42,0.16)] active:scale-95 active:translate-y-0'}`;

          return (
            <>
              <div
                aria-hidden
                className="fixed inset-x-0 bottom-0 z-40 h-[5.25rem] bg-gradient-to-t from-slate-950/44 via-slate-950/26 to-transparent backdrop-blur-[1px] pointer-events-none"
              />
              <div
                aria-hidden
                className="fixed inset-x-0 bottom-0 z-40 h-px bg-white/10 pointer-events-none"
              />
              <button
                onClick={openSignModal}
                disabled={isButtonDisabled}
                className={buttonClass}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {(!canOpenSignModal || queuedOpenSignModal) ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      CARREGANDO…
                    </>
                ) : (
                    <>
                      <PenTool className="w-4 h-4" />
                      ASSINAR DOCUMENTO
                    </>
                )}
              </button>
            </>
          );
        })()
      )}

      {/* Botão Recusar - secundário (acima do botão Assinar) */}
      {signer?.status === 'pending' && (request as any)?.allow_refusal && !isSignModalOpen && (
        <button
          onClick={() => { setRefuseReason(''); setRefuseError(null); setIsRefuseModalOpen(true); }}
          disabled={loading}
          className="fixed bottom-[5.5rem] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-2.5 text-rose-700 bg-white/90 backdrop-blur border border-rose-200 font-semibold text-xs rounded-full shadow-md transition-all duration-200 hover:bg-rose-50 active:scale-95 whitespace-nowrap disabled:opacity-50"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <X className="w-4 h-4" />
          RECUSAR ASSINATURA
        </button>
      )}

      {/* Modal dos Termos de Uso (LGPD) */}
      {showTermsModal && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0"><Shield className="w-5 h-5 text-orange-600" /></div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{SIGNATURE_TERMS_TITLE}</div>
                  <div className="text-xs text-slate-400">Versão {SIGNATURE_TERMS_VERSION}</div>
                </div>
              </div>
              <button onClick={() => setShowTermsModal(false)} className="p-2 text-slate-400 hover:text-slate-600 flex-shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 sm:p-6 overflow-y-auto">
              {SIGNATURE_TERMS_TEXT.trim() ? (
                <div>
                  {parseSignatureTermsText(SIGNATURE_TERMS_TEXT, SIGNATURE_TERMS_TITLE).map((b, i) => {
                    if (b.type === 'h2') {
                      return (
                        <h2 key={i} className="text-[15px] font-bold text-slate-900 tracking-tight mt-7 first:mt-0 mb-2.5">
                          {b.text}
                        </h2>
                      );
                    }
                    if (b.type === 'li') {
                      return (
                        <div key={i} className="flex gap-2.5 mb-1.5 pl-1">
                          <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                          <span className="text-[13.5px] text-slate-600 leading-relaxed">{b.text}</span>
                        </div>
                      );
                    }
                    return (
                      <p key={i} className="text-[13.5px] text-slate-600 leading-relaxed mb-3">
                        {b.text}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  O texto dos Termos de Uso ainda será publicado.
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
              <button onClick={() => setShowTermsModal(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Fechar</button>
              <button
                onClick={() => { setTermsAccepted(true); setShowTermsModal(false); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Li e aceito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de recusa */}
      {isRefuseModalOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center"><X className="w-5 h-5 text-rose-600" /></div>
                <div className="font-semibold text-slate-900">Recusar assinatura</div>
              </div>
              <button onClick={() => !refusing && setIsRefuseModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-600">Descreva o motivo da recusa. O responsável pelo documento será notificado e esta ação ficará registrada.</p>
              <textarea
                value={refuseReason}
                onChange={(e) => setRefuseReason(e.target.value)}
                rows={4}
                placeholder="Ex.: Os dados do documento estão incorretos."
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 resize-none"
              />
              {refuseError && <p className="text-xs text-rose-600">{refuseError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => !refusing && setIsRefuseModalOpen(false)} disabled={refusing} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button onClick={handleRefuse} disabled={refusing || refuseReason.trim().length < 3} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {refusing ? <><Loader2 className="w-4 h-4 animate-spin" />Recusando…</> : 'Confirmar recusa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal - Full screen no mobile */}
      {isSignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 md:backdrop-blur-sm flex flex-col md:items-center md:justify-center">
          <div className="bg-[#f8f7f5] w-full h-full md:h-auto md:max-w-lg md:rounded-3xl md:shadow-2xl overflow-hidden md:max-h-[92vh] flex flex-col">
            {/* Header */}
             <div className="flex-shrink-0 bg-orange-600 px-6 py-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/20">
                  <PenTool className="w-[22px] h-[22px] text-white" />
                </div>
                 <div className="min-w-0">
                   <div className="text-white font-bold text-[17px] leading-tight">Assinar Documento</div>
                   <div className="text-white/80 text-[12px] mt-0.5 leading-tight">Assinatura eletrônica segura</div>
                 </div>
              </div>
              <button
                onClick={closeSignModal}
                aria-label="Fechar"
                className="flex-shrink-0 p-2 rounded-full text-white/90 hover:bg-white/15 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Stepper com ícones */}
            <SignStepper current={signStepNumber(modalStep)} />

            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6 bg-[#f8f7f5]">
              {/* Etapa 1: Autenticação / Identificação */}
              {modalStep === 'google_auth' && (
                <div className="text-center">
                  <div className="mb-7 space-y-1">
                    <h2 className="text-xl font-bold text-slate-800">Confirme sua identidade</h2>
                    <p className="text-sm font-medium text-slate-500 leading-relaxed max-w-xs mx-auto">
                      Escolha uma das opções abaixo para se identificar de forma segura.
                    </p>
                  </div>

                  {googleAuthError && (
                    <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-700">{googleAuthError}</p>
                      </div>
                    </div>
                  )}

                  {googleUser ? (
                    <div className="mb-5 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <div className="flex items-center gap-3 justify-center">
                        <CheckCircle className="w-6 h-6 text-emerald-500" />
                        <div className="text-left">
                          {googleUser?.name && <p className="font-medium text-emerald-700">{googleUser.name}</p>}
                          <p className="text-sm text-emerald-600">{googleUser?.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setModalStep(isSignerDataComplete(signerData) ? 'signature' : 'data')}
                        className="w-full mt-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition"
                      >
                        Continuar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className={`flex items-center justify-center gap-2 py-4 text-slate-500 ${googleAuthLoading ? '' : 'hidden'}`}>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Carregando...</span>
                      </div>

                      <div className={`space-y-3 ${googleAuthLoading ? 'opacity-70 pointer-events-none' : ''}`}>
                        {authConfig.google && (
                          <div className="w-full">
                            <div className="flex justify-end mb-1">
                              <div
                                className="pointer-events-none rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200"
                              >
                                Recomendado
                              </div>
                            </div>
                            <div ref={googleButtonRef} className="flex justify-center" />
                          </div>
                        )}

                        {authConfig.google && (authConfig.email || authConfig.phone) && (
                          <div className="relative py-2 flex items-center justify-center">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-[#e7e5df]" />
                            </div>
                            <div className="relative bg-[#f8f7f5] px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                              OU
                            </div>
                          </div>
                        )}

                        {authConfig.email && (
                          <button
                            type="button"
                            onClick={() => setModalStep('email_otp')}
                            className="w-full bg-white border border-[#e7e5df] hover:bg-slate-50 text-slate-800 font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-slate-900/5 transition-all duration-200 active:scale-[0.98]"
                          >
                            <Mail className="w-5 h-5" />
                            Continuar com E-mail
                          </button>
                        )}

                        {authConfig.phone && (
                          <button
                            type="button"
                            onClick={() => setModalStep('phone_otp')}
                            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-slate-900/20 transition-all duration-200 active:scale-[0.98]"
                          >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
                              <line x1="9" y1="18" x2="15" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                            Continuar com Telefone
                          </button>
                        )}

                        {(() => {
                          const docName = (request?.document_name || 'documento').trim();
                          const waUrl = buildWhatsappUrl(officeWhatsapp, `Olá! Preciso de ajuda para assinar o documento: ${docName}. Token: ${token}`);
                          if (!waUrl) return null;
                          return (
                            <div className="pt-4 text-center">
                              <button
                                type="button"
                                onClick={() => window.open(waUrl, '_blank')}
                                className="text-orange-600 hover:text-orange-700 text-sm font-semibold transition-colors"
                              >
                                Precisa de ajuda?
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Etapa: Verificação por telefone */}
              {modalStep === 'phone_otp' && (
                <div className="space-y-5">
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-800">Verifique seu telefone</h2>
                    <p className="text-slate-500 text-sm mt-2">
                      Enviaremos um código por SMS para confirmar sua identidade.
                    </p>
                  </div>

                  {phoneOtpError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-left text-sm text-red-700">
                      {phoneOtpError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Telefone *</label>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={signerData.phone}
                        onChange={(e) => setSignerData((d) => ({ ...d, phone: e.target.value }))}
                        placeholder="(11) 98888-7777"
                        className="w-full px-4 py-3 border border-[#e7e5df] rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSendPhoneOtp}
                      disabled={phoneOtpLoading}
                      className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition disabled:opacity-50"
                    >
                      {phoneOtpLoading ? 'Enviando…' : (phoneOtpSent ? 'Reenviar código' : 'Enviar código')}
                    </button>

                    {phoneOtpSent && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Código SMS *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={phoneOtp}
                          onChange={(e) => setPhoneOtp(e.target.value)}
                          placeholder="000000"
                          className="w-full px-4 py-3 border border-[#e7e5df] rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 tracking-widest text-center"
                        />
                        {phoneOtpExpiresAt && (
                          <div className="text-xs text-slate-500 mt-2">
                            Válido até: {formatDate(phoneOtpExpiresAt)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {phoneOtpSent && (
                      <button
                        type="button"
                        onClick={handleVerifyPhoneOtp}
                        disabled={phoneOtpLoading || phoneOtp.length < 4}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-base shadow-lg shadow-emerald-500/30 disabled:opacity-50 transition"
                      >
                        {phoneOtpLoading ? 'Validando…' : 'Validar e continuar'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setModalStep('google_auth')}
                      className="w-full py-3 bg-white border border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              )}

              {modalStep === 'email_otp' && (
                <div className="space-y-5">
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-800">Verifique seu e-mail</h2>
                    <p className="text-slate-500 text-sm mt-2">
                      {emailOtpSent
                        ? 'Digite o código que enviamos para o seu e-mail.'
                        : 'Enviaremos um código por e-mail para confirmar sua identidade.'}
                    </p>
                  </div>

                  {emailOtpError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-left text-sm text-red-700">
                      {emailOtpError}
                    </div>
                  )}

                  {/* Etapa 1: enviar e-mail */}
                  {!emailOtpSent && (
                    <>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">E-mail *</label>
                          <input
                            type="email"
                            inputMode="email"
                            value={emailToVerify}
                            onChange={(e) => setEmailToVerify(e.target.value)}
                            placeholder="seuemail@exemplo.com"
                            className="w-full px-4 py-3 border border-[#e7e5df] rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                          />
                        </div>

                        {/* Animação de e-mail sendo enviado */}
                        {showEmailAnimation && (
                          <div className="flex justify-center py-4">
                            <div className="relative">
                              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                                <Mail className="w-6 h-6 text-orange-600" />
                              </div>
                              <div className="absolute -top-1 -right-1">
                                <div className="w-3 h-3 bg-orange-500 rounded-full animate-ping"></div>
                              </div>
                              <div className="absolute top-1/2 -translate-y-1/2 left-full ml-2">
                                <div className="flex items-center gap-1">
                                  <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></div>
                                  <div className="w-2 h-2 bg-orange-300 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                                  <div className="w-2 h-2 bg-orange-200 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                              </div>
                              <div className="text-center mt-2">
                                <p className="text-xs text-orange-600 font-medium">Enviando...</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleSendEmailOtp}
                          disabled={emailOtpLoading}
                          className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          {emailOtpLoading ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              Enviando…
                            </>
                          ) : (
                            'Enviar código'
                          )}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setModalStep('google_auth')}
                        className="w-full py-3 border border-[#e7e5df] rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition"
                      >
                        Voltar
                      </button>
                    </>
                  )}

                  {/* Etapa 2: inserir código */}
                  {emailOtpSent && (
                    <>
                      <div className="space-y-3">
                        <div>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={emailOtp}
                            onChange={(e) => setEmailOtp(e.target.value)}
                            placeholder="CÓDIGO"
                            autoFocus
                            className="w-full px-4 py-3 border border-[#e7e5df] rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 tracking-[0.4em] text-center placeholder:tracking-[0.2em] placeholder:text-slate-400"
                          />
                          {emailOtpExpiresAt && (
                            <div className="text-xs text-center mt-2">
                              {emailOtpRemaining > 0 ? (
                                <span className="text-slate-500">
                                  Expira em{' '}
                                  <span className="font-semibold tabular-nums text-slate-700">
                                    {String(Math.floor(emailOtpRemaining / 60)).padStart(2, '0')}:
                                    {String(emailOtpRemaining % 60).padStart(2, '0')}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-red-500 font-medium">Código expirado</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Aviso discreto de reenvio */}
                        <div className="text-center text-xs text-slate-500">
                          Não recebeu?{' '}
                          <button
                            type="button"
                            onClick={handleSendEmailOtp}
                            disabled={emailOtpLoading}
                            className="font-medium text-orange-600 hover:text-orange-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {emailOtpLoading ? 'Reenviando…' : 'Reenviar código'}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={handleVerifyEmailOtp}
                          disabled={emailOtpLoading || emailOtp.replace(/\D/g, '').length < 4}
                          className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold text-base shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                        >
                          {emailOtpLoading ? (
                            <>
                              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              Validando…
                            </>
                          ) : (
                            'Validar e continuar'
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setEmailOtpSent(false)}
                          className="w-full py-3 border border-[#e7e5df] rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition"
                        >
                          Voltar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Etapa 2: Dados pessoais */}
              {modalStep === 'data' && (
                <div className="space-y-5">
                  {googleUser && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <p className="text-sm text-emerald-700">
                        Verificado: <span className="font-medium">{googleUser.email}</span>
                      </p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Nome completo *</label>
                      <input
                        type="text"
                        value={signerData.name}
                        onChange={(e) => setSignerData((d) => ({ ...d, name: e.target.value }))}
                        placeholder="Digite seu nome completo"
                        className="w-full px-4 py-3 border border-[#e7e5df] rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">CPF *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={14}
                        value={signerData.cpf}
                        onChange={(e) => setSignerData((d) => ({ ...d, cpf: formatCpf(e.target.value) }))}
                        placeholder="000.000.000-00"
                        className={`w-full px-4 py-3 border rounded-xl text-base focus:outline-none focus:ring-2 ${cpfMismatch ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' : 'border-[#e7e5df] focus:ring-orange-500/20 focus:border-orange-500'}`}
                      />
                      {cpfMismatch && (
                        <p className="mt-1.5 text-xs text-red-600">O CPF informado não confere com o CPF do cliente cadastrado para esta assinatura.</p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setModalStep('signature')}
                    disabled={!canProceedFromData}
                    className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold text-base shadow-lg shadow-orange-500/20 disabled:opacity-50 transition-colors"
                  >
                    Continuar
                  </button>
                </div>
              )}

              {/* Etapa 3: Assinatura */}
              {modalStep === 'signature' && (
                <div className="flex flex-col items-center text-center">
                  <h1 className="text-2xl font-bold text-slate-800 mb-2">Assinatura</h1>
                  <p className="text-slate-500 mb-6 text-sm">Assine no quadro abaixo</p>

                  <div className="w-full space-y-6">
                    {/* Área de assinatura */}
                    <div className="relative group">
                      <div className="w-full h-56 bg-[#f8f7f5] rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] border-2 border-dashed border-gray-300 hover:border-orange-400 transition-colors overflow-hidden relative">
                        <canvas
                          ref={canvasRef}
                          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={startDrawing}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                        />
                        {!hasSignature && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                            <PenTool className="w-8 h-8 text-slate-300" />
                            <span className="text-xs font-medium text-slate-400">Assine no campo acima</span>
                          </div>
                        )}
                        <div className="absolute bottom-2 right-3 text-xs text-gray-400 pointer-events-none select-none">
                          Área de assinatura
                        </div>
                      </div>
                    </div>

                    {/* Botões */}
                    <div className="space-y-4">
                      <button
                        onClick={clearSignature}
                        className="w-full bg-gray-800 hover:bg-gray-900 text-white font-medium py-3 px-4 rounded-lg shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        Limpar
                      </button>
                      <button
                        onClick={() => {
                          saveSignature();
                          setModalStep('location');
                        }}
                        disabled={!hasSignature}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
                      >
                        Continuar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Etapa 4: Localização */}
              {modalStep === 'location' && (
                <div className="flex flex-col items-center text-center">
                  {/* Ícone de localização */}
                  <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4 ring-4 ring-white shadow-md">
                    <MapPin className="w-8 h-8 text-orange-500" />
                  </div>

                  <h2 className="text-xl font-bold text-slate-800 mb-1.5">Ativar Localização</h2>
                  <p className="text-slate-500 mb-5 text-sm leading-relaxed">
                    Para sua segurança e conformidade jurídica, precisamos confirmar sua localização atual durante o processo de assinatura.
                  </p>

                  {/* Info box */}
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-4 mb-5 text-left flex items-start shadow-sm">
                    <AlertCircle className="w-5 h-5 text-orange-500 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-800 font-semibold">Por que isso é necessário?</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        A geolocalização serve como evidência técnica para validar a autenticidade deste documento digital.
                      </p>
                    </div>
                  </div>

                  {locationError && (
                    <div className="w-full mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
                      <p className="text-sm text-red-700">{locationError}</p>
                    </div>
                  )}

                  {locationData && (
                    <div className="w-full mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                      <p className="text-sm text-emerald-700">Localização capturada com sucesso!</p>
                    </div>
                  )}

                  {/* Botões */}
                  <div className="w-full space-y-3">
                    <button
                      onClick={requestLocation}
                      disabled={locationLoading || !!locationData}
                      className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-orange-500/20 transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {locationLoading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Obtendo localização...
                        </>
                      ) : locationData ? (
                        <>
                          <CheckCircle className="w-5 h-5" />
                          Localização ativada
                        </>
                      ) : (
                        <>
                          <MapPin className="w-5 h-5" />
                          Ativar Localização
                        </>
                      )}
                    </button>
                    {locationData && (
                      <button
                        onClick={() => setModalStep('facial')}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98]"
                      >
                        Continuar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Etapa 5: Verificação facial */}
              {modalStep === 'facial' && (
                <div className="space-y-4">
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-800">Verificação facial</h2>
                    <p className="text-sm text-slate-500 mt-1">Tire uma selfie para validar a assinatura</p>
                  </div>

                  {facialValidating && (
                    <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <Loader2 className="w-5 h-5 text-orange-600 animate-spin flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-orange-800">Analisando sua foto...</div>
                          <div className="text-xs text-orange-700 mt-0.5">Aguarde alguns segundos. Precisamos ver o rosto com nitidez.</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {facialValidation && facialValidation.valid === false && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-red-800">Foto não aprovada</div>
                          <div className="text-xs text-red-700 mt-0.5">{facialValidation.message}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {facialData ? (
                    <div className="space-y-4">
                      {/* Preview da foto capturada */}
                      <div className="relative">
                        <div
                          className={`rounded-2xl p-4 border ${
                            facialValidation?.valid === false
                              ? 'bg-gradient-to-br from-red-50 to-red-100 border-red-200'
                              : 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200'
                          }`}
                        >
                          <div className="flex flex-col items-center">
                            <div className="relative mb-3">
                              <img 
                                src={facialData} 
                                alt="Foto" 
                                className="w-32 h-32 object-cover rounded-full border-4 border-white shadow-lg" 
                                style={{ transform: 'scaleX(-1)' }} 
                              />
                              {facialValidating ? (
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center shadow-md">
                                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                                </div>
                              ) : facialValidation?.valid === false ? (
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center shadow-md">
                                  <AlertTriangle className="w-5 h-5 text-white" />
                                </div>
                              ) : (
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
                                  <CheckCircle className="w-5 h-5 text-white" />
                                </div>
                              )}
                            </div>
                            <p
                              className={`text-base font-semibold ${
                                facialValidation?.valid === false ? 'text-red-800' : 'text-emerald-800'
                              }`}
                            >
                              {facialValidating
                                ? 'Analisando foto...'
                                : facialValidation?.valid === false
                                  ? 'Tire outra foto'
                                  : 'Foto aprovada!'}
                            </p>
                            <p className={`text-sm ${facialValidation?.valid === false ? 'text-red-600' : 'text-emerald-600'}`}>
                              {facialValidating
                                ? 'Precisamos ver seu rosto com nitidez.'
                                : facialValidation?.valid === false
                                  ? 'Deixe o rosto totalmente visível (sem cobrir) e tire a foto sem tremer.'
                                  : 'Verificação facial concluída'}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Botão de refazer aparece SÓ quando a foto é reprovada.
                          Durante a análise e ao aprovar (avança sozinho) ele some. */}
                      {facialValidation?.valid === false && (
                        <button
                          onClick={() => {
                            setFacialData(null);
                            setFacialValidation(null);
                            startCamera();
                          }}
                          className="w-full py-3 border border-[#e7e5df] rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Tirar novamente
                        </button>
                      )}

                      {!facialValidating && facialValidation?.valid !== false && (
                        <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Avançando…
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {!cameraActive ? (
                        <div className="rounded-2xl border border-[#e7e5df] bg-slate-50 p-5">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                              <Camera className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">Permitir acesso à câmera</div>
                              <div className="text-xs text-slate-600 mt-1 leading-relaxed">
                                Para continuar, precisamos acessar sua câmera para tirar uma selfie.
                                Ao clicar em <span className="font-semibold">Ativar câmera</span>, o navegador vai pedir sua autorização.
                              </div>

                              {cameraError && (
                                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                  {cameraError}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={startCamera}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 hover:bg-orange-700 transition"
                            >
                              <Camera className="w-4 h-4" />
                              Ativar câmera
                            </button>
                            <button
                              type="button"
                              onClick={() => setModalStep('signature')}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f8f7f5] border border-[#e7e5df] px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                            >
                              <ChevronLeft className="w-4 h-4" />
                              Voltar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="relative rounded-2xl overflow-hidden shadow-xl">
                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-64 object-cover" style={{ transform: 'scaleX(-1)' }} />

                            {/* Overlay escuro nas bordas */}
                            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />

                            {/* Moldura central animada */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="relative">
                                {/* Círculo externo com animação de pulso */}
                                <div className="w-40 h-40 rounded-full border-[3px] border-white/30 animate-pulse" />

                                {/* Círculo interno sólido */}
                                <div className="absolute inset-2 rounded-full border-[3px] border-white shadow-lg" />

                                {/* Marcadores de alinhamento */}
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-1 bg-[#f8f7f5] rounded-full" />
                                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-1 bg-[#f8f7f5] rounded-full" />
                                <div className="absolute top-1/2 -left-3 -translate-y-1/2 w-1 h-6 bg-[#f8f7f5] rounded-full" />
                                <div className="absolute top-1/2 -right-3 -translate-y-1/2 w-1 h-6 bg-[#f8f7f5] rounded-full" />
                              </div>
                            </div>

                            {/* Texto instrucional no topo */}
                            <div className="absolute top-4 left-0 right-0 text-center">
                              <div className="inline-flex items-center gap-2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                <span className="text-sm font-semibold text-slate-700">Centralize seu rosto</span>
                              </div>
                            </div>

                            {/* Dica no rodapé */}
                            <div className="absolute bottom-4 left-0 right-0 text-center">
                              <p className="text-white/80 text-xs">Mantenha o rosto dentro do círculo</p>
                            </div>
                          </div>

                          <button
                            onClick={capturePhoto}
                            className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-base shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                          >
                            <Camera className="w-5 h-5" />
                            Capturar foto
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Etapa final: Autorização e confirmação */}
              {modalStep === 'confirm' && (
                <div className="space-y-5">
                  <div className="text-center space-y-1">
                    <h2 className="text-xl font-bold text-slate-800">Autorização e confirmação</h2>
                    <p className="text-sm font-medium text-slate-500">Revise e conclua a assinatura</p>
                  </div>

                  {/* Card de status: selfie aprovada */}
                  {facialData && (
                    <div className="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={facialData}
                          alt="Selfie"
                          className="w-12 h-12 object-cover rounded-full border-2 border-slate-50 shadow-inner"
                          style={{ transform: 'scaleX(-1)' }}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-emerald-700">Foto aprovada</div>
                          <div className="text-xs text-emerald-600/80">Verificação facial concluída</div>
                        </div>
                      </div>
                      <div className="text-emerald-500 bg-emerald-50 p-1.5 rounded-full flex-shrink-0">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {/* Consentimento OPCIONAL — usar a selfie como foto cadastral (default OFF) */}
                    <label className="group block bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-orange-200 transition-colors cursor-pointer">
                      <div className="flex gap-3">
                        <div className="pt-0.5">
                          <input
                            type="checkbox"
                            checked={allowSelfieForProfile}
                            onChange={(e) => setAllowSelfieForProfile(e.target.checked)}
                            className="sr-only"
                          />
                          <OrangeCheckbox checked={allowSelfieForProfile} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-slate-700 leading-snug">
                            {SELFIE_PROFILE_CONSENT_LABEL}
                          </span>
                        </div>
                      </div>
                    </label>

                    {/* Aceite dos Termos de Uso (LGPD) — obrigatório para assinar */}
                    <label className="group block bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-orange-200 transition-colors cursor-pointer">
                      <div className="flex gap-3 items-center">
                        <div className="flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                            className="sr-only"
                          />
                          <OrangeCheckbox checked={termsAccepted} />
                        </div>
                        <div className="min-w-0 flex-1 text-xs font-semibold text-slate-700">
                          Li e aceito os{' '}
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setShowTermsModal(true); }}
                            className="text-orange-600 hover:underline"
                          >
                            {SIGNATURE_TERMS_TITLE}
                          </button>
                          {' '}<span className="text-slate-400 font-normal">({SIGNATURE_TERMS_VERSION})</span>.
                        </div>
                      </div>
                    </label>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleSign}
                      disabled={loading || !termsAccepted}
                      className={`w-full py-3 text-white font-bold rounded-xl shadow-lg transition-all duration-300 flex items-center justify-center gap-3 ${
                        (loading || !termsAccepted)
                          ? 'bg-slate-300 shadow-slate-200 cursor-not-allowed'
                          : 'bg-orange-600 hover:bg-orange-700 active:scale-[0.98] shadow-orange-200'
                      }`}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-5 h-5" />
                          Enviar Assinatura
                        </>
                      )}
                    </button>
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Histórico (overlay) */}
      {activeTab === 'history' && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center md:justify-center p-0 md:p-6">
          <div className="w-full md:max-w-2xl bg-[#f8f7f5] rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#e7e5df] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Histórico da assinatura</div>
                <div className="text-xs text-slate-500 truncate max-w-[70vw] md:max-w-[520px]">{request?.document_name}</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('signers')}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto p-5">
              {auditLogLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando histórico...
                </div>
              ) : auditLogError ? (
                <div className="text-sm text-slate-700">
                  <div className="font-medium">Não foi possível carregar</div>
                  <div className="text-xs text-slate-500 mt-1">{auditLogError}</div>
                </div>
              ) : auditLog.length === 0 ? (
                <div className="text-sm text-slate-600">Nenhum evento registrado.</div>
              ) : (
                <div className="space-y-4">
                  {auditLog.map((item, idx) => {
                    const actionLabel =
                      item.action === 'created' ? 'Solicitação criada' :
                      item.action === 'sent' ? 'Convite enviado' :
                      item.action === 'viewed' ? 'Documento visualizado' :
                      item.action === 'signed' ? 'Documento assinado' :
                      item.action === 'cancelled' ? 'Cancelado' :
                      item.action === 'expired' ? 'Expirado' :
                      item.action === 'reminder_sent' ? 'Lembrete enviado' :
                      'Evento';

                    const dotColor =
                      item.action === 'signed' ? 'bg-emerald-600' :
                      item.action === 'viewed' ? 'bg-orange-600' :
                      item.action === 'cancelled' || item.action === 'expired' ? 'bg-red-600' :
                      'bg-slate-400';

                    return (
                      <div key={item.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                          {idx < auditLog.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-2" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">{actionLabel}</div>
                            <div className="text-xs text-slate-500 whitespace-nowrap">{formatDate(item.created_at)}</div>
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">{item.description}</div>
                          {(item.ip_address || item.user_agent) && (
                            <div className="mt-2 text-[11px] text-slate-500">
                              {item.ip_address && <div>IP: {item.ip_address}</div>}
                              {item.user_agent && <div className="break-words">Dispositivo: {item.user_agent}</div>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default PublicSigningPage;
