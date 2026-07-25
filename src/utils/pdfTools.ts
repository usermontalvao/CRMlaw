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

/**
 * Converte uma lista de índices 0-based num predicado "esta página recebe?".
 * `undefined` = todas as páginas.
 */
function pageSelector(indices: number[] | undefined): (index: number) => boolean {
  if (!indices) return () => true;
  const set = new Set(indices);
  return (index) => set.has(index);
}

/** Aplica marca d'água (texto) nas páginas (todas, ou apenas `pages` 0-based). */
export async function watermarkPdf(
  bytes: ArrayBuffer | Uint8Array,
  opts: { text: string; opacity?: number; diagonal?: boolean; pages?: number[] },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const opacity = opts.opacity ?? 0.15;
  const diagonal = opts.diagonal ?? true;
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = opts.text.trim().toUpperCase();
  const applies = pageSelector(opts.pages);
  const allPages = doc.getPages();
  for (let index = 0; index < allPages.length; index += 1) {
    if (!applies(index)) continue;
    const page = allPages[index];
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

/** Formato do rótulo de numeração. */
export type PageNumberFormat = 'n' | 'n-of-total' | 'custom';

/**
 * Monta o texto do número de uma página.
 * `custom` usa um template com {n} (número atual) e {total} (total de páginas).
 */
export function formatPageLabel(
  format: PageNumberFormat,
  n: number,
  total: number,
  template = '{n}',
): string {
  if (format === 'n') return String(n);
  if (format === 'n-of-total') return `${n} / ${total}`;
  return template.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

/**
 * Adiciona numeração às páginas.
 * - `startNumber`: número da primeira página numerada (padrão 1).
 * - `format`: "n", "n-of-total" ou "custom" (com `template`).
 * - `pages`: índices 0-based que recebem número (padrão: todas). O rótulo usa
 *   uma contagem sequencial começando em `startNumber` sobre as páginas incluídas.
 */
export async function numberPdfPages(
  bytes: ArrayBuffer | Uint8Array,
  opts: {
    position?: PageNumberPosition;
    startNumber?: number;
    format?: PageNumberFormat;
    template?: string;
    pages?: number[];
  } = {},
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const position = opts.position ?? 'bottom-center';
  const startNumber = Number.isFinite(opts.startNumber) ? Number(opts.startNumber) : 1;
  const format = opts.format ?? 'n-of-total';
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const applies = pageSelector(opts.pages);
  const includedCount = opts.pages ? opts.pages.length : pages.length;
  const total = startNumber + includedCount - 1;
  const fontSize = 9;
  let counter = startNumber;
  pages.forEach((page, idx) => {
    if (!applies(idx)) return;
    const { width, height } = page.getSize();
    const text = formatPageLabel(format, counter, total, opts.template);
    counter += 1;
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

// --- Intervalos de páginas e operações por seleção ---------------------------

export interface PageRange {
  /** 1-based, inclusivo. */
  start: number;
  /** 1-based, inclusivo. */
  end: number;
}

/**
 * Faz o parse de uma especificação de intervalos como "1-3, 5, 8-10".
 * Retorna a lista de intervalos (1-based, inclusivos) na ordem informada.
 * Função PURA — valida e LANÇA em: token vazio/malformado, número < 1,
 * início > fim, ou página fora de [1, total].
 *
 * `allowOverlap = false` (padrão) também rejeita intervalos que se sobrepõem —
 * usado na divisão, onde sobreposição normalmente é engano do usuário.
 */
export function parsePageRanges(
  spec: string,
  total: number,
  opts: { allowOverlap?: boolean } = {},
): PageRange[] {
  if (total < 1) throw new Error('Documento sem páginas.');
  const tokens = String(spec).split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error('Informe pelo menos um intervalo (ex.: "1-3, 5").');

  const ranges: PageRange[] = [];
  for (const token of tokens) {
    const m = token.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw new Error(`Intervalo inválido: "${token}".`);
    const start = Number(m[1]);
    const end = m[2] !== undefined ? Number(m[2]) : start;
    if (start < 1 || end < 1) throw new Error(`Página deve ser ≥ 1 em "${token}".`);
    if (start > end) throw new Error(`Intervalo invertido em "${token}" (início > fim).`);
    if (end > total) throw new Error(`"${token}" ultrapassa o total de ${total} página(s).`);
    ranges.push({ start, end });
  }

  if (!opts.allowOverlap) {
    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].start <= ordered[i - 1].end) {
        throw new Error('Os intervalos informados se sobrepõem.');
      }
    }
  }
  return ranges;
}

/**
 * Converte uma spec de páginas em índices 0-based únicos e ordenados.
 * Aceita sobreposição (a união é deduplicada) — útil para seleção de
 * extração/remoção. Valida os limites via parsePageRanges.
 */
export function parsePageList(spec: string, total: number): number[] {
  const ranges = parsePageRanges(spec, total, { allowOverlap: true });
  const set = new Set<number>();
  for (const { start, end } of ranges) {
    for (let p = start; p <= end; p += 1) set.add(p - 1);
  }
  return [...set].sort((a, b) => a - b);
}

/** Divide um PDF gerando UM arquivo por intervalo informado. */
export async function splitPdfByRanges(
  bytes: ArrayBuffer | Uint8Array,
  spec: string,
): Promise<Uint8Array[]> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const ranges = parsePageRanges(spec, total, { allowOverlap: true });

  const out: Uint8Array[] = [];
  for (const { start, end } of ranges) {
    const doc = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const pages = await doc.copyPages(src, indices);
    pages.forEach((p) => doc.addPage(p));
    out.push(await doc.save());
  }
  return out;
}

/** Gera um PDF por página (1 página cada). */
export async function explodePdfToPages(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array[]> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i += 1) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    out.push(await doc.save());
  }
  return out;
}

/** Extrai as páginas em `indices` (0-based) num novo PDF, na ordem dada. */
export async function extractPages(
  bytes: ArrayBuffer | Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const valid = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < total);
  if (valid.length === 0) throw new Error('Nenhuma página válida para extrair.');
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, valid);
  pages.forEach((p) => doc.addPage(p));
  return doc.save();
}

/** Remove as páginas em `indices` (0-based), preservando o restante e as
 *  rotações existentes de cada página mantida. */
export async function removePages(
  bytes: ArrayBuffer | Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const toRemove = new Set(indices.filter((i) => i >= 0 && i < total));
  const keep = Array.from({ length: total }, (_, i) => i).filter((i) => !toRemove.has(i));
  if (keep.length === 0) throw new Error('A remoção deixaria o PDF sem páginas.');
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, keep);
  pages.forEach((p) => doc.addPage(p));
  return doc.save();
}

/** Gira apenas as páginas em `indices` (0-based) por `delta` graus, somando à
 *  rotação atual (preserva a rotação já existente das demais páginas). */
export async function rotatePagesByIndices(
  bytes: ArrayBuffer | Uint8Array,
  indices: number[],
  delta: number,
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const target = new Set(indices.filter((i) => i >= 0 && i < pages.length));
  target.forEach((i) => {
    const current = pages[i].getRotation().angle;
    pages[i].setRotation(degrees(normalizeRotation(current + delta)));
  });
  return doc.save();
}
