// Primitivas de UI compartilhadas dos modais do módulo WhatsApp: o diálogo base
// (`WaDialog`/`WaDialogBody`) e os tokens de classe reutilizados pelos formulários.
// Extraídos de WhatsAppModule.tsx para permitir mover os modais para arquivos
// próprios sem duplicar estilo.
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

const WA_TEAL = '#008069'; // faixa de cabeçalho (WhatsApp)

// Classes reutilizáveis para o corpo dos modais (mantêm a estética coesa).
export const waInput = 'w-full px-3 py-2 text-[13px] rounded-lg bg-[#f0f2f5] border border-transparent focus:bg-white focus:border-[#00a884] outline-none transition';
export const waLabel = 'block text-[12px] font-semibold text-slate-500 mb-1';
export const waBtnPrimary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] text-white text-[13px] font-semibold hover:bg-[#017561] disabled:opacity-50 transition';
export const waBtnGhost = 'px-3 py-2 text-[13px] font-semibold text-slate-500 hover:text-slate-700 transition';
export const waBtnDanger = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50 transition';

const WA_DIALOG_WIDTH: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl',
};

export const WaDialog: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  zIndex?: number;
  headerActions?: React.ReactNode;
  /** Header escuro (para previews de mídia). Padrão: teal do WhatsApp. */
  headerClassName?: string;
}> = ({ title, subtitle, icon, onClose, children, footer, size = 'md', zIndex = 50, headerActions, headerClassName }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4" style={{ zIndex }} onClick={onClose}>
      <motion.div
        role="dialog" aria-modal="true" aria-label={title}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className={`w-full ${WA_DIALOG_WIDTH[size]} max-h-[94dvh] flex flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/10 rounded-t-2xl sm:rounded-2xl`}
      >
        <div className={`shrink-0 flex items-center gap-3 px-4 py-3 text-white ${headerClassName ?? ''}`} style={headerClassName ? undefined : { backgroundColor: WA_TEAL }}>
          {icon && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold leading-tight">{title}</h3>
            {subtitle && (typeof subtitle === 'string'
              ? <p className="truncate text-[12px] text-white/80">{subtitle}</p>
              : <div className="text-[12px] text-white/80">{subtitle}</div>)}
          </div>
          {headerActions}
          <button type="button" onClick={onClose} aria-label="Fechar" className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white transition">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>

        {footer && <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">{footer}</div>}
      </motion.div>
    </div>,
    document.body,
  );
};

export const WaDialogBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['p-4 sm:p-5', className].filter(Boolean).join(' ')} {...props}>{children}</div>
);
