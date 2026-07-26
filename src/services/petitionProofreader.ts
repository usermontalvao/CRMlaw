// Orquestrador da revisão de texto do Editor de Petições.
//
// Junta as quatro camadas na ordem de confiança e devolve uma lista única de
// apontamentos, já ancorados no documento para o painel aplicar:
//
//   1. Hunspell (local, WASM)  → ortografia palavra a palavra
//   2. LanguageTool            → gramática básica, pontuação, concordância
//   3. Regras jurídicas        → crase/gênero/termos que o LT não pega
//   4. Contexto (modelo)       → o que só se enxerga lendo o parágrafo
//
// As três primeiras são offline e sem custo. A quarta só roda quando o usuário
// liga a revisão aprofundada, e recebe no prompt o que as outras já acharam
// para não gastar saída repetindo o que saiu de graça.
//
// Ancoragem: cada apontamento guarda uma JANELA de texto do parágrafo
// (`searchText`) e o índice da ocorrência dessa janela no documento inteiro
// (`occurrence`). O editor localiza pela busca nativa do Syncfusion e troca só
// aquela ocorrência — a formatação do restante fica intacta.

import {
  checkWithLanguageTool,
  mapLanguageToolCategory,
  proofCategoryLabel,
  type LanguageToolMatch,
  type ProofCategory,
} from './languageTool.service';
import { checkLegalRules, type LegalRuleMatch, type LegalRuleSeverity } from './legalGrammarRules';
import { checkWordLocally } from '../components/local-spell-checker';
import {
  buildContextWindow,
  estimateContextCost,
  registerProofTokens,
  WORD_RESPONSE_MAX_TOKENS,
} from './proofContextBudget';
import { aiService, type AiGrammarIssue } from './ai.service';

export type { ProofCategory };
export { proofCategoryLabel };

export type ProofSource = 'hunspell' | 'languagetool' | 'legal-rule' | 'ai';

export interface ProofIssue {
  id: string;
  source: ProofSource;
  category: ProofCategory;
  ruleId: string;
  severity: LegalRuleSeverity;
  /** O que está errado, em uma frase. */
  message: string;
  /** A regra gramatical por trás da correção (quando a camada informa). */
  explanation?: string;
  paragraphIndex: number;
  /** Posição do erro dentro do parágrafo. */
  offset: number;
  length: number;
  bad: string;
  suggestions: string[];
  /** Janela do parágrafo usada para localizar o erro no documento. */
  searchText: string;
  /** Posição do erro dentro de `searchText`. */
  searchOffset: number;
  /** Qual ocorrência de `searchText` no documento (0 = a primeira). */
  occurrence: number;
  /** Sugestões já refinadas pela IA com o contexto da frase. */
  contextRefined?: boolean;
}

export interface ProofreadParagraph {
  index: number;
  text: string;
}

export interface ProofreadOptions {
  useSpelling?: boolean;
  useLanguageTool?: boolean;
  useLegalRules?: boolean;
  useAi?: boolean;
  signal?: AbortSignal;
  onProgress?: (stage: ProofreadStage, detail?: string) => void;
}

export type ProofreadStage = 'spelling' | 'languagetool' | 'rules' | 'ai' | 'done';

export interface ProofreadResult {
  issues: ProofIssue[];
  /** Camadas que não rodaram (offline, serviço fora, IA desabilitada). */
  skipped: Array<{ layer: ProofSource; reason: string }>;
  paragraphs: ProofreadParagraph[];
}

/* ────────────────────────────────────────────────────────────────
 * Ancoragem
 * ──────────────────────────────────────────────────────────────── */

const CONTEXT_RADIUS = 45;
const WORD_CHAR_RE = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]/;

/** Expande até a fronteira de palavra mais próxima, sem sair do parágrafo. */
const expandToWordBoundary = (text: string, index: number, direction: -1 | 1): number => {
  let position = index;
  while (position > 0 && position < text.length && WORD_CHAR_RE.test(text[direction === -1 ? position - 1 : position])) {
    position += direction;
  }
  return position;
};

