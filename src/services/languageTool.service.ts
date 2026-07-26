// Cliente do LanguageTool (camada 2 da revisão do editor de petições).
//
// Papel na arquitetura: o Hunspell cuida da ortografia enquanto se digita; o
// LanguageTool entra na revisão do documento com gramática básica, pontuação e
// parte da concordância; as regras próprias (legalGrammarRules) cobrem o que o
// LT comunitário não vê; e a IA faz a revisão contextual.
//
// Transporte: Edge Function `languagetool-proxy` (permite trocar por servidor
// autohospedado sem mexer no front). Se o proxy não estiver publicado, cai na
// API pública — que é onde a maioria das instalações começa.

import { supabase } from '../config/supabase';

export interface LanguageToolMatch {
  offset: number;
  length: number;
  message: string;
  shortMessage: string;
  replacements: string[];
  rule: {
    id: string;
    description: string;
    issueType: string;
    categoryId: string;
    categoryName: string;
  };
}

export type LanguageToolStatus = 'ok' | 'unavailable';

export interface LanguageToolResult {
  matches: LanguageToolMatch[];
  status: LanguageToolStatus;
  /** Motivo da indisponibilidade (exibido discretamente no painel). */
  error?: string;
}

/** Teto por requisição — o proxy recusa acima disso. */
const MAX_CHUNK_CHARS = 6000;
/** Teto por revisão: evita disparar 40 requisições num documento gigante. */
const MAX_TOTAL_CHARS = 60000;
/** A API pública limita por IP; duas requisições simultâneas é seguro. */
const MAX_PARALLEL = 2;

const PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';

/**
 * Regras que o LT dispara em petição sem necessidade: maiúsculas de cabeçalho,
 * espaçamento (já coberto pelas nossas regras) e ortografia (o Hunspell com o
 * dicionário jurídico do usuário decide melhor).
 */
const DISABLED_RULES = [
  'UPPERCASE_SENTENCE_START',
  'WHITESPACE_RULE',
  'WORD_REPEAT_RULE',
  'PT_BARBARISMS_REPLACE',
];

const envUrl = (): string => {
  try {
    return String((import.meta as any)?.env?.VITE_LANGUAGETOOL_URL || '').trim();
  } catch {
    return '';
  }
};

interface CheckPayload {
  text: string;
  language: string;
  level: 'default' | 'picky';
  disabledRules: string[];
}

/** Chamada direta ao servidor LT (público ou autohospedado via env). */
const checkDirect = async (payload: CheckPayload, signal?: AbortSignal): Promise<LanguageToolMatch[]> => {
  const base = envUrl().replace(/\/+$/, '');
  const endpoint = base ? (base.endsWith('/v2/check') ? base : `${base}/v2/check`) : PUBLIC_ENDPOINT;

  const form = new URLSearchParams();
  form.set('text', payload.text);
  form.set('language', payload.language);
  form.set('level', payload.level);
  if (payload.disabledRules.length) form.set('disabledRules', payload.disabledRules.join(','));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal,
  });
  if (!response.ok) throw new Error(`LanguageTool respondeu ${response.status}`);

  const data = await response.json();
  return (Array.isArray(data?.matches) ? data.matches : []).map((m: any) => ({
    offset: m?.offset ?? 0,
    length: m?.length ?? 0,
    message: m?.message ?? '',
    shortMessage: m?.shortMessage ?? '',
    replacements: Array.isArray(m?.replacements)
      ? m.replacements.slice(0, 6).map((r: any) => String(r?.value ?? ''))
      : [],
    rule: {
      id: m?.rule?.id ?? '',
      description: m?.rule?.description ?? '',
      issueType: m?.rule?.issueType ?? '',
      categoryId: m?.rule?.category?.id ?? '',
      categoryName: m?.rule?.category?.name ?? '',
    },
  }));
};

/** Uma vez que o proxy falhe por não estar publicado, não insistimos na sessão. */
let proxyDisabled = false;

const checkChunk = async (payload: CheckPayload, signal?: AbortSignal): Promise<LanguageToolMatch[]> => {
  if (!proxyDisabled) {
    try {
      const { data, error } = await supabase.functions.invoke('languagetool-proxy', { body: payload });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error(String((data as any).error));
      return Array.isArray((data as any)?.matches) ? ((data as any).matches as LanguageToolMatch[]) : [];
    } catch (err) {
      if (signal?.aborted) throw err;
      proxyDisabled = true;
      console.warn('[languageTool] proxy indisponível, usando servidor direto:', err);
    }
  }
  return checkDirect(payload, signal);
};

