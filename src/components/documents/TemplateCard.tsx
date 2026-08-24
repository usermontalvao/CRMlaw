// O cartão de um modelo na Biblioteca.
//
// Vivia solto dentro de DocumentsModule com sete botões do mesmo peso — Link,
// Documentos, Baixar, Editar, Formulário, Assinatura e Excluir — e nenhum era o
// principal.
//
// A ação de primeiro nível é o LINK do cliente, porque é o que o escritório faz
// todo dia com um modelo: mandar a pessoa preencher. Ela é laranja de CONTORNO,
// não de fundo: o laranja cheio já é do "Novo modelo" e da aba ativa, e três
// botões laranja na mesma tela apagam a hierarquia em vez de criá-la.
//
// O menu "⋯" é agrupado e cada item diz o que faz. "Editar modelo" era o pior
// nome da tela: ele não abre o .docx, abre o nome, a descrição e o texto do
// registro — quem quer trocar o arquivo vai em "Documentos e anexos".
//
// Componente próprio para poder ser visto fora do login, na bancada
// `?docspreview=1`.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Copy,
  FileDown,
  FileText,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  PenTool,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { DocumentTemplate } from '../../types/document.types';
import { zc } from '../../styles/layers';

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
  duplicating?: boolean;
  onToggleMenu: () => void;
  onUse: () => void;
  onGenerateLink: () => void;
  onOpenFiles: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onFormConfig: () => void;
  onCustomFields: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const Secao: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
    {children}
  </p>
);

