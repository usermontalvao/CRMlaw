// Regras gramaticais próprias (pt-BR jurídico) para a revisão do editor.
//
// Por que existem, se já usamos LanguageTool: o LT comunitário passa batido em
// erros clássicos de petição — "vem a presença de Vossa Excelência" (crase),
// "Os autor" resolvido com sugestão sem sentido, "danos moral", "mandato de
// segurança". Estas regras são determinísticas, rodam offline, custam zero e
// explicam a REGRA gramatical aplicada (o painel mostra a explicação).
//
// Duas famílias:
//  1. Regras de padrão (regex): crase, homônimos jurídicos, pontuação, vícios.
//  2. Motor de concordância nominal e verbal (gênero + número), montado sobre
//     um léxico de substantivos/adjetivos/determinantes do vocabulário forense.
//
// Nenhuma regra altera o texto sozinha: tudo vira sugestão para o usuário
// aprovar no painel de revisão.

export type LegalRuleCategory =
  | 'crase'
  | 'concordancia'
  | 'genero'
  | 'gramatica'
  | 'pontuacao'
  | 'estilo'
  | 'juridico';

export type LegalRuleSeverity = 'error' | 'warning' | 'suggestion';

export interface LegalRuleMatch {
  ruleId: string;
  category: LegalRuleCategory;
  severity: LegalRuleSeverity;
  /** Posição do erro no texto analisado. */
  offset: number;
  length: number;
  /** Trecho exato considerado errado. */
  bad: string;
  /** Correções propostas, da mais provável para a menos provável. */
  suggestions: string[];
  /** O que está errado (uma frase). */
  message: string;
  /** A regra gramatical por trás da correção (didático). */
  explanation: string;
}

/* ────────────────────────────────────────────────────────────────
 * Utilidades de casamento com fronteira de palavra
 *
 * \b do JS é ASCII: em "petição" ele quebra no "ç". Usamos uma classe
 * explícita com os acentos do português e um prefixo consumido +
 * lookahead, evitando lookbehind (Safari < 16.4).
 * ──────────────────────────────────────────────────────────────── */

const WORD_CHAR = '0-9A-Za-zÀ-ÖØ-öø-ÿ';
const WORD_RE = new RegExp(`[${WORD_CHAR}]+(?:['’-][${WORD_CHAR}]+)*`, 'g');

/** Regex com fronteira de palavra: o grupo 1 é sempre o trecho do erro. */
const bounded = (source: string, flags = 'gi'): RegExp =>
  new RegExp(`(?:^|[^${WORD_CHAR}])(${source})(?![${WORD_CHAR}])`, flags);

/** Copia a caixa da primeira letra do original para a sugestão. */
const matchCase = (original: string, replacement: string): string => {
  const first = original.charAt(0);
  if (!first || first !== first.toUpperCase() || first === first.toLowerCase()) return replacement;
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
};

const lower = (value: string): string => value.toLowerCase();

/* ────────────────────────────────────────────────────────────────
 * 1) Regras de padrão
 * ──────────────────────────────────────────────────────────────── */

interface PatternRule {
  id: string;
  category: LegalRuleCategory;
  severity: LegalRuleSeverity;
  /**
   * Corpo da regex (sem fronteiras): o casamento inteiro é o erro.
   * `bounded` embrulha o corpo num grupo, então grupos internos são numerados
   * a partir de \2 (vale para retrovisores como o de palavra repetida).
   */
  source: string;
  message: string;
  explanation: string;
  /** Sugestões a partir do trecho casado (grupos internos em `groups`). */
  fix: (bad: string, groups: string[]) => string[];
  /** Regex já pronta (usada por regras que não querem fronteira de palavra). */
  raw?: RegExp;
}

/** Troca a primeira ocorrência isolada de "a" por "à" mantendo o resto. */
const craseFirstA = (bad: string): string[] => [
  bad.replace(new RegExp(`(^|[^${WORD_CHAR}])a(?![${WORD_CHAR}])`), (_m, p1) => `${p1}à`),
];

