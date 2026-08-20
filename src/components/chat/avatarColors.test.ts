import test from 'node:test';
import assert from 'node:assert/strict';
import { coresDoNome, PALETA_DE_AVATAR } from './avatarColors.ts';

test('a mesma pessoa tem sempre a mesma cor', () => {
  const a = coresDoNome('Lisliandra Cerqueira');
  const b = coresDoNome('lisliandra cerqueira  ');
  assert.deepEqual(a, b);
});

test('nomes diferentes não caem todos na mesma cor', () => {
  const nomes = ['Pedro Montalvão', 'Robiane Aguiar', 'Geral', 'Priscila Brandão',
    'Carlos Daniel', 'Maria de Fátima', 'Paulo Henrique', 'Jeanderson Santana'];
  const usadas = new Set(nomes.map(n => coresDoNome(n).bg));
  assert.ok(usadas.size >= 4, `esperava variedade, veio ${usadas.size}`);
});

test('vazio e nulo têm cor de reserva', () => {
  assert.deepEqual(coresDoNome(''), PALETA_DE_AVATAR[PALETA_DE_AVATAR.length - 1]);
  assert.deepEqual(coresDoNome(null), PALETA_DE_AVATAR[PALETA_DE_AVATAR.length - 1]);
});

test('nenhum tom da paleta é o laranja da marca', () => {
  for (const cor of PALETA_DE_AVATAR) {
    assert.notEqual(cor.bg.toLowerCase(), '#f27a23');
    assert.notEqual(cor.fg.toLowerCase(), '#f27a23');
  }
});
