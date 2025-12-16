import { DocumentTemplate, SignatureFieldConfig, SignatureFieldConfigValue, TemplateFile } from '../types/document.types';
import { documentTemplateService } from '../services/documentTemplate.service';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Save, Loader2, PenTool, Signature, Move, ZoomOut, ZoomIn, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { renderAsync } from 'docx-preview';

// Tipo para documento ativo (pode ser o principal ou um arquivo adicional)
interface ActiveDocument {
  id: string;
  name: string;
  type: 'main' | 'file';
  filePath?: string;
  signatureConfig?: SignatureFieldConfigValue;
}

// Altura de uma página A4 em pixels (297mm a 96dpi ≈ 1123px)
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PX = 794; // 210mm a 96dpi

// CSS para o docx-preview
const docxPreviewStyles = `
  .docx-wrapper {
    background: transparent !important;
  }
  .docx-wrapper > section.docx {
    background: white !important;
    width: 210mm !important;
    box-sizing: border-box !important;
  }
`;

type LocalSignatureField = SignatureFieldConfig & { _id: string };

interface SignaturePositionDesignerProps {
  isOpen: boolean;
  onClose: () => void;
  template: DocumentTemplate;
  onSave: (config: SignatureFieldConfigValue) => void;
}

const normalizeConfigToFields = (value: SignatureFieldConfigValue | undefined): LocalSignatureField[] => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((f) => ({ ...f, _id: crypto.randomUUID() }));
};

const stripLocalIds = (fields: LocalSignatureField[]): SignatureFieldConfig[] =>
  fields.map(({ _id, ...rest }) => rest);

