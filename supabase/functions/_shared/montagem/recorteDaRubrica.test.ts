import test from 'node:test';
import assert from 'node:assert/strict';

import { recortarFundoDaRubrica, type CodecPng, type ImagemRgba } from './recorteDaRubrica.ts';

/**
 * Codec de mentira: guarda a imagem crua num cabeçalho mínimo. Não comprime
 * nada — o que está sob teste é a REGRA, não o PNG.
 */
function codecFalso(imagem: ImagemRgba | null, quebrarAoCodificar = false): CodecPng {
  return {
    decodificar: () => {
      if (!imagem) throw new Error('PNG ilegível');
      return imagem;
    },
    codificar: ({ width, height, data }) => {
      if (quebrarAoCodificar) throw new Error('sem memória');
      const saida = new Uint8Array(8 + data.length);
      saida[0] = width & 0xff; saida[4] = height & 0xff;
      saida.set(data, 8);
      return saida;
    },
  };
}

/** Uma imagem RGBA: `tinta` pixels escuros, o resto branco. */
function imagem(pixels: number, tinta: number): ImagemRgba {
  const data = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const escuro = i < tinta;
    data[i * 4] = escuro ? 10 : 255;
    data[i * 4 + 1] = escuro ? 10 : 255;
    data[i * 4 + 2] = escuro ? 10 : 255;
    data[i * 4 + 3] = 255;
  }
  return { width: pixels, height: 1, data, channels: 4, depth: 8 };
}

const PNG_FALSO = new Uint8Array([1, 2, 3, 4]);

test('o fundo branco vira transparente e a rubrica recortada é a que volta', () => {
  const img = imagem(1000, 200);
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(img));
  assert.equal(r.recortado, true);
  assert.equal(r.motivo, null);
  assert.equal(r.apagados, 800);
  assert.equal(r.total, 1000);
  assert.notEqual(r.png, PNG_FALSO);
});

test('rubrica que sumiria inteira volta ORIGINAL, com fundo branco e tudo', () => {
  // O defeito que este módulo existe para pegar: assinatura clara demais, ou
  // digitalizada quase toda em branco, é apagada por completo — e o documento
  // sai assinado com um retângulo vazio no lugar da assinatura. Fundo branco
  // indesejado é feio; assinatura ausente é um documento SEM assinatura.
  const img = imagem(1000, 2); // 0,2% de tinta, abaixo do piso de 0,5%
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(img));
  assert.equal(r.recortado, false);
  assert.equal(r.motivo, 'apagou-demais');
  assert.equal(r.png, PNG_FALSO);
});

test('imagem toda branca também volta original — é o caso extremo do mesmo defeito', () => {
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(imagem(500, 0)));
  assert.equal(r.recortado, false);
  assert.equal(r.motivo, 'apagou-demais');
});

test('PNG sem os quatro canais não é tocado — alfa em buffer de 3 desalinha tudo', () => {
  const semAlfa: ImagemRgba = {
    width: 2, height: 1, data: new Uint8Array([255, 255, 255, 255, 255, 255]), channels: 3, depth: 8,
  };
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(semAlfa));
  assert.equal(r.motivo, 'formato-inesperado');
  assert.equal(r.png, PNG_FALSO);
});

test('PNG de 16 bits por canal também passa intacto', () => {
  const img = { ...imagem(100, 50), depth: 16 };
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(img));
  assert.equal(r.motivo, 'formato-inesperado');
});

test('codec que explode na leitura não derruba a montagem', () => {
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(null));
  assert.equal(r.recortado, false);
  assert.equal(r.motivo, 'falhou');
  assert.equal(r.png, PNG_FALSO);
});

test('codec que explode na ESCRITA também cai na original', () => {
  const r = recortarFundoDaRubrica(PNG_FALSO, codecFalso(imagem(1000, 200), true));
  assert.equal(r.recortado, false);
  assert.equal(r.motivo, 'falhou');
  assert.equal(r.png, PNG_FALSO);
});
