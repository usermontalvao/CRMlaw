// Catálogo de habilidades do Assistente IA do Editor de Petições.
//
// Cada habilidade é um prompt pronto, com escopo declarado — o widget usa o
// escopo para saber quando a habilidade faz sentido (documento com conteúdo,
// trecho selecionado, documento em branco) e nunca oferece o que não dá para
// executar. Prompt terminado em espaço é "aberto": o widget preenche o campo e
// deixa o advogado completar em vez de enviar sozinho.

import React from 'react';
import {
  AlarmClock,
  Baseline,
  BookOpen,
  Calculator,
  CircleHelp,
  ClipboardList,
  Copy,
  FileSearch,
  FileText,
  Gavel,
  ListChecks,
  ListPlus,
  MapPin,
  ScanText,
  Scale,
  Shield,
  SpellCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';

export type SkillScope = 'document' | 'selection' | 'draft';
export type SkillGroup = 'revisao' | 'redacao' | 'analise';

export interface PetitionSkill {
  id: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  prompt: string;
  scope: SkillScope;
  group: SkillGroup;
  /** Só aparece quando há conteúdo no documento. */
  requiresDocument?: boolean;
  /** 'empty-only' = só faz sentido com o documento em branco. */
  availability?: 'always' | 'empty-only';
}

export const SKILL_GROUP_LABEL: Record<SkillGroup, string> = {
  revisao: 'Revisar o que já está escrito',
  redacao: 'Escrever e completar a peça',
  analise: 'Entender e planejar o caso',
};

export const PETITION_SKILLS: PetitionSkill[] = [
  // ── Revisão ───────────────────────────────────────────────────────────────
  {
    id: 'auditoria',
    icon: <ScanText className="w-4 h-4" />,
    label: 'Auditoria completa',
    desc: 'Riscos, incoerências e lacunas',
    prompt: 'Faça uma auditoria jurídica completa do documento. Verifique coerência entre fatos, fundamentos e pedidos; nomes, datas e valores; argumentos frágeis; riscos; contradições e pedidos possivelmente ausentes. Não altere nada ainda: organize os achados por prioridade e explique cada um.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'revisao-linguistica',
    icon: <SpellCheck className="w-4 h-4" />,
    label: 'Revisão linguística',
    desc: 'Gramática e clareza jurídica',
    prompt: 'Corrija ortografia, gramática, concordância e pontuação do documento. Proponha cada correção como uma ação separada para eu escolher quais aplicar.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'conferir-pedidos',
    icon: <ListChecks className="w-4 h-4" />,
    label: 'Conferir pedidos',
    desc: 'Cruzar fatos, direito e pedidos',
    prompt: 'Confira especificamente os pedidos do documento. Cruze cada pedido com os fatos e fundamentos apresentados, identifique pedidos sem suporte, fundamentos sem pedido correspondente e possíveis reflexos ou requerimentos ausentes. Não altere nada ainda.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'duplicacoes',
    icon: <Copy className="w-4 h-4" />,
    label: 'Limpar duplicações',
    desc: 'Achar e remover trechos repetidos',
    prompt: 'Procure no documento trechos duplicados, parágrafos repetidos e sobras de rascunho. Para cada bloco repetido, proponha UMA ação "delete" removendo a cópia acrescentada por último (occurrence: last) e preservando a original, informando a primeira e a última linha exatas do bloco. Liste antes o que encontrou.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'datas-prazos',
    icon: <AlarmClock className="w-4 h-4" />,
    label: 'Datas e prazos',
    desc: 'Coerência temporal e prescrição',
    prompt: 'Analise todas as datas e marcos temporais citados no documento. Verifique se a linha do tempo é coerente, se há datas conflitantes e se algum direito pode estar atingido por prescrição ou decadência. Aponte o que precisa ser conferido antes do protocolo. Não altere nada ainda.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'valores',
    icon: <Calculator className="w-4 h-4" />,
    label: 'Valores e cálculos',
    desc: 'Conferir contas e valor da causa',
    prompt: 'Confira todos os valores monetários do documento: memória de cálculo, somatórios, reflexos e o valor da causa. Aponte incoerências, valores sem base de cálculo declarada e contas que não fecham, mostrando o cálculo correto e as premissas usadas. Não altere nada ainda.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'padronizar',
    icon: <Baseline className="w-4 h-4" />,
    label: 'Padronizar títulos',
    desc: 'Numeração e formatação uniformes',
    prompt: 'Padronize os títulos e a numeração dos tópicos do documento seguindo o padrão predominante nele (caixa alta, numeração sequencial, uso de DA/DO/DAS/DOS e pontuação). Proponha uma ação "replace" por título fora do padrão, sem alterar o conteúdo dos parágrafos.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },
  {
    id: 'contra-argumentos',
    icon: <Shield className="w-4 h-4" />,
    label: 'Antecipar a defesa',
    desc: 'Contra-argumentos da parte adversa',
    prompt: 'Assuma o papel do advogado da parte adversa e ataque esta peça: aponte as fragilidades que ela exploraria, as preliminares que arguiria, as provas que exigiria e as teses que oporia. Depois, para cada ataque, sugira como blindar o texto. Não altere nada ainda.',
    scope: 'document',
    group: 'revisao',
    requiresDocument: true,
  },

  // ── Redação ───────────────────────────────────────────────────────────────
  {
    id: 'melhorar-selecao',
    icon: <Wand2 className="w-4 h-4" />,
    label: 'Melhorar seleção',
    desc: 'Refinar apenas o trecho marcado',
    prompt: 'Melhore a redação do trecho selecionado, deixando-o mais técnico e claro, preservando o sentido jurídico.',
    scope: 'selection',
    group: 'redacao',
  },
  {
    id: 'reforcar-tese',
    icon: <Sparkles className="w-4 h-4" />,
    label: 'Reforçar a tese',
    desc: 'Aprofundar o argumento do trecho',
    prompt: 'Aprofunde a argumentação do trecho selecionado: explicite a premissa jurídica, conecte-a aos fatos narrados na peça e feche com a consequência pedida. Mantenha o estilo do documento e proponha a melhoria como uma única substituição do trecho.',
    scope: 'selection',
    group: 'redacao',
  },
  {
    id: 'linguagem-simples',
    icon: <FileText className="w-4 h-4" />,
    label: 'Linguagem simples',
    desc: 'Clareza sem perder a técnica',
    prompt: 'Reescreva o trecho selecionado em linguagem simples e direta, no espírito do Pacto Nacional pelo Judiciário em Linguagem Simples: frases curtas, ordem direta, sem latinismos desnecessários e sem juridiquês vazio — preservando integralmente a precisão técnica e os termos que têm efeito jurídico próprio.',
    scope: 'selection',
    group: 'redacao',
  },
  {
    id: 'novo-topico',
    icon: <ListPlus className="w-4 h-4" />,
    label: 'Redigir novo tópico',
    desc: 'Fundamento ou pedido com contexto',
    prompt: 'Redija um novo tópico jurídico sobre ',
    scope: 'draft',
    group: 'redacao',
  },
  {
    id: 'fundamentar',
    icon: <Gavel className="w-4 h-4" />,
    label: 'Fundamentar com a lei',
    desc: 'Dispositivos, súmulas e teses',
    prompt: 'Indique os dispositivos legais, súmulas, orientações jurisprudenciais e teses aplicáveis aos fatos e pedidos desta peça. Para cada um, explique em uma frase por que se aplica ao caso e marque explicitamente o que eu preciso conferir antes do protocolo. Não invente número de súmula, tema repetitivo ou acórdão.',
    scope: 'document',
    group: 'redacao',
    requiresDocument: true,
  },
  {
    id: 'enderecamento',
    icon: <MapPin className="w-4 h-4" />,
    label: 'Endereçamento e partes',
    desc: 'Juízo competente e qualificação',
    prompt: 'Revise o endereçamento e a qualificação das partes: juízo competente para esta matéria e este pedido, forma correta do endereçamento e completude da qualificação (nome, nacionalidade, estado civil, profissão, CPF/CNPJ, endereço). Aponte o que falta e proponha as correções.',
    scope: 'document',
    group: 'redacao',
    requiresDocument: true,
  },
  {
    id: 'provas',
    icon: <ClipboardList className="w-4 h-4" />,
    label: 'Rol de provas',
    desc: 'Documentos e requerimento probatório',
    prompt: 'Monte o rol de provas desta peça: liste os documentos que precisam instruí-la a partir dos fatos narrados, aponte quais fatos ainda estão sem prova e redija o requerimento de produção de provas adequado ao rito. Traga a lista antes de propor a inserção.',
    scope: 'document',
    group: 'redacao',
    requiresDocument: true,
  },
  {
    id: 'estrutura-inicial',
    icon: <FileText className="w-4 h-4" />,
    label: 'Criar estrutura inicial',
    desc: 'Organizar a peça do zero',
    prompt: 'Crie uma estrutura inicial para a petição, com os tópicos essenciais em ordem lógica. Antes de redigir conteúdo factual, identifique em uma única lista quais informações do caso ainda preciso fornecer.',
    scope: 'draft',
    group: 'redacao',
    availability: 'empty-only',
  },

  // ── Análise ───────────────────────────────────────────────────────────────
  {
    id: 'resumo',
    icon: <FileSearch className="w-4 h-4" />,
    label: 'Resumo executivo',
    desc: 'A peça inteira em tópicos',
    prompt: 'Resuma esta peça em tópicos: partes, causa de pedir, principais fundamentos, pedidos e valor da causa. No final, aponte em uma frase o ponto mais forte e o mais frágil da peça. Não altere nada.',
    scope: 'document',
    group: 'analise',
    requiresDocument: true,
  },
  {
    id: 'perguntas-cliente',
    icon: <CircleHelp className="w-4 h-4" />,
    label: 'Perguntas ao cliente',
    desc: 'O que ainda falta apurar',
    prompt: 'Com base no que já está escrito, monte a lista de perguntas objetivas que eu preciso fazer ao cliente para completar a peça (fatos, datas, valores e documentos). Agrupe por tema e deixe cada pergunta pronta para ser enviada ao cliente.',
    scope: 'document',
    group: 'analise',
    requiresDocument: true,
  },
  {
    id: 'estrategia',
    icon: <Scale className="w-4 h-4" />,
    label: 'Estratégia da ação',
    desc: 'Caminhos, riscos e próximos passos',
    prompt: 'Analise a estratégia desta ação: rito e via adequados, ordem dos pedidos, cabimento de tutela de urgência, riscos processuais (custas, honorários de sucumbência, litigância) e o que reforçaria a chance de êxito. Termine com uma lista curta de próximos passos.',
    scope: 'document',
    group: 'analise',
    requiresDocument: true,
  },
  {
    id: 'consultar-acervo',
    icon: <BookOpen className="w-4 h-4" />,
    label: 'Consultar o acervo',
    desc: 'Como o escritório já fez antes',
    prompt: 'Consulte o acervo de peças do escritório e os modelos da base e me mostre como já tratamos este assunto antes: estrutura usada, teses sustentadas e trechos de redação que valem reaproveitar. Cite os arquivos consultados e não copie dados de outros clientes.',
    scope: 'draft',
    group: 'analise',
  },
];

/** Habilidades aplicáveis ao estado atual do editor. */
export const visibleSkills = (state: { hasDocument: boolean }): PetitionSkill[] =>
  PETITION_SKILLS.filter((skill) => (
    (!skill.requiresDocument || state.hasDocument)
    && (skill.scope !== 'selection' || state.hasDocument)
    && (skill.availability !== 'empty-only' || !state.hasDocument)
  ));
