import { useCallback, useEffect, useState } from 'react';
import { nextcloudService } from '../services/nextcloud.service';

/**
 * useNextcloudLocks
 * -----------------------------------------------------------------------------
 * Presença de edição ("quem está editando"): carrega os locks ativos, assina o
 * realtime e reavalia a expiração periodicamente. Isolado do resto do
 * explorador (não depende da navegação nem da listagem atual).
 *
 * Retorna um mapa `caminho -> [{ id, name }]` e uma função para recarregar.
 */
export type NextcloudLockMap = Record<string, Array<{ id: string; name: string }>>;

export function useNextcloudLocks() {
  const [locks, setLocks] = useState<NextcloudLockMap>({});

  const reloadLocks = useCallback(async () => {
    try {
      const rows = await nextcloudService.listLocks();
      const map: NextcloudLockMap = {};
      for (const r of rows) (map[r.path] ||= []).push({ id: r.user_id, name: r.user_name || 'Alguém' });
      setLocks(map);
    } catch { /* presença é opcional */ }
  }, []);

  useEffect(() => {
    reloadLocks();
    const unsub = nextcloudService.subscribeLocks(reloadLocks);
    const iv = window.setInterval(reloadLocks, 60_000); // reavalia expiração dos locks
    return () => { unsub(); window.clearInterval(iv); };
  }, [reloadLocks]);

  return { locks, reloadLocks };
}
