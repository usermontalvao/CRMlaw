import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Variante dashed para áreas de conteúdo interno */
  variant?: 'dashed' | 'solid';
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'dashed',
  className = '',
}) => (
  <div
    className={[
      'flex flex-col items-center justify-center py-10 px-6 text-center rounded-xl',
      variant === 'dashed'
        ? 'border border-dashed border-[#e7e5df] dark:border-zinc-700'
        : 'bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-zinc-800',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {icon && (
      <div className="mb-3 text-slate-300 dark:text-zinc-600">{icon}</div>
    )}
    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{title}</p>
    {description && (
      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 max-w-xs">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
