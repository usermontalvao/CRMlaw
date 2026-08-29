import test from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, digitosCpf } from './cpf.ts';

test('aceita CPFs válidos, com e sem máscara', () => {
  for (const cpf of ['529.982.247-25', '52998224725', '111.444.777-35', '11144477735']) {
    assert.equal(cpfValido(cpf), true, `deveria aceitar ${cpf}`);
  }
});

test('recusa dígito verificador errado', () => {
  assert.equal(cpfValido('529.982.247-26'), false, 'último dígito trocado');
  assert.equal(cpfValido('529.982.247-15'), false, 'penúltimo dígito trocado');
  assert.equal(cpfValido('123.456.789-00'), false);
});

test('recusa os repetidos, que fecham a conta mas não existem', () => {
  for (let i = 0; i <= 9; i++) {
    const repetido = String(i).repeat(11);
    assert.equal(cpfValido(repetido), false, `deveria recusar ${repetido}`);
  }
});

test('recusa quantidade de dígitos diferente de 11', () => {
  assert.equal(cpfValido('529.982.247-2'), false);
  assert.equal(cpfValido('529982247251'), false);
  assert.equal(cpfValido(''), false);
});

test('não quebra com nulo, indefinido ou lixo', () => {
  assert.equal(cpfValido(null), false);
  assert.equal(cpfValido(undefined), false);
  assert.equal(cpfValido('abcdefghijk'), false);
  assert.equal(digitosCpf(null), '');
});

test('ignora qualquer pontuação ao redor dos dígitos', () => {
  assert.equal(digitosCpf(' 529.982.247-25 '), '52998224725');
  assert.equal(cpfValido(' 529 982 247 25 '), true);
});
