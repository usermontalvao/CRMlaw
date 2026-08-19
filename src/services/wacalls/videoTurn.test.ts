import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA_TURN,
  PEER_ADDED_TURN,
  normalizeTurn,
  selfViewTurn,
} from './videoTurn.ts';

test('o giro fica sempre entre 0 e 3, venha de onde vier', () => {
  assert.equal(normalizeTurn(0), 0);
  assert.equal(normalizeTurn(3), 3);
  assert.equal(normalizeTurn(4), 0);
  assert.equal(normalizeTurn(7), 3);
  assert.equal(normalizeTurn(-1), 3);
  // Lixo no localStorage não pode derrubar a câmera.
  assert.equal(normalizeTurn(NaN), 0);
  assert.equal(normalizeTurn(Number('nada disso')), 0);
});

test('o padrão de fábrica chega EM PÉ no celular do contato', () => {
  assert.equal(selfViewTurn(DEFAULT_CAMERA_TURN), 0);
});

test('sem giro nenhum, o contato vê o operador deitado (o defeito de 19/08/2026)', () => {
  assert.equal(selfViewTurn(0), PEER_ADDED_TURN);
  assert.notEqual(selfViewTurn(0), 0);
});

test('cada clique em "Girar" anda um quarto de volta na imagem que o contato vê', () => {
  const vistos = [0, 1, 2, 3].map(cliques => selfViewTurn(DEFAULT_CAMERA_TURN + cliques));
  assert.deepEqual(vistos, [0, 1, 2, 3]);
  // Quatro cliques voltam ao ponto de partida: o botão é um ciclo fechado.
  assert.equal(selfViewTurn(DEFAULT_CAMERA_TURN + 4), 0);
});