const PATTERN_RULES: PatternRule[] = [
  // ── Crase ────────────────────────────────────────────────────────
  {
    id: 'CRASE_PRESENCA',
    category: 'crase',
    severity: 'error',
    source: '(?:vem|vêm|venho|vimos|comparece|comparecem|compareceu|dirige-se|dirigem-se|dirijo-me)\\s+a\\s+(?:mui\\s+)?(?:douta\\s+|respeitosa\\s+|honrosa\\s+|augusta\\s+)?presença',
    message: 'Falta a crase em "à presença".',
    explanation:
      'Crase é a fusão da preposição "a" com o artigo "a". Os verbos "vir/comparecer/dirigir-se" pedem a preposição "a" e "presença" é substantivo feminino determinado — logo, "vem à presença de Vossa Excelência".',
    fix: craseFirstA,
  },
  {
    id: 'CRASE_A_PARTIR',
    category: 'crase',
    severity: 'error',
    source: 'à\\s+partir\\s+d(?:e|o|a|os|as)',
    message: 'Não existe crase em "a partir de".',
    explanation: 'Não há crase antes de verbo. "Partir" é verbo no infinitivo: a partir de.',
    fix: (bad) => [bad.replace(/à/i, (m) => matchCase(m, 'a'))],
  },
  {
    id: 'CRASE_ANTES_DE_VERBO',
    category: 'crase',
    severity: 'error',
    source:
      'à\\s+(requerer|pagar|cumprir|fazer|receber|apresentar|produzir|comprovar|juntar|indenizar|arcar|sustentar|decidir|determinar|aplicar|reconhecer|deferir|condenar|proceder|realizar|efetuar|analisar|julgar|contar|providenciar)',
    message: 'Não há crase antes de verbo.',
    explanation:
      'A crase pressupõe o artigo feminino "a", e verbo no infinitivo não admite artigo. Correto: "a requerer", "a pagar", "a cumprir".',
    fix: (bad) => [bad.replace(/à/i, (m) => matchCase(m, 'a'))],
  },
  {
    id: 'CRASE_PRONOME_TRATAMENTO',
    category: 'crase',
    severity: 'error',
    source: 'à\\s+(Vossa|Sua)\\s+(Excelência|Senhoria|Majestade|Santidade)',
    message: 'Pronome de tratamento não admite crase.',
    explanation:
      'Pronomes de tratamento (Vossa Excelência, Vossa Senhoria) não aceitam artigo, e sem artigo não há crase: "a Vossa Excelência".',
    fix: (bad) => [bad.replace(/à/i, (m) => matchCase(m, 'a'))],
  },
  {
    id: 'CRASE_A_TITULO_DE',
    category: 'crase',
    severity: 'error',
    source: 'à\\s+título\\s+de',
    message: 'Não existe crase antes de palavra masculina.',
    explanation: '"Título" é masculino; a crase só ocorre diante de palavra feminina. Correto: "a título de".',
    fix: (bad) => [bad.replace(/à/i, (m) => matchCase(m, 'a'))],
  },
  {
    id: 'CRASE_MEDIDA_QUE',
    category: 'crase',
    severity: 'warning',
    source: 'à\\s+medida\\s+em\\s+que',
    message: 'A locução correta é "à medida que".',
    explanation:
      '"À medida que" indica proporção; "na medida em que" indica causa. Não existe a forma híbrida "à medida em que".',
    fix: (bad) => [matchCase(bad, 'à medida que'), matchCase(bad, 'na medida em que')],
  },
  {
    id: 'CRASE_NA_MEDIDA_QUE',
    category: 'crase',
    severity: 'warning',
    source: 'na\\s+medida\\s+que',
    message: 'A locução causal correta é "na medida em que".',
    explanation: '"Na medida em que" = já que, uma vez que. "À medida que" = proporção.',
    fix: (bad) => [matchCase(bad, 'na medida em que'), matchCase(bad, 'à medida que')],
  },
  {
    id: 'CRASE_HORAS',
    category: 'crase',
    severity: 'warning',
    source: 'as\\s+(\\d{1,2})(?:h|:\\d{2}|\\s+horas)',
    message: 'Horas determinadas pedem crase.',
    explanation: 'Na indicação de hora determinada usa-se crase: "às 14h", "às 9 horas".',
    fix: (bad) => [bad.replace(/^as/i, (m) => matchCase(m, 'às'))],
  },
  {
    id: 'CRASE_FLS',
    category: 'crase',
    severity: 'suggestion',
    source: 'as\\s+fls?\\.',
    message: 'Referência a folhas dos autos costuma pedir crase.',
    explanation: 'Em "conforme às fls. 20" há preposição + artigo. Ignore se "as fls." for objeto direto ("juntou as fls.").',
    fix: (bad) => [bad.replace(/^as/i, (m) => matchCase(m, 'às'))],
  },

  // ── Gramática geral ──────────────────────────────────────────────
  {
    id: 'HA_TEMPO_ATRAS',
    category: 'gramatica',
    severity: 'error',
    source: '(há|ha)\\s+((?:\\d+|[A-Za-zÀ-ÿ]+))\\s+(anos?|meses|mês|dias?|semanas?|horas?)\\s+atrás',
    message: 'Redundância: "há" já indica tempo passado.',
    explanation: 'O verbo "haver" no sentido temporal equivale a "atrás". Use "há dois anos" ou "dois anos atrás", nunca os dois.',
    fix: (bad) => [bad.replace(/\s+atrás$/i, '')],
  },
  {
    id: 'AFIM_DE',
    category: 'gramatica',
    severity: 'error',
    source: 'afim\\s+de',
    message: 'Finalidade se escreve "a fim de".',
    explanation: '"A fim de" indica finalidade; "afim" é adjetivo de semelhança ("ideias afins").',
    fix: (bad) => [matchCase(bad, 'a fim de')],
  },
  {
    id: 'HAJA_VISTO',
    category: 'gramatica',
    severity: 'error',
    source: 'haja\\s+visto',
    message: 'A locução é invariável: "haja vista".',
    explanation: '"Haja vista" é expressão cristalizada e não flexiona: haja vista os documentos.',
    fix: (bad) => [matchCase(bad, 'haja vista')],
  },
  {
    id: 'ONDE_NAO_LOCATIVO',
    category: 'gramatica',
    severity: 'warning',
    source:
      '(processo|contrato|artigo|momento|caso|situação|petição|sentença|acórdão|audiência|período|ano|época|hipótese|decisão|cláusula)\\s+onde',
    message: '"Onde" indica lugar físico; aqui cabe "em que".',
    explanation: '"Onde" só se usa para lugar. Para tempo, situação ou documento, use "em que" / "no qual".',
    fix: (_bad, groups) => [`${groups[0]} em que`, `${groups[0]} no qual`],
  },
  {
    id: 'ACERCA_DE_QUANTIDADE',
    category: 'gramatica',
    severity: 'error',
    source: 'acerca\\s+de(?=\\s+\\d)',
    message: '"Acerca de" significa "sobre"; para aproximação use "cerca de".',
    explanation: '"Cerca de" = aproximadamente. "Acerca de" = a respeito de. "Há cerca de" = tempo decorrido.',
    fix: (bad) => [bad.replace(/^acerca/i, (m) => matchCase(m, 'cerca'))],
  },
  {
    id: 'REPETICAO_PALAVRA',
    category: 'gramatica',
    severity: 'warning',
    // \2 e não \1: o grupo 1 é o embrulho criado por `bounded`.
    source: '([A-Za-zÀ-ÿ]{3,})\\s+\\2',
    message: 'Palavra repetida.',
    explanation: 'Provável erro de digitação: a mesma palavra aparece duas vezes seguidas.',
    fix: (_bad, groups) => [groups[0]],
  },

  // ── Homônimos e termos jurídicos ─────────────────────────────────
  {
    id: 'MANDATO_DE_SEGURANCA',
    category: 'juridico',
    severity: 'error',
    source: 'mandato\\s+de\\s+segurança',
    message: 'O remédio constitucional é "mandado de segurança".',
    explanation: '"Mandado" é ordem judicial; "mandato" é procuração ou período de exercício de cargo.',
    fix: (bad) => [matchCase(bad, 'mandado de segurança')],
  },
  {
    id: 'MANDATO_JUDICIAL',
    category: 'juridico',
    severity: 'error',
    source: 'mandato\\s+(de\\s+citação|de\\s+intimação|de\\s+penhora|judicial)',
    message: 'Ordem judicial é "mandado".',
    explanation: '"Mandado" (do verbo mandar) é a ordem escrita do juízo; "mandato" é o poder outorgado na procuração.',
    fix: (bad) => [bad.replace(/^mandato/i, (m) => matchCase(m, 'mandado'))],
  },
  {
    id: 'SESSAO_SECAO',
    category: 'juridico',
    severity: 'warning',
    source: 'sessão\\s+(judiciária|eleitoral\\s+do\\s+cartório)',
    message: 'Divisão territorial da Justiça é "seção".',
    explanation: '"Seção" = divisão/repartição (Seção Judiciária). "Sessão" = reunião de julgamento. "Cessão" = ato de ceder.',
    fix: (bad) => [bad.replace(/^sessão/i, (m) => matchCase(m, 'seção'))],
  },
  {
    id: 'SECAO_DE_JULGAMENTO',
    category: 'juridico',
    severity: 'warning',
    source: 'seção\\s+de\\s+julgamento',
    message: 'Reunião de julgamento é "sessão".',
    explanation: '"Sessão" = reunião; "seção" = divisão administrativa.',
    fix: (bad) => [bad.replace(/^seção/i, (m) => matchCase(m, 'sessão'))],
  },
  {
    id: 'IMINENTE_EMINENTE',
    category: 'juridico',
    severity: 'warning',
    source: 'iminente\\s+(relator|desembargador|desembargadora|ministro|ministra|julgador|magistrado|magistrada|jurista)',
    message: 'Para elogiar a autoridade use "eminente".',
    explanation: '"Eminente" = ilustre. "Iminente" = prestes a acontecer.',
    fix: (bad) => [bad.replace(/^iminente/i, (m) => matchCase(m, 'eminente'))],
  },
  {
    id: 'RATIFICAR_RETIFICAR',
    category: 'juridico',
    severity: 'warning',
    source: 'ratificar\\s+(o\\s+endereço|o\\s+erro|o\\s+valor|os\\s+dados|a\\s+informação|o\\s+cálculo)',
    message: 'Corrigir é "retificar".',
    explanation: '"Retificar" = corrigir. "Ratificar" = confirmar.',
    fix: (bad) => [bad.replace(/^ratificar/i, (m) => matchCase(m, 'retificar'))],
  },
  {
    id: 'DATA_VENIA_ACENTO',
    category: 'juridico',
    severity: 'suggestion',
    source: 'data\\s+(máxima\\s+)?vênia',
    message: 'A expressão latina não leva acento.',
    explanation: 'Locução latina: "data venia" / "data maxima venia" (preferencialmente em itálico).',
    fix: (bad) => [
      matchCase(bad, /máxima/i.test(bad) ? 'data maxima venia' : 'data venia'),
    ],
  },
  {
    id: 'EXMO_DOUTOR_JUIZ',
    category: 'juridico',
    severity: 'suggestion',
    source: '(Excelentíssimo|Exmo\\.?|Excelentissimo)\\s+Senhor\\s+Doutor\\s+(Juiz|Juíza)',
    message: '"Doutor" é redundante no vocativo.',
    explanation: 'O tratamento protocolar é "Excelentíssimo Senhor Juiz de Direito" ou "Meritíssimo Juiz".',
    fix: (_bad, groups) => [`${groups[0]} Senhor ${groups[1]}`],
  },
  {
    id: 'ATRAVES_DE',
    category: 'estilo',
    severity: 'suggestion',
    source: 'através\\s+d(e|a|o|as|os)',
    message: 'Prefira "por meio de".',
    explanation: '"Através de" significa "de lado a lado". Para meio/instrumento, a norma culta pede "por meio de".',
    fix: (bad, groups) => [matchCase(bad, `por meio d${groups[0].toLowerCase()}`)],
  },
  {
    id: 'POSTO_QUE_CAUSAL',
    category: 'estilo',
    severity: 'suggestion',
    source: 'posto\\s+que',
    message: '"Posto que" é concessivo (= embora).',
    explanation: 'Se a ideia for de causa, use "já que", "uma vez que" ou "porquanto".',
    fix: (bad) => [matchCase(bad, 'já que'), matchCase(bad, 'uma vez que')],
  },
  {
    id: 'O_MESMO_PRONOME',
    category: 'estilo',
    severity: 'suggestion',
    source: '(o|a)\\s+(mesmo|mesma)(?=\\s*(?:,|\\.|;|deve|deverá|não|é|foi|será|está|requer|alega|informa|apresentou|juntou|recebeu))',
    message: '"O mesmo" não substitui pronome pessoal.',
    explanation: 'Use "ele/ela", o nome da parte ou "o referido": "o autor deve", "ele deve".',
    fix: (_bad, groups) => [
      groups[0].toLowerCase() === 'o' ? matchCase(groups[0], 'ele') : matchCase(groups[0], 'ela'),
      `${groups[0]} referid${groups[0].toLowerCase() === 'o' ? 'o' : 'a'}`,
    ],
  },
  {
    id: 'VENHO_ATRAVES_DESTA',
    category: 'estilo',
    severity: 'suggestion',
    source: 'venho,?\\s+através\\s+d(?:esta|este|o\\s+presente)',
    message: 'Fórmula redundante.',
    explanation: 'A própria petição já é o meio. Prefira "venho, respeitosamente," ou "venho, por meio desta,".',
    fix: () => ['venho, respeitosamente,', 'venho, por meio desta,'],
  },
  {
    id: 'A_NIVEL_DE',
    category: 'estilo',
    severity: 'warning',
    source: 'a\\s+n[íi]vel\\s+d(?:e|a|o)',
    message: '"A nível de" é considerado incorreto.',
    explanation: 'Use "em nível de" (âmbito) ou reescreva: "no âmbito de", "quanto a".',
    fix: (bad) => [bad.replace(/^a\s+n[íi]vel/i, (m) => matchCase(m, 'em nível'))],
  },
  {
    id: 'HOUVERAM_EXISTENCIAL',
    category: 'concordancia',
    severity: 'error',
    source: 'houveram',
    message: '"Haver" no sentido de existir não vai para o plural.',
    explanation:
      'Como verbo existencial, "haver" é impessoal e fica sempre no singular: "houve dois pedidos", "houve várias tentativas". "Houveram" só existe como tempo composto ("houveram-se por citados").',
    fix: (bad) => [matchCase(bad, 'houve')],
  },
  {
    id: 'HAVER_LOCUCAO_PLURAL',
    category: 'concordancia',
    severity: 'error',
    source: '(dev|v|pod|vai|ir)(?:em|ão)\\s+haver',
    message: 'Na locução com "haver" impessoal, o auxiliar fica no singular.',
    explanation:
      'O auxiliar herda a impessoalidade de "haver": "deve haver provas", "vai haver audiências" — nunca "devem haver" ou "vão haver".',
    fix: (bad) => {
      const singular: Record<string, string> = {
        devem: 'deve', vem: 'vem', vêm: 'vem', podem: 'pode', vão: 'vai', irão: 'irá',
      };
      return [bad.replace(/^\S+/, (m) => matchCase(m, singular[m.toLowerCase()] || m))];
    },
  },
  {
    id: 'FAZEM_TEMPO',
    category: 'concordancia',
    severity: 'error',
    source: '(fazem|faziam)\\s+(\\d+|dois|duas|três|quatro|cinco|seis|sete|oito|nove|dez|vários|várias|muitos|muitas)\\s+(anos?|meses|mês|dias?|semanas?|horas?)',
    message: '"Fazer" indicando tempo é impessoal: fica no singular.',
    explanation:
      'Na indicação de tempo decorrido, "fazer" não tem sujeito: "faz dois anos", "fazia três meses". O plural ("fazem dois anos") é desvio da norma culta.',
    fix: (bad, groups) => [
      bad.replace(/^\S+/, () => matchCase(bad, groups[0].toLowerCase() === 'fazem' ? 'faz' : 'fazia')),
    ],
  },
  {
    id: 'IMPLICAR_EM',
    category: 'gramatica',
    severity: 'warning',
    source: '(implica|implicam|implicar|implicou|implicaram|implicará)\\s+em',
    message: '"Implicar" no sentido de acarretar não pede preposição.',
    explanation:
      'Quem implica, implica ALGO: "a mora implica juros", "o descumprimento implicará multa". A regência com "em" existe só no sentido de envolver-se ("implicar-se em").',
    fix: (bad) => [bad.replace(/\s+em$/i, '')],
  },
  {
    id: 'PARA_MIM_INFINITIVO',
    category: 'gramatica',
    severity: 'error',
    source: 'para\\s+mim\\s+([a-zà-ÿ]+[ai]r)',
    message: 'Antes de verbo no infinitivo usa-se "para eu".',
    explanation:
      '"Mim" não pode ser sujeito. Quem pratica a ação é "eu": "para eu requerer", "para eu apresentar". Use "para mim" só quando não houver verbo depois ("entregue para mim").',
    fix: (bad) => [bad.replace(/mim/i, (m) => matchCase(m, 'eu'))],
  },
  {
    id: 'ENTRE_EU',
    category: 'gramatica',
    severity: 'error',
    source: 'entre\\s+eu\\s+e',
    message: 'Depois de preposição usa-se "mim".',
    explanation:
      '"Entre" é preposição e exige pronome oblíquo: "entre mim e o réu", "entre mim e ele".',
    fix: (bad) => [bad.replace(/eu/i, (m) => matchCase(m, 'mim'))],
  },
  {
    id: 'MA_FE_HIFEN',
    category: 'juridico',
    severity: 'warning',
    source: '(?:m[áa]|mau)\\s+f[ée]',
    message: 'A grafia consagrada é "má-fé".',
    explanation:
      '"Má-fé" é substantivo composto e leva hífen. "Fé" é feminino, o que também descarta "mau fé". O oposto é "boa-fé".',
    fix: (bad) => [matchCase(bad, 'má-fé')],
  },
  {
    id: 'MEIO_DIA_E_MEIA',
    category: 'gramatica',
    severity: 'suggestion',
    source: 'meio-?\\s?dia\\s+e\\s+meio',
    message: 'A concordância é com "hora": "meio-dia e meia".',
    explanation:
      'Subentende-se "meia hora", palavra feminina: "meio-dia e meia". A forma "meio-dia e meio" concordaria com "dia", que não é o termo elíptico.',
    fix: (bad) => [matchCase(bad, 'meio-dia e meia')],
  },
  {
    id: 'FACE_AO',
    category: 'estilo',
    severity: 'warning',
    source: 'face\\s+(ao|aos|à|às)',
    message: 'A locução é "em face de".',
    explanation: '"Em face de" = diante de. Ex.: "em face do réu", "em face da decisão".',
    fix: (bad, groups) => {
      const contraction: Record<string, string> = { ao: 'do', aos: 'dos', à: 'da', às: 'das' };
      return [matchCase(bad, `em face ${contraction[groups[0].toLowerCase()] || 'de'}`)];
    },
  },

  // ── Pontuação e espaçamento ──────────────────────────────────────
  {
    id: 'ESPACO_DUPLO',
    category: 'pontuacao',
    severity: 'warning',
    source: '',
    raw: / {2,}/g,
    message: 'Espaço duplicado.',
    explanation: 'Entre palavras usa-se um único espaço; a justificação do parágrafo cuida do alinhamento.',
    fix: () => [' '],
  },
  {
    id: 'ESPACO_ANTES_PONTUACAO',
    category: 'pontuacao',
    severity: 'warning',
    source: '',
    raw: /\s+([,;:.!?](?!\d))/g,
    message: 'Espaço antes do sinal de pontuação.',
    explanation: 'A pontuação vem colada à palavra anterior e seguida de um espaço.',
    fix: (_bad, groups) => [groups[0]],
  },
  {
    id: 'FALTA_ESPACO_APOS_PONTUACAO',
    category: 'pontuacao',
    severity: 'warning',
    source: '',
    raw: /([,;:])([A-Za-zÀ-ÿ])/g,
    message: 'Falta espaço depois da pontuação.',
    explanation: 'Vírgula, ponto e vírgula e dois-pontos são seguidos de espaço.',
    fix: (_bad, groups) => [`${groups[0]} ${groups[1]}`],
  },
  {
    id: 'RETICENCIAS',
    category: 'pontuacao',
    severity: 'suggestion',
    source: '',
    raw: /\.{4,}/g,
    message: 'Reticências têm exatamente três pontos.',
    explanation: 'O sinal de reticências é "..." — nem dois, nem quatro pontos.',
    fix: () => ['...'],
  },
  {
    id: 'PONTO_DUPLO',
    category: 'pontuacao',
    severity: 'warning',
    source: '',
    raw: /([A-Za-zÀ-ÿ])\.\.(?!\.)/g,
    message: 'Ponto final duplicado.',
    explanation: 'Use um ponto para encerrar a frase ou três para reticências.',
    fix: (_bad, groups) => [`${groups[0]}.`, `${groups[0]}...`],
  },
];

