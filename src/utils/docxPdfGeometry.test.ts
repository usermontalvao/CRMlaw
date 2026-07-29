// Geometria da conversão DOCX -> PDF: o que garante que a folha do Word chegue
// ao PDF com o mesmo tamanho, a mesma orientação e sem página branca sobrando.
// Execução: `npx ts-node --esm src/utils/docxPdfGeometry.test.ts`
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cssLengthToMm,
  planPagePlacement,
  pdfPageFormat,
  pxToMm,
  resolvePageGeometry,
  resolveRasterScale,
} from './docxPdfGeometry.ts';

/** Compara em mm com folga de 0,05 mm (arredondamento de ponto flutuante). */
function assertMm(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 0.05,
    message || `esperado ~${expected} mm, recebido ${actual} mm`,
  );
}

// --- cssLengthToMm ----------------------------------------------------------

test('converte as unidades absolutas que o docx-preview emite', () => {
  assertMm(cssLengthToMm('595.3pt')!, 210.02); // A4 largura
  assertMm(cssLengthToMm('841.9pt')!, 297.02); // A4 altura
  assertMm(cssLengthToMm('21cm')!, 210);
  assertMm(cssLengthToMm('297mm')!, 297);
  assertMm(cssLengthToMm('8.5in')!, 215.9); // Carta largura
  assertMm(cssLengthToMm('793.7px')!, 210);
  assertMm(cssLengthToMm('  595.3pt  ')!, 210.02);
});

test('número sem unidade é tratado como pixel CSS', () => {
  assertMm(cssLengthToMm('96')!, 25.4);
});

test('recusa o que não é comprimento absoluto em vez de inventar medida', () => {
  for (const value of ['', '  ', 'auto', '100%', '2em', '1.5rem', 'calc(21cm - 2cm)', '0pt', '-10pt', 'abc']) {
    assert.equal(cssLengthToMm(value), null, `deveria recusar ${JSON.stringify(value)}`);
  }
  assert.equal(cssLengthToMm(null), null);
  assert.equal(cssLengthToMm(undefined), null);
});

test('pxToMm usa os 96dpi do CSS', () => {
  assertMm(pxToMm(96), 25.4);
  assertMm(pxToMm(0), 0);
});

// --- resolvePageGeometry ----------------------------------------------------

test('A4 retrato declarado pelo documento é preservado', () => {
  const geometry = resolvePageGeometry({ declaredWidth: '595.3pt', declaredHeight: '841.9pt' });
  assertMm(geometry.widthMm, 210.02);
  assertMm(geometry.heightMm, 297.02);
  assert.equal(geometry.orientation, 'portrait');
  assert.equal(geometry.source, 'declared');
});

test('paisagem é detectada pela folha, não presumida retrato', () => {
  const geometry = resolvePageGeometry({ declaredWidth: '841.9pt', declaredHeight: '595.3pt' });
  assert.equal(geometry.orientation, 'landscape');
  assertMm(geometry.widthMm, 297.02);
  assertMm(geometry.heightMm, 210.02);
});

test('Ofício/Carta não são achatados em A4', () => {
  const carta = resolvePageGeometry({ declaredWidth: '8.5in', declaredHeight: '11in' });
  assertMm(carta.widthMm, 215.9);
  assertMm(carta.heightMm, 279.4);

  const oficio = resolvePageGeometry({ declaredWidth: '8.5in', declaredHeight: '14in' });
  assertMm(oficio.heightMm, 355.6);
});

test('sem declaração de altura, a medida da tela vale quando é maior que a largura', () => {
  const geometry = resolvePageGeometry({
    declaredWidth: '595.3pt',
    declaredHeight: null,
    measuredWidthPx: 793.7,
    measuredHeightPx: 1122.5,
  });
  assertMm(geometry.widthMm, 210.02);
  assertMm(geometry.heightMm, 297.02);
  assert.equal(geometry.source, 'declared');
});

test('sem nada declarado, cai para a largura medida mantendo proporção A4', () => {
  const geometry = resolvePageGeometry({ measuredWidthPx: 793.7, measuredHeightPx: 200 });
  assertMm(geometry.widthMm, 210);
  assertMm(geometry.heightMm, 297);
  assert.equal(geometry.source, 'measured');
});

test('sem declaração e sem medida, o último recurso é A4 retrato', () => {
  const geometry = resolvePageGeometry({});
  assertMm(geometry.widthMm, 210);
  assertMm(geometry.heightMm, 297);
  assert.equal(geometry.source, 'default');
  assert.deepEqual(pdfPageFormat(geometry), [210, 297]);
});

