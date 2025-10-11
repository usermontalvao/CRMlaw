import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface CacheContextType {
  getCache: <T>(key: string) => T | null;
  setCache: <T>(key: string, data: T, ttl?: number) => void;
  invalidateCache: (key: string | string[]) => void;
  clearAllCache: () => void;
}

const CacheContext = createContext<CacheContextType | undefined>(undefined);

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutos

export function CacheProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<Map<string, CacheEntry<any>>>(new Map());

  const getCache = useCallback(<T,>(key: string): T | null => {
    const entry = cache.get(key);
    
    if (!entry) return null;
    
    // Verificar se expirou
    const now = Date.now();
    if (now - entry.timestamp > DEFAULT_TTL) {
      // Cache expirado, remover
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(key);
        return newCache;
      });
      return null;
    }
    
    return entry.data as T;
  }, [cache]);

  const setCacheData = useCallback(<T,>(key: string, data: T, ttl: number = DEFAULT_TTL) => {
    setCache(prev => {
      const newCache = new Map(prev);
      newCache.set(key, {
        data,
        timestamp: Date.now(),
      });
      return newCache;
    });
  }, []);

  const invalidateCache = useCallback((keys: string | string[]) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    
    setCache(prev => {
      const newCache = new Map(prev);
      keysArray.forEach(key => {
        // Suporta wildcards (ex: 'clients*' remove 'clients', 'clients-1', etc)
        if (key.endsWith('*')) {
          const prefix = key.slice(0, -1);
          Array.from(newCache.keys()).forEach(cacheKey => {
            if (cacheKey.startsWith(prefix)) {
              newCache.delete(cacheKey);
            }
          });
        } else {
          newCache.delete(key);
        }
      });
      return newCache;
    });
  }, []);

  const clearAllCache = useCallback(() => {
    setCache(new Map());
  }, []);

  return (
    <CacheContext.Provider value={{ getCache, setCache: setCacheData, invalidateCache, clearAllCache }}>
      {children}
    </CacheContext.Provider>
  );
}

export function useCache() {
  const context = useContext(CacheContext);
  if (!context) {
    throw new Error('useCache must be used within CacheProvider');
  }
  return context;
}
