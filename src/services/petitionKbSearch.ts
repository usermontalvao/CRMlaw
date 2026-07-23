// Busca local (client-side) na base de blocos-modelo do Editor de Petições.
//
// Objetivo: recuperar SÓ os trechos relevantes para enviar à IA, em vez de
// mandar a base inteira no prompt — economiza tokens e melhora o foco.
// A IA também pode pedir uma nova busca com termos melhores (campo "search"
// do protocolo do assistente); essa busca roda aqui, no navegador, de graça.

export interface KbEntry {
  id: string;
  title: string;
  category?: string;
  tags?: string[];
  /** Texto puro do bloco (SFDT já convertido). */
  content: string;
  /** SFDT original do bloco — usado para inserção com formatação integral. */
  sfdt?: string;
}

export interface KbSnippet {
  id: string;
  title: string;
  category?: string;
  /** Trecho do conteúdo em volta do melhor match (limitado para poupar tokens). */
  snippet: string;
  /** true quando "snippet" contém o texto INTEGRAL do modelo. */
  isFull: boolean;
  score: number;
}

export interface KbSearchOptions {
  /** Quantos dos melhores resultados vão com texto INTEGRAL (para uso literal do modelo). */
  fullTopN?: number;
  /** Limite de caracteres do texto integral. */
  fullMaxChars?: number;
}

const SNIPPET_MAX_CHARS = 750;
const SNIPPET_WINDOW = 360;

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'para', 'por', 'com', 'sem', 'que', 'se', 'ao', 'aos', 'ate',
  'ser', 'sua', 'seu', 'suas', 'seus', 'como', 'mais', 'ou', 'tambem', 'ja', 'foi', 'sao',
  'tem', 'ha', 'pelo', 'pela', 'pelos', 'pelas', 'este', 'esta', 'isso', 'esse', 'essa',
  'entre', 'sobre', 'quando', 'muito', 'nao', 'sim', 'vai', 'vou', 'pode', 'quero', 'sobre',
  // verbos/termos de comando que aparecem nas instruções do usuário mas não ajudam na busca
  'adicione', 'adicionar', 'escreva', 'escrever', 'faca', 'fazer', 'crie', 'criar', 'insira',
  'inserir', 'coloque', 'colocar', 'gere', 'gerar', 'monte', 'montar', 'preciso', 'gostaria',
  'texto', 'topico', 'paragrafo', 'documento', 'peticao', 'trecho', 'modelo', 'bloco', 'final',
]);

/**
 * Sinônimos/termos correlatos do domínio jurídico (normalizados, sem acento).
 * Expandem a busca com peso reduzido — "horas extras" também encontra blocos
 * indexados por "jornada" ou "sobrejornada".
 */
const SYNONYMS: Record<string, string[]> = {
  horas: ['jornada', 'sobrejornada', 'extraordinaria', 'extraordinarias', 'extras'],
  extras: ['jornada', 'sobrejornada', 'extraordinaria', 'extraordinarias', 'horas'],
  jornada: ['horas', 'extras', 'sobrejornada', 'intervalo', 'escala'],
  intervalo: ['intrajornada', 'interjornada', 'descanso', 'jornada'],
  rescisao: ['rescisorias', 'verbas', 'aviso', 'previo', 'demissao', 'dispensa'],
  demissao: ['rescisao', 'dispensa', 'justa', 'causa', 'despedida'],
  dispensa: ['rescisao', 'demissao', 'despedida'],
  verbas: ['rescisorias', 'rescisao', 'salariais'],
  dano: ['danos', 'moral', 'morais', 'material', 'materiais', 'indenizacao'],
  danos: ['dano', 'moral', 'morais', 'indenizacao', 'reparacao'],
  moral: ['dano', 'danos', 'indenizacao', 'abalo', 'extrapatrimonial'],
  indenizacao: ['dano', 'danos', 'reparacao', 'ressarcimento'],
  aposentadoria: ['previdenciario', 'inss', 'beneficio', 'contribuicao', 'rmi'],
  auxilio: ['beneficio', 'inss', 'doenca', 'acidente', 'incapacidade'],
  acidente: ['auxilio', 'acidentario', 'incapacidade', 'sequela'],
  bpc: ['loas', 'assistencial', 'beneficio', 'deficiencia', 'idoso'],
  loas: ['bpc', 'assistencial', 'beneficio'],
  salario: ['remuneracao', 'pagamento', 'piso', 'contracheque'],
  ferias: ['terco', 'abono', 'descanso'],
  fgts: ['deposito', 'depositos', 'multa'],
  adicional: ['insalubridade', 'periculosidade', 'noturno'],
  insalubridade: ['adicional', 'epi', 'laudo', 'agente'],
  periculosidade: ['adicional', 'risco', 'inflamavel'],
  noturno: ['adicional', 'jornada'],
  justica: ['gratuita', 'gratuidade', 'hipossuficiencia', 'assistencia'],
  gratuita: ['justica', 'gratuidade', 'hipossuficiencia'],
  gratuidade: ['justica', 'gratuita', 'hipossuficiencia'],
  tutela: ['urgencia', 'liminar', 'antecipada', 'evidencia'],
  liminar: ['tutela', 'urgencia', 'antecipada'],
  urgencia: ['tutela', 'liminar', 'perigo'],
  honorarios: ['sucumbencia', 'advocaticios'],
  vinculo: ['emprego', 'empregaticio', 'reconhecimento', 'ctps', 'carteira', 'anotacao'],
  emprego: ['vinculo', 'empregaticio', 'contrato', 'trabalho'],
  banco: ['conta', 'bloqueio', 'encerramento', 'bancario', 'bancaria'],
  conta: ['banco', 'bloqueio', 'encerramento', 'bancaria'],
  bloqueio: ['conta', 'banco', 'desbloqueio', 'valores'],
  consumidor: ['cdc', 'consumerista', 'fornecedor'],
  contestacao: ['defesa', 'impugnacao', 'preliminar'],
  impugnacao: ['contestacao', 'replica', 'defesa'],
  pedidos: ['requerimentos', 'requer', 'procedencia', 'condenacao'],
  qualificacao: ['partes', 'reclamante', 'reclamada', 'autor', 'reu'],
  competencia: ['foro', 'juizo', 'jurisdicao'],
  prescricao: ['decadencia', 'prazo', 'quinquenal', 'bienal'],
  pensao: ['alimentos', 'alimenticia', 'alimentar'],
  alimentos: ['pensao', 'alimenticia', 'alimentar'],
  guarda: ['visitas', 'convivencia', 'menor', 'filho'],
  divorcio: ['separacao', 'partilha', 'conjugal'],
  inventario: ['partilha', 'heranca', 'espolio', 'sucessao'],
  usucapiao: ['posse', 'propriedade', 'imovel'],
  despejo: ['locacao', 'aluguel', 'locaticio', 'imovel'],
  execucao: ['cumprimento', 'penhora', 'titulo'],
};

