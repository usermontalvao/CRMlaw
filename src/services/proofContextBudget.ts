// Orçamento de tokens da revisão contextual do editor.
//
// A revisão tem quatro camadas e só a última custa dinheiro. Este módulo é o
// portão econômico dessa última camada e responde a duas perguntas:
//
//   1. QUANTO texto vai no prompt  → `buildContextWindow` recorta uma janela
//      curta em volta da palavra suspeita, em vez de mandar o parágrafo.
//   2. QUANTAS chamadas cabem      → janela deslizante de chamadas/tokens; ao
//      estourar, a camada contextual simplesmente não roda (o editor continua
//      corrigindo pelas camadas locais, sem avisar nada na tela).
//
// Tudo aqui é puro e com relógio injetável para poder ser testado.

/** Teto de contexto por chamada durante a digitação (~90 tokens de entrada). */
export const CONTEXT_WINDOW_MAX_CHARS = 320;

/** Teto de contexto por chamada na revisão do documento inteiro. */
export const DOCUMENT_CONTEXT_MAX_CHARS = 9000;

/** Teto de saída por chamada (JSON curto: 2 a 3 apontamentos). */
export const CONTEXT_RESPONSE_MAX_TOKENS = 220;
export const WORD_RESPONSE_MAX_TOKENS = 90;

/**
 * Custo fixo estimado de uma chamada contextual: instruções do sistema +
 * moldura do JSON. Medido sobre os prompts curtos usados em `ai.service`.
 */
const PROMPT_OVERHEAD_TOKENS = 150;

/** Português brasileiro fica em torno de 3,5 caracteres por token. */
const CHARS_PER_TOKEN = 3.5;

export interface ProofBudgetLimits {
  /** Rajada: protege contra "segurar uma tecla" e digitação muito rápida. */
  maxCallsPerMinute: number;
  maxCallsPerHour: number;
  maxTokensPerHour: number;
}

const DEFAULT_LIMITS: ProofBudgetLimits = {
  maxCallsPerMinute: 6,
  maxCallsPerHour: 90,
  maxTokensPerHour: 40_000,
};

let limits: ProofBudgetLimits = { ...DEFAULT_LIMITS };

interface Spend {
  at: number;
  tokens: number;
}

const spends: Spend[] = [];

const MINUTE = 60_000;
const HOUR = 3_600_000;

const prune = (now: number) => {
  while (spends.length > 0 && now - spends[0].at > HOUR) spends.shift();
};

/** Ajuste de limites (usado nos testes e por configuração futura). */
export const configureProofBudget = (partial: Partial<ProofBudgetLimits>): void => {
  limits = { ...limits, ...partial };
};

export const resetProofBudget = (): void => {
  spends.length = 0;
  limits = { ...DEFAULT_LIMITS };
};

export const estimateTokens = (text: string): number =>
  Math.ceil(String(text || '').length / CHARS_PER_TOKEN);

/** Custo total estimado (entrada + saída) de uma chamada contextual. */
export const estimateContextCost = (
  context: string,
  responseTokens = CONTEXT_RESPONSE_MAX_TOKENS,
): number => PROMPT_OVERHEAD_TOKENS + estimateTokens(context) + responseTokens;

export interface ProofBudgetSnapshot {
  callsLastMinute: number;
  callsLastHour: number;
  tokensLastHour: number;
}

export const proofBudgetSnapshot = (now = Date.now()): ProofBudgetSnapshot => {
  prune(now);
  let callsLastMinute = 0;
  let tokensLastHour = 0;
  for (const spend of spends) {
    if (now - spend.at <= MINUTE) callsLastMinute += 1;
    tokensLastHour += spend.tokens;
  }
  return { callsLastMinute, callsLastHour: spends.length, tokensLastHour };
};

/** Há espaço no orçamento para gastar `estimated` tokens agora? */
export const canSpendProofTokens = (estimated: number, now = Date.now()): boolean => {
  const snapshot = proofBudgetSnapshot(now);
  if (snapshot.callsLastMinute >= limits.maxCallsPerMinute) return false;
  if (snapshot.callsLastHour >= limits.maxCallsPerHour) return false;
  return snapshot.tokensLastHour + Math.max(0, estimated) <= limits.maxTokensPerHour;
};

/** Registra o gasto imediatamente antes de disparar a chamada. */
export const registerProofTokens = (estimated: number, now = Date.now()): void => {
  prune(now);
  spends.push({ at: now, tokens: Math.max(0, estimated) });
};

const WORD_CHAR_RE = /[\p{L}\p{M}\p{N}]/u;

/** Anda até a fronteira de palavra mais próxima, para não cortar no meio. */
const snapToWordBoundary = (text: string, index: number, direction: -1 | 1): number => {
  let position = Math.min(Math.max(index, 0), text.length);
  while (position > 0 && position < text.length) {
    const char = text[direction === -1 ? position - 1 : position];
    if (!WORD_CHAR_RE.test(char)) break;
    position += direction;
  }
  return position;
};

/**
 * Recorta a janela de contexto em volta da palavra suspeita.
 *
 * É este recorte que mantém o custo previsível: a frase de uma petição pode
 * ter 600 caracteres, mas o modelo só precisa do que está em volta do erro
 * para decidir entre "mei"/"meu" ou "a"/"à".
 */
