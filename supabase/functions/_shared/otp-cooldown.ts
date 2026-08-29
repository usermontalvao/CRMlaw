/**
 * A ESPERA ENTRE UM CÓDIGO E O PRÓXIMO — e por que ela cresce.
 *
 * Antes a regra era um minuto fixo, para sempre. Um minuto é o tempo certo para
 * a PRIMEIRA repetição: o SMS atrasou, a pessoa não viu a notificação, ela
 * clica de novo e recebe. A partir da terceira ou quarta vez a história é
 * outra — ou o número está errado (e mandar mais códigos não vai consertar), ou
 * alguém está usando o formulário público para fazer o escritório disparar
 * mensagem atrás de mensagem para um telefone alheio. Espera fixa cobra o mesmo
 * dos dois casos: barato demais para o segundo, e sem diferença para o primeiro.
 *
 * A escada resolve os dois com o mesmo número: quem errou o dígito e corrigiu
 * quase não sente, e quem insiste passa a esperar minutos entre os pedidos.
 *
 * A janela de contagem é de uma hora. Passada ela, a escada zera sozinha — a
 * pessoa que voltou no dia seguinte não herda o castigo da véspera.
 *
 * Sem imports de propósito: módulo puro, para o `node --test` carregá-lo sem
 * arrastar a cadeia do cliente do Supabase (ver as notas sobre ts-node).
 */

/** Quanto esperar depois do 1º, 2º, 3º e 4º-em-diante pedido. */
export const ESCADA_DE_ESPERA_SEGUNDOS = [60, 120, 300, 600] as const;

/** Quanto tempo para trás a escada enxerga. Fora dela, começa do zero. */
export const JANELA_DA_ESCADA_MS = 60 * 60 * 1000;

/**
 * A espera exigida depois de `enviadosNaJanela` códigos já terem saído.
 *
 * Zero envios = nenhuma espera (é o primeiro código). Do quarto em diante o
 * valor não cresce mais: dez minutos já separam o engano da insistência, e
 * subir além disso só puniria quem voltou muito depois.
 */
export function esperaEntrePedidos(enviadosNaJanela: number): number {
  if (enviadosNaJanela <= 0) return 0;
  const indice = Math.min(enviadosNaJanela, ESCADA_DE_ESPERA_SEGUNDOS.length) - 1;
  return ESCADA_DE_ESPERA_SEGUNDOS[indice];
}

/**
 * Quantos segundos ainda faltam para o próximo pedido ser aceito.
 *
 * Devolve 0 quando já pode pedir. Data inválida também devolve 0: um carimbo
 * ilegível no banco não pode trancar o cliente fora do próprio documento.
 */
export function segundosParaOProximoPedido(params: {
  ultimoEnvioIso: string | null | undefined;
  enviadosNaJanela: number;
  agoraMs: number;
}): number {
  const { ultimoEnvioIso, enviadosNaJanela, agoraMs } = params;
  if (!ultimoEnvioIso) return 0;
  const espera = esperaEntrePedidos(enviadosNaJanela);
  if (espera <= 0) return 0;
  const ultimo = new Date(ultimoEnvioIso).getTime();
  if (Number.isNaN(ultimo)) return 0;
  const decorridos = Math.floor((agoraMs - ultimo) / 1000);
  return Math.max(0, espera - decorridos);
}

/** Texto do aviso, com minutos quando a espera passa de um minuto. */
export function textoDaEspera(segundos: number): string {
  if (segundos <= 60) {
    return `Aguarde ${Math.max(1, segundos)} segundos antes de pedir outro código.`;
  }
  const minutos = Math.ceil(segundos / 60);
  return `Você já pediu vários códigos seguidos. Aguarde ${minutos} minutos antes de pedir outro.`;
}
