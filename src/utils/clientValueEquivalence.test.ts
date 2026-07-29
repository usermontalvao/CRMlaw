// A mesclagem não pode "atualizar" um campo para o mesmo valor escrito de outro
// jeito — isso poluía o histórico de alterações com mudanças que não existiram.
// Execução: `node --test --import ts-node/esm src/utils/clientValueEquivalence.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { areClientValuesEquivalent, normalizeClientText } from './clientValueEquivalence.ts';

test('caixa e acento não fazem diferença', () => {
  assert.equal(areClientValuesEquivalent('profession', 'Advogado', 'advogado'), true);
  assert.equal(areClientValuesEquivalent('address_city', 'CUIABÁ', 'Cuiaba'), true);
});

test('marcação de gênero escrita de jeitos diferentes é o mesmo valor', () => {
  assert.equal(areClientValuesEquivalent('nationality', 'brasileiro (a)', 'brasileiro(a)'), true);
  assert.equal(areClientValuesEquivalent('marital_status', 'casado', 'casado(a)'), true);
  assert.equal(areClientValuesEquivalent('marital_status', 'solteiro(a)', 'SOLTEIRO'), true);
});

test('máscara de telefone e de CPF não conta como alteração', () => {
  assert.equal(areClientValuesEquivalent('phone', '65984046375', '(65) 98404-6375'), true);
  assert.equal(areClientValuesEquivalent('mobile', '(65) 98404-6375', '65 98404 6375'), true);
  assert.equal(areClientValuesEquivalent('cpf_cnpj', '04544803193', '045.448.031-93'), true);
  assert.equal(areClientValuesEquivalent('address_zip_code', '78000000', '78000-000'), true);
});

test('valor realmente diferente continua sendo diferente', () => {
  assert.equal(areClientValuesEquivalent('cpf_cnpj', '04544803193', '04574803193'), false, 'CPF com dígito trocado é mudança real');
  assert.equal(areClientValuesEquivalent('phone', '65984046375', '65999990000'), false);
  assert.equal(areClientValuesEquivalent('profession', 'advogado', 'advogada'), false, 'gênero diferente não é máscara');
  assert.equal(areClientValuesEquivalent('full_name', 'PEDRO NETO', 'PEDRO FILHO'), false);
});

test('branco contra preenchido é mudança; branco contra branco não é', () => {
  assert.equal(areClientValuesEquivalent('email', '', null), true);
  assert.equal(areClientValuesEquivalent('email', '   ', undefined), true);
  assert.equal(areClientValuesEquivalent('email', '', 'pedro@advcuiaba.com'), false);
  assert.equal(areClientValuesEquivalent('email', 'pedro@advcuiaba.com', null), false);
});

test('RG sem nenhum dígito cai na comparação de texto', () => {
  assert.equal(areClientValuesEquivalent('rg', 'AB-1234', 'ab1234'), true);
  assert.equal(areClientValuesEquivalent('rg', 'sem numero', 'SEM NÚMERO'), true);
});

test('normalizeClientText derruba pontuação e espaço sobrando', () => {
  assert.equal(normalizeClientText('  Rua   das Flores, 100 '), 'rua das flores 100');
});
