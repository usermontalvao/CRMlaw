import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const sizeClassMap: Record<NonNullable<ClientModalProps['size']>, string> = {
  lg: 'max-w-3xl',
  xl: 'max-w-6xl w-[92vw]',
};

const ClientModal: React.FC<ClientModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'xl',
  footer,
  children,
}) => {
  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${sizeClassMap[size]} max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden`}
      >
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              {subtitle || 'Formulário'}
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">{children}</div>

        {footer && (
          <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default ClientModal;
