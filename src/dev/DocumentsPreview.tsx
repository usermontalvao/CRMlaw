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
import SidePanel from '../components/documents/SidePanel';
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

// A faixa de etapas da tela de gerar, nos três momentos. O conteúdo aqui é de
// mentira; o que importa é o movimento: a etapa resolvida vira trilho em pé e
// devolve a largura para a seguinte.
const FaixaDeEtapas: React.FC<{ etapa: 'template' | 'data' | 'preview'; gerado?: boolean }> = ({ etapa, gerado }) => {
  const [ativa, setAtiva] = useState(etapa);
  const abreModelo = ativa === 'template';
  const abreDados = ativa === 'data';
  const abrePrevia = ativa === 'preview';
  const mostraDados = etapa !== 'template';

  return (
    <div className="@container">
      <div className="flex min-h-[420px] flex-col gap-4 @lg:flex-row @lg:items-stretch">
        <SidePanel
          step={1}
          title="Escolha o modelo"
          hint="O documento que vai ser gerado"
          summary="KIT AUX. POR INCAPACIDADE TEMPORÁRIA"
          open={abreModelo}
          onToggle={() => setAtiva('template')}
          done={!abreModelo}
        >
          <div className="space-y-2">
            {['Procuração ad judicia', 'Contrato de honorários', 'Hipossuficiência', 'KIT AUX. POR INCAPACIDADE', 'KIT TRABALHISTA', 'KIT CONSUMIDOR'].map((nome, i) => (
              <div
                key={nome}
                className={`flex items-start gap-3 rounded-xl border-2 p-3 text-sm ${
                  i === 3
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                    : 'border-[#e7e5df] bg-[#f8f7f5] dark:border-zinc-800 dark:bg-zinc-900'
                }`}
              >
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs ${
                  i === 3 ? 'bg-primary-100 dark:bg-primary-500/20' : 'bg-slate-100 dark:bg-zinc-800'
                }`}>📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900 dark:text-zinc-100">{nome}</span>
                  <span className="block text-xs text-slate-500 dark:text-zinc-400">1 doc + 2 anexos</span>
                </span>
              </div>
            ))}
          </div>
        </SidePanel>

        {mostraDados && (
          <SidePanel
            step={2}
            title="Dados do documento"
            hint="Cliente e os campos que o modelo pede"
            summary="Maria Aparecida da Silva · 2 campos em branco"
            open={abreDados}
            onToggle={() => setAtiva('data')}
            done={!!gerado}
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Cliente *</p>
                <div className="rounded-lg border border-[#e7e5df] bg-white px-4 py-2.5 text-sm text-slate-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                  Maria Aparecida da Silva
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Finalidade</p>
                <div className="rounded-lg border border-primary-300 bg-primary-50 px-4 py-2.5 text-sm text-primary-800 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
                  Preencher finalidade...
                </div>
              </div>
              <button
                onClick={() => setAtiva('preview')}
                className="mt-1 w-full rounded-xl bg-primary-500 px-6 py-3 text-sm font-semibold text-white"
              >
                Continuar para a prévia →
              </button>
            </div>
          </SidePanel>
        )}

        {mostraDados && (
          <SidePanel
            step={3}
            title="Prévia do documento"
            hint="Confira antes de gerar"
            summary={abrePrevia ? 'Documento conferido' : 'Ainda não revisado'}
            open={abrePrevia}
            onToggle={() => setAtiva('preview')}
            done={!!gerado}
          >
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="min-h-[260px] flex-1 overflow-hidden rounded-xl bg-slate-100/70 p-3 dark:bg-zinc-950/40">
                <div className="mx-auto max-w-[420px] rounded-sm bg-white p-8 shadow-sm">
                  <p className="mb-4 text-center text-sm font-bold">PROCURAÇÃO AD JUDICIA</p>
                  <div className="space-y-2">
                    {[96, 100, 92, 88, 100, 74, 90, 62].map((w, i) => (
                      <div key={i} className="h-2 rounded bg-sky-100" style={{ width: `${w}%` }} />
                    ))}
                    <div className="h-2 w-1/3 rounded bg-primary-300" />
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3">
                <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-[#e7e5df] bg-white/95 p-1.5 shadow-[0_12px_32px_-12px_rgba(15,23,42,.45)] backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
                  <span className="rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white">
                    {gerado ? 'Gerar de novo' : 'Gerar documentos'}
                  </span>
                  {gerado && (
                    <>
                      <span className="mx-0.5 h-6 w-px bg-[#e7e5df] dark:bg-zinc-700" />
                      <span className="rounded-full px-3 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200">Word</span>
                      <span className="rounded-full px-3 py-2 text-xs font-medium text-slate-700 dark:text-zinc-200">PDF</span>
                      <span className="rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white">Assinatura</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </SidePanel>
        )}
      </div>
    </div>
  );
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
          titulo="Novo documento — as etapas encolhem para o lado"
          nota="Accordion: uma etapa por vez. 1) só o modelo · 2) escolheu, ele vira trilho e os dados abrem · 3) só depois de 'Continuar para a prévia' a folha aparece."
        >
          <div className="flex flex-col gap-5">
            <FaixaDeEtapas etapa="template" />
            <FaixaDeEtapas etapa="data" />
            <FaixaDeEtapas etapa="preview" gerado />
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
