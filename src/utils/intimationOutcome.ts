/**
 * Lê o resultado de uma intimação a partir do resumo escrito pela IA.
 *
 * Regra que motivou este módulo: "tutela de urgência" é o NOME do instituto e
 * aparece igual quando o juiz concede e quando indefere ("indefiro a tutela de
 * urgência vindicada"). Quem decide é o VERBO mais próximo do instituto, nunca
 * a menção ao instituto. Sem verbo reconhecível, não há rótulo — melhor nenhum
 * selo do que um selo trocado.
 *
 * Módulo puro e sem imports de propósito (ver testes com ts-node).
 */

export type IntimationOutcomeKind =
  | 'procedente'
  | 'improcedente'
  | 'parcial'
  | 'tutela_concedida'
  | 'tutela_negada'
  | 'condenacao';

export interface IntimationOutcome {
  kind: IntimationOutcomeKind;
  label: string;
}

const LABELS: Record<IntimationOutcomeKind, string> = {
  procedente: 'PROCEDENTE',
  improcedente: 'IMPROCEDENTE',
  parcial: 'PARCIAL',
  tutela_concedida: 'TUTELA CONCEDIDA',
  tutela_negada: 'TUTELA NEGADA',
  condenacao: 'CONDENAÇÃO',
};

/** Maiúsculas sem acento, para o texto casar com ou sem "ç"/"ã". */
const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// O instituto: tutela (de urgência, antecipada, provisória), liminar, cautelar.
const REMEDY = /\b(TUTELA|TUTELAS|LIMINAR|LIMINARES|CAUTELAR)\b/g;

// Verbos de deferimento. As bordas \b impedem que DEFERIDA case dentro de
// INDEFERIDA e que NEGADA case dentro de DENEGADA.
const GRANTED =
  /\b(CONCEDEU|CONCEDIDA|CONCEDIDO|CONCEDIDAS|CONCEDIDOS|CONCEDE|CONCEDO|DEFERIU|DEFERIDA|DEFERIDO|DEFERIDAS|DEFERIDOS|DEFERE|DEFIRO|ACOLHEU|ACOLHIDA|ACOLHIDO|CONCEDENDO|DEFERINDO|ACOLHENDO)\b/g;

const DENIED =
  /\b(NEGOU|NEGADA|NEGADO|NEGADAS|NEGADOS|NEGA|NEGO|INDEFERIU|INDEFERIDA|INDEFERIDO|INDEFERIDAS|INDEFERIDOS|INDEFERE|INDEFIRO|INDEFERIMENTO|DENEGOU|DENEGADA|DENEGADO|REJEITOU|REJEITADA|REJEITADO|REVOGOU|REVOGADA|REVOGADO|CASSOU|CASSADA|CASSADO|INDEFERINDO|NEGANDO|DENEGANDO|REJEITANDO|REVOGANDO|CASSANDO)\b/g;

/** "não concedeu", "sem deferir": o deferimento negado vale como negativa. */
const NEGATION_BEFORE = /\b(NAO|SEM|JAMAIS|NUNCA)\b[^A-Z0-9]{0,20}$/;

interface VerbHit {
  index: number;
  granted: boolean;
}

const collectHits = (sentence: string): VerbHit[] => {
  const hits: VerbHit[] = [];
  for (const match of sentence.matchAll(DENIED)) {
    hits.push({ index: match.index ?? 0, granted: false });
  }
  for (const match of sentence.matchAll(GRANTED)) {
    const index = match.index ?? 0;
    const negated = NEGATION_BEFORE.test(sentence.slice(Math.max(0, index - 30), index));
    hits.push({ index, granted: !negated });
  }
  return hits;
};

/**
 * Escolhe o verbo que decide o instituto na frase.
 *
 * Prioridade ao verbo ANTES do substantivo ("revogou a liminar", "indefiro a
 * tutela"): o que vem depois costuma ser particípio qualificando decisão
 * anterior ("a liminar CONCEDIDA em primeiro grau"). Só quando não há verbo
 * antes é que o de depois vale ("Liminar deferida", "Tutela indeferida").
 */
const readRemedySentence = (sentence: string): IntimationOutcomeKind | null => {
  const remedies = [...sentence.matchAll(REMEDY)].map((m) => m.index ?? 0);
  if (remedies.length === 0) return null;

  const hits = collectHits(sentence);
  if (hits.length === 0) return null;

  let before: VerbHit | null = null;
  let beforeDistance = Number.POSITIVE_INFINITY;
  let anywhere: VerbHit | null = null;
  let anywhereDistance = Number.POSITIVE_INFINITY;

  for (const hit of hits) {
    for (const remedy of remedies) {
      const distance = Math.abs(hit.index - remedy);
      if (distance < anywhereDistance) {
        anywhereDistance = distance;
        anywhere = hit;
      }
      if (hit.index < remedy && distance < beforeDistance) {
        beforeDistance = distance;
        before = hit;
      }
    }
  }

  const chosen = before ?? anywhere;
  if (!chosen) return null;
  return chosen.granted ? 'tutela_concedida' : 'tutela_negada';
};

export const detectIntimationOutcomeKind = (summary?: string | null): IntimationOutcomeKind | null => {
  if (!summary) return null;
  const text = normalize(summary);

  // Julgamento de mérito primeiro — e o parcial ANTES do procedente, senão
  // "parcialmente procedente" é lido como procedente puro.
  if (/PARCIALMENTE\s+PROCEDENTE|PROCEDENTE\s+EM\s+PARTE|PROCEDENCIA\s+PARCIAL|PARCIALMENTE\s+PROCEDENTES/.test(text)) {
    return 'parcial';
  }
  if (/\bIMPROCEDENTE\b|\bIMPROCEDENTES\b|IMPROCEDENCIA/.test(text)) return 'improcedente';
  if (/\bPROCEDENTE\b|\bPROCEDENTES\b|\bPROCEDENCIA\b/.test(text)) return 'procedente';

  for (const sentence of text.split(/[.;!?\n]+/)) {
    const kind = readRemedySentence(sentence);
    if (kind) return kind;
  }

  if (/\bCONDENAD[OA]S?\b|CONDENACAO|CONDENOU|CONDENANDO|\bCONDENA\b/.test(text)) return 'condenacao';

  return null;
};

export const detectIntimationOutcome = (summary?: string | null): IntimationOutcome | null => {
  const kind = detectIntimationOutcomeKind(summary);
  return kind ? { kind, label: LABELS[kind] } : null;
};
