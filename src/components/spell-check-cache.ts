/**
 * Cache de sugestões de spell-check
 *
 * Duas camadas:
 *   1. Map em memória — acesso em microssegundos, vive enquanto a aba está aberta
 *   2. localStorage    — persiste 7 dias entre sessões/reloads
 *
 * Chave: palavra em lowercase (case-insensitive)
 * Valor: { suggestions: string[], timestamp: number }
 *
 * Também suporta pre-fetch em background com throttle (3 paralelos, 200ms gap).
 */

const CACHE_PREFIX = 'spellCache:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_PARALLEL_PREFETCH = 3;
const PREFETCH_GAP_MS = 200;

const memCache = new Map<string, string[]>();
const pendingFetches = new Set<string>(); // evita requests duplicados em flight
const prefetchQueue: Array<{ word: string; fetcher: () => Promise<string[]> }> = [];
let activePrefetches = 0;

/**
 * Tenta obter sugestões em cache. Retorna null se ausente ou expirado.
 */
export function getCachedSuggestions(word: string): string[] | null {
  const key = word.toLowerCase();

  // Camada 1: memória
  const inMem = memCache.get(key);
  if (inMem) return inMem;

  // Camada 2: localStorage
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { suggestions: string[]; timestamp: number };
    if (Date.now() - parsed.timestamp > TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    memCache.set(key, parsed.suggestions); // hidrata memória
    return parsed.suggestions;
  } catch {
    return null;
  }
}

/**
 * Salva sugestões no cache (memória + localStorage).
 */
export function setCachedSuggestions(word: string, suggestions: string[]): void {
  const key = word.toLowerCase();
  memCache.set(key, suggestions);
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ suggestions, timestamp: Date.now() })
    );
  } catch {
    // QuotaExceededError ou storage desabilitado — ignora silenciosamente
  }
}

/**
 * Remove uma palavra do cache (útil quando usuário adiciona ao dicionário).
 */
export function invalidateCachedWord(word: string): void {
  const key = word.toLowerCase();
  memCache.delete(key);
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Limpa TODO o cache (memória + localStorage).
 * Útil para debug ou opção "Limpar cache" nas configurações.
 */
export function clearSpellCache(): void {
  memCache.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Limpa entradas expiradas do localStorage. Chame na inicialização.
 */
export function pruneExpiredEntries(): void {
  try {
    const now = Date.now();
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(CACHE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { timestamp: number };
        if (now - parsed.timestamp > TTL_MS) toRemove.push(k);
      } catch {
        toRemove.push(k); // entrada corrompida — remover
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Agenda pre-fetch de uma palavra em background.
 * Throttle: máximo 3 chamadas paralelas, 200ms entre cada início.
 *
 * @param word     Palavra a buscar
 * @param fetcher  Função que retorna a promise das sugestões (você fornece — pode ser callSpellChecker)
 */
export function schedulePrefetch(
  word: string,
  fetcher: () => Promise<string[]>
): void {
  const key = word.toLowerCase();
  if (memCache.has(key)) return; // já em cache de memória
  if (getCachedSuggestions(word) !== null) return; // já em localStorage
  if (pendingFetches.has(key)) return; // já em flight
  if (prefetchQueue.some((q) => q.word === key)) return; // já na fila

  prefetchQueue.push({ word: key, fetcher });
  drainPrefetchQueue();
}

function drainPrefetchQueue(): void {
  while (activePrefetches < MAX_PARALLEL_PREFETCH && prefetchQueue.length > 0) {
    const next = prefetchQueue.shift();
    if (!next) break;
    runPrefetch(next.word, next.fetcher);
    // Gap entre inícios para não saturar a API
    if (prefetchQueue.length > 0) {
      activePrefetches++; // reserva um slot para não disparar tudo de uma vez
      setTimeout(() => {
        activePrefetches--;
        drainPrefetchQueue();
      }, PREFETCH_GAP_MS);
      break;
    }
  }
}

function runPrefetch(word: string, fetcher: () => Promise<string[]>): void {
  pendingFetches.add(word);
  activePrefetches++;
  fetcher()
    .then((suggestions) => {
      setCachedSuggestions(word, suggestions);
    })
    .catch(() => {
      // Falha silenciosa em pre-fetch — vai re-tentar quando usuário clicar
    })
    .finally(() => {
      pendingFetches.delete(word);
      activePrefetches--;
      drainPrefetchQueue();
    });
}

/**
 * Estatísticas do cache para debug.
 */
export function getSpellCacheStats(): {
  memoryEntries: number;
  storageEntries: number;
  pendingFetches: number;
  queuedPrefetches: number;
} {
  let storageEntries = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) storageEntries++;
    }
  } catch {
    /* ignore */
  }
  return {
    memoryEntries: memCache.size,
    storageEntries,
    pendingFetches: pendingFetches.size,
    queuedPrefetches: prefetchQueue.length,
  };
}
