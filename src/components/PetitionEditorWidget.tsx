/**
 * PetitionEditorWidget - Widget flutuante global para o Editor de Petições
 * Pode ser aberto de qualquer módulo sem trocar de rota
 * Persiste estado (aberto/minimizado) em localStorage
 */

import React, { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, FileText, Maximize2 } from 'lucide-react';
import {
  events,
  SYSTEM_EVENTS,
  PETITION_EDITOR_WIDGET_STATE_EVENT,
  PETITION_EDITOR_WIDGET_STATE_STORAGE_KEY as WIDGET_STATE_KEY,
} from '../utils/events';
import type { Client } from '../types/client.types';
import { isEditorAppLocation } from '../utils/editorAppRoute';
import type { EditorDocSource } from '../utils/editorDocSource';

const PetitionEditorModule = lazy(() => import('./PetitionEditorModule'));

/**
 * Onde o estado do widget é persistido.
 *
 * - CRM (editor inline): localStorage — sobrevive a reload/reabertura do CRM.
 * - Janela dedicada (/editor): sessionStorage — sobrevive ao RELOAD da janela,
 *   mas é exclusivo dela. Sem isso, todas as janelas do editor (e o CRM)
 *   compartilhariam a mesma chave: fechar a janela do editor com um template
 *   aberto faria o CRM reabrir esse template inline no próximo carregamento, e
 *   duas janelas do editor sobrescreveriam o estado uma da outra.
 */
