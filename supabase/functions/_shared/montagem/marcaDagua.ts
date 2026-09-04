/**
 * A marca d'água diagonal "ASSINADO ELETRONICAMENTE" das páginas de conteúdo.
 *
 * Porte de `drawElectronicWatermark` (`pdfSignature.service.ts`).
 *
 * A conta da ÂNCORA é o que este módulo existe para preservar. O `rotate` do
 * pdf-lib gira o texto em torno do ponto (x, y) de ancoragem, NÃO do centro
 * dele. Centralizar como se não houvesse rotação — que era o que o código fazia
 * antes — deixava a marca 44 pt à esquerda e 109 pt ACIMA do centro numa A4:
 * ela subia por cima do cabeçalho do documento. Aqui a âncora é calculada de
 * trás para frente, a partir de onde o centro visual do texto deve cair.
 *
 * A aritmética está separada do desenho porque é ela que erra, e erro de
 * âncora só aparece olhando a folha pronta.
 */

export type FonteQueMede = { widthOfTextAtSize: (texto: string, tamanho: number) => number };
export type PaginaPdf = any;

export const TEXTO_DA_MARCA = 'ASSINADO ELETRONICAMENTE';

/** A inclinação, em graus. Sobe da esquerda para a direita. */
export const ANGULO_DA_MARCA = 32;

/** Tamanho de corpo pretendido, antes de caber na folha. */
export const CORPO_PRETENDIDO = 32;

/** Piso do corpo: abaixo disto a marca deixa de ser legível e vira sujeira. */
export const CORPO_MINIMO = 12;

/**
 * Fração da largura da página que a marca pode ocupar.
 *
 * Com 1 ela encostaria nas duas margens; 0,86 deixa a respiração que o desenho
 * do cliente tem.
 */
export const FRACAO_DA_LARGURA = 0.86;

/**
 * Onde escrever a marca, e de que tamanho.
 *
 * Devolve já a âncora do `drawText` — quem desenha não recalcula nada.
 */
export function geometriaDaMarcaDagua(params: {
  larguraDaPagina: number;
  alturaDaPagina: number;
  fonte: FonteQueMede;
  texto?: string;
}): { x: number; y: number; tamanho: number; angulo: number } {
  const { larguraDaPagina, alturaDaPagina, fonte } = params;
  const texto = params.texto ?? TEXTO_DA_MARCA;

  const rad = (ANGULO_DA_MARCA * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sen = Math.sin(rad);

  // A largura OCUPADA por um texto inclinado não é a largura dele: a caixa
  // girada soma `largura·cos + altura·sen`. Sem esta conta, uma página estreita
  // (paisagem recortada, meia-folha) estouraria com o corpo fixo de 32.
  const larguraOcupada = (corpo: number) =>
    fonte.widthOfTextAtSize(texto, corpo) * cos + corpo * 0.72 * sen;

  let tamanho = CORPO_PRETENDIDO;
  const limite = larguraDaPagina * FRACAO_DA_LARGURA;
  if (larguraOcupada(tamanho) > limite) {
    tamanho = Math.max(CORPO_MINIMO, Math.floor((tamanho * limite) / larguraOcupada(tamanho)));
  }

  const larguraDoTexto = fonte.widthOfTextAtSize(texto, tamanho);
  const alturaDoTexto = tamanho * 0.72; // altura aproximada da caixa alta

  return {
    x: larguraDaPagina / 2 - (larguraDoTexto / 2) * cos + (alturaDoTexto / 2) * sen,
    y: alturaDaPagina / 2 - (larguraDoTexto / 2) * sen - (alturaDoTexto / 2) * cos,
    tamanho,
    angulo: ANGULO_DA_MARCA,
  };
}

/** Desenha a marca d'água na página. */
export function desenharMarcaDagua(params: {
  pagina: PaginaPdf;
  larguraDaPagina: number;
  alturaDaPagina: number;
  fonte: FonteQueMede;
  ferramentas: {
    rgb: (r: number, g: number, b: number) => unknown;
    degrees: (graus: number) => unknown;
  };
}): void {
  const { pagina, larguraDaPagina, alturaDaPagina, fonte, ferramentas } = params;
  const g = geometriaDaMarcaDagua({ larguraDaPagina, alturaDaPagina, fonte });

  pagina.drawText(TEXTO_DA_MARCA, {
    x: g.x,
    y: g.y,
    size: g.tamanho,
    font: fonte,
    color: ferramentas.rgb(0.84, 0.87, 0.91),
    opacity: 0.16,
    rotate: ferramentas.degrees(g.angulo),
  });
}
