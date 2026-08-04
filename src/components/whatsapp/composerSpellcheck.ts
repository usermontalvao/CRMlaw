const WORD_PATTERN = /[\p{L}À-ÖØ-öø-ÿ]+(?:[-'’][\p{L}À-ÖØ-öø-ÿ]+)*/gu;

const COMMON_CHAT_CORRECTIONS: Record<string, string[]> = {
  voce: ['você'],
  vocee: ['você'],
  voces: ['vocês'],
  nao: ['não'],
  mae: ['mãe'],
  oie: ['Oi'],
  oiee: ['Oi'],
  oieee: ['Oi'],
  oiii: ['Oi'],
  pedio: ['pediu'],
  whatsap: ['WhatsApp'],
  watsapp: ['WhatsApp'],
  watsap: ['WhatsApp'],
};

export interface WhatsAppComposerSpellIssue {
  word: string;
  suggestions: string[];
}

export interface WhatsAppSpellcheckSegment {
  text: string;
  misspelled: boolean;
}

export interface WhatsAppSpellcheckHit {
  issue: WhatsAppComposerSpellIssue;
  start: number;
  end: number;
}

function normalizedWord(word: string): string {
  return word.toLocaleLowerCase('pt-BR');
}

function withTypedCase(typed: string, suggestion: string): string {
  if (!suggestion) return suggestion;
  if (typed === typed.toLocaleUpperCase('pt-BR')) return suggestion.toLocaleUpperCase('pt-BR');
  const first = typed[0];
  if (first && first === first.toLocaleUpperCase('pt-BR')) {
    return suggestion[0].toLocaleUpperCase('pt-BR') + suggestion.slice(1);
  }
  return suggestion;
}

function commonCorrections(word: string): string[] {
  return (COMMON_CHAT_CORRECTIONS[normalizedWord(word)] ?? [])
    .map(suggestion => withTypedCase(word, suggestion));
}

function maskNonProse(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi, ' ')
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/\b\d[\d().\-/\s]{2,}\b/g, ' ');
}

/** Palavras únicas e relevantes para revisão rápida enquanto se digita. */
export function collectWhatsAppSpellcheckWords(text: string, limit = 48): string[] {
  const seen = new Set<string>();
  const words: string[] = [];

  for (const match of maskNonProse(text).matchAll(WORD_PATTERN)) {
    const word = match[0];
    const key = normalizedWord(word);
    if (word.length < 3 || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= limit) break;
  }

  return words;
}

/**
 * Formas prováveis antes de consultar novamente o dicionário. Só reduzimos
 * repetições quando a forma digitada já foi considerada incorreta, portanto
 * palavras legítimas com letra dupla (carro, massa) continuam intactas.
 */
export function buildWhatsAppChatWordCandidates(word: string): string[] {
  const variants = new Map<string, string>();
  const add = (candidate: string) => {
    const key = normalizedWord(candidate);
    if (candidate && key !== normalizedWord(word) && !variants.has(key)) variants.set(key, candidate);
  };

  // "Naooo" → "Nao"; "amigooo" → "amigo"; "Oieee" → "Oie".
  add(word.replace(/(.)\1{2,}/giu, '$1'));
  // Alongamento curto no fim: "tudoo" → "tudo"; "vocee" → "voce".
  add(word.replace(/(.)\1+$/iu, '$1'));
  return [...variants.values()];
}

/** Ranking conservador: correção conhecida > forma desalongada válida > Hunspell. */
export function rankWhatsAppSpellSuggestions(
  word: string,
  dictionarySuggestions: string[],
  validChatCandidates: string[] = [],
): string[] {
  const preferred = [word, ...buildWhatsAppChatWordCandidates(word)]
    .flatMap(commonCorrections);

  // Quando conhecemos a intenção (ex.: Naooo → Não), não misturamos o acerto
  // com palpites lexicais como "Naoto" ou "Nanato".
  const highConfidence = preferred.length > 0
    ? preferred
    : validChatCandidates.map(candidate => withTypedCase(word, candidate));

  const source = highConfidence.length > 0 ? highConfidence : dictionarySuggestions;
  const unique = new Map<string, string>();
  for (const suggestion of source) {
    const clean = suggestion.trim();
    if (!clean) continue;
    const key = normalizedWord(clean);
    if (key === normalizedWord(word) || unique.has(key)) continue;
    unique.set(key, clean);
    if (unique.size >= 3) break;
  }
  return [...unique.values()];
}

/** Localiza a palavra suspeita sob o cursor/seleção do textarea. */
export function findWhatsAppSpellIssueAtOffset(
  text: string,
  issues: WhatsAppComposerSpellIssue[],
  offset: number,
): WhatsAppSpellcheckHit | null {
  const byWord = new Map(issues.map(issue => [normalizedWord(issue.word), issue]));
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset < start || offset > end) continue;
    const issue = byWord.get(normalizedWord(match[0]));
    return issue ? { issue, start, end } : null;
  }
  return null;
}

/** Fatias para desenhar somente o sublinhado, mantendo o textarea intacto. */
export function segmentWhatsAppSpellcheckText(
  text: string,
  issues: WhatsAppComposerSpellIssue[],
): WhatsAppSpellcheckSegment[] {
  const misspelled = new Set(issues.map(issue => normalizedWord(issue.word)));
  const segments: WhatsAppSpellcheckSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), misspelled: false });
    segments.push({ text: match[0], misspelled: misspelled.has(normalizedWord(match[0])) });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), misspelled: false });
  return segments;
}
