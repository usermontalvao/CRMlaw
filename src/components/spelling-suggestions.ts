/**
 * Curadoria local das sugestões do Hunspell.
 *
 * Dicionários ortográficos são bons para dizer se uma palavra existe, mas a
 * lista de sugestões deles é puramente lexical. Em palavras muito curtas isso
 * produz menus como "Oe" → "OE, De, Oz, Ose, Soe". Esta camada:
 *   1. resolve erros frequentes de alta confiança imediatamente;
 *   2. remove duplicatas e a própria palavra;
 *   3. evita exibir palpites aleatórios para palavras de duas letras.
 *
 * O restante da desambiguação é feito pela camada contextual (frase + IA).
 */

const HIGH_CONFIDENCE_CORRECTIONS: Readonly<Record<string, readonly string[]>> = {
  oe: ['oi'],
  oie: ['oi', 'olá'],
  oiee: ['oi', 'olá'],
  oii: ['oi'],
  oiii: ['oi'],
  amiguo: ['amigo'],
  concerteza: ['com certeza'],
  derrepente: ['de repente'],
  apartir: ['a partir'],
  porisso: ['por isso'],
  denovo: ['de novo'],
  excessão: ['exceção'],
  exessão: ['exceção'],
  exceçao: ['exceção'],
  enchergar: ['enxergar'],
  mecher: ['mexer'],
  previlégio: ['privilégio'],
  previlegio: ['privilégio'],
  beneficiente: ['beneficente'],
  reinvindicar: ['reivindicar'],
  paralização: ['paralisação'],
  atravez: ['através'],
  analize: ['analise'],
  recizão: ['rescisão'],
  recisão: ['rescisão'],
  prescricao: ['prescrição'],
  peticao: ['petição'],
  decisao: ['decisão'],
  juizo: ['juízo'],
  merito: ['mérito'],
  improcedencia: ['improcedência'],
  jurisprudencia: ['jurisprudência'],
  honorarios: ['honorários'],
  // Acentuação esquecida e grafias erradas recorrentes em petição. Cada entrada
  // aqui é uma chamada de modelo que deixa de acontecer: a correção sai do
  // dicionário local, instantânea e sem custo.
  //
  // Só entram formas SEM ambiguidade de contexto. Pares como "tem/têm",
  // "esta/está" e "a/há" dependem da frase e ficam para a camada contextual:
  // uma correção errada é pior do que nenhuma.
  audiencia: ['audiência'],
  sentenca: ['sentença'],
  execucao: ['execução'],
  intimacao: ['intimação'],
  citacao: ['citação'],
  condenacao: ['condenação'],
  indenizacao: ['indenização'],
  reparacao: ['reparação'],
  obrigacao: ['obrigação'],
  contestacao: ['contestação'],
  impugnacao: ['impugnação'],
  manifestacao: ['manifestação'],
  fundamentacao: ['fundamentação'],
  rescisao: ['rescisão'],
  reclamatoria: ['reclamatória'],
  procuracao: ['procuração'],
  possivel: ['possível'],
  imovel: ['imóvel'],
  responsavel: ['responsável'],
  cabivel: ['cabível'],
  inadimplencia: ['inadimplência'],
  competencia: ['competência'],
  incompetencia: ['incompetência'],
  eficacia: ['eficácia'],
  antecipatoria: ['antecipatória'],
  probatorio: ['probatório'],
  necessario: ['necessário'],
  contrario: ['contrário'],
  proprio: ['próprio'],
  ultimo: ['último'],
  minimo: ['mínimo'],
  maximo: ['máximo'],
  numero: ['número'],
  codigo: ['código'],
  orgao: ['órgão'],
  onus: ['ônus'],
  oficio: ['ofício'],
  salario: ['salário'],
  horario: ['horário'],
  ferias: ['férias'],
  rescisorio: ['rescisório'],
  emprestimo: ['empréstimo'],
  beneficio: ['benefício'],
  pericia: ['perícia'],
  aleguem: ['alegem'],
  atravéz: ['através'],
  vantagen: ['vantagem'],
  imagen: ['imagem'],
  homen: ['homem'],
  seje: ['seja'],
  menas: ['menos'],
  entao: ['então'],
  tambem: ['também'],
  porem: ['porém'],
  alem: ['além'],
  apos: ['após'],
  atraves: ['através'],
  familia: ['família'],
  policia: ['polícia'],
  juizes: ['juízes'],
};

/** A curadoria local já resolve esta palavra sem consultar nada remoto. */
export function hasHighConfidenceCorrection(rawWord: string): boolean {
  const key = String(rawWord || '').trim().toLocaleLowerCase('pt-BR');
  return Boolean(key && HIGH_CONFIDENCE_CORRECTIONS[key]?.length);
}

const applyOriginalCase = (suggestion: string, original: string): string => {
  if (!suggestion) return suggestion;
  if (original === original.toUpperCase()) return suggestion.toUpperCase();
  if (/^\p{Lu}/u.test(original)) {
    return suggestion.charAt(0).toLocaleUpperCase('pt-BR') + suggestion.slice(1);
  }
  return suggestion;
};

const cleanSuggestion = (value: unknown): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Valida a saída da IA antes que ela vire item clicável no editor.
 */
