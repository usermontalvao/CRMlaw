import React, { useRef, useState } from 'react';
import {
  Copy,
  Download,
  FileImage,
  FileText,
  Info,
  Layers,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Scissors,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import type { NextcloudEntry } from '../../services/nextcloud.service';
import { NcMenu, NcMenuItem, NcMenuSeparator } from './NcMenu';
import { NC_FOCUS_RING, NC_HOVER, NC_TEXT, NC_TEXT_MUTED } from './ncTokens';

/**
 * NextcloudSelectionToolbar — toolbar contextual da seleção.
 * -----------------------------------------------------------------------------
 * Substitui a barra flutuante escura que ficava sobre os arquivos no rodapé:
 * ela tapava as últimas linhas da lista justamente quando havia muita coisa
 * selecionada. Aqui a toolbar toma o lugar do breadcrumb enquanto houver
 * seleção — o mesmo movimento do Drive — e nada fica coberto.
 *
 * As ações por tipo (PDF, Word, imagem) só aparecem quando a seleção inteira as
 * comporta; o resto vai para "Mais ações" em vez de virar uma fileira de ícones
 * que ninguém consegue ler.
 */

interface NextcloudSelectionToolbarProps {
  entries: NextcloudEntry[];
  pdfs: NextcloudEntry[];
  images: NextcloudEntry[];
  docx: NextcloudEntry[];
  busy: boolean;
  convertingDocx: boolean;
  /** Vincular a cliente só existe para uma pasta por vez. */
  linkFolder: NextcloudEntry | null;
  linkLabel: string;
  onLinkFolder: () => void;
  onCopy: () => void;
  onCut: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onPdfTools: () => void;
  onPdfLibrary: () => void;
  onPdfMerge: () => void;
  onOrganizePdf: () => void;
  onImagesToPdf: () => void;
  onDocxToPdf: () => void;
  onProperties: () => void;
  /** O painel lateral é mais útil COM seleção — e a toolbar normal, que tem o
      botão, sai da tela nesse momento. Sem esta entrada não haveria como abri-lo. */
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onClear: () => void;
}

export const NextcloudSelectionToolbar: React.FC<NextcloudSelectionToolbarProps> = ({
  entries,
  pdfs,
  images,
  docx,
  busy,
  convertingDocx,
  linkFolder,
  linkLabel,
  onLinkFolder,
  onCopy,
  onCut,
  onDownload,
  onDelete,
  onPdfTools,
  onPdfLibrary,
  onPdfMerge,
  onOrganizePdf,
  onImagesToPdf,
  onDocxToPdf,
  onProperties,
  detailsOpen,
  onToggleDetails,
  onClear,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const total = entries.length;
  const hasFolder = entries.some((entry) => entry.isDir);
  const allPdf = pdfs.length > 0 && pdfs.length === total;
  const singlePdf = pdfs.length === 1 && total === 1;

  const action = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${NC_TEXT} ${NC_HOVER} ${NC_FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-40`;

  const run = (fn: () => void) => () => {
    setMoreOpen(false);
    fn();
  };

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClear}
        title="Limpar seleção"
        aria-label="Limpar seleção"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
      >
        <X className="h-4 w-4" />
      </button>
      <strong className={`shrink-0 text-sm font-medium ${NC_TEXT}`} aria-live="polite">
        {total === 1 ? '1 item selecionado' : `${total} itens selecionados`}
      </strong>

      <span className="ml-1 hidden h-5 w-px shrink-0 bg-slate-200 sm:block dark:bg-zinc-700" />

      <div className="flex min-w-0 flex-wrap items-center gap-0.5">
        {linkFolder && (
          <button type="button" onClick={onLinkFolder} aria-label={linkLabel} className={action}>
            <UserPlus className="h-4 w-4 text-emerald-600" />
            <span className="hidden sm:inline">{linkLabel}</span>
          </button>
        )}
        <button type="button" onClick={onCopy} aria-label="Copiar" className={action}>
          <Copy className="h-4 w-4 text-slate-500" />
          <span className="hidden sm:inline">Copiar</span>
        </button>
        <button type="button" onClick={onCut} aria-label="Recortar" className={action}>
          <Scissors className="h-4 w-4 text-slate-500" />
          <span className="hidden sm:inline">Recortar</span>
        </button>
        <button type="button" onClick={onDownload} aria-label="Baixar" className={action}>
          <Download className="h-4 w-4 text-slate-500" />
          <span className="hidden sm:inline">Baixar{total > 1 || hasFolder ? ' (ZIP)' : ''}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Apagar"
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 ${NC_FOCUS_RING}`}
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden sm:inline">Apagar</span>
        </button>

        {allPdf && (
          <button type="button" onClick={singlePdf ? onPdfTools : onPdfLibrary} aria-label="Ferramentas de PDF" className={action}>
            <Wrench className="h-4 w-4 text-red-500" />
            <span className="hidden md:inline">{singlePdf ? 'Ferramentas PDF' : `Ferramentas PDF (${pdfs.length})`}</span>
          </button>
        )}
        {docx.length > 0 && (
          <button type="button" onClick={onDocxToPdf} disabled={convertingDocx} aria-label="Converter Word em PDF" className={action}>
            {convertingDocx ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : <FileText className="h-4 w-4 text-blue-600" />}
            <span className="hidden md:inline">{docx.length === 1 ? 'Converter em PDF' : `${docx.length} Word → PDF`}</span>
          </button>
        )}
        {images.length > 0 && (
          <button type="button" onClick={onImagesToPdf} aria-label="Converter imagens em PDF" className={action}>
            <FileImage className="h-4 w-4 text-violet-600" />
            <span className="hidden md:inline">{images.length === 1 ? 'Imagem → PDF' : `${images.length} imagens → PDF`}</span>
          </button>
        )}

        <div className="relative">
          <button
            ref={moreRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label="Mais ações para a seleção"
            title="Mais ações"
            onClick={() => setMoreOpen((current) => !current)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <NcMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} align="right" label="Mais ações para a seleção" widthClassName="w-72">
            {singlePdf && (
              <NcMenuItem icon={<Layers className="h-4 w-4 text-indigo-600" />} onClick={run(onOrganizePdf)}>
                Organizar páginas
              </NcMenuItem>
            )}
            {pdfs.length >= 2 && (
              <NcMenuItem icon={<FileText className="h-4 w-4 text-red-500" />} onClick={run(onPdfMerge)} disabled={busy}>
                Mesclar {pdfs.length} PDFs
              </NcMenuItem>
            )}
            {allPdf && !singlePdf && (
              <NcMenuItem icon={<Wrench className="h-4 w-4 text-red-500" />} onClick={run(onPdfTools)}>
                Abrir o primeiro PDF nas ferramentas
              </NcMenuItem>
            )}
            {(singlePdf || pdfs.length >= 2 || allPdf) && <NcMenuSeparator />}
            <NcMenuItem icon={<PanelRight className="h-4 w-4 text-slate-500" />} onClick={run(onToggleDetails)}>
              {detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
            </NcMenuItem>
            <NcMenuItem icon={<Info className="h-4 w-4 text-blue-600" />} onClick={run(onProperties)}>
              {total === 1 ? 'Propriedades' : `Propriedades de ${total} itens`}
            </NcMenuItem>
          </NcMenu>
        </div>
      </div>
    </div>
  );
};

export default NextcloudSelectionToolbar;
