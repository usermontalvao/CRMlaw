/**
 * O FUNDO BRANCO DA ASSINATURA, SEM CANVAS.
 *
 * A assinatura chega como PNG. Quando ela vem de foto ou de digitalização, o
 * traço está sobre papel branco — e colar isso no documento deixa um retângulo
 * branco por cima do texto. Hoje quem apaga esse fundo é o canvas do navegador
 * (`removeWhiteBackground`, em `pdfSignature.service.ts`), e é uma das poucas
 * coisas que ainda prendiam a montagem lá.
 *
 * A conta é sobre pixels e não precisa de navegador nenhum: o que falta no
 * servidor é só decodificar e recodificar o PNG, o que qualquer codec em JS
 * puro faz. Este módulo é a REGRA — recebe RGBA e devolve RGBA.
 *
 * A REGRA É COPIADA, NÃO MELHORADA, e isso é de propósito. O limiar 240 e o
 * "corta tudo ou nada" são exatamente os de hoje, inclusive o defeito conhecido
 * de deixar uma auréola clara em volta do traço (os pixels entre 200 e 240 não
 * são tocados). Trocar por um recorte melhor AGORA faria a bancada de
 * comparação acusar diferença em todo documento — e uma bancada que acusa
 * melhorias como defeito não serve para conferir um porte. Melhorar o recorte é
 * assunto de depois, com a montagem já no servidor e o antes/depois visível.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

export interface OpcoesDeRecorte {
  /**
   * Acima deste valor, nos três canais, o pixel é considerado fundo.
   * 240 é o valor que está em produção hoje.
   */
  limiar?: number;
}

export interface ResultadoDoRecorte {
  /** Quantos pixels viraram transparentes. */
  apagados: number;
  /** Quantos pixels a imagem tem. */
  total: number;
}

/**
 * Apaga o fundo branco, escrevendo no próprio vetor.
 *
 * Trabalha in-place porque uma assinatura de 1.200×400 são quase 2 MB de RGBA,
 * e copiar isso a cada documento de um kit é desperdício num ambiente com
 * memória contada como o da Edge Function.
 */
export function apagarFundoBranco(
  rgba: Uint8Array | Uint8ClampedArray,
  opcoes: OpcoesDeRecorte = {},
): ResultadoDoRecorte {
  const limiar = opcoes.limiar ?? 240;
  let apagados = 0;
  const total = Math.floor(rgba.length / 4);

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i] > limiar && rgba[i + 1] > limiar && rgba[i + 2] > limiar) {
      rgba[i + 3] = 0;
      apagados += 1;
    }
  }

  return { apagados, total };
}

/**
 * A assinatura sumiu inteira?
 *
 * O DEFEITO REAL QUE ISTO PEGA: uma assinatura clara demais, ou uma imagem que
 * já veio quase toda branca, é apagada por completo — e o documento sai
 * assinado com um retângulo vazio no lugar da assinatura. O código de hoje tem
 * um `catch` que devolve a imagem original quando o recorte "corrompeu", mas
 * nada olha o RESULTADO: apagar 100% dos pixels não lança erro nenhum.
 *
 * Quem chama deve preferir a imagem ORIGINAL quando isto devolver `true`. Um
 * fundo branco indesejado é feio; uma assinatura ausente é um documento sem
 * assinatura.
 */
export function recorteApagouDemais(
  resultado: ResultadoDoRecorte,
  proporcaoMinimaDeTinta = 0.005,
): boolean {
  if (resultado.total === 0) return true;
  const restante = (resultado.total - resultado.apagados) / resultado.total;
  return restante < proporcaoMinimaDeTinta;
}
