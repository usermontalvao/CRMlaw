// Larguras das colunas (lista de conversas + painel do contato) com persistência
// local e divisórias arrastáveis. Extraído do WhatsAppModule para isolar o
// comportamento de layout do módulo (Fase 10.1).
import { useCallback, useEffect, useState } from 'react';

const PANEL_MIN = 260;
const PANEL_MAX = 560;
const PANEL_DEFAULT = 300;
const LIST_MIN = 280;
const LIST_MAX = 520;
const LIST_DEFAULT = 340;

export interface ResizableLayout {
  /** Largura do painel lateral do contato (px). */
  panelWidth: number;
  /** Largura da lista de conversas (px). */
  listWidth: number;
  /** Handler de mousedown na divisória do painel (à direita). */
  startPanelResize: (e: React.MouseEvent) => void;
  /** Handler de mousedown na divisória da lista (à esquerda). */
  startListResize: (e: React.MouseEvent) => void;
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

  // Redimensiona o painel lateral arrastando a borda (entre 260 e 560px).
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent) => {
      // Painel fica à direita: arrastar p/ a esquerda aumenta a largura.
      setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // Divisória arrastável entre a lista de conversas e a thread (Fase 10.1).
  const startListResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    const onMove = (ev: MouseEvent) => {
      // Lista fica à esquerda: arrastar p/ a direita aumenta a largura.
      setListWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [listWidth]);

  return { panelWidth, listWidth, startPanelResize, startListResize };
}
