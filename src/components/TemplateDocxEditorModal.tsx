import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Save, AlertCircle, FileText } from 'lucide-react';
import SyncfusionEditor, { SyncfusionEditorRef } from './SyncfusionEditor';

interface TemplateDocxEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Nome do arquivo (exibido no cabeçalho e usado no export). */
  fileName: string;
  /** Carrega o conteúdo .docx atual do arquivo. */
  load: () => Promise<Blob>;
  /** Persiste o .docx editado. */
  save: (blob: Blob) => Promise<void>;
  /** Chamado após salvar com sucesso. */
  onSaved?: () => void;
  /** Rótulo do tipo de documento (ex.: "Principal", "Anexo", "Modelo MS"). */
  badge?: string;
}

/**
 * Editor de documentos .docx de templates usando o DocumentEditor do Syncfusion.
 * Reaproveitado por:
 *  - Documentos (template_files: principal e anexos)
 *  - Requerimentos (modelos MS — document_templates.file_path)
 */
const TemplateDocxEditorModal: React.FC<TemplateDocxEditorModalProps> = ({
  isOpen,
  onClose,
  fileName,
  load,
  save,
  onSaved,
  badge,
}) => {
  const editorRef = useRef<SyncfusionEditorRef>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadDocument = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setDirty(false);
      const blob = await load();
      const arrayBuffer = await blob.arrayBuffer();
      // Espera o editor criar antes de carregar — loadDocx enfileira internamente
      // mas garantimos que o ref existe.
      let tries = 0;
      while (!editorRef.current && tries < 40) {
        await new Promise((r) => setTimeout(r, 50));
        tries += 1;
      }
      await editorRef.current?.loadDocx(arrayBuffer, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o documento.');
    } finally {
      setLoading(false);
    }
  }, [load, fileName]);

  useEffect(() => {
    if (isOpen) {
      loadDocument();
    }
  }, [isOpen, loadDocument]);

  const handleSave = async () => {
    if (!editorRef.current) return;
    try {
      setSaving(true);
      setError(null);
      const blob = await editorRef.current.exportDocx(fileName);
      await save(blob);
      setDirty(false);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar o documento.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !confirm('Há alterações não salvas. Deseja fechar mesmo assim?')) return;
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) handleClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, saving, dirty]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-900/60 backdrop-blur-sm">
      <div className="m-2 sm:m-4 flex flex-1 flex-col overflow-hidden rounded-2xl bg-[#f8f7f5] shadow-2xl ring-1 ring-black/10">
        {/* Cabeçalho */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e7e5df] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-slate-900">Editar documento</h2>
                {badge && (
                  <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    {badge}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-slate-500">{fileName}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              aria-label="Fechar"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 sm:mx-6">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}

        {/* Corpo: editor */}
        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#f8f7f5]/80">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-7 w-7 animate-spin text-amber-600" />
                <span className="text-sm text-slate-600">Carregando documento...</span>
              </div>
            </div>
          )}
          <SyncfusionEditor
            ref={editorRef}
            id="template-docx-editor"
            height="100%"
            showPropertiesPane
            showNavigationPane={false}
            enableCustomContextMenu={false}
            onContentChange={() => setDirty(true)}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TemplateDocxEditorModal;
