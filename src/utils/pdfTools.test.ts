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
