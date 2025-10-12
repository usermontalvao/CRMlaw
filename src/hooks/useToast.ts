import { useState, useCallback } from 'react';
import type { Toast, ToastType } from '../components/Toast';

let toastCounter = 0;
const MAX_TOASTS = 3;

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (
      type: ToastType,
      message: string,
      options?: {
        description?: string;
        duration?: number;
        action?: { label: string; onClick: () => void };
      }
    ) => {
      const id = `toast-${++toastCounter}-${Date.now()}`;
      
      // Durações inteligentes por tipo
      let defaultDuration = 4000;
      if (type === 'loading') defaultDuration = 0;
      else if (type === 'success') defaultDuration = 3000;
      else if (type === 'error') defaultDuration = 5000;
      
      const newToast: Toast = {
        id,
        type,
        message,
        description: options?.description,
        duration: options?.duration ?? defaultDuration,
        action: options?.action,
      };

      setToasts((prev) => {
        const updated = [...prev, newToast];
        // Limitar a MAX_TOASTS (remove o mais antigo que não seja loading)
        if (updated.length > MAX_TOASTS) {
          const oldestNonLoading = updated.find(t => t.type !== 'loading');
          if (oldestNonLoading) {
            return updated.filter(t => t.id !== oldestNonLoading.id);
          }
        }
        return updated;
      });
      return id;
    },
    []
  );

  const success = useCallback(
    (message: string, description?: string) => {
      return toast('success', message, { description });
    },
    [toast]
  );

  const error = useCallback(
    (message: string, description?: string) => {
      return toast('error', message, { description });
    },
    [toast]
  );

  const warning = useCallback(
    (message: string, description?: string) => {
      return toast('warning', message, { description });
    },
    [toast]
  );

  const info = useCallback(
    (message: string, description?: string) => {
      return toast('info', message, { description });
    },
    [toast]
  );

  const loading = useCallback(
    (message: string, description?: string) => {
      return toast('loading', message, { description, duration: 0 });
    },
    [toast]
  );

  const promise = useCallback(
    async <T,>(
      promise: Promise<T>,
      messages: {
        loading: string;
        success: string | ((data: T) => string);
        error: string | ((error: any) => string);
      }
    ): Promise<T> => {
      const loadingId = loading(messages.loading);

      try {
        const result = await promise;
        dismiss(loadingId);
        const successMsg =
          typeof messages.success === 'function' ? messages.success(result) : messages.success;
        success(successMsg);
        return result;
      } catch (err: any) {
        dismiss(loadingId);
        const errorMsg = typeof messages.error === 'function' ? messages.error(err) : messages.error;
        error(errorMsg);
        throw err;
      }
    },
    [loading, success, error, dismiss]
  );

  return {
    toasts,
    toast,
    success,
    error,
    warning,
    info,
    loading,
    promise,
    dismiss,
  };
};
