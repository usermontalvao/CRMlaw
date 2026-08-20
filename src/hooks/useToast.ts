import { useState, useCallback } from 'react';
import type { Toast, ToastType } from '../components/Toast';
import { isNotifySoundMuted, playNotificationSound } from '../utils/notificationSound';

let toastCounter = 0;
const MAX_TOASTS = 3;

/**
 * QUAIS TOASTS TOCAM.
 *
 * Só os que dão notícia RUIM. O toast de sucesso é a confirmação de um clique
 * que a pessoa acabou de dar, com os olhos na tela — um "ding" a cada
 * salvamento vira o som que se desliga no primeiro dia, e leva junto os avisos
 * que importam. O de erro e o de aviso são diferentes: eles aparecem no rodapé
 * enquanto a pessoa já foi olhar outra coisa, e sumir sem ser visto é o
 * comportamento normal deles.
 *
 * O toque é o mesmo `alert` da chamada perdida e do canal fora do ar: duas
 * notas descendo. É a família "isto não avançou", e ela não precisa de um som
 * por módulo.
 */
const TOCAM: ReadonlySet<ToastType> = new Set<ToastType>(['error', 'warning']);

/**
 * Erro em rajada toca uma vez.
 *
 * Uma tela que falha ao carregar dispara três ou quatro toasts no mesmo
 * segundo — e o que a pessoa precisa ouvir é "deu erro", não quantos.
 */
const INTERVALO_DE_TOQUE_MS = 2_000;
let ultimoToque = 0;

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
        action?: { label: string; onClick: () => void; icon?: React.ReactNode };
      }
    ) => {
      const id = `toast-${++toastCounter}-${Date.now()}`;
      
      // Durações inteligentes por tipo
      let defaultDuration = 10000;
      if (type === 'loading') defaultDuration = 0;
      else if (type === 'success') defaultDuration = 10000;
      else if (type === 'error') defaultDuration = 10000;
      
      if (TOCAM.has(type) && !isNotifySoundMuted()) {
        const agora = Date.now();
        if (agora - ultimoToque > INTERVALO_DE_TOQUE_MS) {
          ultimoToque = agora;
          playNotificationSound('alert');
        }
      }

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
