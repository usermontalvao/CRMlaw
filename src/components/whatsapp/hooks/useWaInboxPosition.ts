// Memória de posição da inbox: qual conversa estava aberta e onde a lista
// estava rolada. Sem isso, voltar ao módulo (ou recarregar a página) devolvia o
// atendente ao topo, sem conversa aberta — e ele tinha que procurar de novo.
//
// Dois esquecimentos diferentes acontecem aqui:
//  1. Recarregar a página perde a seleção, que só vivia em memória.
//  2. Alternar de módulo NÃO desmonta o WhatsApp (o App o mantém vivo com
//     `display:none`), mas o navegador destrói a caixa de layout do elemento
//     escondido e zera o scrollTop junto. Ao voltar, a lista aparecia no topo.
import { useCallback, useEffect, useRef } from 'react';

const SELECTED_KEY = 'wa_selected_id';
const LIST_SCROLL_KEY = 'wa_list_scroll';

const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage indisponível */ }
};

/** Conversa aberta na última sessão (só no módulo cheio; o widget é efêmero). */
export function readStoredConversationId(enabled: boolean): string | null {
  return enabled ? read(SELECTED_KEY) : null;
}

export interface WaInboxPositionApi {
  /** Ref-callback do contêiner rolável da lista de conversas. */
  setListEl: (node: HTMLDivElement | null) => void;
  /** Handler de scroll da lista (grava a posição, sem re-render). */
  onListScroll: () => void;
}

/**
 * Persiste a conversa selecionada e a rolagem da lista, e restaura a rolagem
 * quando a lista volta a ficar visível.
 */
export function useWaInboxPosition(selectedId: string | null, enabled: boolean): WaInboxPositionApi {
  const listRef = useRef<HTMLDivElement | null>(null);
  const savedTopRef = useRef<number>(enabled ? Number(read(LIST_SCROLL_KEY)) || 0 : 0);

  useEffect(() => {
    if (!enabled) return;
    write(SELECTED_KEY, selectedId ?? '');
  }, [selectedId, enabled]);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    savedTopRef.current = el.scrollTop;
    if (enabled) write(LIST_SCROLL_KEY, String(el.scrollTop));
  }, [enabled]);

  const observerRef = useRef<ResizeObserver | null>(null);
  const setListEl = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    listRef.current = node;
    if (!node) return;
    const restore = () => {
      // `offsetParent === null` enquanto o módulo está escondido: restaurar ali
      // não teria efeito (o elemento não tem caixa de layout).
      if (node.offsetParent === null || savedTopRef.current <= 0) return;
      if (node.scrollHeight <= node.clientHeight) return; // ainda sem conteúdo
      node.scrollTop = savedTopRef.current;
    };
    restore();
    // A lista só ganha altura quando as conversas chegam (e quando o módulo
    // reaparece). Observar o elemento cobre os dois momentos sem timer.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => restore());
    ro.observe(node);
    observerRef.current = ro;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { setListEl, onListScroll };
}
