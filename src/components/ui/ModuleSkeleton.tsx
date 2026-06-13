import React from 'react';
import { ShimmerSweep } from './ShimmerSweep';

type Variant = 'list' | 'cards' | 'table' | 'calendar';

/** Barra cinza base do esqueleto — visível em claro e escuro. */
const bar = 'bg-slate-200/90 dark:bg-zinc-700/70';
const barSoft = 'bg-slate-200/60 dark:bg-zinc-700/40';

/**
 * ModuleSkeleton — esqueleto de carregamento genérico (lista, cartões, tabela,
 * calendário) com a varredura de luz do módulo Cloud (ShimmerSweep).
 *
 * Para módulos com layout próprio (Clientes, Leads, Financeiro, Processos…),
 * use os esqueletos dedicados em ./skeletons.
 */
export const ModuleSkeleton: React.FC<{
  variant?: Variant;
  rows?: number;
  header?: boolean;
  stats?: number;
  className?: string;
}> = ({ variant = 'list', rows = 8, header = false, stats = 0, className = '' }) => {
  return (
    <ShimmerSweep className={`w-full ${className}`}>
      {header && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className={`h-5 w-44 rounded-lg ${bar}`} />
            <div className={`h-2.5 w-28 rounded-full ${barSoft}`} />
          </div>
          <div className={`h-9 w-32 rounded-lg ${bar}`} />
        </div>
      )}

      {stats > 0 && (
        <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(stats, 4)}, minmax(0, 1fr))` }}>
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5">
              <div className={`h-2.5 w-20 rounded-full ${barSoft}`} />
              <div className={`h-6 w-24 rounded-lg ${bar}`} />
            </div>
          ))}
        </div>
      )}

      {variant === 'list' && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800/70 last:border-b-0"
              style={{ opacity: Math.max(0.35, 1 - i * 0.07) }}
            >
              <div className={`w-10 h-10 rounded-xl flex-shrink-0 ${i % 3 === 0 ? 'bg-amber-200/70 dark:bg-amber-500/20' : bar}`} />
              <div className="flex-1 min-w-0 space-y-2">
                <div className={`h-2.5 rounded-full ${bar}`} style={{ width: `${44 + (i * 11) % 36}%` }} />
                <div className={`h-2 rounded-full ${barSoft}`} style={{ width: `${24 + (i * 9) % 22}%` }} />
              </div>
              <div className={`hidden sm:block h-5 w-16 rounded-full ${barSoft} flex-shrink-0`} />
              <div className={`hidden md:block h-2.5 w-20 rounded-full ${barSoft} flex-shrink-0`} />
            </div>
          ))}
        </div>
      )}

      {variant === 'cards' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
              style={{ opacity: Math.max(0.4, 1 - i * 0.05) }}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex-shrink-0 ${i % 3 === 0 ? 'bg-amber-200/70 dark:bg-amber-500/20' : bar}`} />
                <div className="flex-1 space-y-2">
                  <div className={`h-2.5 w-2/3 rounded-full ${bar}`} />
                  <div className={`h-2 w-1/3 rounded-full ${barSoft}`} />
                </div>
              </div>
              <div className="space-y-2">
                <div className={`h-2 w-full rounded-full ${barSoft}`} />
                <div className={`h-2 w-4/5 rounded-full ${barSoft}`} />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === 'table' && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="grid grid-cols-[minmax(180px,2.5fr)_1fr_1fr_120px] gap-3 px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`h-2.5 rounded-full ${bar}`} style={{ width: `${50 + (i * 13) % 40}%` }} />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(180px,2.5fr)_1fr_1fr_120px] gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-zinc-800/70 last:border-b-0 items-center"
              style={{ opacity: Math.max(0.35, 1 - i * 0.07) }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex-shrink-0 ${bar}`} />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className={`h-2.5 rounded-full ${bar}`} style={{ width: `${50 + (i * 11) % 35}%` }} />
                  <div className={`h-2 rounded-full ${barSoft}`} style={{ width: `${30 + (i * 7) % 20}%` }} />
                </div>
              </div>
              <div className={`h-2.5 w-3/4 rounded-full ${barSoft}`} />
              <div className={`h-2.5 w-2/3 rounded-full ${barSoft}`} />
              <div className={`h-6 w-20 rounded-full ${barSoft} justify-self-end`} />
            </div>
          ))}
        </div>
      )}

      {variant === 'calendar' && (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="grid grid-cols-7 gap-2 mb-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className={`h-2.5 rounded-full ${bar} mx-auto w-8`} />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-lg bg-slate-100 dark:bg-zinc-800/60 p-1.5 flex flex-col gap-1"
                style={{ opacity: Math.max(0.45, 1 - Math.floor(i / 7) * 0.1) }}
              >
                <div className={`h-2 w-4 rounded-full ${bar}`} />
                {i % 4 === 0 && <div className="h-1.5 w-full rounded-full bg-amber-200/70 dark:bg-amber-500/20 mt-auto" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </ShimmerSweep>
  );
};

export default ModuleSkeleton;
