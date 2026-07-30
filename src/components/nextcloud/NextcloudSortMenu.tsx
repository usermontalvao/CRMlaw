import React, { useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown, ArrowUpDown } from 'lucide-react';
import { NcMenu, NcMenuItem, NcMenuLabel, NcMenuSeparator } from './NcMenu';
import { NC_BORDER, NC_FOCUS_RING, NC_HOVER, NC_TEXT, NC_TEXT_FAINT } from './ncTokens';

/**
 * NextcloudSortMenu — o "Organizar" do explorador do Windows.
 * -----------------------------------------------------------------------------
 * Antes eram dois controles soltos na toolbar: um `<select>` de critério e um
 * botão "A–Z" que ninguém associava a crescente/decrescente. Aqui viram um menu
 * só, com o vocabulário de quem já usa o explorador do Windows todo dia —
 * "Classificar por" e "Crescente/Decrescente" — e o critério em uso aparece
 * escrito no botão, em vez de exigir abrir para descobrir.
 */

export type NextcloudSortBy = 'name' | 'date' | 'type' | 'size';
export type NextcloudSortDir = 'asc' | 'desc';

export const SORT_OPTIONS: Array<{ value: NextcloudSortBy; label: string }> = [
  { value: 'name', label: 'Nome' },
  { value: 'date', label: 'Data de modificação' },
  { value: 'type', label: 'Tipo' },
  { value: 'size', label: 'Tamanho' },
];

export function sortByLabel(value: NextcloudSortBy): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label ?? 'Nome';
}

interface NextcloudSortMenuProps {
  sortBy: NextcloudSortBy;
  onSortByChange: (value: NextcloudSortBy) => void;
  sortDir: NextcloudSortDir;
  onSortDirChange: (value: NextcloudSortDir) => void;
}

export const NextcloudSortMenu: React.FC<NextcloudSortMenuProps> = ({
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const mark = (active: boolean) => (active ? <Check className="h-4 w-4 text-blue-600" /> : <span className="h-4 w-4" />);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Organizar os itens desta pasta"
        onClick={() => setOpen((current) => !current)}
        className={`hidden h-9 items-center gap-1.5 rounded-full border pl-3 pr-2.5 text-[13px] transition lg:inline-flex ${NC_BORDER} ${NC_TEXT} ${NC_HOVER} ${NC_FOCUS_RING}`}
      >
        <ArrowUpDown className={`h-3.5 w-3.5 ${NC_TEXT_FAINT}`} />
        <span>Organizar</span>
        <span className={`hidden xl:inline ${NC_TEXT_FAINT}`}>· {sortByLabel(sortBy)}</span>
        <ChevronDown className={`h-3.5 w-3.5 ${NC_TEXT_FAINT}`} />
      </button>

      <NcMenu open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} align="right" label="Organizar" widthClassName="w-60">
        <NcMenuLabel>Classificar por</NcMenuLabel>
        {SORT_OPTIONS.map((option) => (
          <NcMenuItem key={option.value} icon={mark(sortBy === option.value)} onClick={() => onSortByChange(option.value)}>
            {option.label}
          </NcMenuItem>
        ))}
        <NcMenuSeparator />
        <NcMenuItem icon={mark(sortDir === 'asc')} onClick={() => onSortDirChange('asc')}>
          <span className="inline-flex items-center gap-2">
            <ArrowUpNarrowWide className="h-4 w-4 text-slate-400" /> Crescente
          </span>
        </NcMenuItem>
        <NcMenuItem icon={mark(sortDir === 'desc')} onClick={() => onSortDirChange('desc')}>
          <span className="inline-flex items-center gap-2">
            <ArrowDownWideNarrow className="h-4 w-4 text-slate-400" /> Decrescente
          </span>
        </NcMenuItem>
      </NcMenu>
    </div>
  );
};

export default NextcloudSortMenu;
