import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Loader2, Upload, AlertCircle } from 'lucide-react';
import { saveAs } from 'file-saver';
import { documentTemplateService } from '../services/documentTemplate.service';
import { openDocInEditorWindow } from '../utils/openEditorWindow';
import {
  subscribeEditorDocSourceSaved,
  type EditorDocSourceSavedDetail,
} from '../utils/editorDocSourceEvents';
import SignaturePositionDesigner from './SignaturePositionDesigner';
import TemplateFileRow from './documents/TemplateFileRow';
import type { DocumentTemplate, TemplateFile, SignatureFieldConfigValue } from '../types/document.types';
import { zc } from '../styles/layers';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useSecurityPin } from '../contexts/SecurityPinContext';

// Um arquivo "assina" quando tem ao menos uma posição gravada. A coluna aceita
// objeto, lista ou nulo — e a lista pode chegar vazia.
const hasSignatureConfig = (config: SignatureFieldConfigValue | undefined): boolean => {
  if (!config) return false;
  if (Array.isArray(config)) return config.length > 0;
  return true;
};

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
  const { confirmDelete } = useDeleteConfirm();
  const { ensurePermission } = useSecurityPin();
  const [localTemplate, setLocalTemplate] = useState<DocumentTemplate>(template);
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [designerFileId, setDesignerFileId] = useState<string | null>(null);
  const [downloadingMain, setDownloadingMain] = useState(false);
  const [updatingMain, setUpdatingMain] = useState(false);
  const [updatingModel, setUpdatingModel] = useState(false);
  const mainFileInputRef = useRef<HTMLInputElement | null>(null);
  // As ações raras de cada linha (baixar, substituir, remover) moram num menu.
  // Antes eram cinco ícones sem rótulo, distinguíveis só pelo `title`.
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);

  const perDocument = localTemplate.signature_model === 'per_document';
  const mainHasSignature = hasSignatureConfig(localTemplate.signature_field_config);

  const handleToggleSignatureModel = async () => {
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
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

  const refreshDocumentsAfterEditorSave = useCallback(async () => {
    try {
      const [updatedTemplate, updatedFiles] = await Promise.all([
        documentTemplateService.getTemplate(template.id),
        documentTemplateService.listTemplateFiles(template.id),
      ]);
      if (updatedTemplate) setLocalTemplate(updatedTemplate);
      setFiles(updatedFiles);
      setError(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar os documentos salvos');
    }
  }, [onUpdate, template.id]);

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

    const sourceBelongsToCurrentTemplate = (detail: EditorDocSourceSavedDetail) => {
      const source = detail.source;
      if (source.type === 'template-main') {
        return source.templateId === template.id;
      }
      if (source.type === 'template-file') {
        // Há apenas um Gerenciar Documentos aberto por vez. Atualizar também
        // cobre o caso em que o save chega antes de a lista inicial terminar de
        // carregar e, portanto, ainda não conhecemos o fileId localmente.
        return true;
      }
      return false;
    };

    return subscribeEditorDocSourceSaved((detail) => {
      if (!sourceBelongsToCurrentTemplate(detail)) return;
      void refreshDocumentsAfterEditorSave();
    });
  }, [isOpen, refreshDocumentsAfterEditorSave, template.id]);

  // Esc fecha o menu da linha antes de fechar o modal inteiro.
  useEffect(() => {
    if (!openRowMenuId) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-file-row-menu]')) return;
      setOpenRowMenuId(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [openRowMenuId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openRowMenuId) {
        setOpenRowMenuId(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, openRowMenuId]);

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
    if (!ensurePermission({ module: 'documentos', action: 'create' })) {
      e.target.value = '';
      return;
    }

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
    const confirmed = await confirmDelete({
      title: 'Remover arquivo do modelo',
      permission: { module: 'documentos', action: 'delete' },
    });
    if (!confirmed) return;

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
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) {
      setDraggedFileId(null);
      await loadFiles();
      return;
    }

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
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) {
      e.target.value = '';
      return;
    }

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
    const confirmed = await confirmDelete({
      title: 'Remover documento principal',
      entityName: localTemplate.name,
      permission: { module: 'documentos', action: 'delete' },
    });
    if (!confirmed) return;

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
    <div className={`fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-slate-100/80 backdrop-blur-sm`} onClick={onClose}>
      <div className="!bg-[#f8f7f5] dark:!bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#e7e5df] dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Gerenciar Documentos</h2>
            <p className="text-sm text-slate-600 truncate dark:text-zinc-400">{localTemplate.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11px] font-semibold text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
                {localTemplate.file_path ? '1 principal' : 'Sem principal'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {files.length} anexo{files.length === 1 ? '' : 's'}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {totalDocuments} documento{totalDocuments === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition dark:hover:bg-zinc-800">
            <X className="w-5 h-5 text-slate-500 dark:text-zinc-400" />
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
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 dark:border-red-500/30 dark:bg-red-500/10">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
            </div>
          )}

          {/* ── Documento principal (contrato) ── */}
          {localTemplate.file_path && (
            <div className="mb-6">
              <TemplateFileRow
                role="main"
                fileName={localTemplate.file_name || `${localTemplate.name}.docx`}
                sizeLabel={typeof localTemplate.file_size === 'number' ? formatFileSize(localTemplate.file_size) : undefined}
                signs={mainHasSignature}
                menuOpen={openRowMenuId === 'main'}
                busy={downloadingMain || updatingMain}
                onToggleMenu={() => setOpenRowMenuId(openRowMenuId === 'main' ? null : 'main')}
                onEdit={() => {
                  setOpenRowMenuId(null);
                  if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
                  openDocInEditorWindow({ type: 'template-main', templateId: localTemplate.id }, localTemplate.file_name || `${localTemplate.name}.docx`);
                }}
                onPosition={() => {
                  setOpenRowMenuId(null);
                  if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
                  setDesignerFileId('main');
                }}
                onDownload={() => { setOpenRowMenuId(null); handleDownloadMain(); }}
                onReplace={() => { setOpenRowMenuId(null); mainFileInputRef.current?.click(); }}
                onRemove={() => { setOpenRowMenuId(null); handleRemoveMain(); }}
              />
            </div>
          )}

          {!localTemplate.file_path && (
            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Principal</p>
              <button
                type="button"
                onClick={() => mainFileInputRef.current?.click()}
                disabled={updatingMain}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/40 px-5 py-4 text-left hover:border-primary-300 hover:bg-primary-50/70 transition disabled:opacity-50 dark:border-primary-500/40 dark:bg-primary-500/10"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-500/20">
                  {updatingMain ? (
                    <Loader2 className="w-6 h-6 text-primary-600 animate-spin dark:text-primary-400" />
                  ) : (
                    <Upload className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-800 dark:text-zinc-100">Adicionar documento principal</span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-zinc-400">O template possui apenas um principal. Documentos extras ficam em anexos.</span>
                </div>
              </button>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Anexos</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Adicione e organize os documentos complementares.</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {files.length} item{files.length === 1 ? '' : 's'}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-primary-600 animate-spin dark:text-primary-400" />
              <span className="ml-2 text-slate-600 dark:text-zinc-400">Carregando...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-800/40">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3 dark:text-zinc-600" />
              <p className="text-slate-600 dark:text-zinc-300">Nenhum anexo adicionado</p>
              <p className="text-sm text-slate-500 mt-1 dark:text-zinc-400">
                Adicione documentos anexos que acompanham o principal neste template
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600 mb-3 dark:text-zinc-400">
                {files.length} anexo(s) — arraste para reordenar
              </p>
              {files.map((file, index) => (
                <TemplateFileRow
                  key={file.id}
                  role="attachment"
                  position={index + 1}
                  fileName={file.file_name}
                  sizeLabel={formatFileSize(file.file_size)}
                  signs={hasSignatureConfig(file.signature_field_config)}
                  menuOpen={openRowMenuId === file.id}
                  busy={downloadingFileId === file.id}
                  dragging={draggedFileId === file.id}
                  onToggleMenu={() => setOpenRowMenuId(openRowMenuId === file.id ? null : file.id)}
                  onDragStart={() => handleDragStart(file.id)}
                  onDragOver={(e) => handleDragOver(e, file.id)}
                  onDragEnd={handleDragEnd}
                  onEdit={() => {
                    setOpenRowMenuId(null);
                    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
                    openDocInEditorWindow({ type: 'template-file', fileId: file.id }, file.file_name || 'documento.docx');
                  }}
                  onPosition={() => {
                    setOpenRowMenuId(null);
                    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
                    setDesignerFileId(file.id);
                  }}
                  onDownload={() => { setOpenRowMenuId(null); handleDownloadFile(file); }}
                  onRemove={() => { setOpenRowMenuId(null); handleRemoveFile(file.id); }}
                />
              ))}
            </div>
          )}
          <div className="mt-4">
            <label className="flex w-full cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-slate-300 bg-white/70 px-5 py-4 hover:border-primary-500 hover:bg-primary-50/50 transition dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-primary-500/60 dark:hover:bg-primary-500/10">
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
                  <Loader2 className="w-6 h-6 flex-shrink-0 text-primary-600 animate-spin dark:text-primary-400" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-700 dark:text-zinc-200">
                      Enviando {uploadProgress.current} de {uploadProgress.total} arquivo(s)...
                    </span>
                    <div className="mt-2 h-2 w-full bg-slate-200 rounded-full overflow-hidden dark:bg-zinc-700">
                      <div 
                        className="h-full bg-primary-500 transition-all duration-300"
                        style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex w-full items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-zinc-700">
                    <Upload className="w-6 h-6 text-slate-500 dark:text-zinc-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-700 dark:text-zinc-200">Clique ou arraste arquivos .docx</span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-zinc-400">Você pode selecionar múltiplos arquivos e reordenar depois.</span>
                  </div>
                </div>
              )}
            </label>
          </div>
        </div>

        {/* Modelo de assinatura do kit (VERSIONADO) */}
        <div className="px-6 pt-4 border-t border-[#e7e5df] bg-[#f8f7f5] dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-[#e7e5df] bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/60">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100">Assinatura individual por arquivo</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
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
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${perDocument ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-zinc-600'}`}
              title="Alternar modelo de assinatura"
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${perDocument ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#e7e5df] flex justify-between items-center gap-4 bg-[#f8f7f5] dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Todos os documentos terão assinatura e página de autenticidade
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
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
    </>,
    document.body
  );
};

export default TemplateFilesManager;
