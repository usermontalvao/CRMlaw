/**
 * Identificação de cliente e processo a partir do texto de uma intimação.
 *
 * A vinculação existia em dois lugares com regras diferentes: a rotina da tela
 * casava processo E cliente, e a do cron — que é quem roda todo dia — casava só
 * processo. Sem o processo cadastrado, a intimação entrava sem nada, mesmo com o
 * cliente cadastrado e o nome dele escrito no texto. O operador vinculava à mão,
 * todo dia, para sempre.
 *
 * Aqui a regra fica num lugar só. Sem imports: o módulo é puro para o ts-node do
 * `npm test` carregá-lo sem arrastar a cadeia de imports do serviço.
 *
 * ATENÇÃO: `supabase/functions/run-djen-sync/index.ts` espelha estas mesmas
 * regras (o Deno não enxerga `src/`). Mexeu aqui, mexa lá.
 */

/**
 * Rótulos de parte que aparecem no cabeçalho das publicações.
 *
 * RECLAMANTE/RECLAMADO estavam de fora, e é o vocabulário da Justiça do
 * Trabalho — que é praticamente todo o volume deste escritório (TRT23). Das 58
 * intimações órfãs, 19 diziam "RECLAMANTE:" e só 6 usavam algum dos rótulos que
 * a lista cobria. O extrator estava cego justamente para a maioria.
 */
const ROTULOS_DE_PARTE = [
  'RECLAMANTE',
  'RECLAMADO',
  'RECLAMADA',
  'REQUERENTE',
  'REQUERIDO',
  'REQUERIDA',
  'AUTOR',
  'AUTORA',
  'R[EÉ]U',
  'R[EÉ]',
  'EXEQUENTE',
  'EXECUTADO',
  'EXECUTADA',
  'IMPETRANTE',
  'IMPETRADO',
  'AGRAVANTE',
  'AGRAVADO',
  'RECORRENTE',
  'RECORRIDO',
  'EMBARGANTE',
  'EMBARGADO',
];

/**
 * O nome vai do rótulo até o próximo separador de campo.
 *
 * O separador é espaço DUPLO, não quebra de linha: o texto que o DJEN entrega
 * não tem `\n` nenhum — a publicação inteira vem numa linha só, com os campos
 * separados por dois espaços. A versão anterior parava em `[^\n;\r]+`, ou seja,
 * capturava o documento inteiro como se fosse o nome da parte, e aí nenhum
 * cliente casava. Era esse o motivo real de as intimações chegarem sem cliente,
 * mesmo com o cliente cadastrado — e por isso a rotina da tela também errava.
 *
 * A captura é preguiçosa e para no primeiro de: dois espaços, quebra de linha,
 * ponto e vírgula ou fim do texto.
 */
const PADRAO_PARTE = new RegExp(
  `(?:${ROTULOS_DE_PARTE.join('|')})\\s*[:\\-]\\s*([^\\n;\\r]+?)(?=\\s{2,}|[\\n;\\r]|$)`,
  'gi',
);

/** Nome de parte mais longo que isto é captura errada, não nome. */
const TAMANHO_MAXIMO_NOME = 120;

const PADRAO_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;