export function normalizeContextualSpellingSuggestions(
  rawSuggestions: unknown,
  rawWord: string,
): string[] {
  if (!Array.isArray(rawSuggestions)) return [];

  const word = String(rawWord || '').trim();
  const normalizedWord = word.toLocaleLowerCase('pt-BR');
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawSuggestion of rawSuggestions) {
    if (/[\r\n]/.test(String(rawSuggestion ?? ''))) continue;
    const suggestion = cleanSuggestion(rawSuggestion);
    if (!suggestion || suggestion.length > 60) continue;
    if (!/^[\p{L}\p{M}'’ -]+$/u.test(suggestion)) continue;

    const key = suggestion.toLocaleLowerCase('pt-BR');
    if (key === normalizedWord || seen.has(key)) continue;

    seen.add(key);
    normalized.push(applyOriginalCase(suggestion, word));
    if (normalized.length >= 3) break;
  }

  return normalized;
}

export interface ContextualSentenceSpellingIssue {
  bad: string;
  good: string;
  message: string;
}

/**
 * Valida os falsos negativos que a IA encontrou ao ler a frase inteira
 * (palavras existentes, porém inadequadas naquele contexto).
 */
export function normalizeContextualSentenceSpellingIssues(
  rawIssues: unknown,
  rawSentence: string,
): ContextualSentenceSpellingIssue[] {
  if (!Array.isArray(rawIssues)) return [];

  const sentence = String(rawSentence ?? '');
  const normalizedSentence = sentence.toLocaleLowerCase('pt-BR');
  const seen = new Set<string>();
  const issues: ContextualSentenceSpellingIssue[] = [];

  for (const rawIssue of rawIssues) {
    const bad = cleanSuggestion((rawIssue as any)?.bad);
    let good = cleanSuggestion((rawIssue as any)?.good);
    // Guardrail de altíssima confiança para o caso reportado: modelos nano
    // ocasionalmente tentam devolver o espanhol "mi". Diante do substantivo
    // masculino singular "amigo", a única correção contextual é "meu".
    if (
      bad.toLocaleLowerCase('pt-BR') === 'mei'
      && /(?:^|[^\p{L}\p{M}])mei\s+amigo(?:$|[^\p{L}\p{M}])/iu.test(sentence)
    ) {
      good = applyOriginalCase('meu', bad);
    }
    if (!bad || !good || bad.length > 40 || good.length > 60) continue;
    if (/[\r\n]/.test(String((rawIssue as any)?.bad ?? ''))) continue;
    if (/[\r\n]/.test(String((rawIssue as any)?.good ?? ''))) continue;
    if (!/^[\p{L}\p{M}'’ -]+$/u.test(bad) || !/^[\p{L}\p{M}'’ -]+$/u.test(good)) continue;

    const key = bad.toLocaleLowerCase('pt-BR');
    if (key === good.toLocaleLowerCase('pt-BR') || seen.has(key)) continue;
    if (!normalizedSentence.includes(key)) continue;

    const message = cleanSuggestion((rawIssue as any)?.message).slice(0, 180)
      || `“${bad}” não se encaixa no contexto da frase.`;
    seen.add(key);
    issues.push({ bad, good, message });
    if (issues.length >= 3) break;
  }

  return issues;
}

/**
 * Retorna somente opções úteis para o menu, já na caixa da palavra original.
 */
export function curateSpellingSuggestions(
  rawWord: string,
  dictionarySuggestions: readonly string[],
): string[] {
  const word = String(rawWord || '').trim();
  if (!word) return [];

  const normalizedWord = word.toLocaleLowerCase('pt-BR');
  const direct = HIGH_CONFIDENCE_CORRECTIONS[normalizedWord];
  if (direct?.length) {
    // Uma correção explícita é justamente o caso em que não queremos completar
    // o menu com cinco candidatos lexicamente próximos e semanticamente ruins.
    return direct.map((candidate) => applyOriginalCase(candidate, word));
  }

  // Duas letras não contêm sinal suficiente para ranquear sugestões apenas por
  // distância de edição. É melhor a camada contextual decidir — ou mostrar
  // "Nenhuma sugestão" — do que oferecer cinco palavras aleatórias.
  if (Array.from(word).length <= 2) return [];

  const limit = Array.from(word).length === 3 ? 3 : 5;
  const seen = new Set<string>();
  const curated: string[] = [];

  for (const rawCandidate of dictionarySuggestions || []) {
    if (/[\r\n]/.test(String(rawCandidate ?? ''))) continue;
    const candidate = cleanSuggestion(rawCandidate);
    if (!candidate || candidate.length > 60) continue;
    if (!/^[\p{L}\p{M}'’ -]+$/u.test(candidate)) continue;

    const normalizedCandidate = candidate.toLocaleLowerCase('pt-BR');
    if (normalizedCandidate === normalizedWord || seen.has(normalizedCandidate)) continue;

    seen.add(normalizedCandidate);
    curated.push(applyOriginalCase(candidate, word));
    if (curated.length >= limit) break;
  }

  return curated;
}

/**
 * Reconstrói exatamente o intervalo que o Syncfusion selecionou para a
 * correção, trocando somente a palavra. Algumas versões incluem no range o
 * espaço ou a pontuação vizinha; inserir apenas a sugestão apagaria esses
 * caracteres e produziria "meuamigo".
 */
export function replaceSpellingWordInRange(
  rangeText: string,
  rawWord: string,
  rawSuggestion: string,
): string | null {
  const original = String(rangeText ?? '');
  const word = String(rawWord ?? '').trim();
  const suggestion = cleanSuggestion(rawSuggestion);
  if (!original || !word || !suggestion) return null;

  let index = original.indexOf(word);
  if (index < 0) {
    index = original
      .toLocaleLowerCase('pt-BR')
      .indexOf(word.toLocaleLowerCase('pt-BR'));
  }
  if (index < 0) return null;

  return original.slice(0, index) + suggestion + original.slice(index + word.length);
}
