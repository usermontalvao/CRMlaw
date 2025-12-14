import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  FileText, Upload, Plus, Trash2, X, Check, Clock, CheckCircle, Send, Copy,
  User, Mail, Loader2, ChevronLeft, Eye, Filter, Search, MousePointer2,
  Type, Hash, Calendar, PenTool, Users, Download, AlertTriangle, ExternalLink, ChevronRight, ZoomIn, ZoomOut, Shield,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { signatureService } from '../services/signature.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import { supabase } from '../config/supabase';
import { documentTemplateService } from '../services/documentTemplate.service';
import { signatureFieldsService } from '../services/signatureFields.service';
import SignatureCanvas from './SignatureCanvas';
import FacialCapture from './FacialCapture';
import type {
  SignatureRequest, SignatureRequestWithSigners, Signer, CreateSignatureRequestDTO,
  SignerAuthMethod, SignatureFieldType, SignatureAuditLog,
} from '../types/signature.types';
import type { GeneratedDocument } from '../types/document.types';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  file: string;
  scale: number;
  numPages: number;
  onLoadSuccess: (data: { numPages: number }) => void;
  onLoadError: (err: any) => void;
  onPageClick: (pageNum: number, xPercent: number, yPercent: number) => void;
  pageRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

const PdfViewer = React.memo(({ file, scale, numPages, onLoadSuccess, onLoadError, onPageClick, pageRefs }: PdfViewerProps) => {
  const onPageClickRef = useRef(onPageClick);
  const onLoadSuccessRef = useRef(onLoadSuccess);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => { onPageClickRef.current = onPageClick; }, [onPageClick]);
  useEffect(() => { onLoadSuccessRef.current = onLoadSuccess; }, [onLoadSuccess]);
  useEffect(() => { onLoadErrorRef.current = onLoadError; }, [onLoadError]);

  return (
    <Document
      file={file}
      onLoadSuccess={onLoadSuccessRef.current}
      onLoadError={onLoadErrorRef.current}
      loading={null}
      className="flex flex-col items-center gap-3"
    >
      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
        <div
          key={pageNum}
          ref={(el) => { if (el) pageRefs.current.set(pageNum, el); }}
          data-page={pageNum}
          className="relative bg-white shadow-xl"
          style={{ width: 'fit-content' }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            onPageClickRef.current(pageNum, x, y);
          }}
        >
          <Page
            pageNumber={pageNum}
            scale={scale}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </div>
      ))}
    </Document>
  );
}, (prev, next) => prev.file === next.file && prev.scale === next.scale && prev.numPages === next.numPages);

const MemoPdfDocument = React.memo((props: any) => <Document {...props} />);
const MemoPdfPage = React.memo((props: any) => <Page {...props} />);

type WizardStep = 'list' | 'upload' | 'signers' | 'position' | 'settings' | 'success';

interface DraftSigner {
  id: string; name: string; email: string; cpf: string; role: string; order: number; deliveryMethod: 'email' | 'link';
}

interface DraftField {
  localId: string; signerId: string; fieldType: SignatureFieldType;
  pageNumber: number; xPercent: number; yPercent: number; wPercent: number; hPercent: number;
}

interface SignatureSettings {
  requireCpf: boolean; requireBirthdate: boolean; allowRefusal: boolean;
  blockAfterDeadline: boolean; expiresAt: string; signatureAppearance: string;
}

const FIELD_PRESETS: Record<SignatureFieldType, { w: number; h: number; label: string; icon: React.ElementType }> = {
  signature: { w: 25, h: 8, label: 'Assinatura', icon: PenTool },
  initials: { w: 12, h: 6, label: 'Rubrica', icon: PenTool },
  name: { w: 20, h: 5, label: 'Nome', icon: Type },
  cpf: { w: 16, h: 5, label: 'CPF', icon: Hash },
  date: { w: 14, h: 5, label: 'Data', icon: Calendar },
};

