// Larguras das colunas (lista de conversas + painel do contato) com persistência
// local e divisórias arrastáveis. Extraído do WhatsAppModule para isolar o
// comportamento de layout do módulo (Fase 10.1).
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const PANEL_MIN = 260;
const PANEL_MAX = 560;
const PANEL_DEFAULT = 300;
// Abaixo disto o cabeçalho da lista (título + status + ações + "nova conversa")
// não cabe em uma linha e os botões da ponta saem cortados na borda da coluna.
const LIST_MIN = 312;
const LIST_MAX = 520;
const LIST_DEFAULT = 340;

export interface ResizableLayout {
  /** Largura do painel lateral do contato (px). */
  panelWidth: number;
  /** Largura da lista de conversas (px). */
  listWidth: number;
  /** Handler de pointerdown na divisória do painel (à direita). */
  startPanelResize: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Handler de pointerdown na divisória da lista (à esquerda). */
  startListResize: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * Gerencia as larguras redimensionáveis da lista e do painel do contato,
 * persistindo cada uma em localStorage. Arrastar a borda atualiza ao vivo
 * (entre os limites min/max); o valor sobrevive ao recarregar a página.
 */
export function useResizableLayout(): ResizableLayout {
  const [panelWidth, setPanelWidth] = useState(() => {
    const v = Number(localStorage.getItem('wa_panel_w'));
    return v >= PANEL_MIN && v <= PANEL_MAX ? v : PANEL_DEFAULT;
  });
  const [listWidth, setListWidth] = useState(() => {
    const v = Number(localStorage.getItem('wa_list_w'));
    return v >= LIST_MIN && v <= LIST_MAX ? v : LIST_DEFAULT;
  });
  useEffect(() => { localStorage.setItem('wa_panel_w', String(panelWidth)); }, [panelWidth]);
  useEffect(() => { localStorage.setItem('wa_list_w', String(listWidth)); }, [listWidth]);

  // Durante o arraste, a largura é aplicada diretamente no elemento e no
  // máximo uma vez por frame. Atualizar o estado do WhatsAppModule em cada
  // pixel repintava mensagens, listas e todo o painel 360º, causando lag.
  const activeResizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => activeResizeCleanup.current?.(), []);

  const beginResize = useCallback((options: {
    event: ReactPointerEvent<HTMLDivElement>;
    targetSelector: string;
    currentWidth: number;
    min: number;
    max: number;
    direction: 1 | -1;
    commit: (width: number) => void;
  }) => {
    const { event, targetSelector, currentWidth, min, max, direction, commit } = options;
    if (event.button !== 0) return;

    const target = event.currentTarget.parentElement?.querySelector<HTMLElement>(targetSelector);
    if (!target) return;

    event.preventDefault();
    activeResizeCleanup.current?.();

    const pointerId = event.pointerId;
    const resizeHandle = event.currentTarget;
    const startX = event.clientX;
    let nextWidth = currentWidth;
    let animationFrame = 0;
    let finished = false;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    const previousTransition = target.style.transition;
    const previousWillChange = target.style.willChange;

    // A transição é ótima para recolher pela seta, mas precisa ficar desligada
    // enquanto a borda acompanha o ponteiro, senão o painel persegue o mouse.
    target.style.transition = 'none';
    target.style.willChange = 'width';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    resizeHandle.setPointerCapture?.(pointerId);

    const applyWidth = () => {
      animationFrame = 0;
      target.style.width = `${nextWidth}px`;
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const delta = (moveEvent.clientX - startX) * direction;
      nextWidth = Math.min(max, Math.max(min, currentWidth + delta));
      if (!animationFrame) animationFrame = window.requestAnimationFrame(applyWidth);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      target.style.transition = previousTransition;
      target.style.willChange = previousWillChange;
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (resizeHandle.hasPointerCapture?.(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      activeResizeCleanup.current = null;
    };

    const finish = (finishEvent?: PointerEvent | Event) => {
      if (finished) return;
      if (finishEvent instanceof PointerEvent && finishEvent.pointerId !== pointerId) return;
      finished = true;
      // Usa também a posição do pointerup. Navegadores podem agrupar eventos de
      // movimento e o último pixel não necessariamente chega como pointermove.
      if (finishEvent instanceof PointerEvent) {
        const delta = (finishEvent.clientX - startX) * direction;
        nextWidth = Math.min(max, Math.max(min, currentWidth + delta));
      }
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      target.style.width = `${nextWidth}px`;
      cleanup();
      // Uma única atualização React ao final mantém persistência e props em dia.
      commit(nextWidth);
    };

    activeResizeCleanup.current = cleanup;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  }, []);

  // Redimensiona o painel lateral arrastando a borda (entre 260 e 560px).
  const startPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    beginResize({
      event,
      targetSelector: '[data-testid="whatsapp-details-panel"]',
      currentWidth: panelWidth,
      min: PANEL_MIN,
      max: PANEL_MAX,
      direction: -1,
      commit: setPanelWidth,
    });
  }, [beginResize, panelWidth]);

  // Divisória arrastável entre a lista de conversas e a thread (Fase 10.1).
  const startListResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    beginResize({
      event,
      targetSelector: '[data-testid="whatsapp-conversation-list"]',
      currentWidth: listWidth,
      min: LIST_MIN,
      max: LIST_MAX,
      direction: 1,
      commit: setListWidth,
    });
  }, [beginResize, listWidth]);

  return { panelWidth, listWidth, startPanelResize, startListResize };
}
