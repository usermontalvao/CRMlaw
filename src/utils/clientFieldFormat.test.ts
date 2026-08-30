// Cobertura das máscaras que vestem a ficha do cliente no texto do documento.
// A regra que se repete em todas: dado fora do formato esperado sai INTACTO,
// porque inventar máscara em cima de dado torto imprime um documento errado.
// Execução: `node --test --import ts-node/esm src/utils/clientFieldFormat.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCepForDocument,
  formatCpfCnpjForDocument,
  formatPhoneForDocument,
  formatProperNamePtBr,
  formatQualificationTerm,
  formatUfForDocument,
} from './clientFieldFormat.ts';

test('CPF e CNPJ são reconhecidos pelo tamanho', () => {
  assert.equal(formatCpfCnpjForDocument('04544803193'), '045.448.031-93');
  assert.equal(formatCpfCnpjForDocument('045.448.031-93'), '045.448.031-93', 'já mascarado não muda');
  assert.equal(formatCpfCnpjForDocument('12345678000199'), '12.345.678/0001-99');
});

test('documento fora do tamanho sai como veio', () => {
  assert.equal(formatCpfCnpjForDocument('123456'), '123456');
  assert.equal(formatCpfCnpjForDocument(''), '');
  assert.equal(formatCpfCnpjForDocument(null), '');
  assert.equal(formatCpfCnpjForDocument(undefined), '');
});

test('CEP ganha o hífen dos oito dígitos', () => {
  assert.equal(formatCepForDocument('78099070'), '78099-070');
  assert.equal(formatCepForDocument('78099-070'), '78099-070');
  assert.equal(formatCepForDocument('7809'), '7809');
});

test('telefone distingue celular de fixo', () => {
  assert.equal(formatPhoneForDocument('65984046375'), '(65) 98404-6375');
  assert.equal(formatPhoneForDocument('6533334444'), '(65) 3333-4444');
});

test('o 55 do país é descartado antes da máscara', () => {
  assert.equal(formatPhoneForDocument('5565984046375'), '(65) 98404-6375');
  assert.equal(formatPhoneForDocument('+55 65 98404-6375'), '(65) 98404-6375');
});

test('telefone de tamanho estranho não é mascarado', () => {
  assert.equal(formatPhoneForDocument('123'), '123');
  assert.equal(formatPhoneForDocument('659840463751234'), '659840463751234');
});

test('qualificação vai em minúscula no meio da frase', () => {
  assert.equal(formatQualificationTerm('Casado(a)'), 'casado(a)');
  assert.equal(formatQualificationTerm('ADVOGADO'), 'advogado');
  assert.equal(formatQualificationTerm('  brasileiro   (a) '), 'brasileiro (a)');
});

test('UF sai em duas letras maiúsculas', () => {
  assert.equal(formatUfForDocument('mt'), 'MT');
  assert.equal(formatUfForDocument(' sp '), 'SP');
});

test('nome próprio mantém as preposições em minúscula', () => {
  assert.equal(formatProperNamePtBr('CUIABÁ'), 'Cuiabá');
  assert.equal(formatProperNamePtBr('várzea grande'), 'Várzea Grande');
  assert.equal(formatProperNamePtBr('SANTO ANTÔNIO DO LEVERGER'), 'Santo Antônio do Leverger');
  assert.equal(formatProperNamePtBr('mogi-mirim'), 'Mogi-Mirim');
});

test('preposição no começo do nome continua maiúscula', () => {
  assert.equal(formatProperNamePtBr('DOIS IRMÃOS'), 'Dois Irmãos');
  assert.equal(formatProperNamePtBr('do carmo'), 'Do Carmo');
});
