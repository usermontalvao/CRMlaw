// A leitura das chaves de licença do Syncfusion.
//
// O que estes testes protegem é caro e invisível: chave que o EJ2 ignora não dá
// erro, ela desenha o aviso de avaliação POR CIMA da página — e essa página vai
// para dentro de um PDF assinado, que vale como prova.
//
// Execução: `npx ts-node --esm src/utils/syncfusionRuntime.test.ts`
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lerChaves,
  normalizeSyncfusionServiceUrl,
  pareceChaveDoSyncfusion,
} from './syncfusionRuntime.ts';

/** Uma chave com a cara de uma de verdade: base64, longa. */
const CHAVE_A = `${'A'.repeat(80)}==`;
const CHAVE_B = `${'B'.repeat(84)}==`;

test('cada uso tem a sua variável, e as duas chaves valem juntas', () => {
  const { chaves, descartadas } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_EDITOR', valor: CHAVE_A },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_CONVERSOR', valor: CHAVE_B },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: '' },
  ]);
  assert.deepEqual(chaves, [CHAVE_A, CHAVE_B]);
  assert.deepEqual(descartadas, []);
});

test('a variável legada sozinha continua valendo', () => {
  const { chaves } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_EDITOR', valor: '' },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_CONVERSOR', valor: '' },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: CHAVE_A },
  ]);
  assert.deepEqual(chaves, [CHAVE_A]);
});

test('a mesma chave nas duas variáveis entra uma vez só', () => {
  const { chaves } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_EDITOR', valor: CHAVE_A },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_CONVERSOR', valor: CHAVE_A },
  ]);
  assert.deepEqual(chaves, [CHAVE_A]);
});

test('duas chaves numa variável só, do jeito que o EJ2 aceita (`;`)', () => {
  const { chaves } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: `${CHAVE_A};${CHAVE_B}` },
  ]);
  assert.deepEqual(chaves, [CHAVE_A, CHAVE_B]);
});

test('espaço no lugar do `;` é separador, não parte da chave', () => {
  // Base64 não tem espaço: espaço ali é sempre separador digitado à mão. Sem
  // isto a segunda chave se perdia junto com a primeira.
  const { chaves } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: `${CHAVE_A}; ${CHAVE_B}` },
  ]);
  assert.deepEqual(chaves, [CHAVE_A, CHAVE_B]);
});

test('valor com o nome da variável colado é DESCARTADO, e diz onde', () => {
  // O acidente real: `VITE_...=SYNCFUSION_LICENSE_KEY=NxYt…`. Aceitar isso é
  // pior do que recusar — o EJ2 ignora calado e imprime o aviso de avaliação.
  const { chaves, descartadas } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: `SYNCFUSION_LICENSE_KEY=${CHAVE_A}` },
  ]);
  assert.deepEqual(chaves, []);
  assert.deepEqual(descartadas, ['VITE_SYNCFUSION_LICENSE_KEY']);
});

test('a chave boa sobrevive à torta que veio ao lado', () => {
  const { chaves, descartadas } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_EDITOR', valor: `nome=${CHAVE_A}` },
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY_CONVERSOR', valor: CHAVE_B },
  ]);
  assert.deepEqual(chaves, [CHAVE_B]);
  assert.deepEqual(descartadas, ['VITE_SYNCFUSION_LICENSE_KEY_EDITOR']);
});

test('variável ausente não vira chave nem reclamação', () => {
  const { chaves, descartadas } = lerChaves([
    { variavel: 'VITE_SYNCFUSION_LICENSE_KEY', valor: '   ' },
  ]);
  assert.deepEqual(chaves, []);
  assert.deepEqual(descartadas, []);
});

test('base64 é o único formato aceito', () => {
  assert.equal(pareceChaveDoSyncfusion(CHAVE_A), true);
  assert.equal(pareceChaveDoSyncfusion('curta=='), false, 'chave real nunca é curta assim');
  assert.equal(pareceChaveDoSyncfusion(`${'A'.repeat(80)}_x`), false, '`_` não é base64');
});

test('a URL do serviço termina com exatamente uma barra', () => {
  assert.equal(normalizeSyncfusionServiceUrl('https://x/api//'), 'https://x/api/');
  assert.equal(normalizeSyncfusionServiceUrl(''), '');
});
