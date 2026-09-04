import test from 'node:test';
import assert from 'node:assert/strict';
import {
  caminhoDoVisto,
  caminhoRetanguloArredondado,
  caminhoRetanguloTopoArredondado,
  nomeParaCabecalho,
  paletaDoLaudo,
  quebrarTexto,
} from './laudoDesign.ts';

/** Fonte de mentira: largura fixa por caractere. */
const fonte = (porChar = 5) => ({
  widthOfTextAtSize: (t: string, size: number) => t.length * porChar * (size / 10),
});

/** Extrai os pares de coordenadas de um caminho SVG. */
const pontos = (caminho: string): Array<[number, number]> => {
  const nums = caminho.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pares: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pares.push([nums[i], nums[i + 1]]);
  return pares;
};

test('o retângulo arredondado fecha o caminho e cabe na caixa', () => {
  const c = caminhoRetanguloArredondado(200, 100, 10);
  assert.ok(c.trim().endsWith('Z'), 'caminho tem de ser fechado');
  for (const [x, y] of pontos(c)) {
    assert.ok(x >= 0 && x <= 200, `x fora da caixa: ${x}`);
    assert.ok(y >= 0 && y <= 100, `y fora da caixa: ${y}`);
  }
});

test('raio maior que o lado é limitado — senão as curvas se cruzam', () => {
  // Um raio de 500 numa caixa de 40x20 faria o pdf-lib desenhar uma forma
  // torcida, sem erro nenhum.
  const c = caminhoRetanguloArredondado(40, 20, 500);
  for (const [x, y] of pontos(c)) {
    assert.ok(x >= 0 && x <= 40, `x fora: ${x}`);
    assert.ok(y >= 0 && y <= 20, `y fora: ${y}`);
  }
});

test('raio zero produz um retângulo de cantos vivos', () => {
  const c = caminhoRetanguloArredondado(100, 50, 0);
  const xs = pontos(c).map(([x]) => x);
  const ys = pontos(c).map(([, y]) => y);
  assert.ok(xs.every((x) => x === 0 || x === 100), 'só as bordas em x');
  assert.ok(ys.every((y) => y === 0 || y === 50), 'só as bordas em y');
});

test('raio negativo não vira caminho inválido', () => {
  const c = caminhoRetanguloArredondado(100, 50, -8);
  assert.ok(!c.includes('-'), `coordenada negativa no caminho: ${c}`);
});

test('o cabeçalho de cartão arredonda só o topo', () => {
  const c = caminhoRetanguloTopoArredondado(120, 30, 8);
  assert.ok(c.trim().endsWith('Z'));
  // No eixo do SVG o y cresce para baixo, então a BASE do cartão é y = altura.
  // Ela tem de ser reta: os dois cantos inferiores exatamente em x=0 e x=120.
  assert.ok(c.includes('M 0 30'), 'começa na base esquerda, reta');
  assert.ok(c.includes('L 120 30'), 'termina na base direita, reta');
});

test('o visto cresce com o raio e fica dentro da caixa', () => {
  for (const r of [4, 10, 25]) {
    const p = pontos(caminhoDoVisto(r));
    assert.equal(p.length, 3, 'o visto tem três pontos');
    for (const [x, y] of p) {
      assert.ok(x >= 0 && x <= r * 2, `x fora da caixa (r=${r}): ${x}`);
      assert.ok(y >= 0 && y <= r * 2, `y fora da caixa (r=${r}): ${y}`);
    }
  }
});

test('o visto tem a forma de um visto: desce e depois sobe', () => {
  // No eixo do SVG (y para baixo), o traço vai do meio-esquerda para baixo e
  // depois sobe à direita. Se os três y fossem crescentes seria uma diagonal.
  const [a, b, c] = pontos(caminhoDoVisto(10));
  assert.ok(b[1] > a[1], 'o meio é o ponto mais baixo');
  assert.ok(c[1] < a[1], 'a ponta direita sobe acima do início');
  assert.ok(a[0] < b[0] && b[0] < c[0], 'anda sempre para a direita');
});

test('a paleta entrega as cores nomeadas', () => {
  const p = paletaDoLaudo((r, g, b) => `rgb(${r},${g},${b})`);
  assert.equal(p.orange, 'rgb(0.91,0.32,0.04)');
  assert.equal(p.white, 'rgb(1,1,1)');
  assert.ok('emeraldSoft' in p && 'borderSoft' in p && 'silver' in p);
});

test('o nome do documento perde a extensão no cabeçalho', () => {
  // O laudo fala do DOCUMENTO, não do arquivo — e depois do congelamento a
  // extensão nem é mais a que o autor enviou (.docx virou .pdf).
  assert.equal(nomeParaCabecalho('Contrato de honorários.docx'), 'Contrato de honorários');
  assert.equal(nomeParaCabecalho('procuracao.PDF'), 'procuracao');
  assert.equal(nomeParaCabecalho('anexo.odt'), 'anexo');
});

test('nome longo é cortado antes de invadir a coluna da direita', () => {
  const longo = 'A'.repeat(120);
  const r = nomeParaCabecalho(longo);
  assert.equal(r.length, 70);
  assert.ok(r.endsWith('...'));
});

test('nome ausente vira string vazia, não "null"', () => {
  assert.equal(nomeParaCabecalho(null), '');
  assert.equal(nomeParaCabecalho(undefined), '');
});

test('ponto no meio do nome não é confundido com extensão', () => {
  assert.equal(nomeParaCabecalho('Contrato v2.1 final'), 'Contrato v2.1 final');
});

test('a quebra respeita a largura', () => {
  const linhas = quebrarTexto('um dois tres quatro cinco', fonte(), 10, 40);
  for (const l of linhas) assert.ok(fonte().widthOfTextAtSize(l, 10) <= 40, `linha larga: "${l}"`);
  assert.equal(linhas.join(' '), 'um dois tres quatro cinco', 'nenhuma palavra pode sumir');
});

test('texto que cabe fica numa linha só', () => {
  assert.deepEqual(quebrarTexto('curto', fonte(), 10, 500), ['curto']);
});

test('palavra maior que a caixa NÃO trava e NÃO é cortada', () => {
  // O `|| !atual` é o que impede o laço infinito. E não cortar é decisão: o que
  // transborda no laudo são identificadores (Google ID, IP), onde partir no
  // meio é pior que a sobra.
  const gigante = 'A'.repeat(200);
  const linhas = quebrarTexto(`ola ${gigante} tchau`, fonte(), 10, 30);
  assert.ok(linhas.includes(gigante), 'a palavra gigante tem de sobreviver inteira');
  assert.ok(linhas.join(' ').includes('tchau'), 'o texto depois dela não pode sumir');
});

test('texto vazio devolve uma linha vazia, não lista vazia', () => {
  // Quem chama conta linhas para calcular altura de cartão; lista vazia daria
  // altura zero e o item sumiria do laudo.
  assert.deepEqual(quebrarTexto('', fonte(), 10, 100), ['']);
  assert.deepEqual(quebrarTexto('   ', fonte(), 10, 100), ['']);
  assert.deepEqual(quebrarTexto(null as unknown as string, fonte(), 10, 100), ['']);
});

test('espaços repetidos não viram palavras vazias', () => {
  assert.deepEqual(quebrarTexto('a    b', fonte(), 10, 500), ['a b']);
});

test('sem fonte de verdade, estima em vez de estourar', () => {
  const linhas = quebrarTexto('um dois tres quatro', {} as never, 10, 30);
  assert.ok(linhas.length > 1, 'a estimativa tem de quebrar alguma coisa');
});
