// Navegação do Nextcloud: link direto (perfil do cliente -> pasta) e histórico
// voltar/avançar. O caso que motivou os testes: clicar na pasta do cliente
// precisa abrir AQUELA pasta, mesmo com a sessão anterior salva em outro lugar.
// Execução: `npx ts-node --esm src/utils/nextcloudNavigation.test.ts`
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOLDER_HISTORY_LIMIT,
  canGoBack,
  canGoForward,
  createFolderHistory,
  currentFolderPath,
  normalizeFolderPath,
  parentFolderPath,
  parseNextcloudNavParams,
  pushFolderHistory,
  stepFolderHistory,
} from './nextcloudNavigation.ts';

// --- normalizeFolderPath ----------------------------------------------------

test('a raiz é a string vazia, venha como vier', () => {
  for (const value of ['', '/', '//', '   ', ' / ', null, undefined]) {
    assert.equal(normalizeFolderPath(value as string), '');
  }
});

test('barras sobrando não criam um caminho diferente da mesma pasta', () => {
  const expected = 'Clientes/João Silva/Trabalhista';
  for (const value of [
    'Clientes/João Silva/Trabalhista',
    '/Clientes/João Silva/Trabalhista',
    'Clientes/João Silva/Trabalhista/',
    '/Clientes/João Silva/Trabalhista/',
    'Clientes//João Silva///Trabalhista',
  ]) {
    assert.equal(normalizeFolderPath(value), expected, `falhou para ${JSON.stringify(value)}`);
  }
});

test('espaço em volta do segmento é aparado sem alterar o nome', () => {
  assert.equal(normalizeFolderPath(' Clientes / Ana Paula '), 'Clientes/Ana Paula');
});

test('parentFolderPath sobe um nível e para na raiz', () => {
  assert.equal(parentFolderPath('Clientes/Ana/Docs'), 'Clientes/Ana');
  assert.equal(parentFolderPath('Clientes'), '');
  assert.equal(parentFolderPath(''), null);
  assert.equal(parentFolderPath('/'), null);
});

// --- parseNextcloudNavParams ------------------------------------------------

test('link direto do perfil do cliente é lido e normalizado', () => {
  const params = parseNextcloudNavParams(JSON.stringify({ path: '/Clientes/Ana/' }));
  assert.deepEqual(params, { path: 'Clientes/Ana' });
});

test('link direto para a raiz é um pedido válido, não ausência de pedido', () => {
  assert.deepEqual(parseNextcloudNavParams(JSON.stringify({ path: '' })), { path: '' });
});

test('sem parâmetro, o módulo restaura a sessão (null)', () => {
  assert.equal(parseNextcloudNavParams(undefined), null);
  assert.equal(parseNextcloudNavParams(null), null);
  assert.equal(parseNextcloudNavParams(''), null);
  assert.equal(parseNextcloudNavParams('   '), null);
});

test('parâmetro corrompido não derruba o módulo', () => {
  assert.equal(parseNextcloudNavParams('{path:'), null);
  assert.equal(parseNextcloudNavParams('null'), null);
  assert.equal(parseNextcloudNavParams('"Clientes/Ana"'), null);
  assert.equal(parseNextcloudNavParams(JSON.stringify({ path: 42 })), null);
  assert.equal(parseNextcloudNavParams(JSON.stringify({ folder: 'Clientes' })), null);
});

// --- histórico --------------------------------------------------------------

test('o histórico começa na pasta em que o módulo abriu', () => {
  const history = createFolderHistory('/Clientes/Ana/');
  assert.deepEqual(history, { entries: ['Clientes/Ana'], index: 0 });
  assert.equal(currentFolderPath(history), 'Clientes/Ana');
  assert.equal(canGoBack(history), false);
  assert.equal(canGoForward(history), false);
});

test('navegar empilha e o voltar/avançar percorre o caminho', () => {
  let history = createFolderHistory('');
  history = pushFolderHistory(history, 'Clientes');
  history = pushFolderHistory(history, 'Clientes/Ana');
  assert.equal(canGoBack(history), true);
  assert.equal(canGoForward(history), false);

  const back = stepFolderHistory(history, -1)!;
  assert.equal(back.path, 'Clientes');
  assert.equal(canGoForward(back.history), true);

  const backAgain = stepFolderHistory(back.history, -1)!;
  assert.equal(backAgain.path, '');
  assert.equal(canGoBack(backAgain.history), false);

  const forward = stepFolderHistory(backAgain.history, 1)!;
  assert.equal(forward.path, 'Clientes');
});

test('não anda além das pontas do histórico', () => {
  const history = createFolderHistory('Clientes');
  assert.equal(stepFolderHistory(history, -1), null);
  assert.equal(stepFolderHistory(history, 1), null);
});

test('entrar na mesma pasta não cria entrada repetida', () => {
  let history = createFolderHistory('Clientes');
  history = pushFolderHistory(history, 'Clientes');
  history = pushFolderHistory(history, '/Clientes/');
  assert.deepEqual(history.entries, ['Clientes']);
  assert.equal(history.index, 0);
});

test('navegar depois de voltar descarta o avançar', () => {
  let history = createFolderHistory('');
  history = pushFolderHistory(history, 'Clientes');
  history = pushFolderHistory(history, 'Clientes/Ana');
  const back = stepFolderHistory(history, -1)!; // volta para "Clientes"
  const branched = pushFolderHistory(back.history, 'Clientes/Bruno');
  assert.deepEqual(branched.entries, ['', 'Clientes', 'Clientes/Bruno']);
  assert.equal(canGoForward(branched), false);
  assert.equal(currentFolderPath(branched), 'Clientes/Bruno');
});

test('o histórico tem teto e mantém a pasta atual no fim', () => {
  let history = createFolderHistory('pasta-0');
  for (let i = 1; i < FOLDER_HISTORY_LIMIT + 25; i += 1) {
    history = pushFolderHistory(history, `pasta-${i}`);
  }
  assert.equal(history.entries.length, FOLDER_HISTORY_LIMIT);
  assert.equal(history.index, FOLDER_HISTORY_LIMIT - 1);
  assert.equal(currentFolderPath(history), `pasta-${FOLDER_HISTORY_LIMIT + 24}`);
  assert.equal(canGoForward(history), false);
});

test('índice fora da faixa é corrigido em vez de propagar', () => {
  const corrupted = { entries: ['', 'Clientes'], index: 9 };
  const pushed = pushFolderHistory(corrupted, 'Clientes/Ana');
  assert.deepEqual(pushed.entries, ['', 'Clientes', 'Clientes/Ana']);
  assert.equal(pushed.index, 2);
});

test('currentFolderPath devolve a raiz quando o estado está corrompido', () => {
  assert.equal(currentFolderPath({ entries: [], index: 0 }), '');
});
