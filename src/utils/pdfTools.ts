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

/**
 * Vão disponível para uma linha de texto que passa pelo CENTRO da página num
 * dado ângulo (o comprimento da corda que cruza a folha nessa inclinação).
 *
 * A 0° é a largura da página; a 90°, a altura; a 45° numa A4, ~841 pt — bem mais
 * que a largura, e é por isso que a marca d'água diagonal pode (e deve) ser
 * maior que a horizontal.
 */
export function watermarkSpan(pageWidth: number, pageHeight: number, angleDegrees: number): number {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const byWidth = cos > 1e-6 ? pageWidth / cos : Number.POSITIVE_INFINITY;
  const byHeight = sin > 1e-6 ? pageHeight / sin : Number.POSITIVE_INFINITY;
  const span = Math.min(byWidth, byHeight);
  return Number.isFinite(span) ? span : Math.max(pageWidth, pageHeight);
}

/**
 * Tamanho de fonte para a marca d'água ocupar `coverage` do vão da folha.
 *
 * A largura do texto é linear no tamanho da fonte, então basta medir o texto com
 * fonte 1 (`unitTextWidth`) e escalar. O teto evita que uma marca curta ("X")
 * vire uma letra gigante ocupando a folha inteira.
 */
export function fitWatermarkFontSize(input: {
  pageWidth: number;
  pageHeight: number;
  angleDegrees: number;
  unitTextWidth: number;
  coverage?: number;
  maxFontSize?: number;
  minFontSize?: number;
}): number {
  const {
    pageWidth, pageHeight, angleDegrees, unitTextWidth,
    coverage = 0.8,
    maxFontSize = Math.min(pageWidth, pageHeight) * 0.28,
    minFontSize = 8,
  } = input;
  if (!(unitTextWidth > 0)) return minFontSize;
  const span = watermarkSpan(pageWidth, pageHeight, angleDegrees);
  const ideal = (span * coverage) / unitTextWidth;
  return Math.max(minFontSize, Math.min(maxFontSize, ideal));
}

/**
 * Ponto de ancoragem para a marca d'água sair CENTRALIZADA na folha.
 *
 * O detalhe que fazia a marca aparecer no canto: o `drawText` do pdf-lib gira o
 * texto em torno de `(x, y)` — o início da linha de base —, NÃO em torno do
 * centro do texto. Centralizar o texto sem rotação e depois girar 45° empurra a
 * frase para cima e para a direita, saindo do lugar.
 *
 * A conta certa parte do centro da folha e recua metade do comprimento na
 * direção do texto, mais metade da altura das maiúsculas na perpendicular (a
 * linha de base fica ABAIXO do miolo das letras).
 */
export function watermarkPlacement(input: {
  pageWidth: number;
  pageHeight: number;
  textWidth: number;
  capHeight: number;
  angleDegrees: number;
}): { x: number; y: number } {
  const { pageWidth, pageHeight, textWidth, capHeight, angleDegrees } = input;
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: pageWidth / 2 - (textWidth / 2) * cos + (capHeight / 2) * sin,
    y: pageHeight / 2 - (textWidth / 2) * sin - (capHeight / 2) * cos,
  };
}

