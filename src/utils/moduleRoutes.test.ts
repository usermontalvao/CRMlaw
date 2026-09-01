import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_PATHS,
  isCleanCrmLocation,
  isModulePath,
  isStandaloneModuleSearch,
  moduleToPath,
  moduleToStandalonePath,
  parsePendingModule,
  pathToModule,
} from './moduleRoutes.ts';

/**
 * Trechos que o App usa com `pathname.includes(...)` / `startsWith(...)` para
 * decidir as rotas públicas e especiais. Um caminho de módulo que case com
 * qualquer um deles faz o módulo abrir a página pública no lugar dele — é o
 * jeito mais fácil de quebrar assinatura/portal sem perceber.
 */
const ROTAS_ESPECIAIS = [
  '/assinar/',
  '/documento/',
  '/preencher/',
  '/cloud/share/',
  '/p/',
  '/verificar',
  '/termos-assinatura',
  '/terms',
  '/privacidade',
  '/privacy',
  '/docs',
  '/cron/djen',
  '/portal',
  '/editor',
  '/aniversarioanimado',
];

test('nenhum caminho de módulo colide com rota pública/especial', () => {
  for (const path of Object.values(MODULE_PATHS)) {
    for (const trecho of ROTAS_ESPECIAIS) {
      assert.ok(
        !path.includes(trecho),
        `caminho de módulo "${path}" contém o trecho de rota especial "${trecho}"`,
      );
      assert.ok(
        !`${path}/`.includes(trecho),
        `caminho de módulo "${path}/" contém o trecho de rota especial "${trecho}"`,
      );
    }
  }
});

test('mapa é bijetivo: nenhum caminho repetido entre módulos', () => {
  const paths = Object.values(MODULE_PATHS);
  assert.equal(new Set(paths).size, paths.length);
});

test('ida e volta módulo ↔ caminho', () => {
  assert.equal(moduleToPath('agenda'), '/agenda');
  assert.equal(pathToModule('/agenda'), 'agenda');
  assert.equal(pathToModule('/agenda/'), 'agenda', 'barra final deve ser tolerada');
  assert.equal(pathToModule('/configuracoes'), 'configuracoes');
  assert.equal(moduleToPath('wiki'), '/wiki');
  assert.equal(pathToModule('/wiki'), 'wiki');
});

test('login não vai para a URL — o destino pretendido tem de sobreviver', () => {
  assert.equal(moduleToPath('login'), null);
});

test('nova guia gera caminho isolado sem criar uma rota paralela', () => {
  assert.equal(moduleToStandalonePath('prazos'), '/prazos?standalone=1');
  assert.equal(moduleToStandalonePath('agenda'), '/agenda?standalone=1');
  assert.equal(moduleToStandalonePath('login'), null);
});

test('modo isolado exige o valor explícito standalone=1', () => {
  assert.equal(isStandaloneModuleSearch('?standalone=1'), true);
  assert.equal(isStandaloneModuleSearch('?foo=bar&standalone=1'), true);
  assert.equal(isStandaloneModuleSearch('?standalone=0'), false);
  assert.equal(isStandaloneModuleSearch('?standalone=true'), false);
  assert.equal(isStandaloneModuleSearch(''), false);
});

test('destino pretendido: só módulo conhecido e dentro do prazo', () => {
  const agora = 1_000_000_000_000;
  assert.equal(parsePendingModule(`prazos|${agora}`, agora + 1000), 'prazos');
  assert.equal(parsePendingModule(`prazos|${agora}`, agora + 11 * 60 * 1000), null, 'vencido');
  assert.equal(parsePendingModule('modulo-que-nao-existe|' + agora, agora), null);
  assert.equal(parsePendingModule('prazos', agora), null, 'sem carimbo de hora');
  assert.equal(parsePendingModule(null, agora), null);
});

test('destino pretendido não é consumido em rota pública/especial', () => {
  // Rotas que também montam o App — o destino guardado não é delas.
  assert.equal(isCleanCrmLocation('/', '#/assinar/TOKEN'), false);
  assert.equal(isCleanCrmLocation('/', '#/documento/TOKEN'), false);
  assert.equal(isCleanCrmLocation('/', '#/cron/djen'), false);
  // Boot limpo do CRM.
  assert.equal(isCleanCrmLocation('/', ''), true);
  assert.equal(isCleanCrmLocation('/', '#editor-doc=abc'), true, 'hash interno do CRM não é rota');
});

test('caminho desconhecido não vira módulo', () => {
  assert.equal(pathToModule('/'), null);
  assert.equal(pathToModule('/assinar/abc123'), null);
  assert.equal(pathToModule('/clientes/123'), null, 'deep link não é deste nível');
  assert.equal(isModulePath('/nao-existe'), false);
});
