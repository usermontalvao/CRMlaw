import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWaRich, waPlainText, stripAgentSignature } from './waRichText.ts';

test('marca simples vira trecho estilizado', () => {
  assert.deepEqual(parseWaRich('ola *mundo*'), [
    { text: 'ola ' },
    { text: 'mundo', bold: true },
  ]);
});

test('formatos encadeados acumulam estilo', () => {
  // O que a barra de formatacao produz ao clicar B, I e S no mesmo trecho.
  assert.deepEqual(parseWaRich('*_~tudo bem~_*'), [
    { text: 'tudo bem', bold: true, italic: true, strike: true },
  ]);
});

test('monoespacado nao interpreta o que esta dentro', () => {
  assert.deepEqual(parseWaRich('```a*b*c```'), [{ text: 'a*b*c', mono: true }]);
});

test('marca sem par fica como texto comum', () => {
  assert.deepEqual(parseWaRich('2 * 3 = 6'), [{ text: '2 * 3 = 6' }]);
  assert.deepEqual(parseWaRich('*sozinho'), [{ text: '*sozinho' }]);
});

test('espaco colado na marca nao formata', () => {
  // "* texto *" nao renderiza no WhatsApp; aqui tambem nao pode.
  assert.deepEqual(parseWaRich('* texto *'), [{ text: '* texto *' }]);
});

test('underline no meio da palavra nao vira italico', () => {
  assert.deepEqual(parseWaRich('nome_do_arquivo'), [{ text: 'nome_do_arquivo' }]);
  assert.deepEqual(parseWaRich('_de fato_'), [{ text: 'de fato', italic: true }]);
});

test('texto puro devolve as marcas removidas', () => {
  assert.equal(waPlainText('*_~tudo bem meu chapa~_*'), 'tudo bem meu chapa');
  assert.equal(waPlainText(''), '');
});

test('endereco com esquema vira no clicavel', () => {
  assert.deepEqual(parseWaRich('veja https://jurius.com.br/x aqui'), [
    { text: 'veja ' },
    { text: 'https://jurius.com.br/x', link: 'https://jurius.com.br/x' },
    { text: ' aqui' },
  ]);
});

test('www e dominio nu ganham esquema', () => {
  assert.deepEqual(parseWaRich('www.tjmt.jus.br'), [
    { text: 'www.tjmt.jus.br', link: 'https://www.tjmt.jus.br' },
  ]);
  assert.deepEqual(parseWaRich('jurius.com.br'), [
    { text: 'jurius.com.br', link: 'https://jurius.com.br' },
  ]);
});

test('e-mail abre no cliente de e-mail', () => {
  assert.deepEqual(parseWaRich('pedro@jurius.com.br'), [
    { text: 'pedro@jurius.com.br', link: 'mailto:pedro@jurius.com.br' },
  ]);
});

test('pontuacao da frase nao entra no endereco', () => {
  assert.deepEqual(parseWaRich('entre em jurius.com.br.'), [
    { text: 'entre em ' },
    { text: 'jurius.com.br', link: 'https://jurius.com.br' },
    { text: '.' },
  ]);
  // Parentese que fecha o do texto sai; o que faz par dentro do link fica.
  assert.deepEqual(parseWaRich('(veja https://x.com/a)'), [
    { text: '(veja ' },
    { text: 'https://x.com/a', link: 'https://x.com/a' },
    { text: ')' },
  ]);
  assert.deepEqual(parseWaRich('https://pt.wikipedia.org/wiki/Lei_(x)'), [
    { text: 'https://pt.wikipedia.org/wiki/Lei_(x)', link: 'https://pt.wikipedia.org/wiki/Lei_(x)' },
  ]);
});

test('nome de arquivo nao vira link', () => {
  assert.deepEqual(parseWaRich('segue contrato.pdf assinado'), [{ text: 'segue contrato.pdf assinado' }]);
  assert.deepEqual(parseWaRich('R$ 1.500,00'), [{ text: 'R$ 1.500,00' }]);
});

test('sublinhado dentro do endereco nao vira italico', () => {
  // Sem o reconhecimento vindo antes das marcas, os dois `_` abriam italico e
  // partiam o endereco em pedacos.
  assert.deepEqual(parseWaRich('https://tj.jus.br/consulta_de_autos_'), [
    { text: 'https://tj.jus.br/consulta_de_autos_', link: 'https://tj.jus.br/consulta_de_autos_' },
  ]);
});

test('endereco em negrito continua endereco', () => {
  assert.deepEqual(parseWaRich('*https://jurius.com.br*'), [
    { text: '*' },
    { text: 'https://jurius.com.br', link: 'https://jurius.com.br' },
    { text: '*' },
  ]);
});

test('texto puro devolve o endereco como escrito', () => {
  assert.equal(waPlainText('veja https://jurius.com.br agora'), 'veja https://jurius.com.br agora');
});

test('assinatura do atendente sai da primeira linha', () => {
  assert.equal(stripAgentSignature('*Pedro Montalvão:*\nbom dia'), 'bom dia');
  // Sem assinatura, nada muda — inclusive quando a mensagem comeca em negrito.
  assert.equal(stripAgentSignature('*bom dia*'), '*bom dia*');
});
