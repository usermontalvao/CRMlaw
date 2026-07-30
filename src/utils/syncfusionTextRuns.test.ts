// Geometria da camada de texto do PDF (motor Syncfusion).
//
// O caso que motiva estes testes: `LineWidget.x`/`.y` existem na tipagem do EJ2
// mas o layout NUNCA os preenche — ficam 0. Quem lia dali empilhava o texto todo
// no canto superior esquerdo da página, e o PDF abria como se fosse um
// digitalizado sem OCR: imagem certa, nada selecionável sobre o documento.
// A posição real vem do `ParagraphWidget` mais a soma das alturas das linhas.
//
// Execução: `npx ts-node --esm src/utils/syncfusionTextRuns.test.ts`
import assert from 'node:assert/strict';
import test from 'node:test';

import { extractPageWidgetTextRuns } from './syncfusionTextRuns.ts';

/** Elemento de texto com as propriedades que o renderizador consulta. */
function textElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'EXCELENTÍSSIMO',
    width: 100,
    height: 16,
    baselineOffset: 13,
    margin: { left: 0, top: 0 },
    padding: { left: 0 },
    characterFormat: { fontSize: 12, bold: false, italic: false, fontFamily: 'Times New Roman' },
    ...overrides,
  };
}

/** Linha com `x`/`y` = 0, como o EJ2 realmente entrega. */
function line(children: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { x: 0, y: 0, height: 20, marginTop: 0, children, ...overrides };
}

function paragraph(
  lines: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    x: 96,
    y: 120,
    paragraphFormat: { firstLineIndent: 0, bidi: false },
    childWidgets: lines,
    ...overrides,
  };
}

const bodyPage = (paragraphs: Record<string, unknown>[]) => ({
  bodyWidgets: [{ childWidgets: paragraphs }],
});

test('posiciona o trecho pelo parágrafo, não pelo x/y da linha (que é sempre 0)', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([line([textElement()])])]));

  assert.equal(runs.length, 1);
  assert.equal(runs[0].xPx, 96);
  // 120 (paragraph.y) + 0 (marginTop) + 13 (baselineOffset)
  assert.equal(runs[0].baselinePx, 133);
});

test('empilha as linhas do parágrafo somando marginTop e height', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([
    line([textElement({ text: 'primeira' })]),
    line([textElement({ text: 'segunda' })], { marginTop: 4 }),
    line([textElement({ text: 'terceira' })]),
  ])]));

  assert.deepEqual(runs.map((run) => run.text), ['primeira', 'segunda', 'terceira']);
  assert.deepEqual(runs.map((run) => run.baselinePx), [
    133, // 120 + 13
    157, // 120 + 20 (linha 1) + 4 (marginTop) + 13
    177, // 120 + 20 + 4 + 20 (linha 2) + 13
  ]);
});

test('avança o cursor horizontal por largura, margem e padding', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([line([
    textElement({ text: 'Trabalho', width: 60 }),
    textElement({ text: 'ista', width: 30, margin: { left: 5, top: 0 }, padding: { left: 2 } }),
  ])])]));

  assert.deepEqual(runs.map((run) => run.xPx), [
    96, // parágrafo
    // 96 + 60 (largura anterior) + 0 (margem anterior) + 2 (padding) + 5 (margem)
    163,
  ]);
  assert.equal(runs[1].widthPx, 30);
});

test('aplica o recuo de primeira linha só na primeira linha, e só em LTR', () => {
  const ltr = extractPageWidgetTextRuns(bodyPage([paragraph(
    [line([textElement()]), line([textElement()])],
    { paragraphFormat: { firstLineIndent: 36, bidi: false } }, // 36 pt = 48 px
  )]));
  assert.deepEqual(ltr.map((run) => run.xPx), [144, 96]);

  const rtl = extractPageWidgetTextRuns(bodyPage([paragraph(
    [line([textElement()])],
    { paragraphFormat: { firstLineIndent: 36, bidi: true } },
  )]));
  assert.equal(rtl[0].xPx, 96);
});

test('pula o código do campo mas mantém o resultado, sem perder o alinhamento', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([line([
    { fieldType: 0, width: 0, height: 0, margin: { left: 0, top: 0 }, fieldEnd: {} },
    textElement({ text: 'MERGEFIELD Cliente', width: 90 }),
    { fieldType: 1, width: 0, height: 0, margin: { left: 0, top: 0 } },
    textElement({ text: 'Maria de Souza', width: 80 }),
    { fieldType: 2, width: 0, height: 0, margin: { left: 0, top: 0 } },
    textElement({ text: ', qualificada', width: 50 }),
  ])])]));

  // O nome do campo não entra na camada; o texto seguinte fica no x do campo,
  // porque o código do campo não ocupa largura nenhuma no desenho.
  assert.deepEqual(runs.map((run) => run.text), ['Maria de Souza', ', qualificada']);
  assert.deepEqual(runs.map((run) => run.xPx), [96, 176]);
});

test('início de campo sem fim não engole o resto do parágrafo', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([line([
    { fieldType: 0, width: 0, height: 0, margin: { left: 0, top: 0 } },
    textElement({ text: 'texto visível' }),
  ])])]));

  assert.deepEqual(runs.map((run) => run.text), ['texto visível']);
});

test('lê o texto de dentro das tabelas', () => {
  const cellParagraph = paragraph([line([textElement({ text: 'R$ 1.500,00' })])], { x: 200, y: 300 });
  const runs = extractPageWidgetTextRuns(bodyPage([
    { childWidgets: [{ childWidgets: [{ childWidgets: [cellParagraph] }] }] }, // tabela > linha > célula
  ]));

  assert.deepEqual(runs.map((run) => run.text), ['R$ 1.500,00']);
  assert.equal(runs[0].xPx, 200);
});

test('inclui cabeçalho e rodapé sem duplicar o cabeçalho', () => {
  const runs = extractPageWidgetTextRuns({
    bodyWidgets: [{ childWidgets: [paragraph([line([textElement({ text: 'corpo' })])])] }],
    headerWidgetIn: { childWidgets: [paragraph([line([textElement({ text: 'processo 1234' })])])] },
    footerWidgetIn: { childWidgets: [paragraph([line([textElement({ text: 'OAB/MT 12345' })])])] },
  });

  assert.deepEqual(runs.map((run) => run.text).sort(), ['OAB/MT 12345', 'corpo', 'processo 1234']);
});

test('parágrafo sem posição não gera trecho (melhor sem texto que no lugar errado)', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([
    paragraph([line([textElement()])], { x: undefined, y: undefined }),
  ]));

  assert.deepEqual(runs, []);
});

test('sobrescrito reduz a fonte e mantém a linha de base acima', () => {
  const runs = extractPageWidgetTextRuns(bodyPage([paragraph([line([
    textElement({
      text: 'o',
      characterFormat: { fontSize: 12, baselineAlignment: 'Superscript', fontFamily: 'Times New Roman' },
    }),
  ])])]));

  assert.equal(runs[0].fontSizePt, 8);
  // 120 + 13 / 1.5
  assert.ok(Math.abs(runs[0].baselinePx - 128.666) < 0.01);
});

test('árvore estranha devolve vazio em vez de explodir', () => {
  assert.deepEqual(extractPageWidgetTextRuns(null), []);
  assert.deepEqual(extractPageWidgetTextRuns({}), []);
  assert.deepEqual(extractPageWidgetTextRuns({ bodyWidgets: 'nada' }), []);
});
