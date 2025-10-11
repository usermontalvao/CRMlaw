import { useState, useEffect, useCallback } from 'react';
import { useCache } from '../contexts/CacheContext';

// Hook para buscar dados com cache
export function useCachedData<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  options?: {
    enabled?: boolean;
  }
) {
  const { getCache, setCache } = useCache();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    // Verificar cache primeiro
    const cachedData = getCache<T>(cacheKey);
    if (cachedData) {
      setData(cachedData);
      setIsLoading(false);
      return;
    }

    // Buscar dados
    try {
      setIsLoading(true);
      const result = await fetchFn();
      setData(result);
      setCache(cacheKey, result);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [cacheKey, fetchFn, getCache, setCache]);

  useEffect(() => {
    if (options?.enabled !== false) {
      fetchData();
    }
  }, [fetchData, options?.enabled]);

  return { data, isLoading, error, refetch: fetchData };
}

// Hook para mutação com invalidação de cache
export function useCachedMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: {
    onSuccess?: (data: TData) => void;
    invalidateKeys?: string[];
  }
) {
  const { invalidateCache } = useCache();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(async (variables: TVariables) => {
    try {
      setIsPending(true);
      setError(null);
      const result = await mutationFn(variables);
      
      // Invalidar cache
      if (options?.invalidateKeys) {
        invalidateCache(options.invalidateKeys);
      }
      
      // Callback de sucesso
      if (options?.onSuccess) {
        options.onSuccess(result);
      }
      
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [mutationFn, invalidateCache, options]);

  return { mutate, isPending, error };
}