const getWidgetStateStorage = (): Storage | null => {
  try {
    return isEditorAppLocation() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

export interface PetitionEditorOpenPayload {
  clientId?: string;
  client?: Client;
  petitionId?: string;
  mode?: 'new' | 'continue';
  initialDocumentBase64?: string;
  initialDocumentUrl?: string;
  initialDocumentName?: string;
  initialCloudFileId?: string;
  initialNextcloudPath?: string;
  docSource?: EditorDocSource;
  openRequestId?: string;
}

type WidgetState = 'closed' | 'open' | 'minimized';

interface PersistedState {
  state: WidgetState;
  clientId?: string;
  petitionId?: string;
  initialDocumentBase64?: string;
  initialDocumentUrl?: string;
  initialDocumentName?: string;
  initialCloudFileId?: string;
  initialNextcloudPath?: string;
  docSource?: EditorDocSource;
  openRequestId?: string;
}

const PetitionEditorWidget: React.FC = () => {
  const [widgetState, setWidgetState] = useState<WidgetState>('closed');
  const [pendingPayload, setPendingPayload] = useState<PetitionEditorOpenPayload | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasChatLauncher, setHasChatLauncher] = useState(false);
  // Verdadeiro quando esta aba foi aberta SÓ para o editor (via #editor-doc=).
  // Nesse caso, fechar o editor deve fechar a ABA inteira, não voltar ao CRM.
  const openedAsDedicatedTabRef = useRef(false);
  // Altura da taskbar de janelas flutuantes (z-[9999], acima deste widget):
  // o editor reserva esse espaço para a status bar não ficar encoberta.
  const [taskbarHeight, setTaskbarHeight] = useState(0);

  // Restaurar estado do localStorage ao montar
  useEffect(() => {
    try {
      const saved = getWidgetStateStorage()?.getItem(WIDGET_STATE_KEY) ?? null;
      if (saved) {
        const parsed: PersistedState = JSON.parse(saved);
        // Restaurar estado minimizado ou aberto
        if (parsed.state === 'minimized' || parsed.state === 'open') {
          setWidgetState(parsed.state);
          // Restaurar payload se existir. Inclui documentos do Nextcloud, que
          // só guardam o caminho (a object URL do blob morre no reload e é
          // reaberta pelo editor a partir de initialNextcloudPath).
          if (parsed.clientId || parsed.petitionId || parsed.initialNextcloudPath || parsed.initialDocumentUrl || parsed.initialDocumentBase64 || parsed.docSource) {
            setPendingPayload({
              clientId: parsed.clientId,
              petitionId: parsed.petitionId,
              mode: parsed.petitionId ? 'continue' : 'new',
              initialDocumentBase64: parsed.initialDocumentBase64,
              initialDocumentUrl: parsed.initialDocumentUrl,
              initialDocumentName: parsed.initialDocumentName,
              initialCloudFileId: parsed.initialCloudFileId,
              initialNextcloudPath: parsed.initialNextcloudPath,
              docSource: parsed.docSource,
              openRequestId: parsed.openRequestId,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao restaurar estado do widget:', e);
    }
  }, []);

  // Persistir estado no localStorage
  useEffect(() => {
    try {
      // Object URLs (blob:) não sobrevivem a um reload — não adianta persisti-las.
      // Documentos do Nextcloud são reabertos pelo editor via initialNextcloudPath.
      const persistedUrl = pendingPayload?.initialDocumentUrl?.startsWith('blob:')
        ? undefined
        : pendingPayload?.initialDocumentUrl;
      const toSave: PersistedState = {
        state: widgetState,
        clientId: pendingPayload?.clientId,
        petitionId: pendingPayload?.petitionId,
        initialDocumentBase64: pendingPayload?.initialDocumentBase64,
        initialDocumentUrl: persistedUrl,
        initialDocumentName: pendingPayload?.initialDocumentName,
        initialCloudFileId: pendingPayload?.initialCloudFileId,
        initialNextcloudPath: pendingPayload?.initialNextcloudPath,
        docSource: pendingPayload?.docSource,
        openRequestId: pendingPayload?.openRequestId,
      };
      getWidgetStateStorage()?.setItem(WIDGET_STATE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('Erro ao salvar estado do widget:', e);
    }
  }, [widgetState, pendingPayload]);

  useEffect(() => {
    try {
      const ev = new CustomEvent(PETITION_EDITOR_WIDGET_STATE_EVENT, {
        detail: {
          state: widgetState,
          hasUnsavedChanges,
          clientId: pendingPayload?.clientId,
          petitionId: pendingPayload?.petitionId,
          initialDocumentName: pendingPayload?.initialDocumentName,
          openRequestId: pendingPayload?.openRequestId,
        },
      });
      window.dispatchEvent(ev);
    } catch {
      // ignore
    }
  }, [widgetState, hasUnsavedChanges, pendingPayload?.clientId, pendingPayload?.petitionId, pendingPayload?.initialDocumentName, pendingPayload?.openRequestId]);

  useEffect(() => {
    const update = () => {
      setHasChatLauncher(!!document.querySelector('[data-chat-floating-widget-launcher="1"]'));
      const taskbar = document.querySelector<HTMLElement>('[data-app-taskbar="1"]');
      setTaskbarHeight(taskbar ? taskbar.offsetHeight : 0);
    };

    update();

    const obs = new MutationObserver(() => update());
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', update);

    return () => {
      obs.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Handlers para eventos
  const handleOpen = useCallback((payload?: PetitionEditorOpenPayload) => {
    setPendingPayload(payload || null);
    setWidgetState('open');
  }, []);

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirm = window.confirm('Você tem alterações não salvas. Deseja realmente fechar o editor?');
      if (!confirm) return;
    }
    // Aba dedicada (aberta em nova aba só para editar): fecha a aba inteira.
    if (openedAsDedicatedTabRef.current) {
      try {
        window.close();
      } catch {
        // ignore
      }
      // Se o navegador não fechar a aba (ex.: não foi aberta por script), cai no
      // fechamento normal para não deixar o editor travado.
    }
    setWidgetState('closed');
    setPendingPayload(null);
    setHasUnsavedChanges(false);
  }, [hasUnsavedChanges]);

  const handleMinimize = useCallback(() => {
    setWidgetState('minimized');
  }, []);

  const handleMaximize = useCallback(() => {
    setWidgetState('open');
  }, []);

  // Escutar eventos globais
  useEffect(() => {
    const unsubOpen = events.on(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, handleOpen);
    const unsubClose = events.on(SYSTEM_EVENTS.PETITION_EDITOR_CLOSE, handleClose);
    const unsubMinimize = events.on(SYSTEM_EVENTS.PETITION_EDITOR_MINIMIZE, handleMinimize);
    const unsubMaximize = events.on(SYSTEM_EVENTS.PETITION_EDITOR_MAXIMIZE, handleMaximize);

    return () => {
      unsubOpen();
      unsubClose();
      unsubMinimize();
      unsubMaximize();
    };
  }, [handleOpen, handleClose, handleMinimize, handleMaximize]);

  // Abertura em NOVA ABA: quando o navegador de arquivos do Nextcloud abre um
  // documento em outra aba, ele grava o payload no localStorage sob um token e
  // navega para #editor-doc=<token>. Aqui detectamos o token, lemos o payload,
  // abrimos o editor e limpamos o hash (para não reabrir em reloads).
  useEffect(() => {
    try {
      const match = window.location.hash.match(/editor-doc=([\w-]+)/);
      if (!match) return;
      const token = match[1];
      const key = `petition-editor-open:${token}`;
      const raw = localStorage.getItem(key);
      localStorage.removeItem(key);
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        // ignore
      }
      if (!raw) return;
      const payload = JSON.parse(raw) as PetitionEditorOpenPayload;
      handleOpen(payload);
    } catch (e) {
      console.warn('Erro ao abrir editor a partir do token da URL:', e);
    }
  }, [handleOpen]);

  // App dedicado "Editor" (PWA instalável, start_url = /editor): ao montar nesta
  // rota, abrimos o editor automaticamente e o marcamos como janela dedicada.
  // Usamos o CAMINHO /editor (não hash) para o PWA ter escopo próprio. NÃO
  // alteramos a URL — assim um reload (ou reabrir o app instalado) sempre reabre
  // o editor. Se houver um rascunho restaurado do localStorage, ele é mantido;
  // senão, abre em branco.
  useEffect(() => {
    if (!isEditorAppLocation()) return;
    openedAsDedicatedTabRef.current = true;
    setWidgetState('open');
  }, []);

  // Callback para o editor informar mudanças não salvas
  const handleUnsavedChanges = useCallback((hasChanges: boolean) => {
    setHasUnsavedChanges(hasChanges);
  }, []);

  // Não renderizar nada se fechado
  if (widgetState === 'closed') {
    return null;
  }

  const isMinimized = widgetState === 'minimized';

  return createPortal(
    <>
      <div
        className={
          isMinimized
            ? 'fixed inset-x-0 top-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col opacity-0 pointer-events-none'
            : 'fixed inset-x-0 top-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col'
        }
        style={{ isolation: 'isolate', bottom: taskbarHeight }}
        aria-hidden={isMinimized}
      >
        <div className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-slate-50 dark:bg-slate-800">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 text-amber-600 animate-spin mx-auto mb-4" />
                  <p className="text-slate-600 dark:text-slate-300">Carregando editor...</p>
                </div>
              </div>
            }
          >
            <PetitionEditorModule
              isFloatingWidget={true}
              initialClientId={pendingPayload?.clientId}
              initialPetitionId={pendingPayload?.petitionId}
              initialDocumentBase64={pendingPayload?.initialDocumentBase64}
              initialDocumentUrl={pendingPayload?.initialDocumentUrl}
              initialDocumentName={pendingPayload?.initialDocumentName}
              initialCloudFileId={pendingPayload?.initialCloudFileId}
              initialNextcloudPath={pendingPayload?.initialNextcloudPath}
              initialDocSource={pendingPayload?.docSource}
              initialDocumentRequestId={pendingPayload?.openRequestId}
              onUnsavedChanges={handleUnsavedChanges}
              onRequestClose={handleClose}
              onRequestMinimize={handleMinimize}
              hideMinimize={isEditorAppLocation()}
            />
          </Suspense>
        </div>
      </div>

      {isMinimized && (
        !hasChatLauncher && (
          <button
            onClick={handleMaximize}
            className="fixed bottom-6 right-6 z-[9999] flex flex-col items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white rounded-full shadow-[0_20px_60px_rgba(234,88,12,0.45)] hover:shadow-[0_25px_70px_rgba(234,88,12,0.6)] hover:scale-110 transition-all duration-300 group"
            title="Abrir Editor de Petições"
          >
            <span className="absolute -inset-3 rounded-full bg-gradient-to-br from-orange-500/30 to-amber-500/20 blur-2xl opacity-80 group-hover:opacity-100 transition-opacity" aria-hidden />
            <FileText className="w-5 h-5 relative z-10" />
            <span className="text-[9px] font-bold mt-0.5 leading-none">Editor</span>
            {hasUnsavedChanges && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full ring-2 ring-white animate-pulse" title="Alterações não salvas" />
            )}
          </button>
        )
      )}
    </>,
    document.body
  );
};

export default PetitionEditorWidget;
