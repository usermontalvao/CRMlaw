import type { IntimationAnalysis, DeadlineExtraction } from '../types/ai.types';
import { supabase } from '../config/supabase';
import { contarPrazoDaIntimacao } from '../utils/intimationDeadline';
import { settingsService, type AiTaskConfig } from './settings.service';
import { streamChatCompletion } from './aiStream';
import {
  normalizeContextualSentenceSpellingIssues,
  normalizeContextualSpellingSuggestions,
  type ContextualSentenceSpellingIssue,
} from '../components/spelling-suggestions';
import {
  CONTEXT_RESPONSE_MAX_TOKENS,
  CONTEXT_WINDOW_MAX_CHARS,
  DOCUMENT_CONTEXT_MAX_CHARS,
  WORD_RESPONSE_MAX_TOKENS,
} from './proofContextBudget';

const CHEAPEST_SPELL_MODEL = 'gpt-5-nano';

// ── Assistente de Petições (chat) ──────────────────────────────────────────
// Ação estruturada que o assistente pode propor sobre o documento aberto.
// 'replace' usa busca/substituição de trecho EXATO (preserva a formatação do
// restante do documento); 'insert' insere texto novo no cursor ou no final;
// 'insert_block' insere um modelo da base INTEGRALMENTE (SFDT com a
// formatação original), trocando apenas os dados do caso via 'replacements'.
export interface PetitionChatActionReplacement {
  /** Trecho EXATO do modelo a substituir (ex.: "[[QTD_HORAS_EXTRAS_MES]]"). */
  search: string;
  /** Valor do caso concreto. */
  replace: string;
}

export interface PetitionChatAction {
  type: 'replace' | 'insert' | 'insert_block' | 'delete';
  /** Descrição curta exibida no cartão da ação (ex.: "Corrigir concordância"). */
  label?: string;
  /** Trecho EXATO do documento a ser substituído ou removido ('replace' | 'delete'). */
  search?: string;
  /** Texto que substitui o trecho (type: 'replace'). */
  replace?: string;
  /**
   * Fim do intervalo quando o trecho atravessa parágrafos ('replace' | 'delete').
   * O editor localiza início e fim separadamente e seleciona tudo entre eles —
   * uma busca única nunca atravessaria a marca de parágrafo.
   */
  searchEnd?: string;
  /**
   * Qual ocorrência tratar quando o trecho aparece mais de uma vez.
   * 'last' é o padrão de 'delete': conteúdo duplicado costuma ser o que foi
   * acrescentado depois, e apagar todas as cópias deixaria o documento sem o
   * conteúdo original.
   */
  occurrence?: 'first' | 'last';
  /** Onde inserir (type: 'insert' | 'insert_block'). */
  position?: 'cursor' | 'end';
  /** Texto a inserir (type: 'insert'). '\n' separa parágrafos. */
  text?: string;
  /** Id do modelo da base a inserir integralmente (type: 'insert_block'). */
  blockId?: string;
  /** Substituições de dados do caso aplicadas sobre o modelo (type: 'insert_block'). */
  replacements?: PetitionChatActionReplacement[];
}

/**
 * Apontamento de revisão contextual devolvido pela IA (camada 4 do revisor).
 * `bad` é sempre uma cópia literal de um trecho do parágrafo — é assim que o
 * orquestrador localiza a correção no documento sem depender de offsets.
 */
export interface AiGrammarIssue {
  /** Índice do parágrafo informado no prompt (-1 = não identificado). */
  paragraph: number;
  bad: string;
  good: string;
  category: 'concordancia' | 'genero' | 'crase' | 'gramatica' | 'pontuacao' | 'ortografia' | 'estilo' | 'juridico';
  message: string;
  /** Regra gramatical aplicada, em uma frase (exibida no painel). */
  rule: string;
}

/** Pergunta de esclarecimento que a IA faz antes de redigir (ex.: jornada). */
export interface PetitionChatQuestion {
  question: string;
  /** Respostas sugeridas exibidas como chips clicáveis. */
  options?: string[];
}

export interface PetitionChatResult {
  reply: string;
  actions: PetitionChatAction[];
  questions: PetitionChatQuestion[];
  /** Buscas locais na base de conhecimento executadas durante a resposta. */
  searches: string[];
}

export interface PetitionChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

/** Trecho da base de conhecimento retornado pela busca local (sem custo de tokens). */
export interface PetitionChatKbSnippet {
  id?: string;
  title: string;
  category?: string;
  snippet: string;
  /** true quando "snippet" é o texto INTEGRAL do modelo (habilita insert_block). */
  isFull?: boolean;
}

/**
 * Trecho vindo do ACERVO (petições reais do escritório no Nextcloud).
 * É referência de estilo e precedente — não tem blockId, então nunca vira
 * insert_block: a IA lê, aprende e redige.
 */
export interface PetitionChatArchiveSnippet {
  /** Caminho do arquivo no Nextcloud (fonte exibida no chat). */
  path: string;
  title: string;
  folder?: string;
  snippet: string;
}

/** Briefing da peça: o que o assistente precisa saber antes da primeira linha. */
export interface PetitionChatBriefing {
  /** Área do Direito (ex.: "Trabalhista"). */
  area?: string;
  /** Tipo de peça (ex.: "Petição inicial"). */
  documentType?: string;
  /** Polo do cliente (ex.: "Reclamante (autor)"). */
  party?: string;
  /** Síntese do caso escrita pelo advogado. */
  summary?: string;
  /** Pontos extras marcados no formulário (ex.: "Tutela de urgência"). */
  highlights?: string[];
}

/** Formata o briefing para o prompt. Vazio quando nada foi preenchido. */
const formatBriefing = (briefing?: PetitionChatBriefing): string => {
  if (!briefing) return '';
  const lines: string[] = [];
  if (briefing.area) lines.push(`- Área do Direito: ${briefing.area}`);
  if (briefing.documentType) lines.push(`- Tipo de peça: ${briefing.documentType}`);
  if (briefing.party) lines.push(`- Polo do cliente: ${briefing.party}`);
  if (briefing.highlights?.length) lines.push(`- Pontos marcados: ${briefing.highlights.join('; ')}`);
  if (briefing.summary) lines.push(`- Síntese do caso: ${briefing.summary}`);
  if (!lines.length) return '';
  return `BRIEFING DA PEÇA (definido pelo advogado — NÃO pergunte de novo estes itens):\n${lines.join('\n')}`;
};

/** Formata os trechos do acervo do Nextcloud para o prompt. */
const formatArchiveSnippets = (snippets: PetitionChatArchiveSnippet[]): string => {
  if (!snippets.length) return '';
  const body = snippets
    .map((s, i) => (
      `Peça ${i + 1} — ${s.title}${s.folder ? ` (pasta: ${s.folder})` : ''}\nArquivo: ${s.path}\n"""\n${s.snippet}\n"""`
    ))
    .join('\n\n');
  return `ACERVO DO ESCRITÓRIO (petições reais já protocoladas, vindas do Nextcloud — use como REFERÊNCIA de estilo, estrutura e teses; nunca copie dados de outro cliente e nunca use "insert_block" com elas):\n\n${body}`;
};

/** Normaliza uma consulta para comparar buscas repetidas (acentos/caixa/espaços). */
const normalizePtQuery = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Formata os trechos da base de conhecimento para o prompt do assistente. */
const formatKbSnippets = (query: string, snippets: PetitionChatKbSnippet[]): string => {
  if (!snippets.length) return `(busca local por "${query}": nenhum modelo relevante encontrado)`;
  const body = snippets
    .map((s, i) => {
      const header = `Modelo ${i + 1}${s.id ? ` — blockId: ${s.id}` : ''} — ${s.title}${s.category ? ` (${s.category})` : ''} ${s.isFull ? '[TEXTO INTEGRAL — pode usar insert_block]' : '[trecho parcial — para usar este modelo integralmente, peça "search" pelo título dele]'}`;
      return `${header}\n${s.snippet}`;
    })
    .join('\n\n----------------\n\n');
  return `MODELOS DO ESCRITÓRIO (busca local por "${query}"):\n${body}`;
};

class AIService {
  // Toda a IA de texto passa pela Edge Function `openai-proxy`, que mantém a
  // cadeia de provedores (DeepSeek -> Groq -> OpenAI) e as chaves NO SERVIDOR.
  // Nenhuma chave de IA vive no frontend / bundle.
  private enabled: boolean = true;

  // Settings carregadas do banco (lazy)
  private promptOverrides: Map<string, string> = new Map();
  private taskConfigs: Map<string, AiTaskConfig> = new Map();
  private holidayDates: Set<string> = new Set(); // 'YYYY-MM-DD'
  private settingsPromise: Promise<void> | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * Vencimento estimado de um prazo processual, em dias úteis e pela regra do
   * CPC (publicação no dia útil seguinte à disponibilização; o dia do começo não
   * se conta). A conta mora em `utils/intimationDeadline.ts`, testada e sem
   * dependência do fuso do navegador — a versão anterior misturava hora local e
   * UTC e mandava 30% dos vencimentos para sábado ou domingo.
   */
  private venceEm(disponibilizacao: string | Date, dias: number): string | null {
    const conta = contarPrazoDaIntimacao(
      disponibilizacao instanceof Date ? disponibilizacao : String(disponibilizacao),
      dias,
      this.holidayDates,
    );
    return conta ? `${conta.vencimento}T00:00:00.000Z` : null;
  }

  private initialize() {
    // Sem chaves no frontend: a IA roda via Edge Function `openai-proxy`.
    this.enabled = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Força recarga das settings do banco (útil após salvar Configurações). */
  invalidateSettings(): void {
    this.settingsPromise = null;
  }

  private ensureSettingsLoaded(): Promise<void> {
    if (!this.settingsPromise) {
      this.settingsPromise = this.loadFromSettings();
    }
    return this.settingsPromise;
  }

  private async loadFromSettings(): Promise<void> {
    try {
      // provider/fallback é decidido no servidor (openai-proxy). Aqui só
      // carregamos os ajustes por tarefa (modelo, max_tokens) e prompts.
      const [taskCfgs, promptOverrides, holidays] = await Promise.all([
        settingsService.getAiTaskConfigs(),
        settingsService.getAiPromptOverrides(),
        settingsService.getHolidays(),
      ]);

      this.taskConfigs = new Map(taskCfgs.map(t => [t.task_key, t]));
      this.promptOverrides = new Map(promptOverrides.map(o => [o.key, o.system_prompt]));
      this.holidayDates = new Set(holidays.map(h => h.date));
    } catch {
      // Mantém defaults em caso de falha
    }
  }

  /** Retorna prompt customizado se houver override, senão o prompt padrão. */
  private getPrompt(key: string, fallback: string): string {
    return this.promptOverrides.get(key) || fallback;
  }

  /** Retorna parâmetros de tarefa configurados (model, temperature, max_tokens). */
  private getTaskOpts(key: string): { model?: string; temperature: number; maxTokens: number } {
    const cfg = this.taskConfigs.get(key);
    return { model: cfg?.model, temperature: cfg?.temperature ?? 0.3, maxTokens: cfg?.max_tokens ?? 800 };
  }

  async generateText(systemPrompt: string, userPrompt: string, maxTokens: number = 800, taskKey?: string): Promise<string> {
    if (!this.isEnabled()) return '';
    await this.ensureSettingsLoaded();
    const taskOpts = taskKey ? this.getTaskOpts(taskKey) : undefined;
    // Config explícita do banco prevalece; sem config, vale o pedido do
    // chamador (getTaskOpts fabrica 800 como default e mascarava o parâmetro).
    const dbTokens = taskKey ? this.taskConfigs.get(taskKey)?.max_tokens : undefined;
    const resolvedTokens = dbTokens ?? maxTokens;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    return this.callOpenAIViaEdgeFunction(messages, taskOpts?.model ?? 'gpt-4o-mini', resolvedTokens, taskKey ? { taskKey } : undefined);
  }

  async editLegalTextWithContext(params: {
    instruction: string;
    selectedText: string;
    contextBlocks?: Array<{
      title: string;
      category?: string;
      tags?: string[];
      content: string;
    }>;
  }): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está disponível');
    }