export const buildContextWindow = (
  rawSentence: string,
  focus: string,
  maxChars = CONTEXT_WINDOW_MAX_CHARS,
): string => {
  const sentence = String(rawSentence || '').replace(/\s+/g, ' ').trim();
  if (sentence.length <= maxChars) return sentence;

  const needle = String(focus || '').trim();
  const at = needle
    ? sentence.toLocaleLowerCase('pt-BR').indexOf(needle.toLocaleLowerCase('pt-BR'))
    : -1;

  if (at < 0) return sentence.slice(0, maxChars).trimEnd();

  const half = Math.floor((maxChars - needle.length) / 2);
  const start = snapToWordBoundary(sentence, Math.max(0, at - half), -1);
  const end = snapToWordBoundary(sentence, Math.min(sentence.length, at + needle.length + half), 1);
  return sentence.slice(start, end).trim();
};

/* ────────────────────────────────────────────────────────────────
 * Portão: quando vale gastar uma chamada de modelo
 *
 * Regra do produto: a camada contextual NUNCA roda por conta própria enquanto
 * a pessoa digita. Ela só entra quando as camadas locais (Hunspell + regras
 * jurídicas, ambas offline e instantâneas) já apontaram uma palavra suspeita
 * naquela frase — e apenas quando elas não conseguem resolver sozinhas.
 *
 * Ordem das negativas (da mais frequente para a mais rara), que é também a
 * ordem em que economizam:
 *   1. nenhuma palavra suspeita na frase       → a esmagadora maioria das teclas
 *   2. correção local de alta confiança         → "apartir" → "a partir"
 *   3. contexto insuficiente para desambiguar   → palavra sozinha na linha
 *   4. orçamento da janela deslizante esgotado  → digitação muito longa
 *
 * Vive no mesmo módulo do orçamento de propósito: as duas metades respondem à
 * mesma pergunta (quanto isto custa) e ficam testáveis como uma unidade.
 * ──────────────────────────────────────────────────────────────── */

export type ContextGateDenial =
  | 'sem-palavra-suspeita'
  | 'resolvido-localmente'
  | 'contexto-curto'
  | 'orcamento-esgotado';

export interface ContextGateAllowed {
  allow: true;
  /** Palavra suspeita que motivou a chamada. */
  focus: string;
  /** Janela de texto que será enviada ao modelo (já dentro do teto). */
  context: string;
  estimatedTokens: number;
}

export interface ContextGateDenied {
  allow: false;
  reason: ContextGateDenial;
}

export type ContextGateVerdict = ContextGateAllowed | ContextGateDenied;

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;

export const sentenceWords = (sentence: string): string[] =>
  Array.from(String(sentence || '').matchAll(WORD_RE), (match) => match[0]);

/**
 * Palavras da frase que o dicionário local considera erradas.
 *
 * O editor passa o predicado ligado ao `errorWordCollection` do Syncfusion, que
 * é uma consulta em mapa — nada de percorrer o documento por tecla digitada.
 */
export const collectSuspectWords = (
  sentence: string,
  isMisspelled: (word: string) => boolean,
): string[] => {
  const seen = new Set<string>();
  const suspects: string[] = [];
  for (const word of sentenceWords(sentence)) {
    const key = word.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (isMisspelled(word)) suspects.push(word);
    } catch {
      // Predicado do editor falhou: tratar como "sem suspeita" é o lado seguro.
    }
  }
  return suspects;
};

export interface ContextGateInput {
  /** Frase em volta do cursor. */
  sentence: string;
  /** Palavras já apontadas pelas camadas locais. */
  suspects: string[];
  /**
   * A curadoria local já sabe a resposta para esta palavra? Injetado pelo
   * chamador (`hasHighConfidenceCorrection`) para manter services/ sem
   * dependência de components/.
   */
  isResolvedLocally?: (word: string) => boolean;
  maxChars?: number;
  now?: number;
}

/**
 * Veredicto do portão. Devolve também a janela de contexto pronta, para o
 * chamador não ter que repetir o recorte (e não ter como esquecer o teto).
 */
export const evaluateContextGate = (input: ContextGateInput): ContextGateVerdict => {
  const sentence = String(input.sentence || '').replace(/\s+/g, ' ').trim();
  const words = sentenceWords(sentence);

  const suspects = (input.suspects || [])
    .map((word) => String(word || '').trim())
    .filter((word) => word.length >= 2)
    .filter((word) => sentence.toLocaleLowerCase('pt-BR').includes(word.toLocaleLowerCase('pt-BR')));

  if (suspects.length === 0) return { allow: false, reason: 'sem-palavra-suspeita' };

  // Uma palavra sozinha não tem contexto: a camada contextual não teria com o
  // que decidir e o dicionário já respondeu o que sabia.
  const hasOtherWord = words.some((word) => (
    !suspects.some((suspect) => suspect.toLocaleLowerCase('pt-BR') === word.toLocaleLowerCase('pt-BR'))
  ));
  if (!hasOtherWord) return { allow: false, reason: 'contexto-curto' };

  const isResolvedLocally = input.isResolvedLocally ?? (() => false);
  const focus = suspects.find((word) => !isResolvedLocally(word));
  if (!focus) return { allow: false, reason: 'resolvido-localmente' };

  const context = buildContextWindow(sentence, focus, input.maxChars ?? CONTEXT_WINDOW_MAX_CHARS);
  const estimatedTokens = estimateContextCost(context);
  if (!canSpendProofTokens(estimatedTokens, input.now)) {
    return { allow: false, reason: 'orcamento-esgotado' };
  }

  return { allow: true, focus, context, estimatedTokens };
};