/** Recorta a janela de contexto em volta do erro (usada para exibir e ancorar). */
const buildWindow = (paragraph: string, offset: number, length: number) => {
  const rawStart = Math.max(0, offset - CONTEXT_RADIUS);
  const rawEnd = Math.min(paragraph.length, offset + length + CONTEXT_RADIUS);
  const start = expandToWordBoundary(paragraph, rawStart, -1);
  const end = expandToWordBoundary(paragraph, rawEnd, 1);
  return {
    searchText: paragraph.slice(start, end),
    searchOffset: offset - start,
  };
};

/** Conta ocorrências de `needle` em `haystack` antes de `limit`. */
const countBefore = (haystack: string, needle: string, limit: number): number => {
  if (!needle) return 0;
  let count = 0;
  let cursor = haystack.indexOf(needle);
  while (cursor >= 0 && cursor < limit) {
    count += 1;
    cursor = haystack.indexOf(needle, cursor + 1);
  }
  return count;
};

/* ────────────────────────────────────────────────────────────────
 * Sentença em volta do erro (contexto para a IA)
 * ──────────────────────────────────────────────────────────────── */

export const extractSentence = (paragraph: string, offset: number): string => {
  const before = paragraph.slice(0, offset);
  const after = paragraph.slice(offset);
  const startMatch = before.lastIndexOf('. ');
  const start = startMatch >= 0 ? startMatch + 2 : 0;
  const endMatch = after.search(/[.;!?]\s|[.;!?]$/);
  const end = endMatch >= 0 ? offset + endMatch + 1 : paragraph.length;
  return paragraph.slice(start, end).trim();
};

/* ────────────────────────────────────────────────────────────────
 * Camadas
 * ──────────────────────────────────────────────────────────────── */

let issueCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(issueCounter += 1)}`;

const severityFromLanguageTool = (match: LanguageToolMatch): LegalRuleSeverity => {
  const issueType = (match.rule.issueType || '').toLowerCase();
  if (issueType === 'style' || issueType === 'redundancy') return 'suggestion';
  if (issueType === 'misspelling' || issueType === 'grammar' || issueType === 'agreement') return 'error';
  return 'warning';
};

/** Palavras que o revisor não deve tratar como erro de ortografia. */
const SKIP_SPELL_RE = /^(?:[0-9.,:/º°ª%$-]+|[A-ZÀ-Ý]{2,}|[A-Za-zÀ-ÿ]?)$/;

const collectSpelling = async (
  paragraphs: ProofreadParagraph[],
  signal?: AbortSignal,
): Promise<{ issues: Omit<ProofIssue, 'searchText' | 'searchOffset' | 'occurrence'>[]; available: boolean }> => {
  const issues: Omit<ProofIssue, 'searchText' | 'searchOffset' | 'occurrence'>[] = [];
  const verdicts = new Map<string, { correct: boolean; suggestions: string[] }>();
  let available = true;

  for (const paragraph of paragraphs) {
    if (signal?.aborted) break;
    const wordRe = /[0-9A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][0-9A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
    let match: RegExpExecArray | null;

    while ((match = wordRe.exec(paragraph.text)) !== null) {
      const word = match[0];
      if (word.length < 3 || SKIP_SPELL_RE.test(word)) continue;

      let verdict = verdicts.get(word);
      if (!verdict) {
        const checked = await checkWordLocally(word);
        if (!checked.available) {
          available = false;
          return { issues, available };
        }
        verdict = { correct: checked.correct, suggestions: checked.suggestions };
        verdicts.set(word, verdict);
      }
      if (verdict.correct) continue;

      issues.push({
        id: nextId('sp'),
        source: 'hunspell',
        category: 'ortografia',
        ruleId: 'HUNSPELL',
        severity: 'error',
        message: `"${word}" não consta no dicionário pt-BR.`,
        explanation: 'Ortografia verificada pelo dicionário local. Se for termo técnico ou nome próprio, use "Adicionar ao dicionário".',
        paragraphIndex: paragraph.index,
        offset: match.index,
        length: word.length,
        bad: word,
        suggestions: verdict.suggestions.slice(0, 5),
      });
    }
  }

  return { issues, available };
};

/* ────────────────────────────────────────────────────────────────
 * Deduplicação entre camadas
 * ──────────────────────────────────────────────────────────────── */

const SOURCE_PRIORITY: Record<ProofSource, number> = {
  'legal-rule': 4, // regra própria: mensagem e sugestão sob medida
  ai: 3,           // contexto do parágrafo
  languagetool: 2,
  hunspell: 1,
};

const dedupe = (issues: ProofIssue[]): ProofIssue[] => {
  const sorted = [...issues].sort((a, b) => {
    if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex;
    if (a.offset !== b.offset) return a.offset - b.offset;
    if (SOURCE_PRIORITY[b.source] !== SOURCE_PRIORITY[a.source]) {
      return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
    }
    return b.length - a.length;
  });

  const kept: ProofIssue[] = [];
  for (const issue of sorted) {
    const clash = kept.find(
      (k) =>
        k.paragraphIndex === issue.paragraphIndex &&
        issue.offset < k.offset + k.length &&
        k.offset < issue.offset + issue.length,
    );
    if (clash) {
      // Camada de menor prioridade só agrega sugestões inéditas.
      for (const suggestion of issue.suggestions) {
        if (clash.suggestions.length < 5 && !clash.suggestions.includes(suggestion)) {
          clash.suggestions.push(suggestion);
        }
      }
      continue;
    }
    kept.push(issue);
  }

  return kept.sort((a, b) => (a.paragraphIndex - b.paragraphIndex) || (a.offset - b.offset));
};

/* ────────────────────────────────────────────────────────────────
 * API
 * ──────────────────────────────────────────────────────────────── */

/**
 * Revisa o documento inteiro (recebido já quebrado em parágrafos) e devolve os
 * apontamentos ancorados, prontos para o painel aplicar no editor.
 */
export const proofreadDocument = async (
  paragraphs: ProofreadParagraph[],
  options: ProofreadOptions = {},
): Promise<ProofreadResult> => {
  const clean = (paragraphs || [])
    .map((p) => ({ index: p.index, text: String(p.text || '') }))
    .filter((p) => p.text.trim().length > 0);

  const skipped: ProofreadResult['skipped'] = [];
  const raw: Array<Omit<ProofIssue, 'searchText' | 'searchOffset' | 'occurrence'>> = [];
  const signal = options.signal;

  // ── 1. Ortografia (Hunspell local) ────────────────────────────
  if (options.useSpelling !== false) {
    options.onProgress?.('spelling');
    const spelling = await collectSpelling(clean, signal);
    raw.push(...spelling.issues);
    if (!spelling.available) {
      skipped.push({ layer: 'hunspell', reason: 'Dicionário pt-BR não carregou nesta sessão.' });
    }
  }

  // ── 2. Regras jurídicas próprias (offline, instantâneo) ───────
  if (options.useLegalRules !== false) {
    options.onProgress?.('rules');
    for (const paragraph of clean) {
      for (const match of checkLegalRules(paragraph.text)) {
        raw.push(legalRuleToIssue(match, paragraph.index));
      }
    }
  }

  // ── 3. LanguageTool ───────────────────────────────────────────
  if (options.useLanguageTool !== false && !signal?.aborted) {
    options.onProgress?.('languagetool');
    // O documento vai inteiro (o LT precisa da frase completa); o mapa de
    // offsets devolve cada match ao parágrafo de origem.
    const { text: joined, ranges } = joinParagraphs(clean);
    const result = await checkWithLanguageTool(joined, {
      signal,
      onProgress: (done, total) => options.onProgress?.('languagetool', `${done}/${total}`),
    });

    if (result.status === 'unavailable') {
      skipped.push({ layer: 'languagetool', reason: result.error || 'Serviço indisponível.' });
    } else {
      for (const match of result.matches) {
        const located = locate(ranges, match.offset);
        if (!located) continue;
        const paragraph = clean.find((p) => p.index === located.index);
        if (!paragraph) continue;

        const offset = match.offset - located.start;
        const bad = paragraph.text.slice(offset, offset + match.length);
        if (!bad.trim()) continue;

        const category = mapLanguageToolCategory(match);
        // Ortografia é decidida pelo Hunspell + dicionário do usuário: o LT
        // não conhece o vocabulário forense e marcaria "reclamatória".
        if (category === 'ortografia') continue;

        raw.push({
          id: nextId('lt'),
          source: 'languagetool',
          category,
          ruleId: match.rule.id || 'LT',
          severity: severityFromLanguageTool(match),
          message: match.shortMessage || match.message || 'Possível erro gramatical.',
          explanation: match.message && match.message !== match.shortMessage ? match.message : match.rule.description,
          paragraphIndex: paragraph.index,
          offset,
          length: match.length,
          bad,
          suggestions: match.replacements.filter(Boolean).slice(0, 5),
        });
      }
    }
  }

  // ── 4. Revisão contextual (modelo) ────────────────────────────
  if (options.useAi && !signal?.aborted) {
    options.onProgress?.('ai');
    try {
      const known = raw.slice(0, 25).map((i) => i.bad);
      const aiIssues = await aiService.reviewLegalTextGrammar({
        paragraphs: clean,
        knownIssues: known,
        signal,
      });
      for (const issue of aiIssues) {
        const located = locateAiIssue(clean, issue);
        if (!located) continue;
        raw.push({
          id: nextId('ai'),
          source: 'ai',
          category: issue.category as ProofCategory,
          ruleId: 'IA_CONTEXTO',
          severity: issue.category === 'estilo' ? 'suggestion' : 'error',
          message: issue.message,
          explanation: issue.rule || undefined,
          paragraphIndex: located.paragraphIndex,
          offset: located.offset,
          length: issue.bad.length,
          bad: issue.bad,
          suggestions: [issue.good],
        });
      }
    } catch (err) {
      skipped.push({
        layer: 'ai',
        reason: err instanceof Error ? err.message : 'A revisão aprofundada falhou.',
      });
    }
  }

  options.onProgress?.('done');
  return { issues: dedupe(anchorIssues(raw, clean)), skipped, paragraphs: clean };
};

/**
 * Calcula a âncora de cada apontamento: janela de contexto + índice da
 * ocorrência dessa janela no documento. Recalculado a cada correção aplicada,
 * porque uma troca desloca tudo que vem depois.
 */
export const anchorIssues = <T extends Omit<ProofIssue, 'searchText' | 'searchOffset' | 'occurrence'>>(
  issues: T[],
  paragraphs: ProofreadParagraph[],
): ProofIssue[] => {
  const fullText = paragraphs.map((p) => p.text).join('\n');
  const paragraphStart = new Map<number, number>();
  let cursor = 0;
  for (const paragraph of paragraphs) {
    paragraphStart.set(paragraph.index, cursor);
    cursor += paragraph.text.length + 1;
  }

  return issues.map((issue) => {
    const paragraph = paragraphs.find((p) => p.index === issue.paragraphIndex);
    const text = paragraph?.text ?? '';
    const { searchText, searchOffset } = buildWindow(text, issue.offset, issue.length);
    const absolute = (paragraphStart.get(issue.paragraphIndex) ?? 0) + issue.offset - searchOffset;
    return {
      ...issue,
      searchText,
      searchOffset,
      occurrence: countBefore(fullText, searchText, absolute),
    };
  });
};

/** Texto que substitui a janela inteira quando a sugestão é aplicada. */
export const buildReplacementWindow = (issue: ProofIssue, suggestion: string): string =>
  issue.searchText.slice(0, issue.searchOffset) +
  suggestion +
  issue.searchText.slice(issue.searchOffset + issue.length);

/**
 * Atualiza o estado do painel depois de aplicar UMA correção no documento.
 *
 * Reflete a troca no texto guardado, desloca o que vem depois no mesmo
 * parágrafo, descarta apontamentos que o trecho corrigido engoliu e reancora
 * todo mundo — sem isso, a segunda correção do parágrafo cairia no lugar errado.
 */
export const applyIssueToState = (params: {
  issues: ProofIssue[];
  paragraphs: ProofreadParagraph[];
  issue: ProofIssue;
  suggestion: string;
}): { issues: ProofIssue[]; paragraphs: ProofreadParagraph[] } => {
  const { issue, suggestion } = params;
  const delta = suggestion.length - issue.length;
  const errorEnd = issue.offset + issue.length;

  const paragraphs = params.paragraphs.map((paragraph) =>
    paragraph.index === issue.paragraphIndex
      ? {
          ...paragraph,
          text: paragraph.text.slice(0, issue.offset) + suggestion + paragraph.text.slice(errorEnd),
        }
      : paragraph,
  );

  const remaining = params.issues
    .filter((other) => other.id !== issue.id)
    .filter((other) => {
      if (other.paragraphIndex !== issue.paragraphIndex) return true;
      // Sobreposto ao trecho trocado: virou obsoleto.
      return other.offset >= errorEnd || other.offset + other.length <= issue.offset;
    })
    .map((other) =>
      other.paragraphIndex === issue.paragraphIndex && other.offset >= errorEnd
        ? { ...other, offset: other.offset + delta }
        : other,
    );

  return { issues: anchorIssues(remaining, paragraphs), paragraphs };
};

const legalRuleToIssue = (
  match: LegalRuleMatch,
  paragraphIndex: number,
): Omit<ProofIssue, 'searchText' | 'searchOffset' | 'occurrence'> => ({
  id: nextId('lr'),
  source: 'legal-rule',
  category: match.category as ProofCategory,
  ruleId: match.ruleId,
  severity: match.severity,
  message: match.message,
  explanation: match.explanation,
  paragraphIndex,
  offset: match.offset,
  length: match.length,
  bad: match.bad,
  suggestions: match.suggestions,
});

/** Junta os parágrafos preservando o mapa de offsets de cada um. */
const joinParagraphs = (paragraphs: ProofreadParagraph[]) => {
  const ranges: Array<{ index: number; start: number; end: number }> = [];
  let cursor = 0;
  const parts: string[] = [];

  for (const paragraph of paragraphs) {
    ranges.push({ index: paragraph.index, start: cursor, end: cursor + paragraph.text.length });
    parts.push(paragraph.text);
    cursor += paragraph.text.length + 1; // + '\n'
  }

  return { text: parts.join('\n'), ranges };
};

const locate = (
  ranges: Array<{ index: number; start: number; end: number }>,
  offset: number,
): { index: number; start: number } | null => {
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return { index: range.index, start: range.start };
  }
  return null;
};

/** A IA devolve o trecho literal; aqui ele vira posição dentro do parágrafo. */
const locateAiIssue = (
  paragraphs: ProofreadParagraph[],
  issue: AiGrammarIssue,
): { paragraphIndex: number; offset: number } | null => {
  const preferred = paragraphs.find((p) => p.index === issue.paragraph);
  const candidates = preferred ? [preferred, ...paragraphs.filter((p) => p !== preferred)] : paragraphs;

  for (const paragraph of candidates) {
    const offset = paragraph.text.indexOf(issue.bad);
    if (offset >= 0) return { paragraphIndex: paragraph.index, offset };
  }
  return null;
};

/**
 * Melhora as sugestões de UM apontamento lendo a frase em volta.
 *
 * É o passo que resolve a queixa clássica do corretor ortográfico: o Hunspell
 * ordena por semelhança de letras, sem saber se a palavra cabe na frase.
 *
 * Ação pedida pelo usuário, um apontamento por vez — por isso não passa pelo
 * portão da digitação. O contexto ainda vai recortado no teto de tokens.
 */
export const refineSuggestionsWithContext = async (
  issue: ProofIssue,
  paragraphs: ProofreadParagraph[],
  signal?: AbortSignal,
): Promise<string[]> => {
  const paragraph = paragraphs.find((p) => p.index === issue.paragraphIndex);
  if (!paragraph) return issue.suggestions;

  const sentence = extractSentence(paragraph.text, issue.offset) || paragraph.text;
  const context = buildContextWindow(sentence, issue.bad);
  registerProofTokens(estimateContextCost(context, WORD_RESPONSE_MAX_TOKENS));
  const suggestions = await aiService.suggestSpellingInContext({
    word: issue.bad,
    sentence: context,
    candidates: issue.suggestions,
    signal,
  });

  // Resposta válida da IA substitui integralmente a lista lexical. Uma lista
  // vazia significa que a palavra deve ser mantida no contexto.
  return suggestions;
};

/** Contagem por categoria para o cabeçalho do painel. */
export const summarizeIssues = (issues: ProofIssue[]): Array<{ category: ProofCategory; count: number }> => {
  const counts = new Map<ProofCategory, number>();
  for (const issue of issues) {
    counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
};
