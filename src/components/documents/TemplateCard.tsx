// O cartão de um modelo na aba "Gerenciar templates".
//
// Vivia solto dentro de DocumentsModule com sete botões do mesmo peso — Link,
// Documentos, Baixar, Editar, Formulário, Assinatura e Excluir — e sem o único
// que importa no dia a dia: usar o modelo. Agora tem uma ação de primeiro nível
// e um menu "⋯" para o resto.
//
// Virou componente para poder ser visto fora do login, na bancada
// `?docspreview=1`.
import React from 'react';
import {
  ArrowRight,
  FileDown,
  FileText,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenTool,
  Settings,
  Trash2,
} from 'lucide-react';
import type { DocumentTemplate } from '../../types/document.types';

export interface TemplateCardProps {
  template: DocumentTemplate;
  /** Quantos anexos o modelo tem, além do principal. */
  attachmentsCount: number;
  /** O modelo tem ao menos uma posição de assinatura gravada. */
  signs: boolean;
  menuOpen: boolean;
  creatingLink?: boolean;
  downloading?: boolean;
  deleting?: boolean;
  onToggleMenu: () => void;
  onUse: () => void;
  onGenerateLink: () => void;
  onOpenFiles: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onFormConfig: () => void;
  onDelete: () => void;
}

const menuItemClass =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-700';

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  attachmentsCount,
  signs,
  menuOpen,
  creatingLink = false,
  downloading = false,
  deleting = false,
  onToggleMenu,
  onUse,
  onGenerateLink,
  onOpenFiles,
  onDownload,
  onEdit,
  onFormConfig,
  onDelete,
}) => {
  const filesLabel = template.file_path
    ? attachmentsCount > 0
      ? `1 principal + ${attachmentsCount} anexo(s)`
      : '1 arquivo'
    : attachmentsCount > 0
      ? `${attachmentsCount} arquivo(s)`
      : 'Sem arquivos';
  const kindLabel = template.file_path || attachmentsCount > 0 ? 'DOCX' : 'Texto';
  const busy = creatingLink || downloading || deleting;

  return (
    <div
      data-template-card-menu
      className="group relative flex flex-col rounded-xl border border-[#e7e5df] bg-[#f8f7f5] p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-[#e7e5df] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {kindLabel}
        </span>
        <button
          type="button"
          onClick={onToggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Mais ações para ${template.name}`}
          className={`-mr-1 -mt-1 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition hover:bg-slate-200/70 dark:hover:bg-zinc-800 ${
            menuOpen
              ? 'bg-slate-200/70 text-slate-900 dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-slate-500 dark:text-zinc-400'
          }`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </button>
      </div>

      <h5 className="truncate font-semibold text-slate-900 dark:text-zinc-100" title={template.name}>
        {template.name}
      </h5>
      {template.description && (
        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-zinc-400">{template.description}</p>
      )}

      <div className="mt-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-zinc-500" />
          <span className="truncate">{filesLabel}</span>
        </span>
        {signs && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <PenTool className="h-3.5 w-3.5" />
              assina
            </span>
          </>
        )}
      </div>

      <button
        onClick={onUse}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600"
      >
        Usar modelo
        <ArrowRight className="h-4 w-4" />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-3 top-11 z-20 w-56 overflow-hidden rounded-xl border border-[#e7e5df] bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
        >
          <button role="menuitem" onClick={onGenerateLink} disabled={creatingLink} className={menuItemClass}>
            {creatingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Gerar link público
          </button>
          <button role="menuitem" onClick={onOpenFiles} className={menuItemClass}>
            <FileText className="h-3.5 w-3.5" />
            Documentos e anexos
          </button>
          <button role="menuitem" onClick={onDownload} disabled={downloading} className={menuItemClass}>
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Baixar arquivo
          </button>
          <button role="menuitem" onClick={onEdit} className={menuItemClass}>
            <Pencil className="h-3.5 w-3.5" />
            Editar modelo
          </button>
          <button role="menuitem" onClick={onFormConfig} className={menuItemClass}>
            <Settings className="h-3.5 w-3.5" />
            Campos do formulário
          </button>
          <button
            role="menuitem"
            onClick={onOpenFiles}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
          >
            <PenTool className="h-3.5 w-3.5" />
            Assinaturas
          </button>
          <div className="my-1 h-px bg-[#e7e5df] dark:bg-zinc-700" />
          <button
            role="menuitem"
            onClick={onDelete}
            disabled={deleting}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remover modelo
          </button>
        </div>
      )}
    </div>
  );
};

export default TemplateCard;