const runPatternRules = (text: string): LegalRuleMatch[] => {
  const found: LegalRuleMatch[] = [];

  for (const rule of PATTERN_RULES) {
    const regex = rule.raw ? new RegExp(rule.raw.source, rule.raw.flags) : bounded(rule.source);
    let match: RegExpExecArray | null;
    let guard = 0;

    while ((match = regex.exec(text)) !== null && guard++ < 500) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      // Sem `raw`, o grupo 1 é o erro e fecha o casamento (o sufixo é lookahead),
      // então basta descontar o comprimento do grupo do fim do casamento.
      const bad = rule.raw ? match[0] : match[1];
      const offset = rule.raw ? match.index : match.index + match[0].length - bad.length;
      const groups = match.slice(rule.raw ? 1 : 2).map((g) => g ?? '');

      const suggestions = rule
        .fix(bad, groups)
        .map((s) => String(s ?? ''))
        .filter((s) => s !== bad)
        .slice(0, 3);

      found.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        offset,
        length: bad.length,
        bad,
        suggestions,
        message: rule.message,
        explanation: rule.explanation,
      });
    }
  }

  return found;
};

/* ────────────────────────────────────────────────────────────────
 * 2) Motor de concordância (gênero e número)
 * ──────────────────────────────────────────────────────────────── */