export const normalizeKbText = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string): string[] => {
  const normalized = normalizeKbText(value);
  return normalized
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
};

interface PreparedEntry {
  entry: KbEntry;
  titleN: string;
  tagsN: string;
  contentN: string;
}

/**
 * Buscador léxico com expansão de sinônimos jurídicos. Tudo roda localmente:
 * indexar e buscar não consome nenhum token de IA.
 */
export class PetitionKbSearcher {
  private prepared: PreparedEntry[];

  constructor(entries: KbEntry[]) {
    this.prepared = (entries || [])
      .filter((e) => e && (e.title || e.content))
      .map((entry) => ({
        entry,
        titleN: normalizeKbText(entry.title),
        tagsN: normalizeKbText((entry.tags || []).join(' ')),
        contentN: normalizeKbText(entry.content),
      }));
  }

  get size(): number {
    return this.prepared.length;
  }

  /** Recupera uma entrada pelo id (para inserir o SFDT do modelo, por exemplo). */
  getEntry(id: string): KbEntry | undefined {
    return this.prepared.find((p) => p.entry.id === id)?.entry;
  }

  search(query: string, topK = 4, opts?: KbSearchOptions): KbSnippet[] {
    const tokens = tokenize(query);
    if (tokens.length === 0 || this.prepared.length === 0) return [];

    const queryN = normalizeKbText(query);
    const uniqueTokens = [...new Set(tokens)];
    const synonymTokens = new Set<string>();
    for (const t of uniqueTokens) {
      for (const syn of SYNONYMS[t] || []) {
        if (!uniqueTokens.includes(syn)) synonymTokens.add(syn);
      }
    }

    const countOccurrences = (haystack: string, needle: string): number => {
      if (!needle) return 0;
      let count = 0;
      let idx = haystack.indexOf(needle);
      while (idx !== -1 && count < 5) {
        count += 1;
        idx = haystack.indexOf(needle, idx + needle.length);
      }
      return count;
    };

    const scored = this.prepared.map((p) => {
      let score = 0;
      let bestContentToken = '';

      for (const t of uniqueTokens) {
        if (p.titleN.includes(t)) score += 8;
        if (p.tagsN.includes(t)) score += 6;
        const tf = Math.min(3, countOccurrences(p.contentN, t));
        if (tf > 0) {
          score += tf * 1.5;
          if (!bestContentToken) bestContentToken = t;
        }
      }

      for (const t of synonymTokens) {
        if (p.titleN.includes(t)) score += 3;
        if (p.tagsN.includes(t)) score += 2;
        if (!bestContentToken && p.contentN.includes(t)) bestContentToken = t;
        score += Math.min(2, countOccurrences(p.contentN, t)) * 0.5;
      }

      // Bônus de frase: a consulta inteira aparece literalmente
      if (queryN.length >= 6) {
        if (p.titleN.includes(queryN)) score += 12;
        else if (p.contentN.includes(queryN)) {
          score += 6;
          bestContentToken = queryN;
        }
      }

      return { p, score, bestContentToken };
    });

    const fullTopN = Math.max(0, opts?.fullTopN ?? 0);
    const fullMaxChars = Math.max(500, opts?.fullMaxChars ?? 5000);

    return scored
      .filter((s) => s.score >= 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ p, score, bestContentToken }, rank) => {
        const text = String(p.entry.content || '').replace(/\s+/g, ' ').trim();
        const useFull = rank < fullTopN && text.length <= fullMaxChars;
        return {
          id: p.entry.id,
          title: p.entry.title,
          category: p.entry.category,
          snippet: useFull
            ? text
            : rank < fullTopN
              ? `${text.slice(0, fullMaxChars).trim()}…`
              : this.extractSnippet(p.entry.content, bestContentToken),
          isFull: useFull,
          score: Math.round(score * 10) / 10,
        };
      });
  }

  /** Recorta uma janela do conteúdo em volta do melhor match. */
  private extractSnippet(content: string, matchToken: string): string {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (text.length <= SNIPPET_MAX_CHARS) return text;

    if (matchToken) {
      const idx = normalizeKbText(text).indexOf(matchToken);
      if (idx > SNIPPET_WINDOW) {
        const start = Math.max(0, idx - SNIPPET_WINDOW);
        const end = Math.min(text.length, idx + SNIPPET_WINDOW);
        return `…${text.slice(start, end).trim()}…`;
      }
    }
    return `${text.slice(0, SNIPPET_MAX_CHARS).trim()}…`;
  }
}
