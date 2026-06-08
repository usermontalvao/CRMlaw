import React from 'react';

interface PageHeaderProps {
  /** Ícone à esquerda do título */
  icon?: React.ReactNode;
  /** Rótulo acima do título */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Ações primária/secundária no canto direito */
  actions?: React.ReactNode;
  /** Faixa de cor no topo (padrão: amber) */
  accentColor?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  accentColor = 'bg-amber-500',
}) => (
  <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden">
    <div className={`h-1.5 w-full ${accentColor}`} />
    <div className="px-5 sm:px-6 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className={`w-10 h-10 rounded-xl ${accentColor} flex items-center justify-center shrink-0 text-white`}>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-0.5">
              {eyebrow}
            </p>
          )}
          <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  </div>
);
