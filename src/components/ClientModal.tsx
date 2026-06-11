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
  xl: 'max-w-[1060px]',
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center px-0 py-0 sm:items-center sm:px-6 sm:py-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative ${sizeClassMap[size]} flex h-[100dvh] max-h-[100dvh] w-[calc(100vw-12px)] flex-col overflow-hidden rounded-t-[28px] border border-white/40 bg-[#f8f7f5]/80 shadow-2xl ring-1 ring-white/50 backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/80 dark:ring-white/10 sm:h-[96vh] sm:w-full sm:max-h-[1040px] sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#e7e5df]/60 bg-[#f8f7f5]/60 px-4 py-3 backdrop-blur-xl dark:border-zinc-800/60 dark:bg-zinc-900/60 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="w-1 h-7 bg-orange-500 rounded-full flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                {subtitle || 'Cliente'}
              </p>
              <h2 className="text-base font-bold leading-tight text-slate-800 dark:text-slate-200 sm:text-lg">{title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>

        {footer && (
          <div className="border-t border-[#e7e5df]/60 dark:border-zinc-800/60 bg-[#f8f7f5]/50 dark:bg-zinc-900/50 backdrop-blur-xl px-4 sm:px-6 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default ClientModal;
