import React from 'react';
import { ShimmerSweep } from './ShimmerSweep';

/* ──────────────────────────────────────────────────────────────────────────
 * Esqueletos fiéis ao layout de cada módulo. Todos usam o efeito ShimmerSweep
 * (varredura de luz, igual ao módulo Cloud). As barras usam slate-200 para que
 * a varredura branca seja sempre visível.
 * ────────────────────────────────────────────────────────────────────────── */

const bar = 'bg-slate-200/90 dark:bg-zinc-700/70';
const barSoft = 'bg-slate-200/55 dark:bg-zinc-700/40';
const card = 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800';

const fade = (i: number, step = 0.07, min = 0.35) => ({ opacity: Math.max(min, 1 - i * step) });

/* ───── Clientes — tabela (desktop) + cartões (mobile) ───── */
export const ClientsSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <ShimmerSweep>
    {/* Mobile */}
    <div className="md:hidden space-y-3">
      {Array.from({ length: Math.min(rows, 6) }).map((_, i) => (
        <div key={i} className={`rounded-lg ${card} p-3`} style={fade(i, 0.1)}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`w-10 h-10 rounded-full flex-shrink-0 ${bar}`} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className={`h-3 w-2/3 rounded-full ${bar}`} />
                <div className={`h-2 w-1/3 rounded-full ${barSoft}`} />
              </div>
            </div>
            <div className={`h-4 w-14 rounded-full ${barSoft}`} />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className={`h-2.5 w-3/4 rounded-full ${barSoft}`} />
            <div className={`h-2.5 w-2/3 rounded-full ${barSoft}`} />
          </div>
        </div>
      ))}
    </div>

    {/* Desktop */}
    <div className={`hidden md:block overflow-hidden rounded-xl ${card}`}>
      <div className="grid grid-cols-[minmax(220px,2.5fr)_1fr_1.2fr_1.4fr_110px_120px] gap-4 px-6 py-3.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40">
        {['w-16', 'w-12', 'w-16', 'w-14', 'w-12', 'w-10'].map((w, i) => (
          <div key={i} className={`h-2.5 rounded-full ${bar} ${w}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(220px,2.5fr)_1fr_1.2fr_1.4fr_110px_120px] gap-4 px-6 py-4 border-b border-slate-100 dark:border-zinc-800/70 last:border-b-0 items-center"
          style={fade(i)}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-[42px] h-[42px] rounded-full flex-shrink-0 ${bar}`} />
            <div className="flex-1 min-w-0 space-y-2">
              <div className={`h-3 rounded-full ${bar}`} style={{ width: `${52 + (i * 11) % 30}%` }} />
              <div className={`h-2 rounded-full ${barSoft}`} style={{ width: `${30 + (i * 7) % 18}%` }} />
            </div>
          </div>
          <div className={`h-2.5 w-24 rounded-full ${barSoft}`} />
          <div className={`h-2.5 w-28 rounded-full ${barSoft}`} />
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex-shrink-0 ${bar}`} />
            <div className={`h-2.5 w-24 rounded-full ${barSoft}`} />
          </div>
          <div className={`h-5 w-16 rounded-full ${barSoft}`} />
          <div className="flex items-center justify-end gap-1.5">
            {[0, 1, 2].map((k) => <div key={k} className={`w-7 h-7 rounded-md ${barSoft}`} />)}
          </div>
        </div>
      ))}
    </div>
  </ShimmerSweep>
);

/* ───── Leads — 4 cartões de destaque + board kanban ───── */
export const LeadsSkeleton: React.FC = () => (
  <ShimmerSweep className="space-y-6">
    {/* Highlights */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={`rounded-2xl ${card} p-6 space-y-3`}>
          <div className="flex items-center justify-between">
            <div className={`w-10 h-10 rounded-xl ${bar}`} />
            <div className={`h-5 w-8 rounded-full ${barSoft}`} />
          </div>
          <div className={`h-3 w-2/3 rounded-full ${bar}`} />
          <div className={`h-2 w-1/2 rounded-full ${barSoft}`} />
        </div>
      ))}
    </div>

    {/* Kanban */}
    <div className="flex flex-col md:flex-row gap-4 md:overflow-x-auto pb-4">
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className={`flex-shrink-0 w-full md:w-80 rounded-2xl ${card} overflow-hidden`}>
          <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className={`h-3 w-28 rounded-full ${bar}`} />
              <div className={`h-5 w-6 rounded-full ${barSoft}`} />
            </div>
            <div className={`h-2 w-3/4 rounded-full ${barSoft}`} />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : 1 }).map((_, i) => (
              <div key={i} className={`rounded-xl ${card} p-4 space-y-3`} style={fade(i, 0.12)}>
                <div className="space-y-1.5">
                  <div className={`h-2 w-10 rounded-full ${barSoft}`} />
                  <div className={`h-3 w-2/3 rounded-full ${bar}`} />
                </div>
                <div className={`h-7 w-full rounded-lg ${barSoft}`} />
                <div className={`h-7 w-full rounded-lg ${barSoft}`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </ShimmerSweep>
);

/* ───── Financeiro — 4 KPIs + grade de acordos ───── */
export const FinancialSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <ShimmerSweep className="space-y-4">
    {/* KPIs */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={`relative overflow-hidden rounded-xl ${card}`}>
          <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
          <div className="p-4 pl-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className={`h-2.5 w-16 rounded-full ${barSoft}`} />
              <div className={`w-8 h-8 rounded-lg ${bar}`} />
            </div>
            <div className={`h-7 w-28 rounded-lg ${bar}`} />
            <div className={`h-2 w-16 rounded-full ${barSoft}`} />
          </div>
        </div>
      ))}
    </div>

    {/* Acordos */}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`rounded-xl ${card} p-5 space-y-4`} style={fade(i, 0.06)}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex-shrink-0 ${bar}`} />
            <div className="flex-1 space-y-2">
              <div className={`h-3 w-2/3 rounded-full ${bar}`} />
              <div className={`h-2 w-1/3 rounded-full ${barSoft}`} />
            </div>
            <div className={`h-5 w-14 rounded-full ${barSoft}`} />
          </div>
          <div className={`h-2 w-full rounded-full ${barSoft}`} />
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800">
            <div className={`h-5 w-24 rounded-lg ${bar}`} />
            <div className={`h-5 w-16 rounded-full ${barSoft}`} />
          </div>
        </div>
      ))}
    </div>
  </ShimmerSweep>
);