const SignaturePositionDesigner: React.FC<SignaturePositionDesignerProps> = ({ isOpen, onClose, template, onSave }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [numPages, setNumPages] = useState(1);
  const [containerReady, setContainerReady] = useState(false);
  const [fields, setFields] = useState<LocalSignatureField[]>(() => normalizeConfigToFields(template.signature_field_config));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sortedFields = useMemo(() => [...fields].sort((a, b) => a.page - b.page), [fields]);

  // Estados para múltiplos documentos
  const [templateFiles, setTemplateFiles] = useState<TemplateFile[]>([]);
  const [activeDocIndex, setActiveDocIndex] = useState(0);
  const [allDocuments, setAllDocuments] = useState<ActiveDocument[]>([]);

  const docxContainerCallback = useCallback((node: HTMLDivElement | null) => {
    docxContainerRef.current = node;
    if (node) setContainerReady(true);
  }, []);

  // Injetar CSS do docx-preview
  useEffect(() => {
    const styleId = 'docx-preview-custom-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = docxPreviewStyles;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Carregar arquivos do template e construir lista de documentos
  useEffect(() => {
    if (!isOpen) return;
    
    const loadTemplateFiles = async () => {
      try {
        console.log('📂 Carregando arquivos do template:', template.id);
        const files = await documentTemplateService.listTemplateFiles(template.id);
        setTemplateFiles(files);
        console.log('📂 Arquivos carregados:', files.length);
        
        // Construir lista de todos os documentos
        const docs: ActiveDocument[] = [];
        
        // Documento principal (se existir)
        if (template.file_path) {
          docs.push({
            id: 'main',
            name: template.file_name || 'Documento Principal',
            type: 'main',
            filePath: template.file_path,
            signatureConfig: template.signature_field_config,
          });
          console.log('📄 Documento principal adicionado');
        }
        
        // Arquivos adicionais
        files.forEach((file) => {
          docs.push({
            id: file.id,
            name: file.file_name,
            type: 'file',
            filePath: file.file_path,
            signatureConfig: file.signature_field_config,
          });
        });
        
        console.log('📚 Total de documentos:', docs.length, docs.map(d => d.name));
        
        // Se não há documentos, criar um documento "virtual" baseado no template
        if (docs.length === 0 && template.file_path) {
          docs.push({
            id: 'main',
            name: template.name || 'Documento',
            type: 'main',
            filePath: template.file_path,
            signatureConfig: template.signature_field_config,
          });
        }
        
        setAllDocuments(docs);
        setActiveDocIndex(0);
        
        // Carregar campos do documento ativo
        if (docs.length > 0) {
          setFields(normalizeConfigToFields(docs[0].signatureConfig));
        } else {
          // Se não há documentos, usar a config do template diretamente
          setFields(normalizeConfigToFields(template.signature_field_config));
        }
      } catch (err) {
        console.error('❌ Erro ao carregar arquivos do template:', err);
        // Fallback: usar o template diretamente
        if (template.file_path) {
          setAllDocuments([{
            id: 'main',
            name: template.file_name || template.name || 'Documento',
            type: 'main',
            filePath: template.file_path,
            signatureConfig: template.signature_field_config,
          }]);
          setFields(normalizeConfigToFields(template.signature_field_config));
        }
      }
    };
    
    loadTemplateFiles();
  }, [isOpen, template]);

  // Documento ativo atual
  const activeDoc = allDocuments[activeDocIndex];

  // Renderizar documento ativo
  useEffect(() => {
    if (!isOpen || !containerReady || !docxContainerRef.current || allDocuments.length === 0) return;
    
    const currentDoc = allDocuments[activeDocIndex];
    if (!currentDoc?.filePath) {
      setLoadError('Documento sem arquivo');
      setLoading(false);
      return;
    }
    
    let cancelled = false;
    const renderDocx = async () => {
      console.log('🔄 Renderizando documento:', currentDoc.name);
      try {
        setLoading(true);
        setLoadError(null);
        
        let fileBlob: Blob;
        if (currentDoc.type === 'main') {
          fileBlob = await documentTemplateService.downloadTemplateFile(template);
        } else {
          fileBlob = await documentTemplateService.downloadTemplateFileById(currentDoc.id);
        }
        
        if (cancelled) return;
        const arrayBuffer = await fileBlob.arrayBuffer();
        if (cancelled) return;
        if (docxContainerRef.current) docxContainerRef.current.innerHTML = '';
        await renderAsync(arrayBuffer, docxContainerRef.current!, undefined, {
          className: 'docx-preview', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          ignoreFonts: false, breakPages: true, ignoreLastRenderedPageBreak: false,
          experimental: false, trimXmlDeclaration: true, useBase64URL: true,
          renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        });
        if (cancelled) return;
        
        // Calcular número de páginas baseado na altura total do conteúdo
        const wrapper = docxContainerRef.current?.querySelector('.docx-wrapper') as HTMLElement;
        if (wrapper) {
          const totalHeight = wrapper.scrollHeight;
          const calculatedPages = Math.ceil(totalHeight / A4_HEIGHT_PX);
          console.log('📄 Altura total:', totalHeight, 'px, Páginas calculadas:', calculatedPages);
          setNumPages(Math.max(1, calculatedPages));
        } else {
          let pages = docxContainerRef.current?.querySelectorAll('section') || [];
          setNumPages(Math.max(1, pages.length));
        }
        
        // Carregar campos de assinatura do documento ativo
        setFields(normalizeConfigToFields(currentDoc.signatureConfig));
        
        console.log('✅ Renderização concluída:', currentDoc.name);
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setLoadError(err instanceof Error ? err.message : 'Erro'); setLoading(false); }
      }
    };
    renderDocx();
    return () => { cancelled = true; };
  }, [isOpen, template, containerReady, activeDocIndex, allDocuments]);

  // Função de salvamento automático (sem fechar modal)
  const autoSave = useCallback(async (fieldsToSave: LocalSignatureField[]) => {
    const currentDoc = allDocuments[activeDocIndex];
    if (!currentDoc) return;
    
    try {
      const payload: SignatureFieldConfigValue = stripLocalIds(fieldsToSave);
      console.log('💾 Auto-salvando...', payload.length, 'campo(s)');
      
      if (currentDoc.type === 'main') {
        await documentTemplateService.updateSignatureFieldConfig(template.id, payload);
        onSave(payload);
      } else {
        await documentTemplateService.updateTemplateFileSignatureConfig(currentDoc.id, payload);
      }
      
      // Atualizar a configuração no documento ativo local
      setAllDocuments(prev => prev.map((doc, idx) => 
        idx === activeDocIndex ? { ...doc, signatureConfig: payload } : doc
      ));
      
      console.log('✅ Auto-salvo com sucesso!');
    } catch (err) { 
      console.error('❌ Erro ao auto-salvar:', err); 
    }
  }, [allDocuments, activeDocIndex, template.id, onSave]);

  const addFieldAtClick = useCallback((e: React.MouseEvent) => {
    console.log('🖱️ Click detectado no documento');
    
    if (!docxContainerRef.current) {
      console.log('❌ docxContainerRef.current não existe');
      return;
    }
    
    // Obter posição do clique relativa ao container
    const containerRect = docxContainerRef.current.getBoundingClientRect();
    const containerWidth = docxContainerRef.current.offsetWidth;
    
    // O clique está em coordenadas escaladas, precisamos converter para coordenadas não-escaladas
    // O container tem transform: scale(scale), então as coordenadas do clique já estão escaladas
    const clickXScaled = e.clientX - containerRect.left;
    const clickYScaled = e.clientY - containerRect.top;
    
    // Converter de coordenadas escaladas para não-escaladas
    const clickX = clickXScaled / scale;
    const clickY = clickYScaled / scale;
    
    // Calcular qual página virtual A4 foi clicada (usando altura A4 não-escalada)
    const pageNumber = Math.floor(clickY / A4_HEIGHT_PX) + 1;
    
    // Calcular posição relativa dentro da página virtual
    const pageStartY = (pageNumber - 1) * A4_HEIGHT_PX;
    const relativeY = clickY - pageStartY;
    
    // Converter para porcentagem da página A4
    const rawX = (clickX / containerWidth) * 100;
    const rawY = (relativeY / A4_HEIGHT_PX) * 100;
    
    const width = 25, height = 8;
    const x = Math.max(0, Math.min(100 - width, rawX - width / 2));
    const y = Math.max(0, Math.min(100 - height, rawY - height / 2));
    
    console.log('✅ Adicionando campo:', { page: pageNumber, x: x.toFixed(1), y: y.toFixed(1), clickY: clickY.toFixed(0), scale });
    const newField = { _id: crypto.randomUUID(), page: pageNumber, x_percent: x, y_percent: y, width_percent: width, height_percent: height };
    setFields((prev) => {
      const newFields = [...prev, newField];
      // Salvamento automático
      autoSave(newFields);
      return newFields;
    });
  }, [scale, autoSave]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => { e.stopPropagation(); setDraggingId(id); }, []);

  useEffect(() => {
    if (!draggingId) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!docxContainerRef.current) return;
      const current = fields.find((f) => f._id === draggingId);
      if (!current) return;
      
      const containerRect = docxContainerRef.current.getBoundingClientRect();
      const containerWidth = docxContainerRef.current.offsetWidth;
      
      // Converter coordenadas escaladas para não-escaladas
      const mouseXScaled = e.clientX - containerRect.left;
      const mouseYScaled = e.clientY - containerRect.top;
      const mouseX = mouseXScaled / scale;
      const mouseY = mouseYScaled / scale;
      
      // Calcular posição relativa dentro da página virtual do campo
      const pageStartY = (current.page - 1) * A4_HEIGHT_PX;
      const relativeY = mouseY - pageStartY;
      
      const rawX = (mouseX / containerWidth) * 100;
      const rawY = (relativeY / A4_HEIGHT_PX) * 100;
      
      const x = Math.max(0, Math.min(100 - current.width_percent, rawX - current.width_percent / 2));
      const y = Math.max(0, Math.min(100 - current.height_percent, rawY - current.height_percent / 2));
      
      setFields((prev) => prev.map((f) => (f._id === draggingId ? { ...f, x_percent: x, y_percent: y } : f)));
    };
    const handleMouseUp = () => setDraggingId(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [draggingId, fields, scale]);

  const removeField = useCallback((id: string) => { 
    setFields((prev) => {
      const newFields = prev.filter((f) => f._id !== id);
      autoSave(newFields);
      return newFields;
    }); 
  }, [autoSave]);

  const handleSave = async () => {
    console.log('💾 Iniciando salvamento...', { activeDoc, fields: fields.length });
    
    if (!activeDoc) {
      console.error('❌ activeDoc não existe!');
      return;
    }
    
    if (fields.length === 0) {
      console.warn('⚠️ Nenhum campo para salvar');
      return;
    }
    
    try {
      setSaving(true);
      const payload: SignatureFieldConfigValue = stripLocalIds(fields);
      console.log('📦 Payload a salvar:', payload);
      
      if (activeDoc.type === 'main') {
        // Salvar no template principal
        console.log('💾 Salvando no template principal:', template.id);
        await documentTemplateService.updateSignatureFieldConfig(template.id, payload);
        onSave(payload);
        console.log('✅ Salvo no template principal');
      } else {
        // Salvar no arquivo específico
        console.log('💾 Salvando no arquivo:', activeDoc.id);
        await documentTemplateService.updateTemplateFileSignatureConfig(activeDoc.id, payload);
        console.log('✅ Salvo no arquivo específico');
      }
      
      // Atualizar a configuração no documento ativo local
      setAllDocuments(prev => prev.map((doc, idx) => 
        idx === activeDocIndex ? { ...doc, signatureConfig: payload } : doc
      ));
      
      console.log('✅ Salvamento concluído com sucesso!');
      
      // Fechar o modal após salvar
      onClose();
      
    } catch (err) { 
      console.error('❌ Erro ao salvar:', err); 
    } finally { 
      setSaving(false); 
    }
  };
  
  // Navegar entre documentos
  const goToPrevDoc = () => {
    if (activeDocIndex > 0) setActiveDocIndex(activeDocIndex - 1);
  };
  
  const goToNextDoc = () => {
    if (activeDocIndex < allDocuments.length - 1) setActiveDocIndex(activeDocIndex + 1);
  };

  const renderSignatureFields = () => {
    if (!docxContainerRef.current) return null;
    
    // Usar dimensões do container DOCX (sem considerar scale, pois o container pai já aplica)
    const containerWidth = docxContainerRef.current.offsetWidth;
    const containerHeight = docxContainerRef.current.scrollHeight || docxContainerRef.current.offsetHeight;
    
    console.log('🎨 Renderizando campos:', fields.length, 'containerWidth:', containerWidth, 'containerHeight:', containerHeight);
    
    return fields.map((f) => {
      // Usar páginas virtuais A4 (sem scale, pois o transform do pai já aplica)
      const pageStartY = (f.page - 1) * A4_HEIGHT_PX;
      
      // Calcular posição em pixels baseado nas dimensões do container
      const left = (f.x_percent / 100) * containerWidth;
      const top = pageStartY + (f.y_percent / 100) * A4_HEIGHT_PX;
      const width = (f.width_percent / 100) * containerWidth;
      const height = (f.height_percent / 100) * A4_HEIGHT_PX;
      
      console.log('📍 Campo:', f._id.slice(0, 8), 'left:', left.toFixed(0), 'top:', top.toFixed(0), 'page:', f.page);
      
      return (
        <div key={f._id} className={'absolute border-2 border-emerald-500 bg-emerald-500/20 rounded-md flex items-center justify-center z-20 pointer-events-auto ' + (draggingId === f._id ? 'cursor-grabbing' : 'cursor-grab')}
          style={{ left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' }}
          onMouseDown={(evt) => handleDragStart(evt, f._id)} onClick={(evt) => evt.stopPropagation()}>
          <div className="flex flex-col items-center justify-center">
            <Signature className="w-5 h-5 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700 mt-1">Assinatura</span>
          </div>
          <div className="absolute top-0 right-0 p-1 bg-emerald-500 rounded-bl"><Move className="w-3 h-3 text-white" /></div>
          <button type="button" onClick={() => removeField(f._id)} className="absolute top-0 left-0 p-1 bg-red-600 text-white" title="Remover"><X className="w-3 h-3" /></button>
        </div>
      );
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex bg-slate-100/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex-1 flex flex-col bg-white dark:bg-zinc-900 max-h-screen overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-900 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-800 rounded-lg transition"><X className="w-5 h-5" /></button>
            <div><p className="text-sm font-medium">{template.name}</p><p className="text-xs text-slate-400">Clique no documento para adicionar campos</p></div>
          </div>
          <div className="flex items-center gap-3">
            {/* Navegação entre documentos */}
            {allDocuments.length > 1 && (
              <div className="flex items-center gap-2 bg-blue-600 rounded-lg px-3 py-1">
                <button onClick={goToPrevDoc} disabled={activeDocIndex === 0} className="p-1 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium max-w-[150px] truncate">{activeDoc?.name || 'Documento'}</span>
                  <span className="text-xs text-blue-200">({activeDocIndex + 1}/{allDocuments.length})</span>
                </div>
                <button onClick={goToNextDoc} disabled={activeDocIndex === allDocuments.length - 1} className="p-1 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
            {allDocuments.length === 1 && activeDoc && (
              <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-1">
                <FileText className="w-4 h-4" />
                <span className="text-sm font-medium max-w-[150px] truncate">{activeDoc.name}</span>
              </div>
            )}
            <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1"><span className="text-sm font-medium">{numPages} pag.</span></div>
            <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1">
              <button onClick={() => setScale((s) => Math.max(0.5, s - 0.1))} className="p-1 text-slate-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
              <span className="text-sm font-medium min-w-[50px] text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale((s) => Math.min(2, s + 0.1))} className="p-1 text-slate-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
            </div>
            <span className={'text-xs px-2 py-1 rounded ' + (fields.length ? 'bg-emerald-600' : 'bg-slate-700')}>{fields.length ? fields.length + ' campo(s) - Salvo automaticamente' : 'Clique para posicionar'}</span>
            <button onClick={onClose} className="px-4 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 rounded-lg transition flex items-center gap-2">
              <Save className="w-4 h-4" />Fechar
            </button>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-72 border-r border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-4 overflow-y-auto flex-shrink-0">
            {/* Lista de documentos anexos */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Documentos Anexos
              </h3>
              {allDocuments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Nenhum documento.</p>
              ) : (
                <div className="space-y-2">
                  {allDocuments.map((doc, idx) => (
                    <button
                      key={doc.id}
                      onClick={() => setActiveDocIndex(idx)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                        activeDocIndex === idx
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className={`w-4 h-4 flex-shrink-0 ${activeDocIndex === idx ? 'text-blue-600' : 'text-slate-400'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-medium truncate ${activeDocIndex === idx ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            {idx + 1}. {doc.name}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {doc.type === 'main' ? 'Principal' : 'Anexo'}
                            {doc.signatureConfig && Array.isArray(doc.signatureConfig) && doc.signatureConfig.length > 0 && (
                              <span className="ml-1 text-emerald-600">• {doc.signatureConfig.length} assinatura(s)</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <h3 className="text-sm font-semibold text-slate-800 dark:text-white mb-4">Campos de assinatura</h3>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2"><PenTool className="w-4 h-4 text-blue-600" /><span className="text-sm font-medium text-blue-800 dark:text-blue-300">Como usar</span></div>
              <p className="text-xs text-blue-700 dark:text-blue-300">Clique na pagina para adicionar um campo.</p>
            </div>
            {sortedFields.length === 0 ? (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4"><p className="text-xs text-amber-700 dark:text-amber-300">Nenhum campo.</p></div>
            ) : (
              <div className="space-y-2">{sortedFields.map((f, idx) => (
                <div key={f._id} className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0"><p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">Campo #{idx + 1} (Pag. {f.page})</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{Math.round(f.x_percent)}% x {Math.round(f.y_percent)}%</p></div>
                    <button onClick={() => removeField(f._id)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remover" type="button"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}</div>
            )}
          </aside>
          <div className="flex-1 overflow-auto bg-slate-200 dark:bg-zinc-800 relative">
            {loading && (<div className="absolute inset-0 flex items-center justify-center bg-slate-200/80 dark:bg-zinc-800/80 z-30"><Loader2 className="w-8 h-8 text-emerald-600 animate-spin" /><span className="ml-3 text-slate-600 dark:text-slate-300">Carregando...</span></div>)}
            {loadError && (<div className="max-w-xl w-full mx-auto py-10"><div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div></div>)}
            <div ref={containerRef} className="py-6" style={{ transform: 'scale(' + scale + ')', transformOrigin: 'top center' }}>
              <div className="flex justify-center">
                <div className="relative">
                  <div ref={docxContainerCallback} className="bg-white shadow-2xl cursor-crosshair" onClick={addFieldAtClick} style={{ minWidth: '210mm', minHeight: '297mm' }} />
                  {!loading && (
                    <div className="absolute inset-0 pointer-events-none">
                      {renderSignatureFields()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SignaturePositionDesigner;
