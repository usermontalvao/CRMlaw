/**
 * Quebra de listas de identificadores em lotes para consultas `in.(...)`.
 *
 * O PostgREST recebe o filtro pela URL, e a URL tem teto — no servidor, não no
 * cliente. Um `in.(...)` com 837 UUIDs passa de 32 kB e volta 400 antes de o
 * banco sequer ver a consulta. O erro não diz isso: diz só "Bad Request", e a
 * tela fica sem dado sem ninguém entender por quê.
 *
 * Sem imports: o módulo é puro de propósito, para o ts-node do `npm test`
 * carregá-lo sem arrastar a cadeia de imports do serviço.
 */

/**
 * Teto por lote.
 *
 * Cada UUID ocupa 36 caracteres, mais 3 do separador já codificado (`%2C`):
 * ~39 caracteres. Com 150 por lote dá cerca de 5,9 kB de filtro, que cabe com
 * folga no limite usual de 8 kB mesmo somando esquema, cabeçalhos e o resto da
 * URL. É folga de propósito: o custo de um lote a mais é um round-trip, e o
 * custo de errar para cima é a tela vazia de novo.
 */
export const TAMANHO_LOTE_IN = 150;

/**
 * Divide em lotes de no máximo `tamanho`. Lista vazia devolve nenhum lote —
 * assim quem chama não dispara consulta à toa.
 */
export function dividirEmLotes<T>(itens: readonly T[], tamanho: number = TAMANHO_LOTE_IN): T[][] {
  const limite = Math.max(1, Math.floor(tamanho));
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += limite) {
    lotes.push(itens.slice(i, i + limite));
  }
  return lotes;
}
