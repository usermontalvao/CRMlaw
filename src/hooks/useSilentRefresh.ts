import { useCallback, useEffect, useRef } from 'react';

interface UseSilentRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  isVisible?: () => boolean;
  onRefresh: (options?: { silent?: boolean }) => Promise<void> | void;
}

export const useSilentRefresh = ({
  enabled = true,
  intervalMs = 5000,
  isVisible,
  onRefresh,
}: UseSilentRefreshOptions) => {
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleRefresh = useCallback((delay = 250) => {
    if (!enabled) return;
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void onRefresh({ silent: true });
    }, delay);
  }, [enabled, onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const canRefresh = () => (isVisible ? isVisible() : true);

    const interval = window.setInterval(() => {
      if (canRefresh()) {
        void onRefresh({ silent: true });
      }
    }, intervalMs);

    const onFocus = () => {
      if (canRefresh()) {
        scheduleRefresh(0);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && canRefresh()) {
        scheduleRefresh(0);
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [enabled, intervalMs, isVisible, onRefresh, scheduleRefresh]);

  return {
    scheduleRefresh,
    refreshTimerRef,
  };
};
