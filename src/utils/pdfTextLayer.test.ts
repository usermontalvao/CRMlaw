// Camada de texto invisível que deixa o PDF pesquisável.
// O caso que motiva os testes: palavra partida em vários elementos pelo layout
// (mudança de formatação, revisão, campo) tem de voltar a ser UMA palavra, senão
// a busca no leitor de PDF não encontra "Trabalhista".
// Execução: `npx ts-node --esm src/utils/pdfTextLayer.test.ts`
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  charSpaceFor,
  fontStyleName,
  isEmptyRun,
  mapFontFamily,
  mergeAdjacentRuns,
  normalizeRunText,
  writeTextLayer,
  type TextLayerRun,
} from './pdfTextLayer.ts';

function run(overrides: Partial<TextLayerRun> = {}): TextLayerRun {
  return {
    text: 'texto',
    xMm: 30,
    baselineMm: 50,
    widthMm: 10,
    fontSizePt: 12,
    bold: false,
    italic: false,
    family: 'times',
    ...overrides,
  };
}

// --- mapFontFamily ----------------------------------------------------------

test('fontes de petição caem em serifada', () => {
  for (const name of ['Times New Roman', 'Georgia', 'Cambria', 'Garamond', 'Book Antiqua']) {
    assert.equal(mapFontFamily(name), 'times', name);
  }
});

test('fontes sem serifa são reconhecidas', () => {
  for (const name of ['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Roboto', 'Open Sans']) {
    assert.equal(mapFontFamily(name), 'helvetica', name);
  }
});

test('fontes monoespaçadas são reconhecidas', () => {
  assert.equal(mapFontFamily('Courier New'), 'courier');
  assert.equal(mapFontFamily('Consolas'), 'courier');
});

test('fonte ausente ou desconhecida não quebra nada', () => {
  assert.equal(mapFontFamily(null), 'times');
  assert.equal(mapFontFamily(undefined), 'times');
  assert.equal(mapFontFamily(''), 'times');
  assert.equal(mapFontFamily('FonteEsquisita XYZ'), 'times');
});

// --- fontStyleName ----------------------------------------------------------

test('combinações de negrito e itálico', () => {
  assert.equal(fontStyleName(false, false), 'normal');
  assert.equal(fontStyleName(true, false), 'bold');
  assert.equal(fontStyleName(false, true), 'italic');
  assert.equal(fontStyleName(true, true), 'bolditalic');
});

// --- normalizeRunText / isEmptyRun ------------------------------------------

test('quebra de linha e tabulação dentro do trecho viram espaço', () => {
  assert.equal(normalizeRunText('linha\numa\ttab'), 'linha uma tab');
});

test('espaço não separável vira espaço comum (senão a busca não acha)', () => {
  assert.equal(normalizeRunText('Art. 1.º'), 'Art. 1.º');
});

test('trecho só com espaço não entra na camada', () => {
  assert.equal(isEmptyRun('   '), true);
  assert.equal(isEmptyRun(' '), true);
  assert.equal(isEmptyRun(''), true);
  assert.equal(isEmptyRun('a'), false);
});

// --- charSpaceFor -----------------------------------------------------------

test('sem ajuste quando as larguras já batem', () => {
  assert.equal(charSpaceFor(10, 10, 5), 0);
});

test('distribui a diferença entre os caracteres', () => {
  // 4 vãos entre 5 caracteres; faltam 2 mm.
  assert.equal(charSpaceFor(12, 10, 5), 0.5);
});

test('aceita ajuste negativo quando a fonte da camada é mais larga', () => {
  assert.equal(charSpaceFor(8, 10, 5), -0.5);
});

test('não ajusta o que não tem vão nem medida', () => {
  assert.equal(charSpaceFor(10, 10, 1), 0);
  assert.equal(charSpaceFor(10, 10, 0), 0);
  assert.equal(charSpaceFor(0, 10, 5), 0);
  assert.equal(charSpaceFor(10, 0, 5), 0);
});

test('diferença absurda é ignorada em vez de distorcer a linha', () => {
  assert.equal(charSpaceFor(100, 10, 5), 0);
  assert.equal(charSpaceFor(1, 10, 5), 0);
});

// --- mergeAdjacentRuns ------------------------------------------------------

test('palavra partida pelo layout volta a ser uma só', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'Trabal', xMm: 30, widthMm: 12 }),
    run({ text: 'hista', xMm: 42, widthMm: 9 }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Trabalhista');
  assert.equal(merged[0].xMm, 30);
  assert.equal(merged[0].widthMm, 21);
});

test('trechos de estilos diferentes não são juntados', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'Réu', xMm: 30, widthMm: 10, bold: true }),
    run({ text: ' comparece', xMm: 40, widthMm: 20, bold: false }),
  ]);
  assert.equal(merged.length, 2);
});

