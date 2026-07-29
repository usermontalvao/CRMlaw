/**
 * utils/clientDuplicateGating
 * -----------------------------------------------------------------------------
 * Decide QUANDO a IA pode ser chamada para julgar contatos duplicados, e mede o
 * quanto dois CPFs "quase iguais" parecem erro de digitação.
 *
 * Módulo sem dependência nenhuma de propósito: é a parte que, se errar, mistura
 * o cadastro de duas pessoas diferentes — então precisa ser testável isolada.
 */

/**
 * Distância entre dois CPFs de mesmo tamanho, contando só trocas de dígito e
 * transposições — os erros que a gente comete de verdade ao digitar.
 * Devolve Infinity quando os números têm comprimentos diferentes.
 */
export const cpfTypoDistance = (a: string, b: string): number => {
  if (a.length !== b.length) return Infinity;
  let diff = 0;
  const positions: number[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) { diff += 1; positions.push(i); }
  }
  // Dois dígitos vizinhos trocados de lugar conta como um erro só.
  if (
    diff === 2 &&
    positions[1] === positions[0] + 1 &&
    a[positions[0]] === b[positions[1]] &&
    a[positions[1]] === b[positions[0]]
  ) {
    return 1;
  }
  return diff;
};

/** Máximo de dígitos divergentes ainda tratados como erro de digitação. */
export const CPF_TYPO_TOLERANCE = 2;

/**
 * Dois cadastros com CPFs diferentes só viram suspeita quando o nome bate
 * exatamente E algum contato bate E o CPF diverge por pouco. Fora disso, CPF
 * diferente é gente diferente, ponto.
 */
export const looksLikeCpfTypo = (params: {
  cpfA: string;
  cpfB: string;
  sameName: boolean;
  sameContact: boolean;
}): boolean => {
  const { cpfA, cpfB, sameName, sameContact } = params;
  if (cpfA.length < 11 || cpfB.length < 11) return false;
  if (cpfA === cpfB) return false;
  if (!sameName || !sameContact) return false;
  return cpfTypoDistance(cpfA, cpfB) <= CPF_TYPO_TOLERANCE;
};

/** Só o que a decisão precisa saber de um grupo de duplicados. */
export interface GatingGroup { reasons: readonly string[]; }

/** CPF idêntico é certeza: mescla por regra, sem gastar chamada de IA. */
export const isCertainDuplicate = (group: GatingGroup): boolean =>
  group.reasons.includes('CPF igual');

/**
 * A IA entra só quando há indício real E o indício não é conclusivo sozinho.
 * Sem indício nenhum, ela não é acionada — é o que impede a IA de sair varrendo
 * a base de clientes à toa.
 */
export const needsAiJudgement = (group: GatingGroup): boolean => {
  if (isCertainDuplicate(group)) return false;
  return (
    group.reasons.includes('CPF parecido') ||
    group.reasons.includes('Nome igual') ||
    group.reasons.includes('Telefone igual') ||
    group.reasons.includes('E-mail igual')
  );
};
