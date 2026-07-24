/**
 * pdfTools
 * -----------------------------------------------------------------------------
 * Operações de PDF 100% no cliente (pdf-lib), sem acoplamento a Supabase ou
 * Nextcloud. Recebem/retornam bytes ou Blobs para o chamador decidir onde
 * gravar (download, Nextcloud, Supabase Storage, etc.).
 *
 * A lógica espelha a das ferramentas do CloudModule para manter o mesmo
 * comportamento (marca d'água diagonal, numeração, divisão, junção, rotação e
 * conversão de imagens em PDF).
 */

export type PageNumberPosition = 'bottom-center' | 'bottom-right' | 'top-center';

/** Normaliza uma rotação para o intervalo [0, 360). */
export function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Número de páginas de um PDF. */
export async function getPdfPageCount(bytes: ArrayBuffer | Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** Aplica marca d'água (texto) em todas as páginas. */
export async function watermarkPdf(
  bytes: ArrayBuffer | Uint8Array,
  opts: { text: string; opacity?: number; diagonal?: boolean },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const opacity = opts.opacity ?? 0.15;
  const diagonal = opts.diagonal ?? true;
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = opts.text.trim().toUpperCase();
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = Math.min(width, height) * 0.1;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: height / 2 - fontSize / 2,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      ...(diagonal ? { rotate: degrees(45) } : {}),
    });
  }
  return doc.save();
}

/** Adiciona numeração "n / total" em todas as páginas. */
export async function numberPdfPages(
  bytes: ArrayBuffer | Uint8Array,
  opts: { position?: PageNumberPosition } = {},
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const position = opts.position ?? 'bottom-center';
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const fontSize = 9;
  pages.forEach((page, idx) => {
    const { width, height } = page.getSize();
    const text = `${idx + 1} / ${total}`;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    let x = (width - textWidth) / 2;
    let y = 18;
    if (position === 'bottom-right') { x = width - textWidth - 20; y = 18; }
    if (position === 'top-center') { x = (width - textWidth) / 2; y = height - 24; }
    page.drawText(text, { x, y, size: fontSize, font, color: rgb(0.35, 0.35, 0.35), opacity: 0.8 });
  });
  return doc.save();
}

/** Divide um PDF em duas partes: [1..splitAt] e [splitAt+1..fim]. */
export async function splitPdf(
  bytes: ArrayBuffer | Uint8Array,
  splitAtPage: number,
): Promise<{ part1: Uint8Array; part2: Uint8Array; splitAt: number; total: number }> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const splitAt = Math.min(Math.max(1, splitAtPage), total - 1);

  const p1 = await PDFDocument.create();
  const pages1 = await p1.copyPages(src, Array.from({ length: splitAt }, (_, i) => i));
  pages1.forEach((p) => p1.addPage(p));

  const p2 = await PDFDocument.create();
  const pages2 = await p2.copyPages(src, Array.from({ length: total - splitAt }, (_, i) => i + splitAt));
  pages2.forEach((p) => p2.addPage(p));

  return { part1: await p1.save(), part2: await p2.save(), splitAt, total };
}

/** Junta vários PDFs (na ordem recebida) em um único. */
export async function mergePdfs(list: Array<ArrayBuffer | Uint8Array>): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  for (const bytes of list) {
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

/** Gira todas as páginas por `delta` graus (soma à rotação atual). */
export async function rotatePdf(bytes: ArrayBuffer | Uint8Array, delta: number): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle;
    page.setRotation(degrees(normalizeRotation(current + delta)));
  }
  return doc.save();
}

/** Converte um Blob de imagem em bytes PNG (via canvas), quando não for JPEG. */
async function blobToPngBytes(blob: Blob): Promise<Uint8Array> {
  const imageUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Não foi possível processar a imagem.'));
      element.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível para converter a imagem.');
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Falha ao converter imagem para PNG.'))), 'image/png');
    });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/** Converte uma lista de imagens (Blobs) em um único PDF, 1 imagem por página. */
export async function imagesToPdf(images: Blob[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (const blob of images) {
    const isJpg = blob.type.includes('jpeg') || blob.type.includes('jpg');
    const bytes = isJpg ? new Uint8Array(await blob.arrayBuffer()) : await blobToPngBytes(blob);
    const embedded = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  return doc.save();
}

/** Helper: Uint8Array de PDF -> Blob application/pdf. */
export function pdfBytesToBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