type Gender = 'm' | 'f';
type Numberness = 'sg' | 'pl';

interface DeterminerForm {
  gender: Gender;
  number: Numberness;
  /** Formas do mesmo determinante: [m.sg, f.sg, m.pl, f.pl]. */
  forms: [string, string, string, string];
  /** Contração com preposição (do, na, pelo…): não introduz sujeito. */
  contracted: boolean;
}

const DETERMINER_SETS: Array<{ forms: [string, string, string, string]; contracted?: boolean }> = [
  { forms: ['o', 'a', 'os', 'as'] },
  { forms: ['ao', 'à', 'aos', 'às'], contracted: true },
  { forms: ['um', 'uma', 'uns', 'umas'] },
  { forms: ['este', 'esta', 'estes', 'estas'] },
  { forms: ['esse', 'essa', 'esses', 'essas'] },
  { forms: ['aquele', 'aquela', 'aqueles', 'aquelas'] },
  { forms: ['do', 'da', 'dos', 'das'], contracted: true },
  { forms: ['no', 'na', 'nos', 'nas'], contracted: true },
  { forms: ['pelo', 'pela', 'pelos', 'pelas'], contracted: true },
  { forms: ['neste', 'nesta', 'nestes', 'nestas'], contracted: true },
  { forms: ['deste', 'desta', 'destes', 'destas'], contracted: true },
  { forms: ['nesse', 'nessa', 'nesses', 'nessas'], contracted: true },
  { forms: ['desse', 'dessa', 'desses', 'dessas'], contracted: true },
  { forms: ['naquele', 'naquela', 'naqueles', 'naquelas'], contracted: true },
  { forms: ['daquele', 'daquela', 'daqueles', 'daquelas'], contracted: true },
  { forms: ['todo', 'toda', 'todos', 'todas'] },
  { forms: ['outro', 'outra', 'outros', 'outras'] },
  { forms: ['seu', 'sua', 'seus', 'suas'] },
  { forms: ['nosso', 'nossa', 'nossos', 'nossas'] },
  { forms: ['algum', 'alguma', 'alguns', 'algumas'] },
  { forms: ['nenhum', 'nenhuma', 'nenhuns', 'nenhumas'] },
  { forms: ['referido', 'referida', 'referidos', 'referidas'] },
  { forms: ['citado', 'citada', 'citados', 'citadas'] },
  { forms: ['aludido', 'aludida', 'aludidos', 'aludidas'] },
  { forms: ['supracitado', 'supracitada', 'supracitados', 'supracitadas'] },
  { forms: ['mencionado', 'mencionada', 'mencionados', 'mencionadas'] },
];

