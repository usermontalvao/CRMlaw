import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retangulosDoQr,
  escalarRetangulosDoQr,
  pontosPorModulo,
  ladoMinimoLegivel,
  CORRECAO_DE_ERRO_DO_QR,
  TINTA_DO_QR,
} from './qr-em-retangulos.ts';

/** Matriz escrita como texto: `#` é módulo escuro. */
function matriz(linhas: string[]): { modulos: number[]; tamanho: number } {
  const tamanho = linhas.length;
  const modulos: number[] = [];
  for (const linha of linhas) {
    assert.equal(linha.length, tamanho, 'a matriz do QR é quadrada');
    for (const c of linha) modulos.push(c === '#' ? 1 : 0);
  }
  return { modulos, tamanho };
}

test('módulos vizinhos na horizontal viram um retângulo só', () => {
  // Emendar não muda o desenho — os módulos são contíguos — e derruba o número
  // de operações de desenho de milhares para centenas.
  const { modulos, tamanho } = matriz([
    '....',
    '.###',
    '#..#',
    '....',
  ]);
  const r = retangulosDoQr(modulos, tamanho);
  assert.deepEqual(r, [
    { x: 1, y: 1, largura: 3, altura: 1 },
    { x: 0, y: 2, largura: 1, altura: 1 },
    { x: 3, y: 2, largura: 1, altura: 1 },
  ]);
});

test('matriz vazia não gera desenho nenhum', () => {
  const { modulos, tamanho } = matriz(['..', '..']);
  assert.deepEqual(retangulosDoQr(modulos, tamanho), []);
  assert.deepEqual(retangulosDoQr([], 0), []);
});

test('booleanos e números descrevem a mesma matriz', () => {
  // O `qrcode` devolve Uint8Array; um teste ou outro chamador pode passar
  // booleanos. Os dois têm de valer.
  const numeros = retangulosDoQr([0, 1, 1, 0], 2);
  const booleanos = retangulosDoQr([false, true, true, false], 2);
  assert.deepEqual(numeros, booleanos);
});

test('o QR não sai espelhado — a linha 0 é a de CIMA', () => {
  // A ARMADILHA: a matriz conta linhas de cima para baixo; o PDF conta o Y de
  // baixo para cima. Copiar o `y` direto espelha o código, e QR espelhado
  // continua PARECENDO um QR normal e simplesmente não abre nada.
  const { modulos, tamanho } = matriz([
    '#..',
    '...',
    '...',
  ]);
  const r = retangulosDoQr(modulos, tamanho);
  // lado 50 pt, 3 módulos + 2 de margem = 5 → passo 10 pt
  const emPontos = escalarRetangulosDoQr(r, tamanho, { origemX: 0, origemY: 0, lado: 50, margem: 1 });

  assert.equal(emPontos.length, 1);
  // O módulo está no ALTO à esquerda: x logo após a margem, e y no TOPO do QR.
  assert.equal(emPontos[0].x, 10);
  assert.equal(emPontos[0].y, 30, 'um módulo do topo tem de ficar na parte de cima do QR');
  assert.equal(emPontos[0].largura, 10);
  assert.equal(emPontos[0].altura, 10);
});

test('a margem clara é respeitada nos dois eixos', () => {
  const { modulos, tamanho } = matriz(['#']);
  const r = retangulosDoQr(modulos, tamanho);
  // 1 módulo + 2 de margem = 3 → passo 30/3 = 10
  const emPontos = escalarRetangulosDoQr(r, tamanho, { origemX: 100, origemY: 200, lado: 30 });
  assert.deepEqual(emPontos[0], { x: 110, y: 210, largura: 10, altura: 10 });
});

test('a origem desloca o QR inteiro', () => {
  const { modulos, tamanho } = matriz(['##', '##']);
  const r = retangulosDoQr(modulos, tamanho);
  const a = escalarRetangulosDoQr(r, tamanho, { origemX: 0, origemY: 0, lado: 40 });
  const b = escalarRetangulosDoQr(r, tamanho, { origemX: 7, origemY: 11, lado: 40 });
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].x - a[i].x, 7);
    assert.equal(b[i].y - a[i].y, 11);
  }
});

