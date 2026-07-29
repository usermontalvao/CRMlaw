/**
 * Camada de texto do PDF — o que torna o arquivo pesquisável.
 *
 * A conversão desenha cada página como imagem (é o que garante fidelidade total
 * com o Word). Só imagem, porém, produz um PDF "cego": não dá para pesquisar,
 * copiar nem selecionar — o mesmo problema de um documento escaneado sem OCR.
 *
 * Aqui construímos a camada de texto: as MESMAS palavras, nas MESMAS posições,
 * escritas no PDF em modo invisível, por cima da imagem. O resultado é um PDF
 * que parece exatamente o Word e é 100% pesquisável — melhor que OCR, porque o
 * texto vem do documento e não de reconhecimento de imagem, ou seja, sem erro.
 *
 * Este módulo é a parte pura: recebe os "pedaços de texto" já medidos e calcula
 * como escrevê-los (fonte, largura, espaçamento). Quem extrai do layout do
 * Syncfusion é `syncfusionDocxToPdf.ts`.
 */

/** Um trecho de texto posicionado, em milímetros, com a linha de base em `y`. */
export type TextLayerRun = {
  text: string;
  xMm: number;
  /** Linha de base (não o topo) — é como PDF e canvas posicionam texto. */
  baselineMm: number;
  /** Largura que o trecho ocupa na página; usada para alinhar a seleção. */
  widthMm: number;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  /** Família aproximada: as 14 fontes padrão do PDF não incluem a original. */
  family: 'times' | 'helvetica' | 'courier';
};

/** Estilo pronto para o jsPDF. */
export type TextLayerStyle = {
  family: TextLayerRun['family'];
  style: 'normal' | 'bold' | 'italic' | 'bolditalic';
  fontSizePt: number;
};

/**
 * Mapeia a fonte do documento para uma das famílias padrão do PDF.
 *
 * A camada é invisível, então a aparência não muda nada — o que importa é o
 * texto extraível. Mesmo assim classificamos por tipo (serifada, sem serifa,
 * monoespaçada) para o espaçamento da seleção ficar próximo do desenho.
 */
export function mapFontFamily(fontFamily: string | null | undefined): TextLayerRun['family'] {
  const name = String(fontFamily || '').toLowerCase();
  if (!name) return 'times';
  if (/courier|consolas|monaco|mono/.test(name)) return 'courier';
  if (/times|serif|georgia|garamond|cambria|book|minion|palatino/.test(name)) return 'times';
  if (/arial|helvetica|calibri|verdana|tahoma|segoe|roboto|open sans|lato|sans/.test(name)) return 'helvetica';
  // Desconhecida: em petição, serifada é o palpite certo na esmagadora maioria.
  return 'times';
}

