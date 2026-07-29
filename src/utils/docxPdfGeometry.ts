/**
 * Geometria da conversão DOCX -> PDF.
 *
 * O `docx-preview` renderiza cada página do Word como um `<section>` cujo
 * `style.width` / `style.minHeight` vêm do `sectPr` do próprio documento
 * (normalmente em pontos: "595.3pt x 841.9pt" para A4, mas também Carta,
 * Ofício, paisagem ou tamanhos personalizados). Quem converte precisa levar
 * ESSA medida para o PDF — forçar A4 retrato em tudo é o que amassava a
 * formatação (margens fora de escala, paisagem esmagada, linha cortada).
 *
 * Este módulo é a matemática pura desse processo: nada de DOM, nada de
 * bibliotecas. Fica testável (`docxPdfGeometry.test.ts`) e é consumido pelo
 * orquestrador `docxToPdf.ts`.
 */

export const MM_PER_INCH = 25.4;
/** CSS: 1in = 96px por definição. */
export const CSS_PX_PER_INCH = 96;
/** CSS: 1in = 72pt por definição. */
export const CSS_PT_PER_INCH = 72;

/** A4 retrato em milímetros — só usado quando o documento não declara nada. */
export const DEFAULT_PAGE_MM = { width: 210, height: 297 } as const;

export type PageOrientation = 'portrait' | 'landscape';

export type PageGeometry = {
  /** Largura da página do PDF, em mm. */
  widthMm: number;
  /** Altura da página do PDF, em mm. */
  heightMm: number;
  orientation: PageOrientation;
  /** De onde veio a medida — usado em log/diagnóstico. */
  source: 'declared' | 'measured' | 'default';
};

export type PageSlice = {
  /**
   * Deslocamento vertical (mm) com que a imagem inteira é desenhada nesta
   * página. É negativo a partir da segunda fatia: o excedente "sobe".
   */
  offsetMm: number;
  /** Altura visível de conteúdo nesta fatia, em mm (para diagnóstico). */
  visibleHeightMm: number;
};

export type PagePlan = {
  /** Largura com que a imagem é desenhada (sempre a largura total da página). */
  imageWidthMm: number;
  /** Altura proporcional da imagem inteira, em mm. */
  imageHeightMm: number;
  /** Uma entrada por página do PDF gerada a partir deste `<section>`. */
  slices: PageSlice[];
  /**
   * `true` quando a imagem coube na página depois de absorver arredondamento
   * de sub-pixel (nenhuma fatia extra foi criada por 1–2 mm de sobra).
   */
  clampedToPage: boolean;
};

const CSS_LENGTH_RE = /^\s*(-?\d+(?:\.\d+)?)\s*(px|pt|pc|in|cm|mm|q)?\s*$/i;

/** Fatores de conversão para milímetro, por unidade CSS absoluta. */
const UNIT_TO_MM: Record<string, number> = {
  px: MM_PER_INCH / CSS_PX_PER_INCH,
  pt: MM_PER_INCH / CSS_PT_PER_INCH,
  pc: MM_PER_INCH / 6, // 1pc = 12pt
  in: MM_PER_INCH,
  cm: 10,
  mm: 1,
  q: 0.25, // quarter-millimeter
};

/**
 * Converte um comprimento CSS absoluto em milímetros.
 * Retorna `null` para vazio, unidade relativa (%/em/rem) ou valor inválido —
 * o chamador decide o fallback em vez de receber um número inventado.
 */
export function cssLengthToMm(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = CSS_LENGTH_RE.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  // Sem unidade, o navegador só aceita 0; aqui tratamos como px por tolerância.
  const unit = (match[2] || 'px').toLowerCase();
  const factor = UNIT_TO_MM[unit];
  if (!factor) return null;
  return amount * factor;
}

/** Converte pixels CSS em milímetros (96dpi). */
export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_PX_PER_INCH;
}

/**
 * Tamanho da página do PDF para um `<section>` renderizado.
 *
 * Prioridade: (1) o que o documento declara (`style.width`/`style.minHeight`);
 * (2) o que foi medido na tela; (3) A4 retrato. A altura declarada é um
 * `min-height`, então a medida só substitui a declarada quando a declarada não
 * existe — conteúdo que estourou a página é tratado em `planPagePlacement`.
 */
