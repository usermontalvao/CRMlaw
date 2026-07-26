import type { EditorDocSource } from './editorDocSource';

export const EDITOR_DOC_SOURCE_SAVED_EVENT = 'crm-editor-doc-source-saved';
export const EDITOR_DOC_SOURCE_SAVED_STORAGE_KEY = 'crm-editor-doc-source-saved-v1';

export interface EditorDocSourceSavedDetail {
  source: EditorDocSource;
  savedAt: string;
  nonce: string;
}

export function announceEditorDocSourceSaved(source: EditorDocSource): void {
  if (typeof window === 'undefined') return;

  const detail: EditorDocSourceSavedDetail = {
    source,
    savedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };

  // CustomEvent atualiza o editor inline; storage atualiza as outras
  // abas/janelas da mesma origem (onde fica o Gerenciar Documentos).
  window.dispatchEvent(new CustomEvent<EditorDocSourceSavedDetail>(
    EDITOR_DOC_SOURCE_SAVED_EVENT,
    { detail },
  ));

  try {
    window.localStorage.setItem(
      EDITOR_DOC_SOURCE_SAVED_STORAGE_KEY,
      JSON.stringify(detail),
    );
  } catch {
    // A persistência principal já foi confirmada; a notificação visual é
    // best-effort e não deve transformar um save válido em erro.
  }
}

/**
 * Escuta "documento de origem externa salvo", venha o save desta mesma janela
 * (CustomEvent) ou da JANELA DEDICADA do editor (storage). Fonte única usada
 * por todo módulo que precisa recarregar sua lista depois do save.
 */
export function subscribeEditorDocSourceSaved(
  handler: (detail: EditorDocSourceSavedDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<EditorDocSourceSavedDetail>).detail;
    if (detail) handler(detail);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== EDITOR_DOC_SOURCE_SAVED_STORAGE_KEY) return;
    const detail = parseEditorDocSourceSavedDetail(event.newValue);
    if (detail) handler(detail);
  };

  window.addEventListener(EDITOR_DOC_SOURCE_SAVED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EDITOR_DOC_SOURCE_SAVED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

export function parseEditorDocSourceSavedDetail(
  value: string | null,
): EditorDocSourceSavedDetail | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<EditorDocSourceSavedDetail>;
    if (!parsed.source || typeof parsed.source !== 'object') return null;
    if (typeof parsed.savedAt !== 'string' || typeof parsed.nonce !== 'string') return null;
    return parsed as EditorDocSourceSavedDetail;
  } catch {
    return null;
  }
}
