/**
 * Gerenciamento de histórico de sincronizações DJEN
 */

export interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  itemsFound: number;
  itemsSaved: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  source: 'manual' | 'auto';
  success: boolean;
  errorMessage?: string;
}

const STORAGE_KEY = 'djen-sync-history';
const MAX_ENTRIES = 50; // Manter apenas últimas 50 sincronizações

/**
 * Adiciona uma entrada ao histórico
 */
export function addSyncHistory(entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'>): void {
  const history = getSyncHistory();
  
  const newEntry: SyncHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  // Adicionar no início e limitar tamanho
  const updatedHistory = [newEntry, ...history].slice(0, MAX_ENTRIES);
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
}

/**
 * Obtém todo o histórico
 */
export function getSyncHistory(): SyncHistoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Limpa todo o histórico
 */
export function clearSyncHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Obtém estatísticas do histórico
 */
export function getSyncStats(): {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalItemsSaved: number;
  lastSync: SyncHistoryEntry | null;
} {
  const history = getSyncHistory();
  
  return {
    totalSyncs: history.length,
    successfulSyncs: history.filter(h => h.success).length,
    failedSyncs: history.filter(h => !h.success).length,
    totalItemsSaved: history.reduce((sum, h) => sum + h.itemsSaved, 0),
    lastSync: history[0] || null,
  };
}
