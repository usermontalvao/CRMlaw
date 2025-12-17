import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle, ChevronLeft, Clock, Copy, Download, ExternalLink, FileText, Loader2, Lock, MapPin, PenTool, RotateCcw, Scale, Share2, User, X, Shield } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import { googleAuthService, type GoogleUser } from '../services/googleAuth.service';
import { useToastContext } from '../contexts/ToastContext';
import type { SignDocumentDTO, SignatureAuditLog, SignatureField, Signer, SignatureRequest } from '../types/signature.types';
import SignatureReport from './SignatureReport';
import { renderAsync } from 'docx-preview';

interface PublicSigningPageProps {
  token: string;
}

type SigningStep = 'loading' | 'success' | 'error' | 'already_signed';
type ModalStep = 'google_auth' | 'phone_otp' | 'data' | 'signature' | 'location' | 'facial' | 'confirm';

interface SignerData {
  name: string;
  cpf: string;
  phone: string;
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

const PublicSigningPage: React.FC<PublicSigningPageProps> = ({ token }) => {
  const toast = useToastContext();

  useEffect(() => {
    const styleId = 'public-signing-loading-animations';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes pen {
        0%, 100% { transform: translateY(0) rotate(-2deg); }
        50% { transform: translateY(-3px) rotate(2deg); }
      }
      @keyframes shimmer {
        0% { transform: translateX(-120%); opacity: 0.65; }
        50% { transform: translateX(0%); opacity: 1; }
        100% { transform: translateX(120%); opacity: 0.65; }
      }
      @keyframes write {
        0% { stroke-dashoffset: 220; opacity: 0.55; }
        45% { stroke-dashoffset: 0; opacity: 1; }
        75% { stroke-dashoffset: 0; opacity: 1; }
        100% { stroke-dashoffset: -220; opacity: 0.55; }
      }
      @keyframes bar {
        0% { transform: translateX(-55%); opacity: 0.6; }
        50% { transform: translateX(0%); opacity: 1; }
        100% { transform: translateX(55%); opacity: 0.6; }
      }
      @keyframes drift1 {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(18px, 10px, 0); }
      }
      @keyframes drift2 {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(-16px, -12px, 0); }
      }
      @keyframes drift3 {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(-10px, 16px, 0); }
      }
    `;
    document.head.appendChild(style);
  }, []);

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
      }
      /* FORÇAR A4 FIXO para garantir layout idêntico ao da criação */
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
          align-items: center !important;
        }

        .docx-responsive .docx-wrapper > section,
        .docx-responsive .docx-wrapper > section > article {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          padding: 20px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const LoadingScreen = (props: { title: string; subtitle?: string }) => (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm relative">
        <div className="relative rounded-3xl bg-white/80 backdrop-blur shadow-xl ring-1 ring-slate-200/60 px-6 pt-7 pb-6">
          <div className="flex items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-white shadow ring-1 ring-slate-200 flex items-center justify-center">
              <div className="text-3xl animate-[pen_3.2s_cubic-bezier(0.4,0,0.2,1)_infinite]">✍️</div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <h1 className="text-slate-800 text-lg font-semibold tracking-tight">{props.title}</h1>
            <p className="mt-2 text-slate-500 text-sm leading-relaxed">
              {props.subtitle ?? 'Estamos carregando os seus documentos…'}
            </p>
          </div>

          <div className="mt-6 rounded-2xl bg-white ring-1 ring-slate-200/70 p-4">
            <div className="space-y-3">
              <div className="h-3 w-40 rounded-full bg-slate-100 relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/80 to-transparent animate-[shimmer_1.7s_ease-in-out_infinite]" />
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100 relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/80 to-transparent animate-[shimmer_1.7s_ease-in-out_infinite]" />
              </div>
              <div className="h-2.5 w-11/12 rounded-full bg-slate-100 relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/80 to-transparent animate-[shimmer_1.7s_ease-in-out_infinite]" />
              </div>
              <div className="h-2.5 w-9/12 rounded-full bg-slate-100 relative overflow-hidden">
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/80 to-transparent animate-[shimmer_1.7s_ease-in-out_infinite]" />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center">
              <svg width="240" height="34" viewBox="0 0 240 34" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-90">
                <path
                  d="M8 24 C 28 10, 44 30, 66 16 C 82 6, 92 34, 114 18 C 132 6, 148 30, 168 14 C 184 6, 200 30, 232 10"
                  stroke="#f97316"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="220"
                  strokeDashoffset="220"
                  style={{ animation: 'write 2.6s ease-in-out infinite' }}
                />
              </svg>
            </div>
          </div>

          <div className="mt-6">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full w-full rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500 animate-[bar_1.9s_ease-in-out_infinite]" />
            </div>
            <p className="mt-3 text-xs text-slate-400 text-center">Aguarde enquanto preparamos tudo para você.</p>
          </div>
        </div>
      </div>
    </div>
  );

  const [step, setStep] = useState<SigningStep>('loading');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  const [signatureFields, setSignatureFields] = useState<SignatureField[]>([]);
  const [signerData, setSignerData] = useState<SignerData>({ name: '', cpf: '', phone: '' });
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const signingStatusMessages = useMemo(
    () => ['Enviando assinatura…', 'Estamos preparando tudo…', 'Mais um instante…', 'Estamos confirmando a autenticidade…', 'Finalizando…'],
    []
  );
  const [signingStatusIndex, setSigningStatusIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDocx, setIsDocx] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  const [pdfFrameLoaded, setPdfFrameLoaded] = useState(false);
  const [docxRendered, setDocxRendered] = useState(false);
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

  const [activeTab, setActiveTab] = useState<'signers' | 'history'>('signers');
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>('google_auth');
  const [creator, setCreator] = useState<{ name: string; email: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages] = useState(1); // TODO: detectar páginas do PDF
  const [zoom, setZoom] = useState(100);
  const [showReport, setShowReport] = useState(false);

  // Página 100% carregada: step success + documento carregado + anexos DOCX todos renderizados
  const allAttachmentsRendered = attachments.length === 0 || attachments.every(a => !a.isDocx || a.rendered);
  const mainDocLoaded = isDocx ? (!docxLoading && docxRendered) : (!!pdfUrl && pdfFrameLoaded);
  const isFullyLoaded = step === 'success' && !!signer && !!request && mainDocLoaded && allAttachmentsRendered;

  const canOpenSignModal = isFullyLoaded;

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
        const data = await signatureService.getAuditLog(request.id);
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

  const finalizeGoogleUser = (user: GoogleUser) => {
    setGoogleUser(user);

    if (signer?.email && user.email.toLowerCase() !== signer.email.toLowerCase()) {
      toast.warning(
        `Atenção: o email autenticado (${user.email}) é diferente do email do signatário (${signer.email}).`
      );
    }

    if (user.name) {
      setSignerData((prev) => ({ ...prev, name: user.name }));
    }

    setModalStep('data');
    toast.success('Autenticação realizada com sucesso!');
  };

  const handleGoogleCallback = (response: any) => {
    try {
      // Decodificar JWT do Google
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
    setModalStep('data');
  };

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
      setSignatureFields(data.fields ?? []);
      setSignerData({ name: data.signer.name || '', cpf: '', phone: '' });
      if (data.creator) setCreator(data.creator);

      // Tentar carregar preview do documento principal
      if (data.request.document_path) {
        try {
          // Verificar se é DOCX
          const docPath = data.request.document_path.toLowerCase();
          const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
          setIsDocx(isDocxFile);

          const url = await signatureService.getDocumentPreviewUrl(data.request.document_path);

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
              const attachUrl = await signatureService.getDocumentPreviewUrl(attachPath);
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

          await signatureService.markSignerAsViewed(data.signer.id, ipAddress, userAgent);
          try { window.sessionStorage.setItem(viewedKey, String(Date.now())); } catch { /* noop */ }
        }
        // Atualizar signer local com viewed_at
        setSigner(prev => prev ? { ...prev, viewed_at: new Date().toISOString() } : prev);
        // Página carregada (layout Autentique)
        setStep('success');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao carregar dados da assinatura.');
      setStep('error');
    }
  };

  const pageReady = useMemo(() => !!request && !!signer, [request, signer]);

  
  // ========== CANVAS SIGNATURE ==========
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

  const capturePhoto = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);
    setFacialData(canvas.toDataURL('image/jpeg', 0.8));
    stopCamera();
  };

  const retakePhoto = () => {
    setFacialData(null);
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
        auth_provider: googleUser ? 'google' : 'phone',
        auth_email: googleUser?.email || undefined,
        auth_google_sub: googleUser?.sub || undefined,
        auth_google_picture: googleUser?.picture || undefined,
      };

      const result = await signatureService.signDocument(
        signer.id, 
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
          
          // Coletar URLs dos anexos PDF para compilar
          const attachmentPdfItems = attachments
            .map((a, i) => ({ a, i }))
            .filter((x) => x.a.url && x.a.name.toLowerCase().endsWith('.pdf'))
            .map((x) => ({ documentId: `attachment-${x.i}`, url: x.a.url }));
          
          // Tentar obter URL do documento original se não tiver
          let originalPdfUrlToUse = pdfUrl;
          if (!originalPdfUrlToUse && request.document_path) {
            try {
              originalPdfUrlToUse = await signatureService.getDocumentPreviewUrl(request.document_path);
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
            const { filePath, sha256 } = await pdfSignatureService.saveSignedPdfToStorage({
              request,
              signer: result,
              originalPdfUrl: originalPdfUrlToUse,
              creator,
              attachmentPdfItems,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
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
              const mainDocUrl = originalPdfUrlToUse || await signatureService.getDocumentPreviewUrl(request.document_path!);
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

              const { filePath, sha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
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
            } finally {
              for (const el of cleanupHosts) {
                try { el.remove(); } catch { /* noop */ }
              }
            }
          } else {
            // Fallback - gerar apenas relatório de assinatura
            const { filePath, sha256 } = await pdfSignatureService.saveSignatureReportToStorage({
              request,
              signer: result,
              creator,
            });
            signedPdfPath = filePath;
            signedPdfSha256 = sha256;
          }
          
          // Atualizar o signer com o path do PDF assinado
          await signatureService.updateSignerSignedDocumentMeta(result.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: signedPdfSha256 });
          result.signed_document_path = signedPdfPath;
          (result as any).signed_pdf_sha256 = signedPdfSha256;
          console.log('[ASSINATURA] PDF compilado salvo com sucesso:', signedPdfPath);

          try {
            const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
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

  // ========== HELPERS ==========
  const formatCpf = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    return numbers
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const canProceedFromData = signerData.name.trim().length >= 3 && signerData.cpf.replace(/\D/g, '').length === 11;

  const closeSignModal = () => {
    setIsSignModalOpen(false);
    setModalStep('google_auth');
    setGoogleUser(null);
    setGoogleAuthError(null);
    setGoogleAuthLoading(false);

    setPhoneOtp('');
    setPhoneOtpSent(false);
    setPhoneOtpExpiresAt(null);
    setPhoneOtpVerified(false);
    setPhoneOtpLoading(false);
    setPhoneOtpError(null);
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
      setModalStep('data');
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
    setModalStep('google_auth');
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

    setIsSignModalOpen(true);
  };

  if (step === 'loading') {
    return <LoadingScreen title="Carregando documento" subtitle="Estamos carregando os seus documentos…" />;
  }

  // Error
  if (step === 'error') {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-orange-50 via-white to-amber-50 flex items-center justify-center p-5">
        <div className="w-full max-w-lg relative">
          <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-orange-400/10 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />

          <div className="relative bg-white/90 backdrop-blur rounded-3xl border border-orange-100 shadow-[0_20px_60px_rgba(15,23,42,0.08)] overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-amber-500" />

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

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  <Copy className="w-4 h-4" />
                  Copiar token
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const phone = '5565984046375';
                    const msg = `Olá! Preciso de um novo link para assinatura. Token: ${token}`;
                    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
                    window.open(url, '_blank');
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Pedir ajuda no WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => window.location.assign('/')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Voltar ao início
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Already signed
  if (step === 'already_signed') {
    if (!request || !signer) {
      return <LoadingScreen title="Carregando documento" subtitle="Estamos carregando os seus documentos…" />;
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

    const handleDownloadAlreadySigned = async () => {
      if (!request || !signer) return;
      try {
        setDownloadingAlreadySigned(true);
        
        // Verificar se já existe PDF assinado salvo no bucket 'assinados'
        if (signer.signed_document_path) {
          const signedUrl = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path);
          if (signedUrl) {
            console.log('[DOWNLOAD] Usando PDF já salvo:', signer.signed_document_path);
            window.open(signedUrl, '_blank');
            return;
          }
        }

        toast.error('Documento assinado indisponível no momento. Tente novamente mais tarde.');
      } catch (e) {
        console.error('Erro ao baixar:', e);
        toast.error('Erro ao abrir documento assinado');
      } finally {
        setDownloadingAlreadySigned(false);
      }
    };

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

    const handleCopySignedLink = async () => {
      try {
        if (!signer?.signed_document_path) {
          toast.error('Link indisponível no momento.');
          return;
        }
        const url = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path);
        if (!url) {
          toast.error('Link indisponível no momento.');
          return;
        }
        await navigator.clipboard.writeText(url);
        toast.success('Link do documento copiado.');
      } catch {
        toast.error('Não foi possível copiar o link.');
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

    return (
      <div className="min-h-[100dvh] bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
                <Scale className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight text-slate-900">Jurius</div>
                <div className="text-[11px] text-slate-500 truncate">Assinatura · Documento finalizado</div>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 flex-shrink-0">
              <Clock className="w-4 h-4" />
              {signer?.signed_at ? formatDate(signer.signed_at) : ''}
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-5 py-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />

            <div className="px-6 pt-6 pb-5 border-b border-slate-100">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-7 h-7 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-lg font-semibold text-slate-900">Documento já assinado</h1>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Assinado
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Uma cópia assinada está disponível para abertura e compartilhamento.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-orange-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{request?.document_name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">Documento nº <span className="font-mono">{request?.id}</span></div>
                    <div className="text-sm text-slate-500 mt-1">Assinado por <span className="font-medium text-slate-800">{signer?.name || 'Signatário'}</span></div>
                  </div>
                </div>
              </div>

              {signer?.verification_hash && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 font-semibold">CÓDIGO DE AUTENTICAÇÃO</div>
                      <div className="mt-2 font-mono text-xs tracking-wide break-all text-slate-900">{signer.verification_hash}</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyVerificationCode}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition text-sm font-medium"
                      title="Copiar código"
                    >
                      <Copy className="w-4 h-4" />
                      Copiar
                    </button>
                  </div>

                  {verificationUrl && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => window.open(verificationUrl, '_blank')}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-orange-600 hover:text-orange-700"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Verificar autenticidade
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 pb-6 space-y-3">
              <button
                onClick={handleDownloadAlreadySigned}
                disabled={downloadingAlreadySigned}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 transition disabled:opacity-70 disabled:cursor-wait"
              >
                {downloadingAlreadySigned ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Preparando...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    Abrir documento assinado
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-800 rounded-xl font-semibold hover:bg-slate-50 transition"
              >
                <FileText className="w-5 h-5 text-slate-700" />
                Ver relatório de assinatura
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {signer?.signed_document_path && (
                  <button
                    type="button"
                    onClick={handleCopySignedLink}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-800 rounded-xl font-medium hover:bg-slate-50 transition"
                  >
                    <Share2 className="w-5 h-5 text-slate-700" />
                    Copiar link
                  </button>
                )}

                {signer?.public_token && (
                  <button
                    type="button"
                    onClick={handleCopySignerToken}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-800 rounded-xl font-medium hover:bg-slate-50 transition"
                  >
                    <Shield className="w-5 h-5 text-slate-700" />
                    Copiar token
                  </button>
                )}
              </div>
            </div>

            <div className="px-6 pb-6 border-t border-slate-100">
              <p className="pt-4 text-xs text-slate-500 text-center">
                Guarde o código de autenticação para conferência futura.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Success (após assinar)
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
    
    // Abrir/baixar o documento assinado (apenas o PDF salvo no storage)
    const handleDownload = async () => {
      if (!request || !signer) return;
      try {
        setDownloading(true);
        if (!signer.signed_document_path) {
          toast.error('Documento assinado indisponível no momento.');
          return;
        }

        const url = signedDocumentUrl || (await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path));
        if (!url) {
          toast.error('Não foi possível abrir o documento assinado.');
          return;
        }

        window.open(url, '_blank');
      } catch (e) {
        console.error('Erro ao baixar documento:', e);
        toast.error('Erro ao abrir documento assinado');
      } finally {
        setDownloading(false);
      }
    };

    const handleShare = async () => {
      if (!request || !signer?.signed_document_path) {
        toast.error('Documento assinado indisponível para compartilhamento no momento.');
        return;
      }

      try {
        const url = signedDocumentUrl || (await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path));
        if (!url) {
          toast.error('Não foi possível obter o link do documento assinado.');
          return;
        }

        const sharePayload = {
          title: 'Documento Assinado',
          text: `Documento assinado: "${request.document_name}"`,
          url,
        };

        if (typeof navigator.share === 'function') {
          await navigator.share(sharePayload);
          return;
        }

        await navigator.clipboard.writeText(url);
        toast.success('Link do documento assinado copiado.');
      } catch (e) {
        console.log('Compartilhamento cancelado/erro:', e);
      }
    };

    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-orange-50 via-white to-amber-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="bg-white rounded-2xl border border-orange-100 shadow-[0_10px_30px_rgba(15,23,42,0.08)] overflow-hidden">
            {/* Animação de sucesso */}
            <div className="px-6 pt-8 pb-6">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-9 h-9 text-orange-600" />
              </div>

              <h1 className="mt-5 text-xl font-semibold text-slate-900 text-center">Documento assinado com sucesso!</h1>
              <p className="mt-1 text-sm text-slate-600 text-center">Sua assinatura foi registrada e validada.</p>
            </div>

            {/* Card do documento */}
            <div className="px-6 pb-6">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{request?.document_name}</div>
                    <div className="text-sm text-slate-600 mt-0.5">Assinado em {signer?.signed_at ? formatDate(signer.signed_at) : ''}</div>
                    {signer?.verification_hash && (
                      <div className="mt-3">
                        <div className="text-xs text-slate-600 font-medium">Código de autenticação</div>
                        <div className="mt-1 font-mono text-xs tracking-wide break-all bg-orange-50/40 border border-orange-100 rounded-lg p-2">
                          {signer.verification_hash}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Botões de ação */}
            <div className="px-6 pb-8 space-y-3">
              {signer?.signed_document_path && (
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-orange-600 text-white rounded-xl font-medium hover:bg-orange-700 transition shadow-lg shadow-orange-500/20 disabled:opacity-70"
                >
                  {downloading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Abrindo documento...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      Abrir documento assinado
                    </>
                  )}
                </button>
              )}

              <button
                onClick={() => setShowReport(true)}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-800 rounded-xl font-medium hover:bg-slate-50 transition"
              >
                <FileText className="w-5 h-5 text-slate-700" />
                Ver relatório de assinatura
              </button>

              {signer?.signed_document_path && (
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-800 rounded-xl font-medium hover:bg-slate-50 transition"
                >
                  <Share2 className="w-5 h-5 text-slate-700" />
                  Compartilhar documento assinado
                </button>
              )}
            </div>

            {/* Informação adicional */}
            <div className="px-6 pb-6 border-t border-slate-100">
              <p className="pt-4 text-xs text-slate-500 text-center">
                Uma cópia do documento assinado ficará disponível para download.
                {signer?.verification_hash && (
                  <> Você pode verificar a autenticidade a qualquer momento na página de verificação.</>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] h-[100dvh] bg-slate-900 flex flex-col overflow-hidden overscroll-none">
      {/* Header compacto */}
      <header className="bg-gradient-to-r from-orange-700 via-orange-800 to-orange-900 px-3 py-2 flex items-center justify-between border-b border-orange-900/40 safe-area-top">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/15 rounded-lg flex items-center justify-center ring-1 ring-white/20">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-white font-semibold text-sm">Jurius</div>
            <div className="text-[11px] text-orange-100/90">Assinatura</div>
          </div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs text-orange-100/80 truncate max-w-[160px]">
            {request?.document_name}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition"
            title="Histórico"
          >
            <Clock className="w-3.5 h-3.5" />
            Histórico
          </button>
        </div>
      </header>

      {/* Document Viewer - Ocupa toda a tela */}
      <main className="flex-1 min-h-0 relative overflow-hidden bg-white">
        {pdfUrl ? (
          isDocx ? (
            // Renderizar DOCX com docx-preview
            <div className="w-full h-full overflow-auto bg-white pb-24">
              {docxLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
                    <p className="text-sm text-slate-600">Carregando documento...</p>
                  </div>
                </div>
              )}
              {/* Documento Principal */}
              <div 
                ref={docxContainerRef} 
                className="bg-slate-100 docx-responsive flex flex-col items-center"
                style={{ 
                  width: '100%',
                  overflow: 'auto',
                  minHeight: '400px',
                  padding: '20px',
                }}
              />
              
              {/* Documentos Anexos - Renderizados inline */}
              {attachments.length > 0 && (
                <div className="border-t-4 border-slate-300 mt-4">
                  <div className="bg-slate-100 px-4 py-2 text-center border-b border-slate-200">
                    <span className="text-sm font-medium text-slate-600">
                      Documentos Anexos ({attachments.length})
                    </span>
                  </div>
                  {attachments.map((attach, idx) => (
                    <div key={`attach-${idx}`} className="border-b border-slate-200">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                        <span className="text-xs font-medium text-slate-500">
                          Anexo {idx + 1}
                        </span>
                      </div>
                      <div 
                        ref={el => { attachmentRefs.current[idx] = el; }}
                        className="bg-white docx-responsive"
                        style={{ 
                          width: '100%',
                          overflow: 'auto',
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Renderizar PDF com iframe
            <>
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH`}
                className="w-full h-full border-0 bg-white"
                title="Documento PDF"
                onLoad={() => setPdfFrameLoaded(true)}
              />
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-4 bg-white" />
            </>
          )
        ) : (
          <div className="w-full h-full bg-white" />
        )}
      </main>

      {step === 'success' && !isFullyLoaded && (
        <div className="fixed inset-0 z-40">
          <LoadingScreen title="Carregando documento" subtitle="Estamos preparando tudo…" />
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-5 bg-slate-50/80 backdrop-blur-md">
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-orange-600/4 blur-3xl" />
            <div className="absolute -bottom-28 -right-28 h-80 w-80 rounded-full bg-amber-600/4 blur-3xl" />
          </div>

          <div className="relative w-full max-w-sm">
            <div className="rounded-2xl bg-white border border-orange-100 shadow-[0_18px_45px_rgba(15,23,42,0.08)] p-6">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-orange-600 to-amber-600 shadow-[0_10px_20px_rgba(234,88,12,0.25)]" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Shield className="h-5 w-5 text-white" />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-slate-900 text-base font-semibold tracking-tight">Enviando assinatura</div>
                  <div className="mt-0.5 text-sm text-slate-600">{signingStatusMessages[signingStatusIndex]}</div>
                </div>

                <div className="pt-0.5 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-orange-50/50 ring-1 ring-orange-200/60 px-3.5 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Documento</div>
                <div className="mt-0.5 text-sm text-slate-800 font-medium truncate">{(request?.document_name || 'Documento').trim()}</div>
              </div>

              <div className="mt-5">
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-orange-500/35 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]" />
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <span>Criptografado</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    <span>Verificado</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-center text-[11px] text-slate-500">
                Não feche esta janela. Você será redirecionado automaticamente.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botão Assinar - Flutuante estilizado */}
      {signer?.status !== 'signed' && (
        (() => {
          const isWaiting = !canOpenSignModal || queuedOpenSignModal;
          const isButtonDisabled = loading || isSignModalOpen;
          const buttonClass = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-3 text-white font-bold text-sm rounded-full shadow-[0_8px_30px_rgb(234,88,12,0.4)] transition-all duration-200 whitespace-nowrap ${isButtonDisabled ? 'bg-slate-400 cursor-not-allowed opacity-80' : isWaiting ? 'bg-orange-600/70 hover:bg-orange-600/70 cursor-wait' : 'bg-orange-600 hover:bg-orange-700 active:scale-95'}`;

          return (
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
          );
        })()
      )}

      {/* Modal - Full screen no mobile */}
      {isSignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-100 md:bg-slate-100/80 md:backdrop-blur-sm flex flex-col md:items-center md:justify-center">
          <div className="bg-white w-full h-full md:h-auto md:max-w-lg md:rounded-2xl md:shadow-2xl overflow-hidden md:max-h-[90vh] flex flex-col">
            {/* Header */}
             <div 
               className="flex-shrink-0 px-5 py-4 flex items-center justify-between md:rounded-t-2xl"
               style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 55%, #c2410c 100%)' }}
             >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                  <PenTool className="w-5 h-5 text-white" />
                </div>
                 <div>
                   <div className="text-white font-semibold">Assinar Documento</div>
                   <div className="text-xs" style={{ color: 'rgba(255,237,213,1)' }}>Etapa {(modalStep === 'google_auth' || modalStep === 'phone_otp') ? '1' : modalStep === 'data' ? '2' : modalStep === 'signature' ? '3' : modalStep === 'facial' ? '4' : '5'} de 5</div>
                 </div>
              </div>
              <button onClick={closeSignModal} className="p-2 rounded-lg" style={{ color: 'rgba(255,255,255,0.8)' }}>
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex-shrink-0 h-1.5 bg-slate-200">
              <div 
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ width: (modalStep === 'google_auth' || modalStep === 'phone_otp') ? '20%' : modalStep === 'data' ? '40%' : modalStep === 'signature' ? '60%' : modalStep === 'location' ? '80%' : '100%' }}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-white">
              {/* Etapa 1: Autenticação / Identificação */}
              {modalStep === 'google_auth' && (
                <div className="text-center">
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 mb-3">Confirme sua identidade</h2>
                    <p className="text-slate-500 text-sm leading-relaxed max-w-xs mx-auto">
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
                        onClick={() => setModalStep('data')}
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
                        {/* Botão Google - renderizado diretamente pelo Google Identity */}
                        <div ref={googleButtonRef} className="flex justify-center" />

                        <div className="relative py-2 flex items-center justify-center">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200" />
                          </div>
                          <div className="relative bg-white px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            OU
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setModalStep('phone_otp')}
                          className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3.5 px-4 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-slate-900/20 transition-all duration-200 active:scale-[0.98]"
                        >
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2"/>
                            <line x1="9" y1="18" x2="15" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                          Continuar com Telefone
                        </button>

                        <div className="pt-4 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const phone = '5565984046375';
                              const docName = (request?.document_name || 'documento').trim();
                              const msg = `Olá! Preciso de ajuda para assinar o documento: ${docName}. Token: ${token}`;
                              const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
                              window.open(url, '_blank');
                            }}
                            className="text-orange-600 hover:text-orange-700 text-sm font-semibold transition-colors"
                          >
                            Precisa de ajuda?
                          </button>
                        </div>
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
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
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
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 tracking-widest text-center"
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
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/30 disabled:opacity-50 transition"
                      >
                        {phoneOtpLoading ? 'Validando…' : 'Validar e continuar'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setModalStep('google_auth')}
                      className="w-full py-3 border border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Voltar
                    </button>
                  </div>
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
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
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
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setModalStep('signature')}
                    disabled={!canProceedFromData}
                    className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-orange-500/30 disabled:opacity-50 transition-colors"
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
                      <div className="w-full h-56 bg-white rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] border-2 border-dashed border-gray-300 hover:border-orange-400 transition-colors overflow-hidden relative">
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
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-orange-500/20 text-6xl transform -rotate-12">✍️</span>
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
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
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
                  <div className="mb-6 relative group">
                    <div className="w-24 h-24 bg-orange-50 rounded-full flex items-center justify-center mb-4 ring-4 ring-white shadow-lg">
                      <MapPin className="w-12 h-12 text-orange-500" />
                    </div>
                  </div>

                  <h1 className="text-2xl font-bold text-slate-800 mb-3">Ativar Localização</h1>
                  <p className="text-slate-500 mb-8 text-sm leading-relaxed px-4">
                    Para sua segurança e conformidade jurídica, precisamos confirmar sua localização atual durante o processo de assinatura.
                  </p>

                  {/* Info box */}
                  <div className="w-full bg-slate-50 border border-slate-100 rounded-lg p-4 mb-8 text-left flex items-start">
                    <AlertCircle className="w-5 h-5 text-orange-500 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-slate-800 font-medium">Por que isso é necessário?</p>
                      <p className="text-xs text-slate-500 mt-1">
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
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:transform-none"
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
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md transition-all"
                      >
                        Continuar
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Etapa 5: Verificação facial */}
              {modalStep === 'facial' && (
                <div className="space-y-5">
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-800">Verificação facial</h2>
                    <p className="text-sm text-slate-500 mt-1">Tire uma selfie para validar a assinatura</p>
                  </div>

                  {facialData ? (
                    <div className="space-y-4">
                      {/* Preview da foto capturada */}
                      <div className="relative">
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-4 border border-emerald-200">
                          <div className="flex flex-col items-center">
                            <div className="relative mb-3">
                              <img 
                                src={facialData} 
                                alt="Foto" 
                                className="w-32 h-32 object-cover rounded-full border-4 border-white shadow-lg" 
                                style={{ transform: 'scaleX(-1)' }} 
                              />
                              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
                                <CheckCircle className="w-5 h-5 text-white" />
                              </div>
                            </div>
                            <p className="text-base font-semibold text-emerald-800">Foto capturada!</p>
                            <p className="text-sm text-emerald-600">Verificação facial concluída</p>
                          </div>
                        </div>
                      </div>
                      
                      <button
                        onClick={() => {
                          setFacialData(null);
                          startCamera();
                        }}
                        className="w-full py-3 border border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50 transition flex items-center justify-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Tirar novamente
                      </button>
                      <button
                        onClick={handleSign}
                        disabled={loading}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
                  ) : (
                    <div className="space-y-4">
                      {!cameraActive ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
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
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                            >
                              <ChevronLeft className="w-4 h-4" />
                              Voltar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="relative rounded-2xl overflow-hidden shadow-xl">
                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-80 object-cover" style={{ transform: 'scaleX(-1)' }} />

                            {/* Overlay escuro nas bordas */}
                            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />

                            {/* Moldura central animada */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="relative">
                                {/* Círculo externo com animação de pulso */}
                                <div className="w-48 h-48 rounded-full border-[3px] border-white/30 animate-pulse" />

                                {/* Círculo interno sólido */}
                                <div className="absolute inset-2 rounded-full border-[3px] border-white shadow-lg" />

                                {/* Marcadores de alinhamento */}
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full" />
                                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full" />
                                <div className="absolute top-1/2 -left-3 -translate-y-1/2 w-1 h-6 bg-white rounded-full" />
                                <div className="absolute top-1/2 -right-3 -translate-y-1/2 w-1 h-6 bg-white rounded-full" />
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
                            className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-orange-500/30 transition-all flex items-center justify-center gap-2"
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
            </div>
          </div>
        </div>
      )}

      {/* Histórico (overlay) */}
      {activeTab === 'history' && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center md:justify-center p-0 md:p-6">
          <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
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
  );
};

export default PublicSigningPage;
