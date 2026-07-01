import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Save, AlertCircle, FileText, FolderOpen, ArrowLeft } from 'lucide-react';
import { saveAs } from 'file-saver';
import PetitionRibbon from './PetitionRibbon';
import SyncfusionEditor, { SyncfusionEditorRef } from './SyncfusionEditor';

interface TemplateDocxEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  load: () => Promise<Blob>;
  save: (blob: Blob) => Promise<void>;
  onSaved?: () => void;
  badge?: string;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorReady, setEditorReady] = useState(false);

  const loadDocxWithFallback = useCallback(async (arrayBuffer: ArrayBuffer, targetFileName: string) => {
    if (!editorRef.current) return;
    try {
      await editorRef.current.loadDocx(arrayBuffer, targetFileName);
    } catch (primaryError) {
      try {
        await editorRef.current.loadDocxViaImport(arrayBuffer, targetFileName);
      } catch {
        throw primaryError;
      }
    }
  }, []);

  const loadDocument = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setDirty(false);
      const blob = await load();
      const arrayBuffer = await blob.arrayBuffer();
      let tries = 0;
      while (!editorRef.current && tries < 40) {
        await new Promise((r) => setTimeout(r, 50));
        tries += 1;
      }
      await loadDocxWithFallback(arrayBuffer, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar o documento.');
    } finally {
      setLoading(false);
    }
  }, [fileName, load, loadDocxWithFallback]);

  useEffect(() => {
    if (isOpen) {
      void loadDocument();
    }
  }, [isOpen, loadDocument]);

  const handleSave = useCallback(async () => {
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
  }, [fileName, onClose, onSaved, save]);

  const handleExportDocx = useCallback(async () => {
    if (!editorRef.current) return;
    try {
      setError(null);
      const blob = await editorRef.current.exportDocx(fileName);
      saveAs(blob, fileName.endsWith('.docx') ? fileName : `${fileName}.docx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar o documento.');
    }
  }, [fileName]);

  const handleClose = useCallback(() => {
    if (dirty && !confirm('Ha alteracoes nao salvas. Deseja fechar mesmo assim?')) return;
    onClose();
  }, [dirty, onClose]);

  const handleNewDocument = useCallback(() => {
    if (dirty && !confirm('Ha alteracoes nao salvas. Deseja criar um novo documento mesmo assim?')) return;
    editorRef.current?.clear?.();
    setDirty(true);
    setError(null);
  }, [dirty]);

  const handleOpenLocalDocx = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setLoading(true);
      setError(null);
      const arrayBuffer = await file.arrayBuffer();
      await loadDocxWithFallback(arrayBuffer, file.name);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao abrir o documento.');
    } finally {
      setLoading(false);
    }
  }, [loadDocxWithFallback]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) handleClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleClose, isOpen, saving]);

  const topContent = useMemo(
    () => (
      <>
        <div className="pet-top-group is-left">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="p-1.5 hover:bg-amber-100 rounded transition-colors text-slate-500 hover:text-amber-600 disabled:opacity-60"
            title="Voltar"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <FileText className="h-5 w-5" />
          </div>
          <div className="pet-top-grow min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-[15px] font-semibold text-slate-900">Editar documento</div>
              {badge ? (
                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  {badge}
                </span>
              ) : null}
            </div>
            <div className="truncate text-xs text-slate-500">{fileName}</div>
          </div>
        </div>

        <div className="pet-top-group is-center" />

        <div className="pet-top-group is-right">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#e7e5df] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            title="Abrir DOCX local"
          >
            <FolderOpen className="h-4 w-4" />
            <span>Abrir</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
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
      </>
    ),
    [badge, fileName, handleClose, handleSave, loading, saving]
  );

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#f8f7f5]">
      <input
        ref={fileInputRef}
        type="file"
        accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleOpenLocalDocx}
      />

      <PetitionRibbon
        editorRef={editorRef}
        ready={editorReady}
        topContent={topContent}
        onNew={handleNewDocument}
        onOpen={() => fileInputRef.current?.click()}
        onSave={() => {
          void handleSave();
        }}
        onExportDocx={() => {
          void handleExportDocx();
        }}
      />

      {error ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#f8f7f5]/80">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-7 w-7 animate-spin text-amber-600" />
              <span className="text-sm text-slate-600">Carregando documento...</span>
            </div>
          </div>
        ) : null}

        <SyncfusionEditor
          ref={editorRef}
          id="template-docx-editor"
          height="100%"
          enableToolbar={false}
          showPropertiesPane={false}
          showNavigationPane={false}
          enableCustomContextMenu={false}
          onReady={() => {
            setEditorReady(true);
            window.setTimeout(() => editorRef.current?.refresh?.(), 60);
            window.setTimeout(() => editorRef.current?.refresh?.(), 320);
          }}
          onContentChange={() => setDirty(true)}
        />
      </div>
    </div>,
    document.body
  );
};

export default TemplateDocxEditorModal;
