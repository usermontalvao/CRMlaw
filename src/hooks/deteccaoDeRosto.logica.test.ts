import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIANCA_MINIMA,
  ESTABILIDADE_INICIAL,
  QUADROS_PARA_GANHAR,
  QUADROS_PARA_PERDER,
  type EstadoDeteccao,
  type RostoDetectado,
  avaliarQuadro,
  avancarEstabilidade,
  geometriaPlausivel,
  deveDispararSozinho,
} from './deteccaoDeRosto.logica.ts';

/** Roda uma sequência de quadros pelo acompanhamento de estabilidade. */
const rodar = (estados: EstadoDeteccao[]) =>
  estados.reduce(avancarEstabilidade, ESTABILIDADE_INICIAL);

const repetir = (estado: EstadoDeteccao, vezes: number): EstadoDeteccao[] =>
  Array.from({ length: vezes }, () => estado);

const LARGURA = 720;
const ALTURA = 960;

/** Rosto bem enquadrado no centro, com pontos coerentes. */
const rostoBom = (over: Partial<RostoDetectado> = {}): RostoDetectado => {
  const x1 = 240, y1 = 330, x2 = 480, y2 = 630; // 240px de largura = 33% do quadro
  return {
    topLeft: [x1, y1],
    bottomRight: [x2, y2],
    probability: [0.98],
    landmarks: [
      [300, 420], // olho direito
      [420, 420], // olho esquerdo
      [360, 490], // nariz
      [360, 560], // boca
      [255, 450], // orelha direita
      [465, 450], // orelha esquerda
    ],
    ...over,
  };
};

test('rosto centralizado e do tamanho certo libera o disparo', () => {
  assert.equal(avaliarQuadro([rostoBom()], LARGURA, ALTURA), 'pronto');
});

test('quadro sem nenhum rosto fica procurando', () => {
  assert.equal(avaliarQuadro([], LARGURA, ALTURA), 'procurando');
});

test('rosto pequeno demais vira "longe", não "pronto"', () => {
  const longe = rostoBom({ topLeft: [340, 440], bottomRight: [420, 540] }); // 80px = 11%
  assert.equal(avaliarQuadro([longe], LARGURA, ALTURA), 'longe');
});

test('rosto grande mas encostado na borda vira "fora"', () => {
  const fora = rostoBom({ topLeft: [10, 330], bottomRight: [250, 630] });
  assert.equal(avaliarQuadro([fora], LARGURA, ALTURA), 'fora');
});

test('confiança abaixo do mínimo é descartada', () => {
  const incerto = rostoBom({ probability: [CONFIANCA_MINIMA - 0.05] });
  assert.equal(avaliarQuadro([incerto], LARGURA, ALTURA), 'procurando');
});

test('confiança ausente não bloqueia — o modelo nem sempre devolve', () => {
  const semProb = rostoBom({ probability: undefined });
  assert.equal(avaliarQuadro([semProb], LARGURA, ALTURA), 'pronto');
});

test('basta UM rosto bem enquadrado, mesmo com outros ruins no quadro', () => {
  const aoFundo = rostoBom({ topLeft: [600, 100], bottomRight: [660, 180] });
  assert.equal(avaliarQuadro([aoFundo, rostoBom()], LARGURA, ALTURA), 'pronto');
});

test('geometria impossível (nariz acima dos olhos) é recusada', () => {
  const invertido = rostoBom({
    landmarks: [
      [300, 500], [420, 500], // olhos embaixo
      [360, 420],             // nariz acima deles
      [360, 380],
      [255, 520], [465, 520],
    ],
  });
  assert.equal(avaliarQuadro([invertido], LARGURA, ALTURA), 'procurando');
});

test('olhos colados demais para a caixa são recusados', () => {
  const colados = rostoBom({
    landmarks: [
      [355, 420], [365, 420], // 10px de separação numa caixa de 240
      [360, 490], [360, 560],
      [255, 450], [465, 450],
    ],
  });
  assert.equal(geometriaPlausivel(colados, 240), false);
});

test('rosto sem pontos não é julgado pela geometria', () => {
  assert.equal(geometriaPlausivel(rostoBom({ landmarks: undefined }), 240), true);
});

test('quadro de tamanho zero não quebra a conta', () => {
  assert.equal(avaliarQuadro([rostoBom()], 0, 0), 'procurando');
});

test('estabiliza depois de quadros bons SEGUIDOS', () => {
  assert.equal(rodar(repetir('pronto', QUADROS_PARA_GANHAR)).estavel, true);
});

test('rosto de passagem não chega a estabilizar', () => {
  const passagem = rodar([...repetir('pronto', QUADROS_PARA_GANHAR - 1), 'procurando']);
  assert.equal(passagem.estavel, false);
  assert.equal(passagem.bons, 0, 'o quadro ruim antes de ganhar zera a contagem');
});

test('uma piscada NÃO derruba o enquadramento já estável', () => {
  // Era exatamente isto que impedia a foto de sair sozinha: um quadro ruim
  // reiniciava a contagem regressiva, que nunca chegava a zero.
  const comPiscada = rodar([
    ...repetir('pronto', QUADROS_PARA_GANHAR),
    'procurando',
    'pronto',
  ]);
  assert.equal(comPiscada.estavel, true);
});

test('mas sair de vez do quadro derruba', () => {
  const saiu = rodar([
    ...repetir('pronto', QUADROS_PARA_GANHAR),
    ...repetir('procurando', QUADROS_PARA_PERDER),
  ]);
  assert.equal(saiu.estavel, false);
});

test('perder exige mais quadros ruins do que uma piscada', () => {
  const quaseperdeu = rodar([
    ...repetir('pronto', QUADROS_PARA_GANHAR),
    ...repetir('fora', QUADROS_PARA_PERDER - 1),
  ]);
  assert.equal(quaseperdeu.estavel, true);
});

test('mão sobre o rosto AINDA passa pelo detector local — é a IA que barra', () => {
  // Documenta o limite de propósito: se um dia isto falhar, é porque alguém
  // achou que o detector local resolve oclusão. Ele não resolve.
  const comMao = rostoBom();
  assert.equal(
    avaliarQuadro([comMao], LARGURA, ALTURA),
    'pronto',
    'o detector local só julga enquadramento; obstrução é decidida por analyze-facial-photo',
  );
});

test('o escape do portão também solta o disparo automático, não só o botão', () => {
  // O sintoma que isto conserta: a foto manual funcionava e a automática nunca
  // saía. Os escapes liberavam o BOTÃO e deixavam o automático amarrado a
  // `estavel`, que só existe com o modelo dando veredito e o rosto em 'pronto'.
  assert.equal(deveDispararSozinho({ estavel: true, escapou: false }), true);
  assert.equal(deveDispararSozinho({ estavel: false, escapou: true }), true);
  assert.equal(deveDispararSozinho({ estavel: true, escapou: true }), true);
  // Sem rosto estável e sem escape, nada dispara sozinho — a contagem só corre
  // quando há motivo.
  assert.equal(deveDispararSozinho({ estavel: false, escapou: false }), false);
});
