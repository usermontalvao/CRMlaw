import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acharAncoras, aplicar, caixaDaImagem, caixaEmPorcentagem, IDENTIDADE, multiplicar,
  type Matriz,
} from './ancoraNoPdf.ts';

const perto = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('uma imagem reta vira largura, altura e ponto — o caso comum', () => {
  const achados = acharAncoras('q 120 0 0 40 90 620 cm /Im3 Do Q', new Set(['Im3']));
  assert.equal(achados.length, 1);
  assert.deepEqual(achados[0].caixa, { x: 90, y: 620, largura: 120, altura: 40 });
});

test('só as âncoras PROCURADAS entram — `Do` também desenha formulários', () => {
  // Um XObject do tipo Form desenhado na mesma página não é uma âncora, e
  // aceitá-lo criaria um campo de assinatura em cima de um cabeçalho.
  const fluxo = 'q 50 0 0 50 10 10 cm /Fm0 Do Q q 30 0 0 20 5 700 cm /Im9 Do Q';
  const achados = acharAncoras(fluxo, new Set(['Im9']));
  assert.deepEqual(achados.map((a) => a.nome), ['Im9']);
  assert.deepEqual(achados[0].caixa, { x: 5, y: 700, largura: 30, altura: 20 });
});

test('q/Q é PILHA — o que fecha não vaza para o que vem depois', () => {
  // Sem empilhar, a segunda imagem herdaria o deslocamento do bloco fechado e
  // cairia longe do lugar. É o defeito mais provável de um leitor ingênuo.
  const fluxo = [
    'q 1 0 0 1 100 100 cm',        // desloca
    'q 10 0 0 10 0 0 cm /Im1 Do Q', // dentro: soma o deslocamento
    'Q',                            // fecha o deslocamento
    'q 10 0 0 10 0 0 cm /Im2 Do Q', // fora: NÃO pode herdar nada
  ].join(' ');
  const achados = acharAncoras(fluxo, new Set(['Im1', 'Im2']));
  assert.deepEqual(achados[0].caixa, { x: 100, y: 100, largura: 10, altura: 10 });
  assert.deepEqual(achados[1].caixa, { x: 0, y: 0, largura: 10, altura: 10 });
});

test('dois `cm` seguidos se COMPÕEM, na ordem certa', () => {
  // `cm` pré-multiplica. Inverter a ordem só se nota quando há escala junto de
  // translação — e aí a imagem sai no lugar errado por um fator.
  const fluxo = 'q 2 0 0 2 0 0 cm 1 0 0 1 10 20 cm /Im0 Do Q';
  const [a] = acharAncoras(fluxo, new Set(['Im0']));
  // a translação acontece no espaço JÁ escalado: (10,20) × 2 = (20,40)
  assert.deepEqual(a.caixa, { x: 20, y: 40, largura: 2, altura: 2 });
});

test('imagem girada devolve a caixa que a contém, não números negativos', () => {
  // 90°: [0 1 -1 0 …]. Uma leitura que assumisse b=c=0 daria largura/altura
  // zero — e um campo de assinatura de tamanho zero é invisível e insondável.
  const fluxo = 'q 0 100 -50 0 300 400 cm /Im1 Do Q';
  const [a] = acharAncoras(fluxo, new Set(['Im1']));
  perto(a.caixa.largura, 50);
  perto(a.caixa.altura, 100);
  perto(a.caixa.x, 250);
  perto(a.caixa.y, 400);
});

test('parênteses e nomes dentro de texto não viram operandos', () => {
  // `(120 0 0 40 90 620 cm) Tj` é TEXTO. Um tokenizador que o lesse como
  // números moveria a âncora seguinte para uma posição inventada.
  const fluxo = 'BT (120 0 0 40 90 620 cm /Im3 Do) Tj ET q 10 0 0 10 1 2 cm /Im3 Do Q';
  const achados = acharAncoras(fluxo, new Set(['Im3']));
  assert.equal(achados.length, 1, 'o texto não pode contar como desenho');
  assert.deepEqual(achados[0].caixa, { x: 1, y: 2, largura: 10, altura: 10 });
});

