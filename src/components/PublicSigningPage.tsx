import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Download, FileText, Loader2, MapPin, PenTool, RotateCcw, Scale, Share2, User, X, Shield } from 'lucide-react';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import { googleAuthService, type GoogleUser } from '../services/googleAuth.service';
import { useToastContext } from '../contexts/ToastContext';
import type { Signer, SignatureRequest } from '../types/signature.types';
import SignatureReport from './SignatureReport';

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

const PublicSigningPage: React.FC<PublicSigningPageProps> = ({ token }) => {
  const toast = useToastContext();
  const [step, setStep] = useState<SigningStep>('loading');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  const [signerData, setSignerData] = useState<SignerData>({ name: '', cpf: '', phone: '' });
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'signers' | 'history'>('signers');
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
  const [viewingSignedDocument, setViewingSignedDocument] = useState(false);
  const [signedDocumentUrl, setSignedDocumentUrl] = useState<string | null>(null);

  // Google Auth
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitAttemptsRef = useRef(0);

  useEffect(() => {
    loadSignerData();
  }, [token]);

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
      // Aguardar o elemento ser renderizado no DOM
      const timer = setTimeout(() => {
        if (googleButtonRef.current) {
          initGoogleAuth();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isSignModalOpen, modalStep, googleUser]);

  
  const initGoogleAuth = async () => {
    if (!googleButtonRef.current) return;
    try {
      setGoogleAuthLoading(true);
      setGoogleAuthError(null);
      await googleAuthService.initialize();
      googleButtonRef.current.innerHTML = '';
      
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
        google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 300,
        });
      } else {
        googleInitAttemptsRef.current += 1;
        if (googleInitAttemptsRef.current <= 8) {
          window.setTimeout(() => initGoogleAuth(), 250);
        } else {
          setGoogleAuthError('Não foi possível carregar o botão do Google. Use o login alternativo.');
        }
      }
    } catch (err: any) {
      console.error('Erro ao inicializar Google Auth:', err);
      setGoogleAuthError('Erro ao carregar autenticação Google');
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  const finalizeGoogleUser = (user: GoogleUser) => {
    setGoogleUser(user);

    if (signer?.email && user.email.toLowerCase() !== signer.email.toLowerCase()) {
      setGoogleAuthError(
        `O email autenticado (${user.email}) não corresponde ao email do signatário (${signer.email}). Por favor, use a conta correta.`
      );
      setGoogleUser(null);
      return;
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
      const data = await signatureService.getSignerWithRequestByToken(token);
      
      if (!data) {
        setError('Link de assinatura inválido ou expirado.');
        setStep('error');
        return;
      }

      setSigner(data.signer);
      setRequest(data.request);
      setSignerData({ name: data.signer.name || '', cpf: data.signer.cpf || '', phone: '' });
      if (data.creator) setCreator(data.creator);

      // Tentar carregar preview do documento
      if (data.request.document_path) {
        try {
          const url = await signatureService.getDocumentPreviewUrl(data.request.document_path);
          if (url) setPdfUrl(url);
        } catch (e) {
          console.warn('Não foi possível carregar preview do documento:', e);
        }
      }

      if (data.signer.status === 'signed') {
        setStep('already_signed');
      } else {
        // Registrar visualização
        await signatureService.markSignerAsViewed(data.signer.id);
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
          // Dados de autenticação
          auth_provider: googleUser ? 'google' : 'email_link',
          auth_email: googleUser?.email || signer.email || undefined,
          auth_google_sub: googleUser?.sub || undefined,
          auth_google_picture: googleUser?.picture || undefined,
        },
        ipAddress,
        userAgent
      );
      
      // Gerar e salvar o PDF assinado no storage
      if (request && pdfUrl) {
        try {
          const signedPdfPath = await pdfSignatureService.saveSignedPdfToStorage({
            request,
            signer: result,
            originalPdfUrl: pdfUrl,
            creator,
          });
          // Atualizar o signer com o path do PDF assinado
          await signatureService.updateSignerSignedDocumentPath(result.id, signedPdfPath);
          result.signed_document_path = signedPdfPath;
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
        if (!signer.signed_document_path) {
          toast.error('Documento assinado indisponível no momento.');
          return;
        }

        const url = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path);
        if (!url) {
          toast.error('Não foi possível abrir o documento assinado.');
          return;
        }

        window.open(url, '_blank');
      } catch (e) {
        console.error('Erro ao baixar:', e);
        toast.error('Erro ao abrir documento assinado');
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
          
          {signer?.signed_document_path && (
            <button
              onClick={handleDownloadAlreadySigned}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-500/25"
            >
              <Download className="w-5 h-5" />
              Abrir documento assinado
            </button>
          )}
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
    
    // Mostrar documento assinado completo
    if (viewingSignedDocument && signedDocumentUrl) {
      return (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="bg-slate-800 text-white p-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">Documento Assinado</h2>
            <button 
              onClick={() => setViewingSignedDocument(false)}
              className="p-2 hover:bg-slate-700 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe 
              src={signedDocumentUrl} 
              className="w-full h-full" 
              title="Documento Assinado"
            />
          </div>
        </div>
      );
    }

    // Visualizar o documento assinado (apenas o PDF salvo no storage)
    const handleViewSignedDocument = async () => {
      if (!request || !signer) return;
      try {
        setDownloading(true);
        if (!signer.signed_document_path) {
          toast.error('Documento assinado indisponível no momento.');
          return;
        }

        const url = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path);
        if (!url) {
          toast.error('Não foi possível abrir o documento assinado.');
          return;
        }

        setSignedDocumentUrl(url);
        setViewingSignedDocument(true);
      } catch (e) {
        console.error('Erro ao gerar documento:', e);
        toast.error('Erro ao abrir documento assinado');
      } finally {
        setDownloading(false);
      }
    };
    
    // Abrir/baixar o documento assinado (apenas o PDF salvo no storage)
    const handleDownload = async () => {
      if (!request || !signer) return;
      try {
        setDownloading(true);
        if (!signer.signed_document_path) {
          toast.error('Documento assinado indisponível no momento.');
          return;
        }

        const url = await pdfSignatureService.getSignedPdfUrl(signer.signed_document_path);
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
      if (navigator.share && signer?.verification_hash) {
        try {
          await navigator.share({
            title: 'Documento Assinado',
            text: `Documento "${request?.document_name}" assinado digitalmente.`,
            url: `${window.location.origin}/#/verificar/${signer.verification_hash}`,
          });
        } catch (e) {
          console.log('Compartilhamento cancelado');
        }
      }
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-lg w-full">
          {/* Animação de sucesso */}
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 bg-emerald-100 rounded-full animate-ping opacity-25" />
            <div className="relative w-24 h-24 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <CheckCircle className="w-12 h-12 text-white" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-800 mb-2 text-center">Documento assinado com sucesso!</h1>
          <p className="text-slate-500 text-center mb-8">
            Sua assinatura digital foi registrada e validada.
          </p>

          {/* Card do documento */}
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-5 mb-6 border border-slate-200">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{request?.document_name}</p>
                <p className="text-sm text-slate-500 mt-1">Assinado em {signer?.signed_at ? formatDate(signer.signed_at) : ''}</p>
                {signer?.verification_hash && (
                  <p className="text-xs text-slate-400 mt-2 font-mono truncate">Hash: {signer.verification_hash.slice(0, 16)}...</p>
                )}
              </div>
            </div>
          </div>

          {/* Botões de ação */}
          <div className="space-y-3">
            {signer?.signed_document_path && (
              <button
                onClick={handleViewSignedDocument}
                disabled={downloading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-70"
              >
                {downloading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Abrindo documento...
                  </>
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    Ver documento assinado
                  </>
                )}
              </button>
            )}
            
            {signer?.signed_document_path && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-slate-600 to-slate-700 text-white rounded-xl font-semibold hover:from-slate-700 hover:to-slate-800 transition-all shadow-lg shadow-slate-500/25 disabled:opacity-70"
              >
                <Download className="w-5 h-5" />
                Abrir documento assinado
              </button>
            )}

            <button
              onClick={() => setShowReport(true)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl font-semibold hover:from-emerald-700 hover:to-emerald-800 transition-all shadow-lg shadow-emerald-500/25"
            >
              <FileText className="w-5 h-5" />
              Ver relatório de assinatura
            </button>

            {typeof navigator.share === 'function' && signer?.verification_hash && (
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all"
              >
                <Share2 className="w-5 h-5" />
                Compartilhar comprovante
              </button>
            )}
          </div>

          {/* Informação adicional */}
          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center">
              Uma cópia do documento assinado será enviada para seu e-mail.
              {signer?.verification_hash && (
                <> Você pode verificar a autenticidade em qualquer momento usando o hash de verificação.</>              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] h-[100dvh] bg-slate-900 flex flex-col overflow-hidden overscroll-none">
      {/* Header minimalista */}
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700/60 shadow-sm shadow-black/20 safe-area-top">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm">Assinatura Digital</span>
        </div>
        <div className="text-xs text-slate-400 truncate max-w-[150px]">
          {request?.document_name}
        </div>
      </header>

      {/* PDF Viewer - Ocupa toda a tela */}
      <main className="flex-1 min-h-0 relative overflow-hidden bg-white">
        {pdfUrl ? (
          <>
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH`}
              className="w-full h-full border-0 bg-white"
              title="Documento PDF"
            />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-4 bg-white" />
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-800">
            <FileText className="w-16 h-16 mb-4 text-slate-600" />
            <p className="text-base font-medium text-slate-400">Carregando documento...</p>
          </div>
        )}
      </main>

      {/* Botão Assinar - Grande, centralizado, com pulse */}
      {signer?.status !== 'signed' && (
        <div className="fixed inset-x-0 bottom-0 pb-4 pt-3 bg-gradient-to-t from-slate-900/95 via-slate-900/60 to-transparent pointer-events-none safe-area-bottom">
          <div className="flex justify-center pointer-events-auto">
            <button
              onClick={openSignModal}
              className="relative flex items-center justify-center gap-3 px-10 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 text-white font-bold text-base shadow-2xl shadow-blue-500/40 hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all"
            >
              {/* Efeito pulse */}
              <span className="absolute inset-0 rounded-2xl bg-blue-500 animate-ping opacity-20" />
              <PenTool className="w-5 h-5" />
              <span>ASSINAR DOCUMENTO</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal - Full screen no mobile */}
      {isSignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-100 md:bg-black/50 md:backdrop-blur-sm flex flex-col md:items-center md:justify-center">
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
    </div>
  );
};

export default PublicSigningPage;
