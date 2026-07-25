import { useCallback, useState } from 'react';
import type { NextcloudEntry } from '../services/nextcloud.service';

/**
 * useNextcloudClipboard
 * -----------------------------------------------------------------------------
 * Dono do estado da área de transferência do explorador (recortar/copiar).
 * Fonte única de verdade para o que está "na área" e em qual modo. A lógica de
 * COLAR (que fala com o servidor) permanece no componente, pois orquestra
 * confirmação de movimento, resolução de conflito e recarga da lista.
 *
 * `onNotify` recebe mensagens curtas (ex.: para um toast) sem acoplar o hook à
 * UI de notificação.
 */
export interface NextcloudClipboardState {
  mode: 'copy' | 'cut';
  entries: NextcloudEntry[];
}

export function useNextcloudClipboard(onNotify?: (message: string) => void) {
  const [clipboard, setClipboard] = useState<NextcloudClipboardState | null>(null);

  const isCut = useCallback(
    (path: string) => clipboard?.mode === 'cut' && clipboard.entries.some((e) => e.path === path),
    [clipboard],
  );

  const copyEntries = useCallback((list: NextcloudEntry[]) => {
    if (!list.length) return;
    setClipboard({ mode: 'copy', entries: list });
    onNotify?.(`${list.length} item(ns) copiado(s). Cole com Ctrl+V.`);
  }, [onNotify]);

  const cutEntries = useCallback((list: NextcloudEntry[]) => {
    if (!list.length) return;
    setClipboard({ mode: 'cut', entries: list });
    onNotify?.(`${list.length} item(ns) recortado(s). Cole com Ctrl+V.`);
  }, [onNotify]);

  const clearClipboard = useCallback(() => setClipboard(null), []);

  return { clipboard, setClipboard, isCut, copyEntries, cutEntries, clearClipboard };
}