    const instruction = String(params.instruction || '').trim();
    const selectedText = String(params.selectedText || '').trim();
    const contextBlocks = Array.isArray(params.contextBlocks) ? params.contextBlocks : [];

    if (!instruction) throw new Error('Informe a instrução de edição para a IA');
    if (!selectedText) throw new Error('Selecione um trecho do documento para editar');

    const formattedBlocks = contextBlocks
      .slice(0, 5)
      .map((block, index) => {
        const title = String(block.title || `Bloco ${index + 1}`).trim();
        const category = String(block.category || '').trim();
        const tags = Array.isArray(block.tags) ? block.tags.filter(Boolean).join(', ') : '';
        const content = String(block.content || '').trim().slice(0, 1800);

        return [
          `Bloco ${index + 1}: ${title}`,
          category ? `Categoria: ${category}` : '',
          tags ? `Tags: ${tags}` : '',
          'Conteúdo de referência:',
          content,
        ].filter(Boolean).join('\n');
      })
      .join('\n\n----------------\n\n');

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('edit_legal_text');

    const defaultSystemPrompt = `Você é um editor jurídico especialista em petições brasileiras.

Sua função é editar APENAS o trecho selecionado de um documento jurídico, seguindo a instrução do usuário e usando os blocos fornecidos como base de conhecimento de estilo, estrutura argumentativa e vocabulário técnico.

Regras obrigatórias:
- Edite apenas o trecho selecionado, sem mencionar o restante do documento.
- Preserve o sentido jurídico quando a instrução não pedir mudança de tese.
- Não invente fatos, datas, números, nomes, pedidos, documentos ou fundamentos não presentes no trecho selecionado ou nos blocos de contexto.
- Use os blocos apenas como referência de linguagem, técnica e organização argumentativa.
- Mantenha o texto pronto para substituição direta no editor.
- Não use markdown.
- Não use cercas de código.
- Não adicione explicações, notas, títulos extras ou comentários.
- Retorne somente o texto final editado.`;

    const systemPrompt = this.getPrompt('edit_legal_text', defaultSystemPrompt);

    const userPrompt = [
      `Instrução do usuário:\n${instruction}`,
      `Trecho selecionado para edição:\n${selectedText}`,
      formattedBlocks ? `Blocos de referência:\n${formattedBlocks}` : 'Blocos de referência: nenhum bloco relevante foi encontrado.',
      'Retorne apenas a versão final editada do trecho selecionado.',
    ].join('\n\n');

    const content = await this.generateText(systemPrompt, userPrompt, Math.max(taskOpts.maxTokens, 2000), 'edit_legal_text');
    const output = String(content || '').trim();

    if (!output) {
      throw new Error('IA não retornou texto para a edição solicitada');
    }