/** Nome de estilo do jsPDF a partir de negrito/itálico. */
export function fontStyleName(bold: boolean, italic: boolean): TextLayerStyle['style'] {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/**
 * Espaçamento extra por caractere para o trecho ocupar exatamente `targetWidth`.
 *
 * A fonte da camada invisível não é a do documento, então a largura natural do
 * texto difere. Distribuir a diferença entre os caracteres faz a seleção do
 * leitor de PDF cair sobre as palavras certas, em vez de ficar deslocada ao
 * longo da linha.
 *
 * Devolve 0 quando não há como ou não vale ajustar (texto de 1 caractere,
 * medida inválida, ou diferença absurda que indicaria medida errada).
 */
export function charSpaceFor(
  targetWidthMm: number,
  naturalWidthMm: number,
  characterCount: number,
): number {
  if (!(targetWidthMm > 0) || !(naturalWidthMm > 0)) return 0;
  if (characterCount < 2) return 0;
  const ratio = targetWidthMm / naturalWidthMm;
  // Fora desta faixa, alguma das medidas está errada: melhor não distorcer.
  if (ratio < 0.25 || ratio > 4) return 0;
  const gaps = characterCount - 1;
  return (targetWidthMm - naturalWidthMm) / gaps;
}

/**
 * Limpa o texto para a camada.
 *
 * Tabulação e quebra de linha viriam de elementos próprios do layout, então
 * dentro de um trecho elas só atrapalham a extração. Espaços não separáveis
 * viram espaço comum para a busca do leitor de PDF encontrar a palavra.
 */
export function normalizeRunText(text: string): string {
  return String(text ?? '')
    .replace(/[\r\n\t\v\f]+/g, ' ')
    .replace(/ /g, ' ');
}

/** `true` quando o trecho não contribui nada para a busca. */
export function isEmptyRun(text: string): boolean {
  return normalizeRunText(text).trim().length === 0;
}

/**
 * Junta trechos vizinhos da mesma linha e mesmo estilo.
 *
 * O Syncfusion quebra o parágrafo em muitos elementos (um por mudança de
 * formatação, revisão, campo). Escrever cada um separadamente polui o PDF e, o
 * que é pior, faz o leitor tratar "Trabalhista" partido em dois como duas
 * palavras — a busca por "Trabalhista" falharia. Aqui eles voltam a ser um só
 * quando estão realmente colados.
 *
 * `toleranceMm` é a folga aceita entre o fim de um trecho e o começo do
 * próximo; acima dela há um espaço de verdade e os trechos ficam separados.
 */
/**
 * O mínimo que este módulo precisa de um documento PDF para escrever a camada.
 *
 * É um tipo ESTRUTURAL de propósito: sem importar o jsPDF, este arquivo continua
 * puro — roda no `npm test` sem carregar biblioteca de PDF e aceita um dublê nos
 * testes. O jsPDF real satisfaz esta forma.
 */
export type PdfTextTarget = {
  setFont(family: string, style: string): unknown;
  setFontSize(size: number): unknown;
  getTextWidth(text: string): number;
  text(text: string, x: number, y: number, options?: Record<string, unknown>): unknown;
};

/**
 * Escreve os trechos no PDF em modo INVISÍVEL, por cima da imagem da página.
 *
 * Invisível porque a aparência já vem da imagem: a camada existe só para
 * pesquisa, seleção e cópia. Devolve quantos trechos entraram — 0 significa PDF
 * não pesquisável, e quem chama deve saber disso.
 *
 * Um trecho que falhe (caractere fora da codificação da fonte padrão) é pulado:
 * perder uma palavra na busca é muito melhor que perder a conversão inteira.
 */
export function writeTextLayer(pdf: PdfTextTarget, runs: TextLayerRun[]): number {
  let written = 0;
  for (const run of runs) {
    try {
      pdf.setFont(run.family, fontStyleName(run.bold, run.italic));
      pdf.setFontSize(run.fontSizePt);
      const naturalWidthMm = pdf.getTextWidth(run.text);
      pdf.text(run.text, run.xMm, run.baselineMm, {
        renderingMode: 'invisible',
        baseline: 'alphabetic',
        charSpace: charSpaceFor(run.widthMm, naturalWidthMm, run.text.length),
      });
      written += 1;
    } catch {
      // Ver comentário acima: um trecho não derruba o documento.
    }
  }
  return written;
}

export function mergeAdjacentRuns(runs: TextLayerRun[], toleranceMm = 0.35): TextLayerRun[] {
  const merged: TextLayerRun[] = [];

  for (const run of runs) {
    const previous = merged[merged.length - 1];
    const sameLine = previous && Math.abs(previous.baselineMm - run.baselineMm) < 0.2;
    const sameStyle = previous
      && previous.fontSizePt === run.fontSizePt
      && previous.bold === run.bold
      && previous.italic === run.italic
      && previous.family === run.family;
    const touching = previous
      && Math.abs((previous.xMm + previous.widthMm) - run.xMm) <= toleranceMm;

    if (previous && sameLine && sameStyle && touching) {
      previous.text += run.text;
      previous.widthMm = (run.xMm + run.widthMm) - previous.xMm;
      continue;
    }
    merged.push({ ...run });
  }

  return merged;
}
