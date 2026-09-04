import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANGULO_DA_MARCA,
  CORPO_MINIMO,
  CORPO_PRETENDIDO,
  TEXTO_DA_MARCA,
  geometriaDaMarcaDagua,
} from './marcaDagua.ts';

/** Fonte de mentira com largura proporcional — o bastante para a aritmética. */
const fonte = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.6 };

const A4 = { larguraDaPagina: 595.28, alturaDaPagina: 841.89 };

test('numa A4 a marca cabe com o corpo pretendido', () => {
  const g = geometriaDaMarcaDagua({ ...A4, fonte });
  assert.equal(g.tamanho, CORPO_PRETENDIDO);
  assert.equal(g.angulo, ANGULO_DA_MARCA);
});

test('a marca fica no MEIO da folha, não em cima do cabeçalho', () => {
  // Este é o defeito que a conta de âncora corrigiu: o texto girado em torno do
  // ponto de ancoragem subia para fora do miolo. O centro visual tem de cair
  // sobre o centro da página, com folga de meio ponto.
  const g = geometriaDaMarcaDagua({ ...A4, fonte });
  const rad = (ANGULO_DA_MARCA * Math.PI) / 180;
  const larguraDoTexto = fonte.widthOfTextAtSize(TEXTO_DA_MARCA, g.tamanho);
  const alturaDoTexto = g.tamanho * 0.72;

  const centroX = g.x + (larguraDoTexto / 2) * Math.cos(rad) - (alturaDoTexto / 2) * Math.sin(rad);
  const centroY = g.y + (larguraDoTexto / 2) * Math.sin(rad) + (alturaDoTexto / 2) * Math.cos(rad);

  assert.ok(Math.abs(centroX - A4.larguraDaPagina / 2) < 0.5, `centro x saiu em ${centroX}`);
  assert.ok(Math.abs(centroY - A4.alturaDaPagina / 2) < 0.5, `centro y saiu em ${centroY}`);
});

test('página estreita encolhe o corpo em vez de vazar pelas margens', () => {
  const estreita = geometriaDaMarcaDagua({
    larguraDaPagina: 200, alturaDaPagina: 300, fonte,
  });
  assert.ok(estreita.tamanho < CORPO_PRETENDIDO, 'o corpo tinha de encolher');

  const rad = (ANGULO_DA_MARCA * Math.PI) / 180;
  const ocupada = fonte.widthOfTextAtSize(TEXTO_DA_MARCA, estreita.tamanho) * Math.cos(rad)
    + estreita.tamanho * 0.72 * Math.sin(rad);
  assert.ok(ocupada <= 200 * 0.86 + 0.5, `ocupou ${ocupada} numa folha de 200`);
});

test('há um piso: marca ilegível é sujeira, não marca', () => {
  const minusculo = geometriaDaMarcaDagua({
    larguraDaPagina: 20, alturaDaPagina: 40, fonte,
  });
  assert.equal(minusculo.tamanho, CORPO_MINIMO);
});

test('a largura ocupada conta a INCLINAÇÃO, não só a largura do texto', () => {
  // Se a conta ignorasse o seno, uma folha logo acima do limite passaria com o
  // corpo cheio e a marca sairia pela margem.
  const rad = (ANGULO_DA_MARCA * Math.PI) / 180;
  const larguraCrua = fonte.widthOfTextAtSize(TEXTO_DA_MARCA, CORPO_PRETENDIDO);
  // Uma página em que o texto CRU cabe, mas o texto girado não.
  const largura = (larguraCrua * Math.cos(rad) + CORPO_PRETENDIDO * 0.72 * Math.sin(rad) - 2) / 0.86;
  const g = geometriaDaMarcaDagua({ larguraDaPagina: largura, alturaDaPagina: 800, fonte });
  assert.ok(g.tamanho < CORPO_PRETENDIDO, 'a inclinação tinha de ter sido levada em conta');
});
