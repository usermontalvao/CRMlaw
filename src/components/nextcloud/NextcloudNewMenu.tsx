import React, { useRef, useState } from 'react';
import { FileCode2, FileText, FolderPlus, FolderUp, NotebookPen, Plus, Upload } from 'lucide-react';
import { NcMenu, NcMenuItem, NcMenuSeparator } from './NcMenu';
import { NC_BORDER, NC_FOCUS_RING, NC_SHADOW, NC_TEXT_STRONG } from './ncTokens';

/**
 * NextcloudNewMenu — o botão "+ Novo" da barra lateral.
 * -----------------------------------------------------------------------------
 * Junta num só lugar tudo que CRIA conteúdo: as ações de criar estavam
 * espalhadas entre ícones da toolbar (nova pasta, bloco de notas, enviar) e o
 * menu de contexto do fundo da pasta, então quem não conhecia o clique-direito
 * simplesmente não achava "novo documento Word".
 */

interface NextcloudNewMenuProps {
  onNewFolder: () => void;
  onNewWord: () => void;
  onNewTextNote: () => void;
  onNewMarkdown: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  disabled?: boolean;
}

export const NextcloudNewMenu: React.FC<NextcloudNewMenuProps> = ({
  onNewFolder,
  onNewWord,
  onNewTextNote,
  onNewMarkdown,
  onUploadFiles,
  onUploadFolder,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-12 items-center gap-3 rounded-2xl border bg-white pl-4 pr-5 text-sm font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${NC_BORDER} ${NC_TEXT_STRONG} ${NC_SHADOW} ${NC_FOCUS_RING}`}
      >
        <Plus className="h-5 w-5 text-blue-600" />
        Novo
      </button>

      <NcMenu open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} label="Criar ou enviar" widthClassName="w-64">
        <NcMenuItem icon={<FolderPlus className="h-4 w-4 text-blue-600" />} onClick={run(onNewFolder)}>
          Nova pasta
        </NcMenuItem>
        <NcMenuItem icon={<FileText className="h-4 w-4 text-blue-600" />} onClick={run(onNewWord)}>
          Documento Word
        </NcMenuItem>
        <NcMenuItem icon={<NotebookPen className="h-4 w-4 text-amber-600" />} onClick={run(onNewTextNote)}>
          Nota de texto
        </NcMenuItem>
        <NcMenuItem icon={<FileCode2 className="h-4 w-4 text-slate-500" />} onClick={run(onNewMarkdown)}>
          Arquivo Markdown
        </NcMenuItem>
        <NcMenuSeparator />
        <NcMenuItem icon={<Upload className="h-4 w-4 text-emerald-600" />} onClick={run(onUploadFiles)}>
          Enviar arquivos
        </NcMenuItem>
        <NcMenuItem icon={<FolderUp className="h-4 w-4 text-emerald-600" />} onClick={run(onUploadFolder)}>
          Enviar pasta
        </NcMenuItem>
      </NcMenu>
    </div>
  );
};

export default NextcloudNewMenu;