export function resolvePageGeometry(input: {
  declaredWidth?: string | null;
  declaredHeight?: string | null;
  measuredWidthPx?: number | null;
  measuredHeightPx?: number | null;
}): PageGeometry {
  const declaredWidthMm = cssLengthToMm(input.declaredWidth);
  const declaredHeightMm = cssLengthToMm(input.declaredHeight);
  if (declaredWidthMm && declaredHeightMm) {
    return {
      widthMm: declaredWidthMm,
      heightMm: declaredHeightMm,
      orientation: declaredWidthMm > declaredHeightMm ? 'landscape' : 'portrait',
      source: 'declared',
    };
  }

  const measuredWidthMm = Number.isFinite(input.measuredWidthPx) && (input.measuredWidthPx as number) > 0
    ? pxToMm(input.measuredWidthPx as number)
    : null;
  const measuredHeightMm = Number.isFinite(input.measuredHeightPx) && (input.measuredHeightPx as number) > 0
    ? pxToMm(input.measuredHeightPx as number)
    : null;

  // Só a largura é confiável quando medida: a altura cresce com o conteúdo.
  const widthMm = declaredWidthMm ?? measuredWidthMm;
  if (widthMm) {
    // Mantém a proporção da folha declarada quando só falta a altura; senão,
    // usa a razão A4 sobre a largura real (Carta/Ofício declaram as duas).
    const heightMm = declaredHeightMm
      ?? (measuredHeightMm && measuredHeightMm > widthMm ? measuredHeightMm : null)
      ?? (widthMm * DEFAULT_PAGE_MM.height) / DEFAULT_PAGE_MM.width;
    return {
      widthMm,
      heightMm,
      orientation: widthMm > heightMm ? 'landscape' : 'portrait',
      source: declaredWidthMm ? 'declared' : 'measured',
    };
  }

  return {
    widthMm: DEFAULT_PAGE_MM.width,
    heightMm: DEFAULT_PAGE_MM.height,
    orientation: 'portrait',
    source: 'default',
  };
}

/**
 * Escala de rasterização viável para um elemento.
 *
 * Queremos `desiredScale` (texto nítido), mas navegadores estouram em canvas
 * muito grande: há limite por lado e por área total. Reduzimos até caber, sem
 * nunca ficar abaixo de `minScale` — melhor um PDF um pouco mais leve do que
 * uma exceção de canvas no meio da conversão.
 */
export function resolveRasterScale(input: {
  widthPx: number;
  heightPx: number;
  desiredScale?: number;
  maxSidePx?: number;
  maxAreaPx?: number;
  minScale?: number;
}): number {
  const {
    widthPx, heightPx,
    desiredScale = 2.5,
    maxSidePx = 12_000,
    maxAreaPx = 40_000_000,
    minScale = 1,
  } = input;
  if (!(widthPx > 0) || !(heightPx > 0)) return Math.max(minScale, 1);

  let scale = desiredScale;
  scale = Math.min(scale, maxSidePx / widthPx, maxSidePx / heightPx);
  scale = Math.min(scale, Math.sqrt(maxAreaPx / (widthPx * heightPx)));
  if (!Number.isFinite(scale) || scale <= 0) return Math.max(minScale, 1);
  return Math.max(minScale, Number(scale.toFixed(3)));
}

/**
 * Como uma imagem de página (canvas) é colocada no PDF.
 *
 * `toleranceMm` absorve arredondamento de sub-pixel: uma folha que rasteriza
 * 0,6 mm mais alta que a página é achatada de volta em vez de gerar uma
 * segunda página com uma tira branca — a origem das páginas "sobrando" na
 * conversão antiga. Sobra real (tabela que estourou a folha) continua sendo
 * paginada, agora no tamanho de página certo.
 */
export function planPagePlacement(input: {
  pageWidthMm: number;
  pageHeightMm: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
  toleranceMm?: number;
  maxSlices?: number;
}): PagePlan {
  const {
    pageWidthMm, pageHeightMm, canvasWidthPx, canvasHeightPx,
    toleranceMm = 3, maxSlices = 200,
  } = input;

  const safeWidth = pageWidthMm > 0 ? pageWidthMm : DEFAULT_PAGE_MM.width;
  const safeHeight = pageHeightMm > 0 ? pageHeightMm : DEFAULT_PAGE_MM.height;

  if (!(canvasWidthPx > 0) || !(canvasHeightPx > 0)) {
    return {
      imageWidthMm: safeWidth,
      imageHeightMm: safeHeight,
      slices: [{ offsetMm: 0, visibleHeightMm: safeHeight }],
      clampedToPage: true,
    };
  }

  const naturalHeightMm = (canvasHeightPx * safeWidth) / canvasWidthPx;

  if (naturalHeightMm <= safeHeight + toleranceMm) {
    // Cabe (ou quase): desenha achatando o excedente milimétrico.
    const drawHeightMm = Math.min(naturalHeightMm, safeHeight);
    return {
      imageWidthMm: safeWidth,
      imageHeightMm: drawHeightMm,
      slices: [{ offsetMm: 0, visibleHeightMm: drawHeightMm }],
      clampedToPage: naturalHeightMm > safeHeight,
    };
  }

  const sliceCount = Math.min(maxSlices, Math.max(1, Math.ceil(naturalHeightMm / safeHeight)));
  const slices: PageSlice[] = [];
  for (let index = 0; index < sliceCount; index += 1) {
    const consumed = index * safeHeight;
    slices.push({
      // `-0` existe em JS e vaza para comparações; a primeira fatia é zero puro.
      offsetMm: consumed === 0 ? 0 : -consumed,
      visibleHeightMm: Math.min(safeHeight, naturalHeightMm - consumed),
    });
  }
  return {
    imageWidthMm: safeWidth,
    imageHeightMm: naturalHeightMm,
    slices,
    clampedToPage: false,
  };
}

/** Formato de página aceito pelo jsPDF (`[largura, altura]` em mm). */
export function pdfPageFormat(geometry: PageGeometry): [number, number] {
  return [geometry.widthMm, geometry.heightMm];
}