// --- resolveRasterScale -----------------------------------------------------

test('uma folha A4 comum rasteriza na escala pedida', () => {
  assert.equal(resolveRasterScale({ widthPx: 794, heightPx: 1123, desiredScale: 2.5 }), 2.5);
});

test('a escala cai para respeitar o limite de lado do canvas', () => {
  const scale = resolveRasterScale({ widthPx: 794, heightPx: 9000, desiredScale: 2.5, maxSidePx: 12_000 });
  assert.ok(scale < 2.5 && scale > 1, `escala inesperada: ${scale}`);
  assert.ok(9000 * scale <= 12_000 + 1);
});

test('a escala cai para respeitar o limite de área do canvas', () => {
  const scale = resolveRasterScale({
    widthPx: 3000, heightPx: 4000, desiredScale: 3, maxAreaPx: 40_000_000,
  });
  assert.ok(3000 * scale * 4000 * scale <= 40_000_000 * 1.01, `área estourou: ${scale}`);
});

test('nunca desce abaixo da escala mínima (PDF leve é melhor que exceção)', () => {
  const scale = resolveRasterScale({
    widthPx: 20_000, heightPx: 20_000, desiredScale: 2.5, minScale: 1,
  });
  assert.equal(scale, 1);
});

test('dimensão inválida não quebra a escala', () => {
  assert.equal(resolveRasterScale({ widthPx: 0, heightPx: 0 }), 1);
  assert.equal(resolveRasterScale({ widthPx: Number.NaN, heightPx: 100 }), 1);
});

// --- planPagePlacement ------------------------------------------------------

test('folha que cabe exatamente gera uma única página', () => {
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 2000, canvasHeightPx: 2829,
  });
  assert.equal(plan.slices.length, 1);
  assert.equal(plan.slices[0].offsetMm, 0);
  assertMm(plan.imageWidthMm, 210);
  assert.ok(plan.imageHeightMm <= 297.0001);
});

test('sobra de sub-pixel é achatada, não vira página branca', () => {
  // 2 mm a mais do que a folha: arredondamento de layout, não conteúdo.
  const canvasHeight = Math.round((299 / 210) * 2000);
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 2000, canvasHeightPx: canvasHeight,
  });
  assert.equal(plan.slices.length, 1, 'não deveria criar uma segunda página por 2 mm');
  assert.equal(plan.clampedToPage, true);
  assertMm(plan.imageHeightMm, 297);
});

test('sobra grande NÃO é achatada — isso esconderia conteúdo', () => {
  // 20 mm a mais: é conteúdo de verdade transbordando, precisa de outra página.
  const canvasHeight = Math.round((317 / 210) * 2000);
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 2000, canvasHeightPx: canvasHeight,
  });
  assert.equal(plan.slices.length, 2);
  assert.equal(plan.clampedToPage, false);
});

test('conteúdo que realmente estourou a folha é paginado no tamanho certo', () => {
  // ~2,5 folhas de altura.
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 2000, canvasHeightPx: 7071,
  });
  assert.equal(plan.slices.length, 3);
  assert.equal(plan.slices[0].offsetMm, 0);
  assertMm(plan.slices[1].offsetMm, -297);
  assertMm(plan.slices[2].offsetMm, -594);
  assert.equal(plan.clampedToPage, false);
  // A última fatia mostra só o que restou.
  assert.ok(plan.slices[2].visibleHeightMm < 297);
});

test('as fatias cobrem toda a imagem sem repetir conteúdo', () => {
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 1000, canvasHeightPx: 4000,
  });
  const covered = plan.slices.reduce((sum, slice) => sum + slice.visibleHeightMm, 0);
  assertMm(covered, plan.imageHeightMm);
});

test('a paginação respeita a folha paisagem', () => {
  const plan = planPagePlacement({
    pageWidthMm: 297, pageHeightMm: 210, canvasWidthPx: 2000, canvasHeightPx: 2829,
  });
  assertMm(plan.imageWidthMm, 297);
  assert.equal(plan.slices.length, 3);
  assertMm(plan.slices[1].offsetMm, -210);
});

test('canvas vazio não gera PDF sem página', () => {
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 0, canvasHeightPx: 0,
  });
  assert.equal(plan.slices.length, 1);
  assertMm(plan.imageHeightMm, 297);
});

test('documento absurdamente longo é limitado por maxSlices', () => {
  const plan = planPagePlacement({
    pageWidthMm: 210, pageHeightMm: 297, canvasWidthPx: 100, canvasHeightPx: 1_000_000,
    maxSlices: 50,
  });
  assert.equal(plan.slices.length, 50);
});
