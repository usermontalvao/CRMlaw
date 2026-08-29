import test from 'node:test';
import assert from 'node:assert/strict';
import { JANELA_VISUALIZACAO_MS, deveRegistrarVisualizacao } from './registroDeVisualizacao.ts';

const AGORA = new Date('2026-08-29T12:00:00Z').getTime();

test('a primeira abertura sempre é registrada', () => {
  assert.equal(deveRegistrarVisualizacao(null, AGORA), true);
  assert.equal(deveRegistrarVisualizacao(undefined, AGORA), true);
  assert.equal(deveRegistrarVisualizacao(0, AGORA), true);
});

test('recarregar a página logo em seguida NÃO vira um evento novo', () => {
  assert.equal(deveRegistrarVisualizacao(AGORA - 1000, AGORA), false);
  assert.equal(deveRegistrarVisualizacao(AGORA - (JANELA_VISUALIZACAO_MS - 1), AGORA), false);
});

test('voltar ao documento depois da janela vira evento — era o defeito', () => {
  // A trava antiga era permanente na sessão: abrir de novo uma hora depois não
  // gerava nada, e o histórico mostrava uma visita só.
  assert.equal(deveRegistrarVisualizacao(AGORA - JANELA_VISUALIZACAO_MS, AGORA), true);
  assert.equal(deveRegistrarVisualizacao(AGORA - 60 * 60 * 1000, AGORA), true);
});

test('várias visitas espaçadas geram vários eventos', () => {
  let ultima: number | null = null;
  let registradas = 0;
  // Cinco visitas, de 10 em 10 minutos.
  for (let i = 0; i < 5; i++) {
    const agora = AGORA + i * 10 * 60 * 1000;
    if (deveRegistrarVisualizacao(ultima, agora)) {
      registradas++;
      ultima = agora;
    }
  }
  assert.equal(registradas, 5);
});

test('uma rajada de recarregamentos conta como uma visita só', () => {
  let ultima: number | null = null;
  let registradas = 0;
  // Dez recarregamentos em 10 segundos.
  for (let i = 0; i < 10; i++) {
    const agora = AGORA + i * 1000;
    if (deveRegistrarVisualizacao(ultima, agora)) {
      registradas++;
      ultima = agora;
    }
  }
  assert.equal(registradas, 1);
});

test('relógio que andou para trás não trava o registro para sempre', () => {
  assert.equal(deveRegistrarVisualizacao(AGORA + 60 * 60 * 1000, AGORA), true);
});

test('valor corrompido na sessão não trava o registro', () => {
  assert.equal(deveRegistrarVisualizacao(Number.NaN, AGORA), true);
  assert.equal(deveRegistrarVisualizacao(-5, AGORA), true);
});
