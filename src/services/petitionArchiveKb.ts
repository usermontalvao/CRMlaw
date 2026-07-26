// Acervo do Nextcloud como SEGUNDA base de conhecimento do Assistente IA.
//
// A primeira base são os blocos-modelo curados do editor (petitionKbSearch,
// busca local, custo zero). Esta aqui é o acervo real do escritório: as
// petições já protocoladas que estão no Nextcloud. São milhares de arquivos —
// indexar tudo seria caro e envelheceria rápido — então a recuperação é feita
// em dois estágios:
//
//  1. CANDIDATOS (barato): o próprio Nextcloud faz a busca recursiva por NOME
//     (WebDAV SEARCH) para cada termo relevante da consulta. Volta uma lista de
//     caminhos, sem baixar nada.
//  2. TEXTO (sob demanda): só os melhores candidatos são baixados e convertidos
//     em texto (mammoth, no navegador). O resultado fica em cache por caminho +
//     mtime, então a mesma peça nunca é baixada duas vezes na sessão.
//
// O que vai para o prompt é apenas a JANELA relevante de cada peça — nunca o
// arquivo inteiro.

import type { NextcloudEntry } from './nextcloud.service';

// O serviço do Nextcloud carrega a configuração do Supabase no import. Aqui ele
// entra sob demanda: quem não liga o acervo não paga por ele, e os utilitários
// puros deste módulo continuam testáveis fora do navegador.
const getNextcloud = async () => (await import('./nextcloud.service')).nextcloudService;

export interface ArchiveSnippet {
  /** Caminho no Nextcloud — é a "fonte" exibida no chat. */
  path: string;
  /** Nome do arquivo sem extensão. */
  title: string;
  /** Pasta onde o arquivo está (contexto: cliente, ano, área). */
  folder: string;
  /** Trecho relevante extraído do documento. */
  snippet: string;
  /** Data da última modificação, quando o servidor informa. */
  mtime?: string | null;
  /** Pontuação da relevância (nome + conteúdo). */
  score: number;
}

export interface ArchiveSearchOptions {
  /** Pasta raiz da busca ('' = tudo). */
  root?: string;
  /** Quantos documentos baixar/abrir no máximo por consulta. */
  maxDocs?: number;
  /** Tamanho máximo do trecho devolvido por documento. */
  maxSnippetChars?: number;
  signal?: AbortSignal;
}

const STOPWORDS = new Set([
  'para', 'como', 'sobre', 'esse', 'essa', 'este', 'esta', 'isso', 'aquele', 'aquela',
  'pelo', 'pela', 'pelos', 'pelas', 'dos', 'das', 'com', 'sem', 'por', 'que', 'uma', 'uns',
  'umas', 'nos', 'nas', 'meu', 'minha', 'seu', 'sua', 'mais', 'menos', 'muito', 'pouco',
  'quando', 'onde', 'qual', 'quais', 'quero', 'preciso', 'favor', 'documento', 'texto',
  'petição', 'peticao', 'faça', 'faca', 'fazer', 'criar', 'redigir', 'escrever', 'novo',
  'nova', 'trecho', 'parte', 'item', 'itens', 'topico', 'tópico', 'topicos', 'tópicos',
]);

/** Extensões que o navegador consegue converter em texto sem servidor. */
const READABLE_EXT = /\.(docx|txt|md|rtf)$/i;

const normalize = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Palavras-chave úteis da consulta, das mais longas para as mais curtas. */
export const archiveKeywords = (query: string, limit = 4): string[] => {
  const tokens = normalize(query)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  const unique: string[] = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
  }
  return unique.sort((a, b) => b.length - a.length).slice(0, limit);
};

/**
 * Janela de texto em volta das ocorrências dos termos da consulta.
 * Sem termo encontrado, devolve o começo do documento (que numa petição é o
 * endereçamento + qualificação — ainda assim informativo).
 */
export const extractRelevantWindow = (text: string, keywords: string[], maxChars: number): string => {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= maxChars) return clean;

  const haystack = normalize(clean);
  const hits: number[] = [];
  for (const keyword of keywords) {
    let from = 0;
    for (let found = 0; found < 3; found++) {
      const idx = haystack.indexOf(keyword, from);
      if (idx < 0) break;
      hits.push(idx);
      from = idx + keyword.length;
    }
  }

  if (!hits.length) return `${clean.slice(0, maxChars).trim()}…`;

  // Centro de massa das ocorrências: pega a região onde o assunto se concentra.
  hits.sort((a, b) => a - b);
  const center = hits[Math.floor(hits.length / 2)];
  // `normalize` preserva o comprimento (troca 1 char por 1 char), então o
  // índice do texto normalizado vale para o texto original.
  const start = Math.max(0, center - Math.floor(maxChars / 2));
  const end = Math.min(clean.length, start + maxChars);
  const window = clean.slice(start, end).trim();

  return `${start > 0 ? '…' : ''}${window}${end < clean.length ? '…' : ''}`;
};

