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
import React, { useEffect, useState } from 'react';
import TemplateCard from '../components/documents/TemplateCard';
import TemplateFileRow from '../components/documents/TemplateFileRow';
import TemplateFillLinkPanel, { type TemplateFillLinkKind } from '../components/documents/TemplateFillLinkPanel';
import LinkGenerationOverlay from '../components/documents/LinkGenerationOverlay';
import DocumentLivePreview, { type PreviewDocument } from '../components/documents/DocumentLivePreview';
import { AlignmentType, Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
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

// A prévia desenha .docx de verdade, então a bancada precisa de arquivos de
// verdade — montados aqui com a mesma biblioteca `docx` que o CRM já usa, para
// dar o que conferir: título centralizado em negrito, corpo justificado e os
// `[[campos]]` no meio do texto.
const montarDocxDeExemplo = async (titulo: string, corpo: string[]): Promise<Blob> => {
  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: titulo, bold: true, size: 26 })],
          }),
          new Paragraph({ children: [] }),
          ...corpo.map(
            (linha) =>
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                children: [new TextRun({ text: linha, size: 24 })],
              }),
          ),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
};

const VALORES_DA_FICHA: Record<string, string> = {
  'NOME COMPLETO': 'MARIA APARECIDA DA SILVA',
  nacionalidade: 'brasileira',
  'estado civil': 'casada',
  'profissão': 'costureira',
  CPF: '034.567.890-12',
  'endereço': 'Rua das Acácias, nº 148, Bairro Coxipó',
  cidade: 'Cuiabá',
  estado: 'MT',
  CEP: '78090-000',
  comarca: 'Cuiabá — MT',
  data: '23 de agosto de 2026',
};

const useDocumentosDeExemplo = () => {
  const [docs, setDocs] = useState<PreviewDocument[]>([]);
  useEffect(() => {
    let ativo = true;
    (async () => {
      const principal = await montarDocxDeExemplo('PROCURAÇÃO AD JUDICIA ET EXTRA', [
        '[[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]], inscrita no CPF sob o nº [[CPF]], residente e domiciliada na [[endereço]], [[cidade]] – [[estado]], CEP [[CEP]], nomeia e constitui seu bastante procurador o advogado abaixo assinado.',
        'Outorga-lhe os poderes da cláusula ad judicia et extra, para o foro em geral, na comarca de [[comarca]], podendo propor as ações competentes e defendê-la nas contrárias, em especial para [[finalidade]], inclusive em face de [[reu]].',
        '',
        '[[cidade]] – [[estado]], [[data]].',
        '',
        '[[ASSINATURA]]',
        '[[NOME COMPLETO]]',
      ]);
      const anexo = await montarDocxDeExemplo('DECLARAÇÃO DE HIPOSSUFICIÊNCIA', [
        'Eu, [[NOME COMPLETO]], inscrita no CPF sob o nº [[CPF]], declaro, sob as penas da lei, não ter condições de arcar com as custas do processo sem prejuízo do próprio sustento.',
        '',
        '[[cidade]] – [[estado]], [[data]].',
        '[[ASSINATURA_2]]',
      ]);
      if (!ativo) return;
      setDocs([
        { id: 'principal', name: 'procuracao-ad-judicia.docx', blob: principal, role: 'principal' },
        { id: 'anexo-1', name: 'declaracao-hipossuficiencia.docx', blob: anexo, role: 'anexo' },
      ]);
    })();
    return () => { ativo = false; };
  }, []);
  return docs;
};

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
  const [copiado, setCopiado] = useState<TemplateFillLinkKind | null>('unique');
  const documentosDeExemplo = useDocumentosDeExemplo();
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
          nota="A ação principal copia o link do cliente; o segundo cartão está com o menu ⋯ aberto."
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

        <Bloco
          titulo="Novo documento — a folha ao vivo"
          nota="Azul veio da ficha do cliente; laranja é o que ainda falta. Faltam finalidade e réu."
        >
          <div className="max-w-2xl rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <DocumentLivePreview
              documents={documentosDeExemplo}
              resolve={(chave) => VALORES_DA_FICHA[chave] ?? ''}
              loading={documentosDeExemplo.length === 0}
            />
          </div>
        </Bloco>

        <Bloco
          titulo="A espera, entre o clique e o modal"
          nota="Branca sempre: a antiga seguia o tema do sistema operacional e abria preta por cima do CRM claro."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-[#faf9f7] dark:bg-zinc-900">
              <LinkGenerationOverlay phase="working" variant="inline" templateName="KIT AUX. POR INCAPACIDADE TEMPORÁRIA" />
            </div>
            <div className="rounded-2xl bg-[#faf9f7] dark:bg-zinc-900">
              <LinkGenerationOverlay phase="done" variant="inline" />
            </div>
          </div>
        </Bloco>

        <Bloco
          titulo="Link de preenchimento — o que abre ao copiar"
          nota="Dois links: o de uso único (novo a cada abertura) e o fixo de divulgação."
        >
          <div className="max-w-xl rounded-2xl border border-[#e7e5df] bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <TemplateFillLinkPanel
              uniqueLink="https://jurius.com.br/#/preencher/fd2d328b-7856-4119-abb4-eae8891a122e"
              permanentLink="https://jurius.com.br/#/p/kit-aux-por-incapacidade-temporaria-8c6k"
              copiedKind={copiado}
              onCopy={setCopiado}
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