const SignatureModule: React.FC = () => {
  const toast = useToastContext();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<SignatureRequestWithSigners[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'signed'>('all');

  const [wizardStep, setWizardStep] = useState<WizardStep>('list');
  const [wizardLoading, setWizardLoading] = useState(false);

  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [selectedDocumentPath, setSelectedDocumentPath] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [signers, setSigners] = useState<DraftSigner[]>([
    { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: 1, deliveryMethod: 'email' },
  ]);
  const [signerOrder, setSignerOrder] = useState<'none' | 'sequential'>('none');

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [selectedSignerForField, setSelectedSignerForField] = useState<string>('');
  const [selectedFieldType, setSelectedFieldType] = useState<SignatureFieldType>('signature');
  const [placingMode, setPlacingMode] = useState(false);
  const [draggingField, setDraggingField] = useState<{ localId: string; pageNumber: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const positionContainerRef = useRef<HTMLDivElement>(null);
  const pageRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const placingModeRef = useRef<boolean>(false);
  const selectedFieldTypeRef = useRef<SignatureFieldType>('signature');
  const selectedSignerForFieldRef = useRef<string>('');
  const signersRef = useRef<DraftSigner[]>([]);

  const [pdfNumPages, setPdfNumPages] = useState<number>(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState<number>(1);
  const [pdfScale, setPdfScale] = useState<number>(1.3);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);

  const [settings, setSettings] = useState<SignatureSettings>({
    requireCpf: false, requireBirthdate: false, allowRefusal: true,
    blockAfterDeadline: false, expiresAt: '', signatureAppearance: 'signature_only',
  });

  const [createdRequest, setCreatedRequest] = useState<SignatureRequestWithSigners | null>(null);
  const [detailsRequest, setDetailsRequest] = useState<SignatureRequestWithSigners | null>(null);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signingSigner, setSigningSigner] = useState<Signer | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [signStep, setSignStep] = useState<'signature' | 'facial' | 'confirm'>('signature');
  const [signLoading, setSignLoading] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [viewDocLoading, setViewDocLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [requestsData, docsData] = await Promise.all([
        signatureService.listRequestsWithSigners(),
        documentTemplateService.listGeneratedDocuments(),
      ]);
      setRequests(requestsData);
      setGeneratedDocuments(docsData);
    } catch (error: any) {
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      const matchesSearch = !searchTerm || req.document_name.toLowerCase().includes(searchTerm.toLowerCase()) || req.client_name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || req.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [requests, searchTerm, filterStatus]);

  const resetWizard = () => {
    setWizardStep('list');
    setSelectedDocumentId(''); setSelectedDocumentName(''); setSelectedDocumentPath('');
    setSelectedClientId(null); setSelectedClientName(null);
    setUploadedFile(null);
    setSigners([{ id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: 1, deliveryMethod: 'email' }]);
    setFields([]); setPdfPreviewUrl(null); setCreatedRequest(null);
    setSettings({ requireCpf: false, requireBirthdate: false, allowRefusal: true, blockAfterDeadline: false, expiresAt: '', signatureAppearance: 'signature_only' });
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.includes('pdf')) { toast.error('Selecione um arquivo PDF'); return; }
    setUploadedFile(file); setSelectedDocumentName(file.name); setSelectedDocumentId('');
    setSelectedDocumentPath('');
    setSelectedClientId(null);
    setSelectedClientName(null);
  };

  const handleSelectGeneratedDoc = async (doc: GeneratedDocument) => {
    setSelectedDocumentId(doc.id);
    setSelectedDocumentName(doc.file_name || doc.template_name);
    setSelectedDocumentPath(doc.file_path || '');
    setSelectedClientId(doc.client_id || null);
    setSelectedClientName(doc.client_name || null);
    setUploadedFile(null);
    if (doc.file_path) {
      try { const url = await documentTemplateService.getGeneratedDocumentSignedUrl(doc); setPdfPreviewUrl(url); } catch {}
    }
  };

  const addSigner = () => {
    setSigners((prev) => [...prev, { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: prev.length + 1, deliveryMethod: 'email' }]);
  };

  const removeSigner = (id: string) => { if (signers.length > 1) setSigners((prev) => prev.filter((s) => s.id !== id)); };

  const updateSigner = (id: string, field: keyof DraftSigner, value: string | number) => {
    setSigners((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  useEffect(() => {
    if (wizardStep === 'position' && !pdfPreviewUrl && uploadedFile) {
      setPdfPreviewUrl(URL.createObjectURL(uploadedFile));
    }
  }, [wizardStep, pdfPreviewUrl, uploadedFile]);

  useEffect(() => {
    if (!pdfPreviewUrl) return;
    setPdfLoading(true);
    setPdfNumPages(0);
    setPdfCurrentPage(1);
    setPdfScale(1.3);
  }, [pdfPreviewUrl]);

  const handlePdfLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
    setPdfLoading(false);
  }, []);

  const handlePdfLoadError = useCallback((err: any) => {
    console.error('Erro ao carregar PDF:', err);
    setPdfLoading(false);
    toast.error('Erro ao carregar o PDF');
  }, [toast]);

  useEffect(() => { if (signers.length > 0 && !selectedSignerForField) setSelectedSignerForField(signers[0].id); }, [signers, selectedSignerForField]);

  useEffect(() => { placingModeRef.current = placingMode; }, [placingMode]);
  useEffect(() => { selectedFieldTypeRef.current = selectedFieldType; }, [selectedFieldType]);
  useEffect(() => { selectedSignerForFieldRef.current = selectedSignerForField; }, [selectedSignerForField]);
  useEffect(() => { signersRef.current = signers; }, [signers]);

  const handlePageClick = useCallback((pageNum: number, xPercent: number, yPercent: number) => {
    if (!placingModeRef.current) return;
    const preset = FIELD_PRESETS[selectedFieldTypeRef.current];
    const currentSigners = signersRef.current;
    const signerId = selectedSignerForFieldRef.current || currentSigners[0]?.id;
    const newField: DraftField = {
      localId: crypto.randomUUID(),
      signerId,
      fieldType: selectedFieldTypeRef.current,
      pageNumber: pageNum,
      xPercent: Math.max(0, Math.min(100 - preset.w, xPercent)),
      yPercent: Math.max(0, Math.min(100 - preset.h, yPercent)),
      wPercent: preset.w,
      hPercent: preset.h,
    };

    setFields((prev) => [...prev, newField]);
    placingModeRef.current = false; // Update ref immediately
    setPlacingMode(false);
    toast.success(`Campo ${preset.label} adicionado na página ${pageNum}`);
  }, [toast]); // `toast` is the only dependency as it's an external utility

  useEffect(() => {
    if (!draggingField) return;
    const handleMove = (e: MouseEvent) => {
      const pageEl = pageRefsMap.current.get(draggingField.pageNumber);
      if (!pageEl) return;
      const rect = pageEl.getBoundingClientRect();
      const dx = ((e.clientX - draggingField.startX) / rect.width) * 100;
      const dy = ((e.clientY - draggingField.startY) / rect.height) * 100;
      setFields((prev) => prev.map((f) => f.localId !== draggingField.localId ? f : {
        ...f, xPercent: Math.max(0, Math.min(100 - f.wPercent, draggingField.originX + dx)),
        yPercent: Math.max(0, Math.min(100 - f.hPercent, draggingField.originY + dy)),
      }));
    };
    const handleUp = () => setDraggingField(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [draggingField]);

  const handleSubmit = async () => {
    try {
      setWizardLoading(true);
      const docId = selectedDocumentId || crypto.randomUUID();
      let docPath: string | null = selectedDocumentPath || null;
      if (!docPath && uploadedFile) {
        docPath = await signatureService.uploadSignatureDocumentPdf(uploadedFile, docId);
        setSelectedDocumentPath(docPath);
      }

      const payload: CreateSignatureRequestDTO = {
        document_id: docId,
        document_name: selectedDocumentName, document_path: docPath,
        client_id: selectedClientId, client_name: selectedClientName, auth_method: 'signature_only' as SignerAuthMethod,
        expires_at: settings.expiresAt || null,
        signers: signers.map((s, i) => ({ name: s.name, email: s.email, cpf: s.cpf || null, phone: null, role: s.role || null, order: i + 1 })),
      };
      const created = await signatureService.createRequest(payload);
      if (fields.length > 0) {
        const fieldsPayload = fields.map((f) => {
          const signer = signers.find((s) => s.id === f.signerId);
          const createdSigner = created.signers.find((cs) => cs.email === signer?.email);
          return { signer_id: createdSigner?.id ?? null, field_type: f.fieldType, page_number: f.pageNumber, x_percent: f.xPercent, y_percent: f.yPercent, w_percent: f.wPercent, h_percent: f.hPercent };
        });
        await signatureFieldsService.upsertFields(created.id, fieldsPayload);
      }
      setCreatedRequest(created); setWizardStep('success'); toast.success('Documento enviado!'); loadData();
    } catch (error: any) { toast.error(error.message || 'Erro'); } finally { setWizardLoading(false); }
  };

  const openDetails = async (req: SignatureRequest) => {
    try { 
      const data = await signatureService.getRequestWithSigners(req.id); 
      setDetailsRequest(data);
      // Carregar audit log
      setAuditLogLoading(true);
      try {
        const logs = await signatureService.getAuditLog(req.id);
        setAuditLog(logs);
      } catch (e) {
        console.warn('Erro ao carregar audit log:', e);
        setAuditLog([]);
      } finally {
        setAuditLogLoading(false);
      }
    } catch { toast.error('Erro'); }
  };

  const copyLink = (token: string) => { navigator.clipboard.writeText(signatureService.generatePublicSigningUrl(token)); toast.success('Link copiado!'); };

  const handleDeleteRequest = async (requestId: string) => {
    if (!confirm('Tem certeza que deseja excluir este documento? Esta ação não pode ser desfeita.')) return;
    try {
      await signatureService.deleteRequest(requestId);
      toast.success('Documento excluído!');
      setDetailsRequest(null);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir');
    }
  };

  const handleDownloadDocument = async (request: SignatureRequestWithSigners) => {
    if (!request.document_path) {
      toast.error('Documento não disponível para download');
      return;
    }
    try {
      toast.info('Preparando download...');
      const url = await signatureService.getDocumentPreviewUrl(request.document_path);
      if (!url) {
        toast.error('Erro ao obter URL do documento');
        return;
      }
      console.log('[DOWNLOAD] URL do documento:', url);
      
      // Buscar dados atualizados do request com signers do banco
      const freshRequest = await signatureService.getRequestWithSigners(request.id);
      if (!freshRequest) {
        toast.error('Erro ao carregar dados do documento');
        return;
      }
      
      // Se tem signatário que assinou, gerar PDF com assinatura visual
      const signedSigner = freshRequest.signers.find(s => s.status === 'signed');
      console.log('[DOWNLOAD] signedSigner:', signedSigner?.name, signedSigner?.status);
      
      if (signedSigner) {
        const freshSigner = await signatureService.getSignerById(signedSigner.id);
        if (!freshSigner) {
          toast.error('Erro ao carregar dados do signatário');
          return;
        }
        console.log('[DOWNLOAD] Gerando PDF assinado...');
        try {
          await pdfSignatureService.downloadSignedPdf({
            request: freshRequest,
            signer: freshSigner,
            originalPdfUrl: url,
            creator: null,
          });
          toast.success('PDF assinado gerado com sucesso!');
        } catch (pdfError: any) {
          console.error('[DOWNLOAD] Erro ao gerar PDF assinado:', pdfError);
          toast.error('Erro ao gerar PDF assinado. Baixando original...');
          // Fallback: baixar original
          await downloadOriginalPdf(url, request.document_name);
        }
      } else {
        // Documento sem assinatura - baixar original
        await downloadOriginalPdf(url, request.document_name);
      }
    } catch (error: any) {
      console.error('[DOWNLOAD] Erro geral:', error);
      toast.error('Erro ao baixar documento: ' + (error.message || 'Erro desconhecido'));
    }
  };

  const downloadOriginalPdf = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 5000);
      toast.success('Download iniciado!');
    } catch (err: any) {
      console.error('[DOWNLOAD] Erro ao baixar original:', err);
      // Fallback: abrir em nova aba
      window.open(url, '_blank');
      toast.info('Documento aberto em nova aba');
    }
  };

  const openSignModal = (signer: Signer) => { setSigningSigner(signer); setSignatureData(null); setFacialData(null); setSignStep('signature'); setSignModalOpen(true); };

  const handleSign = async () => {
    if (!signingSigner || !signatureData) { toast.error('Assinatura obrigatória'); return; }
    try {
      setSignLoading(true);
      await signatureService.signDocument(signingSigner.id, { signature_image: signatureData, facial_image: facialData });
      toast.success('Assinado!'); setSignModalOpen(false); loadData();
      if (detailsRequest) openDetails({ id: detailsRequest.id } as SignatureRequest);
    } catch (error: any) { toast.error(error.message || 'Erro'); } finally { setSignLoading(false); }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'pending') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded"><Clock className="w-3 h-3" />Aguardando</span>;
    if (status === 'signed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded"><CheckCircle className="w-3 h-3" />Assinado</span>;
    return null;
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;

  // SUCCESS
  if (wizardStep === 'success' && createdRequest) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6"><Check className="w-10 h-10 text-blue-600" /></div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Documento criado e enviado com sucesso</h2>
          <p className="text-slate-600 mb-8">Seu documento foi <strong>enviado</strong> para os destinatários.</p>
          <div className="bg-slate-50 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Links de assinatura</h3>
            <div className="space-y-3">
              {createdRequest.signers.map((signer) => (
                <div key={signer.id} className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-blue-600" /></div>
                    <div className="min-w-0"><p className="font-medium text-slate-800 truncate">{signer.name}</p><p className="text-xs text-slate-500 truncate">{signatureService.generatePublicSigningUrl(signer.public_token!)}</p></div>
                  </div>
                  <button onClick={() => copyLink(signer.public_token!)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg"><Copy className="w-4 h-4" />Copiar</button>
                </div>
              ))}
            </div>
          </div>
          <button onClick={resetWizard} className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200">Fechar</button>
        </div>
      </div>
    );
  }

  // WIZARD
  if (wizardStep !== 'list') {
    const canProceedUpload = selectedDocumentName || uploadedFile;
    const canProceedSigners = signers.every((s) => s.name.trim());
    const steps = [
      { key: 'upload', label: 'Documento', icon: FileText },
      { key: 'signers', label: 'Signatários', icon: Users },
      { key: 'position', label: 'Posicionar', icon: MousePointer2 },
      { key: 'settings', label: 'Configurações', icon: Filter },
    ];
    const currentStepIndex = steps.findIndex(s => s.key === wizardStep);
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header com gradiente laranja */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 sticky top-0 z-20 shadow-lg">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => { 
                  if (wizardStep === 'upload') resetWizard(); 
                  else if (wizardStep === 'signers') setWizardStep('upload'); 
                  else if (wizardStep === 'position') setWizardStep('signers'); 
                  else if (wizardStep === 'settings') setWizardStep('position'); 
                }} 
                className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                <span className="font-medium">Voltar</span>
              </button>
              
              {/* Stepper */}
              <div className="flex-1 flex items-center justify-center px-2">
                <div className="flex items-center gap-1 overflow-x-auto max-w-full whitespace-nowrap">
                {steps.map((step, i) => {
                  const StepIcon = step.icon;
                  const isActive = wizardStep === step.key;
                  const isCompleted = i < currentStepIndex;
                  
                  return (
                    <React.Fragment key={step.key}>
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all ${
                        isActive 
                          ? 'bg-white text-orange-600 shadow-lg' 
                          : isCompleted 
                            ? 'bg-white/20 text-white' 
                            : 'bg-white/10 text-white/60'
                      }`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          isActive ? 'bg-orange-500 text-white' : isCompleted ? 'bg-white/30' : 'bg-white/20'
                        }`}>
                          {isCompleted ? <Check className="w-3.5 h-3.5" /> : i + 1}
                        </div>
                        <span className="text-xs sm:text-sm font-medium">{step.label}</span>
                      </div>
                      {i < steps.length - 1 && (
                        <div className={`w-6 h-0.5 ${i < currentStepIndex ? 'bg-white/40' : 'bg-white/20'}`} />
                      )}
                    </React.Fragment>
                  );
                })}
                </div>
              </div>
              
              {/* Controles de zoom - só aparece no passo position */}
              {wizardStep === 'position' && (
                <div className="flex items-center gap-2 bg-white/20 rounded-lg px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setPdfScale((s) => Math.max(0.5, Number((s - 0.1).toFixed(2))))}
                    className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-white min-w-[50px] text-center font-medium">{Math.round(pdfScale * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => setPdfScale((s) => Math.min(2, Number((s + 0.1).toFixed(2))))}
                    className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
              )}
              
              <button 
                onClick={() => { 
                  if (wizardStep === 'upload' && canProceedUpload) setWizardStep('signers'); 
                  else if (wizardStep === 'signers' && canProceedSigners) setWizardStep('position'); 
                  else if (wizardStep === 'position') setWizardStep('settings'); 
                  else if (wizardStep === 'settings') handleSubmit(); 
                }} 
                disabled={(wizardStep === 'upload' && !canProceedUpload) || (wizardStep === 'signers' && !canProceedSigners) || wizardLoading} 
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-orange-600 rounded-xl font-semibold hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-all"
              >
                {wizardLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : wizardStep === 'settings' ? (
                  <><Send className="w-4 h-4" />Enviar para assinatura</>
                ) : (
                  <>Avançar<ChevronLeft className="w-4 h-4 rotate-180" /></>
                )}
              </button>
            </div>
          </div>
        </div>

        {wizardStep === 'upload' && (
          <div className="max-w-6xl mx-auto p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-slate-800">Novo Documento para Assinatura</h2>
              <p className="text-slate-500 mt-2">Selecione o documento e informe os signatários</p>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Upload do documento */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-100">
                  <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-orange-500" />
                    Documento
                  </h3>
                </div>
                <div className="p-6">
                  <div 
                    className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
                      dragOver 
                        ? 'border-orange-500 bg-orange-50' 
                        : selectedDocumentName 
                          ? 'border-emerald-300 bg-emerald-50' 
                          : 'border-slate-200 hover:border-orange-300 hover:bg-orange-50/50'
                    }`} 
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} 
                    onDragLeave={() => setDragOver(false)} 
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} className="hidden" />
                    {selectedDocumentName ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center">
                          <CheckCircle className="w-8 h-8 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{selectedDocumentName}</p>
                          <p className="text-sm text-emerald-600 mt-1">Documento selecionado</p>
                        </div>
                        <button 
                          onClick={() => { setUploadedFile(null); setSelectedDocumentName(''); }} 
                          className="text-sm text-red-500 hover:text-red-600 font-medium"
                        >
                          Remover
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <Upload className="w-8 h-8 text-slate-400" />
                        </div>
                        <p className="text-slate-600 mb-4">Arraste o PDF aqui ou</p>
                        <button 
                          onClick={() => fileInputRef.current?.click()} 
                          className="px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/25"
                        >
                          Selecionar arquivo
                        </button>
                      </>
                    )}
                  </div>
                  
                  {generatedDocuments.length > 0 && (
                    <div className="mt-6">
                      <p className="text-sm font-medium text-slate-700 mb-3">Ou selecione um documento gerado:</p>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {generatedDocuments.slice(0, 5).map((doc) => (
                          <button 
                            key={doc.id} 
                            onClick={() => handleSelectGeneratedDoc(doc)} 
                            className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                              selectedDocumentId === doc.id 
                                ? 'border-orange-500 bg-orange-50' 
                                : 'border-slate-200 hover:border-orange-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              selectedDocumentId === doc.id ? 'bg-orange-100' : 'bg-slate-100'
                            }`}>
                              <FileText className={`w-5 h-5 ${selectedDocumentId === doc.id ? 'text-orange-600' : 'text-slate-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{doc.file_name || doc.template_name}</p>
                              <p className="text-xs text-slate-500">{doc.client_name}</p>
                            </div>
                            {selectedDocumentId === doc.id && (
                              <CheckCircle className="w-5 h-5 text-orange-500" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Signatários */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-orange-500" />
                    Signatários
                  </h3>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setSignerOrder('none')} 
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        signerOrder === 'none' 
                          ? 'bg-orange-500 text-white' 
                          : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      Sem ordem
                    </button>
                    <button 
                      onClick={() => setSignerOrder('sequential')} 
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        signerOrder === 'sequential' 
                          ? 'bg-orange-500 text-white' 
                          : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      Com ordem
                    </button>
                  </div>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    {signers.map((signer, index) => (
                      <div 
                        key={signer.id} 
                        className="bg-slate-50 rounded-xl p-4 border border-slate-100"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold text-sm">
                            {index + 1}
                          </div>
                          <input 
                            type="text" 
                            value={signer.name} 
                            onChange={(e) => updateSigner(signer.id, 'name', e.target.value)} 
                            placeholder="Nome do signatário" 
                            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500" 
                          />
                          <button 
                            onClick={() => removeSigner(signer.id)} 
                            disabled={signers.length <= 1} 
                            className="p-2 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex gap-3 pl-11">
                          <input 
                            type="email" 
                            value={signer.email} 
                            onChange={(e) => updateSigner(signer.id, 'email', e.target.value)} 
                            placeholder="Email" 
                            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500" 
                          />
                          <select 
                            value={signer.role} 
                            onChange={(e) => updateSigner(signer.id, 'role', e.target.value)} 
                            className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                          >
                            <option>Assinar</option>
                            <option>Testemunha</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={addSigner} 
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-600 font-medium hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar signatário
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {wizardStep === 'signers' && <div className="max-w-4xl mx-auto p-6"><div className="bg-white rounded-xl border border-slate-200 p-6"><h3 className="text-lg font-semibold mb-6">Confirme os signatários</h3><div className="space-y-4">{signers.map((s, i) => <div key={s.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-lg"><div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">{i + 1}</div><div className="flex-1"><p className="font-medium">{s.name || 'Sem nome'}</p><p className="text-sm text-slate-500">{s.email}</p></div><span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-xs">{s.role}</span></div>)}</div></div></div>}

        {wizardStep === 'position' && (
          <div className="flex h-[calc(100vh-64px)] overflow-hidden">
            <aside className="w-80 bg-white border-r border-slate-200 p-4 overflow-y-auto">
              <h3 className="font-semibold mb-4">Posicionar assinaturas</h3>
              <div className="mb-4"><label className="block text-xs text-slate-500 mb-2">Signatário</label><select value={selectedSignerForField} onChange={(e) => setSelectedSignerForField(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">{signers.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}</select></div>
              <div className="mb-4"><label className="block text-xs text-slate-500 mb-2">Campo</label><div className="flex flex-wrap gap-2">{(Object.keys(FIELD_PRESETS) as SignatureFieldType[]).map((type) => { const p = FIELD_PRESETS[type]; return <button type="button" key={type} onClick={() => setSelectedFieldType(type)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${selectedFieldType === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}><p.icon className="w-3.5 h-3.5" />{p.label}</button>; })}</div></div>
              <button type="button" onClick={(e) => { e.preventDefault(); placingModeRef.current = true; setPlacingMode(true); }} disabled={placingMode} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60"><MousePointer2 className="w-4 h-4" />{placingMode ? 'Clique no doc...' : 'Inserir'}</button>
              <div className="mt-6"><p className="text-xs text-slate-500 mb-2">Campos ({fields.length})</p><div className="space-y-2">{fields.map((f) => { const p = FIELD_PRESETS[f.fieldType]; const s = signers.find((x) => x.id === f.signerId); return <div key={f.localId} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg"><div className="flex items-center gap-2"><p.icon className="w-4 h-4 text-slate-500" /><div><p className="text-xs font-medium">{p.label}</p><p className="text-[10px] text-slate-500">{s?.name || s?.email}</p></div></div><button type="button" onClick={(e) => { e.preventDefault(); setFields((prev) => prev.filter((x) => x.localId !== f.localId)); }} className="p-1 text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button></div>; })}</div></div>
            </aside>
            <div className="flex-1 bg-slate-200 overflow-auto">
              <div className={`p-2 sm:p-3 md:p-4 ${placingMode ? 'cursor-crosshair' : ''}`}>
                {pdfPreviewUrl ? (
                  <>
                    {pdfLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-50">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                      </div>
                    )}

                    <PdfViewer
                      file={pdfPreviewUrl}
                      scale={pdfScale}
                      numPages={pdfNumPages}
                      onLoadSuccess={handlePdfLoadSuccess}
                      onLoadError={handlePdfLoadError}
                      onPageClick={handlePageClick}
                      pageRefs={pageRefsMap}
                    />

                    {/* Overlays dos campos (portal para dentro da página) */}
                    {pdfNumPages > 0 && fields.map((f) => {
                      const pageEl = pageRefsMap.current.get(f.pageNumber);
                      if (!pageEl) return null;

                      const p = FIELD_PRESETS[f.fieldType];
                      const signerName = signers.find((x) => x.id === f.signerId)?.name || '';

                      return createPortal(
                        <div
                          key={f.localId}
                          className="absolute border-2 border-blue-500 bg-blue-50/80 rounded flex items-center justify-center cursor-move select-none z-30 pointer-events-auto"
                          style={{
                            left: `${f.xPercent}%`,
                            top: `${f.yPercent}%`,
                            width: `${f.wPercent}%`,
                            height: `${f.hPercent}%`,
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDraggingField({ localId: f.localId, pageNumber: f.pageNumber, startX: e.clientX, startY: e.clientY, originX: f.xPercent, originY: f.yPercent });
                          }}
                        >
                          <div className="flex flex-col items-center justify-center px-1 text-center">
                            <div className="flex items-center gap-1 text-blue-700 text-[10px] font-medium">
                              <p.icon className="w-3 h-3" />
                              <span className="truncate">{p.label}</span>
                            </div>
                            {signerName && (
                              <div className="text-[10px] text-blue-700/80 font-medium truncate max-w-[110px]">
                                {signerName}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setFields((prev) => prev.filter((x) => x.localId !== f.localId));
                            }}
                            className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>,
                        pageEl
                      );
                    })}
                  </>
                ) : (
                  <div className="flex items-center justify-center py-20 text-slate-400">
                    <FileText className="w-16 h-16" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {wizardStep === 'settings' && (
          <div className="max-w-xl mx-auto p-6"><div className="bg-white rounded-xl border border-slate-200 p-6"><h3 className="text-lg font-semibold mb-6">Configurações</h3><div className="space-y-4">
            <div><label className="block text-sm font-medium mb-2">Aparência</label><select value={settings.signatureAppearance} onChange={(e) => setSettings((s) => ({ ...s, signatureAppearance: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option value="signature_only">Apenas assinatura</option><option value="signature_name">Assinatura + Nome</option></select></div>
            <div className="space-y-3 pt-4 border-t">
              {[{ key: 'requireCpf', label: 'Não exigir CPF' }, { key: 'allowRefusal', label: 'Permitir recusa' }, { key: 'blockAfterDeadline', label: 'Bloquear após prazo' }].map(({ key, label }) => <label key={key} className="flex items-center justify-between"><span className="text-sm">{label}</span><button onClick={() => setSettings((s) => ({ ...s, [key]: !(s as any)[key] }))} className={`w-10 h-6 rounded-full ${(settings as any)[key] ? 'bg-blue-600' : 'bg-slate-300'}`}><div className={`w-4 h-4 bg-white rounded-full shadow transform ${(settings as any)[key] ? 'translate-x-5' : 'translate-x-1'}`} /></button></label>)}
            </div>
            {settings.blockAfterDeadline && <div className="pt-4"><label className="block text-sm font-medium mb-2">Data limite</label><input type="date" value={settings.expiresAt} onChange={(e) => setSettings((s) => ({ ...s, expiresAt: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></div>}
          </div></div></div>
        )}
      </div>
    );
  }

  // LIST
  return (
    <div className="space-y-6">
      {/* Header com gradiente */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Assinaturas Digitais</h1>
            <p className="text-orange-100 text-sm mt-1">Gerencie seus documentos e assinaturas</p>
          </div>
          <button 
            onClick={() => { resetWizard(); setWizardStep('upload'); }} 
            className="flex items-center gap-2 px-5 py-2.5 bg-white text-orange-600 rounded-xl font-semibold hover:bg-orange-50 shadow-lg shadow-orange-600/20 transition-all"
          >
            <Plus className="w-5 h-5" />
            Novo documento
          </button>
        </div>
        
        {/* Estatísticas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center hover:bg-white/20 transition-all cursor-pointer" onClick={() => setFilterStatus('all')}>
            <p className="text-3xl font-bold">{requests.length}</p>
            <p className="text-xs text-orange-100 mt-1">Total de Documentos</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center hover:bg-white/20 transition-all cursor-pointer" onClick={() => setFilterStatus('pending')}>
            <p className="text-3xl font-bold text-amber-300">{requests.filter(r => r.status === 'pending').length}</p>
            <p className="text-xs text-orange-100 mt-1">Aguardando Assinatura</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center hover:bg-white/20 transition-all cursor-pointer" onClick={() => setFilterStatus('signed')}>
            <p className="text-3xl font-bold text-emerald-300">{requests.filter(r => r.status === 'signed').length}</p>
            <p className="text-xs text-orange-100 mt-1">Concluídos</p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-300">{requests.reduce((acc, r) => acc + (r.signers?.length || 0), 0)}</p>
            <p className="text-xs text-orange-100 mt-1">Total de Signatários</p>
          </div>
        </div>
      </div>
      
      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Buscar por nome do documento ou cliente..." 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
            className="w-full pl-12 pr-4 py-3 border border-slate-200 rounded-xl text-sm bg-white shadow-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all" 
          />
        </div>
        <div className="flex gap-2">
          {['all', 'pending', 'signed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status as any)}
              className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                filterStatus === status
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/25'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {status === 'all' ? 'Todos' : status === 'pending' ? 'Pendentes' : 'Assinados'}
            </button>
          ))}
        </div>
      </div>
      
      {/* Lista de documentos */}
      {filteredRequests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-10 h-10 text-slate-300" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">Nenhum documento encontrado</h3>
          <p className="text-slate-500 mb-6">Comece criando seu primeiro documento para assinatura</p>
          <button 
            onClick={() => { resetWizard(); setWizardStep('upload'); }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-all"
          >
            <Plus className="w-5 h-5" />
            Criar documento
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRequests.map((req) => {
            const allSigned = req.signers?.length > 0 && req.signers.every((s: Signer) => s.status === 'signed');
            const signedCount = req.signers?.filter((s: Signer) => s.status === 'signed').length || 0;
            const totalSigners = req.signers?.length || 0;
            const lastSignedAt = req.signers?.find((s: Signer) => s.signed_at)?.signed_at;
            const clientLabel = req.client_name || req.signers?.[0]?.name || 'Cliente não informado';
            
            return (
              <div 
                key={req.id} 
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-orange-200 cursor-pointer transition-all group"
                onClick={() => openDetails(req)}
              >
                {/* Barra de status no topo */}
                <div className={`h-1.5 ${allSigned ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                
                <div className="p-5">
                  {/* Header do card */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${allSigned ? 'bg-emerald-100' : 'bg-orange-100'}`}>
                        <FileText className={`w-6 h-6 ${allSigned ? 'text-emerald-600' : 'text-orange-600'}`} />
                      </div>
                      <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          allSigned 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {allSigned ? (
                            <><CheckCircle className="w-3 h-3" /> Assinado</>
                          ) : (
                            <><Clock className="w-3 h-3" /> Pendente</>
                          )}
                        </span>
                      </div>
                    </div>
                    <button className="p-2 text-slate-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-all">
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Nome do documento */}
                  <h3 className="font-semibold text-slate-800 text-base mb-2 line-clamp-2 group-hover:text-orange-600 transition-colors">
                    {req.document_name}
                  </h3>
                  
                  {/* Cliente */}
                  <div className="flex items-center gap-2 mb-3">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-600 truncate">{clientLabel}</span>
                  </div>
                  
                  {/* Datas */}
                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Criado em {formatDate(req.created_at)}</span>
                    </div>
                    {allSigned && lastSignedAt && (
                      <div className="flex items-center gap-2 text-xs text-emerald-600">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Assinado em {formatDate(lastSignedAt)}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Progresso de assinaturas */}
                  <div className="pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500">Assinaturas</span>
                      <span className="text-xs font-medium text-slate-700">
                        {totalSigners > 0 ? `${signedCount}/${totalSigners}` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${allSigned ? 'bg-emerald-500' : 'bg-orange-500'}`}
                        style={{ width: `${totalSigners > 0 ? (signedCount / totalSigners) * 100 : 0}%` }}
                      />
                    </div>
                    {totalSigners === 0 && (
                      <div className="mt-2 text-[11px] text-slate-500">
                        Nenhum signatário cadastrado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {detailsRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header com faixa laranja */}
            <div 
              className="flex items-center justify-between px-6 py-5 flex-shrink-0 rounded-t-2xl"
              style={{ background: 'linear-gradient(to right, #f97316, #ea580c)' }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-white truncate text-lg">{detailsRequest.document_name}</h2>
                  <p className="text-sm text-orange-100">Criado em {formatDate(detailsRequest.created_at)}</p>
                </div>
              </div>
              <button 
                onClick={() => setDetailsRequest(null)} 
                className="p-2 text-white hover:bg-white/20 rounded-lg flex-shrink-0 ml-4 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Informações do documento */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slxate-50 rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-500 mb-1">ID do Documento</p>
                  <p className="text-sm font-mono text-slate-700 truncate">{detailsRequest.id}</p>
                </div>
                {detailsRequest.client_name && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-slate-500 mb-1">Cliente</p>
                    <p className="text-sm font-medium text-slate-700">{detailsRequest.client_name}</p>
                  </div>
                )}
                {detailsRequest.process_number && (
                  <div className="bg-slate-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-slate-500 mb-1">Processo</p>
                    <p className="text-sm font-medium text-slate-700">{detailsRequest.process_number}</p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs font-medium text-slate-500 mb-1">Status Geral</p>
                  <p className="text-sm font-medium">
                    {detailsRequest.signers.every(s => s.status === 'signed') ? (
                      <span className="text-emerald-600">✓ Todos assinaram</span>
                    ) : (
                      <span className="text-amber-600">⏳ {detailsRequest.signers.filter(s => s.status === 'pending').length} pendente(s)</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Botões de ação */}
              <div className="flex flex-wrap gap-3">
                {detailsRequest.document_path && (
                  <button
                    disabled={viewDocLoading}
                    onClick={async () => {
                      try {
                        setViewDocLoading(true);
                        const signedSigner = detailsRequest.signers.find(s => s.status === 'signed');
                        
                        // Se tem signatário assinado, ABRIR APENAS o PDF assinado salvo
                        if (signedSigner) {
                          if (signedSigner.signed_document_path) {
                            const url = await pdfSignatureService.getSignedPdfUrl(signedSigner.signed_document_path);
                            if (url) {
                              window.open(url, '_blank');
                              return;
                            }
                          }

                          toast.error('Documento assinado não encontrado no storage (signed_document_path vazio).');
                          return;
                        }
                        
                        // Se não está assinado, mostrar documento original
                        const url = await signatureService.getDocumentPreviewUrl(detailsRequest.document_path!);
                        if (url) window.open(url, '_blank');
                        else toast.error('Erro ao obter URL do documento');
                      } catch (e) {
                        console.error('Erro ao abrir documento:', e);
                        toast.error('Erro ao abrir documento');
                      } finally {
                        setViewDocLoading(false);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-70 disabled:cursor-wait"
                  >
                    {viewDocLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Abrindo...
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4" />
                        {detailsRequest.signers.some(s => s.status === 'signed') ? 'Ver documento assinado' : 'Visualizar online'}
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleDownloadDocument(detailsRequest)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition"
                >
                  <Download className="w-4 h-4" />
                  Baixar documento
                </button>
                <button
                  onClick={() => handleDeleteRequest(detailsRequest.id)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
              </div>

              {/* Signatários */}
              <div>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Signatários ({detailsRequest.signers.length})
                </h3>
                <div className="space-y-3">
                  {detailsRequest.signers.map((signer) => {
                    const facialUrl = signer.facial_image_path ? supabase.storage.from('signatures').getPublicUrl(signer.facial_image_path).data.publicUrl : null;
                    const signatureUrl = signer.signature_image_path ? supabase.storage.from('signatures').getPublicUrl(signer.signature_image_path).data.publicUrl : null;
                    const geoLocation = signer.geolocation || signer.signer_geolocation;
                    
                    return (
                    <div key={signer.id} className={`p-5 rounded-xl border ${signer.status === 'signed' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          {/* Foto facial do signatário - clicável para ampliar */}
                          {signer.status === 'signed' && facialUrl ? (
                            <button 
                              onClick={() => setZoomImageUrl(facialUrl)}
                              className="relative group flex-shrink-0"
                              title="Clique para ampliar"
                            >
                              <img 
                                src={facialUrl}
                                alt="Foto facial"
                                className="w-20 h-20 rounded-xl object-cover border-2 border-emerald-300 group-hover:border-emerald-500 transition-all"
                                style={{ transform: 'scaleX(-1)' }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-xl flex items-center justify-center transition-all">
                                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                            </button>
                          ) : (
                            <div className={`w-20 h-20 rounded-xl flex items-center justify-center flex-shrink-0 ${signer.status === 'signed' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                              <User className={`w-10 h-10 ${signer.status === 'signed' ? 'text-emerald-600' : 'text-blue-600'}`} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <p className="font-semibold text-slate-800 text-lg">{signer.name}</p>
                              {getStatusBadge(signer.status)}
                            </div>
                            
                            {/* Grid de informações */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                              {/* Método de autenticação */}
                              {signer.auth_provider && (
                                <div className="flex items-center gap-2 col-span-2">
                                  <Shield className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                  <p className="text-sm text-emerald-600 font-medium">
                                    {signer.auth_provider === 'google' && `Autenticado via Google (${signer.auth_email || signer.email})`}
                                    {signer.auth_provider === 'email_link' && `Autenticado via Link por E-mail (${signer.auth_email || signer.email})`}
                                    {signer.auth_provider === 'phone' && `Autenticado via Telefone (${signer.phone})`}
                                  </p>
                                </div>
                              )}
                              
                              {/* Email */}
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <p className="text-sm text-slate-600 truncate">{signer.email || 'N/A'}</p>
                              </div>
                              
                              {/* CPF */}
                              {signer.cpf && (
                                <div className="flex items-center gap-2">
                                  <Hash className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <p className="text-sm text-slate-600">CPF: {signer.cpf}</p>
                                </div>
                              )}
                              
                              {/* Telefone */}
                              {signer.phone && (
                                <div className="flex items-center gap-2">
                                  <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <p className="text-sm text-slate-600">Tel: {signer.phone}</p>
                                </div>
                              )}
                              
                              {/* Função/Role */}
                              {signer.role && (
                                <div className="flex items-center gap-2">
                                  <Users className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <p className="text-sm text-slate-600">{signer.role}</p>
                                </div>
                              )}
                              
                              {/* IP */}
                              {signer.signer_ip && (
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <p className="text-sm text-slate-600">IP: {signer.signer_ip}</p>
                                </div>
                              )}
                              
                              {/* Data de visualização */}
                              {signer.viewed_at && (
                                <div className="flex items-center gap-2">
                                  <Eye className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <p className="text-sm text-slate-600">Visualizado: {formatDate(signer.viewed_at)}</p>
                                </div>
                              )}
                              
                              {/* Data de assinatura */}
                              {signer.signed_at && (
                                <div className="flex items-center gap-2 col-span-2">
                                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                  <p className="text-sm text-emerald-600 font-medium">
                                    Assinado em {formatDate(signer.signed_at)}
                                  </p>
                                </div>
                              )}
                              
                              {/* Geolocalização com link para Google Maps */}
                              {geoLocation && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <Eye className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm text-slate-600">Localização:</span>
                                    <a 
                                      href={`https://www.google.com/maps?q=${geoLocation.replace(/\s/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                                    >
                                      {geoLocation}
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                </div>
                              )}
                              
                              {/* User Agent */}
                              {signer.signer_user_agent && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                                  <p className="text-sm text-slate-500 break-all" title={signer.signer_user_agent}>
                                    User Agent: {signer.signer_user_agent.length > 80 ? signer.signer_user_agent.slice(0, 80) + '...' : signer.signer_user_agent}
                                  </p>
                                </div>
                              )}
                              
                              {/* Device Info */}
                              {signer.device_info && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                                  <p className="text-sm text-slate-500 break-all" title={signer.device_info}>
                                    Dispositivo: {signer.device_info.length > 80 ? signer.device_info.slice(0, 80) + '...' : signer.device_info}
                                  </p>
                                </div>
                              )}
                            </div>
                            
                            {/* Imagem da assinatura */}
                            {signer.status === 'signed' && signatureUrl && (
                              <div className="mt-4 p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs text-slate-500 mb-2 font-medium">Assinatura:</p>
                                <img 
                                  src={signatureUrl}
                                  alt="Assinatura"
                                  className="max-h-20 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => setZoomImageUrl(signatureUrl)}
                                  title="Clique para ampliar"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {signer.status === 'pending' && (
                        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input 
                            type="text" 
                            readOnly 
                            value={signatureService.generatePublicSigningUrl(signer.public_token!)} 
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono" 
                          />
                          <div className="flex gap-2">
                            <button 
                              onClick={() => copyLink(signer.public_token!)} 
                              className="flex items-center gap-1.5 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium"
                            >
                              <Copy className="w-4 h-4" />
                              Copiar
                            </button>
                            <button 
                              onClick={() => window.open(signatureService.generatePublicSigningUrl(signer.public_token!), '_blank')}
                              className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Abrir
                            </button>
                            <button 
                              onClick={() => openSignModal(signer)} 
                              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                              <PenTool className="w-4 h-4" />
                              Assinar
                            </button>
                          </div>
                        </div>
                      )}
                      {signer.status === 'signed' && signer.verification_hash && (
                        <div className="mt-3 pt-3 border-t border-emerald-200">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Hash de verificação:</p>
                              <p className="text-xs font-mono text-slate-600 truncate">{signer.verification_hash}</p>
                            </div>
                            <a
                              href={`${window.location.origin}/#/verificar/${signer.verification_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200 transition-colors"
                            >
                              <Shield className="w-3.5 h-3.5" />
                              Verificar autenticidade
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Histórico de Atividades (Audit Log) */}
              <div className="mt-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Histórico de Atividades
                </h3>
                {auditLogLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : auditLog.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma atividade registrada</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Linha vertical da timeline */}
                    <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-slate-200" />
                    
                    <div className="space-y-4">
                      {auditLog.map((log, index) => {
                        const isFirst = index === 0;
                        const isLast = index === auditLog.length - 1;
                        
                        // Ícone e cor baseado na ação
                        let iconBg = 'bg-slate-100';
                        let iconColor = 'text-slate-500';
                        let Icon = Clock;
                        
                        if (log.action === 'created') {
                          iconBg = 'bg-blue-100';
                          iconColor = 'text-blue-600';
                          Icon = FileText;
                        } else if (log.action === 'sent') {
                          iconBg = 'bg-purple-100';
                          iconColor = 'text-purple-600';
                          Icon = Send;
                        } else if (log.action === 'viewed') {
                          iconBg = 'bg-amber-100';
                          iconColor = 'text-amber-600';
                          Icon = Eye;
                        } else if (log.action === 'signed') {
                          iconBg = 'bg-emerald-100';
                          iconColor = 'text-emerald-600';
                          Icon = CheckCircle;
                        } else if (log.action === 'cancelled') {
                          iconBg = 'bg-red-100';
                          iconColor = 'text-red-600';
                          Icon = X;
                        } else if (log.action === 'reminder_sent') {
                          iconBg = 'bg-orange-100';
                          iconColor = 'text-orange-600';
                          Icon = Send;
                        }
                        
                        return (
                          <div key={log.id} className="relative flex gap-4 pl-2">
                            {/* Ícone */}
                            <div className={`relative z-10 w-8 h-8 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-4 h-4 ${iconColor}`} />
                            </div>
                            
                            {/* Conteúdo */}
                            <div className={`flex-1 pb-4 ${!isLast ? 'border-b border-slate-100' : ''}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-slate-800">{log.description}</p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {new Date(log.created_at).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </p>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  log.action === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                                  log.action === 'viewed' ? 'bg-amber-100 text-amber-700' :
                                  log.action === 'created' ? 'bg-blue-100 text-blue-700' :
                                  log.action === 'sent' ? 'bg-purple-100 text-purple-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {log.action === 'created' && 'Criado'}
                                  {log.action === 'sent' && 'Enviado'}
                                  {log.action === 'viewed' && 'Visualizado'}
                                  {log.action === 'signed' && 'Assinado'}
                                  {log.action === 'cancelled' && 'Cancelado'}
                                  {log.action === 'expired' && 'Expirado'}
                                  {log.action === 'reminder_sent' && 'Lembrete'}
                                </span>
                              </div>
                              
                              {/* Detalhes extras */}
                              {(log.ip_address || log.user_agent) && (
                                <div className="mt-2 p-2 bg-slate-50 rounded-lg text-xs text-slate-500">
                                  {log.ip_address && <p>IP: {log.ip_address}</p>}
                                  {log.user_agent && (
                                    <p className="truncate" title={log.user_agent}>
                                      Dispositivo: {log.user_agent.slice(0, 60)}...
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {signModalOpen && signingSigner && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-blue-600">
              <div><h2 className="font-semibold text-white">Assinar Documento</h2><p className="text-xs text-white/70">{signingSigner.name}</p></div>
              <button onClick={() => setSignModalOpen(false)} className="p-2 text-white/70 hover:text-white rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {signStep === 'signature' && <div><h3 className="text-lg font-semibold mb-4">Sua Assinatura</h3><SignatureCanvas onSignatureChange={setSignatureData} width={450} height={180} /></div>}
              {signStep === 'facial' && <div><h3 className="text-lg font-semibold mb-4">Foto Facial</h3><FacialCapture onCapture={setFacialData} width={320} height={240} /></div>}
              {signStep === 'confirm' && <div><h3 className="text-lg font-semibold mb-4">Confirmar</h3>{signatureData && <div className="p-4 bg-slate-50 rounded-xl mb-4"><p className="text-xs font-medium text-slate-500 mb-2">Assinatura</p><img src={signatureData} alt="Assinatura" className="max-h-24 border border-slate-200 rounded-lg bg-white" /></div>}{facialData && <div className="p-4 bg-slate-50 rounded-xl"><p className="text-xs font-medium text-slate-500 mb-2">Foto</p><img src={facialData} alt="Foto" className="w-24 h-24 object-cover rounded-lg border" style={{ transform: 'scaleX(-1)' }} /></div>}</div>}
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button onClick={() => { if (signStep === 'signature') setSignModalOpen(false); else if (signStep === 'facial') setSignStep('signature'); else setSignStep('facial'); }} className="px-4 py-2 text-sm font-medium text-slate-600">{signStep === 'signature' ? 'Cancelar' : 'Voltar'}</button>
              {signStep === 'confirm' ? <button onClick={handleSign} disabled={signLoading} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50">{signLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}Confirmar</button> : <button onClick={() => { if (signStep === 'signature' && signatureData) setSignStep('facial'); else if (signStep === 'facial') setSignStep('confirm'); }} disabled={(signStep === 'signature' && !signatureData)} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium disabled:opacity-50">Próximo</button>}
            </div>
          </div>
        </div>
      )}
      {/* Modal de zoom para imagens */}
      {zoomImageUrl && (
        <div 
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setZoomImageUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <button 
              onClick={() => setZoomImageUrl(null)}
              className="absolute -top-12 right-0 p-2 text-white hover:text-white/80 transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            <img 
              src={zoomImageUrl}
              alt="Imagem ampliada"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
              style={{ transform: zoomImageUrl.includes('facial') ? 'scaleX(-1)' : 'none' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default SignatureModule;