/** Nome comparável: sem acento, caixa alta, espaços colapsados. */
export function normalizarNome(valor?: string | null): string {
  if (!valor) return '';
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só os dígitos — é assim que dois números de processo se comparam. */
export function normalizarNumeroProcesso(valor?: string | null): string {
  return valor ? valor.replace(/\D/g, '') : '';
}

export function extrairNumeroCnj(texto?: string | null): string | null {
  const match = PADRAO_CNJ.exec(texto || '');
  return match ? match[0] : null;
}

/**
 * Nomes de parte citados no texto, na ordem em que aparecem.
 *
 * Corta em "E OUTROS (2)" e afins: esse sufixo do PJe vira parte do nome e
 * impede o casamento exato com o cadastro do cliente.
 */
export function extrairNomesDePartes(texto?: string | null): string[] {
  if (!texto) return [];

  const nomes: string[] = [];
  const padrao = new RegExp(PADRAO_PARTE.source, PADRAO_PARTE.flags);
  let match: RegExpExecArray | null;

  while ((match = padrao.exec(texto)) !== null) {
    const bruto = (match[1] || '')
      .replace(/\s+/g, ' ')
      // "E OUTROS (1)" antes de separar: depois do split viraria uma "parte"
      // chamada OUTROS, que casaria com qualquer coisa.
      .replace(/\s+E\s+OUTROS?\s*\(\d+\)\s*$/i, '')
      .trim();
    if (!bruto) continue;

    bruto
      .split(/\s+(?:E|E\/OU)\s+|\s*[,;]\s*/i)
      .map((parte) => parte.trim())
      .filter(
        (parte) =>
          parte.length >= 5 &&
          parte.length <= TAMANHO_MAXIMO_NOME &&
          !/^OUTROS?\b/i.test(parte),
      )
      .forEach((parte) => nomes.push(parte));
  }

  return Array.from(new Set(nomes)).slice(0, 10);
}

export interface ClienteParaCasar {
  id: string;
  full_name?: string | null;
}

/**
 * Primeiro cliente cujo nome bate com algum dos nomes citados.
 *
 * Exato primeiro, em todos os nomes, antes de tentar conter: um nome curto que
 * é subsequência de dois clientes diferentes não pode ganhar de um nome que
 * casa inteiro com um deles. E só aceita "conter" a partir de 10 caracteres —
 * abaixo disso o risco de pegar homônimo parcial supera o ganho.
 */
export function casarCliente(
  nomes: readonly string[],
  clientes: readonly ClienteParaCasar[],
): string | null {
  const normalizados = nomes.map(normalizarNome).filter(Boolean);
  if (normalizados.length === 0) return null;

  const porNome = new Map<string, string>();
  for (const cliente of clientes) {
    const nome = normalizarNome(cliente.full_name);
    if (nome && !porNome.has(nome)) porNome.set(nome, cliente.id);
  }

  for (const nome of normalizados) {
    const exato = porNome.get(nome);
    if (exato) return exato;
  }

  for (const nome of normalizados) {
    if (nome.length < 10) continue;
    for (const [nomeCliente, id] of porNome) {
      if (nomeCliente.includes(nome) || nome.includes(nomeCliente)) return id;
    }
  }

  return null;
}

export interface ProcessoParaCasar {
  id: string;
  client_id?: string | null;
  process_code?: string | null;
}

/** Processo cadastrado com o mesmo número, comparando só os dígitos. */
export function casarProcesso(
  numeroProcesso: string | null | undefined,
  processos: readonly ProcessoParaCasar[],
): { processId: string; clientId: string | null } | null {
  const numero = normalizarNumeroProcesso(numeroProcesso);
  if (!numero) return null;

  for (const processo of processos) {
    if (normalizarNumeroProcesso(processo.process_code) === numero) {
      return { processId: processo.id, clientId: processo.client_id ?? null };
    }
  }

  return null;
}

export interface VinculoResolvido {
  process_id: string | null;
  client_id: string | null;
}

/**
 * Vínculo de uma intimação: processo pelo número; cliente pelo processo e, não
 * havendo processo cadastrado, pelos nomes das partes (destinatários do DJEN
 * primeiro, depois os citados no texto).
 *
 * É esta segunda perna que faltava no cron — e é ela que resolve o caso comum
 * do escritório, em que o cliente está cadastrado e o processo não.
 */
export function resolverVinculoDaIntimacao(
  intimacao: {
    numero_processo?: string | null;
    texto?: string | null;
    destinatarios?: readonly (string | null | undefined)[];
  },
  cadastro: { processos: readonly ProcessoParaCasar[]; clientes: readonly ClienteParaCasar[] },
): VinculoResolvido {
  const numero = intimacao.numero_processo || extrairNumeroCnj(intimacao.texto);
  const porProcesso = casarProcesso(numero, cadastro.processos);

  if (porProcesso?.clientId) {
    return { process_id: porProcesso.processId, client_id: porProcesso.clientId };
  }

  const nomes = [
    ...(intimacao.destinatarios ?? []).filter((n): n is string => !!n),
    ...extrairNomesDePartes(intimacao.texto),
  ];

  return {
    process_id: porProcesso?.processId ?? null,
    client_id: casarCliente(nomes, cadastro.clientes),
  };
}
