import { useEffect, useRef, useState } from 'react';

/**
 * Mantém o estado de "carregando" ativo por um tempo mínimo, para que o
 * esqueleto (com a varredura de luz) não pisque e desapareça quando os dados
 * chegam quase instantaneamente (ex.: módulos com cache ou query rápida).
 *
 * @param loading estado real de carregamento
 * @param minMs   tempo mínimo que o esqueleto deve permanecer visível (ms)
 */
export function useMinLoading(loading: boolean, minMs = 900): boolean {
  const [visible, setVisible] = useState(loading);
  const startRef = useRef<number | null>(loading ? Date.now() : null);

  useEffect(() => {
    if (loading) {
      if (startRef.current == null) startRef.current = Date.now();
      setVisible(true);
      return;
    }
    if (startRef.current == null) {
      setVisible(false);
      return;
    }
    const elapsed = Date.now() - startRef.current;
    const remaining = Math.max(0, minMs - elapsed);
    const t = setTimeout(() => {
      startRef.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(t);
  }, [loading, minMs]);

  return visible;
}

export default useMinLoading;
