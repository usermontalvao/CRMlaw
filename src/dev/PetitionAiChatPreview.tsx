// DEV-ONLY: harness visual do Assistente IA do Editor de Petições.
// Acesso: http://localhost:5173/?aichatpreview=1 (somente em modo dev).
//
// Substitui aiService.petitionAssistantChat por respostas SIMULADAS (nenhum
// token é gasto) e monta um SyncfusionEditor REAL com uma petição de exemplo
// (tópicos numerados + fecho + assinatura) para exercitar de ponta a ponta:
// replace cirúrgico, insert inteligente (antes do fecho, com formatação) e
// insert_block. Mesma técnica do CertificatePreview.

import React, { useEffect, useRef, useState } from 'react';
import PetitionAiChat from '../components/PetitionAiChat';
import SyncfusionEditor, { SyncfusionEditorRef } from '../components/SyncfusionEditor';
import { aiService } from '../services/ai.service';
import type { KbEntry } from '../services/petitionKbSearch';

const FAKE_KB: KbEntry[] = [
  {
    id: 'kb-horas-extras',
    title: 'Das Horas Extras — fundamentação completa',
    category: 'Trabalhista',
    tags: ['horas extras', 'jornada'],
    content: 'DAS HORAS EXTRAS\nO reclamante laborava em jornada de [[JORNADA_CONTRATUAL]], prestando em média [[QTD_HORAS_EXTRAS_MES]] horas extras mensais, sem a devida contraprestação, em afronta ao art. 7º, XVI, da Constituição Federal.',
  },
  {
    id: 'kb-dano-moral',
    title: 'Do Dano Moral — assédio e constrangimento',
    category: 'Trabalhista',
    tags: ['dano moral'],
    content: 'DO DANO MORAL\nRestou evidenciado o abalo extrapatrimonial sofrido pelo reclamante...',
  },
];

// Documento de exemplo: estrutura típica de petição, com erros propositais
// para os replaces e um fecho completo para o insert inteligente.
const SAMPLE_DOC = [
  'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DA VARA DO TRABALHO DE CUIABÁ - MT',
  '',
  '2.1 – DOS FATOS',
  'Conforme narrado na exordial, os reclamante foi admitido em 10 de janeiro de 2024 para exercer a função de vendedor, tendo o contrato encerrado por recisão indireta em razão das faltas graves cometidas pela empregadora, nos termos do art. 483 da CLT.',
  '',
  '2.2 – DO DIREITO',
  'O conjunto probatório demonstra de forma inequívoca a violação dos direitos trabalhistas do reclamante, impondo-se a procedência integral dos pedidos formulados na presente reclamatória.',
  '',
  'Termos em que pede deferimento.',
  '',
  'Cuiabá - MT, 12 de julho de 2026.',
  '',
  'Pedro Rodrigues Montalvão Neto, advogado',
  'OAB/MT 30.021',
].join('\n');

// Roteia a resposta simulada pelo conteúdo da mensagem para demonstrar cada estado.
(aiService as unknown as { petitionAssistantChat: typeof aiService.petitionAssistantChat }).petitionAssistantChat = async (params) => {
  params.onProgress?.('searching', 'horas extras jornada');
  await new Promise((r) => setTimeout(r, 900));
  params.onProgress?.('thinking');
  await new Promise((r) => setTimeout(r, 1400));

  const last = [...params.history].reverse().find((m) => m.role === 'user')?.content || '';

  if (/simular erro/i.test(last)) {
    throw new Error('Todos os provedores de IA falharam. Ultimo erro: openai HTTP 500 (simulado).');
  }

  if (/pergunta/i.test(last)) {
    return {
      reply: 'Para redigir o tópico de horas extras com precisão, preciso de alguns dados do caso que não constam no documento.',
      actions: [],
      questions: [
        { question: 'Qual era a jornada contratual do reclamante?', options: ['8h/dia, 44h semanais', '6h/dia', '12x36', 'Usar variável [[JORNADA]]'] },
        { question: 'Quantas horas extras por mês, em média?', options: ['20 horas', '40 horas', 'Usar variável [[QTD_HE]]'] },
      ],
      searches: ['horas extras jornada'],
    };
  }

  return {
    reply: 'Revisei o documento e encontrei 2 correções ortográficas. Também preparei o tópico de horas extras seguindo a numeração do documento (2.3) e um pedido de reflexos.',
    actions: [
      { type: 'replace', label: 'Corrigir concordância', search: 'os reclamante foi admitido', replace: 'o reclamante foi admitido' },
      { type: 'replace', label: 'Corrigir grafia de "rescisão"', search: 'recisão indireta', replace: 'rescisão indireta' },
      {
        type: 'insert',
        label: 'Inserir tópico 2.3 – Das Horas Extras',
        position: 'end',
        text: '2.3 – DAS HORAS EXTRAS\nO reclamante laborava em jornada de 8h diárias e 44h semanais, prestando em média 32 horas extras mensais sem a devida contraprestação, em afronta ao art. 7º, XVI, da Constituição Federal e aos arts. 59 e seguintes da CLT.\nRequer, assim, a condenação da reclamada ao pagamento das horas extras acrescidas do adicional de 50%, com reflexos em férias acrescidas de 1/3, 13º salário, aviso prévio, DSR e FGTS.',
      },
    ],
    questions: [],
    searches: ['horas extras jornada', 'reflexos verbas rescisórias'],
  };
};

export default function PetitionAiChatPreview() {
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const seededRef = useRef(false);
  const [ready, setReady] = useState(false);

  // Preenche o documento de exemplo assim que o editor estiver pronto.
  const handleReady = () => {
    if (seededRef.current) return;
    seededRef.current = true;
    window.setTimeout(() => {
      try {
        editorRef.current?.insertText(SAMPLE_DOC);
        editorRef.current?.getEditor?.()?.selection?.moveToDocumentEnd?.();
        setReady(true);
      } catch {
        setReady(true);
      }
    }, 300);
  };

  // Exposto para verificação automatizada (leitura do texto final do documento).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__aiPreviewGetDocText = () =>
      editorRef.current?.getText?.() || '';
  }, []);

  return (
    <div className="relative w-screen h-screen bg-slate-200 overflow-hidden flex flex-col">
      <div className="shrink-0 px-4 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide bg-white border-b border-slate-200">
        Preview dev · Assistente IA (respostas simuladas) {ready ? '· documento carregado' : '· carregando documento...'}
      </div>
      <div className="relative flex-1 min-h-0">
        <SyncfusionEditor
          ref={editorRef}
          id="ai-preview-editor"
          height="100%"
          enableToolbar={false}
          showPropertiesPane={false}
          showRuler={false}
          showNavigationPane={false}
          onReady={handleReady}
        />
        <PetitionAiChat
          editorRef={editorRef}
          kbEntries={FAKE_KB}
        />
      </div>
    </div>
  );
}
