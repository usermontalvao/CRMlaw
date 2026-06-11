import React from 'react';

/* ── Card ───────────────────────────────────────────────────────── */
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Remove padding interno (para conteúdo full-bleed) */
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ noPadding = false, className = '', children, ...props }) => (
  <div
    className={[
      'bg-[#f8f7f5] dark:bg-zinc-900 border border-[#e7e5df] dark:border-zinc-800 rounded-xl shadow-sm',
      noPadding ? '' : 'p-5',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    {children}
  </div>
);

/* ── CardHeader ─────────────────────────────────────────────────── */
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, subtitle, action, className = '', ...props }) => (
  <div
    className={[
      'px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between gap-4',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>}
    </div>
    {action && <div className="flex-shrink-0">{action}</div>}
  </div>
);

/* ── CardSection ─────────────────────────────────────────────────── */
export const CardSection: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', children, ...props }) => (
  <div className={['px-5 py-4', className].filter(Boolean).join(' ')} {...props}>
    {children}
  </div>
);

/* ── Divider ─────────────────────────────────────────────────────── */
export const Divider: React.FC<{ className?: string }> = ({ className = '' }) => (
  <hr className={['border-slate-100 dark:border-zinc-800', className].filter(Boolean).join(' ')} />
);