/** Fatia o texto em blocos que respeitem o teto, cortando em quebra de linha. */
export const splitIntoChunks = (text: string, maxChars = MAX_CHUNK_CHARS): Array<{ text: string; offset: number }> => {
  const chunks: Array<{ text: string; offset: number }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(cursor + maxChars, text.length);
    if (end < text.length) {
      // Preferir cortar em parágrafo; depois em frase; por último em espaço.
      const window = text.slice(cursor, end);
      const breakAt = Math.max(
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      );
      if (breakAt > maxChars * 0.5) end = cursor + breakAt + 1;
    }
    const slice = text.slice(cursor, end);
    if (slice.trim()) chunks.push({ text: slice, offset: cursor });
    cursor = end;
  }

  return chunks;
};

/**
 * Revisa um texto completo. Os offsets dos matches são devolvidos relativos ao
 * texto ORIGINAL (o deslocamento do bloco já vem somado).
 */
export const checkWithLanguageTool = async (
  text: string,
  options?: { level?: 'default' | 'picky'; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<LanguageToolResult> => {
  const value = String(text || '');
  if (!value.trim()) return { matches: [], status: 'ok' };

  const chunks = splitIntoChunks(value.slice(0, MAX_TOTAL_CHARS));
  const matches: LanguageToolMatch[] = [];
  let failure: string | null = null;
  let done = 0;

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
    if (options?.signal?.aborted) break;
    const batch = chunks.slice(i, i + MAX_PARALLEL);

    const results = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const found = await checkChunk(
            {
              text: chunk.text,
              language: 'pt-BR',
              level: options?.level ?? 'picky',
              disabledRules: DISABLED_RULES,
            },
            options?.signal,
          );
          return found.map((m) => ({ ...m, offset: m.offset + chunk.offset }));
        } catch (err) {
          if (!failure) failure = err instanceof Error ? err.message : String(err);
          return [] as LanguageToolMatch[];
        }
      }),
    );

    for (const found of results) matches.push(...found);
    done += batch.length;
    options?.onProgress?.(done, chunks.length);
  }

  // Falha em TODOS os blocos = serviço fora. Falha parcial ainda é resultado.
  if (failure && matches.length === 0 && chunks.length > 0) {
    return { matches: [], status: 'unavailable', error: failure };
  }

  matches.sort((a, b) => a.offset - b.offset);
  return { matches, status: 'ok', error: failure ?? undefined };
};

export type ProofCategory =
  | 'ortografia'
  | 'crase'
  | 'concordancia'
  | 'genero'
  | 'gramatica'
  | 'pontuacao'
  | 'estilo'
  | 'juridico'
  | 'outro';

/** Traduz a taxonomia do LanguageTool para as categorias do painel. */
export const mapLanguageToolCategory = (match: LanguageToolMatch): ProofCategory => {
  const ruleId = (match.rule.id || '').toUpperCase();
  const categoryId = (match.rule.categoryId || '').toUpperCase();
  const issueType = (match.rule.issueType || '').toLowerCase();

  if (ruleId.includes('CRASE') || ruleId.includes('ACENTO_GRAVE')) return 'crase';
  // O LT pt-BR nomeia as regras de concordância como *_AGREEMENT_* e as
  // classifica em "GRAMMAR"; sem este desvio, gênero e número cairiam todos
  // no balaio de "Gramática" e o filtro do painel perderia utilidade.
  if (ruleId.includes('GENERO') || ruleId.includes('GENDER')) return 'genero';
  if (ruleId.includes('CONCORD') || ruleId.includes('AGREEMENT') || issueType === 'agreement') return 'concordancia';

  if (issueType === 'misspelling' || categoryId === 'TYPOS') return 'ortografia';
  if (categoryId === 'PUNCTUATION' || categoryId === 'TYPOGRAPHY' || issueType === 'typographical') return 'pontuacao';
  if (categoryId === 'GRAMMAR' || issueType === 'grammar') return 'gramatica';
  if (categoryId === 'STYLE' || categoryId === 'REDUNDANCY' || issueType === 'style') return 'estilo';
  if (categoryId === 'CASING') return 'pontuacao';

  return 'outro';
};

/** Rótulo curto em português para a categoria. */
export const proofCategoryLabel = (category: ProofCategory): string => {
  switch (category) {
    case 'ortografia': return 'Ortografia';
    case 'crase': return 'Crase';
    case 'concordancia': return 'Concordância';
    case 'genero': return 'Gênero';
    case 'gramatica': return 'Gramática';
    case 'pontuacao': return 'Pontuação';
    case 'estilo': return 'Estilo';
    case 'juridico': return 'Termo jurídico';
    default: return 'Revisão';
  }
};
