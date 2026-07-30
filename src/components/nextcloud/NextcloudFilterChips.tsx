import React from 'react';
import type { NextcloudEntry } from '../../services/nextcloud.service';
import { isDocx, isImage, isMedia, isPdf } from '../../utils/nextcloudFile';
import { NC_BORDER, NC_FOCUS_RING, NC_HAIRLINE, NC_HOVER, NC_TEXT_MUTED } from './ncTokens';

/**
 * NextcloudFilterChips — filtro por tipo, sobre o que já está à vista.
 * -----------------------------------------------------------------------------
 * Filtra o resultado já carregado (pasta atual ou busca recursiva); não vai ao
 * servidor. Os chips com contagem zero são escondidos: um filtro que só pode
 * levar a uma tela vazia é ruído.
 */

export type NextcloudTypeFilter = 'all' | 'folders' | 'docs' | 'pdf' | 'images' | 'media';

export function matchesTypeFilter(entry: NextcloudEntry, filter: NextcloudTypeFilter): boolean {
  switch (filter) {
    case 'folders': return entry.isDir;
    case 'docs': return !entry.isDir && isDocx(entry);
    case 'pdf': return !entry.isDir && isPdf(entry);
    case 'images': return !entry.isDir && isImage(entry);
    case 'media': return !entry.isDir && isMedia(entry);
    default: return true;
  }
}

const FILTERS: Array<{ value: NextcloudTypeFilter; label: string }> = [
  { value: 'all', label: 'Tudo' },
  { value: 'folders', label: 'Pastas' },
  { value: 'docs', label: 'Word' },
  { value: 'pdf', label: 'PDF' },
  { value: 'images', label: 'Imagens' },
  { value: 'media', label: 'Áudio e vídeo' },
];

interface NextcloudFilterChipsProps {
  entries: NextcloudEntry[];
  value: NextcloudTypeFilter;
  onChange: (value: NextcloudTypeFilter) => void;
}

export const NextcloudFilterChips: React.FC<NextcloudFilterChipsProps> = ({ entries, value, onChange }) => {
  const available = FILTERS.filter((filter) =>
    filter.value === 'all'
    || filter.value === value
    || entries.some((entry) => matchesTypeFilter(entry, filter.value)),
  );
  if (available.length <= 1) return null;

  // A linha inteira (com a divisória) mora aqui: quando não há o que filtrar, o
  // componente some sem deixar uma faixa vazia na tela.
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5 ${NC_HAIRLINE}`}
      role="group"
      aria-label="Filtrar por tipo"
    >
      {available.map((filter) => {
        const active = filter.value === value;
        return (
          <button
            key={filter.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active && filter.value !== 'all' ? 'all' : filter.value)}
            className={`inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] transition ${NC_FOCUS_RING} ${
              active
                ? 'border-blue-200 bg-[#e8f0fe] font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200'
                : `${NC_BORDER} ${NC_TEXT_MUTED} ${NC_HOVER}`
            }`}
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
};

export default NextcloudFilterChips;
