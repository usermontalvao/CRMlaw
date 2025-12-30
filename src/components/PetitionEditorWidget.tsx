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
        <button
          onClick={handleMaximize}
          className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-2xl hover:shadow-amber-500/30 hover:scale-105 transition-all duration-200 group"
          title="Abrir Editor de Petições"
        >
          <FileText className="w-5 h-5" />
          <span className="font-semibold text-sm">Editor de Petições</span>
          {hasUnsavedChanges && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" title="Alterações não salvas" />
          )}
          <Maximize2 className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}
    </>,
    document.body
  );
};

export default PetitionEditorWidget;
