import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, FileText, Loader2, GripVertical, PenTool, Upload, AlertCircle, FileDown } from 'lucide-react';
import { saveAs } from 'file-saver';
import { documentTemplateService } from '../services/documentTemplate.service';
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
  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

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

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-100/80 backdrop-blur-sm" onClick={onClose}>
      <div className="!bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Gerenciar Documentos</h2>
            <p className="text-sm text-slate-600">{template.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          <div className="mb-6">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-amber-500 hover:bg-amber-50/50 transition">
              <input
                type="file"
                accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple={true}
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
                  <span className="text-sm text-slate-600">
                    Enviando {uploadProgress.current} de {uploadProgress.total} arquivo(s)...
                  </span>
                  <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="text-sm text-slate-700">Clique ou arraste arquivos .docx</span>
                  <span className="text-xs text-slate-500 mt-1">Você pode selecionar múltiplos arquivos</span>
                </>
              )}
            </label>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-amber-600 animate-spin" />
              <span className="ml-2 text-slate-600">Carregando...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">Nenhum documento adicionado</p>
              <p className="text-sm text-slate-500 mt-1">
                Adicione documentos que fazem parte deste template
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600 mb-3">
                {files.length} documento(s) - Arraste para reordenar
              </p>
              {files.map((file, index) => (
                (() => {
                  const isMain = index === 0;
                  const label = isMain ? 'Principal' : 'Anexo';
                  const badgeClass = isMain
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200';

                  return (
                <div
                  key={file.id}
                  draggable
                  onDragStart={() => handleDragStart(file.id)}
                  onDragOver={(e) => handleDragOver(e, file.id)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 ${
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
                      onClick={() => {/* TODO: Abrir designer de assinatura */}}
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

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center">
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
    </div>,
    document.body
  );
};

export default TemplateFilesManager;
