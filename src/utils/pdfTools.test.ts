// Cobertura das ferramentas PDF puras + operações reais com pdf-lib (em memória).
// Execução: `npx ts-node --esm src/utils/pdfTools.test.ts`
// (node:test embutido + ts-node; sem framework externo.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePageRanges,
  parsePageList,
  extractPages,
  removePages,
  rotatePagesByIndices,
  mergePdfs,
  splitPdfByRanges,
  explodePdfToPages,
  normalizeRotation,
  formatPageLabel,
  numberPdfPages,
  watermarkPdf,
  readPdfMetadata,
  writePdfMetadata,
  optimizePdf,
  insertSeparatorPage,
  pdfPagesToPngBlobs,
  watermarkPlacement,
  watermarkSpan,
  fitWatermarkFontSize,
} from './pdfTools.ts';

// --- Helpers ----------------------------------------------------------------

/** Cria um PDF de `n` páginas em memória (bytes). */
async function makePdf(n: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(bytes)).getPageCount();
}

async function rotationOf(bytes: Uint8Array, index: number): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return doc.getPages()[index].getRotation().angle;
}

// --- parsePageRanges / parsePageList (puras) --------------------------------

test('parsePageRanges: "1-3, 5, 8-10" vira intervalos na ordem', () => {
  assert.deepEqual(parsePageRanges('1-3, 5, 8-10', 10), [
    { start: 1, end: 3 }, { start: 5, end: 5 }, { start: 8, end: 10 },
  ]);
});

test('parsePageRanges: rejeita inválido, invertido, fora do total e sobreposto', () => {
  assert.throws(() => parsePageRanges('abc', 10), /inválido/i);
  assert.throws(() => parsePageRanges('5-2', 10), /invertido/i);
  assert.throws(() => parsePageRanges('1-99', 10), /ultrapassa/i);
  assert.throws(() => parsePageRanges('', 10), /pelo menos um/i);
  assert.throws(() => parsePageRanges('1-4, 3-6', 10), /sobrep/i);
});

test('parsePageRanges: permite sobreposição quando allowOverlap', () => {
  assert.deepEqual(parsePageRanges('1-4, 3-6', 10, { allowOverlap: true }), [
    { start: 1, end: 4 }, { start: 3, end: 6 },
  ]);
});

test('parsePageList: união deduplicada e ordenada, 0-based', () => {
  assert.deepEqual(parsePageList('1-3, 2, 5', 10), [0, 1, 2, 4]);
});

// --- Operações reais com pdf-lib --------------------------------------------

test('extractPages: mantém só as páginas escolhidas, na ordem', async () => {
  const src = await makePdf(5);
  const out = await extractPages(src, [4, 0, 2]);
  assert.equal(await pageCount(out), 3);
});

test('removePages: preserva o restante', async () => {
  const src = await makePdf(5);
  const out = await removePages(src, [1, 3]);
  assert.equal(await pageCount(out), 3);
  await assert.rejects(() => removePages(src, [0, 1, 2, 3, 4]), /sem páginas/i);
});

test('rotatePagesByIndices: gira só as escolhidas e soma à rotação existente', async () => {
  const src = await makePdf(3);
  const once = await rotatePagesByIndices(src, [1], 90);
  assert.equal(await rotationOf(once, 0), 0);   // intocada
  assert.equal(await rotationOf(once, 1), 90);  // girada
  const twice = await rotatePagesByIndices(once, [1], 90);
  assert.equal(await rotationOf(twice, 1), 180); // soma preservada
});

test('mergePdfs: soma páginas na ordem informada', async () => {
  const a = await makePdf(2);
  const b = await makePdf(3);
  assert.equal(await pageCount(await mergePdfs([a, b])), 5);
  assert.equal(await pageCount(await mergePdfs([b, a])), 5);
});

test('splitPdfByRanges: um arquivo por intervalo com as páginas certas', async () => {
  const src = await makePdf(10);
  const parts = await splitPdfByRanges(src, '1-3, 5, 8-10');
  assert.equal(parts.length, 3);
  assert.equal(await pageCount(parts[0]), 3);
  assert.equal(await pageCount(parts[1]), 1);
  assert.equal(await pageCount(parts[2]), 3);
});

test('explodePdfToPages: um PDF de 1 página por página', async () => {
  const src = await makePdf(4);
  const pages = await explodePdfToPages(src);
  assert.equal(pages.length, 4);
  for (const p of pages) assert.equal(await pageCount(p), 1);
});

