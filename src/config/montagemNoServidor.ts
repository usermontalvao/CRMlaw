/**
 * O INTERRUPTOR DA MONTAGEM NO SERVIDOR.
 *
 * A migração de `docs/assinatura-montagem-no-servidor.md` troca quem desenha o
 * PDF assinado: sai o aparelho de quem assina, entra a Edge Function
 * `montar-documento-assinado`. O fluxo antigo continua inteiro no código — este
 * módulo só decide qual dos dois é TENTADO primeiro.
 *
 * POR QUE UM INTERRUPTOR, E NÃO A TROCA DIRETA: o artefato produzido vale como
 * prova. Uma regressão aqui não aparece como tela quebrada; aparece como um
 * documento assinado que já foi arquivado e está errado. Um interruptor permite
 * ligar num envelope de teste, comparar com a bancada, e só então ligar para
 * todo mundo — sem que nenhum passo dependa de um `git revert` às pressas.
 *
 * A DIREÇÃO É ÚNICA, e isso é regra: o que está escrito aqui só LIGA a montagem
 * no servidor. Não existe forma de DESLIGÁVEL por link ou por
 * `localStorage`. O caminho do servidor é o mais rigoroso dos dois — é ele que
 * calcula o SHA-256 sobre os bytes que o próprio servidor leu — e dar a quem
 * abre o link o poder de escolher o caminho mais frouxo devolveria, por outra
 * porta, exatamente o que a migração existe para tirar do navegador.
 *
 * Os três degraus, do mais específico ao mais geral:
 *
 *   1. `?montagem=servidor` na URL — liga NESTA aba, para o teste ponta a ponta
 *      com o build que já está publicado. Sem rebuild, sem deploy;
 *   2. `localStorage.montagemNoServidor = 'servidor'` — liga NESTE aparelho,
 *      para não ter de repetir o parâmetro a cada abertura durante a validação;
 *   3. `VITE_MONTAGEM_NO_SERVIDOR=false` no build — rollback operacional.
 *      Depois da validação de produção, ausência da variável significa servidor.
 *
 * O padrão agora é LIGADO: a fila durável já foi validada em produção. O
 * valor explícito `false` existe apenas para rollback de emergência.
 */

/** O valor que liga. Qualquer outra coisa (inclusive ausência) deixa desligado. */
const VALOR_QUE_LIGA = 'servidor';

/** A chave, a mesma na URL e no `localStorage`. */
export const CHAVE_DA_MONTAGEM = 'montagem';

/** A chave no `localStorage` — prefixada, porque lá o espaço é compartilhado. */
export const CHAVE_NO_ARMAZENAMENTO = 'montagemNoServidor';

export type FontesDoInterruptor = {
  /** A query string da aba, com ou sem `?`. */
  busca?: string | null;
  /** O fragmento (`#/assinar/abc?montagem=servidor`), com ou sem `#`. */
  hash?: string | null;
  /** O valor guardado no aparelho. */
  armazenado?: string | null;
  /** O padrão assado no build (`import.meta.env.VITE_MONTAGEM_NO_SERVIDOR`). */
  doBuild?: string | null;
};

/**
 * Lê o parâmetro nas DUAS metades da URL.
 *
 * A página pública de assinatura vive atrás de um hash router
 * (`/#/assinar/<token>`), então um `?montagem=servidor` colado no fim do link
 * cai DENTRO do fragmento e nunca chega em `location.search`. Ler só a busca
 * faria o interruptor não responder justamente no link que ele existe para
 * testar — e o sintoma seria "liguei e não mudou nada", que se confunde com a
 * montagem no servidor ter falhado em silêncio.
 */
export function lerParametro(busca?: string | null, hash?: string | null): string | null {
  for (const bruto of [busca, hash]) {
    const texto = String(bruto ?? '');
    if (!texto) continue;
    // Do hash interessa só o que vem depois do primeiro `?`.
    const consulta = texto.startsWith('#') || texto.includes('#')
      ? texto.slice(texto.indexOf('?') + 1)
      : texto.replace(/^\?/, '');
    if (!consulta || !consulta.includes('=')) continue;
    for (const par of consulta.split('&')) {
      const [chave, valor = ''] = par.split('=');
      if (decodeURIComponent(chave.trim()) === CHAVE_DA_MONTAGEM) {
        return decodeURIComponent(valor.trim()).toLowerCase();
      }
    }
  }
  return null;
}

