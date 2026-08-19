import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_CONTROLS_CLEARANCE,
  CALL_WIDGET_MARGIN,
  clampCallWidgetPosition,
  defaultCallWidgetPosition,
  parseStoredPosition,
  selfViewPosition,
  topCenterPosition,
} from './callWidgetPlacement.ts';

const VIEWPORT = { width: 1440, height: 900 };
const SIZE = { width: 280, height: 320 };

test('nasce no canto inferior direito, com folga para o launcher do chat', () => {
  const p = defaultCallWidgetPosition(VIEWPORT, SIZE);
  assert.equal(p.x, 1440 - 280 - CALL_WIDGET_MARGIN);
  assert.ok(p.y + SIZE.height < VIEWPORT.height, 'o painel inteiro cabe na tela');
  assert.ok(p.y > 0);
});

test('arrastar para fora da janela devolve o painel para dentro', () => {
  const longe = clampCallWidgetPosition({ x: 99999, y: 99999 }, VIEWPORT, SIZE);
  assert.equal(longe.x, VIEWPORT.width - SIZE.width - CALL_WIDGET_MARGIN);
  assert.equal(longe.y, VIEWPORT.height - SIZE.height - CALL_WIDGET_MARGIN);

  const negativo = clampCallWidgetPosition({ x: -400, y: -80 }, VIEWPORT, SIZE);
  assert.deepEqual(negativo, { x: CALL_WIDGET_MARGIN, y: CALL_WIDGET_MARGIN });
});

test('janela menor que o painel: vence a margem de cima e da esquerda', () => {
  const apertado = clampCallWidgetPosition({ x: 500, y: 500 }, { width: 200, height: 200 }, SIZE);
  assert.deepEqual(apertado, { x: CALL_WIDGET_MARGIN, y: CALL_WIDGET_MARGIN });
});

test('posição guardada só é aceita como par de números', () => {
  assert.deepEqual(parseStoredPosition('{"x":120,"y":40}'), { x: 120, y: 40 });
  assert.equal(parseStoredPosition(null), null);
  assert.equal(parseStoredPosition('nada disso'), null);
  assert.equal(parseStoredPosition('{"x":"120","y":40}'), null);
  assert.equal(parseStoredPosition('{"x":null}'), null);
  assert.equal(parseStoredPosition('[1,2]'), null);
});

test('o convite de chamada recebida nasce no alto e ao centro', () => {
  const p = topCenterPosition(VIEWPORT, { width: 400, height: 180 });
  assert.equal(p.x, (1440 - 400) / 2);
  assert.equal(p.y, CALL_WIDGET_MARGIN);
});

test('convite mais largo que a janela encosta na margem, sem x negativo', () => {
  const p = topCenterPosition({ width: 320, height: 640 }, { width: 400, height: 180 });
  assert.equal(p.x, CALL_WIDGET_MARGIN);
});

test('o aviso de chamada perdida nasce onde o convite nasce — alto e ao centro', () => {
  const p = topCenterPosition(VIEWPORT, { width: 352, height: 260 });
  assert.equal(p.x, (1440 - 352) / 2);
  assert.equal(p.y, CALL_WIDGET_MARGIN);
});

test('a nossa imagem na tela cheia não nasce em cima dos controles', () => {
  const mini = { width: 176, height: 132 };
  const p = selfViewPosition(VIEWPORT, mini);
  assert.equal(p.x, VIEWPORT.width - mini.width - CALL_WIDGET_MARGIN);
  assert.equal(p.y, VIEWPORT.height - mini.height - CALL_CONTROLS_CLEARANCE);
  assert.ok(p.y + mini.height < VIEWPORT.height - 60, 'sobra faixa para a barra de botões');
});

test('numa janela baixa a miniatura ainda cabe na tela', () => {
  const mini = { width: 176, height: 132 };
  const p = selfViewPosition({ width: 420, height: 200 }, mini);
  assert.ok(p.y >= CALL_WIDGET_MARGIN);
  assert.ok(p.x >= CALL_WIDGET_MARGIN);
});