const Item: React.FC<{
  icon: React.ReactNode;
  label: string;
  caption?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}> = ({ icon, label, caption, onClick, disabled, tone = 'default' }) => (
  <button
    role="menuitem"
    onClick={onClick}
    disabled={disabled}
    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition disabled:opacity-60 ${
      tone === 'danger'
        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
        : 'text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700'
    }`}
  >
    <span className="mt-0.5 flex-shrink-0">{icon}</span>
    <span className="min-w-0">
      <span className="block text-xs font-medium">{label}</span>
      {caption && (
        <span className="block text-[11px] leading-tight text-slate-400 dark:text-zinc-500">{caption}</span>
      )}
    </span>
  </button>
);

const chipClass =
  'inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600 dark:bg-zinc-800 dark:text-zinc-400';

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  attachmentsCount,
  signs,
  menuOpen,
  creatingLink = false,
  downloading = false,
  deleting = false,
  duplicating = false,
  onToggleMenu,
  onUse,
  onGenerateLink,
  onOpenFiles,
  onDownload,
  onEdit,
  onFormConfig,
  onCustomFields,
  onDuplicate,
  onDelete,
}) => {
  const ehDocx = !!template.file_path || attachmentsCount > 0;
  const filesLabel = template.file_path
    ? attachmentsCount > 0
      ? `1 + ${attachmentsCount} anexos`
      : '1 arquivo'
    : attachmentsCount > 0
      ? `${attachmentsCount} arquivos`
      : 'sem arquivo';
  const busy = creatingLink || downloading || deleting || duplicating;

  // O menu vive num portal porque a Biblioteca rola por dentro: ancorado no
  // cartão, ele era CORTADO pelo contêiner assim que o cartão ficava perto do
  // rodapé — os últimos itens simplesmente sumiam.
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const [posicao, setPosicao] = useState<
    { top: number; left: number; abreParaCima: boolean; alturaMaxima: number } | null
  >(null);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setPosicao(null);
      return;
    }

    const medir = () => {
      const alvo = gatilhoRef.current?.getBoundingClientRect();
      if (!alvo) return;

      const LARGURA = 256;
      const MARGEM = 12;
      const FOLGA = 6;

      // Abre para o lado que tiver mais espaço e usa TODO ele. Um teto fixo
      // cortava o menu mesmo quando sobrava tela.
      const espacoAbaixo = window.innerHeight - alvo.bottom - MARGEM - FOLGA;
      const espacoAcima = alvo.top - MARGEM - FOLGA;
      const abreParaCima = espacoAbaixo < espacoAcima;

      setPosicao({
        top: abreParaCima ? alvo.top - FOLGA : alvo.bottom + FOLGA,
        left: Math.min(Math.max(MARGEM, alvo.right - LARGURA), window.innerWidth - LARGURA - MARGEM),
        abreParaCima,
        alturaMaxima: Math.max(220, abreParaCima ? espacoAcima : espacoAbaixo),
      });
    };

    medir();
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
    };
  }, [menuOpen]);

  return (
    <article
      data-template-card-menu
      className="group relative flex flex-col rounded-2xl border border-[#e7e5df] bg-white p-4 transition hover:border-primary-200 hover:shadow-[0_10px_30px_-18px_rgba(15,23,42,.45)] dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-primary-500/40"
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
            ehDocx
              ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400'
              : 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          <FileText className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h5
            className="truncate text-[15px] font-semibold leading-tight text-slate-900 dark:text-zinc-100"
            title={template.name}
          >
            {template.name}
          </h5>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-zinc-400">
            {template.description || (ehDocx ? 'Documento do Word' : 'Modelo em texto')}
          </p>
        </div>

        <button
          ref={gatilhoRef}
          type="button"
          onClick={onToggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Mais ações para ${template.name}`}
          className={`-mr-1 -mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition hover:bg-slate-100 dark:hover:bg-zinc-800 ${
            menuOpen
              ? 'bg-slate-100 text-slate-900 dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-slate-400 dark:text-zinc-500'
          }`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={chipClass}>{ehDocx ? 'DOCX' : 'Texto'}</span>
        <span className={chipClass}>{filesLabel}</span>
        {signs && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
            <PenTool className="h-3 w-3" />
            assina
          </span>
        )}
      </div>

      <button
        onClick={onGenerateLink}
        disabled={creatingLink}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2.5 text-sm font-semibold text-primary-700 transition hover:border-primary-300 hover:bg-primary-100 disabled:opacity-70 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20"
      >
        {creatingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {creatingLink ? 'Gerando link...' : 'Link para o cliente'}
      </button>

      {menuOpen && posicao && createPortal(
        <div
          role="menu"
          data-template-card-menu
          className={`fixed ${zc.POPOVER} w-64 overflow-y-auto overscroll-contain rounded-xl border border-[#e7e5df] bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800`}
          style={{
            top: posicao.top,
            left: posicao.left,
            maxHeight: posicao.alturaMaxima,
            transform: posicao.abreParaCima ? 'translateY(-100%)' : undefined,
          }}
        >
          <Secao>Usar</Secao>
          <Item
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            label="Gerar aqui, sem link"
            caption="Preencher e baixar agora"
            onClick={onUse}
          />

          <Secao>Arquivos</Secao>
          <Item
            icon={<FileText className="h-3.5 w-3.5" />}
            label="Documentos e anexos"
            caption="Trocar o .docx e ordenar os anexos"
            onClick={onOpenFiles}
          />
          <Item
            icon={<PenTool className="h-3.5 w-3.5" />}
            label="Posições de assinatura"
            caption="Onde cada pessoa assina"
            onClick={onOpenFiles}
          />
          <Item
            icon={downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            label="Baixar o modelo em branco"
            caption="O .docx como está, sem preencher"
            onClick={onDownload}
            disabled={downloading}
          />

          <Secao>Campos</Secao>
          <Item
            icon={<Settings className="h-3.5 w-3.5" />}
            label="Formulário do link público"
            caption="O que o cliente vê e preenche"
            onClick={onFormConfig}
          />
          <Item
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Campos personalizados"
            caption="Exibir ou ocultar na geração interna"
            onClick={onCustomFields}
          />

          <Secao>Este modelo</Secao>
          <Item
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="Nome, descrição e texto"
            caption="Não mexe no arquivo .docx"
            onClick={onEdit}
          />
          <Item
            icon={duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            label="Duplicar"
            caption="Cópia com anexos, campos e assinaturas"
            onClick={onDuplicate}
            disabled={duplicating}
          />
          <div className="my-1 h-px bg-[#e7e5df] dark:bg-zinc-700" />
          <Item
            icon={deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            label="Remover modelo"
            onClick={onDelete}
            disabled={deleting}
            tone="danger"
          />
        </div>,
        document.body,
      )}
    </article>
  );
};

export default TemplateCard;