test('string com parêntese escapado não desalinha a leitura', () => {
  const fluxo = 'BT (fim \\) ainda dentro) Tj ET q 5 0 0 5 7 8 cm /Im1 Do Q';
  const [a] = acharAncoras(fluxo, new Set(['Im1']));
  assert.deepEqual(a.caixa, { x: 7, y: 8, largura: 5, altura: 5 });
});

test('string hexadecimal é pulada, e `<<` de dicionário não a confunde', () => {
  const fluxo = 'BT <48656C6C6F> Tj ET /P <</MCID 0>> BDC q 3 0 0 3 9 9 cm /Im2 Do Q EMC';
  const [a] = acharAncoras(fluxo, new Set(['Im2']));
  assert.deepEqual(a.caixa, { x: 9, y: 9, largura: 3, altura: 3 });
});

test('a mesma âncora desenhada duas vezes devolve as duas posições', () => {
  // Acontece de verdade: dois `[[ASSINATURA]]` no mesmo documento reusam o
  // mesmo XObject. Devolver só a primeira perderia um campo.
  const fluxo = 'q 10 0 0 10 0 0 cm /Im1 Do Q q 10 0 0 10 200 300 cm /Im1 Do Q';
  const achados = acharAncoras(fluxo, new Set(['Im1']));
  assert.equal(achados.length, 2);
  assert.equal(achados[1].caixa.x, 200);
});

test('Q a mais não estoura — volta para a identidade', () => {
  // Fluxo malformado não pode derrubar o congelamento de um envelope.
  const achados = acharAncoras('Q Q q 4 0 0 4 1 1 cm /Im1 Do Q', new Set(['Im1']));
  assert.deepEqual(achados[0].caixa, { x: 1, y: 1, largura: 4, altura: 4 });
});

test('multiplicar e aplicar: identidade não move nada', () => {
  assert.deepEqual(multiplicar(IDENTIDADE, IDENTIDADE), IDENTIDADE);
  const p = aplicar(IDENTIDADE, 3, 7);
  assert.deepEqual(p, { x: 3, y: 7 });
});

test('caixaDaImagem do quadrado unitário sem transformação', () => {
  assert.deepEqual(caixaDaImagem(IDENTIDADE), { x: 0, y: 0, largura: 1, altura: 1 });
});

test('a porcentagem INVERTE o eixo Y — o PDF conta de baixo, o campo de cima', () => {
  // A4: 595×842. Uma âncora a 100 pt do rodapé está a 742−altura do topo.
  const pct = caixaEmPorcentagem({ x: 59.5, y: 100, largura: 119, altura: 42 }, 595, 842)!;
  perto(pct.x_percent, 10);
  perto(pct.w_percent, 20);
  perto(pct.h_percent, (42 / 842) * 100);
  // topo = 842 − (100 + 42) = 700
  perto(pct.y_percent, (700 / 842) * 100);
});

test('página de tamanho inválido devolve null em vez de Infinity', () => {
  assert.equal(caixaEmPorcentagem({ x: 0, y: 0, largura: 1, altura: 1 }, 0, 842), null);
  assert.equal(caixaEmPorcentagem({ x: 0, y: 0, largura: 1, altura: 1 }, 595, 0), null);
});

test('a caixa no topo da folha dá y_percent perto de zero, não de cem', () => {
  // O teste que pega a inversão trocada: uma âncora colada no topo tem de sair
  // com y_percent ≈ 0. Se sair ≈ 100, o eixo está invertido ao contrário.
  const alturaDaPagina = 842;
  const pct = caixaEmPorcentagem(
    { x: 0, y: alturaDaPagina - 50, largura: 100, altura: 50 }, 595, alturaDaPagina,
  )!;
  perto(pct.y_percent, 0);
});

test('matriz de escala pura não desloca a origem', () => {
  const m: Matriz = [3, 0, 0, 5, 0, 0];
  assert.deepEqual(caixaDaImagem(m), { x: 0, y: 0, largura: 3, altura: 5 });
});
