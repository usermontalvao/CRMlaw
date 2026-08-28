import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { LAYER } from '../../styles/layers';
import { useModalLayer } from '../../styles/modalLayer';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

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
  /**
   * A camada. O padrão é `LAYER.MODAL`, que é onde vive todo modal de módulo;
   * um modal aberto DE DENTRO de outro passa `LAYER.MODAL_NESTED`. Números
   * soltos aqui foram o começo da corrida que `styles/layers` encerrou.
   *
   * Dentro do widget flutuante de conversas o valor é traduzido para a faixa
   * dele (ver `styles/modalLayer`): o mesmo modal, aberto de lá de dentro,
   * precisa ficar acima do widget que o abriu.
   */
  zIndex?: number;
  accentBarClassName?: string;
  iconContainerClassName?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
  '2xl': 'max-w-3xl',
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
  zIndex: zIndexProp,
  accentBarClassName = 'bg-amber-500',
  iconContainerClassName = 'bg-amber-500 text-white',
}) => {
  const zIndex = useModalLayer(zIndexProp ?? LAYER.MODAL);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // Esc fecha SÓ O MODAL DO TOPO — a pilha é do CRM inteiro (useEscapeLayer).
  useEscapeLayer(open, onClose);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Foco inicial ao abrir + restauração ao fechar (acessibilidade).
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const node = dialogRef.current;
    if (node) {
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusables[0] ?? node).focus({ preventScroll: true });
    }
    return () => { previousFocusRef.current?.focus?.({ preventScroll: true }); };
  }, [open]);

  // Focus trap: Tab/Shift+Tab ciclam apenas dentro do diálogo.
  const handleTabTrap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) { e.preventDefault(); node.focus(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const motionTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.16, ease: 'easeOut' as const };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 overflow-y-auto px-0 py-0 sm:px-6 sm:py-4" style={{ zIndex }}>
          <motion.div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[3px]"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.14, ease: 'easeOut' }}
          />

          <div className="flex min-h-full items-end justify-center sm:items-center">
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              tabIndex={-1}
              onKeyDown={handleTabTrap}
              className={[
                'relative flex w-[calc(100vw-12px)] max-h-[100dvh] flex-col overflow-hidden bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)] ring-1 ring-black/10 outline-none dark:bg-zinc-900 dark:ring-white/10 sm:w-full',
                'rounded-t-2xl sm:max-h-[92dvh] sm:rounded-2xl',
                sizeClasses[size],
              ].join(' ')}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
              animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
              transition={motionTransition}
            >
              <div className={['h-1.5 w-full shrink-0', accentBarClassName].join(' ')} />

              <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {icon && (
                      <div className={['mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center', iconContainerClassName].join(' ')}>
                        {icon}
                      </div>
                    )}
                    <div className="min-w-0">
                      {eyebrow && (
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                          {eyebrow}
                        </p>
                      )}
                      <h2 className="truncate text-[14px] font-semibold text-slate-900 dark:text-white sm:text-[15px]">{title}</h2>
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
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:hover:border-red-800 dark:hover:bg-red-950/40"
                    >
                      <span aria-hidden="true" className="text-2xl font-light leading-none">×</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                {children}
              </div>

              {footer && (
                <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
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
  <div className={['p-4 sm:p-6', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);

export const ModalFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);
