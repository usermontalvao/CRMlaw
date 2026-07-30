import React from 'react';
import { Keyboard } from 'lucide-react';
import { Modal, ModalBody } from '../ui/Modal';
import { NC_HAIRLINE, NC_TEXT, NC_TEXT_MUTED, NC_TEXT_STRONG } from './ncTokens';

/**
 * NextcloudShortcutsHelp — a lista de atalhos do explorador (tecla `?`).
 * -----------------------------------------------------------------------------
 * O módulo sempre teve atalhos de explorador de arquivos (Alt+setas, F2,
 * Ctrl+C/X/V, seleção por intervalo), e não havia UM lugar que os contasse: quem
 * não adivinhasse, clicava.
 *
 * Esta lista é DOCUMENTAÇÃO do que o teclado faz de verdade — cada linha aqui
 * corresponde a um ramo do tratador de teclas do NextcloudBrowser. Se um atalho
 * mudar lá, muda aqui; uma ajuda que mente é pior do que ajuda nenhuma.
 */

/** ⌘ no Mac, Ctrl no resto — mostrar a tecla errada é o mesmo que não mostrar. */
function commandKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const platform = navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/.test(platform) ? '⌘' : 'Ctrl';
}

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className={`inline-flex h-6 min-w-[26px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 font-sans text-[11px] font-medium text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-slate-300`}>
    {children}
  </kbd>
);

const Row: React.FC<{ keys: React.ReactNode; children: React.ReactNode }> = ({ keys, children }) => (
  <div className={`flex items-center justify-between gap-4 border-b py-2 last:border-b-0 ${NC_HAIRLINE}`}>
    <span className={`text-[13px] ${NC_TEXT}`}>{children}</span>
    <span className="flex shrink-0 items-center gap-1">{keys}</span>
  </div>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-5 last:mb-0">
    <h3 className={`mb-1 text-[10px] font-bold uppercase tracking-[0.14em] ${NC_TEXT_MUTED}`}>{title}</h3>
    {children}
  </section>
);

export const NextcloudShortcutsHelp: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const cmd = commandKeyLabel();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Atalhos de teclado"
      subtitle="Explorador de arquivos do Nextcloud"
      icon={<Keyboard className="h-5 w-5" />}
      accentBarClassName="bg-blue-600"
      iconContainerClassName="bg-blue-600 text-white"
      zIndex={160}
    >
      <ModalBody>
        <Group title="Navegação">
          <Row keys={<><Key>Alt</Key><Key>←</Key></>}>Voltar</Row>
          <Row keys={<><Key>Alt</Key><Key>→</Key></>}>Avançar</Row>
          <Row keys={<><Key>Alt</Key><Key>↑</Key></>}>Subir um nível</Row>
          <Row keys={<><Key>↑</Key><Key>↓</Key><Key>←</Key><Key>→</Key></>}>Mover entre os itens</Row>
          <Row keys={<Key>Enter</Key>}>Abrir (pasta, editor ou visualização)</Row>
          <Row keys={<Key>Espaço</Key>}>Pré-visualizar sem abrir</Row>
        </Group>

        <Group title="Seleção">
          <Row keys={<><Key>{cmd}</Key><Key>A</Key></>}>Selecionar tudo</Row>
          <Row keys={<><Key>Shift</Key><Key>↑</Key><Key>↓</Key></>}>Estender a seleção</Row>
          <Row keys={<><Key>{cmd}</Key><span className={`text-[11px] ${NC_TEXT_MUTED}`}>+ clique</span></>}>Marcar e desmarcar item</Row>
          <Row keys={<><Key>Shift</Key><span className={`text-[11px] ${NC_TEXT_MUTED}`}>+ clique</span></>}>Selecionar um intervalo</Row>
          <Row keys={<Key>Esc</Key>}>Limpar a seleção</Row>
        </Group>

        <Group title="Arquivos">
          <Row keys={<><Key>{cmd}</Key><Key>C</Key></>}>Copiar</Row>
          <Row keys={<><Key>{cmd}</Key><Key>X</Key></>}>Recortar</Row>
          <Row keys={<><Key>{cmd}</Key><Key>V</Key></>}>Colar na pasta atual</Row>
          <Row keys={<Key>F2</Key>}>Renomear</Row>
          <Row keys={<Key>?</Key>}>Abrir esta lista</Row>
        </Group>

        <p className={`mt-4 text-[11px] ${NC_TEXT_MUTED}`}>
          Os atalhos ficam inativos enquanto um campo de texto está em foco ou uma janela está aberta —
          para não brigar com a busca nem com o editor.
        </p>
        <p className={`mt-2 text-[11px] ${NC_TEXT_STRONG}`}>
          Apagar não tem atalho de propósito: o módulo ainda não tem Lixeira, então não há como desfazer por aqui.
        </p>
      </ModalBody>
    </Modal>
  );
};

export default NextcloudShortcutsHelp;
