import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import {
  X,
  Save,
  Loader2,
  MousePointer2,
  PenTool,
  Type,
  Hash,
  Calendar,
  Signature,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { signatureFieldsService } from '../services/signatureFields.service';

import type {
  CreateSignatureFieldDTO,
  SignatureField,
  SignatureFieldType,
  Signer,
} from '../types/signature.types';

// Configurar worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Adicionar cores para os signatários
interface SignerWithColor extends Signer {
  color?: string;
}

type DraftField = Omit<CreateSignatureFieldDTO, 'signature_request_id'> & {
  _localId: string;
};

const FIELD_PRESETS: Record<SignatureFieldType, { w: number; h: number; icon: React.ElementType; label: string }> = {
  signature: { w: 28, h: 10, icon: Signature, label: 'Assinatura' },
  initials: { w: 14, h: 8, icon: PenTool, label: 'Rubrica' },
  name: { w: 20, h: 6, icon: Type, label: 'Nome' },
  cpf: { w: 16, h: 6, icon: Hash, label: 'CPF' },
  date: { w: 14, h: 6, icon: Calendar, label: 'Data' },
};

interface PdfFieldDesignerProps {
  isOpen: boolean;
  onClose: () => void;
  signatureRequestId: string;
  pdfUrl: string;
  signers: SignerWithColor[];
}

const PdfFieldDesigner: React.FC<PdfFieldDesignerProps> = ({
  isOpen,
  onClose,
  signatureRequestId,
  pdfUrl,
  signers,
}) => {
  const toast = useToastContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<DraftField[]>([]);

  // Estados do PDF
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [pdfLoading, setPdfLoading] = useState(true);

  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(signers[0]?.id ?? null);
  const [selectedFieldType, setSelectedFieldType] = useState<SignatureFieldType>('signature');
  const [placingMode, setPlacingMode] = useState(false);

  const [dragging, setDragging] = useState<{
    localId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const signerOptions = useMemo(() => {
    return signers.map((s) => ({ id: s.id, label: `${s.order ?? ''} ${s.name}`.trim() }));
  }, [signers]);

  useEffect(() => {
    if (!isOpen) return;

    let isActive = true;
    (async () => {
      try {
        setLoading(true);
        const existing = await signatureFieldsService.listByRequest(signatureRequestId);
        if (!isActive) return;

        const mapped: DraftField[] = (existing ?? []).map((f) => ({
          _localId: f.id,
          signer_id: f.signer_id ?? null,
          field_type: f.field_type,
          page_number: f.page_number,
          x_percent: Number(f.x_percent),
          y_percent: Number(f.y_percent),
          w_percent: Number(f.w_percent),
          h_percent: Number(f.h_percent),
          required: f.required,
        }));
        setFields(mapped);
      } catch (error: any) {
        console.error(error);
        toast.error('Erro ao carregar campos do documento');
      } finally {
        if (isActive) setLoading(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [isOpen, signatureRequestId, toast]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = getRenderedPageRect();
      if (!rect) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;

      const dxPercent = (dx / rect.width) * 100;
      const dyPercent = (dy / rect.height) * 100;

      setFields((prev) =>
        prev.map((f) => {
          if (f._localId !== dragging.localId) return f;
          const nextX = Math.max(0, Math.min(100 - f.w_percent, dragging.originX + dxPercent));
          const nextY = Math.max(0, Math.min(100 - f.h_percent, dragging.originY + dyPercent));
          return { ...f, x_percent: nextX, y_percent: nextY };
        }),
      );
    };

    const handleUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  const getRenderedPageRect = () => {
    if (!containerRef.current) return null;
    const pageEl = containerRef.current.querySelector('.react-pdf__Page') as HTMLElement | null;
    return pageEl?.getBoundingClientRect() ?? null;
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    // Permitir clique direto sem precisar ativar modo de posicionamento
    if (!containerRef.current) return;
    if (!selectedSignerId) {
      toast.error('Selecione um signatário antes de posicionar');
      return;
    }

    const rect = getRenderedPageRect();
    if (!rect) return;

    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const preset = FIELD_PRESETS[selectedFieldType];

    const clampedX = Math.max(0, Math.min(100 - preset.w, x));
    const clampedY = Math.max(0, Math.min(100 - preset.h, y));

    const localId = `local_${crypto.randomUUID()}`;
    setFields((prev) => [
      ...prev,
      {
        _localId: localId,
        signer_id: selectedSignerId,
        field_type: selectedFieldType,
        page_number: currentPage,
        x_percent: clampedX,
        y_percent: clampedY,
        w_percent: preset.w,
        h_percent: preset.h,
        required: true,
      },
    ]);

    // Feedback visual para o usuário
    toast.success(`Campo ${FIELD_PRESETS[selectedFieldType].label} adicionado`);
  };
  
  // Iniciar arrasto de campo existente
  const handleDragStart = (e: React.MouseEvent, localId: string, originX: number, originY: number) => {
    e.stopPropagation(); // Evitar que o clique propague para o container
    setDragging({
      localId,
      startX: e.clientX,
      startY: e.clientY,
      originX,
      originY,
    });
  };

  const removeField = (localId: string) => {
    setFields((prev) => prev.filter((f) => f._localId !== localId));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await signatureFieldsService.upsertFields(
        signatureRequestId,
        fields.map((f) => ({
          signer_id: f.signer_id ?? null,
          field_type: f.field_type,
          page_number: f.page_number,
          x_percent: f.x_percent,
          y_percent: f.y_percent,
          w_percent: f.w_percent,
          h_percent: f.h_percent,
          required: f.required,
        })),
      );
      toast.success('Campos salvos com sucesso');
      onClose();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Erro ao salvar campos');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header com etapas do processo */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
              <X className="w-5 h-5" />
            </button>
            <span className="text-slate-600">Voltar</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">1</div>
              <span className="ml-2 text-sm text-slate-600">Arquivo</span>
            </div>
            <div className="w-6 h-px bg-slate-300"></div>
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">2</div>
              <span className="ml-2 text-sm text-slate-600">Signatários</span>
            </div>
            <div className="w-6 h-px bg-slate-300"></div>
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-medium">3</div>
              <span className="ml-2 text-sm font-medium text-blue-600">Posicionar</span>
            </div>
            <div className="w-6 h-px bg-slate-300"></div>
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium">4</div>
              <span className="ml-2 text-sm text-slate-600">Config</span>
            </div>
          </div>
          
          <button 
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Avançar
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Sidebar */}
          <aside className="w-72 border-r border-slate-200 bg-white p-4 overflow-y-auto">
            <h3 className="text-base font-medium mb-4">Posicionar assinaturas</h3>
            
            {/* Tabs de signatários */}
            <div className="mb-4">
              <label className="block text-sm text-slate-600 mb-2">Signatário</label>
              <div className="flex flex-wrap gap-1 mb-2 overflow-x-auto pb-1">
                {signerOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSignerId(s.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 whitespace-nowrap ${s.id === selectedSignerId 
                      ? 'bg-blue-500 text-white font-medium' 
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center text-xs">
                      {signerOptions.findIndex(opt => opt.id === s.id) + 1}
                    </div>
                    <span className="truncate max-w-[120px]">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Campos específicos para o signatário selecionado */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm text-slate-600">Campo</label>
                {selectedSignerId && (
                  <span className="text-xs text-blue-600 font-medium">
                    Signatário {signerOptions.findIndex(s => s.id === selectedSignerId) + 1}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(FIELD_PRESETS) as SignatureFieldType[]).map((t) => {
                  const preset = FIELD_PRESETS[t];
                  const Icon = preset.icon;
                  const active = selectedFieldType === t;
                  
                  // Contar quantos campos deste tipo já existem para este signatário
                  const fieldsOfTypeCount = fields.filter(
                    f => f.signer_id === selectedSignerId && f.field_type === t
                  ).length;
                  
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedFieldType(t)}
                      className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-sm transition ${
                        active
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <div className="flex flex-col items-center">
                        <span className="text-xs">{preset.label}</span>
                        {fieldsOfTypeCount > 0 && (
                          <span className="text-xs text-blue-600 font-medium">{fieldsOfTypeCount}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Instrução */}
            <p className="text-sm text-slate-600 mb-4">
              Clique diretamente no documento para inserir o campo selecionado
            </p>

            {/* Links individuais para cada assinante */}
            <div className="mb-4 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-600">Links de assinatura</label>
              </div>
              <div className="space-y-2">
                {signers.map((signer, index) => {
                  const signerFields = fields.filter(f => f.signer_id === signer.id);
                  const hasFields = signerFields.length > 0;
                  const signerColor = [
                    '#2563eb', // blue-600
                    '#dc2626', // red-600
                    '#16a34a', // green-600
                    '#9333ea', // purple-600
                    '#ea580c', // orange-600
                  ][index % 5];
                  
                  return (
                    <div 
                      key={signer.id}
                      className={`p-2 rounded-lg border ${signer.id === selectedSignerId ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{backgroundColor: signerColor}}
                          />
                          <span className="text-xs font-medium">{signer.name || `Assinante ${index + 1}`}</span>
                        </div>
                        <span className="text-xs text-slate-500">{signerFields.length} campos</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          value={`https://juriscrm.com.br/#/assinar/${signatureRequestId}/${signer.id}`}
                          readOnly
                          className="text-xs w-full bg-slate-50 border border-slate-200 rounded px-2 py-1"
                        />
                        <button 
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(`https://juriscrm.com.br/#/assinar/${signatureRequestId}/${signer.id}`);
                            toast.success('Link copiado!');
                          }}
                          className="p-1 text-slate-500 hover:text-blue-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Lista de campos */}
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Campos ({fields.length})</span>
              </div>
              <div className="space-y-2">
                {fields.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum campo posicionado ainda.</p>
                ) : (
                  fields.map((f) => {
                    const preset = FIELD_PRESETS[f.field_type];
                    const Icon = preset.icon;
                    const signer = signers.find((s) => s.id === f.signer_id);
                    return (
                      <div key={f._localId} className="flex items-start justify-between gap-2 p-2 bg-white border border-slate-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg bg-slate-100">
                            <Icon className="w-3.5 h-3.5 text-slate-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{preset.label}</p>
                            <p className="text-xs text-slate-500 truncate">
                              Pág. {f.page_number}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeField(f._localId)}
                          className="flex-shrink-0 p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          {/* PDF Viewer - Integrado com react-pdf */}
          <div className="flex-1 flex flex-col bg-slate-100 overflow-hidden">
            {/* Barra de ferramentas fixa */}
            <div className="bg-slate-900 text-white flex items-center justify-between px-4 py-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <PenTool className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium">Posicionar Campos</p>
                  <p className="text-xs text-slate-400">Clique no documento para inserir</p>
                </div>
              </div>
              
              {/* Controles de navegação */}
              <div className="flex items-center gap-4">
                {/* Navegação de páginas */}
                <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium min-w-[60px] text-center">
                    {currentPage} / {numPages}
                  </span>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage >= numPages}
                    className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Controles de zoom */}
                <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1">
                  <button 
                    onClick={() => setScale(s => Math.max(0.5, s - 0.1))}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium min-w-[50px] text-center">
                    {Math.round(scale * 100)}%
                  </span>
                  <button 
                    onClick={() => setScale(s => Math.min(2, s + 0.1))}
                    className="p-1 text-slate-400 hover:text-white"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </div>
                
                <span className="text-xs text-slate-400 bg-slate-700 px-2 py-1 rounded">
                  {fields.length} campo(s)
                </span>
              </div>
            </div>
            
            {/* Container do PDF - ocupa todo o espaço restante */}
            <div className="flex-1 overflow-auto flex justify-center py-4 bg-slate-200">
              <div
                ref={containerRef}
                className="relative bg-white shadow-xl"
                onClick={handleContainerClick}
              >
                {pdfLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                    <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                  </div>
                )}
                
                <Document
                  file={pdfUrl}
                  onLoadSuccess={({ numPages: pages }) => {
                    setNumPages(pages);
                    setPdfLoading(false);
                  }}
                  onLoadError={(error) => {
                    console.error('Erro ao carregar PDF:', error);
                    setPdfLoading(false);
                    toast.error('Erro ao carregar o PDF');
                  }}
                  loading={null}
                >
                  <Page
                    pageNumber={currentPage}
                    scale={scale}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>

                {/* Overlay Fields - apenas para a página atual */}
                {fields.filter(f => f.page_number === currentPage).map((f) => {
                    const preset = FIELD_PRESETS[f.field_type];
                    const Icon = preset.icon;
                    const signer = signers.find((s) => s.id === f.signer_id);
                    // Gerar cor baseada no índice do signatário
                    const signerIndex = signers.findIndex((s) => s.id === f.signer_id);
                    const signerColor = signer?.color || [
                      '#2563eb', // blue-600
                      '#dc2626', // red-600
                      '#16a34a', // green-600
                      '#9333ea', // purple-600
                      '#ea580c', // orange-600
                    ][signerIndex % 5] || '#2563eb';
                    
                    return (
                      <div
                        key={f._localId}
                        className="absolute cursor-move border-2 rounded-md flex items-center justify-center overflow-hidden"
                        style={{
                          left: `${f.x_percent}%`,
                          top: `${f.y_percent}%`,
                          width: `${f.w_percent}%`,
                          height: `${f.h_percent}%`,
                          borderColor: signerColor,
                          backgroundColor: `${signerColor}15`,
                        }}
                        onMouseDown={(e) => handleDragStart(e, f._localId, f.x_percent, f.y_percent)}
                      >
                        <div className="flex flex-col items-center justify-center w-full h-full">
                          {/* Badge com número do assinante */}
                          <div 
                            className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" 
                            style={{backgroundColor: signerColor}}
                          >
                            {signerIndex + 1}
                          </div>
                          
                          <Icon className="w-5 h-5" style={{color: signerColor}} />
                          
                          <div className="flex flex-col items-center text-center mt-1">
                            {/* Tipo de campo */}
                            <span 
                              className="text-xs font-medium px-1 truncate max-w-full"
                              style={{color: signerColor}}
                            >
                              {preset.label}
                            </span>
                            
                            {/* Nome do assinante com fundo semi-transparente para legibilidade */}
                            <span 
                              className="text-[10px] font-medium truncate max-w-full px-1.5 py-0.5 mt-0.5 rounded-sm"
                              style={{backgroundColor: `${signerColor}20`, color: signerColor}}
                            >
                              {signer?.name || `Assinante ${signerIndex + 1}`}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfFieldDesigner;
