import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALTURA_DA_FAIXA_DO_RODAPE,
  caixaComFaixaDoRodape,
  encaixarNaPagina,
  paginaDoCampo,
  posicaoDeReserva,
  retanguloDoCampo,
} from './geometria.ts';

const A4 = { largura: 595, altura: 842 };

test('o eixo Y é invertido E a altura é descontada', () => {
  // O erro clássico: inverter sem descontar a altura devolve o TOPO do
  // retângulo como se fosse a base, e a assinatura sobe a própria altura.
  // Campo colado no topo (y=0%) com 10% de altura tem de terminar encostado no
  // topo da página, ou seja base em 842 - 84,2 = 757,8.
  const r = retanguloDoCampo(A4.largura, A4.altura, {
    x_percent: 0, y_percent: 0, w_percent: 100, h_percent: 10,
  });
  assert.equal(r.h, 84.2);
  assert.equal(r.y, 842 - 84.2);
});

test('campo no rodapé cai na base da página', () => {
  const r = retanguloDoCampo(A4.largura, A4.altura, {
    x_percent: 0, y_percent: 90, w_percent: 100, h_percent: 10,
  });
  assert.ok(Math.abs(r.y - 0) < 1e-9, `esperava base em 0, veio ${r.y}`);
});

test('as porcentagens viram pontos na proporção certa', () => {
  const r = retanguloDoCampo(1000, 2000, {
    x_percent: 10, y_percent: 25, w_percent: 30, h_percent: 5,
  });
  assert.equal(r.x, 100);
  assert.equal(r.w, 300);
  assert.equal(r.h, 100);
  assert.equal(r.y, 2000 - 500 - 100);
});

test('retângulo que passa da borda é aparado, não recusado', () => {
  const r = encaixarNaPagina({ x: 500, y: 800, w: 300, h: 300 }, A4.largura, A4.altura);
  assert.equal(r.x, 500);
  assert.equal(r.w, 95, 'largura aparada até a borda direita');
  assert.equal(r.h, 42, 'altura aparada até o topo');
});

test('posição negativa é puxada para dentro', () => {
  const r = encaixarNaPagina({ x: -50, y: -20, w: 100, h: 40 }, A4.largura, A4.altura);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test('dimensão zero ou negativa vira 1, não some', () => {
  // pdf-lib desenha NADA para largura zero, sem erro. Uma assinatura que não
  // aparece é indistinguível de documento não assinado.
  const r = encaixarNaPagina({ x: 10, y: 10, w: 0, h: -5 }, A4.largura, A4.altura);
  assert.equal(r.w, 1);
  assert.equal(r.h, 1);
});

test('o campo do documento principal cai na página que ele pede', () => {
  const i = paginaDoCampo({
    chaveDoDocumento: 'main', numeroDaPagina: 3,
    deslocamentos: { main: 0 }, totalDePaginas: 10,
  });
  assert.equal(i, 2, 'página 3 é o índice 2');
});

test('anexo mesclado usa o próprio deslocamento', () => {
  const deslocamentos = { main: 0, 'attachment-0': 4, 'attachment-1': 9 };
  assert.equal(paginaDoCampo({ chaveDoDocumento: 'attachment-0', numeroDaPagina: 1, deslocamentos, totalDePaginas: 20 }), 4);
  assert.equal(paginaDoCampo({ chaveDoDocumento: 'attachment-1', numeroDaPagina: 2, deslocamentos, totalDePaginas: 20 }), 10);
});

test('campo de documento AUSENTE não vai para o principal', () => {
  // O defeito que isto trava: sem a verificação, um campo de anexo não mesclado
  // caía no deslocamento 0 e era estampado no documento principal — assinaturas
  // de arquivos diferentes empilhadas na mesma folha.
  const i = paginaDoCampo({
    chaveDoDocumento: 'attachment-7', numeroDaPagina: 1,
    deslocamentos: { main: 0 }, totalDePaginas: 5,
  });
  assert.equal(i, null, 'documento ausente tem de ser ignorado, não redirecionado');
});

test('página além do fim é ignorada, não jogada na última', () => {
  // Adivinhar carimbaria assinatura num lugar que ninguém marcou.
  const i = paginaDoCampo({
    chaveDoDocumento: 'main', numeroDaPagina: 99,
    deslocamentos: { main: 0 }, totalDePaginas: 3,
  });
  assert.equal(i, null);
});

test('número de página ausente ou zero vale como 1', () => {
  const base = { chaveDoDocumento: 'main', deslocamentos: { main: 2 }, totalDePaginas: 9 };
  assert.equal(paginaDoCampo({ ...base, numeroDaPagina: null }), 2);
  assert.equal(paginaDoCampo({ ...base, numeroDaPagina: 0 }), 2);
  assert.equal(paginaDoCampo({ ...base, numeroDaPagina: -3 }), 2);
});

test('chave herdada de Object não conta como documento presente', () => {
  // `'toString' in deslocamentos` seria verdadeiro pela cadeia de protótipos, e
  // um campo com essa chave viraria uma assinatura no deslocamento errado.
  const i = paginaDoCampo({
    chaveDoDocumento: 'toString', numeroDaPagina: 1,
    deslocamentos: { main: 0 }, totalDePaginas: 3,
  });
  assert.equal(i, null);
});

test('a posição de reserva fica no canto inferior direito, dentro da folha', () => {
  const r = posicaoDeReserva(A4.largura, A4.altura);
  assert.equal(r.w, 150);
  assert.equal(r.h, 60);
  assert.equal(r.y, 120, 'acima da faixa do rodapé');
  assert.equal(r.x, 595 - 150 - 80);
  assert.ok(r.x + r.w <= A4.largura, 'não pode passar da borda direita');
});

test('a reserva não escapa numa página estreita', () => {
  const r = posicaoDeReserva(200, 300);
  assert.ok(r.x >= 0, `x negativo: ${r.x}`);
  assert.ok(r.x + r.w <= 200, 'a assinatura sairia fora da folha');
});

test('a faixa do rodapé cresce para BAIXO, sem mover o conteúdo', () => {
  // Se a origem não descesse, o conteúdo teria de ser transladado — e é
  // justamente o que não pode ser feito (o pdf-lib acrescenta os desenhos
  // seguintes dentro da transformação em cache, e o rodapé sai flutuando).
  const antes = { x: 0, y: 0, width: 595, height: 842 };
  const depois = caixaComFaixaDoRodape(antes);
  assert.equal(depois.y, -ALTURA_DA_FAIXA_DO_RODAPE, 'a origem desce');
  assert.equal(depois.height, 842 + ALTURA_DA_FAIXA_DO_RODAPE);
  assert.equal(depois.width, antes.width, 'a largura não muda');
  assert.equal(depois.x, antes.x);
  // O topo do papel continua no mesmo lugar absoluto: é isso que garante que
  // nada do conteúdo andou.
  assert.equal(depois.y + depois.height, antes.y + antes.height);
});

test('a faixa acompanha uma página que já tinha origem deslocada', () => {
  const depois = caixaComFaixaDoRodape({ x: 10, y: 20, width: 400, height: 600 });
  assert.equal(depois.y, 20 - ALTURA_DA_FAIXA_DO_RODAPE);
  assert.equal(depois.y + depois.height, 620);
});