/** Pontuação do candidato só pelo caminho/nome — decide o que vale baixar. */
export const scoreCandidatePath = (entry: { name: string; path: string }, keywords: string[]): number => {
  const name = normalize(entry.name);
  const folder = normalize(entry.path);
  let score = 0;
  for (const keyword of keywords) {
    if (name.includes(keyword)) score += 12;
    else if (folder.includes(keyword)) score += 5;
  }
  // Modelos e petições iniciais costumam ser a melhor referência.
  if (/\b(modelo|padrao|inicial|peticao)\b/.test(`${name} ${folder}`)) score += 3;
  return score;
};

/**
 * Texto puro de um `word/document.xml` (.docx).
 *
 * Só o que interessa para recuperação: um parágrafo por linha, tabulações e
 * quebras preservadas, marcação descartada. Direto no XML, sem dependência de
 * conversor — o navegador já tem o descompactador (JSZip) e o texto não
 * precisa de estilos.
 */
export const docxXmlToText = (xml: string): string => {
  const decodeEntities = (value: string) => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');

  return String(xml || '')
    // Marcadores estruturais viram quebras ANTES de a marcação sumir.
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    // Instruções de campo e comentários não são texto do documento.
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => decodeEntities(line).replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const textCache = new Map<string, { key: string; text: string }>();
const MAX_CACHED_DOCS = 60;

const cacheKey = (entry: NextcloudEntry) => `${entry.mtime || ''}|${entry.size || 0}`;

/** Converte um arquivo do Nextcloud em texto puro, com cache por mtime/tamanho. */
export const readArchiveText = async (entry: NextcloudEntry): Promise<string> => {
  const cached = textCache.get(entry.path);
  const key = cacheKey(entry);
  if (cached && cached.key === key) return cached.text;

  const nextcloud = await getNextcloud();
  const blob = await nextcloud.readFile(entry.path);
  const buffer = await blob.arrayBuffer();

  let text = '';
  if (/\.docx$/i.test(entry.name)) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    text = xml ? docxXmlToText(xml) : '';
  } else {
    text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }

  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  if (textCache.size >= MAX_CACHED_DOCS) {
    const oldest = textCache.keys().next().value;
    if (oldest) textCache.delete(oldest);
  }
  textCache.set(entry.path, { key, text });
  return text;
};

/** Limpa o cache de textos (usado quando o usuário troca a pasta do acervo). */
export const clearArchiveCache = () => textCache.clear();

/**
 * Busca no acervo do Nextcloud e devolve os trechos relevantes.
 * Nunca lança: acervo indisponível é apenas ausência de resultado — o
 * assistente continua funcionando com a base de blocos.
 */
export const searchPetitionArchive = async (
  query: string,
  options: ArchiveSearchOptions = {},
): Promise<ArchiveSnippet[]> => {
  const keywords = archiveKeywords(query);
  if (!keywords.length) return [];

  const root = String(options.root || '').replace(/^\/+|\/+$/g, '');
  const maxDocs = Math.max(1, options.maxDocs ?? 3);
  const maxSnippetChars = Math.max(400, options.maxSnippetChars ?? 1800);

  // 1. Candidatos por nome — o servidor faz a varredura recursiva.
  const candidates = new Map<string, NextcloudEntry>();
  const nextcloud = await getNextcloud().catch(() => null);
  if (!nextcloud) return [];

  for (const keyword of keywords.slice(0, 3)) {
    if (options.signal?.aborted) return [];
    try {
      const entries = await nextcloud.search(keyword, root);
      for (const entry of entries) {
        if (entry.isDir || !READABLE_EXT.test(entry.name)) continue;
        // Arquivo gigante quase sempre é digitalização/anexo, não peça redigida.
        if (Number(entry.size || 0) > 4_000_000) continue;
        if (!candidates.has(entry.path)) candidates.set(entry.path, entry);
      }
    } catch {
      // Sem acervo (offline, proxy fora, pasta inexistente): segue sem ele.
    }
  }
  if (!candidates.size) return [];

  // 2. Ranking pelo caminho e download apenas dos melhores.
  const ranked = Array.from(candidates.values())
    .map((entry) => ({ entry, score: scoreCandidatePath(entry, keywords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || String(b.entry.mtime || '').localeCompare(String(a.entry.mtime || '')))
    .slice(0, maxDocs);

  const snippets: ArchiveSnippet[] = [];
  for (const { entry, score } of ranked) {
    if (options.signal?.aborted) break;
    try {
      const text = await readArchiveText(entry);
      if (!text || text.length < 200) continue;

      const haystack = normalize(text);
      const contentHits = keywords.reduce((total, keyword) => (haystack.includes(keyword) ? total + 1 : total), 0);
      if (contentHits === 0 && score < 12) continue;

      snippets.push({
        path: entry.path,
        title: entry.name.replace(/\.[a-z0-9]+$/i, ''),
        folder: entry.path.split('/').slice(0, -1).join('/'),
        snippet: extractRelevantWindow(text, keywords, maxSnippetChars),
        mtime: entry.mtime,
        score: score + contentHits * 8,
      });
    } catch {
      // Arquivo corrompido/protegido: ignora e tenta o próximo.
    }
  }

  return snippets.sort((a, b) => b.score - a.score);
};