/** Aplica marca d'água (texto) nas páginas (todas, ou apenas `pages` 0-based). */
export async function watermarkPdf(
  bytes: ArrayBuffer | Uint8Array,
  opts: {
    text: string;
    opacity?: number;
    diagonal?: boolean;
    pages?: number[];
    /** Fração do vão da folha ocupada pelo texto (0..1). */
    coverage?: number;
  },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const opacity = opts.opacity ?? 0.15;
  const diagonal = opts.diagonal ?? true;
  const angleDegrees = diagonal ? 45 : 0;
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = opts.text.trim().toUpperCase();
  if (!text) throw new Error('Informe o texto da marca d’água.');
  const applies = pageSelector(opts.pages);
  const allPages = doc.getPages();
  // Linear no tamanho da fonte: mede uma vez, escala em cada página.
  const unitTextWidth = font.widthOfTextAtSize(text, 1);

  for (let index = 0; index < allPages.length; index += 1) {
    if (!applies(index)) continue;
    const page = allPages[index];
    const { width, height } = page.getSize();
    const fontSize = fitWatermarkFontSize({
      pageWidth: width,
      pageHeight: height,
      angleDegrees,
      unitTextWidth,
      coverage: opts.coverage,
    });
    const textWidth = unitTextWidth * fontSize;
    // Altura das maiúsculas: o texto é todo em caixa alta, então não há
    // descendente para compensar — usar a altura total desalinharia para baixo.
    const capHeight = (font.heightAtSize(fontSize, { descender: false }) || fontSize * 0.72);
    const { x, y } = watermarkPlacement({
      pageWidth: width,
      pageHeight: height,
      textWidth,
      capHeight,
      angleDegrees,
    });
    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      ...(diagonal ? { rotate: degrees(angleDegrees) } : {}),
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

// ─── Metadados ───────────────────────────────────────────────────────────────

export type PdfMetadata = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  pageCount: number;
  createdAt: string | null;
  modifiedAt: string | null;
  /** `true` quando o arquivo declara restrições de permissão. */
  encrypted: boolean;
};

/** Lê os metadados de um PDF (autor, título, datas, nº de páginas). */
export async function readPdfMetadata(bytes: ArrayBuffer | Uint8Array): Promise<PdfMetadata> {
  const { PDFDocument } = await import('pdf-lib');
  // `ignoreEncryption`: queremos LER os metadados mesmo de arquivo protegido.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const asIso = (value: Date | undefined) => {
    if (!value) return null;
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  };
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: (doc.getKeywords() ?? '').toString(),
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    pageCount: doc.getPageCount(),
    createdAt: asIso(doc.getCreationDate()),
    modifiedAt: asIso(doc.getModificationDate()),
    encrypted: doc.isEncrypted,
  };
}

/**
 * Grava metadados no PDF.
 *
 * Serve a um caso concreto do escritório: o PDF gerado a partir de um modelo
 * carrega o autor e o título de quem criou o modelo, e esses dados vão junto
 * para o processo. Campo com string vazia é limpo.
 */
export async function writePdfMetadata(
  bytes: ArrayBuffer | Uint8Array,
  metadata: Partial<Pick<PdfMetadata, 'title' | 'author' | 'subject' | 'keywords' | 'creator' | 'producer'>>,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (metadata.title !== undefined) doc.setTitle(metadata.title);
  if (metadata.author !== undefined) doc.setAuthor(metadata.author);
  if (metadata.subject !== undefined) doc.setSubject(metadata.subject);
  if (metadata.keywords !== undefined) {
    doc.setKeywords(metadata.keywords ? metadata.keywords.split(/\s*[;,]\s*/).filter(Boolean) : []);
  }
  if (metadata.creator !== undefined) doc.setCreator(metadata.creator);
  if (metadata.producer !== undefined) doc.setProducer(metadata.producer);
  doc.setModificationDate(new Date());
  return doc.save();
}

// ─── Otimização ──────────────────────────────────────────────────────────────

export type OptimizeResult = {
  bytes: Uint8Array;
  originalSize: number;
  optimizedSize: number;
  /** Redução percentual (0 quando não houve ganho). */
  savedPercent: number;
};

/**
 * Reescreve o PDF de forma mais compacta.
 *
 * Não recomprime imagens (isso exigiria rasterizar e perderia qualidade): remove
 * o que o formato acumula sem necessidade — objetos órfãos de edições
 * anteriores, dicionários repetidos — e grava com fluxos de objetos comprimidos.
 * O ganho é real em arquivo que passou por várias ferramentas, e é exatamente o
 * caso dos PDFs que circulam por aqui (assinatura, marca d'água, numeração).
 *
 * Se o resultado ficar MAIOR (acontece em arquivo já ótimo), devolve o original:
 * nunca piorar é mais importante do que sempre mexer.
 */