/* ───── Processos — kanban OU tabela ───── */
export const ProcessesSkeleton: React.FC<{ kanban?: boolean; rows?: number }> = ({ kanban = false, rows = 7 }) =>
  kanban ? (
    <ShimmerSweep>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className={`rounded-xl ${card} overflow-hidden flex flex-col`}>
            <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
              <div className={`h-3 w-28 rounded-full ${bar}`} />
              <div className={`h-3 w-5 rounded-full ${barSoft}`} />
            </div>
            <div className="p-3 space-y-3">
              {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : 1 }).map((_, i) => (
                <div key={i} className={`rounded-xl ${card} p-3 space-y-2.5`} style={fade(i, 0.12)}>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex-shrink-0 ${bar}`} />
                    <div className="flex-1 space-y-1.5">
                      <div className={`h-3 w-24 rounded-full ${bar}`} />
                      <div className={`h-2 w-32 rounded-full ${barSoft}`} />
                    </div>
                  </div>
                  <div className={`h-2.5 w-20 rounded-full ${barSoft}`} />
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-zinc-800">
                    <div className={`h-4 w-20 rounded ${bar}`} />
                    <div className="flex gap-1.5">
                      <div className={`h-6 w-6 rounded-lg ${barSoft}`} />
                      <div className={`h-6 w-6 rounded-lg ${barSoft}`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ShimmerSweep>
  ) : (
    <ShimmerSweep>
      <div className={`rounded-xl ${card} overflow-hidden`}>
        {/* Mobile */}
        <div className="block lg:hidden divide-y divide-slate-100 dark:divide-zinc-800">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4" style={fade(i)}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 ${bar}`} />
                  <div className="flex-1 space-y-1.5">
                    <div className={`h-3 rounded-full ${bar} ${i % 2 === 0 ? 'w-32' : 'w-40'}`} />
                    <div className={`h-2 w-36 rounded-full ${barSoft}`} />
                  </div>
                </div>
                <div className={`h-5 w-16 rounded-full ${barSoft}`} />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800">
                <div className={`h-6 w-20 rounded ${bar}`} />
                <div className="flex gap-2">
                  <div className={`h-8 w-8 rounded-lg ${barSoft}`} />
                  <div className={`h-8 w-8 rounded-lg ${barSoft}`} />
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-[minmax(180px,2fr)_minmax(200px,2.2fr)_120px_160px_140px] gap-4 px-6 py-3.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40">
            {['w-12', 'w-28', 'w-16', 'w-10', 'w-8'].map((w, i) => <div key={i} className={`h-2.5 rounded-full ${bar} ${w}`} />)}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(180px,2fr)_minmax(200px,2.2fr)_120px_160px_140px] gap-4 px-6 py-4 border-b border-slate-100 dark:border-zinc-800/70 last:border-b-0 items-center"
              style={fade(i)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-full flex-shrink-0 ${bar}`} />
                <div className="flex-1 space-y-2">
                  <div className={`h-3 rounded-full ${bar} ${i % 3 === 0 ? 'w-28' : i % 3 === 1 ? 'w-36' : 'w-32'}`} />
                  <div className={`h-2 rounded-full ${barSoft} ${i % 2 === 0 ? 'w-20' : 'w-24'}`} />
                </div>
              </div>
              <div className="space-y-2">
                <div className={`h-3 rounded-full ${barSoft} ${i % 2 === 0 ? 'w-40' : 'w-48'}`} />
                <div className={`h-2 w-24 rounded-full ${barSoft}`} />
              </div>
              <div className={`h-3 w-16 rounded-full ${barSoft}`} />
              <div className={`h-6 w-28 rounded-full ${barSoft}`} />
              <div className="flex items-center justify-end gap-3">
                {[0, 1, 2].map((k) => <div key={k} className={`h-5 w-5 rounded ${barSoft}`} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ShimmerSweep>
  );

/* ───── Prazos — barra de progresso + linhas ───── */
export const DeadlinesSkeleton: React.FC<{ rows?: number }> = ({ rows = 7 }) => (
  <ShimmerSweep>
    <div className={`rounded-xl ${card} overflow-hidden`}>
      <div className={`h-1 w-full ${bar}`} />
      <div className="divide-y divide-slate-100 dark:divide-zinc-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4" style={fade(i)}>
            <div className={`w-2.5 h-10 rounded-full flex-shrink-0 ${i % 2 === 0 ? 'bg-amber-200/70 dark:bg-amber-500/20' : bar}`} />
            <div className="flex-1 min-w-0 space-y-2">
              <div className={`h-3 rounded-full ${bar}`} style={{ width: `${48 + (i * 11) % 32}%` }} />
              <div className={`h-2 rounded-full ${barSoft}`} style={{ width: `${28 + (i * 9) % 22}%` }} />
            </div>
            <div className={`hidden sm:block h-6 w-24 rounded-full ${barSoft}`} />
            <div className={`hidden md:block h-2.5 w-20 rounded-full ${barSoft}`} />
            <div className="flex gap-1.5">
              {[0, 1, 2].map((k) => <div key={k} className={`w-7 h-7 rounded-lg ${barSoft}`} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  </ShimmerSweep>
);

/* ───── Assinaturas — grade de cards de documentos ───── */
export const SignatureSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <ShimmerSweep>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`rounded-2xl ${card} overflow-hidden`} style={fade(i, 0.05)}>
          {/* Header strip: badge + controle */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-3 border-b border-slate-100 dark:border-zinc-800">
            <div className={`h-5 w-20 rounded-full ${i % 3 === 0 ? 'bg-amber-200/70 dark:bg-amber-500/20' : barSoft}`} />
            <div className={`w-5 h-5 rounded ${barSoft}`} />
          </div>
          <div className="p-3.5 space-y-3">
            {/* Ícone PDF + título */}
            <div className="flex items-start gap-2.5">
              <div className={`w-9 h-11 rounded-md flex-shrink-0 ${bar}`} />
              <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
                <div className={`h-2.5 w-full rounded-full ${bar}`} />
                <div className={`h-2.5 w-4/5 rounded-full ${bar}`} />
                <div className={`h-2.5 w-2/3 rounded-full ${barSoft}`} />
              </div>
            </div>
            {/* Cliente */}
            <div className={`h-2 w-1/2 rounded-full ${barSoft}`} />
            {/* Avatares de signatários */}
            <div className="flex -space-x-1.5">
              {[0, 1, 2].map((k) => <div key={k} className={`w-6 h-6 rounded-full border-2 border-white dark:border-zinc-900 ${bar}`} />)}
            </div>
          </div>
          {/* Footer: data + progresso */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-800/30">
            <div className={`h-2 w-16 rounded-full ${barSoft}`} />
            <div className={`h-1.5 w-16 rounded-full ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  </ShimmerSweep>
);

/* ───── Intimações — cards empilhados (por processo) ───── */
export const IntimationsSkeleton: React.FC<{ rows?: number }> = ({ rows = 7 }) => (
  <ShimmerSweep className="space-y-2.5">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={`rounded-xl ${card} px-4 sm:px-5 py-3.5`} style={fade(i)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className={`w-9 h-9 rounded-lg flex-shrink-0 ${i % 4 === 0 ? 'bg-amber-200/70 dark:bg-amber-500/20' : bar}`} />
            <div className="flex-1 min-w-0 space-y-2">
              <div className={`h-3 rounded-full ${bar}`} style={{ width: `${42 + (i * 13) % 34}%` }} />
              <div className={`h-2 rounded-full ${barSoft}`} style={{ width: `${24 + (i * 7) % 18}%` }} />
            </div>
          </div>
          <div className={`h-5 w-20 rounded-full ${barSoft} flex-shrink-0`} />
        </div>
      </div>
    ))}
  </ShimmerSweep>
);