test('trechos em linhas diferentes não são juntados', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'primeira', xMm: 30, widthMm: 10, baselineMm: 50 }),
    run({ text: 'segunda', xMm: 40, widthMm: 10, baselineMm: 55 }),
  ]);
  assert.equal(merged.length, 2);
});

test('espaço real entre trechos preserva a separação', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'palavra', xMm: 30, widthMm: 10 }),
    run({ text: 'longe', xMm: 60, widthMm: 10 }),
  ]);
  assert.equal(merged.length, 2);
});

test('vão de sub-milímetro ainda conta como colado', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'ab', xMm: 30, widthMm: 10 }),
    run({ text: 'cd', xMm: 40.3, widthMm: 10 }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'abcd');
});

test('junta uma cadeia inteira de pedaços', () => {
  const merged = mergeAdjacentRuns([
    run({ text: 'a', xMm: 10, widthMm: 2 }),
    run({ text: 'b', xMm: 12, widthMm: 2 }),
    run({ text: 'c', xMm: 14, widthMm: 2 }),
    run({ text: 'd', xMm: 16, widthMm: 2 }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'abcd');
  assert.equal(merged[0].widthMm, 8);
});

test('a junção não altera a lista recebida', () => {
  const original = [
    run({ text: 'ab', xMm: 10, widthMm: 5 }),
    run({ text: 'cd', xMm: 15, widthMm: 5 }),
  ];
  mergeAdjacentRuns(original);
  assert.equal(original[0].text, 'ab');
  assert.equal(original[0].widthMm, 5);
});

test('lista vazia não gera nada', () => {
  assert.deepEqual(mergeAdjacentRuns([]), []);
});

// --- writeTextLayer ---------------------------------------------------------

/** Dublê com a forma mínima que a camada exige do jsPDF. */
function fakePdf(options: { widthPerChar?: number; failOn?: string } = {}) {
  const { widthPerChar = 2, failOn } = options;
  const calls: Array<{ text: string; x: number; y: number; options?: Record<string, unknown> }> = [];
  const fonts: Array<[string, string]> = [];
  const sizes: number[] = [];
  return {
    calls,
    fonts,
    sizes,
    setFont(family: string, style: string) { fonts.push([family, style]); },
    setFontSize(size: number) { sizes.push(size); },
    getTextWidth(text: string) { return text.length * widthPerChar; },
    text(text: string, x: number, y: number, opts?: Record<string, unknown>) {
      if (failOn && text.includes(failOn)) throw new Error('caractere não suportado');
      calls.push({ text, x, y, options: opts });
    },
  };
}

test('a camada é escrita SEMPRE em modo invisível', () => {
  const pdf = fakePdf();
  writeTextLayer(pdf, [run({ text: 'Petição' })]);
  assert.equal(pdf.calls.length, 1);
  assert.equal(pdf.calls[0].options?.renderingMode, 'invisible');
});

test('o texto é posicionado pela linha de base', () => {
  const pdf = fakePdf();
  writeTextLayer(pdf, [run({ text: 'abc', xMm: 25, baselineMm: 60 })]);
  assert.equal(pdf.calls[0].x, 25);
  assert.equal(pdf.calls[0].y, 60);
  assert.equal(pdf.calls[0].options?.baseline, 'alphabetic');
});

test('fonte e tamanho seguem o trecho', () => {
  const pdf = fakePdf();
  writeTextLayer(pdf, [run({ text: 'Réu', bold: true, italic: true, family: 'helvetica', fontSizePt: 14 })]);
  assert.deepEqual(pdf.fonts[0], ['helvetica', 'bolditalic']);
  assert.equal(pdf.sizes[0], 14);
});

test('devolve quantos trechos entraram (0 = PDF não pesquisável)', () => {
  const pdf = fakePdf();
  assert.equal(writeTextLayer(pdf, []), 0);
  assert.equal(writeTextLayer(pdf, [run(), run(), run()]), 3);
});

test('um trecho problemático é pulado, os outros continuam', () => {
  const pdf = fakePdf({ failOn: '✂' });
  const written = writeTextLayer(pdf, [
    run({ text: 'antes' }),
    run({ text: 'com ✂ dentro' }),
    run({ text: 'depois' }),
  ]);
  assert.equal(written, 2, 'a falha de um trecho não pode derrubar a camada');
  assert.deepEqual(pdf.calls.map((call) => call.text), ['antes', 'depois']);
});

test('o espaçamento é ajustado para casar com a largura do desenho', () => {
  // "abcde" = 5 caracteres → largura natural 10 mm no dublê; alvo 14 mm.
  const pdf = fakePdf({ widthPerChar: 2 });
  writeTextLayer(pdf, [run({ text: 'abcde', widthMm: 14 })]);
  assert.equal(pdf.calls[0].options?.charSpace, 1); // (14-10)/4
});
