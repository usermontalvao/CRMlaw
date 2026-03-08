import { useCallback, useState } from 'react';

export const useSelectionState = <T extends string | number>() => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());

  const enableSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const disableSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);

  const toggleSelectedId = useCallback((id: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectIds = useCallback((ids: Iterable<T>) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelectedIds = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const replaceSelection = useCallback((ids: Iterable<T>, options?: { enableSelectionMode?: boolean }) => {
    setSelectedIds(new Set(ids));
    if (options?.enableSelectionMode) {
      setSelectionMode(true);
    }
  }, []);

  const pruneSelectedIds = useCallback((allowedIds: Iterable<T>) => {
    const allowed = new Set(allowedIds);
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set<T>();
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
      }
      return next;
    });
  }, []);

  return {
    selectionMode,
    selectedIds,
    setSelectionMode,
    setSelectedIds,
    enableSelectionMode,
    disableSelectionMode,
    toggleSelectionMode,
    toggleSelectedId,
    selectIds,
    clearSelectedIds,
    replaceSelection,
    pruneSelectedIds,
  };
};
