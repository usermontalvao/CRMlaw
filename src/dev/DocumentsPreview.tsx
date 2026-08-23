// DEV-ONLY: bancada do módulo Documentos (?docspreview=1).
//
// O cartão do modelo e as linhas de "Documentos e anexos" vivem atrás do login
// e, no caso das linhas, dentro de um modal que só abre com dados no banco.
// Aqui as duas peças ficam lado a lado — as MESMAS componentes que a tela usa,
// não uma cópia —, nos estados que interessam: modelo que assina e modelo que
// não assina, menu fechado e menu aberto, arquivo com e sem posição de
// assinatura. Em cima o tema claro, embaixo o escuro.
//
// O fundo imita a tela do CRM (creme #f8f7f5 no claro, zinc-950 no escuro): é
// sobre ela que os cartões precisam continuar sendo peças, e não recortes.
import React, { useState } from 'react';
import TemplateCard from '../components/documents/TemplateCard';
import TemplateFileRow from '../components/documents/TemplateFileRow';
import type { DocumentTemplate } from '../types/document.types';

const modelo = (over: Partial<DocumentTemplate>): DocumentTemplate => ({
  id: 'x',
  name: 'Modelo',
  content: '',
  created_at: '2026-08-01T12:00:00Z',
  updated_at: '2026-08-01T12:00:00Z',
  ...over,
});

const MODELOS: Array<{ template: DocumentTemplate; anexos: number; assina: boolean }> = [
  {
    template: modelo({
      id: 'a',
      name: 'Procuração ad judicia',
      description: 'Procuração geral para atuação em juízo',
      file_path: 'templates/procuracao.docx',
    }),
    anexos: 2,
    assina: true,
  },
  {
    template: modelo({
      id: 'b',
      name: 'Contrato de honorários',
      description: 'Contrato padrão com cláusula de êxito',
      file_path: 'templates/honorarios.docx',
    }),
    anexos: 0,
    assina: true,
  },
  {
    template: modelo({
      id: 'c',
      name: 'Declaração de hipossuficiência',
      description: 'Texto simples, sem arquivo anexado',
    }),
    anexos: 0,
    assina: false,
  },
];

const Bloco: React.FC<{ titulo: string; nota: string; children: React.ReactNode }> = ({ titulo, nota, children }) => (
  <section className="flex flex-col gap-3">
    <div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{titulo}</h2>
      <p className="text-xs text-slate-500 dark:text-zinc-400">{nota}</p>
    </div>
    {children}
  </section>
);

const Palco: React.FC<{ escuro?: boolean }> = ({ escuro = false }) => {
  const [cardMenu, setCardMenu] = useState<string | null>('b');
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const nada = () => {};

  return (
    <div className={escuro ? 'dark' : undefined}>
      <div className="flex flex-col gap-8 bg-[#f8f7f5] p-8 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-zinc-100 dark:text-zinc-900">
            {escuro ? 'tema escuro' : 'tema claro'}
          </span>
          <span className="text-xs text-slate-500 dark:text-zinc-400">
            {escuro ? 'antes, esta parte do módulo continuava creme' : 'laranja da marca no lugar do indigo'}
          </span>
        </div>

        <Bloco
          titulo="Cartão do modelo — aba Gerenciar templates"
          nota="Uma ação de primeiro nível; o segundo cartão está com o menu ⋯ aberto."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODELOS.map(({ template, anexos, assina }) => (
              <TemplateCard
                key={template.id}
                template={template}
                attachmentsCount={anexos}
                signs={assina}
                menuOpen={cardMenu === template.id}
                onToggleMenu={() => setCardMenu(cardMenu === template.id ? null : template.id)}
                onUse={nada}
                onGenerateLink={nada}
                onOpenFiles={nada}
                onDownload={nada}
                onEdit={nada}
                onFormConfig={nada}
                onDelete={nada}
              />
            ))}
          </div>
        </Bloco>

        <Bloco
          titulo="Documentos e anexos"
          nota="O anexo 2 não tem posição de assinatura — a pendência vira botão; o resolvido vira texto."
        >
          <div className="flex max-w-3xl flex-col gap-2 rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <TemplateFileRow
              role="main"
              fileName="procuracao-ad-judicia.docx"
              sizeLabel="24 KB"
              signs
              menuOpen={rowMenu === 'main'}
              onToggleMenu={() => setRowMenu(rowMenu === 'main' ? null : 'main')}
              onEdit={nada}
              onPosition={nada}
              onDownload={nada}
              onReplace={nada}
              onRemove={nada}
            />
            <TemplateFileRow
              role="attachment"
              position={1}
              fileName="declaracao-hipossuficiencia.docx"
              sizeLabel="11 KB"
              signs
              menuOpen={rowMenu === 'a1'}
              onToggleMenu={() => setRowMenu(rowMenu === 'a1' ? null : 'a1')}
              onEdit={nada}
              onPosition={nada}
              onDownload={nada}
              onRemove={nada}
            />
            <TemplateFileRow
              role="attachment"
              position={2}
              fileName="termo-de-representacao.docx"
              sizeLabel="9 KB"
              signs={false}
              menuOpen={rowMenu === 'a2'}
              onToggleMenu={() => setRowMenu(rowMenu === 'a2' ? null : 'a2')}
              onEdit={nada}
              onPosition={nada}
              onDownload={nada}
              onRemove={nada}
            />
          </div>
        </Bloco>
      </div>
    </div>
  );
};

const DocumentsPreview: React.FC = () => (
  <div className="min-h-screen bg-slate-200">
    <Palco />
    <Palco escuro />
  </div>
);

export default DocumentsPreview;
