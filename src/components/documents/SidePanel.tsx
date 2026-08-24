// Uma etapa da tela de gerar documento, que encolhe PARA O LADO.
//
// A tela é uma faixa horizontal: só a etapa em aberto ocupa largura. Assim que
// ela é resolvida — modelo escolhido, documento gerado —, vira um trilho em pé
// de uns 56 px na esquerda, com o que foi decidido escrito na vertical, e a
// próxima etapa (ou a prévia) fica com o espaço liberado. A seta no trilho
// reabre a etapa a qualquer momento.
//
// Em tela estreita não há largura para dividir: aí o trilho deita e vira uma
// linha, e as etapas se empilham.
import React from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

export interface SidePanelProps {
  step: number;
  title: string;
  /** Linha de apoio, visível só com a etapa aberta. */
  hint?: string;
  /** O que foi decidido — é o que aparece no trilho. */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  /** Etapa resolvida: o selo vira um visto. */
  done?: boolean;
  children: React.ReactNode;
}

const SidePanel: React.FC<SidePanelProps> = ({
  step,
  title,
  hint,
  summary,
  open,
  onToggle,
  done = false,
  children,
}) => {
  const selo = (
    <span
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        done
          ? 'bg-emerald-500 text-white'
          : open
            ? 'bg-primary-500 text-white'
            : 'bg-slate-200 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400'
      }`}
    >
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
    </span>
  );

  const moldura =
    'overflow-hidden rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] dark:border-zinc-800 dark:bg-zinc-900';

  if (!open) {
    return (
      <section className={`${moldura} @lg:w-14 @lg:flex-none`}>
        {/* estreito: o trilho deita e vira uma linha */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-100/70 @lg:hidden dark:hover:bg-zinc-800/60"
        >
          {selo}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</span>
            {summary && <span className="block truncate text-xs text-slate-500 dark:text-zinc-400">{summary}</span>}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-zinc-500" />
        </button>

        {/* largo: o trilho fica em pé */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Expandir ${title}`}
          title={summary ? `${title} — ${summary}` : title}
          className="hidden h-full w-full flex-col items-center gap-3 py-3 transition hover:bg-slate-100/70 @lg:flex dark:hover:bg-zinc-800/60"
        >
          {selo}
          <span
            className="min-h-0 flex-1 overflow-hidden text-xs font-medium text-slate-500 dark:text-zinc-400"
            style={{ writingMode: 'vertical-rl' }}
          >
            {summary || title}
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-zinc-500" />
        </button>
      </section>
    );
  }

  return (
    <section className={`${moldura} flex min-h-0 min-w-0 flex-1 flex-col`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="flex w-full flex-none items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-100/70 sm:px-5 dark:hover:bg-zinc-800/60"
      >
        {selo}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</span>
          {hint && <span className="block text-xs text-slate-500 dark:text-zinc-400">{hint}</span>}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-400 dark:text-zinc-500">
          encolher
          <ChevronLeft className="h-4 w-4" />
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[#e7e5df] px-4 py-4 sm:px-5 sm:py-5 dark:border-zinc-800">
        {children}
      </div>
    </section>
  );
};

export default SidePanel;
