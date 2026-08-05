import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, pointFromPointer, strokeWidthPx, fontSizePx, hasInk, undoLast,
  isFreehand, isShape, isText, textBoundsPx, hitTestText,
  type AnnotationItem,
} from './imageAnnotation.ts';

const rect = { left: 100, top: 50, width: 400, height: 200 };

test('grampeia a coordenada entre 0 e 1', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(0.42), 0.42);
});

test('converte a posição do ponteiro para coordenada da imagem', () => {
  assert.deepEqual(pointFromPointer(100, 50, rect), { x: 0, y: 0 });
  assert.deepEqual(pointFromPointer(500, 250, rect), { x: 1, y: 1 });
  assert.deepEqual(pointFromPointer(300, 150, rect), { x: 0.5, y: 0.5 });
});

test('arrastar para fora da imagem encosta a anotação na borda', () => {
  assert.deepEqual(pointFromPointer(0, 0, rect), { x: 0, y: 0 });
  assert.deepEqual(pointFromPointer(9999, 9999, rect), { x: 1, y: 1 });
});

test('rect sem dimensão não quebra a conversão', () => {
  assert.deepEqual(pointFromPointer(10, 10, { left: 0, top: 0, width: 0, height: 0 }), { x: 0, y: 0 });
});

test('espessura escala com a largura da imagem', () => {
  assert.equal(strokeWidthPx({ kind: 'pen', size: 0.01 }, 1000), 10);
  assert.equal(strokeWidthPx({ kind: 'pen', size: 0.01 }, 2000), 20);
  assert.ok(strokeWidthPx({ kind: 'marker', size: 0.01 }, 1000) > strokeWidthPx({ kind: 'pen', size: 0.01 }, 1000));
});

test('espessura e fonte nunca ficam invisíveis', () => {
  assert.equal(strokeWidthPx({ kind: 'pen', size: 0.0001 }, 10), 1);
  assert.equal(fontSizePx(0.0001, 10), 11);
});

test('fonte escala com a largura da imagem', () => {
  assert.ok(fontSizePx(0.011, 2000) > fontSizePx(0.011, 1000));
});

test('identifica a família de cada anotação', () => {
  const lapis: AnnotationItem = { kind: 'pen', color: '#fff', size: 0.01, points: [] };
  const seta: AnnotationItem = { kind: 'arrow', color: '#fff', size: 0.01, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
  const texto: AnnotationItem = { kind: 'text', color: '#fff', size: 0.01, at: { x: 0, y: 0 }, text: 'oi' };
  assert.ok(isFreehand(lapis) && !isShape(lapis) && !isText(lapis));
  assert.ok(isShape(seta) && !isFreehand(seta));
  assert.ok(isText(texto) && !isShape(texto));
});

test('traço sem ponto não conta como anotação', () => {
  assert.equal(hasInk({ kind: 'pen', color: '#fff', size: 0.01, points: [] }), false);
  assert.equal(hasInk({ kind: 'pen', color: '#fff', size: 0.01, points: [{ x: 0.1, y: 0.1 }] }), true);
});

test('texto em branco não vira anotação', () => {
  const base = { kind: 'text' as const, color: '#fff', size: 0.01, at: { x: 0.2, y: 0.2 } };
  assert.equal(hasInk({ ...base, text: '' }), false);
  assert.equal(hasInk({ ...base, text: '   ' }), false);
  assert.equal(hasInk({ ...base, text: 'Assinar aqui' }), true);
});

test('forma sem arrasto (clique solto) não vira anotação', () => {
  const base = { kind: 'rect' as const, color: '#fff', size: 0.01, from: { x: 0.5, y: 0.5 } };
  assert.equal(hasInk({ ...base, to: { x: 0.5, y: 0.5 } }), false);
  assert.equal(hasInk({ ...base, to: { x: 0.5005, y: 0.5005 } }), false, 'tremida do clique não conta');
  assert.equal(hasInk({ ...base, to: { x: 0.7, y: 0.6 } }), true);
});

// Medidor previsível: cada caractere ocupa meia altura de fonte.
const medir = (linha: string, fontPx: number) => linha.length * fontPx * 0.5;

test('caixa do texto cobre a largura da linha mais longa', () => {
  const item = { kind: 'text' as const, color: '#fff', size: 0.02, at: { x: 0.1, y: 0.2 }, text: 'ab\nabcd' };
  const b = textBoundsPx(item, medir, 1000, 500);
  assert.equal(b.x, 100);
  assert.equal(b.y, 100);
  assert.equal(b.w, medir('abcd', fontSizePx(0.02, 1000)), 'usa a linha mais longa');
  assert.ok(b.h > fontSizePx(0.02, 1000), 'duas linhas ocupam mais que uma');
});

test('acerta o texto sob o ponto e ignora o que está longe', () => {
  const texto = { kind: 'text' as const, color: '#fff', size: 0.02, at: { x: 0.1, y: 0.2 }, text: 'Conferir' };
  const lista: AnnotationItem[] = [texto];
  assert.equal(hitTestText(lista, 110, 110, medir, 1000, 500), 0, 'dentro da caixa');
  assert.equal(hitTestText(lista, 900, 450, medir, 1000, 500), null, 'longe do texto');
});

test('o clique pega o texto de cima quando dois se sobrepõem', () => {
  const base = { kind: 'text' as const, color: '#fff', size: 0.02, at: { x: 0.1, y: 0.2 } };
  const lista: AnnotationItem[] = [{ ...base, text: 'antigo' }, { ...base, text: 'novo' }];
  assert.equal(hitTestText(lista, 110, 110, medir, 1000, 500), 1, 'o último desenhado vence');
});

test('traço e forma não são pegos pelo teste de texto', () => {
  const lista: AnnotationItem[] = [
    { kind: 'pen', color: '#fff', size: 0.02, points: [{ x: 0.1, y: 0.2 }] },
    { kind: 'rect', color: '#fff', size: 0.02, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
  ];
  assert.equal(hitTestText(lista, 110, 110, medir, 1000, 500), null);
});

test('desfazer remove a última anotação sem mutar a lista original', () => {
  const a: AnnotationItem = { kind: 'pen', color: '#fff', size: 0.01, points: [{ x: 0, y: 0 }] };
  const b: AnnotationItem = { kind: 'marker', color: '#ffd400', size: 0.02, points: [{ x: 1, y: 1 }] };
  const lista = [a, b];
  assert.deepEqual(undoLast(lista), [a]);
  assert.equal(lista.length, 2, 'a lista original não pode ser mutada');
  assert.deepEqual(undoLast([]), []);
});
