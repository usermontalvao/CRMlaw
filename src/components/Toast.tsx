import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, AlertCircle, Info, X, Loader2, MessageCircle } from 'lucide-react';
import { zc } from '../styles/layers';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'whatsapp';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    if (toast.type !== 'loading' && toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.type, toast.duration, handleDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
            <CheckCircle className="h-[18px] w-[18px]" />
          </div>
        );
      case 'error':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
            <XCircle className="h-[18px] w-[18px]" />
          </div>
        );
      case 'warning':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <AlertCircle className="h-[18px] w-[18px]" />
          </div>
        );
      case 'info':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#185abd]">
            <Info className="h-[18px] w-[18px]" />
          </div>
        );
      case 'loading':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          </div>
        );
      case 'whatsapp':
        return (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-emerald-50 text-[#1da851]">
            <MessageCircle className="h-[18px] w-[18px]" />
          </div>
        );
    }
  };

  const getStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'border-l-emerald-500';
      case 'error':
        return 'border-l-red-500';
      case 'warning':
        return 'border-l-amber-500';
      case 'info':
        return 'border-l-[#185abd]';
      case 'loading':
        return 'border-l-slate-400';
      case 'whatsapp':
        return 'border-l-[#25D366]';
    }
  };

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`${getStyles()} pointer-events-auto relative mb-2 w-[min(calc(100vw-24px),25rem)] overflow-hidden rounded-lg border border-l-[3px] border-slate-200 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)] transition-all duration-300 ${
        isExiting ? 'translate-y-3 scale-[0.98] opacity-0' : 'translate-y-0 scale-100 opacity-100'
      }`}
      style={{
        animation: isExiting ? 'none' : 'toastIn 0.24s cubic-bezier(.2,.8,.2,1)',
      }}
    >
      <div className="flex items-center gap-2.5">
        {getIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-5 text-slate-800">{toast.message}</p>
          {toast.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{toast.description}</p>
          )}
        </div>
        {/* A ação fica fora da coluna de texto e com corpo de botão: como link
            de 11px embaixo da mensagem, passava despercebida no tempo que o
            toast fica na tela. */}
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition ${
              toast.type === 'whatsapp' ? 'bg-[#1da851] hover:bg-[#15803d]' : 'bg-[#185abd] hover:bg-[#124b9d]'
            }`}
          >
            {toast.action.icon}
            {toast.action.label}
          </button>
        )}
        {toast.type !== 'loading' && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar notificação"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {toast.type !== 'loading' && toast.duration && toast.duration > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-20"
          style={{ animation: `toastProgress ${toast.duration}ms linear forwards` }}
        />
      )}
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  const content = (
    <>
      <style>
        {`
          @keyframes toastIn {
            from {
              transform: translateY(12px) scale(.98);
              opacity: 0;
            }
            to {
              transform: translateY(0) scale(1);
              opacity: 1;
            }
          }

          @keyframes toastProgress {
            from {
              transform: scaleX(1);
            }
            to {
              transform: scaleX(0);
            }
          }
        `}
      </style>
      <div
        aria-live="polite"
        aria-atomic="false"
        className={`pointer-events-none fixed inset-x-0 bottom-11 ${zc.NOTICE} flex justify-center px-3`}
      >
        <div className="flex max-w-full flex-col items-center">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return content;
  }

  return createPortal(content, document.body);
};
