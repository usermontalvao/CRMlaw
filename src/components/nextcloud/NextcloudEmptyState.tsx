import React from 'react';
import { FolderOpen, SearchX, Upload } from 'lucide-react';
import { NC_FOCUS_RING, NC_TEXT_MUTED, NC_TEXT_STRONG } from './ncTokens';

/**
 * NextcloudEmptyState — pasta vazia e busca sem resultado.
 * -----------------------------------------------------------------------------
 * A pasta vazia oferece uma saída (enviar arquivos); a busca sem resultado não
 * inventa uma — o que a pessoa quer ali é corrigir o termo, e um botão de envio
 * no meio disso só atrapalharia.
 */

interface NextcloudEmptyStateProps {
  searchTerm: string | null;
  /** Há itens na pasta, mas o chip de tipo escondeu todos. */
  filterActive?: boolean;
  onClearFilter?: () => void;
  onUpload: () => void;
}

export const NextcloudEmptyState: React.FC<NextcloudEmptyStateProps> = ({
  searchTerm,
  filterActive = false,
  onClearFilter,
  onUpload,
}) => {
  const isBlocked = Boolean(searchTerm) || filterActive;
  const title = searchTerm
    ? `Nenhum resultado para “${searchTerm}”`
    : filterActive
      ? 'Nada deste tipo por aqui'
      : 'Esta pasta está vazia';
  const hint = searchTerm
    ? 'A busca percorre esta pasta e todas as subpastas. Tente outro termo.'
    : filterActive
      ? 'O filtro de tipo escondeu os itens desta pasta.'
      : 'Arraste arquivos para cá ou use o botão Novo para criar um documento.';

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800">
        {isBlocked ? <SearchX className="h-7 w-7 text-slate-400" /> : <FolderOpen className="h-7 w-7 text-slate-400" />}
      </span>
      <p className={`text-sm font-medium ${NC_TEXT_STRONG}`}>{title}</p>
      <p className={`max-w-sm text-xs ${NC_TEXT_MUTED}`}>{hint}</p>
      {filterActive && !searchTerm && onClearFilter && (
        <button
          type="button"
          onClick={onClearFilter}
          className={`mt-1 inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 px-4 text-[13px] font-medium transition hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${NC_TEXT_STRONG} ${NC_FOCUS_RING}`}
        >
          Mostrar tudo
        </button>
      )}
      {!isBlocked && (
        <button
          type="button"
          onClick={onUpload}
          className={`mt-1 inline-flex h-9 items-center gap-2 rounded-full bg-blue-600 px-4 text-[13px] font-medium text-white transition hover:bg-blue-700 ${NC_FOCUS_RING}`}
        >
          <Upload className="h-4 w-4" /> Enviar arquivos
        </button>
      )}
    </div>
  );
};

export default NextcloudEmptyState;