/**
 * Formas que NÃO disparam a análise (mas continuam válidas como correção).
 * O artigo "a" sozinho é quase sempre preposição em petição ("referente a
 * danos", "condenação a horas extras"): usá-lo como gatilho geraria falso
 * positivo em cascata. Como sugestão ("O autora" → "A autora") ele é ótimo.
 */
const DETERMINER_TRIGGER_BLOCKLIST = new Set(['a']);

const DETERMINERS = new Map<string, DeterminerForm>();
for (const set of DETERMINER_SETS) {
  const [msg, fsg, mpl, fpl] = set.forms;
  const entries: Array<[string, Gender, Numberness]> = [
    [msg, 'm', 'sg'],
    [fsg, 'f', 'sg'],
    [mpl, 'm', 'pl'],
    [fpl, 'f', 'pl'],
  ];
  for (const [word, gender, number] of entries) {
    if (!word || DETERMINER_TRIGGER_BLOCKLIST.has(word)) continue;
    if (DETERMINERS.has(word)) continue;
    DETERMINERS.set(word, { gender, number, forms: set.forms, contracted: !!set.contracted });
  }
}

const determinerForm = (det: DeterminerForm, gender: Gender, number: Numberness): string => {
  const index = (gender === 'm' ? 0 : 1) + (number === 'pl' ? 2 : 0);
  return det.forms[index] || '';
};

interface NounForm {
  gender: Gender;
  number: Numberness;
  singular: string;
  plural: string;
  /** Par de gênero (autor ↔ autora), quando existe. */
  counterpart?: { singular: string; plural: string; gender: Gender };
}