test('o QR do laudo tem tamanho suficiente para ser lido com o papel na mão', () => {
  // Um QR de correção alta para a URL de verificação fica em torno de 45×45
  // módulos. Abaixo de 0,7 pt por módulo a câmera do celular erra.
  const tamanho = 45;
  const ladoUsado = 120; // pt, o tamanho no rodapé do laudo
  assert.ok(
    pontosPorModulo(tamanho, ladoUsado) >= 0.7,
    'o QR ficou pequeno demais para ser lido impresso',
  );
  assert.equal(Math.round(ladoMinimoLegivel(tamanho)), 33);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTRA UM QR DE VERDADE
// ═══════════════════════════════════════════════════════════════════════════

test('um QR real volta a ser exatamente a mesma matriz depois de virar retângulo', async () => {
  // A prova forte foi feita uma vez contra o PNG da própria biblioteca: QR de
  // 37×37 módulos para a URL de verificação, 362 retângulos no lugar de 672
  // módulos escuros, ZERO pixels divergentes em 39×39 — orientação inclusive.
  //
  // Este teste guarda a mesma garantia sem depender do `pngjs` (que hoje só
  // existe aqui por ser dependência do `qrcode`): desenha os retângulos de
  // volta numa grade e exige a matriz original de volta, módulo a módulo. A
  // conversão de volta é escrita na mão, do jeito independente — é ela que
  // denuncia um espelhamento vertical, que de outra forma passaria batido
  // porque um QR espelhado continua PARECENDO um QR normal.
  const { default: QRCode } = await import('qrcode');

  const url = 'https://jurius.com.br/#/verificar/ABC123';
  const codigo = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const tamanho = codigo.modules.size;
  const margem = 1;
  const lado = tamanho + margem * 2; // 1 pt por módulo, para a conta fechar redonda

  const emPontos = escalarRetangulosDoQr(
    retangulosDoQr(codigo.modules.data, tamanho),
    tamanho,
    { origemX: 0, origemY: 0, lado, margem },
  );

  const desenhado = new Uint8Array(lado * lado);
  for (const r of emPontos) {
    for (let dy = 0; dy < Math.round(r.altura); dy++) {
      for (let dx = 0; dx < Math.round(r.largura); dx++) {
        const x = Math.round(r.x) + dx;
        // O PDF conta o Y de baixo para cima; a matriz, de cima para baixo.
        const linha = lado - 1 - (Math.round(r.y) + dy);
        desenhado[linha * lado + x] = 1;
      }
    }
  }

  let divergentes = 0;
  for (let linha = 0; linha < lado; linha++) {
    for (let coluna = 0; coluna < lado; coluna++) {
      const dentro = linha >= margem && linha < margem + tamanho
        && coluna >= margem && coluna < margem + tamanho;
      const original = dentro
        ? (codigo.modules.data[(linha - margem) * tamanho + (coluna - margem)] ? 1 : 0)
        : 0;
      if (original !== desenhado[linha * lado + coluna]) divergentes += 1;
    }
  }

  assert.equal(divergentes, 0, 'o QR desenhado não é o mesmo que a biblioteca gerou');
  assert.ok(emPontos.length < codigo.modules.data.reduce((a: number, b: number) => a + b, 0),
    'a emenda horizontal deixou de reduzir o número de operações de desenho');
});

// ── As duas constantes que a bancada A/B pegou divergindo (04/09/2026) ──────
//
// Os dois valores abaixo NÃO são gosto: são o que o `buildQrPng` do
// `src/services/pdfSignature.service.ts` já usava, e por isso o que está
// impresso nos artefatos assinados que já foram arquivados. O porte tinha saído
// com preto puro e correção `M`, e a comparação página a página acusou o QR
// inteiro como diferente — a única divergência real que ela achou no laudo.
//
// O teste existe porque nenhuma das duas quebra nada quando erra: o documento
// sai, bonito, com um QR de outra cor e menos tolerante a fotocópia.

test('a tinta do QR é a mesma do laudo (#111827), não preto puro', () => {
  assert.deepEqual([...TINTA_DO_QR], [0.067, 0.094, 0.153]);
  // #111827 = 17,24,39 → /255. O arredondamento do cliente é este mesmo.
  const emBytes = TINTA_DO_QR.map((c) => Math.round(c * 255));
  assert.deepEqual(emBytes, [17, 24, 39]);
});

test('a correção de erro é H — o laudo é impresso e fotografado', () => {
  assert.equal(CORRECAO_DE_ERRO_DO_QR, 'H');
});

test('em H, o QR do rodapé continua legível nos 44 pt em que é desenhado', async () => {
  // A troca de M para H acrescenta módulos: o mesmo quadrado passa a caber mais
  // quadradinhos, e cada um encolhe. Abaixo de ~0,7 pt a câmera erra — então a
  // decisão de fidelidade tem de passar por esta régua antes de valer.
  const { default: QRCode } = await import('qrcode');
  const url = 'https://jurius.com.br/#/verificar/771ac0f37b61269c';
  const codigo = QRCode.create(url, { errorCorrectionLevel: CORRECAO_DE_ERRO_DO_QR });
  const tamanho = codigo.modules.size;

  const LADO_DO_RODAPE = 44;
  assert.ok(
    pontosPorModulo(tamanho, LADO_DO_RODAPE) >= 0.7,
    `módulo de ${pontosPorModulo(tamanho, LADO_DO_RODAPE).toFixed(2)} pt em ${tamanho}×${tamanho}`,
  );
  assert.ok(ladoMinimoLegivel(tamanho) <= LADO_DO_RODAPE);
});