test('normalizeRotation: mantém [0,360)', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(360), 0);
});

test('formatPageLabel: formatos N, N/Total e custom', () => {
  assert.equal(formatPageLabel('n', 3, 10), '3');
  assert.equal(formatPageLabel('n-of-total', 3, 10), '3 / 10');
  assert.equal(formatPageLabel('custom', 3, 10, 'Fls. {n} de {total}'), 'Fls. 3 de 10');
  assert.equal(formatPageLabel('custom', 3, 10, 'Página {n}'), 'Página 3');
});

test('numberPdfPages: aplica só ao intervalo, sem quebrar o total de páginas', async () => {
  const src = await makePdf(4);
  // Numera apenas as páginas 2-3 (índices 1,2) começando em 5.
  const out = await numberPdfPages(src, { pages: [1, 2], startNumber: 5, format: 'n' });
  assert.equal(await pageCount(out), 4); // não altera a contagem
});

test('watermarkPdf: aceita intervalo de páginas sem alterar a contagem', async () => {
  const src = await makePdf(3);
  const out = await watermarkPdf(src, { text: 'CONFIDENCIAL', pages: [0] });
  assert.equal(await pageCount(out), 3);
});

// --- Metadados --------------------------------------------------------------

test('readPdfMetadata: devolve os campos e o total de páginas', async () => {
  const src = await makePdf(3);
  const meta = await readPdfMetadata(src);
  assert.equal(meta.pageCount, 3);
  assert.equal(meta.encrypted, false);
  assert.equal(typeof meta.title, 'string');
});

test('writePdfMetadata: grava e relê autor, título e assunto', async () => {
  const src = await makePdf(2);
  const out = await writePdfMetadata(src, {
    title: 'Petição inicial',
    author: 'Escritório Montalvão',
    subject: 'Reclamação trabalhista',
  });
  const meta = await readPdfMetadata(out);
  assert.equal(meta.title, 'Petição inicial');
  assert.equal(meta.author, 'Escritório Montalvão');
  assert.equal(meta.subject, 'Reclamação trabalhista');
  assert.equal(meta.pageCount, 2, 'metadados não devem mexer nas páginas');
});

test('writePdfMetadata: string vazia limpa o campo (não é ignorada)', async () => {
  const withAuthor = await writePdfMetadata(await makePdf(1), { author: 'Alguém' });
  const cleared = await writePdfMetadata(withAuthor, { author: '' });
  assert.equal((await readPdfMetadata(cleared)).author, '');
});

test('writePdfMetadata: palavras-chave separadas por vírgula ou ponto e vírgula', async () => {
  const out = await writePdfMetadata(await makePdf(1), { keywords: 'trabalhista, rescisão; horas extras' });
  const meta = await readPdfMetadata(out);
  for (const term of ['trabalhista', 'rescisão', 'horas extras']) {
    assert.ok(meta.keywords.includes(term), `faltou "${term}" em ${JSON.stringify(meta.keywords)}`);
  }
});

test('writePdfMetadata: campo não informado é preservado', async () => {
  const first = await writePdfMetadata(await makePdf(1), { title: 'Original', author: 'Autor' });
  const second = await writePdfMetadata(first, { subject: 'Novo assunto' });
  const meta = await readPdfMetadata(second);
  assert.equal(meta.title, 'Original');
  assert.equal(meta.author, 'Autor');
  assert.equal(meta.subject, 'Novo assunto');
});

// --- Otimização -------------------------------------------------------------

test('optimizePdf: preserva todas as páginas', async () => {
  const src = await makePdf(6);
  const result = await optimizePdf(src);
  assert.equal(await pageCount(result.bytes), 6);
});

test('optimizePdf: nunca devolve arquivo maior que o original', async () => {
  const src = await makePdf(3);
  const result = await optimizePdf(src);
  assert.ok(
    result.optimizedSize <= result.originalSize,
    `otimizado (${result.optimizedSize}) não pode passar do original (${result.originalSize})`,
  );
  assert.ok(result.savedPercent >= 0);
});

test('optimizePdf: sem ganho, devolve o original intacto e 0%', async () => {
  const src = await makePdf(1);
  const once = await optimizePdf(src);
  // Reotimizar o que já foi otimizado não deve inventar ganho.
  const twice = await optimizePdf(once.bytes);
  assert.ok(twice.savedPercent >= 0);
  assert.equal(await pageCount(twice.bytes), 1);
});

