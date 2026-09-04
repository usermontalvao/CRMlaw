import test from 'node:test';
import assert from 'node:assert/strict';
import {
  medirTinta,
  compararPaginas,
  vereditoDaPagina,
  compararEstrutura,
  descreverDiferenca,
  ptParaMm,
  type PaginaRasterizada,
} from './comparacaoDePdf.ts';

/** Uma página branca de `l`×`a` pixels, em RGBA. */
function paginaBranca(l: number, a: number): PaginaRasterizada {
  const pixels = new Uint8ClampedArray(l * a * 4).fill(255);
  return { pixels, largura: l, altura: a };
}

/** Pinta um retângulo preto (ou de um tom dado) sobre a página. */
function pintar(
  pagina: PaginaRasterizada,
  x0: number, y0: number, x1: number, y1: number,
  tom = 0,
): PaginaRasterizada {
  const pixels = Uint8ClampedArray.from(pagina.pixels as ArrayLike<number>);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * pagina.largura + x) * 4;
      pixels[i] = tom; pixels[i + 1] = tom; pixels[i + 2] = tom; pixels[i + 3] = 255;
    }
  }
  return { ...pagina, pixels };
}

test('página em branco é 0% de tinta — o defeito mais bruto que existe aqui', () => {
  const medida = medirTinta(paginaBranca(10, 10));
  assert.equal(medida.pintados, 0);
  assert.equal(medida.total, 100);
  assert.equal(medida.proporcao, 0);
});

test('tinta é qualquer pixel visivelmente diferente de branco', () => {
  const pagina = pintar(paginaBranca(10, 10), 0, 0, 4, 4);
  assert.equal(medirTinta(pagina).pintados, 25);

  // 250 é "quase branco" e NÃO conta — o limiar é o mesmo do laboratório de
  // conversão, para os dois falarem a mesma língua.
  const quaseBranca = pintar(paginaBranca(10, 10), 0, 0, 9, 9, 250);
  assert.equal(medirTinta(quaseBranca).pintados, 0);
});

test('duas páginas iguais não acusam diferença', () => {
  const a = pintar(paginaBranca(20, 20), 2, 2, 8, 8);
  const b = pintar(paginaBranca(20, 20), 2, 2, 8, 8);
  const d = compararPaginas(a, b);
  assert.equal(d.pixelsDiferentes, 0);
  assert.equal(d.caixa, null);
  assert.equal(vereditoDaPagina(d), 'IDENTICO');
});

test('a caixa diz ONDE mudou, não só quanto', () => {
  // É o que separa "o carimbo saiu do lugar" de "o documento inteiro deslizou".
  const a = paginaBranca(100, 100);
  const b = pintar(paginaBranca(100, 100), 80, 90, 89, 94);

  const d = compararPaginas(a, b);
  assert.equal(d.pixelsDiferentes, 50);
  assert.deepEqual(
    { ...d.caixa },
    { x0: 80, y0: 90, x1: 89, y1: 94, larguraPx: 10, alturaPx: 5 },
  );
});

test('antialiasing não vira alarme, mas cor trocada vira', () => {
  const base = pintar(paginaBranca(50, 50), 10, 10, 39, 39);

  // Mesma coisa desenhada por outro renderizador: bordas com 5 de desvio.
  const comRuido = pintar(paginaBranca(50, 50), 10, 10, 39, 39, 5);
  const ruido = compararPaginas(base, comRuido);
  assert.equal(ruido.pixelsDiferentes, 0, 'ruído de borda não pode contar como diferença');

  // Um bloco que era preto e virou branco: poucos pixels, desvio máximo.
  const semBloco = paginaBranca(50, 50);
  const sumiu = compararPaginas(base, semBloco);
  assert.ok(sumiu.pixelsDiferentes > 0);
  assert.equal(sumiu.maiorDesvio, 255);
  assert.equal(vereditoDaPagina(sumiu), 'DIFERENTE');
});

test('um carimbo que sumiu reprova mesmo ocupando pouca área', () => {
  // Só a régua de proporção deixaria isto passar: 30 pixels em 250 mil é
  // 0,012%. O desvio máximo é que denuncia.
  const grande = paginaBranca(500, 500);
  const comCarimbo = pintar(paginaBranca(500, 500), 0, 0, 5, 4);
  const d = compararPaginas(grande, comCarimbo);
  assert.ok(d.proporcao < 0.001, 'a proporção sozinha absolveria');
  assert.equal(vereditoDaPagina(d), 'DIFERENTE');
});

test('diferença pequena e fraca é tolerável, e é dito com todas as letras', () => {
  const a = paginaBranca(200, 200);
  const b = pintar(paginaBranca(200, 200), 0, 0, 3, 3, 200); // desvio 55, 16 px
  const d = compararPaginas(a, b);
  assert.equal(vereditoDaPagina(d), 'DIFERENCA_TOLERAVEL');
});

test('tamanho diferente não é comparado por interpolação — é reprovado', () => {
  // Redimensionar para "poder comparar" esconderia justamente o defeito de
  // geometria trocada.
  const d = compararPaginas(paginaBranca(10, 10), paginaBranca(12, 10));
  assert.equal(d.tamanhoIncompativel, true);
  assert.equal(d.pixelsComparados, 0);
  assert.equal(vereditoDaPagina(d), 'DIFERENTE');
});

test('página a mais reprova antes de olhar um pixel sequer', () => {
  // É a classe de defeito que faz um campo marcado na página 3 sair na 4.
  const a = [{ larguraPt: 595, alturaPt: 842 }, { larguraPt: 595, alturaPt: 842 }];
  const b = [...a, { larguraPt: 595, alturaPt: 842 }];
  const e = compararEstrutura(a, b);
  assert.equal(e.ok, false);
  assert.equal(e.motivo, 'número de páginas diferente: 2 contra 3');
});

test('página com geometria trocada é apontada pelo número', () => {
  const a = [{ larguraPt: 595, alturaPt: 842 }, { larguraPt: 595, alturaPt: 842 }];
  const b = [{ larguraPt: 595, alturaPt: 842 }, { larguraPt: 842, alturaPt: 595 }];
  const e = compararEstrutura(a, b);
  assert.equal(e.ok, false);
  assert.deepEqual(e.tamanhosDivergentes, [2]);
});

test('meio ponto de diferença no tamanho não reprova', () => {
  // Arredondamento de conversão de unidade não é defeito de layout.
  const a = [{ larguraPt: 595.276, alturaPt: 841.89 }];
  const b = [{ larguraPt: 595.0, alturaPt: 842.0 }];
  assert.equal(compararEstrutura(a, b).ok, true);
});

test('a frase diz quanto E onde, em milímetros', () => {
  const a = paginaBranca(100, 100);
  const b = pintar(paginaBranca(100, 100), 10, 20, 29, 29);
  const d = compararPaginas(a, b);
  const frase = descreverDiferenca(d, { mmPorPixel: 0.5 });
  assert.match(frase, /2\.000% dos pixels/);
  assert.match(frase, /área de 10\.0×5\.0 mm/);
  assert.match(frase, /a partir de 5\.0,10\.0 mm/);
});

test('ponto vira milímetro pela régua do PDF', () => {
  assert.equal(Math.round(ptParaMm(595.276)), 210); // A4 de largura
  assert.equal(Math.round(ptParaMm(841.89)), 297);  // A4 de altura
});