    return output;
  }

  /**
   * Revisão CONTEXTUAL de texto jurídico (camada 4 do revisor do editor).
   *
   * O Hunspell vê palavra isolada, o LanguageTool vê a frase pelas regras da
   * comunidade e as regras próprias veem padrões conhecidos. Esta chamada é a
   * única que entende o parágrafo: regência, ambiguidade, concordância que
   * depende do sujeito distante e vícios de redação forense.
   *
   * Restrição dura no prompt: nunca alterar fato, valor, data, nome, número de
   * processo ou pedido — só a forma.
   */
  async reviewLegalTextGrammar(params: {
    /** Parágrafos numerados (índice = posição no documento). */
    paragraphs: Array<{ index: number; text: string }>;
    /** Achados já encontrados pelas outras camadas, para a IA não repetir. */
    knownIssues?: string[];
    signal?: AbortSignal;
  }): Promise<AiGrammarIssue[]> {
    if (!this.isEnabled()) return [];

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('proofread_legal');

    // Teto de contexto: parágrafos curtos e o documento truncado em
    // DOCUMENT_CONTEXT_MAX_CHARS. Uma petição de 40 páginas não vira um prompt
    // de 40 páginas — a revisão cobre o começo e o painel pede o resto sob
    // demanda quando o usuário rolar e revisar novamente.
    const paragraphs: Array<{ index: number; text: string }> = [];
    let budget = DOCUMENT_CONTEXT_MAX_CHARS;
    for (const paragraph of params.paragraphs || []) {
      const text = paragraph.text.replace(/\s+/g, ' ').trim();
      if (text.length <= 25) continue;
      const slice = text.slice(0, 700);
      if (slice.length > budget) break;
      budget -= slice.length;
      paragraphs.push({ index: paragraph.index, text: slice });
      if (paragraphs.length >= 50) break;
    }
    if (!paragraphs.length) return [];

    const defaultSystemPrompt = `Revisor de português em peças processuais brasileiras. Aponte só erros REAIS: concordância (gênero/número), crase, regência, pontuação, palavras trocadas ("a"/"à", "mas"/"mais", "mal"/"mau", "seção"/"sessão", "mandado"/"mandato") e vícios forenses ("a nível de", "o mesmo" como pronome).

REGRAS:
- Nunca altere fato, valor, data, nome, CPF/CNPJ, processo, artigo de lei, súmula ou pedido.
- "bad" = cópia LITERAL do menor trecho errado do parágrafo indicado (máx. 12 palavras, mesma acentuação e caixa).
- "good" = o mesmo trecho corrigido. Nunca reescreva o parágrafo.
- Parágrafo correto não gera saída. Máximo 20 apontamentos, os mais graves primeiro.

JSON apenas: {"issues":[{"paragraph":0,"bad":"","good":"","category":"concordancia|genero|crase|gramatica|pontuacao|ortografia|estilo|juridico","message":"o erro em uma frase","rule":"a regra aplicada em uma frase"}]}`;

    const systemPrompt = this.getPrompt('proofread_legal', defaultSystemPrompt);

    const body = paragraphs.map((p) => `[${p.index}] ${p.text}`).join('\n\n');

    // Os achados locais entram no prompt para a IA não gastar saída repetindo
    // o que o Hunspell e as regras próprias já resolveram de graça.
    const known = (params.knownIssues || []).slice(0, 25);
    const userPrompt = [
      'Parágrafos ([n] = campo "paragraph"):',
      body,
      known.length ? `Já apontados por outras camadas, não repita: ${known.join(' | ')}` : '',
    ].filter(Boolean).join('\n\n');

    const content = await this.callOpenAIViaEdgeFunction(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Revisão de documento inteiro roda no mini: o trabalho pesado de achar
      // ortografia e padrões conhecidos já foi feito offline pelas camadas 1-3.
      taskOpts.model ?? 'gpt-4o-mini',
      Math.min(Math.max(taskOpts.maxTokens, 1200), 2000),
      { taskKey: 'proofread_legal', temperature: 0.1, responseFormat: 'json_object', signal: params.signal },
    );

    if (params.signal?.aborted) return [];

    const jsonText = this.extractJsonObject(String(content || ''));
    if (!jsonText) return [];

    try {
      const parsed = JSON.parse(jsonText);
      const rawIssues = Array.isArray(parsed?.issues) ? parsed.issues : [];
      const valid = new Set<AiGrammarIssue['category']>([
        'concordancia', 'genero', 'crase', 'gramatica', 'pontuacao', 'ortografia', 'estilo', 'juridico',
      ]);

      return rawIssues
        .map((issue: any): AiGrammarIssue | null => {
          const bad = String(issue?.bad ?? '').trim();
          const good = String(issue?.good ?? '').trim();
          if (!bad || bad === good) return null;
          const category = valid.has(issue?.category) ? issue.category : 'gramatica';
          return {
            paragraph: Number.isFinite(issue?.paragraph) ? Number(issue.paragraph) : -1,
            bad,
            good,
            category,
            message: String(issue?.message ?? '').trim() || 'Correção sugerida pelo contexto do parágrafo.',
            rule: String(issue?.rule ?? '').trim(),
          };
        })
        .filter((issue: AiGrammarIssue | null): issue is AiGrammarIssue => issue !== null)
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * Analisa o contexto em volta de uma palavra suspeita.
   *
   * Só é chamada depois que as camadas locais (Hunspell + regras próprias)
   * apontaram algo naquele trecho — ver `contextualProofGate`. O contexto vem
   * recortado em CONTEXT_WINDOW_MAX_CHARS: é o teto de tokens de entrada.
   */
  async analyzeSpellingSentence(params: {
    sentence: string;
    signal?: AbortSignal;
  }): Promise<ContextualSentenceSpellingIssue[]> {
    if (!this.isEnabled()) return [];

    const sentence = String(params.sentence || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CONTEXT_WINDOW_MAX_CHARS);
    if ((sentence.match(/[\p{L}\p{M}]+/gu) || []).length < 2) return [];

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('spell_sentence');
    // Prompt curto de propósito: é a chamada mais frequente do editor e cada
    // linha aqui é cobrada em toda correção.
    const defaultSystemPrompt = `Corretor de português brasileiro. No trecho recebido, encontre palavras que existem no dicionário mas estão erradas no contexto (digitação, gênero, número, determinante, possessivo). Ignore estilo. Nunca sugira forma estrangeira ou fora do pt-BR padrão. "bad" copia literalmente o menor trecho errado; "good" é só a correção. Máximo 2 erros. Sem erro real: {"issues":[]}.

Ex.: "Olá mei amigo" → {"issues":[{"bad":"mei","good":"meu","message":"Antes de “amigo”, o possessivo é “meu”."}]}

JSON apenas: {"issues":[{"bad":"","good":"","message":""}]}`;
    const systemPrompt = this.getPrompt('spell_sentence', defaultSystemPrompt);

    try {
      const content = await this.callOpenAIViaEdgeFunction(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sentence },
        ],
        CHEAPEST_SPELL_MODEL,
        Math.min(Math.max(taskOpts.maxTokens, 160), CONTEXT_RESPONSE_MAX_TOKENS),
        {
          taskKey: 'spell_sentence',
          responseFormat: 'json_object',
          reasoningEffort: 'minimal',
          signal: params.signal,
        },
      );
      if (params.signal?.aborted) throw new DOMException('Análise da frase cancelada.', 'AbortError');

      const jsonText = this.extractJsonObject(String(content || ''));
      if (!jsonText) throw new Error('A IA não retornou JSON válido.');
      const parsed = JSON.parse(jsonText);
      return normalizeContextualSentenceSpellingIssues(parsed?.issues, sentence);
    } catch (err) {
      console.warn('[ai.service] analyzeSpellingSentence falhou:', err);
      throw err instanceof Error ? err : new Error('Falha na análise contextual da frase.');
    }
  }

  /**
   * Reordena/completa as sugestões do corretor ortográfico usando a FRASE.
   *
   * O Hunspell ordena por distância de edição, o que em petição costuma pôr a
   * palavra errada em primeiro ("prescricão" → "prescrição" só em 3º). Aqui a
   * IA vê a frase inteira e diz qual candidata cabe no contexto, podendo
   * propor uma que o dicionário não gerou.
   */
  async suggestSpellingInContext(params: {
    word: string;
    sentence: string;
    candidates: string[];
    signal?: AbortSignal;
  }): Promise<string[]> {
    if (!this.isEnabled()) throw new Error('Serviço de IA indisponível.');

    const word = String(params.word || '').trim();
    const sentence = String(params.sentence || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CONTEXT_WINDOW_MAX_CHARS);
    if (!word || !sentence) throw new Error('Palavra ou frase ausente para a análise contextual.');

    const candidates = (params.candidates || [])
      .map((c) => String(c || '').trim())
      .filter(Boolean)
      .slice(0, 5);

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('spell_context');

    const defaultSystemPrompt = `Corretor ortográfico contextual de português brasileiro. Corrija SOMENTE a palavra entre <<< >>>, sem reescrever o trecho.

- Decida pela concordância com o que está em volta (determinante, possessivo, substantivo, verbo).
- Os candidatos do dicionário são pistas e podem estar todos errados; proponha uma forma fora da lista quando for claramente a pretendida.
- Só pt-BR padrão. Alongamento informal ("Oiee") volta à forma convencional. Preserve a caixa.
- Máximo 3 opções, só de confiança alta ou média. Palavra adequada (nome próprio, termo técnico, latinismo): lista vazia.

JSON apenas: {"suggestions":[]}`;

    const systemPrompt = this.getPrompt('spell_context', defaultSystemPrompt);
    // A palavra-alvo é marcada dentro do próprio trecho: uma linha em vez de
    // quatro rótulos, com a mesma informação.
    const marked = sentence.includes(word)
      ? sentence.replace(word, `<<<${word}>>>`)
      : `<<<${word}>>> — ${sentence}`;
    const userPrompt = candidates.length ? `${marked}\ndicionário: ${candidates.join(', ')}` : marked;

    try {
      const content = await this.callOpenAIViaEdgeFunction(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // Correção de uma palavra é uma tarefa curta e frequente. Fixamos o
        // modelo econômico mesmo se existir configuração antiga com gpt-4o.
        CHEAPEST_SPELL_MODEL,
        Math.min(Math.max(taskOpts.maxTokens, 64), WORD_RESPONSE_MAX_TOKENS),
        {
          taskKey: 'spell_context',
          temperature: 0,
          responseFormat: 'json_object',
          reasoningEffort: 'minimal',
          signal: params.signal,
        },
      );

      if (params.signal?.aborted) {
        throw new DOMException('Análise contextual cancelada.', 'AbortError');
      }

      const jsonText = this.extractJsonObject(String(content || ''));
      if (!jsonText) throw new Error('A IA não retornou JSON válido.');

      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed?.suggestions)) {
        throw new Error('A resposta da IA não contém a lista de sugestões.');
      }
      return normalizeContextualSpellingSuggestions(parsed.suggestions, word);
    } catch (err) {
      console.warn('[ai.service] suggestSpellingInContext falhou:', err);
      throw err instanceof Error ? err : new Error('Falha na análise ortográfica contextual.');
    }
  }

  /**
   * Chat do assistente do Editor de Petições.
   *
   * Recebe o histórico da conversa, o texto do documento e um callback de
   * busca LOCAL na base de blocos-modelo (roda no navegador, custo zero de
   * tokens). O fluxo é agêntico e econômico:
   *  1. Busca local inicial com a mensagem do usuário → só os top trechos vão
   *     no prompt (nunca a base inteira).
   *  2. Se a IA precisar de outro modelo, ela retorna "search" com termos
   *     melhores; a busca roda localmente e a IA é chamada de novo (máx. 2x).
   *  3. Se faltar informação factual (jornada, salário, datas...), a IA
   *     retorna "questions" em vez de inventar — o widget exibe as perguntas
   *     com opções clicáveis.
   */
  async petitionAssistantChat(params: {
    history: PetitionChatMessageInput[];
    documentText: string;
    selectedText?: string;
    /** Resumo dos dados do cliente/petição vinculados (nome, CPF, área...). */
    clientContext?: string;
    /** Busca local na base de conhecimento. Nunca consome tokens. */
    searchKb?: (query: string) => PetitionChatKbSnippet[];
    /** Progresso para a UI: 'thinking' (chamando IA) | 'searching' (busca local). */
    onProgress?: (stage: 'thinking' | 'searching', detail?: string) => void;
  }): Promise<PetitionChatResult> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está disponível');
    }

    const history = (params.history || []).slice(-14);
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content?.trim()) {
      throw new Error('Digite uma mensagem para o assistente');
    }

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('petition_chat');

    const documentText = String(params.documentText || '').replace(/\r\n?/g, '\n').slice(0, 26000);
    const selectedText = String(params.selectedText || '').trim().slice(0, 8000);

    const systemPrompt = this.buildPetitionChatSystemPrompt('json');

    // Busca local inicial: mensagem do usuário + começo da seleção
    const searches: string[] = [];
    const runSearch = (query: string): PetitionChatKbSnippet[] => {
      const q = String(query || '').trim().slice(0, 120);
      if (!q || !params.searchKb) return [];
      params.onProgress?.('searching', q);
      searches.push(q);
      try {
        return (params.searchKb(q) || []).slice(0, 4);
      } catch {
        return [];
      }
    };

    // A consulta inicial junta as DUAS últimas mensagens do usuário: quando a
    // última é só a resposta de um formulário ("Resposta: 20 horas"), o pedido
    // original ("tópico sobre horas extras") continua guiando a busca.
    const userMessages = history.filter((m) => m.role === 'user');
    const previousUser = userMessages.length > 1 ? userMessages[userMessages.length - 2] : undefined;
    const initialQuery = [
      previousUser?.content.slice(0, 120) || '',
      lastUser.content.slice(0, 160),
      selectedText.slice(0, 120),
    ].filter(Boolean).join(' ');
    const initialSnippets = runSearch(initialQuery);

    const clientContext = String(params.clientContext || '').trim().slice(0, 1500);
    const contextParts = [
      `DOCUMENTO ABERTO NO EDITOR (texto puro; a formatação real é mantida pelo editor):\n${documentText || '(documento vazio)'}`,
      selectedText ? `TRECHO SELECIONADO PELO USUÁRIO:\n${selectedText}` : '',
      clientContext ? `DADOS DO CLIENTE VINCULADO (use estes dados em vez de perguntar; NUNCA invente os que faltarem):\n${clientContext}` : '',
      params.searchKb ? formatKbSnippets(initialQuery, initialSnippets) : '',
    ].filter(Boolean).join('\n\n====================\n\n');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Contexto atualizado:\n\n${contextParts}` },
      { role: 'assistant', content: '{"reply":"Contexto recebido. Como posso ajudar com o documento?","questions":[],"actions":[]}' },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const model = taskOpts.model ?? 'gpt-4o';
    // Teto alto: JSON truncado no meio quebra o parse e vira texto cru no chat.
    const maxTokens = Math.max(taskOpts.maxTokens, 4000);

    // Loop de recuperação: chamada inicial + até 2 rodadas de busca pedidas pela IA
    const MAX_SEARCH_ROUNDS = 2;
    let parsed = null as ReturnType<AIService['parsePetitionChatResponse']> | null;

    for (let round = 0; ; round++) {
      params.onProgress?.('thinking');
      const content = await this.callOpenAIViaEdgeFunction(messages, model, maxTokens, {
        taskKey: 'petition_chat',
        temperature: 0.15,
        responseFormat: 'json_object',
      });
      const raw = String(content || '').trim();
      if (!raw) throw new Error('IA não retornou resposta');

      parsed = this.parsePetitionChatResponse(raw);

      const searchQuery = parsed.search?.trim();
      const alreadySearched = searchQuery ? searches.some((s) => normalizePtQuery(s) === normalizePtQuery(searchQuery)) : true;
      if (!searchQuery || alreadySearched || round >= MAX_SEARCH_ROUNDS || !params.searchKb) break;

      const snippets = runSearch(searchQuery);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `${formatKbSnippets(searchQuery, snippets)}\n\nAgora responda a última mensagem do usuário usando esses modelos (não peça a mesma busca de novo).`,
      });
    }

    return {
      reply: parsed!.reply,
      actions: parsed!.actions,
      questions: parsed!.questions,
      searches,
    };
  }

  /**
   * Versão STREAMING do chat do assistente de petições.
   *
   * Protocolo streaming-friendly: o modelo escreve a resposta em markdown
   * (streamada ao vivo via onReplyDelta) e, apenas quando houver ações,
   * perguntas ou busca, encerra com um único bloco ```json:actions``` que é
   * parseado UMA vez ao completar — JSON parcial nunca é parseado.
   *
   * Mantém o loop agêntico de busca local (máx. 2 rodadas) e cai no caminho
   * não-streaming (mesmo prompt, resposta completa) se o stream falhar.
   */
  async petitionAssistantChatStream(params: {
    history: PetitionChatMessageInput[];
    documentText: string;
    selectedText?: string;
    /** Resumo dos dados do cliente/petição vinculados (nome, CPF, área...). */
    clientContext?: string;
    /** Busca local na base de conhecimento. Nunca consome tokens. */
    searchKb?: (query: string) => PetitionChatKbSnippet[];
    /** Busca no acervo do Nextcloud (assíncrona: baixa e lê os arquivos). */
    searchArchive?: (query: string) => Promise<PetitionChatArchiveSnippet[]>;
    /** Briefing da peça definido no formulário do widget. */
    briefing?: PetitionChatBriefing;
    /**
     * 'selection' = trabalhar SOMENTE dentro do trecho selecionado (o restante
     * do documento vai apenas como contexto de leitura).
     */
    scope?: 'document' | 'selection';
    /** Cancelamento (botão "Parar"). Mantém o texto parcial, descarta ações. */
    signal?: AbortSignal;
    onProgress?: (stage: 'thinking' | 'searching' | 'streaming', detail?: string) => void;
    /** Texto visível acumulado (sem o bloco json:actions), a cada chunk. */
    onReplyDelta?: (visibleReply: string) => void;
  }): Promise<PetitionChatResult & { aborted?: boolean; archiveSources?: string[] }> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está disponível');
    }

    const history = (params.history || []).slice(-14);
    const lastUser = [...history].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content?.trim()) {
      throw new Error('Digite uma mensagem para o assistente');
    }

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('petition_chat');

    const documentText = String(params.documentText || '').replace(/\r\n?/g, '\n').slice(0, 26000);
    const selectedText = String(params.selectedText || '').trim().slice(0, 8000);
    const scope = params.scope === 'selection' && selectedText ? 'selection' : 'document';

    const systemPrompt = this.buildPetitionChatSystemPrompt('stream');

    const searches: string[] = [];
    const runSearch = (query: string): PetitionChatKbSnippet[] => {
      const q = String(query || '').trim().slice(0, 120);
      if (!q || !params.searchKb) return [];
      params.onProgress?.('searching', q);
      searches.push(q);
      try {
        return (params.searchKb(q) || []).slice(0, 4);
      } catch {
        return [];
      }
    };

    const archiveSources: string[] = [];
    const runArchiveSearch = async (query: string): Promise<PetitionChatArchiveSnippet[]> => {
      const q = String(query || '').trim().slice(0, 160);
      if (!q || !params.searchArchive) return [];
      params.onProgress?.('searching', `acervo: ${q.slice(0, 40)}`);
      try {
        const found = (await params.searchArchive(q)) || [];
        for (const item of found) {
          if (item?.path && !archiveSources.includes(item.path)) archiveSources.push(item.path);
        }
        return found.slice(0, 3);
      } catch {
        // Acervo indisponível nunca derruba a resposta.
        return [];
      }
    };

    const userMessages = history.filter((m) => m.role === 'user');
    const previousUser = userMessages.length > 1 ? userMessages[userMessages.length - 2] : undefined;
    const initialQuery = [
      previousUser?.content.slice(0, 120) || '',
      lastUser.content.slice(0, 160),
      selectedText.slice(0, 120),
    ].filter(Boolean).join(' ');
    const initialSnippets = runSearch(initialQuery);
    const archiveSnippets = await runArchiveSearch(
      [params.briefing?.area, params.briefing?.documentType, initialQuery].filter(Boolean).join(' '),
    );

    const clientContext = String(params.clientContext || '').trim().slice(0, 1500);
    const briefingBlock = formatBriefing(params.briefing);
    const documentLabel = scope === 'selection'
      ? 'DOCUMENTO ABERTO NO EDITOR (apenas CONTEXTO DE LEITURA — a tarefa é sobre o trecho selecionado):'
      : 'DOCUMENTO ABERTO NO EDITOR (texto puro; a formatação real é mantida pelo editor):';
    const contextParts = [
      briefingBlock,
      `${documentLabel}\n${documentText || '(documento vazio)'}`,
      selectedText
        ? `TRECHO SELECIONADO PELO USUÁRIO${scope === 'selection' ? ' — ESCOPO EXCLUSIVO DESTA TAREFA' : ''}:\n${selectedText}`
        : '',
      clientContext ? `DADOS DO CLIENTE VINCULADO (use estes dados em vez de perguntar; NUNCA invente os que faltarem):\n${clientContext}` : '',
      params.searchKb ? formatKbSnippets(initialQuery, initialSnippets) : '',
      formatArchiveSnippets(archiveSnippets),
      scope === 'selection'
        ? 'ESCOPO ATIVO: SELEÇÃO. Toda ação proposta deve incidir DENTRO do trecho selecionado. Não corrija, não reescreva e não comente o restante do documento; se notar algo relevante fora da seleção, apenas avise em uma frase no final, sem criar ação.'
        : '',
    ].filter(Boolean).join('\n\n====================\n\n');

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Contexto atualizado:\n\n${contextParts}` },
      { role: 'assistant', content: 'Contexto recebido. Como posso ajudar com o documento?' },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const model = taskOpts.model ?? 'gpt-4o';
    const maxTokens = Math.max(taskOpts.maxTokens, 4000);
    const MAX_SEARCH_ROUNDS = 2;

    for (let round = 0; ; round++) {
      params.onProgress?.('thinking');

      let raw = '';
      let aborted = false;
      let emittedVisible = '';

      try {
        const result = await streamChatCompletion({
          messages,
          model,
          maxTokens,
          temperature: 0.15,
          taskKey: 'petition_chat',
          signal: params.signal,
          onDelta: (_chunk, full) => {
            // Modelo ignorou o protocolo e respondeu JSON puro: não mostrar
            // o JSON cru sendo digitado — parse acontece no final.
            if (full.trimStart().startsWith('{')) return;
            params.onProgress?.('streaming');
            const { visibleReply } = this.splitStreamingReply(full);
            if (visibleReply !== emittedVisible) {
              emittedVisible = visibleReply;
              params.onReplyDelta?.(visibleReply);
            }
          },
        });
        raw = result.text.trim();
        aborted = Boolean(result.aborted);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { reply: emittedVisible, actions: [], questions: [], searches, archiveSources, aborted: true };
        }
        // Stream indisponível (rede, function antiga com erro etc.): mesma
        // conversa, resposta completa de uma vez.
        const content = await this.callOpenAIViaEdgeFunction(messages, model, maxTokens, {
          taskKey: 'petition_chat',
          temperature: 0.15,
        });
        raw = String(content || '').trim();
      }

      if (!raw) {
        if (aborted) return { reply: emittedVisible, actions: [], questions: [], searches, archiveSources, aborted: true };
        throw new Error('IA não retornou resposta');
      }

      const parsed = this.parseStreamingPetitionResponse(raw);

      if (aborted) {
        // Geração interrompida: mantém o texto parcial, descarta ações.
        return { reply: parsed.reply, actions: [], questions: [], searches, archiveSources, aborted: true };
      }

      const searchQuery = parsed.search?.trim();
      const alreadySearched = searchQuery ? searches.some((s) => normalizePtQuery(s) === normalizePtQuery(searchQuery)) : true;
      if (!searchQuery || alreadySearched || round >= MAX_SEARCH_ROUNDS || !params.searchKb) {
        return { reply: parsed.reply, actions: parsed.actions, questions: parsed.questions, searches, archiveSources };
      }

      const snippets = runSearch(searchQuery);
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: `${formatKbSnippets(searchQuery, snippets)}\n\nAgora responda a última mensagem do usuário usando esses modelos (não peça a mesma busca de novo).`,
      });
      // Nova rodada substitui o texto da anterior na UI.
      params.onReplyDelta?.('');
    }
  }

  /**
   * Separa o texto visível do bloco ```json:actions``` durante o streaming.
   * Enquanto o bloco não fecha, ele é apenas OCULTADO (nunca parseado).
   * Hold-back: um sufixo que pode ser o começo do fence fica retido para não
   * piscar backticks na tela antes de desambiguar.
   */
  private splitStreamingReply(fullText: string): { visibleReply: string; tail: string | null } {
    const text = String(fullText || '');
    const lower = text.toLowerCase();

    const idx = lower.indexOf('```json');
    if (idx >= 0) {
      return { visibleReply: text.slice(0, idx).trimEnd(), tail: text.slice(idx) };
    }

    const fence = '```json:actions';
    const maxHold = Math.min(fence.length - 1, text.length);
    for (let k = maxHold; k > 0; k--) {
      if (lower.endsWith(fence.slice(0, k))) {
        return { visibleReply: text.slice(0, text.length - k).trimEnd(), tail: null };
      }
    }

    return { visibleReply: text, tail: null };
  }

  /** Parse final da resposta streaming: markdown visível + bloco json:actions. */
  private parseStreamingPetitionResponse(raw: string): {
    reply: string;
    actions: PetitionChatAction[];
    questions: PetitionChatQuestion[];
    search?: string;
  } {
    const text = String(raw || '').trim();
    // Modelo ignorou o protocolo e devolveu o JSON antigo ({"reply": ...}).
    if (text.startsWith('{')) return this.parsePetitionChatResponse(text);

    const { visibleReply, tail } = this.splitStreamingReply(text);

    let actions: PetitionChatAction[] = [];
    let questions: PetitionChatQuestion[] = [];
    let search: string | undefined;

    if (tail) {
      const jsonText = this.extractJsonObject(tail);
      if (jsonText) {
        try {
          ({ actions, questions, search } = this.mapPetitionChatPayload(JSON.parse(jsonText)));
        } catch {
          // Bloco malformado: fica só o texto do reply.
        }
      }
    }

    const reply = visibleReply
      || (questions.length ? 'Preciso de algumas informações antes de continuar.' : 'Pronto.');
    return { reply, actions, questions, search };
  }

  /**
   * Prompt de sistema do assistente de petições.
   * 'json'   — protocolo original: resposta inteira num objeto JSON.
   * 'stream' — protocolo streaming: reply em markdown + bloco ```json:actions```
   *            no final (a seção extra SUBSTITUI a instrução de formato JSON).
   */
  private buildPetitionChatSystemPrompt(mode: 'json' | 'stream'): string {
    const defaultSystemPrompt = `Você é o assistente jurídico do Editor de Petições de um escritório de advocacia brasileiro. Você conversa com o advogado sobre o documento aberto no editor e pode propor alterações que o sistema aplica no documento após aprovação.

O QUE VOCÊ SABE FAZER:
- Revisar o documento e fazer apontamentos (erros, inconsistências, argumentos frágeis, pedidos faltantes).
- Corrigir ortografia, gramática, concordância e pontuação.
- Melhorar a redação de trechos.
- REMOVER conteúdo: duplicações, parágrafos repetidos, rascunhos e trechos que o advogado mandou tirar (ação "delete").
- Redigir e inserir conteúdo novo (tópicos, parágrafos, fundamentos, pedidos) no estilo dos modelos do escritório.
- Estruturar uma peça do zero: definir os tópicos na ordem correta para a área e o tipo de peça.
- Auditar a coerência interna: fatos × fundamentos × pedidos × valor da causa × documentos citados.
- Antecipar a defesa: apontar os contra-argumentos prováveis da parte adversa e como blindá-los.
- Indicar os dispositivos legais, súmulas e teses aplicáveis, SEMPRE marcando o que o advogado precisa conferir.
- Conferir coerência de datas, prazos, prescrição e decadência a partir do que está no documento.
- Fazer cálculos trabalhistas/cíveis simples quando o usuário fornecer os dados (ex.: hora extra = salário ÷ divisor × 1,5 × quantidade), sempre declarando as premissas.
- Padronizar títulos, numeração e formatação dos tópicos conforme o padrão já usado na peça.
- Reescrever em linguagem simples/acessível quando pedido, sem perder precisão técnica.
- Resumir a peça, listar as provas necessárias e montar perguntas objetivas para o cliente.
- Responder dúvidas sobre o conteúdo do documento.

FORMATO DA RESPOSTA — retorne APENAS JSON válido, sem texto fora dele:
{
  "reply": "sua resposta em texto para o chat",
  "questions": [
    { "question": "pergunta de esclarecimento", "options": ["opção 1", "opção 2"] }
  ],
  "actions": [
    { "type": "replace", "label": "descrição curta", "search": "trecho EXATO copiado do documento", "replace": "trecho corrigido", "searchEnd": "fim do trecho quando ele atravessa parágrafos (opcional)" },
    { "type": "delete", "label": "descrição curta", "search": "PRIMEIRA linha EXATA do trecho a remover", "searchEnd": "ÚLTIMA linha EXATA do trecho a remover (obrigatório quando são vários parágrafos)", "occurrence": "last" ou "first" },
    { "type": "insert", "label": "descrição curta", "position": "cursor" ou "end", "text": "texto a inserir" },
    { "type": "insert_block", "label": "descrição curta", "blockId": "id do modelo", "position": "cursor" ou "end", "replacements": [ { "search": "trecho EXATO do modelo", "replace": "valor do caso" } ] }
  ],
  "search": "termos para buscar outro modelo na base (opcional, use raramente)"
}
Todos os campos exceto "reply" são opcionais — omita ou deixe vazio quando não usar. "reply" é texto puro, SEM markdown (nada de **, #, listas com -).

USO INTEGRAL DE MODELOS (prioridade máxima ao redigir conteúdo novo):
- Se um dos modelos fornecidos marcado como [TEXTO INTEGRAL] cobre o tema pedido, você DEVE usar "insert_block" com o blockId dele. O sistema insere o modelo com o texto E a formatação originais, na íntegra.
- As ÚNICAS mudanças permitidas são os dados do caso concreto, via "replacements": cada "search" é um trecho VERBATIM do modelo (de preferência variáveis [[ASSIM]], ou números/valores/nomes) e "replace" é o valor do caso. NÃO reescreva, NÃO resuma, NÃO reordene, NÃO "melhore" o modelo.
- Se o modelo relevante veio como [trecho parcial], retorne "search" com o título dele para receber o texto integral antes de propor a ação.
- Só use "insert" com texto de sua autoria quando NENHUM modelo da base cobrir o pedido — e diga isso no reply.

ANTES DE REDIGIR CONTEÚDO NOVO — CHECAGEM DE FATOS (regra central):
1. Reúna os fatos necessários NA SEGUINTE ORDEM: (a) o que está no documento; (b) o que está na conversa; (c) o que o modelo escolhido pede (variáveis [[...]] e dados citados). Exemplos: tópico de horas extras → jornada contratual, quantidade média de horas extras, salário; dano moral → fato lesivo e consequências.
2. NUNCA pergunte um dado que já está no documento ou na conversa — use-o direto e cite a premissa no reply (ex.: "usei o salário de R$ 2.200,00 que consta no documento"). Não peça confirmação do que já está escrito.
3. Se faltar informação ESSENCIAL, retorne "questions" com TODAS as perguntas essenciais DE UMA VEZ (o usuário responde tudo junto num formulário). Nesse caso NÃO retorne "actions" ainda. Inclua "options" quando fizer sentido, sempre incluindo a opção de usar variável [[NOME_CAMPO]] para preencher depois.
4. Com os fatos em mãos (ou variáveis autorizadas), proponha a ação ("insert_block" se houver modelo; senão "insert").
Máximo de 3 perguntas, só as essenciais. Nunca repita pergunta já respondida.

BASE DE CONHECIMENTO (modelos do escritório):
- Você recebe modelos selecionados por uma busca local. O primeiro geralmente vem com [TEXTO INTEGRAL]; os demais como [trecho parcial].
- Se os modelos recebidos não servirem e você precisar de um específico (ex.: fundamentação de insalubridade), retorne "search" com 2 a 5 palavras-chave. O sistema busca localmente e te chama de novo. Use só quando necessário.
- Nunca peça "search" para algo que você já recebeu ou que não depende de modelo.

REGRAS PARA "replace" (CRÍTICAS — preservam a formatação do documento):
- "search" da ação deve ser um trecho VERBATIM do documento: mesmas letras, acentos, espaços e pontuação. NUNCA parafraseie o trecho original.
- O trecho deve estar contido em UM único parágrafo (não pode atravessar quebra de parágrafo).
- Correções CIRÚRGICAS: substitua o menor trecho possível. NUNCA reescreva o documento inteiro.
- Uma ação por correção; várias correções = várias ações. O usuário escolhe quais aplicar por checkbox, então NÃO agrupe correções independentes numa ação só.

REGRAS PARA "delete" (REMOVER conteúdo — use SEMPRE que o pedido for tirar/limpar/apagar algo):
- NUNCA use "replace" com "replace" vazio para remover: use "delete".
- "search" é a PRIMEIRA linha do trecho a remover, copiada VERBATIM do documento. Quando o trecho ocupa mais de um parágrafo, "searchEnd" é a ÚLTIMA linha dele, também VERBATIM. O sistema seleciona tudo entre as duas pontas — inclusive as quebras de parágrafo — e apaga de uma vez.
- Copie as linhas do documento SEM juntar parágrafos e SEM reticências: "…" no meio do trecho faz a remoção falhar.
- CONTEÚDO DUPLICADO: use "occurrence": "last" para apagar a cópia acrescentada depois e preservar a original. Uma ação por bloco duplicado.
- Se o trecho a remover for longo, ainda assim informe apenas as duas pontas ("search" + "searchEnd") — não cole o bloco inteiro.
- Antes de propor a remoção, confirme no DOCUMENTO ABERTO que as duas linhas existem exatamente como você as escreveu.

REGRAS PARA "insert":
- "position": "cursor" para inserir onde o usuário está; "end" para adicionar ao final (novo tópico, novo pedido). O sistema insere "end" automaticamente ANTES do fecho da petição (Termos em que / data / assinatura) — NUNCA inclua data, local, "Termos em que", "Pede deferimento" ou assinatura no "text".
- QUEBRA DE LINHA É OBRIGATÓRIA: cada título, cada item e cada parágrafo em uma linha própria, separados por \\n. NUNCA entregue uma estrutura inteira numa linha só ("1. PREÂMBULO - Identificação - Qualificação 2. DOS FATOS ...") — isso vira um parágrafo ilegível no documento.
- NADA de markdown dentro de "text": sem **, sem ##, sem \`\`\`. O documento é Word, não chat.
- ANTES DE INSERIR, confira se o conteúdo JÁ EXISTE no documento. Se existir (mesmo com outras palavras), não insira de novo: proponha "replace" para melhorar ou "delete" para limpar, e explique no texto.
- Em "text", use \\n para separar parágrafos. Títulos de tópicos em MAIÚSCULAS em linha própria (ex.: "DAS HORAS EXTRAS").
- SIGA O PADRÃO DO DOCUMENTO: se os títulos existentes são numerados (ex.: "2.4 – DA MULTA..."), o novo título continua a sequência ("2.5 – ..."); se usam "DA/DO/DAS/DOS", mantenha; copie o mesmo estilo de caixa alta e pontuação. Um tópico novo entre tópicos existentes deve parecer escrito pelo mesmo autor.
- Texto puro, sem markdown, sem cercas de código.

DOCUMENTO EM BRANCO — SEMPRE COMECE PELO BRIEFING:
- Se o documento está vazio (ou praticamente vazio) e você NÃO recebeu um BRIEFING DA PEÇA, é PROIBIDO propor estrutura, tópicos ou texto genérico. Pergunte primeiro, com "questions", nesta ordem de prioridade:
  1. "Qual a área do Direito?" — options: ["Trabalhista", "Cível", "Previdenciário", "Família", "Consumidor", "Criminal", "Tributário", "Administrativo", "Empresarial"] (escolha as 4 mais prováveis pelo contexto).
  2. "Que tipo de peça vamos redigir?" — options: ["Petição inicial", "Contestação", "Recurso", "Manifestação/Petição simples", "Parecer", "Notificação extrajudicial"].
  3. "Nosso cliente está em qual polo?" — options: ["Autor/Reclamante", "Réu/Reclamado", "Terceiro interessado"].
- Se o briefing responder algum desses itens, NÃO pergunte de novo — pergunte só o que falta e complemente com uma pergunta sobre os FATOS essenciais.
- Uma peça genérica ("DOS FATOS / DO DIREITO / DOS PEDIDOS" sem conteúdo) não ajuda ninguém: a estrutura só é útil depois que você sabe a área, o tipo e o polo, porque cada combinação tem tópicos próprios (ex.: inicial trabalhista tem "DA JORNADA" e "DO VÍNCULO"; contestação tem "DAS PRELIMINARES" e "DA IMPUGNAÇÃO ESPECÍFICA"; recurso tem "DA TEMPESTIVIDADE" e "DO PREQUESTIONAMENTO").

ACERVO DO ESCRITÓRIO (Nextcloud):
- Além dos blocos-modelo, você pode receber trechos de PEÇAS REAIS já protocoladas, com o caminho do arquivo. Use-as para acertar o estilo da casa, a estrutura habitual e as teses que o escritório costuma sustentar.
- NUNCA copie dados de outro cliente (nomes, CPF, valores, datas, número de processo) de uma peça do acervo. Só estrutura, redação e fundamentação.
- Quando uma peça do acervo embasar a resposta, cite o nome do arquivo no texto ("com base em: <arquivo>").
- Peça do acervo não tem blockId — nunca use "insert_block" com ela.

REGRAS GERAIS:
- Não invente fatos, datas, valores, nomes ou números de processo.
- Pedido de só análise/apontamento/dúvida → "actions": [] e tudo em "reply".
- Se o usuário selecionou um trecho, priorize trabalhar sobre ele. Quando o contexto indicar ESCOPO ATIVO: SELEÇÃO, é PROIBIDO propor ação fora do trecho selecionado.
- Ao citar lei, súmula, tese ou precedente, escreva o dispositivo por extenso e marque de forma explícita quando a referência precisa ser conferida antes do protocolo. Nunca invente número de súmula, tema repetitivo ou acórdão.
- Nunca repita uma ação que já foi aplicada nesta conversa. Se o usuário pedir de novo o que você já inseriu, diga que já está no documento e ofereça revisar ou remover.
- "reply" em português do Brasil, direto e profissional. Não repita em "reply" o texto integral das ações; resuma o que cada uma faz.`;

    const qualityRules = `REGRAS DE QUALIDADE E EXECUCAO:
- Trate a resposta como trabalho para advogado: seja especifico, aplicavel e tecnicamente defensavel.
- Para revisar, aponte problemas concretos com motivo e solucao sugerida. Nao responda genericamente.
- Para corrigir, gere acoes pequenas e aplicaveis. O campo "search" deve copiar literalmente o trecho do DOCUMENTO ABERTO.
- Para melhorar uma selecao, prefira uma unica acao "replace" usando exatamente o TRECHO SELECIONADO como "search".
- Para criar novo conteudo, nao use texto raso. Estruture fundamento, enquadramento juridico e pedido/reflexo quando pertinente.
- Dados informados pelo usuario prevalecem sobre qualquer texto do modelo. Se o modelo disser jornada, salario, quantidade, datas ou valores diferentes, substitua pelo dado do usuario ou use variavel.
- Se faltar salario/base de calculo, nao calcule valores. Use variaveis como [[VALOR_HORAS_EXTRAS]], [[VALOR_REFLEXO_FERIAS]], [[VALOR_REFLEXO_13]], [[VALOR_REFLEXO_AVISO]], [[VALOR_REFLEXO_DSR]] e [[VALOR_TOTAL]].
- Ao usar insert_block, inclua replacements para TODA informacao conflitante do modelo, principalmente jornada, periodo, salario, quantidade de horas extras e valores monetarios.
- Quando nao houver dados suficientes, faca perguntas objetivas de uma vez. Nao invente fatos.
- Remocao pedida pelo usuario ("remova", "tire", "esta duplicado", "limpe") = acao "delete" com search + searchEnd. Nunca responda apenas descrevendo o que deveria ser removido.
- Antes de qualquer insercao, verifique se aquilo ja esta no documento. Conteudo repetido e o erro mais caro nesta ferramenta.
- Estrutura, sumario e lista SEMPRE com uma quebra de linha por item. Texto de acao nunca sai em uma linha unica.`;

    const jsonFormatRule = '- Retorne JSON valido. Sem markdown, sem comentarios, sem texto antes ou depois do JSON.';

    const streamFormatSection = `FORMATO DA RESPOSTA EM STREAMING (ATENCAO: esta secao SUBSTITUI qualquer instrucao anterior de responder em JSON):
- Escreva sua resposta ao advogado como TEXTO NORMAL (nunca um objeto JSON), com markdown leve: **negrito** para destaques, listas com "-" ou "1.", "###" para subtitulos curtos quando ajudar na leitura. Seja direto.
- Se propuser acoes, perguntas ou uma busca na base, acrescente AO FINAL da resposta UM UNICO bloco de codigo neste formato exato:
\`\`\`json:actions
{ "actions": [ ... ], "questions": [ ... ], "search": "..." }
\`\`\`
- Dentro do bloco valem os MESMOS schemas e regras de "actions", "questions" e "search" descritos acima (replace cirurgico com trecho verbatim do documento, insert, insert_block com replacements etc.).
- NAO inclua o campo "reply" dentro do bloco: o texto fora do bloco JA E a sua resposta.
- Omita o bloco por completo quando nao houver acoes, perguntas nem busca.
- O bloco json:actions e o UNICO bloco de codigo permitido na resposta: nunca use cercas de codigo (\`\`\`) para outra coisa e NUNCA escreva nada depois do bloco.
- Nao repita no texto o conteudo integral das acoes; resuma o que cada uma faz.`;

    const base = this.getPrompt('petition_chat', defaultSystemPrompt);

    if (mode === 'json') {
      return `${base}\n\n${qualityRules}\n${jsonFormatRule}`;
    }
    return `${base}\n\n${qualityRules}\n\n${streamFormatSection}`;
  }

  /** Faz o parse tolerante do JSON do protocolo do assistente de petições. */
  private parsePetitionChatResponse(raw: string): {
    reply: string;
    actions: PetitionChatAction[];
    questions: PetitionChatQuestion[];
    search?: string;
  } {
    const jsonText = this.extractJsonObject(raw);
    if (!jsonText) return { reply: raw, actions: [], questions: [] };

    try {
      const parsed = JSON.parse(jsonText);
      const { actions, questions, search } = this.mapPetitionChatPayload(parsed);

      return {
        reply: String(parsed.reply || '').trim() || (questions.length ? 'Preciso de algumas informações antes de continuar.' : 'Pronto.'),
        actions,
        questions,
        search,
      };
    } catch {
      // JSON malformado: devolve o texto bruto como resposta de chat.
      return { reply: raw, actions: [], questions: [] };
    }
  }

  /** Mapeia/valida actions, questions e search de um payload já parseado. */
  private mapPetitionChatPayload(parsed: any): {
    actions: PetitionChatAction[];
    questions: PetitionChatQuestion[];
    search?: string;
  } {
      const actions: PetitionChatAction[] = Array.isArray(parsed.actions)
        ? parsed.actions
            .filter((a: any) => a && (a.type === 'replace' || a.type === 'insert' || a.type === 'insert_block' || a.type === 'delete'))
            .map((a: any): PetitionChatAction => ({
              type: a.type,
              label: typeof a.label === 'string' ? a.label : undefined,
              search: typeof a.search === 'string' ? a.search : undefined,
              replace: typeof a.replace === 'string' ? a.replace : undefined,
              searchEnd: typeof a.searchEnd === 'string' && a.searchEnd.trim() ? a.searchEnd : undefined,
              occurrence: a.occurrence === 'first' || a.occurrence === 'last' ? a.occurrence : undefined,
              position: a.position === 'end' ? 'end' : 'cursor',
              text: typeof a.text === 'string' ? a.text : undefined,
              blockId: typeof a.blockId === 'string' ? a.blockId.trim() : undefined,
              replacements: Array.isArray(a.replacements)
                ? a.replacements
                    .filter((r: any) => r && typeof r.search === 'string' && r.search.trim() && typeof r.replace === 'string')
                    .map((r: any): PetitionChatActionReplacement => ({ search: r.search, replace: r.replace }))
                : undefined,
            }))
            .filter((a: PetitionChatAction) => {
              if (a.type === 'replace') return Boolean(a.search?.trim()) && typeof a.replace === 'string';
              // Remoção precisa de trecho longo o bastante para ser inequívoco:
              // apagar "de" pelo documento inteiro seria destrutivo.
              if (a.type === 'delete') return (a.search?.trim().length || 0) >= 8;
              if (a.type === 'insert_block') return Boolean(a.blockId);
              return Boolean(a.text?.trim());
            })
        : [];

      const questions: PetitionChatQuestion[] = Array.isArray(parsed.questions)
        ? parsed.questions
            .map((q: any): PetitionChatQuestion | null => {
              if (typeof q === 'string' && q.trim()) return { question: q.trim() };
              if (q && typeof q.question === 'string' && q.question.trim()) {
                const options = Array.isArray(q.options)
                  ? q.options.filter((o: any) => typeof o === 'string' && o.trim()).slice(0, 4)
                  : undefined;
                return { question: q.question.trim(), options: options?.length ? options : undefined };
              }
              return null;
            })
            .filter((q: PetitionChatQuestion | null): q is PetitionChatQuestion => q !== null)
            .slice(0, 3)
        : [];

      return {
        actions,
        questions,
        search: typeof parsed.search === 'string' && parsed.search.trim() ? parsed.search.trim() : undefined,
      };
  }

  /** Extrai o primeiro objeto JSON balanceado mesmo quando o provedor envolve em markdown. */
  private extractJsonObject(raw: string): string | null {
    const text = String(raw || '').trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();

    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return null;
  }

  /**
   * Chama a IA através da Edge Function `openai-proxy`. O servidor mantém a
   * cadeia de provedores (DeepSeek -> Groq -> OpenAI) e as chaves; o frontend
   * nunca vê nenhuma chave de IA.
   */
  private async callOpenAIViaEdgeFunction(
    messages: any[],
    model: string = 'gpt-4o-mini',
    maxTokens?: number,
    opts?: {
      taskKey?: string;
      temperature?: number;
      responseFormat?: 'json_object';
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const { data, error } = await supabase.functions.invoke('openai-proxy', {
      body: {
        messages,
        model,
        max_tokens: maxTokens,
        task_key: opts?.taskKey,
        temperature: opts?.temperature,
        response_format: opts?.responseFormat ? { type: opts.responseFormat } : undefined,
        reasoning_effort: opts?.reasoningEffort,
      },
      signal: opts?.signal,
    });

    if (error) {
      throw new Error(`Edge Function error: ${error.message}`);
    }
    if ((data as any)?.error) {
      throw new Error(`IA (openai-proxy) error: ${(data as any).error}`);
    }

    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Analisa uma intimação do DJEN e extrai informações relevantes
   */
  async analyzeIntimation(
    texto: string,
    numeroProcesso: string,
    dataDisponibilizacao: string,
    tipoDocumento?: string,
    tipoComunicacao?: string
  ): Promise<IntimationAnalysis> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está habilitado.');
    }
    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('analyze_intimation');

    try {
      const defaultSystemPrompt = `Você é um advogado sênior experiente lendo intimações para outro advogado ocupado.
Seu trabalho: extrair o que REALMENTE importa — o resultado, o impacto no cliente, o que fazer agora.
Retorne APENAS JSON válido. Nenhum texto fora do JSON.

ESTRUTURA OBRIGATÓRIA:
{
  "summary": "...",
  "deadline": { "days": null, "dueDate": null, "description": "", "confidence": "alta" },
  "urgency": "baixa|media|alta|critica",
  "suggestedActions": [],
  "keyPoints": [],
  "documentType": "Sentença|Despacho|Decisão Interlocutória|Acórdão|Mandado|Ofício|Outro",
  "importantPassages": []
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUMMARY — REGRAS ABSOLUTAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
O summary deve responder: "O que aconteceu? O que isso significa para o cliente?"

Para SENTENÇA ou ACÓRDÃO:
  Frase 1 OBRIGATÓRIA: "A ação foi JULGADA [PROCEDENTE / IMPROCEDENTE / PARCIALMENTE PROCEDENTE]."
  Frase 2: consequência concreta. Ex: "O réu deve pagar R$ 5.000 por danos morais." ou "O autor não recebe nada."
  Se IMPROCEDENTE: explique por que em 1 frase simples.

Para TUTELA / LIMINAR:
  "O juiz [CONCEDEU / NEGOU] a tutela de urgência. [Consequência imediata]."

Para DESPACHO com prazo:
  "O juiz determinou [o quê] em [X dias]."

Para AUDIÊNCIA marcada:
  "Audiência marcada para [data] às [hora]. [Tipo de audiência]."

PROIBIDO no summary:
  ✗ Descrever o processo ("Ação indenizatória decorrente de...")
  ✗ Mencionar o número do processo
  ✗ Usar linguagem jurídica desnecessária
  ✗ Iniciar com o tipo de documento ("Sentença...", "Despacho...")
  ✗ Resumir o raciocínio do juiz (isso vai nos keyPoints)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEADLINE — REGRA DE OURO: SÓ INVENTE SE ESTIVER NO TEXTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- SOMENTE preencha deadline se o texto contiver LITERALMENTE um prazo em dias (ex: "prazo de 15 dias", "em 5 dias úteis").
- "Sentença sujeita à homologação", "Após o trânsito em julgado", "Intimem-se" NÃO são prazos → deadline = null.
- Prazo recursal implícito (não mencionado no texto) → deadline = null.
- Se tiver prazo, "days" = o número exato do texto. NUNCA calcule ou suponha.
- dueDate: sempre null (calculado pelo sistema em dias úteis).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URGENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- critica: liminar/tutela concedida, prazo ≤ 3 dias, bloqueio de bem, cumprimento imediato
- alta: sentença definitiva, acórdão, audiência próxima, prazo ≤ 7 dias
- media: prazo 8-15 dias, despacho ordinatório
- baixa: ciência, arquivamento, sentença já favorável sem prazo pendente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KEY_POINTS — 4-5 itens, cada um com dado concreto
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cada keyPoint deve ser uma informação objetiva, não uma frase genérica.
Bons exemplos:
  ✓ "Resultado: IMPROCEDENTE — autor não recebe indenização"
  ✓ "Fundamento: ré comprovou comunicação formal do bloqueio (docs IDs 231013795 e 231013805)"
  ✓ "Saldo da autora na data do bloqueio: R$ 0,00"
  ✓ "Reversões realizadas: R$ 40,00 + R$ 676,85 via MED"
  ✓ "Sem custas — art. 55 da Lei 9.099/95"
  ✓ "Possível recurso: Recurso Inominado (Turma Recursal)"
Ruins (não use):
  ✗ "Decisão sobre conta digital"
  ✗ "Fundamentos analisados pelo juiz"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUGGESTED_ACTIONS — ações concretas com tag obrigatória
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tags: [PRAZO] [AUDIÊNCIA] [PAGAMENTO] [VÍNCULO] [PRESCRIÇÃO] [INFO]
- [PRAZO] → interpor recurso, contestar, embargar, protocolar dentro de prazo
- [AUDIÊNCIA] → agendar audiência ou ato processual com data
- [PAGAMENTO] → pagar condenação, custas, depositar valor, executar
- [VÍNCULO] → vincular ao cliente/processo no sistema
- [PRESCRIÇÃO] → controlar prazo prescricional ou decadencial
- [INFO] → informativo sem ação imediata

Exemplos para sentença improcedente sem prazo explícito:
  "[PRAZO] Avaliar interposição de Recurso Inominado perante a Turma Recursal"
  "[INFO] Comunicar resultado ao cliente: ação julgada improcedente"
  "[INFO] Aguardar trânsito em julgado para arquivamento"

Exemplos para sentença procedente com condenação:
  "[PAGAMENTO] Acompanhar pagamento espontâneo da condenação de R$ X"
  "[PRAZO] Iniciar cumprimento de sentença após trânsito em julgado"

NÃO use "[PRAZO] Analisar prazo recursal" — seja específico sobre O QUE protocolar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT_PASSAGES — trechos VERBATIM do texto
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Copie exatamente como está no texto (mesmas letras, espaços, pontuação).
PRIORIDADE OBRIGATÓRIA:
  1. O dispositivo da sentença (trecho com "JULGO", "CONDENO", "DETERMINO", "CONCEDO", "NEGO")
  2. A razão principal da decisão (fundamento determinante)
  3. Valores ou ordens concretas (se houver)

Tamanho: mínimo 20 palavras, máximo 120 palavras por trecho.
NÃO copie: cabeçalho, partes, preâmbulo, jurisprudência citada como exemplo.
Se o texto tiver "Ante o exposto" ou "Pelo exposto" — COPIE ESSA FRASE E O QUE VEM DEPOIS.`;

      const systemPrompt = this.getPrompt('analyze_intimation', defaultSystemPrompt);

      const userPrompt = `Processo: ${numeroProcesso}
Tipo de Documento: ${tipoDocumento || 'Não especificado'}
Tipo de Comunicação: ${tipoComunicacao || 'Não especificado'}

Texto da Intimação:
${texto}`;

      let content: string | null = await this.callOpenAIViaEdgeFunction([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], taskOpts.model ?? 'gpt-4o', taskOpts.maxTokens);

      if (!content) {
        throw new Error('Resposta vazia da API');
      }
      
      // Extrair JSON da resposta (Groq pode retornar texto extra)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const analysis: IntimationAnalysis = JSON.parse(content);
      
      // Calcular data de vencimento usando dias úteis A PARTIR DA DATA DE DISPONIBILIZAÇÃO
      if (analysis.deadline && analysis.deadline.days) {
        analysis.deadline.dueDate = this.venceEm(dataDisponibilizacao, analysis.deadline.days);
      }

      return analysis;
    } catch (error: any) {
      console.error('Erro ao analisar intimação com IA:', error);
      throw new Error(`Erro na análise: ${error.message}`);
    }
  }

  /**
   * Extrai prazo de um texto de intimação
   */
  async extractDeadline(texto: string): Promise<DeadlineExtraction | null> {
    if (!this.isEnabled()) {
      return null;
    }
    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('extract_deadline');

    try {
      const defaultSystemPrompt = `Você é um especialista em extração de prazos processuais brasileiros.
Analise o texto e identifique se há algum prazo. Responda APENAS com JSON:

{
  "days": número_de_dias_ou_null,
  "dueDate": "data_limite_ISO_ou_null",
  "description": "descrição_do_prazo",
  "confidence": "baixa|media|alta"
}

Se não houver prazo, retorne null para days e dueDate.`;

      const systemPrompt = this.getPrompt('extract_deadline', defaultSystemPrompt);

      let content: string | null = await this.callOpenAIViaEdgeFunction([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: texto },
      ], taskOpts.model ?? 'gpt-4o-mini', taskOpts.maxTokens);

      if (!content) return null;
      
      // Extrair JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const result: DeadlineExtraction = JSON.parse(content);
      
      if (!result.days) return null;

      // Calcular data usando dias úteis
      if (result.days) {
        result.dueDate = this.venceEm(new Date(), result.days);
      }

      return result;
    } catch (error) {
      console.error('Erro ao extrair prazo:', error);
      return null;
    }
  }

  /**
   * Gera resumo rápido de um texto
   */
  async generateSummary(texto: string, maxWords: number = 50): Promise<string> {
    if (!this.isEnabled()) return texto.substring(0, 200) + '...';
    try {
      await this.ensureSettingsLoaded();
      const taskOpts = this.getTaskOpts('summarize_text');
      const defaultSystemPrompt = `Você é um assistente que resume textos jurídicos de forma clara e objetiva em no máximo ${maxWords} palavras.`;
      const systemPrompt = this.getPrompt('summarize_text', defaultSystemPrompt);
      const userPrompt = `Resuma este texto:\n\n${texto}`;
      const result = await this.generateText(systemPrompt, userPrompt, taskOpts.maxTokens, 'summarize_text');
      return result || texto.substring(0, 200) + '...';
    } catch (error) {
      console.error('Erro ao gerar resumo:', error);
      return texto.substring(0, 200) + '...';
    }
  }

  /**
   * Analisa urgência de uma comunicação
   */
  async analyzeUrgency(
    texto: string,
    tipoDocumento?: string,
    tipoComunicacao?: string
  ): Promise<'baixa' | 'media' | 'alta' | 'critica'> {
    if (!this.isEnabled()) {
      const textoLower = texto.toLowerCase();
      if (textoLower.includes('liminar') || textoLower.includes('tutela de urgência')) return 'critica';
      if (textoLower.includes('sentença') || textoLower.includes('prazo de 5 dias')) return 'alta';
      if (textoLower.includes('prazo')) return 'media';
      return 'baixa';
    }
    try {
      await this.ensureSettingsLoaded();
      const taskOpts = this.getTaskOpts('classify_urgency');
      const defaultSystemPrompt = `Você é um especialista em classificar urgência de comunicações judiciais.
Classifique como: "critica", "alta", "media" ou "baixa".
Responda APENAS com uma palavra.`;
      const systemPrompt = this.getPrompt('classify_urgency', defaultSystemPrompt);
      const userPrompt = `Tipo: ${tipoDocumento || 'N/A'} | Comunicação: ${tipoComunicacao || 'N/A'}\nTexto: ${texto}`;
      const urgency = await this.generateText(systemPrompt, userPrompt, taskOpts.maxTokens, 'classify_urgency');
      const normalized = (urgency || '').toLowerCase().trim() as any;
      return ['critica', 'alta', 'media', 'baixa'].includes(normalized) ? normalized : 'media';
    } catch (error) {
      console.error('Erro ao analisar urgência:', error);
      return 'media';
    }
  }

  /**
   * Gera sugestões de ações baseado na intimação
   */
  async suggestActions(texto: string, prazo?: string): Promise<string[]> {
    if (!this.isEnabled()) return ['Analisar intimação', 'Verificar prazos', 'Tomar providências'];
    try {
      await this.ensureSettingsLoaded();
      const taskOpts = this.getTaskOpts('suggest_actions');
      const defaultSystemPrompt = `Você é um assistente jurídico. Sugira 3-5 ações práticas e específicas que o advogado deve tomar.
Responda com um JSON: {"actions": ["ação 1", "ação 2", "ação 3"]}`;
      const systemPrompt = this.getPrompt('suggest_actions', defaultSystemPrompt);
      const userPrompt = `Intimação: ${texto}\nPrazo: ${prazo || 'Não especificado'}`;
      const content = await this.generateText(systemPrompt, userPrompt, taskOpts.maxTokens, 'suggest_actions');
      if (!content) return [];
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const json = jsonMatch ? jsonMatch[0] : content;
      const result = JSON.parse(json);
      return result.actions || [];
    } catch (error) {
      console.error('Erro ao sugerir ações:', error);
      return [];
    }
  }

  /**
   * Gera o corpo (HTML) de um e-mail a partir de uma instrução curta do usuário —
   * usado pelo botão "Escrever com IA" do compose de e-mail. Nunca inclui
   * assinatura (o compose já anexa a do usuário depois) nem markdown; retorna
   * um fragmento HTML pronto para inserir direto no editor.
   */
  async generateEmailDraft(params: {
    instruction: string;
    tone?: 'formal' | 'cordial' | 'direto';
    to?: string;
    subject?: string;
  }): Promise<{ subject: string; html: string }> {
    if (!this.isEnabled()) throw new Error('Serviço de IA não está disponível');

    const instruction = String(params.instruction || '').trim();
    if (!instruction) throw new Error('Descreva o que o e-mail deve dizer');

    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('email_compose');

    const toneLabel = {
      formal: 'formal e distante, próprio para autoridades ou partes contrárias',
      cordial: 'cordial e profissional, próprio para clientes',
      direto: 'direto e objetivo, frases curtas, sem rodeios',
    }[params.tone ?? 'cordial'];

    const defaultSystemPrompt = `Você é o assistente de redação de um escritório de advocacia brasileiro. Escreva o CORPO de um e-mail em HTML, pronto para ser inserido direto num editor visual.

NUNCA escreva assinatura, nome do remetente, cargo, telefone ou dados de contato no final — isso já é adicionado automaticamente depois do seu texto.

Conteúdo:
- Tom: ${toneLabel}. Direto ao ponto — nada de "frufru", enrolação ou linguagem de carta cartorial.
- Saudação padrão: "Prezados," (é assim que este escritório sempre começa). Só use "Prezado(a) [Nome]," se um nome específico de destinatário for informado, e "Olá," apenas se a instrução pedir um tom bem informal.
- Vá direto ao assunto já no primeiro parágrafo. Não use frases de abertura vazias como "Vimos por meio deste e-mail...", "Vimos por meio do presente...", "Esperamos que esta mensagem o encontre bem.".
- Desenvolva exatamente o que foi pedido, de forma clara, objetiva e no menor número de frases possível. Não invente fatos, valores, prazos, número de processo ou documentos que não foram informados na instrução.
- Encerramento: NUNCA use fórmulas prontas e infladas como "Informamos que estamos à disposição para prestar eventuais esclarecimentos adicionais que se façam necessários", "Colocamo-nos à inteira disposição para quaisquer esclarecimentos que se façam necessários" ou variações. Se fizer sentido oferecer contato, use no máximo uma frase curta (ex.: "Qualquer dúvida, estamos à disposição."). Termine com "Atenciosamente," — sem nome depois.
- Corte qualquer frase que não agregue informação nova. Prefira um e-mail curto e direto a um e-mail "completo" com enchimento.
- Português do Brasil, gramática impecável, sem erros de digitação.

Formatação HTML (capriche — isso é o que diferencia um e-mail profissional de um rascunho):
- Retorne um FRAGMENTO HTML válido — sem <html>, <head>, <body> ou DOCTYPE.
- Um parágrafo por ideia, sempre dentro de <p style="margin:0 0 14px 0">...</p> (nunca use <br><br> para separar parágrafos, e nunca deixe o parágrafo sem esse style — é o que garante o espaçamento entre parágrafos no e-mail final).
- Listas (<ul style="margin:0 0 14px 0"> / <ol style="margin:0 0 14px 0">) seguem a mesma regra de espaçamento.
- O último elemento do corpo (geralmente o parágrafo de encerramento) não precisa de margem inferior.
- Use <strong> para destacar datas, prazos, valores em dinheiro e nomes de documentos importantes — com moderação, só o que realmente importa.
- Se houver 3 ou mais itens (documentos, passos, pendências), use <ul><li> em vez de listar no meio do parágrafo.
- Não use markdown (nada de **, #, -, \`\`\`), não use cores nem fontes. O ÚNICO estilo inline permitido é a margem de espaçamento acima — nenhum outro.

Responda APENAS com um JSON válido, sem texto antes ou depois:
{"subject": "assunto sugerido, curto e específico (string vazia se não fizer sentido sugerir um)", "html": "o fragmento HTML do corpo do e-mail"}`;

    const systemPrompt = this.getPrompt('email_compose', defaultSystemPrompt);

    const userPrompt = [
      params.to ? `Destinatário: ${params.to}` : '',
      params.subject ? `Assunto atual do e-mail: ${params.subject}` : 'Assunto atual do e-mail: (vazio — sugira um se fizer sentido)',
      `O que o e-mail deve dizer:\n${instruction}`,
    ].filter(Boolean).join('\n\n');

    const content = await this.generateText(systemPrompt, userPrompt, Math.max(taskOpts.maxTokens, 900), 'email_compose');
    if (!content) throw new Error('IA não retornou o e-mail');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const raw = jsonMatch ? jsonMatch[0] : content;
    let parsed: { subject?: string; html?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A IA respondeu sem o wrapper JSON: trata a resposta inteira como o HTML do corpo.
      parsed = { html: content };
    }

    const html = String(parsed.html || '').trim();
    if (!html) throw new Error('IA não retornou o corpo do e-mail');

    return { subject: String(parsed.subject || '').trim(), html };
  }

  /**
   * Formata texto usando IA - funciona para qualquer tipo de texto
   * Detecta automaticamente o tipo de texto e aplica formatação apropriada
   */
  async formatQualification(rawText: string): Promise<string> {
    if (!this.isEnabled()) throw new Error('Serviço de IA não está disponível');
    await this.ensureSettingsLoaded();
    const taskOpts = this.getTaskOpts('format_qualification');

    const defaultSystemPrompt = `Você é um assistente jurídico especializado em formatação e correção de documentos. Analise o texto fornecido e aplique as melhorias necessárias:

TIPOS DE TEXTO E FORMATAÇÃO:

1. QUALIFICAÇÃO DE PARTE:
   - Formato: NOME COMPLETO EM MAIÚSCULAS, nacionalidade, estado civil, profissão, inscrito(a) no CPF sob o nº XXX.XXX.XXX-XX, residente e domiciliado(a) na [logradouro] [nome], nº [número], Bairro [bairro], [cidade] – [UF], CEP [cep]
   - Exemplo: ADAILTON GOMES LUCINDO, brasileiro, solteiro, atendente de balcão, inscrito no CPF sob o nº 123.456.789-00, residente e domiciliado na Rua das Flores, nº 123, Bairro Centro, São Paulo – SP, CEP 01234-567

2. ENDEREÇO SIMPLES:
   - Formato: [logradouro] [nome], nº [número], Bairro [bairro], [cidade] – [UF], CEP [cep]
   - Exemplo: Rua das Flores, nº 123, Bairro Centro, São Paulo – SP, CEP 01234-567

3. TEXTO JURÍDICO GERAL:
   - Mantenha a estrutura mas melhore gramática e pontuação
   - Use linguagem formal e técnica jurídica
   - Organize parágrafos se necessário

4. LISTAS OU ENUMERAÇÕES:
   - Use numeração adequada (1., 2., 3. ou a), b), c))
   - Mantenha coerência na formatação

CORREÇÕES OBRIGATÓRIAS (PARA QUALQUER TEXTO):
- Correção ortográfica completa
- Remoção de espaços extras no início, fim e entre palavras
- Correção de pontuação (vírgulas, pontos, acentos)
- Padronização de maiúsculas/minúsculas
- Remoção de linhas em branco desnecessárias
- Consistência em abreviações (Ex: nº, art., §)

FORMATAÇÃO:
- Use espaços simples após pontuação (vírgula, ponto, dois pontos)
- Mantenha um espaço entre números e unidades (ex: 5 cm, 10 dias)
- Use travessão (–) para separar cidade-UF
- Formate CPF como XXX.XXX.XXX-XX e CEP como XXXXX-XXX
- Use negrito apenas para nomes em qualificações (o editor cuidará disso)

REGRAS GERAIS:
- Preserve informações importantes (nomes, números, datas)
- Use português brasileiro padrão
- Mantenha coesão e coerência
- Seja conciso mas completo

Retorne APENAS o texto corrigido e formatado, sem explicações.`;

    const systemPrompt = this.getPrompt('format_qualification', defaultSystemPrompt);
    const userPrompt = `Texto para formatar:\n${rawText}`;

    try {
      const content = await this.generateText(systemPrompt, userPrompt, taskOpts.maxTokens, 'format_qualification');
      if (!content) throw new Error('IA não retornou resposta');
      return content.trim();
    } catch (error) {
      console.error('Erro ao formatar qualificação:', error);
      throw new Error('Falha ao formatar qualificação com IA');
    }
  }
  // ── Fase K: IA de apoio contextual ─────────────────────────────────────────

  /**
   * Sugere uma resposta para o agente com base no histórico recente e contexto do cliente.
   * @param recentMessages últimas mensagens formatadas como "Cliente: ...\nAgente: ..."
   * @param clientContext resumo do cliente (nome, processos, pendências)
   */
  async suggestReply(recentMessages: string, clientContext: string): Promise<string> {
    if (!this.isEnabled()) return '';
    try {
      await this.ensureSettingsLoaded();
      const systemPrompt = `Você é um assistente de atendimento jurídico. Sugira UMA resposta breve, profissional e objetiva para o próximo turno da conversa.
Contexto do cliente:
${clientContext}

Regras:
- Escreva apenas o texto da resposta, sem prefixo, sem aspas
- Máximo 3 frases
- Tom formal e cordial (escritório de advocacia)
- Se não houver informação suficiente, peça a informação necessária`;
      const userPrompt = `Conversa recente:\n${recentMessages}\n\nSugira a próxima resposta do atendente:`;
      const result = await this.generateText(systemPrompt, userPrompt, 200, 'suggest_reply');
      return result?.trim() || '';
    } catch (err) {
      console.error('suggestReply error', err);
      return '';
    }
  }

  /**
   * Classifica automaticamente o assunto da conversa a partir das mensagens.
   * Retorna string curta (até ~60 chars) para preencher contact_reason.
   */
  async classifySubject(recentMessages: string): Promise<string> {
    if (!this.isEnabled()) return '';
    try {
      await this.ensureSettingsLoaded();
      const systemPrompt = `Você é um assistente jurídico. Com base nas mensagens abaixo, classifique o assunto do atendimento em uma frase curta (máximo 8 palavras). Exemplos: "Consulta trabalhista - rescisão de contrato", "Previdenciário - aposentadoria por invalidez", "Família - guarda de menores". Responda APENAS com o assunto, sem explicações.`;
      const result = await this.generateText(systemPrompt, recentMessages, 60, 'classify_subject');
      return result?.trim().slice(0, 80) || '';
    } catch (err) {
      console.error('classifySubject error', err);
      return '';
    }
  }

  /**
   * Extrai dados estruturados da conversa (nome, CPF, assunto, urgência, etc.).
   * Retorna um objeto com as chaves encontradas.
   */
  async extractContactData(recentMessages: string): Promise<Record<string, string>> {
    if (!this.isEnabled()) return {};
    try {
      await this.ensureSettingsLoaded();
      const systemPrompt = `Você é um assistente jurídico. Extraia dados estruturados da conversa abaixo no formato JSON.
Retorne APENAS JSON válido com as chaves disponíveis (omita chaves não encontradas):
{
  "nome": "nome completo do cliente",
  "cpf": "CPF se mencionado",
  "telefone": "telefone alternativo se mencionado",
  "email": "email se mencionado",
  "assunto": "assunto principal do contato",
  "urgente": "Sim ou Não",
  "observacoes": "qualquer informação relevante adicional"
}`;
      const result = await this.generateText(systemPrompt, recentMessages, 300, 'extract_data');
      if (!result) return {};
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return {};
      return JSON.parse(jsonMatch[0]) as Record<string, string>;
    } catch (err) {
      console.error('extractContactData error', err);
      return {};
    }
  }
}

export const aiService = new AIService();
