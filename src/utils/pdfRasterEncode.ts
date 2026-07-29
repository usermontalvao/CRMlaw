/**
 * Codificação das páginas rasterizadas que entram no PDF.
 *
 * O compromisso é entre nitidez e tamanho de arquivo, e aqui o tamanho não é
 * detalhe: petição sai deste CRM para peticionamento eletrônico, onde há limite
 * por arquivo. PNG mantém o texto perfeito e comprime bem em página branca com
 * texto preto; quando a página tem imagem/fundo colorido o PNG explode, e aí
 * JPEG de alta qualidade fica muito menor com diferença visual desprezível em
 * texto.
 */

/**
 * Acima disto, a página vai em JPEG em vez de PNG.
 *
 * Uma página A4 de texto a ~192 dpi fica em torno de 250–400 KB em PNG, então o
 * teto deixa o caso comum (petição: texto preto em papel branco) sair sem perda.
 * Página com foto/scan estoura o teto e vai em JPEG, onde a diferença visual é
 * imperceptível e a economia é grande.
 */
export const DEFAULT_PNG_MAX_BYTES = 450_000;

export type EncodedRaster = {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  /** Tamanho aproximado em bytes do que entra no PDF. */
  bytes: number;
};

/** Bytes reais por trás de um data URL base64 (4 caracteres = 3 bytes). */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const payload = dataUrl.length - comma - 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload * 3) / 4) - padding);
}

/**
 * Codifica um canvas para o PDF: PNG quando couber no orçamento, senão JPEG.
 * `jpegQuality` alto (0,92) porque o conteúdo é texto — qualidade baixa cria
 * franjas ao redor das letras.
 */
export function encodeRasterForPdf(
  canvas: HTMLCanvasElement,
  options: { maxPngBytes?: number; jpegQuality?: number } = {},
): EncodedRaster {
  const { maxPngBytes = DEFAULT_PNG_MAX_BYTES, jpegQuality = 0.92 } = options;

  const png = canvas.toDataURL('image/png');
  const pngBytes = dataUrlByteLength(png);
  if (pngBytes <= maxPngBytes) return { dataUrl: png, format: 'PNG', bytes: pngBytes };

  const jpeg = canvas.toDataURL('image/jpeg', jpegQuality);
  const jpegBytes = dataUrlByteLength(jpeg);
  // Página com pouca cor pode gerar JPEG maior que o PNG; nesse caso, PNG.
  if (jpegBytes >= pngBytes) return { dataUrl: png, format: 'PNG', bytes: pngBytes };
  return { dataUrl: jpeg, format: 'JPEG', bytes: jpegBytes };
}

/** Desenha uma imagem já carregada num canvas do mesmo tamanho em pixels. */
export function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponível para codificar a página.');
  // Fundo branco: PNG do Syncfusion pode ter transparência, e transparência
  // vira preto em alguns leitores de PDF.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas;
}
