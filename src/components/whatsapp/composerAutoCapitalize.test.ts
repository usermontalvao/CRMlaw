import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCapitalizarDigitacao } from './composerAutoCapitalize.ts';

/** Atalho: digitar `letra` no fim de `anterior`. */
const digitar = (anterior: string, letra: string) => {
  const atual = anterior + letra;
  return autoCapitalizarDigitacao(anterior, atual, atual.length);
};

test('a primeira letra da mensagem sobe para maiuscula', () => {
  assert.equal(digitar('', 'b'), 'B');
});

test('a segunda letra nao mexe em nada', () => {
  assert.equal(digitar('B', 'o'), null);
});

test('primeira letra depois de espacos tambem sobe', () => {
  assert.equal(digitar('  ', 'o'), '  O');
});

test('letra acentuada sobe com o acento', () => {
  assert.equal(digitar('', 'ó'), 'Ó');
  assert.equal(digitar('', 'á'), 'Á');
});

test('acento morto (´ vira á) conta como digitacao', () => {
  // O teclado troca UM caractere no lugar; o texto nao cresce.
  assert.equal(autoCapitalizarDigitacao('´', 'á', 1), 'Á');
});

test('comeco de frase depois de ponto final', () => {
  assert.equal(digitar('Bom dia. ', 'j'), 'Bom dia. J');
  assert.equal(digitar('Tudo bem? ', 'p'), 'Tudo bem? P');
  assert.equal(digitar('Otimo! ', 'v'), 'Otimo! V');
});

test('comeco de linha nova', () => {
  assert.equal(digitar('Segue o combinado\n', 'a'), 'Segue o combinado\nA');
});

test('ponto sem espaco NAO capitaliza (site, artigo, valor)', () => {
  assert.equal(digitar('www.', 'g'), null);
  assert.equal(digitar('art.', 'x'), null);
});

test('meio de palavra e meio de frase ficam quietos', () => {
  assert.equal(digitar('Bom ', 'd'), null);
  assert.equal(digitar('Bom di', 'a'), null);
});

test('marcas de formatacao e aspas sao puladas', () => {
  assert.equal(digitar('', '*'), null);
  assert.equal(digitar('*', 'b'), '*B');
  assert.equal(digitar('Ele disse. "', 'o'), 'Ele disse. "O');
  assert.equal(digitar('Bom dia. _', 'd'), 'Bom dia. _D');
});

test('o atalho "/" dos modelos continua minusculo', () => {
  // "/kit" tem de casar com o filtro do menu de modelos.
  assert.equal(digitar('/', 'k'), null);
});

test('numero e emoji no comeco nao viram nada', () => {
  assert.equal(digitar('', '5'), null);
  assert.equal(digitar('', '🙂'), null);
});

test('letra ja maiuscula nao e mexida', () => {
  assert.equal(digitar('', 'B'), null);
});

test('colar texto nao e reescrito', () => {
  const colado = 'bom dia, doutor';
  assert.equal(autoCapitalizarDigitacao('', colado, colado.length), null);
});

test('apagar nao capitaliza nada', () => {
  assert.equal(autoCapitalizarDigitacao('bo', 'b', 1), null);
});

test('digitar no MEIO do texto corrige a letra certa, no lugar certo', () => {
  // Cursor logo depois do "o" recem-digitado, no comeco da segunda frase.
  const anterior = 'Bom dia. tudo bem';
  const atual = 'Bom dia. otudo bem';
  assert.equal(autoCapitalizarDigitacao(anterior, atual, 10), 'Bom dia. Otudo bem');
});

test('o texto corrigido tem sempre o mesmo tamanho (o cursor depende disso)', () => {
  const atual = 'oi';
  const r = autoCapitalizarDigitacao('i', atual, 1);
  assert.equal(r?.length, atual.length);
});

test('correcao no passado nao acontece: so a letra digitada muda', () => {
  // "iphone" ja escrito continua como esta quando se digita o resto da frase.
  assert.equal(digitar('Mandei pelo iphone', '.'), null);
  assert.equal(autoCapitalizarDigitacao('bom dia', 'bom dia!', 8), null);
});
