// Cobertura da vinculação automática pasta -> cliente.
// Execução: `node --test --import ts-node/esm src/utils/nextcloudAutoLink.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, onlyDigits, planAutoLinks, type AutoLinkClient, type AutoLinkFolder } from './nextcloudAutoLink.ts';

const clients: AutoLinkClient[] = [
  { id: 'c1', full_name: 'João da Silva', cpf_cnpj: '123.456.789-00' },
  { id: 'c2', full_name: 'Maria Souza', cpf_cnpj: '987.654.321-00' },
  { id: 'c3', full_name: 'João da Silva', cpf_cnpj: '111.222.333-44' }, // homônimo de c1
  { id: 'c4', full_name: 'Empresa X LTDA', cpf_cnpj: '12.345.678/0001-90' },
];

const folder = (name: string): AutoLinkFolder => ({ name, path: `Clientes/${name}` });

test('normalizeName remove acentos, caixa e pontuação', () => {
  assert.equal(normalizeName('João da Silva'), 'joao da silva');
  assert.equal(normalizeName('  MARIA   Souza '), 'maria souza');
  assert.equal(normalizeName('José-Antônio'), 'jose antonio');
});

test('onlyDigits ignora máscara de CPF/CNPJ', () => {
  assert.equal(onlyDigits('123.456.789-00'), '12345678900');
  assert.equal(onlyDigits('12.345.678/0001-90'), '12345678000190');
  assert.equal(onlyDigits(null), '');
});

test('CPF único no nome da pasta vincula automaticamente', () => {
  const plan = planAutoLinks([folder('Maria Souza - 987.654.321-00')], clients);
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.auto[0].clientId, 'c2');
  assert.equal(plan.auto[0].reason, 'cpf');
  assert.equal(plan.confirm.length, 0);
});

test('CNPJ (14 dígitos) casa mesmo com máscara diferente', () => {
  const plan = planAutoLinks([folder('12345678000190 Empresa')], clients);
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.auto[0].clientId, 'c4');
});

test('nome exato e único vincula automaticamente', () => {
  const plan = planAutoLinks([folder('Maria Souza')], clients);
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.auto[0].reason, 'name-exact');
  assert.equal(plan.auto[0].clientId, 'c2');
});

test('homônimos por nome exigem confirmação (pode ser outra pessoa)', () => {
  const plan = planAutoLinks([folder('João da Silva')], clients);
  assert.equal(plan.auto.length, 0);
  assert.equal(plan.confirm.length, 1);
  assert.deepEqual(plan.confirm[0].candidates.map((c) => c.clientId).sort(), ['c1', 'c3']);
});

test('CPF tem precedência sobre homônimo de nome', () => {
  const plan = planAutoLinks([folder('João da Silva - 111.222.333-44')], clients);
  assert.equal(plan.auto.length, 1);
  assert.equal(plan.auto[0].clientId, 'c3');
  assert.equal(plan.auto[0].reason, 'cpf');
});

test('nome parcial vira sugestão de confirmação, nunca automático', () => {
  const plan = planAutoLinks([folder('Maria Souza - Trabalhista')], clients);
  assert.equal(plan.auto.length, 0);
  assert.equal(plan.confirm.length, 1);
  assert.equal(plan.confirm[0].candidates[0].clientId, 'c2');
  assert.equal(plan.confirm[0].candidates[0].reason, 'name-partial');
});

test('contenção parcial respeita fronteira de token (não casa "ana" em "joana")', () => {
  const soClients: AutoLinkClient[] = [{ id: 'x', full_name: 'Ana', cpf_cnpj: null }];
  const plan = planAutoLinks([folder('Joana Prado')], soClients);
  assert.equal(plan.confirm.length, 0);
  assert.equal(plan.unmatched.length, 1);
});

test('pasta sem candidato vai para unmatched', () => {
  const plan = planAutoLinks([folder('Documentos Gerais')], clients);
  assert.equal(plan.auto.length, 0);
  assert.equal(plan.confirm.length, 0);
  assert.deepEqual(plan.unmatched, ['Clientes/Documentos Gerais']);
});

test('pastas já vinculadas são ignoradas', () => {
  const f = folder('Maria Souza');
  const plan = planAutoLinks([f], clients, new Set([f.path]));
  assert.equal(plan.auto.length, 0);
  assert.equal(plan.confirm.length, 0);
  assert.equal(plan.unmatched.length, 0);
});

test('número curto (ex.: nº de processo) não é tratado como CPF', () => {
  const plan = planAutoLinks([folder('Processo 12345')], clients);
  assert.equal(plan.auto.length, 0);
});
