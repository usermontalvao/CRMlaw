/**
 * Abre o EDITOR PRINCIPAL numa NOVA JANELA dedicada (/editor).
 *
 * Fonte única usada por TODOS os pontos que abrem o editor: Petições (janela em
 * branco), Nextcloud e origens externas (Templates, Petições Padrões,
 * Requerimentos MS, …). O documento vai por um TOKEN no localStorage — nunca na
 * URL. Se o popup for bloqueado, cai no editor inline (PETITION_EDITOR_OPEN).
 *
 * ⚠️ window.open precisa ser chamado DENTRO do clique (sem await antes), senão o
 *    navegador bloqueia o popup. Por isso o payload só carrega IDs: quem abre
 *    não faz nenhuma requisição antes de abrir a janela.
 *
 * A lista de pontos que usam isto está na memória [[editor-usage-map]].
 */
import { events, SYSTEM_EVENTS } from './events';
import type { EditorDocSource } from './editorDocSource';
import type { PetitionEditorOpenPayload } from '../components/PetitionEditorWidget';

const WINDOW_FEATURES = () => {
  const w = 1440, h = 900;
  const left = Math.max(0, Math.round(((window.screen?.availWidth || 1440) - w) / 2));
  const top = Math.max(0, Math.round(((window.screen?.availHeight || 900) - h) / 2));
  return `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
};

/**
 * Abre a janela do editor já carregando um documento.
 * O payload precisa ser 100% serializável (só IDs/strings): ele viaja pelo
 * localStorage e é relido no contexto da outra janela.
 */
export function openEditorWindowWithPayload(payload: PetitionEditorOpenPayload): void {
  try {
    const token = crypto.randomUUID();
    const key = `petition-editor-open:${token}`;
    localStorage.setItem(key, JSON.stringify(payload));
    const win = window.open(`/editor#editor-doc=${token}`, '_blank', WINDOW_FEATURES());
    if (!win) {
      // Popup bloqueado → abre inline no CRM.
      localStorage.removeItem(key);
      events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, payload);
    }
  } catch {
    events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, payload);
  }
}

/** Abre um documento de ORIGEM EXTERNA (template/petição padrão/…) no editor. */
export function openDocInEditorWindow(docSource: EditorDocSource, initialDocumentName: string): void {
  openEditorWindowWithPayload({
    mode: 'new',
    openRequestId: crypto.randomUUID(),
    docSource,
    initialDocumentName,
  });
}

/**
 * Abre o editor em branco (menu Petições). Usa uma janela NOMEADA: clicar de
 * novo foca a janela já aberta em vez de abrir outra e perder o rascunho.
 */
export function openBlankEditorWindow(): void {
  try {
    const win = window.open('/editor', 'jurius-editor', WINDOW_FEATURES());
    if (win) win.focus();
    else events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN);
  } catch {
    events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN);
  }
}
