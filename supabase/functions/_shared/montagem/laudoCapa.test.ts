import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALTURA_MINIMA_DO_CARTAO,
  MAXIMO_DE_PROVAS_NO_CARTAO,
  PISO_DOS_CARTOES,
  alturaDoCartao,
} from './laudoCapa.ts';
import { quebrarTexto } from './laudoDesign.ts';

const fonte = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5 };

test('poucos fatores não encolhem o cartão abaixo do mínimo', () => {
  assert.equal(alturaDoCartao(1), ALTURA_MINIMA_DO_CARTAO);
  assert.equal(alturaDoCartao(0), ALTURA_MINIMA_DO_CARTAO);
});

test('a partir de certo ponto o cartão CRESCE com as linhas', () => {
  // É a correção do defeito: com altura fixa, os itens extras eram desenhados
  // por cima do rodapé do cartão.
  const com8 = alturaDoCartao(8);
  const com12 = alturaDoCartao(12);
  assert.ok(com12 > com8, 'mais linhas têm de dar mais altura');
  assert.equal(com12 - com8, 4 * 13, 'cada linha vale 13 pt');
});

test('a base é 86, não 78 — a última linha não cola no fundo', () => {
  // 86 dá 13 pt de respiro entre a última linha e a base do cartão. Com uma
  // linha por item a diferença não aparecia; com itens que quebram, sim.
  const linhas = 20;
  assert.equal(alturaDoCartao(linhas), 86 + linhas * 13);
});

test('UM FATOR COMPRIDO NÃO INVADE O ITEM SEGUINTE', () => {
  // O defeito original em uma frase: a altura vinha de `itens * 13`, mas o
  // desenho quebrava linha. Este teste reproduz o cenário REAL em que ele
  // aparecia — um signatário com muitos fatores E um deles comprido —, porque
  // com poucos itens o mínimo de 180 pt absorve a diferença e nada quebra.
  const provas = [
    'Assinatura manuscrita digital',
    'Identidade confirmada por código enviado ao número informado',
    'Google ID: 118273645500192837465',
    'Endereço IP: 200.1.2.3',
    'Geolocalização: -15.601234567890, -56.097654321098 (precisão aproximada de 12 metros)',
    'Verificação facial (selfie)',
    'Dispositivo: iPhone 15 Pro Max - Safari 17 - iOS 18.2',
    'Autenticação via Link por E-mail (nome.sobrenome@escritorio.adv.br)',
  ];
  const larguraEstreita = 120;
  const linhasPorProva = provas.map((p) => quebrarTexto(p, fonte, 7.5, larguraEstreita));
  const totalReal = linhasPorProva.reduce((s, l) => s + l.length, 0);

  assert.ok(totalReal > provas.length, 'o cenário precisa mesmo ter quebra de linha');
  assert.ok(alturaDoCartao(totalReal) > ALTURA_MINIMA_DO_CARTAO, 'e precisa passar do mínimo');

  const alturaCerta = alturaDoCartao(totalReal);
  const alturaIngenua = alturaDoCartao(provas.length);
  assert.ok(
    alturaCerta > alturaIngenua,
    `a altura tem de sair das LINHAS (${totalReal}), não da contagem de itens `
    + `(${provas.length}): ${alturaCerta} contra ${alturaIngenua}`,
  );

  // E o espaço reservado tem de caber o desenho de verdade: 55 pt até a
  // primeira linha, 13 por linha, e a folga do rodapé do cartão.
  const alturaDesenhada = 55 + totalReal * 13;
  assert.ok(
    alturaCerta >= alturaDesenhada,
    `o cartão (${alturaCerta}) tem de caber o que é desenhado (${alturaDesenhada})`,
  );
});

test('abaixo do mínimo, a diferença é absorvida de propósito', () => {
  // Documenta o limite do teste acima: com 3 fatores curtos, quebrando ou não,
  // o cartão tem 180 pt. Não é bug — é o piso do desenho.
  assert.equal(alturaDoCartao(3), alturaDoCartao(5));
  assert.equal(alturaDoCartao(3), ALTURA_MINIMA_DO_CARTAO);
});

test('o teto de fatores protege a altura do cartão', () => {
  // Sem teto, um signatário com muitos dados geraria um cartão maior que a
  // página e o laço de empilhamento nunca colocaria nenhum.
  assert.equal(MAXIMO_DE_PROVAS_NO_CARTAO, 8);
  const alturaNoTeto = alturaDoCartao(MAXIMO_DE_PROVAS_NO_CARTAO * 2);
  assert.ok(alturaNoTeto < 841.89 - PISO_DOS_CARTOES, 'mesmo no teto, o cartão cabe na folha');
});

test('o piso deixa espaço para o rodapé da folha', () => {
  assert.ok(PISO_DOS_CARTOES >= 64, 'a faixa do rodapé tem 64 pt — o piso não pode ser menor');
});

test('a altura é sempre um número utilizável', () => {
  for (const n of [-5, 0, 1, 7, 40]) {
    const h = alturaDoCartao(n);
    assert.ok(Number.isFinite(h) && h > 0, `altura inválida para ${n} linhas: ${h}`);
  }
});
