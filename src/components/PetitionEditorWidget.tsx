/**
 * PetitionEditorWidget - Widget flutuante global para o Editor de Petições
 * Pode ser aberto de qualquer módulo sem trocar de rota
 * Persiste estado (aberto/minimizado) em localStorage
 */

import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, FileText, Maximize2 } from 'lucide-react';
import { events, SYSTEM_EVENTS } from '../utils/events';
import type { Client } from '../types/client.types';

const PetitionEditorModule = lazy(() => import('./PetitionEditorModule'));

// Storage keys
const WIDGET_STATE_KEY = 'petition-editor-widget-state';
const WIDGET_CLIENT_KEY = 'petition-editor-widget-client';

const PETITION_EDITOR_WIDGET_STATE_EVENT = 'crm:petition_editor_widget_state';

export interface PetitionEditorOpenPayload {
  clientId?: string;
  client?: Client;
  petitionId?: string;
  mode?: 'new' | 'continue';
}

type WidgetState = 'closed' | 'open' | 'minimized';

interface PersistedState {
  state: WidgetState;
  clientId?: string;
  petitionId?: string;
}

const PetitionEditorWidget: React.FC = () => {
  const [widgetState, setWidgetState] = useState<WidgetState>('closed');
  const [pendingPayload, setPendingPayload] = useState<PetitionEditorOpenPayload | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasChatLauncher, setHasChatLauncher] = useState(false);

  // Restaurar estado do localStorage ao montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WIDGET_STATE_KEY);
      if (saved) {
        const parsed: PersistedState = JSON.parse(saved);
        // Restaurar estado minimizado ou aberto
        if (parsed.state === 'minimized' || parsed.state === 'open') {
          setWidgetState(parsed.state);
          // Restaurar payload se existir
          if (parsed.clientId || parsed.petitionId) {
            setPendingPayload({
              clientId: parsed.clientId,
              petitionId: parsed.petitionId,
              mode: parsed.petitionId ? 'continue' : 'new',
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
      const toSave: PersistedState = {
        state: widgetState,
        clientId: pendingPayload?.clientId,
        petitionId: pendingPayload?.petitionId,
      };
      localStorage.setItem(WIDGET_STATE_KEY, JSON.stringify(toSave));
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
        },
      });
      window.dispatchEvent(ev);
    } catch {
      // ignore
    }
  }, [widgetState, hasUnsavedChanges, pendingPayload?.clientId, pendingPayload?.petitionId]);

  useEffect(() => {
    const update = () => {
      setHasChatLauncher(!!document.querySelector('[data-chat-floating-widget-launcher="1"]'));
    };

    update();

    const obs = new MutationObserver(() => update());
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      obs.disconnect();
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
            ? 'fixed inset-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col opacity-0 pointer-events-none'
            : 'fixed inset-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col'
        }
        style={{ isolation: 'isolate' }}
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
              onUnsavedChanges={handleUnsavedChanges}
              onRequestClose={handleClose}
              onRequestMinimize={handleMinimize}
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
