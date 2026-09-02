import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escolherCorte,
  linhaTemTintaEm,
  MARGEM_IGNORADA,
  TOLERANCIA_DE_TINTA,
} from './fatiamentoDePagina.ts';

/** Monta um bloco RGBA de uma linha só, com tinta nas colunas pedidas. */
const linhaCom = (largura: number, colunasComTinta: number[]): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(largura * 4).fill(255);
  for (const c of colunasComTinta) {
    d[c * 4] = 0; d[c * 4 + 1] = 0; d[c * 4 + 2] = 0; d[c * 4 + 3] = 255;
  }
  return d;
};

test('o corte sobe até a linha limpa mais baixa dentro da janela', () => {
  // Texto ocupando 980..1000: cortar em 1000 partiria a linha ao meio.
  const temTinta = (y: number) => y >= 980 && y < 1000;
  assert.equal(
    escolherCorte({ alturaIdeal: 1000, janela: 120, alturaTotal: 5000, linhaTemTinta: temTinta }),
    980,
  );
});

test('sem linha limpa na janela, corta no ideal — paginar mal é melhor que não paginar', () => {
  assert.equal(
    escolherCorte({ alturaIdeal: 1000, janela: 120, alturaTotal: 5000, linhaTemTinta: () => true }),
    1000,
  );
});

test('o fim do canvas não procura nada', () => {
  assert.equal(
    escolherCorte({ alturaIdeal: 5200, janela: 120, alturaTotal: 5000, linhaTemTinta: () => true }),
    5000,
  );
});

test('a busca não passa do começo do canvas', () => {
  const corte = escolherCorte({ alturaIdeal: 50, janela: 400, alturaTotal: 5000, linhaTemTinta: () => true });
  assert.equal(corte, 50);
});

test('a borda da folha não reprova a linha inteira', () => {
  // ISTO É O DEFEITO ORIGINAL: a regra antiga exigia a linha branca de ponta a
  // ponta, e um pixel escuro na beirada — borda, sombra, artefato do
  // html2canvas — bastava para nunca achar onde cortar.
  const largura = 1000;
  const beirada = [0, 1, largura - 2, largura - 1];
  assert.equal(
    linhaTemTintaEm({ dados: linhaCom(largura, beirada), larguraDoBloco: largura, linha: 0 }),
    false,
    'pixels fora da faixa central não deveriam contar',
  );
});

test('alguns respingos de antisserrilhado passam; uma linha de texto não', () => {
  const largura = 1000;
  const examinados = Math.ceil(largura * (1 - MARGEM_IGNORADA)) - Math.floor(largura * MARGEM_IGNORADA);
  const limite = Math.floor(examinados * TOLERANCIA_DE_TINTA);

  const respingos = Array.from({ length: limite }, (_, i) => 100 + i * 3);
  assert.equal(
    linhaTemTintaEm({ dados: linhaCom(largura, respingos), larguraDoBloco: largura, linha: 0 }),
    false,
    'poucos pixels isolados não são uma linha de texto',
  );

  const textoDeVerdade = Array.from({ length: limite + 5 }, (_, i) => 100 + i * 3);
  assert.equal(
    linhaTemTintaEm({ dados: linhaCom(largura, textoDeVerdade), larguraDoBloco: largura, linha: 0 }),
    true,
    'tinta acima da tolerância é texto e não pode ser cortada',
  );
});

test('linha totalmente branca é sempre limpa', () => {
  assert.equal(
    linhaTemTintaEm({ dados: linhaCom(800, []), larguraDoBloco: 800, linha: 0 }),
    false,
  );
});
