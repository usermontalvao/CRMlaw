/**
 * AS ÂNCORAS DE VOLTA — a cola entre o `pdf-lib` e a conta pura de
 * `ancoraNoPdf.ts`.
 *
 * POR QUE ISTO EXISTE SEPARADO DA BANCADA. A bancada
 * (`scripts/ancora-no-servidor.mts`) provou que a âncora sobrevive à conversão e
 * que a coordenada volta certa. Se a Edge Function tivesse a sua própria cópia
 * dessa leitura, a prova valeria para o código da bancada e não para o que roda
 * em produção — que é a forma mais silenciosa de um teste mentir.
 *
 * O que fica aqui é só o que precisa do `pdf-lib`: achar os XObjects de imagem
 * da página, descomprimir o fluxo de conteúdo e chamar `acharAncoras`. A conta
 * (matrizes, pilha de estado gráfico, inversão do eixo Y) continua em
 * `ancoraNoPdf.ts`, pura e com teste próprio.
 *
 * COMO A ÂNCORA É IDENTIFICADA no PDF: pela DIMENSÃO EM PIXELS da imagem. O
 * conversor batiza os XObjects como quiser (`/Im0`, `/Im1`), e o nome não diz
 * nada. Cada âncora é plantada com um PNG de altura única (4, 5, 6 px…), então
 * a altura É o número da âncora. Compartilhar um PNG entre elas faria todas
 * virarem o mesmo XObject, e aí a única pista seria a ordem dos `Do` — que
 * depende da ordem de desenho do conversor, e não é contrato de ninguém.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */
import { acharAncoras, caixaEmPorcentagem, type Caixa } from './ancoraNoPdf.ts';

/** A largura, em pixels, de todo PNG de âncora. Serve de assinatura. */
export const ANCORA_PNG_LARGURA = 7;
/** A altura do PNG da âncora número `n` (1-based). */
export const alturaDoPngDaAncora = (indice: number): number => 3 + indice;
/** O caminho inverso: de que âncora é um PNG de tal altura. */
export const ancoraDaAltura = (altura: number): number => altura - 3;

export type FerramentasDoPdf = {
  /** `PDFName` do pdf-lib. */
  PDFName: any;
  /** `PDFRawStream` do pdf-lib, para reconhecer um fluxo cru. */
  PDFRawStream: any;
  /** Descompressor de zlib — `FlateDecode` é zlib, não deflate cru. */
  inflar: (bytes: Uint8Array) => Uint8Array;
};

export type AncoraLocalizada = {
  /** 1-based, a mesma numeração de `alturaDoPngDaAncora`. */
  indiceDaAncora: number;
  /** 1-based. */
  pagina: number;
  caixaEmPontos: Caixa;
  larguraDaPagina: number;
  alturaDaPagina: number;
};

/**
 * Percorre as páginas e devolve onde cada âncora caiu.
 *
 * FALHA MACIA POR PÁGINA: uma página cujo fluxo não descomprime (filtro
 * inesperado, stream corrompido) é pulada, e as outras continuam. Derrubar o
 * congelamento inteiro por causa de uma página sem âncora nenhuma seria trocar
 * um campo faltando por um envelope travado.
 */
