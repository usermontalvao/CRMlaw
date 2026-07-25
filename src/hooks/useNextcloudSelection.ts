import { useCallback, useState } from 'react';

/**
 * useNextcloudSelection
 * -----------------------------------------------------------------------------
 * Dono do ESTADO de seleção do explorador Nextcloud (fonte única de verdade):
 *   - `selected`: mapa caminho -> selecionado.
 *   - `selectionAnchorPath`: âncora para seleção por intervalo (Shift+clique).
 *   - `focusedEntryPath`: item com foco de teclado.
 *   - `toggleSelect`: alterna um item.
 *
 * A orquestração de alto nível (selecionar por intervalo, marquee, limpar)
 * permanece no componente, usando os setters expostos aqui — assim o estado
 * fica centralizado sem quebrar as interações existentes.
 */
export interface NextcloudSelectionInit {
  selectedPaths?: string[];
  selectionAnchorPath?: string | null;
  focusedEntryPath?: string | null;
}

export function useNextcloudSelection(init: NextcloudSelectionInit) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((init.selectedPaths || []).map((p) => [p, true])),
  );
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(
    init.selectionAnchorPath ?? null,
  );
  const [focusedEntryPath, setFocusedEntryPath] = useState<string | null>(
    init.focusedEntryPath ?? null,
  );

  const toggleSelect = useCallback((p: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[p]) delete next[p];
      else next[p] = true;
      return next;
    });
  }, []);

  return {
    selected,
    setSelected,
    selectionAnchorPath,
    setSelectionAnchorPath,
    focusedEntryPath,
    setFocusedEntryPath,
    toggleSelect,
  };
}
