import React, { createContext, useContext } from 'react';
import { useToast } from '../hooks/useToast';
import { ToastContainer, type ToastType } from '../components/Toast';

interface ToastContextType {
  // Forma de baixo nível: permite ações clicáveis (action) no toast.
  toast: (
    type: ToastType,
    message: string,
    options?: { description?: string; duration?: number; action?: { label: string; onClick: () => void } },
  ) => string;
  success: (message: string, description?: string) => string;
  error: (message: string, description?: string) => string;
  warning: (message: string, description?: string) => string;
  info: (message: string, description?: string) => string;
  loading: (message: string, description?: string) => string;
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: any) => string);
    }
  ) => Promise<T>;
  dismiss: (id: string) => void;
}

// HMR-stable: durante o desenvolvimento, editar este arquivo (ou algo na sua
// cadeia de imports) faz o Vite re-avaliar o módulo. Como o arquivo exporta
// tanto um componente (ToastProvider) quanto um hook (useToastContext), ele não
// é uma fronteira válida de Fast Refresh, e cada re-avaliação criaria um NOVO
// objeto de contexto. Isso faz um Provider já montado segurar o contexto antigo
// enquanto consumidores re-renderizados leem o novo → useContext retorna
// undefined e o hook lança "must be used within ToastProvider" mesmo estando
// dentro da árvore. Persistir o objeto em globalThis garante uma única instância
// estável entre re-avaliações. Inócuo em produção.
const __toastCtxKey = '__crm_ToastContext__';
const ToastContext: React.Context<ToastContextType | undefined> =
  (globalThis as any)[__toastCtxKey] ??
  ((globalThis as any)[__toastCtxKey] = createContext<ToastContextType | undefined>(undefined));

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismiss} />
    </ToastContext.Provider>
  );
};

export const useToastContext = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used within ToastProvider');
  }
  return context;
};
