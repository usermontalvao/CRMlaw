import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Clock, Download, FileText, Loader2, MapPin, PenTool, RotateCcw, Scale, Share2, User, X, Shield } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '@/services/pdfSignature.service';
import { googleAuthService, type GoogleUser } from '../services/googleAuth.service';
import { useToastContext } from '../contexts/ToastContext';
import type { SignatureAuditLog, SignatureField, Signer, SignatureRequest } from '../types/signature.types';
import SignatureReport from './SignatureReport';
import { renderAsync } from 'docx-preview';

interface PublicSigningPageProps {
  token: string;
}

type SigningStep = 'loading' | 'success' | 'error' | 'already_signed';
type ModalStep = 'google_auth' | 'data' | 'signature' | 'location' | 'facial' | 'confirm';

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
  const [step, setStep] = useState<SigningStep>('loading');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  const [signatureFields, setSignatureFields] = useState<SignatureField[]>([]);
  const [signerData, setSignerData] = useState<SignerData>({ name: '', cpf: '', phone: '' });
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isDocx, setIsDocx] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  
  // Documentos anexos
  const [attachments, setAttachments] = useState<{ name: string; url: string; rendered?: boolean; prefetched?: boolean; isDocx?: boolean }[]>([]);
  const attachmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const attachmentBlobRef = useRef<(Blob | null)[]>([]);
  const attachmentObjectUrlRef = useRef<(string | null)[]>([]);

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

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
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
            .docx-wrapper article,
            .docx-wrapper .docx {
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
              border-top-color: #3b82f6 !important;
              color: #3b82f6 !important;
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

  // Renderizar anexos DOCX quando carregados
  useEffect(() => {
    if (attachments.length === 0) return;
    
    const renderAttachments = async () => {
      let needsRetry = false;
      for (let i = 0; i < attachments.length; i++) {
        const attach = attachments[i];
        if (attach.rendered) continue;
        
        const container = attachmentRefs.current[i];
        if (!container) {
          needsRetry = true;
          continue;
        }
        
        // Verificar se é DOCX
        const isDocxFile = !!attach.isDocx;
        if (!isDocxFile) continue;
        
        try {
          console.log(`📎 Renderizando anexo ${i + 1}:`, attach.name);
          let blob = attachmentBlobRef.current[i];
          if (!blob) {
            const response = await fetch(attach.url);
            if (!response.ok) {
              console.error(`❌ Erro ao baixar anexo ${i + 1}:`, response.status);
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
          
          // Marcar como renderizado
          setAttachments(prev => prev.map((a, idx) => 
            idx === i ? { ...a, rendered: true } : a
          ));
          console.log(`✅ Anexo ${i + 1} renderizado com sucesso!`);
        } catch (err) {
          console.error(`❌ Erro ao renderizar anexo ${i + 1}:`, err);
        }
      }

      if (needsRetry) {
        setTimeout(renderAttachments, 100);
      }
    };
    
    renderAttachments();
  }, [attachments]);

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

    if (modalStep === 'facial') {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isSignModalOpen, modalStep]);

  
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
          void initGoogleAuth(token, el);
          return;
        }

        tries += 1;
        if (tries <= 30) {
          window.setTimeout(tick, 50);
        }
      };

      const timer = window.setTimeout(tick, 0);
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
        
        // @ts-ignore
        google.accounts.id.renderButton(buttonEl, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 300,
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
    ctx.strokeStyle = '#1e40af';
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err: any) {
      console.error('Erro ao acessar câmera:', err);
      setCameraError('Não foi possível acessar a câmera. Verifique as permissões.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
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

      const result = await signatureService.signDocument(
        signer.id, 
        {
          signature_image: signatureData,
          facial_image: facialData || undefined,
          geolocation: locationData ? `${locationData.lat}, ${locationData.lng}` : undefined,
          signer_name: signerData.name || undefined,
          signer_cpf: signerData.cpf || undefined,
          signer_phone: signerData.phone || undefined,
          // Dados de autenticação
          auth_provider: googleUser ? 'google' : 'email_link',
          auth_email: googleUser?.email || undefined,
          auth_google_sub: googleUser?.sub || undefined,
          auth_google_picture: googleUser?.picture || undefined,
        },
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

  const openSignModal = () => {
    setModalStep('google_auth');
    setSignatureData(null);
    setFacialData(null);
    setHasSignature(false);
    setGoogleUser(null);
    setGoogleAuthError(null);
    setIsSignModalOpen(true);
  };

  const closeSignModal = () => {
    setIsSignModalOpen(false);
    setModalStep('google_auth');
    setGoogleUser(null);
    setGoogleAuthError(null);
  };

  // ========== RENDER ==========

  // Loading
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">Carregando documento...</p>
        </div>
      </div>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Erro</h1>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  // Already signed
  if (step === 'already_signed') {
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

    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Documento já assinado</h1>
          <p className="text-slate-600 mb-6">
            Este documento já foi assinado em {signer?.signed_at ? formatDate(signer.signed_at) : ''}.
          </p>
          
          <button
            onClick={handleDownloadAlreadySigned}
            disabled={downloadingAlreadySigned}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-70 disabled:cursor-wait"
          >
            {downloadingAlreadySigned ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Preparando...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Baixar documento assinado
              </>
            )}
          </button>
        </div>
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
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.25)] overflow-hidden">
            {/* Animação de sucesso */}
            <div className="px-6 pt-8 pb-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-9 h-9 text-[#00C48C]" />
              </div>

              <h1 className="mt-5 text-xl font-semibold text-gray-900 text-center">Documento assinado com sucesso!</h1>
              <p className="mt-1 text-sm text-gray-500 text-center">Sua assinatura digital foi registrada e validada.</p>
            </div>

            {/* Card do documento */}
            <div className="px-6 pb-6">
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-[#00C48C]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{request?.document_name}</div>
                    <div className="text-sm text-gray-500 mt-0.5">Assinado em {signer?.signed_at ? formatDate(signer.signed_at) : ''}</div>
                    {signer?.verification_hash && (
                      <div className="mt-3">
                        <div className="text-xs text-gray-500 font-medium">Código de autenticação</div>
                        <div className="mt-1 font-mono text-xs tracking-wide break-all bg-gray-50 border border-gray-200 rounded-lg p-2">
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
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#00C48C] text-white rounded-xl font-medium hover:bg-emerald-600 transition shadow-lg shadow-emerald-500/20 disabled:opacity-70"
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
                className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-gray-200 text-gray-800 rounded-xl font-medium hover:bg-gray-50 transition"
              >
                <FileText className="w-5 h-5 text-gray-700" />
                Ver relatório de assinatura
              </button>

              {signer?.signed_document_path && (
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-white border border-gray-200 text-gray-800 rounded-xl font-medium hover:bg-gray-50 transition"
                >
                  <Share2 className="w-5 h-5 text-gray-700" />
                  Compartilhar documento assinado
                </button>
              )}
            </div>

            {/* Informação adicional */}
            <div className="px-6 pb-6 border-t border-gray-100">
              <p className="pt-4 text-xs text-gray-500 text-center">
                Uma cópia do documento assinado será enviada para seu e-mail.
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
      <header className="bg-slate-900 px-3 py-2 flex items-center justify-between border-b border-slate-700/50 safe-area-top">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-medium text-sm">Assinatura Digital</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-xs text-slate-400 truncate max-w-[160px]">
            {request?.document_name}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/60 hover:bg-slate-800 text-slate-200 text-xs font-medium transition"
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
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
              <style>{`
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
                
                /* Esconder scrollbar horizontal se possível */
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
                   /* Em mobile, precisamos permitir scroll horizontal ou escala */
                   /* Mas NÃO podemos mudar a largura do section, senão quebra o reflow */
                   .docx-responsive {
                     align-items: flex-start !important; /* Alinhar à esquerda para permitir scroll */
                   }
                }
              `}</style>
              
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
                          overflow: 'hidden',
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
              />
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-4 bg-white" />
            </>
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-800">
            <FileText className="w-16 h-16 mb-4 text-slate-600" />
            <p className="text-base font-medium text-slate-400">Carregando documento...</p>
          </div>
        )}
      </main>

      {/* Botão Assinar - Flutuante estilizado */}
      {signer?.status !== 'signed' && (
        <button
          onClick={openSignModal}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-full shadow-[0_8px_30px_rgb(37,99,235,0.4)] active:scale-95 transition-all duration-200 whitespace-nowrap"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <PenTool className="w-4 h-4" />
          ASSINAR DOCUMENTO
        </button>
      )}

      {/* Modal - Full screen no mobile */}
      {isSignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-100 md:bg-slate-100/80 md:backdrop-blur-sm flex flex-col md:items-center md:justify-center">
          <div className="bg-white w-full h-full md:h-auto md:max-w-lg md:rounded-2xl md:shadow-2xl overflow-hidden md:max-h-[90vh] flex flex-col">
            {/* Header */}
            <div 
              className="flex-shrink-0 px-5 py-4 flex items-center justify-between md:rounded-t-2xl"
              style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #4338ca 100%)' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                  <PenTool className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-white font-semibold">Assinar Documento</div>
                  <div className="text-xs" style={{ color: 'rgba(191,219,254,1)' }}>Etapa {modalStep === 'google_auth' ? '1' : modalStep === 'data' ? '2' : modalStep === 'signature' ? '3' : modalStep === 'facial' ? '4' : '5'} de 5</div>
                </div>
              </div>
              <button onClick={closeSignModal} className="p-2 rounded-lg" style={{ color: 'rgba(255,255,255,0.8)' }}>
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex-shrink-0 h-1.5 bg-slate-200">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: modalStep === 'google_auth' ? '20%' : modalStep === 'data' ? '40%' : modalStep === 'signature' ? '60%' : modalStep === 'location' ? '80%' : '100%' }}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-white">
              {/* Etapa 1: Autenticação / Identificação */}
              {modalStep === 'google_auth' && (
                <div className="text-center">
                  <h2 className="text-xl font-bold text-slate-800 mb-2">Confirme sua identidade</h2>
                  <p className="text-slate-400 text-sm mb-6">
                    Escolha uma das opções para se identificar:
                  </p>

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
                          <p className="font-medium text-emerald-700">{googleUser.name}</p>
                          <p className="text-sm text-emerald-600">{googleUser.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setModalStep('data')}
                        className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition"
                      >
                        Continuar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {googleAuthLoading ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-slate-500">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Carregando...</span>
                        </div>
                      ) : (
                        <>
                          <div ref={googleButtonRef} className="flex justify-center" />

                          <div className="relative my-3">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-slate-200" />
                            </div>
                            <div className="relative flex justify-center text-xs">
                              <span className="px-3 bg-white text-slate-400 uppercase">ou</span>
                            </div>
                          </div>

                          <button
                            onClick={() => setModalStep('data')}
                            className="w-full h-10 px-6 flex items-center justify-center gap-3 rounded-full bg-slate-800 hover:bg-slate-700 font-medium text-sm text-white transition"
                          >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2"/>
                              <line x1="9" y1="18" x2="15" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            Continuar com Telefone
                          </button>

                          <button className="mt-4 text-sm text-blue-500 hover:text-blue-600 transition">
                            Precisa de ajuda?
                          </button>
                        </>
                      )}
                    </div>
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
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
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
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setModalStep('signature')}
                    disabled={!canProceedFromData}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 disabled:opacity-50 transition-colors"
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
                      <div className="w-full h-56 bg-white rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)] border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors overflow-hidden relative">
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
                            <span className="text-blue-500/20 text-6xl transform -rotate-12">✍️</span>
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
                        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
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
                    <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-4 ring-4 ring-white shadow-lg">
                      <MapPin className="w-12 h-12 text-blue-500" />
                    </div>
                  </div>

                  <h1 className="text-2xl font-bold text-slate-800 mb-3">Ativar Localização</h1>
                  <p className="text-slate-500 mb-8 text-sm leading-relaxed px-4">
                    Para sua segurança e conformidade jurídica, precisamos confirmar sua localização atual durante o processo de assinatura.
                  </p>

                  {/* Info box */}
                  <div className="w-full bg-slate-50 border border-slate-100 rounded-lg p-4 mb-8 text-left flex items-start">
                    <AlertCircle className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
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
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 transform hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:transform-none"
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
                        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3.5 px-4 rounded-lg shadow-md transition-all"
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
                    <div className="space-y-3">
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
                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2"
                      >
                        <Camera className="w-5 h-5" />
                        Capturar foto
                      </button>
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
                      item.action === 'viewed' ? 'bg-blue-600' :
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