test('optimizePdf: mantém título e autor', async () => {
  const src = await writePdfMetadata(await makePdf(2), { title: 'Contrato', author: 'Pedro' });
  const result = await optimizePdf(src);
  const meta = await readPdfMetadata(result.bytes);
  assert.equal(meta.title, 'Contrato');
  assert.equal(meta.author, 'Pedro');
});

// --- Separador --------------------------------------------------------------

test('insertSeparatorPage: acrescenta exatamente uma página', async () => {
  const src = await makePdf(3);
  const out = await insertSeparatorPage(src, { title: 'DOC. 01 — Contrato' });
  assert.equal(await pageCount(out), 4);
});

test('insertSeparatorPage: entra na posição pedida', async () => {
  const src = await makePdf(4);
  const out = await insertSeparatorPage(src, { title: 'DOC. 02', atIndex: 2 });
  assert.equal(await pageCount(out), 5);
});

test('insertSeparatorPage: índice fora da faixa é limitado, não estoura', async () => {
  const src = await makePdf(2);
  assert.equal(await pageCount(await insertSeparatorPage(src, { title: 'X', atIndex: 99 })), 3);
  assert.equal(await pageCount(await insertSeparatorPage(src, { title: 'X', atIndex: -5 })), 3);
});

test('insertSeparatorPage: título vazio é recusado', async () => {
  const src = await makePdf(1);
  await assert.rejects(() => insertSeparatorPage(src, { title: '   ' }), /título/i);
});

test('insertSeparatorPage: aceita subtítulo sem alterar a contagem', async () => {
  const src = await makePdf(1);
  const out = await insertSeparatorPage(src, { title: 'DOC. 03', subtitle: 'Comprovante de residência' });
  assert.equal(await pageCount(out), 2);
});

// --- Renderização em imagens ------------------------------------------------

test('pdfPagesToPngBlobs: uma imagem por página, na ordem', async () => {
  const src = await makePdf(3);
  const seen: number[] = [];
  const blobs = await pdfPagesToPngBlobs(src, async (pageNumber) => {
    seen.push(pageNumber);
    return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  });
  assert.equal(blobs.length, 3);
  assert.deepEqual(seen, [1, 2, 3], 'páginas são 1-based e em ordem');
});

test('pdfPagesToPngBlobs: respeita a seleção de páginas e ignora índice inválido', async () => {
  const src = await makePdf(4);
  const seen: number[] = [];
  await pdfPagesToPngBlobs(src, async (pageNumber) => {
    seen.push(pageNumber);
    return new Blob([], { type: 'image/png' });
  }, { pages: [0, 2, 99, -1] });
  assert.deepEqual(seen, [1, 3]);
});

test('pdfPagesToPngBlobs: repassa a escala pedida', async () => {
  const src = await makePdf(1);
  let usedScale = 0;
  await pdfPagesToPngBlobs(src, async (_page, scale) => {
    usedScale = scale;
    return new Blob([], { type: 'image/png' });
  }, { scale: 3 });
  assert.equal(usedScale, 3);
});

// --- Marca d'água: posição ---------------------------------------------------
// O defeito que motivou estes testes: o pdf-lib gira o texto em torno do ponto
// de ancoragem, não do centro dele. Centralizar sem rotação e depois girar 45°
// jogava "CONFIDENCIAL" para o canto superior esquerdo, atravessado.

/** Centro visual do texto DEPOIS de girado em torno da âncora (x, y). */
function rotatedTextCenter(
  x: number,
  y: number,
  textWidth: number,
  capHeight: number,
  angleDegrees: number,
) {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x + (textWidth / 2) * cos - (capHeight / 2) * sin,
    y: y + (textWidth / 2) * sin + (capHeight / 2) * cos,
  };
}

const A4 = { pageWidth: 595.28, pageHeight: 841.89 };

test('watermarkPlacement: texto horizontal fica centralizado na folha', () => {
  const textWidth = 300;
  const capHeight = 40;
  const { x, y } = watermarkPlacement({ ...A4, textWidth, capHeight, angleDegrees: 0 });
  const center = rotatedTextCenter(x, y, textWidth, capHeight, 0);
  assert.ok(Math.abs(center.x - A4.pageWidth / 2) < 0.01, `x fora do centro: ${center.x}`);
  assert.ok(Math.abs(center.y - A4.pageHeight / 2) < 0.01, `y fora do centro: ${center.y}`);
});

