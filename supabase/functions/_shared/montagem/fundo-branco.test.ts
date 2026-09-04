import test from 'node:test';
import assert from 'node:assert/strict';
import { apagarFundoBranco, recorteApagouDemais } from './fundo-branco.ts';

/** Monta uma imagem RGBA a partir de uma lista de cores `[r,g,b]`. */
function imagem(cores: Array<[number, number, number]>): Uint8Array {
  const rgba = new Uint8Array(cores.length * 4);
  cores.forEach(([r, g, b], i) => {
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
  });
  return rgba;
}

const alfa = (rgba: Uint8Array, i: number) => rgba[i * 4 + 3];

test('branco vira transparente; o traço fica', () => {
  const px = imagem([[255, 255, 255], [10, 10, 10], [250, 251, 252]]);
  const r = apagarFundoBranco(px);

  assert.equal(alfa(px, 0), 0, 'o branco tinha de sumir');
  assert.equal(alfa(px, 1), 255, 'o traço da assinatura tinha de ficar');
  assert.equal(alfa(px, 2), 0, 'quase branco também é fundo');
  assert.deepEqual(r, { apagados: 2, total: 3 });
});

test('o limiar é o de produção, e a auréola é conhecida', () => {
  // Entre 200 e 240 nada é tocado: é a auréola clara que sobra em volta do
  // traço. Está aqui escrito como comportamento ESPERADO porque copiar a regra
  // de hoje é o que permite comparar o porte; melhorar o recorte agora faria
  // toda página acusar diferença na bancada.
  const px = imagem([[235, 235, 235], [241, 241, 241]]);
  apagarFundoBranco(px);
  assert.equal(alfa(px, 0), 255, 'cinza-claro NÃO é apagado — auréola conhecida');
  assert.equal(alfa(px, 1), 0);
});

test('branco em um canal só não é fundo', () => {
  // Assinatura em caneta azul clara sobre papel: o azul tem canal alto, e
  // apagar por um canal só comeria o traço.
  const px = imagem([[255, 255, 100]]);
  apagarFundoBranco(px);
  assert.equal(alfa(px, 0), 255);
});

test('o limiar é ajustável sem mexer no código', () => {
  const px = imagem([[200, 200, 200]]);
  apagarFundoBranco(px, { limiar: 150 });
  assert.equal(alfa(px, 0), 0);
});

test('assinatura apagada por inteiro é denunciada', () => {
  // O defeito que ninguém via: apagar 100% dos pixels não lança erro nenhum, e
  // o documento sai assinado com um retângulo vazio no lugar da assinatura.
  const px = imagem([[255, 255, 255], [254, 254, 254], [255, 255, 255]]);
  const r = apagarFundoBranco(px);
  assert.equal(r.apagados, 3);
  assert.equal(recorteApagouDemais(r), true, 'sumiu tudo e ninguém reclamou');
});

test('assinatura normal passa sem alarme falso', () => {
  // Uma assinatura de verdade é quase toda fundo: o traço ocupa pouco. O alarme
  // não pode disparar por isso, senão vira ruído e alguém o desliga.
  const cores: Array<[number, number, number]> = [];
  for (let i = 0; i < 1000; i++) cores.push(i < 20 ? [5, 5, 5] : [255, 255, 255]);
  const px = imagem(cores);
  const r = apagarFundoBranco(px);
  assert.equal(r.apagados, 980);
  assert.equal(recorteApagouDemais(r), false, '2% de tinta é assinatura, não imagem vazia');
});

test('imagem vazia não passa por boa', () => {
  assert.equal(recorteApagouDemais({ apagados: 0, total: 0 }), true);
});