/** [singular, plural, gênero, contraparte de gênero?] */
const NOUN_DATA: Array<[string, string, Gender, [string, string]?]> = [
  ['autor', 'autores', 'm', ['autora', 'autoras']],
  ['autora', 'autoras', 'f', ['autor', 'autores']],
  ['réu', 'réus', 'm', ['ré', 'rés']],
  ['ré', 'rés', 'f', ['réu', 'réus']],
  ['requerido', 'requeridos', 'm', ['requerida', 'requeridas']],
  ['requerida', 'requeridas', 'f', ['requerido', 'requeridos']],
  ['reclamado', 'reclamados', 'm', ['reclamada', 'reclamadas']],
  ['reclamada', 'reclamadas', 'f', ['reclamado', 'reclamados']],
  ['empregado', 'empregados', 'm', ['empregada', 'empregadas']],
  ['empregada', 'empregadas', 'f', ['empregado', 'empregados']],
  ['empregador', 'empregadores', 'm', ['empregadora', 'empregadoras']],
  ['empregadora', 'empregadoras', 'f', ['empregador', 'empregadores']],
  ['advogado', 'advogados', 'm', ['advogada', 'advogadas']],
  ['advogada', 'advogadas', 'f', ['advogado', 'advogados']],
  ['juiz', 'juízes', 'm', ['juíza', 'juízas']],
  ['juíza', 'juízas', 'f', ['juiz', 'juízes']],
  ['perito', 'peritos', 'm', ['perita', 'peritas']],
  ['perita', 'peritas', 'f', ['perito', 'peritos']],
  ['sócio', 'sócios', 'm', ['sócia', 'sócias']],
  ['sócia', 'sócias', 'f', ['sócio', 'sócios']],
  ['exequente', 'exequentes', 'm'],
  ['devedor', 'devedores', 'm', ['devedora', 'devedoras']],
  ['credor', 'credores', 'm', ['credora', 'credoras']],
  // Masculinos
  ['processo', 'processos', 'm'],
  ['recurso', 'recursos', 'm'],
  ['prazo', 'prazos', 'm'],
  ['pedido', 'pedidos', 'm'],
  ['dano', 'danos', 'm'],
  ['contrato', 'contratos', 'm'],
  ['mandado', 'mandados', 'm'],
  ['acórdão', 'acórdãos', 'm'],
  ['laudo', 'laudos', 'm'],
  ['salário', 'salários', 'm'],
  ['adicional', 'adicionais', 'm'],
  ['benefício', 'benefícios', 'm'],
  ['documento', 'documentos', 'm'],
  ['embargo', 'embargos', 'm'],
  ['agravo', 'agravos', 'm'],
  ['despacho', 'despachos', 'm'],
  ['ofício', 'ofícios', 'm'],
  ['fato', 'fatos', 'm'],
  ['direito', 'direitos', 'm'],
  ['princípio', 'princípios', 'm'],
  ['artigo', 'artigos', 'm'],
  ['inciso', 'incisos', 'm'],
  ['parágrafo', 'parágrafos', 'm'],
  ['valor', 'valores', 'm'],
  ['título', 'títulos', 'm'],
  ['depoimento', 'depoimentos', 'm'],
  ['tribunal', 'tribunais', 'm'],
  ['recibo', 'recibos', 'm'],
  ['aviso', 'avisos', 'm'],
  ['atestado', 'atestados', 'm'],
  ['comprovante', 'comprovantes', 'm'],
  ['requerimento', 'requerimentos', 'm'],
  ['julgamento', 'julgamentos', 'm'],
  ['pagamento', 'pagamentos', 'm'],
  ['contracheque', 'contracheques', 'm'],
  ['vínculo', 'vínculos', 'm'],
  ['acordo', 'acordos', 'm'],
  ['negócio', 'negócios', 'm'],
  ['imóvel', 'imóveis', 'm'],
  ['veículo', 'veículos', 'm'],
  // Femininos
  ['sentença', 'sentenças', 'f'],
  ['decisão', 'decisões', 'f'],
  ['petição', 'petições', 'f'],
  ['audiência', 'audiências', 'f'],
  ['ação', 'ações', 'f'],
  ['tutela', 'tutelas', 'f'],
  ['liminar', 'liminares', 'f'],
  ['condenação', 'condenações', 'f'],
  ['indenização', 'indenizações', 'f'],
  ['prova', 'provas', 'f'],
  ['testemunha', 'testemunhas', 'f'],
  ['verba', 'verbas', 'f'],
  ['multa', 'multas', 'f'],
  ['súmula', 'súmulas', 'f'],
  ['jurisprudência', 'jurisprudências', 'f'],
  ['empresa', 'empresas', 'f'],
  ['alegação', 'alegações', 'f'],
  ['obrigação', 'obrigações', 'f'],
  ['parte', 'partes', 'f'],
  ['exceção', 'exceções', 'f'],
  ['defesa', 'defesas', 'f'],
  ['contestação', 'contestações', 'f'],
  ['apelação', 'apelações', 'f'],
  ['execução', 'execuções', 'f'],
  ['penhora', 'penhoras', 'f'],
  ['citação', 'citações', 'f'],
  ['intimação', 'intimações', 'f'],
  ['notificação', 'notificações', 'f'],
  ['hora', 'horas', 'f'],
  ['jornada', 'jornadas', 'f'],
  ['rescisão', 'rescisões', 'f'],
  ['demissão', 'demissões', 'f'],
  ['lei', 'leis', 'f'],
  ['norma', 'normas', 'f'],
  ['cláusula', 'cláusulas', 'f'],
  ['prescrição', 'prescrições', 'f'],
  ['nulidade', 'nulidades', 'f'],
  ['perícia', 'perícias', 'f'],
  ['quantia', 'quantias', 'f'],
  ['medida', 'medidas', 'f'],
  ['ordem', 'ordens', 'f'],
  ['responsabilidade', 'responsabilidades', 'f'],
  ['fundamentação', 'fundamentações', 'f'],
  ['prestação', 'prestações', 'f'],
  ['gratificação', 'gratificações', 'f'],
  // Substantivos só-plural (férias, custas, autos, honorários) ficam de fora:
  // sem forma singular, o motor de número os acusaria indevidamente.
];

const NOUNS = new Map<string, NounForm>();
for (const [singular, plural, gender, counterpart] of NOUN_DATA) {
  const base: Omit<NounForm, 'number'> = {
    gender,
    singular,
    plural,
    counterpart: counterpart
      ? { singular: counterpart[0], plural: counterpart[1], gender: gender === 'm' ? 'f' : 'm' }
      : undefined,
  };
  if (!NOUNS.has(singular)) NOUNS.set(singular, { ...base, number: 'sg' });
  // "férias" é plural-only: o plural não pode sobrescrever o singular já posto.
  if (!NOUNS.has(plural)) NOUNS.set(plural, { ...base, number: 'pl' });
}

interface AdjectiveForm {
  gender: Gender | 'both';
  number: Numberness;
  forms: [string, string, string, string]; // m.sg, f.sg, m.pl, f.pl
}

