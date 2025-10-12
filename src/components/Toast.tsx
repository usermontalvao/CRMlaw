import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X, Loader2 } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
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
          <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
        );
      case 'error':
        return (
          <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5 text-white" />
          </div>
        );
      case 'warning':
        return (
          <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
        );
      case 'info':
        return (
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Info className="w-5 h-5 text-white" />
          </div>
        );
      case 'loading':
        return (
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
            <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
          </div>
        );
    }
  };

  const getStyles = () => {
    return 'bg-white shadow-lg rounded-lg border border-slate-200';
  };

  return (
    <div
      className={`${getStyles()} p-3 mb-2 min-w-[340px] max-w-md transition-all duration-300 ${
        isExiting ? 'opacity-0 transform scale-95' : 'opacity-100 transform scale-100'
      }`}
      style={{
        animation: isExiting ? 'none' : 'slideDown 0.3s ease-out',
      }}
    >
      <div className="flex items-center gap-3">
        {getIcon()}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900">{toast.message}</p>
          {toast.description && (
            <p className="text-xs text-slate-600 mt-0.5">{toast.description}</p>
          )}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 mt-1.5"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        {toast.type !== 'loading' && (
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-slate-600 transition flex-shrink-0 p-1 hover:bg-slate-100 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <>
      <style>
        {`
          @keyframes slideDown {
            from {
              transform: translateY(-100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          
          @keyframes shrink {
            from {
              width: 100%;
            }
            to {
              width: 0%;
            }
          }
        `}
      </style>
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-center">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
          ))}
        </div>
      </div>
    </>
  );
};
