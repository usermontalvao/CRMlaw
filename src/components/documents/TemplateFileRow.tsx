// Uma linha do gerenciador de documentos do modelo — o principal e cada anexo.
//
// Antes eram cinco ícones sem rótulo por linha (baixar, editar, substituir,
// posição da assinatura, remover), distinguíveis só pelo `title`. Agora a linha
// diz o que o arquivo é e em que estado está, deixa à vista a ação que falta —
// "Posicionar", quando não há posição de assinatura — e guarda o resto no "⋯".
//
// Componente para poder ser visto fora do login, na bancada `?docspreview=1`.
import React from 'react';
import { FileDown, FileText, GripVertical, Loader2, MoreHorizontal, Pencil, PenTool, Trash2, Upload } from 'lucide-react';

export interface TemplateFileRowProps {
  role: 'main' | 'attachment';
  fileName: string;
  /** Tamanho já formatado; ausente quando o registro legado não guardou. */
  sizeLabel?: string;
  /** Posição do anexo na ordem de envio (1-indexado). */
  position?: number;
  /** O arquivo tem posição de assinatura gravada. */
  signs: boolean;
  menuOpen: boolean;
  busy?: boolean;
  dragging?: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onPosition: () => void;
  onDownload: () => void;
  onReplace?: () => void;
  onRemove: () => void;
  onDragStart?: () => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
}

const menuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-700';

const TemplateFileRow: React.FC<TemplateFileRowProps> = ({
  role,
  fileName,
  sizeLabel,
  position,
  signs,
  menuOpen,
  busy = false,
  dragging = false,
  onToggleMenu,
  onEdit,
  onPosition,
  onDownload,
  onReplace,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
}) => {
  const isMain = role === 'main';
  const roleLabel = isMain ? 'Principal' : `Anexo ${position ?? ''}`.trim();

  return (
    <div
      data-file-row-menu
      draggable={!isMain}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`relative flex items-center gap-3 rounded-lg p-3 transition ${
        isMain
          ? 'border border-primary-200 border-l-4 border-l-primary-500 bg-primary-50/40 dark:border-primary-500/40 dark:border-l-primary-500 dark:bg-primary-500/10'
          : `cursor-move border border-[#e7e5df] bg-slate-50 hover:border-primary-300 dark:border-zinc-800 dark:bg-zinc-800/60 dark:hover:border-primary-500/40 ${dragging ? 'opacity-50' : ''}`
      }`}
    >
      {!isMain && <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-zinc-500" />}

      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
          isMain ? 'bg-primary-100 dark:bg-primary-500/20' : 'bg-slate-200 dark:bg-zinc-700'
        }`}
      >
        <FileText className={`h-5 w-5 ${isMain ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-zinc-300'}`} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-700 dark:text-zinc-100">{fileName}</p>
        <p className="text-xs text-slate-500 dark:text-zinc-400">
          {roleLabel}
          {sizeLabel && ` · ${sizeLabel}`}
          {signs ? (
            <span className="text-emerald-600 dark:text-emerald-400"> · assinatura posicionada</span>
          ) : (
            <span className="text-primary-700 dark:text-primary-400"> · sem posição de assinatura</span>
          )}
        </p>
      </div>

      {signs ? (
        <button
          onClick={onEdit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      ) : (
        <button
          onClick={onPosition}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-100 px-2.5 py-1.5 text-xs font-semibold text-primary-800 transition hover:bg-primary-200 disabled:opacity-50 dark:border-primary-500/40 dark:bg-primary-500/20 dark:text-primary-300"
        >
          <PenTool className="h-3.5 w-3.5" />
          Posicionar
        </button>
      )}

      <button
        type="button"
        onClick={onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Mais ações para ${fileName}`}
        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-2 top-12 z-20 w-56 overflow-hidden rounded-xl border border-[#e7e5df] bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
        >
          <button role="menuitem" onClick={onDownload} disabled={busy} className={menuItemClass}>
            <FileDown className="h-3.5 w-3.5" />
            Baixar arquivo
          </button>
          {signs ? (
            <button
              role="menuitem"
              onClick={onPosition}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
            >
              <PenTool className="h-3.5 w-3.5" />
              Reposicionar assinatura
            </button>
          ) : (
            <button role="menuitem" onClick={onEdit} disabled={busy} className={menuItemClass}>
              <Pencil className="h-3.5 w-3.5" />
              Editar documento
            </button>
          )}
          {onReplace && (
            <button role="menuitem" onClick={onReplace} disabled={busy} className={menuItemClass}>
              <Upload className="h-3.5 w-3.5" />
              Substituir arquivo
            </button>
          )}
          <div className="my-1 h-px bg-[#e7e5df] dark:bg-zinc-700" />
          <button
            role="menuitem"
            onClick={onRemove}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isMain ? 'Remover principal' : 'Remover anexo'}
          </button>
        </div>
      )}
    </div>
  );
};

export default TemplateFileRow;