/** [m.sg, f.sg, m.pl, f.pl] — invariáveis em gênero repetem a forma. */
const ADJECTIVE_SETS: Array<[string, string, string, string]> = [
  ['moral', 'moral', 'morais', 'morais'],
  ['material', 'material', 'materiais', 'materiais'],
  ['processual', 'processual', 'processuais', 'processuais'],
  ['judicial', 'judicial', 'judiciais', 'judiciais'],
  ['legal', 'legal', 'legais', 'legais'],
  ['contratual', 'contratual', 'contratuais', 'contratuais'],
  ['trabalhista', 'trabalhista', 'trabalhistas', 'trabalhistas'],
  ['cabível', 'cabível', 'cabíveis', 'cabíveis'],
  ['aplicável', 'aplicável', 'aplicáveis', 'aplicáveis'],
  ['exigível', 'exigível', 'exigíveis', 'exigíveis'],
  ['extra', 'extra', 'extras', 'extras'],
  ['rescisório', 'rescisória', 'rescisórios', 'rescisórias'],
  ['advocatício', 'advocatícia', 'advocatícios', 'advocatícias'],
  ['indevido', 'indevida', 'indevidos', 'indevidas'],
  ['devido', 'devida', 'devidos', 'devidas'],
  ['vencido', 'vencida', 'vencidos', 'vencidas'],
  ['pago', 'paga', 'pagos', 'pagas'],
  ['previsto', 'prevista', 'previstos', 'previstas'],
  ['necessário', 'necessária', 'necessários', 'necessárias'],
  ['comprovado', 'comprovada', 'comprovados', 'comprovadas'],
  ['juntado', 'juntada', 'juntados', 'juntadas'],
  ['requerido', 'requerida', 'requeridos', 'requeridas'],
  ['ilícito', 'ilícita', 'ilícitos', 'ilícitas'],
  ['nulo', 'nula', 'nulos', 'nulas'],
  ['válido', 'válida', 'válidos', 'válidas'],
  ['robusto', 'robusta', 'robustos', 'robustas'],
  ['suficiente', 'suficiente', 'suficientes', 'suficientes'],
  ['noturno', 'noturna', 'noturnos', 'noturnas'],
  ['insalubre', 'insalubre', 'insalubres', 'insalubres'],
  ['perigoso', 'perigosa', 'perigosos', 'perigosas'],
];

const ADJECTIVES = new Map<string, AdjectiveForm>();
for (const forms of ADJECTIVE_SETS) {
  const [msg, fsg, mpl, fpl] = forms;
  const entries: Array<[string, Gender | 'both', Numberness]> = [
    [msg, msg === fsg ? 'both' : 'm', 'sg'],
    [fsg, msg === fsg ? 'both' : 'f', 'sg'],
    [mpl, mpl === fpl ? 'both' : 'm', 'pl'],
    [fpl, mpl === fpl ? 'both' : 'f', 'pl'],
  ];
  for (const [word, gender, number] of entries) {
    if (ADJECTIVES.has(word)) continue;
    ADJECTIVES.set(word, { gender, number, forms });
  }
}

const adjectiveForm = (adj: AdjectiveForm, gender: Gender, number: Numberness): string =>
  adj.forms[(gender === 'm' ? 0 : 1) + (number === 'pl' ? 2 : 0)];

/** Verbos frequentes em petição: 3ª pessoa singular → plural. */
const VERB_SG_TO_PL: Record<string, string> = {
  é: 'são', foi: 'foram', era: 'eram', será: 'serão', seja: 'sejam',
  está: 'estão', esteve: 'estiveram', estava: 'estavam',
  tem: 'têm', teve: 'tiveram', tinha: 'tinham', terá: 'terão',
  vem: 'vêm', veio: 'vieram', vinha: 'vinham',
  faz: 'fazem', fez: 'fizeram', fazia: 'faziam',
  pode: 'podem', pôde: 'puderam', podia: 'podiam', poderá: 'poderão',
  deve: 'devem', devia: 'deviam', deverá: 'deverão',
  requer: 'requerem', requereu: 'requereram',
  apresenta: 'apresentam', apresentou: 'apresentaram',
  alega: 'alegam', alegou: 'alegaram',
  junta: 'juntam', juntou: 'juntaram',
  pede: 'pedem', pediu: 'pediram',
  comparece: 'comparecem', compareceu: 'compareceram',
  declara: 'declaram', declarou: 'declararam',
  informa: 'informam', informou: 'informaram',
  recebe: 'recebem', recebeu: 'receberam',
  trabalha: 'trabalham', trabalhou: 'trabalharam',
  possui: 'possuem', possuiu: 'possuíram',
  sofre: 'sofrem', sofreu: 'sofreram',
  assina: 'assinam', assinou: 'assinaram',
  ingressa: 'ingressam', ingressou: 'ingressaram',
  cumpre: 'cumprem', cumpriu: 'cumpriram',
  deixa: 'deixam', deixou: 'deixaram',
  realiza: 'realizam', realizou: 'realizaram',
  efetua: 'efetuam', efetuou: 'efetuaram',
  promove: 'promovem', promoveu: 'promoveram',
  sustenta: 'sustentam', sustentou: 'sustentaram',
  reconhece: 'reconhecem', reconheceu: 'reconheceram',
  demonstra: 'demonstram', demonstrou: 'demonstraram',
  comprova: 'comprovam', comprovou: 'comprovaram',
};

const VERB_PL_TO_SG: Record<string, string> = Object.entries(VERB_SG_TO_PL).reduce(
  (acc, [sg, pl]) => {
    if (!acc[pl]) acc[pl] = sg;
    return acc;
  },
  {} as Record<string, string>,
);

/** Advérbios que podem aparecer entre o sujeito e o verbo sem quebrar a análise. */
const INTERPOSED_ADVERBS = new Set([
  'não', 'nao', 'também', 'tambem', 'ainda', 'já', 'ja', 'sempre', 'apenas',
  'somente', 'nunca', 'jamais', 'realmente', 'efetivamente',
]);

