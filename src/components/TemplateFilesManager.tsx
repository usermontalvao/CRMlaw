import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, FileText, Loader2, GripVertical, PenTool, Upload, AlertCircle, FileDown, Pencil } from 'lucide-react';
import { saveAs } from 'file-saver';
import { documentTemplateService } from '../services/documentTemplate.service';
import SignaturePositionDesigner from './SignaturePositionDesigner';
import TemplateDocxEditorModal from './TemplateDocxEditorModal';
import type { DocumentTemplate, TemplateFile, SignatureFieldConfigValue } from '../types/document.types';

interface TemplateFilesManagerProps {
  isOpen: boolean;
  onClose: () => void;
  template: DocumentTemplate;
  onUpdate: () => void;
}

const TemplateFilesManager: React.FC<TemplateFilesManagerProps> = ({
  isOpen,
  onClose,
  template,
  onUpdate,
}) => {
  const [localTemplate, setLocalTemplate] = useState<DocumentTemplate>(template);
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [designerFileId, setDesignerFileId] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<TemplateFile | null>(null);
  const [editingMain, setEditingMain] = useState(false);
  const [downloadingMain, setDownloadingMain] = useState(false);
  const [updatingMain, setUpdatingMain] = useState(false);
  const [updatingModel, setUpdatingModel] = useState(false);
  const mainFileInputRef = useRef<HTMLInputElement | null>(null);

  const perDocument = localTemplate.signature_model === 'per_document';

  const handleToggleSignatureModel = async () => {
    const next = perDocument ? 'consolidated' : 'per_document';
    // Otimista: reflete na UI e persiste; reverte em caso de erro.
    setLocalTemplate((prev) => ({ ...prev, signature_model: next }));
    try {
      setUpdatingModel(true);
      setError(null);
      await documentTemplateService.updateSignatureModel(template.id, next);
      onUpdate();
    } catch (err) {
      setLocalTemplate((prev) => ({ ...prev, signature_model: perDocument ? 'per_document' : 'consolidated' }));
      setError(err instanceof Error ? err.message : 'Erro ao alterar o modelo de assinatura');
    } finally {
      setUpdatingModel(false);
    }
  };

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await documentTemplateService.listTemplateFiles(template.id);
      setFiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar arquivos');
    } finally {
      setLoading(false);
    }
  }, [template.id]);

  useEffect(() => {
    setLocalTemplate(template);
  }, [template]);

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, loadFiles]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  const handleDownloadFile = async (file: TemplateFile) => {
    try {
      setDownloadingFileId(file.id);
      setError(null);
      const blob = await documentTemplateService.downloadTemplateFileById(file.id);
      saveAs(blob, file.file_name || 'documento.docx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao baixar arquivo');
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleDownloadMain = async () => {
    try {
      setDownloadingMain(true);
      setError(null);
      const blob = await documentTemplateService.downloadTemplateFile(localTemplate);
      saveAs(blob, localTemplate.file_name || `${localTemplate.name}.docx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao baixar documento principal');
    } finally {
      setDownloadingMain(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    // Filtrar apenas arquivos válidos
    const validFiles: File[] = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      if (file.name.match(/\.(doc|docx)$/i)) {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      setError('Apenas arquivos .doc ou .docx são permitidos');
      e.target.value = '';
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setUploadProgress({ current: 0, total: validFiles.length });

      for (let i = 0; i < validFiles.length; i++) {
        setUploadProgress({ current: i + 1, total: validFiles.length });
        await documentTemplateService.addTemplateFile(template.id, validFiles[i]);
      }

      await loadFiles();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer upload');
    } finally {
      setUploading(false);
      setUploadProgress({ current: 0, total: 0 });
      e.target.value = '';
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    if (!confirm('Tem certeza que deseja remover este arquivo?')) return;

    try {
      setError(null);
      await documentTemplateService.removeTemplateFile(fileId);
      await loadFiles();
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover arquivo');
    }
  };

  const handleDragStart = (fileId: string) => {
    setDraggedFileId(fileId);
  };

  const handleDragOver = (e: React.DragEvent, targetFileId: string) => {
    e.preventDefault();
    if (!draggedFileId || draggedFileId === targetFileId) return;

    const draggedIndex = files.findIndex(f => f.id === draggedFileId);
    const targetIndex = files.findIndex(f => f.id === targetFileId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newFiles = [...files];
    const [draggedFile] = newFiles.splice(draggedIndex, 1);
    newFiles.splice(targetIndex, 0, draggedFile);

    setFiles(newFiles);
  };

  const handleDragEnd = async () => {
    if (!draggedFileId) return;

    try {
      for (let i = 0; i < files.length; i++) {
        if (files[i].order !== i) {
          await documentTemplateService.updateTemplateFileOrder(files[i].id, i);
        }
      }
      await loadFiles();
    } catch (err) {
      console.error('Erro ao reordenar:', err);
    }

    setDraggedFileId(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleMainFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(doc|docx)$/i)) {
      setError('Apenas arquivos .doc ou .docx são permitidos para o principal');
      e.target.value = '';
      return;
    }

    try {
      setUpdatingMain(true);
      setError(null);
      const updated = await documentTemplateService.updateTemplateWithFile(
        localTemplate,
        {},
        selectedFile,
      );
      setLocalTemplate(updated);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao substituir documento principal');
    } finally {
      setUpdatingMain(false);
      e.target.value = '';
    }
  };

  const handleRemoveMain = async () => {
    if (!localTemplate.file_path) return;
    if (!confirm('Deseja remover o documento principal deste template?')) return;

    try {
      setUpdatingMain(true);
      setError(null);
      const updated = await documentTemplateService.removeTemplateMainFile(localTemplate.id);
      setLocalTemplate(updated);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover documento principal');
    } finally {
      setUpdatingMain(false);
    }
  };

  const totalDocuments = (localTemplate.file_path ? 1 : 0) + files.length;

  if (!isOpen) return null;

  return createPortal(
    <>
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-100/80 backdrop-blur-sm" onClick={onClose}>
      <div className="!bg-[#f8f7f5] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#e7e5df]">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">Gerenciar Documentos</h2>
            <p className="text-sm text-slate-600 truncate">{localTemplate.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                {localTemplate.file_path ? '1 principal' : 'Sem principal'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {files.length} anexo{files.length === 1 ? '' : 's'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {totalDocuments} documento{totalDocuments === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <input
            ref={mainFileInputRef}
            type="file"
            accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleMainFileSelected}
            className="hidden"
          />
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* ── Documento principal (contrato) ── */}
          {localTemplate.file_path && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Principal</p>
              <div className="flex items-center gap-3 p-3 bg-indigo-50/40 rounded-lg border border-indigo-200">
                <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {localTemplate.file_name || `${localTemplate.name}.docx`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {typeof localTemplate.file_size === 'number' ? formatFileSize(localTemplate.file_size) : 'Documento de assinatura'}
                  </p>
                </div>
                <span className="px-2 py-1 text-[11px] font-semibold rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 whitespace-nowrap">
                  Principal
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDownloadMain}
                    disabled={downloadingMain || updatingMain}
                    className="p-2 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
                    title="Baixar documento principal"
                  >
                    {downloadingMain ? (
                      <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                    ) : (
                      <FileDown className="w-4 h-4 text-slate-600" />
                    )}
                  </button>
                  <button
                    onClick={() => setEditingMain(true)}
                    disabled={updatingMain}
                    className="p-2 hover:bg-amber-100 rounded-lg transition disabled:opacity-50"
                    title="Editar documento principal"
                  >
                    <Pencil className="w-4 h-4 text-amber-600" />
                  </button>
                  <button
                    onClick={() => mainFileInputRef.current?.click()}
                    disabled={updatingMain}
                    className="p-2 hover:bg-blue-100 rounded-lg transition disabled:opacity-50"
                    title="Substituir documento principal"
                  >
                    {updatingMain ? (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 text-blue-600" />
                    )}
                  </button>
                  <button
                    onClick={() => setDesignerFileId('main')}
                    disabled={updatingMain}
                    className="p-2 hover:bg-emerald-100 rounded-lg transition disabled:opacity-50"
                    title="Configurar posi??o da assinatura"
                  >
                    <PenTool className="w-4 h-4 text-emerald-600" />
                  </button>
                  <button
                    onClick={handleRemoveMain}
                    disabled={updatingMain}
                    className="p-2 hover:bg-red-100 rounded-lg transition disabled:opacity-50"
                    title="Remover documento principal"
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {!localTemplate.file_path && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Principal</p>
              <button
                type="button"
                onClick={() => mainFileInputRef.current?.click()}
                disabled={updatingMain}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 px-5 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50/70 transition disabled:opacity-50"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100">
                  {updatingMain ? (
                    <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
                  ) : (
                    <Upload className="w-6 h-6 text-indigo-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800">Adicionar documento principal</span>
                  <span className="mt-1 block text-xs text-slate-500">O template possui apenas um principal. Documentos extras ficam em anexos.</span>
                </div>
              </button>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anexos</p>
              <p className="mt-1 text-sm text-slate-500">Adicione e organize os documentos complementares.</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              {files.length} item{files.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="mb-4">
            <label className="flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-slate-300 bg-white/70 px-5 py-4 hover:border-amber-500 hover:bg-amber-50/50 transition">
              <input
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple={true}
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              {uploading ? (
                <div className="flex w-full items-center gap-4">
                  <Loader2 className="w-6 h-6 flex-shrink-0 text-amber-600 animate-spin" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-700">
                      Enviando {uploadProgress.current} de {uploadProgress.total} arquivo(s)...
                    </span>
                    <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex w-full items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <Upload className="w-6 h-6 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-700">Clique ou arraste arquivos .docx</span>
                    <span className="mt-1 block text-xs text-slate-500">Você pode selecionar múltiplos arquivos e reordenar depois.</span>
                  </div>
                </div>
              )}
            </label>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
              <span className="ml-2 text-slate-600">Carregando...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">Nenhum anexo adicionado</p>
              <p className="text-sm text-slate-500 mt-1">
                Adicione documentos anexos que acompanham o principal neste template
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600 mb-3">
                {files.length} anexo(s) - Arraste para reordenar
              </p>
              {files.map((file, index) => (
                (() => {
                  const label = 'Anexo';
                  const badgeClass = 'bg-slate-50 text-slate-600 border-[#e7e5df]';

                  return (
                <div
                  key={file.id}
                  draggable
                  onDragStart={() => handleDragStart(file.id)}
                  onDragOver={(e) => handleDragOver(e, file.id)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-[#e7e5df] ${
                    draggedFileId === file.id ? 'opacity-50' : ''
                  } hover:border-amber-300 transition cursor-move`}
                >
                  <GripVertical className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {index + 1}. {file.file_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatFileSize(file.file_size)}
                      {file.signature_field_config && (
                        <span className="ml-2 text-emerald-600">
                          • Assinatura configurada
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`px-2 py-1 text-[11px] font-semibold rounded-full border ${badgeClass} whitespace-nowrap`}>
                    {label}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDownloadFile(file)}
                      disabled={downloadingFileId === file.id}
                      className="p-2 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
                      title="Baixar arquivo"
                    >
                      {downloadingFileId === file.id ? (
                        <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                      ) : (
                        <FileDown className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                    <button
                      onClick={() => setEditingFile(file)}
                      className="p-2 hover:bg-amber-100 rounded-lg transition"
                      title="Editar documento"
                    >
                      <Pencil className="w-4 h-4 text-amber-600" />
                    </button>
                    <button
                      onClick={() => setDesignerFileId(file.id)}
                      className="p-2 hover:bg-emerald-100 rounded-lg transition"
                      title="Configurar posição da assinatura"
                    >
                      <PenTool className="w-4 h-4 text-emerald-600" />
                    </button>
                    <button
                      onClick={() => handleRemoveFile(file.id)}
                      className="p-2 hover:bg-red-100 rounded-lg transition"
                      title="Remover arquivo"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </div>

        {/* Modelo de assinatura do kit (VERSIONADO) */}
        <div className="px-6 pt-4 border-t border-[#e7e5df] bg-[#f8f7f5]">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-[#e7e5df] bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">Assinatura individual por arquivo</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {perDocument
                  ? 'Cada arquivo do kit gera um PDF assinado próprio, com hash e código de verificação individuais.'
                  : 'Modelo padrão: o kit gera um único PDF assinado consolidado (principal + anexos).'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={perDocument}
              onClick={handleToggleSignatureModel}
              disabled={updatingModel}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${perDocument ? 'bg-emerald-500' : 'bg-slate-300'}`}
              title="Alternar modelo de assinatura"
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${perDocument ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e7e5df] flex justify-between items-center gap-4 bg-[#f8f7f5]">
          <p className="text-xs text-slate-500">
            Todos os documentos terão assinatura e página de autenticidade
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
    <SignaturePositionDesigner
      isOpen={!!designerFileId}
      onClose={() => { setDesignerFileId(null); loadFiles(); onUpdate(); }}
      template={localTemplate}
      initialFileId={designerFileId}
      onSave={(config) => {
        if (!designerFileId || designerFileId === 'main') {
          setLocalTemplate((prev) => ({ ...prev, signature_field_config: config }));
        } else {
          setFiles((prev) => prev.map((file) => (
            file.id === designerFileId
              ? { ...file, signature_field_config: config }
              : file
          )));
        }
        loadFiles();
        onUpdate();
      }}
    />
    {editingFile && (
      <TemplateDocxEditorModal
        isOpen={!!editingFile}
        onClose={() => setEditingFile(null)}
        fileName={editingFile.file_name || 'documento.docx'}
        badge="Anexo"
        load={() => documentTemplateService.downloadTemplateFileById(editingFile.id)}
        save={(blob) => documentTemplateService.replaceTemplateFileContent(editingFile.id, blob).then(() => undefined)}
        onSaved={() => { loadFiles(); onUpdate(); }}
      />
    )}
    {editingMain && (
      <TemplateDocxEditorModal
        isOpen={editingMain}
        onClose={() => setEditingMain(false)}
        fileName={localTemplate.file_name || `${localTemplate.name}.docx`}
        badge="Principal"
        load={() => documentTemplateService.downloadTemplateFile(localTemplate)}
        save={(blob) => documentTemplateService.replaceTemplateContent(localTemplate, blob).then(() => undefined)}
        onSaved={() => { onUpdate(); }}
      />
    )}
    </>,
    document.body
  );
};

export default TemplateFilesManager;