export function lerAncorasDoPdf(
  pdf: any,
  ferramentas: FerramentasDoPdf,
  quantasAncoras: number,
): AncoraLocalizada[] {
  const { PDFName, PDFRawStream, inflar } = ferramentas;
  const encontradas: AncoraLocalizada[] = [];
  if (quantasAncoras <= 0) return encontradas;

  const alturaMaxima = alturaDoPngDaAncora(quantasAncoras);
  const paginas = pdf.getPages();

  for (let p = 0; p < paginas.length; p++) {
    try {
      const pagina = paginas[p];
      const { width, height } = pagina.getSize();

      // Quais XObjects desta página são âncoras — pela dimensão, não pelo nome.
      const recursos = pagina.node.Resources?.();
      const xobjects = recursos?.lookup?.(PDFName.of('XObject'));
      if (!xobjects?.entries) continue;

      const alturaPorNome = new Map<string, number>();
      for (const [chave, ref] of xobjects.entries()) {
        const alvo = pdf.context.lookup(ref);
        if (!(alvo instanceof PDFRawStream)) continue;
        const dict = alvo.dict;
        if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
        const larg = Number(dict.get(PDFName.of('Width'))?.toString());
        const alt = Number(dict.get(PDFName.of('Height'))?.toString());
        if (larg !== ANCORA_PNG_LARGURA) continue;
        if (!(alt >= alturaDoPngDaAncora(1) && alt <= alturaMaxima)) continue;
        alturaPorNome.set(String(chave.asString?.() ?? chave).replace(/^\//, ''), alt);
      }
      if (alturaPorNome.size === 0) continue;

      const fluxo = fluxoDaPagina(pdf, pagina, PDFName, PDFRawStream, inflar);
      if (!fluxo) continue;

      for (const achado of acharAncoras(fluxo, new Set(alturaPorNome.keys()))) {
        encontradas.push({
          indiceDaAncora: ancoraDaAltura(alturaPorNome.get(achado.nome)!),
          pagina: p + 1,
          caixaEmPontos: achado.caixa,
          larguraDaPagina: width,
          alturaDaPagina: height,
        });
      }
    } catch {
      // ver a nota de falha macia acima
    }
  }

  return encontradas;
}

/**
 * O fluxo de conteúdo da página, já descomprimido e concatenado.
 *
 * `/Contents` pode ser UM stream ou um ARRAY deles, e o PDF manda tratar o
 * array como um fluxo só — inclusive com um operador partido entre dois
 * pedaços. Por isso a junção usa `\n`: colar sem separador poderia fundir o
 * fim de um token com o começo do próximo.
 *
 * `latin1` é obrigatório: o fluxo tem bytes binários (imagens inline, fontes), e
 * decodificar como UTF-8 substituiria bytes inválidos por U+FFFD, desalinhando
 * tudo que vem depois.
 */
function fluxoDaPagina(
  pdf: any, pagina: any, PDFName: any, PDFRawStream: any,
  inflar: (b: Uint8Array) => Uint8Array,
): string | null {
  const pedacos: Uint8Array[] = [];

  const juntar = (alvo: any) => {
    if (!(alvo instanceof PDFRawStream)) return;
    const cru: Uint8Array = alvo.contents;
    const filtro = alvo.dict.get(PDFName.of('Filter'))?.toString() ?? '';
    try {
      pedacos.push(filtro.includes('FlateDecode') ? inflar(cru) : cru);
    } catch { /* pedaço ilegível: os outros ainda valem */ }
  };

  const conteudo = pagina.node.Contents?.();
  if (conteudo?.asArray) {
    for (const ref of conteudo.asArray()) juntar(pdf.context.lookup(ref));
  } else {
    juntar(conteudo);
  }
  if (pedacos.length === 0) return null;

  const decodificador = new TextDecoder('latin1');
  return pedacos.map((b) => decodificador.decode(b)).join('\n');
}

/** A âncora localizada, já no formato de `signature_fields`. */
export function campoDaAncora(
  ancora: AncoraLocalizada,
  caixaDaAssinatura: (
    ponto: { x: number; y: number }, largura: number, altura: number,
  ) => Caixa,
): { page_number: number; x_percent: number; y_percent: number; w_percent: number; h_percent: number } | null {
  const caixa = caixaDaAssinatura(
    { x: ancora.caixaEmPontos.x, y: ancora.caixaEmPontos.y },
    ancora.larguraDaPagina, ancora.alturaDaPagina,
  );
  const pct = caixaEmPorcentagem(caixa, ancora.larguraDaPagina, ancora.alturaDaPagina);
  return pct ? { page_number: ancora.pagina, ...pct } : null;
}