export async function optimizePdf(bytes: ArrayBuffer | Uint8Array): Promise<OptimizeResult> {
  const { PDFDocument } = await import('pdf-lib');
  const original = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const originalSize = original.byteLength;

  const src = await PDFDocument.load(original, { ignoreEncryption: true });
  // Copiar página por página para um documento novo descarta tudo que não é
  // alcançável a partir das páginas.
  const doc = await PDFDocument.create();
  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((page) => doc.addPage(page));
  doc.setTitle(src.getTitle() ?? '');
  doc.setAuthor(src.getAuthor() ?? '');
  doc.setSubject(src.getSubject() ?? '');
  doc.setCreator(src.getCreator() ?? '');
  doc.setModificationDate(new Date());

  const optimized = await doc.save({ useObjectStreams: true });
  if (optimized.byteLength >= originalSize) {
    return { bytes: original, originalSize, optimizedSize: originalSize, savedPercent: 0 };
  }
  return {
    bytes: optimized,
    originalSize,
    optimizedSize: optimized.byteLength,
    savedPercent: Number((((originalSize - optimized.byteLength) / originalSize) * 100).toFixed(1)),
  };
}

// ─── Página de capa / separador ───────────────────────────────────────────────

/**
 * Insere uma página de separação com título (e subtítulo) antes do índice dado.
 *
 * Uso no escritório: montar um único PDF de anexos com um separador antes de
 * cada documento ("DOC. 03 — Contrato de trabalho"), como se pede em juízo.
 */
export async function insertSeparatorPage(
  bytes: ArrayBuffer | Uint8Array,
  opts: { title: string; subtitle?: string; atIndex?: number },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const title = String(opts.title || '').trim();
  if (!title) throw new Error('Informe o título do separador.');

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = doc.getPageCount();
  const at = Math.max(0, Math.min(total, opts.atIndex ?? 0));
  // O separador acompanha o tamanho da página vizinha, para não sair uma folha
  // de tamanho diferente no meio do documento.
  const reference = doc.getPage(Math.min(at, total - 1));
  const { width, height } = reference.getSize();

  const page = doc.insertPage(at, [width, height]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const titleSize = Math.min(28, Math.max(16, width / 18));
  const titleWidth = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: Math.max(24, (width - titleWidth) / 2),
    y: height / 2,
    size: titleSize,
    font: bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const subtitle = String(opts.subtitle || '').trim();
  if (subtitle) {
    const subtitleSize = Math.max(11, titleSize * 0.5);
    const subtitleWidth = regular.widthOfTextAtSize(subtitle, subtitleSize);
    page.drawText(subtitle, {
      x: Math.max(24, (width - subtitleWidth) / 2),
      y: height / 2 - titleSize * 1.4,
      size: subtitleSize,
      font: regular,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  // Régua discreta sob o título, para o separador não parecer página perdida.
  page.drawRectangle({
    x: width * 0.25,
    y: height / 2 - titleSize * 0.5,
    width: width * 0.5,
    height: 1.2,
    color: rgb(0.75, 0.75, 0.75),
  });

  return doc.save();
}

// ─── Renderização em imagens ─────────────────────────────────────────────────

/**
 * Converte cada página do PDF numa imagem PNG.
 *
 * Precisa de um renderizador (PDF.js) injetado pelo chamador — este módulo é
 * livre de DOM e de dependências pesadas por decisão de projeto.
 */
export async function pdfPagesToPngBlobs(
  bytes: ArrayBuffer | Uint8Array,
  renderPage: (pageNumber: number, scale: number) => Promise<Blob>,
  opts: { scale?: number; pages?: number[] } = {},
): Promise<Blob[]> {
  const total = await getPdfPageCount(bytes);
  const scale = opts.scale ?? 2;
  const wanted = opts.pages?.length
    ? opts.pages.filter((index) => index >= 0 && index < total)
    : Array.from({ length: total }, (_, index) => index);
  const output: Blob[] = [];
  for (const index of wanted) output.push(await renderPage(index + 1, scale));
  return output;
}
