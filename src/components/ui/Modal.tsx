import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  title: string;
  eyebrow?: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  zIndex?: number;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  size = 'xl',
  title,
  eyebrow,
  subtitle,
  icon,
  headerActions,
  children,
  footer,
  zIndex = 80,
}) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 overflow-y-auto px-0 py-0 sm:px-6 sm:py-4" style={{ zIndex }}>
          <motion.div
            className="absolute inset-0 bg-black/45"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          />

          <div className="flex min-h-full items-end justify-center sm:items-center">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className={[
                'relative flex w-[calc(100vw-12px)] max-h-[100dvh] flex-col overflow-hidden bg-[#f8f7f5] shadow-xl ring-1 ring-black/8 dark:bg-zinc-900 dark:ring-white/8 sm:w-full',
                'rounded-t-[24px] sm:max-h-[92dvh] sm:rounded-2xl',
                sizeClasses[size],
              ].join(' ')}
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <div className="h-1.5 w-full shrink-0 bg-amber-500" />

              <div className="shrink-0 border-b border-[#e7e5df] px-4 py-4 dark:border-zinc-800 sm:px-8 sm:py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {icon && (
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                        {icon}
                      </div>
                    )}
                    <div className="min-w-0">
                      {eyebrow && (
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                          {eyebrow}
                        </p>
                      )}
                      <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white sm:text-lg">{title}</h2>
                      {subtitle && (
                        typeof subtitle === 'string'
                          ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:truncate">{subtitle}</p>
                          : <div className="mt-0.5">{subtitle}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {headerActions}
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Fechar"
                      className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {children}
              </div>

              {footer && (
                <div className="shrink-0 border-t border-[#e7e5df] bg-[#f8f7f5] px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900 sm:px-8 sm:py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export const ModalBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['p-4 sm:p-8', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);

export const ModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);
