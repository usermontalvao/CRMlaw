import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acharMarcadores,
  campoEmPorcentagem,
  criarRegexDeMarcador,
  mascaraPara,
} from './marcadoresDeAssinatura.ts';

test('acha o marcador simples', () => {
  const m = acharMarcadores('Assinatura do contratante: [[ASSINATURA]] — obrigado.');
  assert.equal(m.length, 1);
  assert.equal(m[0].indiceDoAssinante, 1);
  assert.equal(m[0].bruto, '[[ASSINATURA]]');
});

test('aceita minúscula, espaço interno e índice de assinante', () => {
  const m = acharMarcadores('a [[assinatura]] b [[ ASSINATURA ]] c [[Assinatura_2]] d');
  assert.deepEqual(m.map((x) => x.indiceDoAssinante), [1, 1, 2]);
});

test('marcador PARTIDO pelo Word é achado, porque o texto vem contínuo', () => {
  // O Word quebra um parágrafo em vários `runs` por qualquer motivo de
  // formatação. Quem procura nó a nó não acha NADA aqui — e o documento é
  // perfeitamente válido. É o caso que justifica concatenar antes de procurar.
  const pedacos = ['Assine aqui: [[ASS', 'INAT', 'URA]] com firma reconhecida'];
  const m = acharMarcadores(pedacos.join(''));
  assert.equal(m.length, 1, 'marcador partido em runs precisa ser encontrado');
  assert.equal(m[0].bruto, '[[ASSINATURA]]');
});

test('os índices apontam exatamente para o marcador', () => {
  const texto = 'abc[[ASSINATURA]]def';
  const [m] = acharMarcadores(texto);
  assert.equal(texto.slice(m.inicio, m.fim), '[[ASSINATURA]]');
});

test('vários marcadores na mesma folha saem todos, na ordem', () => {
  const m = acharMarcadores('[[ASSINATURA]] ... [[ASSINATURA_2]] ... [[ASSINATURA_3]]');
  assert.deepEqual(m.map((x) => x.indiceDoAssinante), [1, 2, 3]);
  assert.ok(m[0].inicio < m[1].inicio && m[1].inicio < m[2].inicio);
});

test('texto sem marcador devolve lista vazia, não erro', () => {
  assert.deepEqual(acharMarcadores('contrato comum, sem marcador nenhum'), []);
  assert.deepEqual(acharMarcadores(''), []);
});

test('não confunde colchete solto nem palavra parecida', () => {
  assert.deepEqual(acharMarcadores('[ASSINATURA] [[ASSINATURAS]] [[ASSIN]]'), []);
});

test('cada chamada começa do zero (o lastIndex não vaza entre folhas)', () => {
  // Se a regex fosse uma constante compartilhada com a flag `g`, a segunda folha
  // começaria a busca de onde a primeira parou — e marcadores sumiriam em
  // silêncio, sem erro nenhum. Este teste é o que impede aquela otimização.
  const texto = 'x [[ASSINATURA]] y';
  assert.equal(acharMarcadores(texto).length, 1);
  assert.equal(acharMarcadores(texto).length, 1, 'a segunda chamada tem de achar igual');

  const a = criarRegexDeMarcador();
  const b = criarRegexDeMarcador();
  assert.notEqual(a, b, 'cada chamada tem de devolver uma RegExp nova');
});

test('índice zero ou negativo é descartado', () => {
  assert.deepEqual(acharMarcadores('[[ASSINATURA_0]]'), []);
});

test('converte o retângulo em porcentagens da folha', () => {
  const c = campoEmPorcentagem(
    { esquerda: 100, topo: 200, largura: 150, altura: 50 },
    { largura: 1000, altura: 1000 },
  );
  assert.equal(c?.x_percent, 10);
  assert.equal(c?.y_percent, 20);
  assert.equal(c?.w_percent, 15);
  assert.equal(c?.h_percent, 5);
});

test('marcador medido com largura ~zero vira uma rubrica visível', () => {
  // O defeito que isto evita: um run partido ou uma fonte minúscula produzem um
  // retângulo de largura quase nula. Sem piso, a assinatura sairia com 0,1% de
  // largura — invisível. Um documento com assinatura invisível parece um
  // documento NÃO assinado, que é pior do que uma assinatura fora de lugar.
  const c = campoEmPorcentagem(
    { esquerda: 10, topo: 10, largura: 0, altura: 0 },
    { largura: 1000, altura: 1000 },
  );
  assert.equal(c?.w_percent, 18, 'cai no padrão de rubrica');
  assert.equal(c?.h_percent, 7);
});

test('respeita piso e teto de largura e altura', () => {
  const enorme = campoEmPorcentagem(
    { esquerda: 0, topo: 0, largura: 900, altura: 900 },
    { largura: 1000, altura: 1000 },
  );
  assert.equal(enorme?.w_percent, 40, 'teto de largura');
  assert.equal(enorme?.h_percent, 20, 'teto de altura');

  const minusculo = campoEmPorcentagem(
    { esquerda: 0, topo: 0, largura: 1, altura: 1 },
    { largura: 1000, altura: 1000 },
  );
  assert.equal(minusculo?.w_percent, 8, 'piso de largura');
  assert.equal(minusculo?.h_percent, 4, 'piso de altura');
});

test('posição fora da folha é grampeada na borda, não descartada', () => {
  const c = campoEmPorcentagem(
    { esquerda: -50, topo: 5000, largura: 100, altura: 100 },
    { largura: 1000, altura: 1000 },
  );
  assert.equal(c?.x_percent, 0);
  assert.equal(c?.y_percent, 100);
});

test('folha sem dimensão devolve null em vez de dividir por zero', () => {
  const r = { esquerda: 0, topo: 0, largura: 10, altura: 10 };
  assert.equal(campoEmPorcentagem(r, { largura: 0, altura: 100 }), null);
  assert.equal(campoEmPorcentagem(r, { largura: 100, altura: 0 }), null);
  assert.equal(campoEmPorcentagem(r, { largura: Number.NaN, altura: 100 }), null);
});

test('a máscara tem o mesmo comprimento e não imprime nada', () => {
  // Mesmo comprimento porque apagar caracteres refluiria o parágrafo: o texto
  // seguinte andaria, e o PDF congelado deixaria de bater com o Word do autor.
  const bruto = '[[ASSINATURA_2]]';
  const mascara = mascaraPara(bruto);
  assert.equal(mascara.length, bruto.length);
  assert.equal(mascara.trim(), '', 'não pode sobrar tinta');
  assert.ok([...mascara].every((c) => c === ' '), 'espaço inquebrável, para a linha não quebrar diferente');
});
