import React from 'react';
import { Loader2, PanelLeftOpen, RefreshCw, Search, X } from 'lucide-react';
import { NextcloudIcon } from '../icons/NextcloudIcon';
import {
  NC_BORDER,
  NC_BRAND_BLUE,
  NC_FOCUS_RING,
  NC_HOVER,
  NC_TEXT,
  NC_TEXT_FAINT,
  NC_TEXT_MUTED,
  NC_TEXT_STRONG,
} from './ncTokens';

/**
 * NextcloudTopBar — barra superior do explorador.
 * -----------------------------------------------------------------------------
 * Identidade à esquerda (logotipo e nome Nextcloud, com "Arquivos Jurius" como
 * identificação secundária), busca dominante ao centro e ações à direita. A
 * busca fica no centro porque é a ação mais frequente do módulo: procurar um
 * documento é mais comum do que qualquer outra coisa que se faça aqui.
 */

interface NextcloudTopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Muda o texto do campo: dentro de uma pasta a busca é recursiva a partir dela. */
  searchScopeLabel: string;
  searching: boolean;
  /** Resumo do que está à vista (contagem de itens ou de resultados). */
  summary: string;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  loading: boolean;
  onRefresh: () => void;
  /** Ações extras do lado direito (ex.: menu "Mais" em telas estreitas). */
  actions?: React.ReactNode;
}

export const NextcloudTopBar: React.FC<NextcloudTopBarProps> = ({
  search,
  onSearchChange,
  searchScopeLabel,
  searching,
  summary,
  sidebarOpen,
  onOpenSidebar,
  loading,
  onRefresh,
  actions,
}) => (
  <header className="flex min-h-[64px] shrink-0 items-center gap-3 px-3 py-2.5 sm:px-4">
    <div className="flex min-w-0 shrink-0 items-center gap-2.5">
      {!sidebarOpen && (
        <button
          type="button"
          onClick={onOpenSidebar}
          title="Mostrar painel de navegação"
          aria-label="Mostrar painel de navegação"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${NC_TEXT_MUTED} transition ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
      )}
      <span
        className="flex h-9 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
        style={{ backgroundColor: NC_BRAND_BLUE }}
      >
        <NextcloudIcon className="h-4 w-9" />
      </span>
      <span className="hidden min-w-0 flex-col leading-tight sm:flex">
        <span className={`truncate text-[15px] font-medium ${NC_TEXT_STRONG}`}>Nextcloud</span>
        <span className={`truncate text-[11px] ${NC_TEXT_FAINT}`}>Arquivos Jurius</span>
      </span>
    </div>

    <div className="mx-auto flex min-w-0 max-w-[680px] flex-1 items-center">
      <label className="relative flex w-full items-center">
        <span className="sr-only">Pesquisar no Nextcloud</span>
        <Search className={`pointer-events-none absolute left-4 h-4 w-4 ${NC_TEXT_FAINT}`} />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchScopeLabel}
          className={`h-11 w-full rounded-full border bg-[#eef1f6] pl-11 pr-20 text-sm outline-none transition dark:bg-zinc-800 ${NC_BORDER} ${NC_TEXT} placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/25 dark:focus:bg-zinc-900 [&::-webkit-search-cancel-button]:hidden`}
        />
        <span className="absolute right-3 flex items-center gap-1">
          {searching && <Loader2 className={`h-4 w-4 animate-spin ${NC_TEXT_FAINT}`} />}
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              title="Limpar busca"
              aria-label="Limpar busca"
              className={`flex h-7 w-7 items-center justify-center rounded-full ${NC_TEXT_MUTED} transition ${NC_HOVER} ${NC_FOCUS_RING}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </span>
      </label>
    </div>

    <div className="flex shrink-0 items-center gap-1">
      <span className={`hidden whitespace-nowrap text-xs xl:inline ${NC_TEXT_MUTED}`}>{summary}</span>
      <button
        type="button"
        onClick={onRefresh}
        title="Atualizar"
        aria-label="Atualizar"
        className={`flex h-9 w-9 items-center justify-center rounded-full ${NC_TEXT_MUTED} transition ${NC_HOVER} ${NC_FOCUS_RING}`}
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </button>
      {actions}
    </div>
  </header>
);

export default NextcloudTopBar;