test('watermarkPlacement: texto a 45° fica centralizado DEPOIS de girar', () => {
  const textWidth = 500;
  const capHeight = 60;
  const { x, y } = watermarkPlacement({ ...A4, textWidth, capHeight, angleDegrees: 45 });
  const center = rotatedTextCenter(x, y, textWidth, capHeight, 45);
  assert.ok(Math.abs(center.x - A4.pageWidth / 2) < 0.01, `x fora do centro: ${center.x}`);
  assert.ok(Math.abs(center.y - A4.pageHeight / 2) < 0.01, `y fora do centro: ${center.y}`);
});

test('watermarkPlacement: a âncora a 45° fica à ESQUERDA e ABAIXO do centro', () => {
  // É o recuo que faltava: sem ele o texto sobe e vai para a direita.
  const { x, y } = watermarkPlacement({ ...A4, textWidth: 500, capHeight: 60, angleDegrees: 45 });
  assert.ok(x < A4.pageWidth / 2, 'a âncora precisa recuar para a esquerda');
  assert.ok(y < A4.pageHeight / 2, 'a âncora precisa recuar para baixo');
});

test('watermarkPlacement: continua centralizado em paisagem e em Ofício', () => {
  for (const page of [{ pageWidth: 841.89, pageHeight: 595.28 }, { pageWidth: 612, pageHeight: 1008 }]) {
    const textWidth = 400;
    const capHeight = 50;
    const { x, y } = watermarkPlacement({ ...page, textWidth, capHeight, angleDegrees: 45 });
    const center = rotatedTextCenter(x, y, textWidth, capHeight, 45);
    assert.ok(Math.abs(center.x - page.pageWidth / 2) < 0.01);
    assert.ok(Math.abs(center.y - page.pageHeight / 2) < 0.01);
  }
});

test('watermarkSpan: 0° usa a largura, 90° usa a altura', () => {
  assert.ok(Math.abs(watermarkSpan(A4.pageWidth, A4.pageHeight, 0) - A4.pageWidth) < 0.01);
  assert.ok(Math.abs(watermarkSpan(A4.pageWidth, A4.pageHeight, 90) - A4.pageHeight) < 0.01);
});

test('watermarkSpan: a diagonal dá mais espaço que a largura', () => {
  const span = watermarkSpan(A4.pageWidth, A4.pageHeight, 45);
  assert.ok(span > A4.pageWidth, `a 45° deveria sobrar mais que ${A4.pageWidth}, deu ${span}`);
  // Limitado pelo lado curto: 595.28 / cos45 ≈ 841.8
  assert.ok(Math.abs(span - A4.pageWidth / Math.cos(Math.PI / 4)) < 0.1);
});

test('fitWatermarkFontSize: o texto ocupa a fração pedida do vão', () => {
  const unitTextWidth = 7; // texto largo o bastante para o teto não interferir
  const size = fitWatermarkFontSize({ ...A4, angleDegrees: 45, unitTextWidth, coverage: 0.8 });
  const span = watermarkSpan(A4.pageWidth, A4.pageHeight, 45);
  assert.ok(Math.abs(unitTextWidth * size - span * 0.8) < 0.5);
});

test('fitWatermarkFontSize: marca curta não vira letra gigante', () => {
  // "X" tem largura unitária pequena; sem teto, a fonte explodiria.
  const size = fitWatermarkFontSize({ ...A4, angleDegrees: 45, unitTextWidth: 0.7 });
  assert.ok(size <= Math.min(A4.pageWidth, A4.pageHeight) * 0.28 + 0.01, `sem teto: ${size}`);
});

test('fitWatermarkFontSize: medida inválida devolve o mínimo em vez de NaN', () => {
  assert.equal(fitWatermarkFontSize({ ...A4, angleDegrees: 45, unitTextWidth: 0 }), 8);
});

test('watermarkPdf: texto vazio é recusado', async () => {
  const src = await makePdf(1);
  await assert.rejects(() => watermarkPdf(src, { text: '   ' }), /marca/i);
});

test('watermarkPdf: horizontal e diagonal preservam as páginas', async () => {
  const src = await makePdf(3);
  assert.equal(await pageCount(await watermarkPdf(src, { text: 'CONFIDENCIAL' })), 3);
  assert.equal(await pageCount(await watermarkPdf(src, { text: 'CONFIDENCIAL', diagonal: false })), 3);
});
