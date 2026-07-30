import React, { useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Info,
  Keyboard,
  LayoutGrid,
  List,
  MoreVertical,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import { NcMenu, NcMenuItem, NcMenuLabel, NcMenuSeparator } from './NcMenu';
import { NC_FOCUS_RING, NC_HOVER, NC_TEXT_MUTED } from './ncTokens';

/**
 * NextcloudMoreMenu — ações globais de baixa frequência.
 * -----------------------------------------------------------------------------
 * Tudo que antes ocupava um ícone permanente na toolbar mas se usa uma vez por
 * semana (vincular pastas em lote, bloco de notas, recolher a lateral) mora
 * aqui. As preferências de exibição também: em telas estreitas o seletor de
 * ordenação some da toolbar, e sem este menu não haveria como ordenar a grade
 * no celular.
 */

interface NextcloudMoreMenuProps {
  onAutoLink: () => void;
  autoLinkDisabled: boolean;
  onOpenTextEditor: () => void;
  onRefresh: () => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  sortBy: 'name' | 'date' | 'size';
  onSortByChange: (value: 'name' | 'date' | 'size') => void;
  sortDir: 'asc' | 'desc';
  onSortDirChange: (value: 'asc' | 'desc') => void;
  /** Atalho de teclado é recurso que ninguém acha sozinho: precisa de um item
      visível levando até a lista, além da tecla "?". */
  onShowShortcuts: () => void;
}

const SORT_LABELS: Array<{ value: 'name' | 'date' | 'size'; label: string }> = [
  { value: 'name', label: 'Nome' },
  { value: 'date', label: 'Última modificação' },
  { value: 'size', label: 'Tamanho' },
];

export const NextcloudMoreMenu: React.FC<NextcloudMoreMenuProps> = ({
  onAutoLink,
  autoLinkDisabled,
  onOpenTextEditor,
  onRefresh,
  detailsOpen,
  onToggleDetails,
  sidebarOpen,
  onToggleSidebar,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  onShowShortcuts,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  /** Marcação de opção ativa — o menu também é o controle em telas estreitas. */
  const mark = (active: boolean) => (active ? <Check className="h-4 w-4 text-blue-600" /> : <span className="h-4 w-4" />);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mais ações"
        title="Mais ações"
        onClick={() => setOpen((current) => !current)}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      <NcMenu open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} align="right" label="Mais ações" widthClassName="w-72">
        <NcMenuItem
          icon={<Wand2 className="h-4 w-4 text-emerald-600" />}
          onClick={run(onAutoLink)}
          disabled={autoLinkDisabled}
        >
          Vincular pastas automaticamente
        </NcMenuItem>
        <NcMenuItem icon={<NotebookPen className="h-4 w-4 text-amber-600" />} onClick={run(onOpenTextEditor)}>
          Bloco de notas
        </NcMenuItem>
        <NcMenuItem icon={<RefreshCw className="h-4 w-4 text-slate-500" />} onClick={run(onRefresh)}>
          Atualizar
        </NcMenuItem>
        <NcMenuItem icon={<Keyboard className="h-4 w-4 text-slate-500" />} onClick={run(onShowShortcuts)} hint="?">
          Atalhos de teclado
        </NcMenuItem>

        <NcMenuSeparator />

        <NcMenuItem icon={<Info className="h-4 w-4 text-blue-600" />} onClick={run(onToggleDetails)}>
          {detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
        </NcMenuItem>
        <NcMenuItem
          icon={sidebarOpen ? <PanelLeftClose className="h-4 w-4 text-slate-500" /> : <PanelLeftOpen className="h-4 w-4 text-slate-500" />}
          onClick={run(onToggleSidebar)}
        >
          {sidebarOpen ? 'Ocultar barra lateral' : 'Mostrar barra lateral'}
        </NcMenuItem>

        <NcMenuSeparator />

        <NcMenuLabel>Preferências de exibição</NcMenuLabel>
        <NcMenuItem icon={mark(viewMode === 'list')} onClick={() => onViewModeChange('list')}>
          <span className="inline-flex items-center gap-2"><List className="h-4 w-4 text-slate-400" /> Lista</span>
        </NcMenuItem>
        <NcMenuItem icon={mark(viewMode === 'grid')} onClick={() => onViewModeChange('grid')}>
          <span className="inline-flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-slate-400" /> Grade</span>
        </NcMenuItem>

        <NcMenuLabel>Ordenar por</NcMenuLabel>
        {SORT_LABELS.map((option) => (
          <NcMenuItem key={option.value} icon={mark(sortBy === option.value)} onClick={() => onSortByChange(option.value)}>
            {option.label}
          </NcMenuItem>
        ))}
        <NcMenuItem
          icon={sortDir === 'asc' ? <ArrowDownAZ className="h-4 w-4 text-slate-400" /> : <ArrowUpAZ className="h-4 w-4 text-slate-400" />}
          onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
        >
          {sortDir === 'asc' ? 'Ordem crescente' : 'Ordem decrescente'}
        </NcMenuItem>
      </NcMenu>
    </div>
  );
};

export default NextcloudMoreMenu;