/** Onde a decisão veio de — vai para o log, para o teste dizer o que exercitou. */
export type OrigemDaDecisao = 'url' | 'aparelho' | 'build' | 'padrao';

export type Decisao = { noServidor: boolean; origem: OrigemDaDecisao };

/**
 * A decisão, pura. O `montarNoServidor()` abaixo é só ela ligada no navegador.
 */
export function decidirMontagem(fontes: FontesDoInterruptor): Decisao {
  const naUrl = lerParametro(fontes.busca, fontes.hash);
  if (naUrl === VALOR_QUE_LIGA) return { noServidor: true, origem: 'url' };

  if (String(fontes.armazenado ?? '').trim().toLowerCase() === VALOR_QUE_LIGA) {
    return { noServidor: true, origem: 'aparelho' };
  }

  // O build fala `true`/`false`, que é a convenção do `VITE_PORTAL_SCANNER_AI`.
  // `false` é a única forma de rollback global; ausência fecha a migração.
  const valorDoBuild = String(fontes.doBuild ?? '').trim().toLowerCase();
  if (valorDoBuild === 'false') {
    return { noServidor: false, origem: 'build' };
  }
  if (valorDoBuild === 'true') {
    return { noServidor: true, origem: 'build' };
  }

  return { noServidor: true, origem: 'padrao' };
}

/**
 * O valor assado no build.
 *
 * A FORMA IMPORTA, e custou uma rodada de teste para descobrir: o Vite
 * substitui `import.meta.env.VITE_X` **textualmente**, e a substituição só casa
 * o acesso DIRETO. Escrito com optional chaining e cast — que é o que estava
 * aqui — o texto não bate, a substituição não acontece, e a variável some.
 * Conferido em 04/09/2026 no que o próprio dev server servia: o módulo chegava
 * ao navegador com o acesso intacto, sem valor nenhum no lugar.
 *
 * O `try` existe porque este módulo também é importado pelos testes em Node,
 * onde `import.meta.env` não existe e o acesso estoura.
 */
function valorDoBuild(): string | null {
  try {
    return (import.meta.env.VITE_MONTAGEM_NO_SERVIDOR as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * A decisão no navegador de verdade.
 *
 * Tudo em `try`: `localStorage` estoura sozinho em aba anônima e em navegador
 * com dados de site bloqueados (ver a regra do projeto sobre isso). Um
 * interruptor que derruba a página de assinatura ao ser lido seria pior do que
 * não existir.
 */
export function montarNoServidor(): Decisao {
  let armazenado: string | null = null;
  try {
    armazenado = typeof localStorage !== 'undefined'
      ? localStorage.getItem(CHAVE_NO_ARMAZENAMENTO)
      : null;
  } catch { armazenado = null; }

  let busca: string | null = null;
  let hash: string | null = null;
  try {
    busca = typeof location !== 'undefined' ? location.search : null;
    hash = typeof location !== 'undefined' ? location.hash : null;
  } catch { /* noop */ }

  return decidirMontagem({
    busca,
    hash,
    armazenado,
    doBuild: valorDoBuild(),
  });
}

/**
 * O RETRATO do que o interruptor leu — para o log, não para a decisão.
 *
 * "Liguei e continua desligado" tem três causas que se parecem na tela e não se
 * distinguem sem isto: o parâmetro não chegou na URL; o `localStorage` foi
 * gravado em OUTRA ORIGEM (ele é por origem — a aba do CRM e o link de
 * assinatura abertos em portas diferentes não compartilham nada); ou o valor
 * está lá mas escrito errado. O retrato mostra as três de uma vez.
 */
export function retratoDoInterruptor(): string {
  let armazenado: string | null = null;
  try {
    armazenado = typeof localStorage !== 'undefined'
      ? localStorage.getItem(CHAVE_NO_ARMAZENAMENTO)
      : null;
  } catch { armazenado = '«bloqueado»'; }

  const naUrl = (() => {
    try { return lerParametro(location.search, location.hash); } catch { return null; }
  })();
  const origem = (() => {
    try { return location.origin; } catch { return '?'; }
  })();

  return `url=${naUrl ?? '«ausente»'} aparelho=${armazenado ?? '«ausente»'} `
    + `build=${valorDoBuild() ?? '«ausente»'} `
    + `origem-do-navegador=${origem}`;
}
