import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTA_DA_TRILHA, corDoEvento, corDoSelo } from './laudoTrilha.ts';
import { paletaDoLaudo } from './laudoDesign.ts';

const rgb = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;
const cores = paletaDoLaudo(rgb);

test('cada tipo de evento tem a própria cor', () => {
  // É o que permite varrer a página sem ler: verde é o ato consumado, laranja é
  // a origem, roxo é o aceite, azul acinzentado é a visita.
  const assinado = corDoEvento('Assinado', cores, rgb);
  const criado = corDoEvento('Criado', cores, rgb);
  const termos = corDoEvento('Termos', cores, rgb);
  const visualizado = corDoEvento('Visualizado', cores, rgb);

  const todas = [assinado, criado, termos, visualizado];
  assert.equal(new Set(todas).size, 4, 'as quatro cores têm de ser distintas');
});

test('assinado é verde e criado é laranja', () => {
  assert.equal(corDoEvento('Assinado', cores, rgb), cores.emerald);
  assert.equal(corDoEvento('Criado', cores, rgb), cores.orange);
});

test('evento desconhecido não fica sem cor', () => {
  // Um rótulo novo (uma etapa acrescentada depois) tem de desenhar, não sumir.
  const c = corDoEvento('Recusado', cores, rgb);
  assert.equal(c, cores.txtSoft);
  assert.ok(c, 'nunca undefined — o nó da linha do tempo ficaria invisível');
});

test('o selo de um evento desconhecido tem fundo próprio, não o cinza do texto', () => {
  // Texto branco sobre `txtSoft` teria contraste ruim; o navy do selo resolve.
  assert.equal(corDoSelo('Recusado', cores, rgb), cores.navyMid);
  assert.notEqual(corDoSelo('Recusado', cores, rgb), corDoEvento('Recusado', cores, rgb));
});

test('nos tipos conhecidos, selo e nó usam a MESMA cor', () => {
  for (const r of ['Assinado', 'Visualizado', 'Criado', 'Termos']) {
    assert.equal(corDoSelo(r, cores, rgb), corDoEvento(r, cores, rgb), `divergiu em ${r}`);
  }
});

test('a nota diz o fuso — sem ele, os horários não significam nada', () => {
  // A trilha inteira é sobre QUANDO. Um horário sem fuso declarado é ambíguo
  // em qualquer discussão que envolva prazo.
  assert.ok(NOTA_DA_TRILHA.includes('Cuiabá'));
  assert.ok(NOTA_DA_TRILHA.includes('UTC-04:00'));
});

test('a nota afirma que a trilha é parte do certificado', () => {
  assert.ok(/parte integrante/i.test(NOTA_DA_TRILHA));
});
