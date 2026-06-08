import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Largura máxima do modal */
  size?: ModalSize;
  /** Título no header */
  title: string;
  /** Rótulo acima do título (ex: "Formulário") */
  eyebrow?: string;
  /** Subtítulo abaixo do título */
  subtitle?: React.ReactNode;
  /** Ícone à esquerda do título */
  icon?: React.ReactNode;
  /** Conteúdo no header à direita do título */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  /** Footer com ações (botões Salvar/Cancelar) */
  footer?: React.ReactNode;
  /** z-index customizado */
  zIndex?: number;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
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
  // Fechar com Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Travar scroll do body quando aberto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
      <div
        className="fixed inset-0 flex items-center justify-center px-3 sm:px-6 py-4"
        style={{ zIndex }}
      >
        {/* Overlay */}
        <motion.div
          className="absolute inset-0 bg-black/45"
          onClick={onClose}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
        />

        {/* Container */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={[
            'relative w-full max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-xl ring-1 ring-black/8 dark:ring-white/8 flex flex-col overflow-hidden',
            sizeClasses[size],
          ].join(' ')}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.985 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
        {/* Barra de cor — marca visual do sistema */}
        <div className="h-1.5 w-full bg-amber-500 shrink-0" />

        {/* Header */}
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center shrink-0 text-white">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  {eyebrow}
                </p>
              )}
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">{title}</h2>
              {subtitle && (
                typeof subtitle === 'string'
                  ? <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>
                  : <div className="mt-0.5">{subtitle}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollável */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-5 sm:px-8 py-4 border-t border-slate-200 dark:border-zinc-800 shrink-0 bg-white dark:bg-zinc-900">
            {footer}
          </div>
        )}
        </motion.div>
      </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

/* ── ModalBody ── padding padrão do corpo ────────────────────────── */
export const ModalBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['p-5 sm:p-8', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);

/* ── ModalFooter ── alinha botões à direita ─────────────────────── */
export const ModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['flex items-center justify-end gap-3', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);