interface Token {
  raw: string;
  lower: string;
  start: number;
  end: number;
}

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(text)) !== null) {
    tokens.push({
      raw: match[0],
      lower: lower(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
};

/** Só há relação sintática direta se entre os tokens houver apenas espaços. */
const onlySpacesBetween = (text: string, a: Token, b: Token): boolean =>
  /^[ \t ]*$/.test(text.slice(a.end, b.start));

const numberLabel = (n: Numberness) => (n === 'sg' ? 'singular' : 'plural');
const genderLabel = (g: Gender) => (g === 'm' ? 'masculino' : 'feminino');

const checkAgreement = (text: string): LegalRuleMatch[] => {
  const tokens = tokenize(text);
  const found: LegalRuleMatch[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    const det = DETERMINERS.get(token.lower);
    const noun = NOUNS.get(token.lower);

    // ── Determinante + substantivo ────────────────────────────────
    if (det && next && onlySpacesBetween(text, token, next)) {
      const nextNoun = NOUNS.get(next.lower);
      if (nextNoun) {
        const genderMismatch = det.gender !== nextNoun.gender;
        const numberMismatch = det.number !== nextNoun.number;

        if (genderMismatch || numberMismatch) {
          const suggestions: string[] = [];

          // 1) Ajusta o determinante ao substantivo.
          const fixedDet = determinerForm(det, nextNoun.gender, nextNoun.number);
          if (fixedDet) suggestions.push(`${matchCase(token.raw, fixedDet)} ${next.raw}`);

          // 2) Ajusta o substantivo ao determinante (par de gênero + número).
          const target =
            det.gender === nextNoun.gender
              ? nextNoun
              : nextNoun.counterpart
                ? { singular: nextNoun.counterpart.singular, plural: nextNoun.counterpart.plural }
                : null;
          if (target) {
            const fixedNoun = det.number === 'pl' ? target.plural : target.singular;
            if (fixedNoun && fixedNoun !== next.lower) {
              suggestions.push(`${token.raw} ${matchCase(next.raw, fixedNoun)}`);
            }
          }

          const problems = [
            genderMismatch ? 'gênero' : '',
            numberMismatch ? 'número' : '',
          ].filter(Boolean).join(' e ');

          found.push({
            ruleId: genderMismatch ? 'CONCORDANCIA_GENERO_ARTIGO' : 'CONCORDANCIA_NUMERO_ARTIGO',
            category: genderMismatch ? 'genero' : 'concordancia',
            severity: 'error',
            offset: token.start,
            length: next.end - token.start,
            bad: text.slice(token.start, next.end),
            suggestions: Array.from(new Set(suggestions)).slice(0, 3),
            message: `Falta concordância de ${problems} entre "${token.raw}" e "${next.raw}".`,
            explanation:
              `O determinante concorda em gênero e número com o substantivo. ` +
              `"${next.raw}" é ${genderLabel(nextNoun.gender)} ${numberLabel(nextNoun.number)}, ` +
              `mas "${token.raw}" é ${genderLabel(det.gender)} ${numberLabel(det.number)}.`,
          });
          continue;
        }

        // ── Sujeito + verbo (só com determinante não contraído) ────
        // "nos autos consta" não é sujeito: em contração o substantivo é
        // complemento, e checar concordância ali só geraria falso positivo.
        const previous = tokens[i - 1];
        const afterConjunction = previous && (previous.lower === 'e' || previous.lower === 'ou');
        if (!det.contracted && !afterConjunction) {
          let j = i + 2;
          if (tokens[j] && INTERPOSED_ADVERBS.has(tokens[j].lower) && onlySpacesBetween(text, tokens[j - 1], tokens[j])) {
            j += 1;
          }
          const verbToken = tokens[j];
          if (verbToken && onlySpacesBetween(text, tokens[j - 1], verbToken)) {
            const isPlural = nextNoun.number === 'pl';
            const wrong = isPlural ? VERB_SG_TO_PL[verbToken.lower] : VERB_PL_TO_SG[verbToken.lower];
            const verbIsSingular = !!VERB_SG_TO_PL[verbToken.lower];
            const verbIsPlural = !!VERB_PL_TO_SG[verbToken.lower];
            const mismatch = (isPlural && verbIsSingular) || (!isPlural && verbIsPlural);

            if (mismatch && wrong) {
              found.push({
                ruleId: 'CONCORDANCIA_VERBAL',
                category: 'concordancia',
                severity: 'error',
                offset: token.start,
                length: verbToken.end - token.start,
                bad: text.slice(token.start, verbToken.end),
                suggestions: [
                  text.slice(token.start, verbToken.start) + matchCase(verbToken.raw, wrong),
                ],
                message: `O verbo "${verbToken.raw}" não concorda com o sujeito "${next.raw}".`,
                explanation:
                  `O verbo concorda com o sujeito em número e pessoa. ` +
                  `"${next.raw}" está no ${numberLabel(nextNoun.number)}, então o verbo também deve ficar no ${numberLabel(nextNoun.number)}: "${wrong}".`,
              });
              continue;
            }
          }
        }
      }
    }

    // ── Substantivo + adjetivo ────────────────────────────────────
    if (noun && next && onlySpacesBetween(text, token, next)) {
      const adj = ADJECTIVES.get(next.lower);
      if (adj) {
        const genderMismatch = adj.gender !== 'both' && adj.gender !== noun.gender;
        const numberMismatch = adj.number !== noun.number;

        if (genderMismatch || numberMismatch) {
          const fixed = adjectiveForm(adj, noun.gender, noun.number);
          const problems = [
            genderMismatch ? 'gênero' : '',
            numberMismatch ? 'número' : '',
          ].filter(Boolean).join(' e ');

          found.push({
            ruleId: genderMismatch ? 'CONCORDANCIA_GENERO_ADJETIVO' : 'CONCORDANCIA_NUMERO_ADJETIVO',
            category: genderMismatch ? 'genero' : 'concordancia',
            severity: 'error',
            offset: token.start,
            length: next.end - token.start,
            bad: text.slice(token.start, next.end),
            suggestions: fixed && fixed !== next.lower
              ? [`${token.raw} ${matchCase(next.raw, fixed)}`]
              : [],
            message: `"${next.raw}" não concorda em ${problems} com "${token.raw}".`,
            explanation:
              `O adjetivo concorda com o substantivo que qualifica. ` +
              `"${token.raw}" é ${genderLabel(noun.gender)} ${numberLabel(noun.number)}, ` +
              `logo o correto é "${token.raw} ${fixed}".`,
          });
        }
      }
    }
  }

  return found;
};

/* ────────────────────────────────────────────────────────────────
 * API pública
 * ──────────────────────────────────────────────────────────────── */

/** Remove achados sobrepostos, mantendo o de maior severidade/abrangência. */
const dedupeOverlaps = (matches: LegalRuleMatch[]): LegalRuleMatch[] => {
  const weight: Record<LegalRuleSeverity, number> = { error: 3, warning: 2, suggestion: 1 };
  const sorted = [...matches].sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    if (weight[b.severity] !== weight[a.severity]) return weight[b.severity] - weight[a.severity];
    return b.length - a.length;
  });

  const kept: LegalRuleMatch[] = [];
  for (const match of sorted) {
    const overlaps = kept.some(
      (k) => match.offset < k.offset + k.length && k.offset < match.offset + match.length,
    );
    if (!overlaps) kept.push(match);
  }
  return kept;
};

/**
 * Roda todas as regras jurídicas próprias sobre um texto (um parágrafo, de
 * preferência) e devolve os achados ordenados por posição.
 */
export const checkLegalRules = (text: string): LegalRuleMatch[] => {
  const value = String(text || '');
  if (!value.trim()) return [];
  return dedupeOverlaps([...runPatternRules(value), ...checkAgreement(value)]);
};

/** Rótulo em português da categoria (usado no painel). */
export const legalRuleCategoryLabel = (category: LegalRuleCategory): string => {
  switch (category) {
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

/** Exposto para os testes e para o painel exibir a contagem de regras ativas. */
export const legalRuleCount = (): number => PATTERN_RULES.length;

export const __testing = { tokenize, matchCase };
