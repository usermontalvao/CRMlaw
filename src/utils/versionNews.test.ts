import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  countChangesByType,
  countHiddenReleases,
  groupChangesByType,
  isProductionHost,
  parsePreviewRequest,
  pickUnseenReleases,
  seenStorageKey,
  type NewsRelease,
} from './versionNews.ts';

function release(version: string, changes: Array<[string, string]>): NewsRelease {
  return {
    version,
    date: '20/08/2026',
    modules: [{ moduleId: 'whatsapp', changes: changes.map(([type, title]) => ({ type, title })) }],
  };
}

const HISTORICO: NewsRelease[] = [
  release('1.10.338', [['feature', 'Reagir a uma mensagem'], ['fix', 'O GIF volta a se mexer']]),
  release('1.10.337', [['improvement', 'Uma régua para as camadas']]),
  release('1.10.336', [['improvement', 'A barra de mensagens']]),
  release('1.10.9', [['feature', 'Coisa antiga']]),
];

test('só anuncia em produção', () => {
  assert.equal(isProductionHost('jurius.com.br'), true);
  assert.equal(isProductionHost('www.jurius.com.br'), true);
  assert.equal(isProductionHost('JURIUS.COM.BR'), true);
  assert.equal(isProductionHost('localhost'), false);
  assert.equal(isProductionHost('127.0.0.1'), false);
  assert.equal(isProductionHost('deploy-preview-12--jurius.netlify.app'), false);
  assert.equal(isProductionHost('jurius.com.br.evil.com'), false);
  assert.equal(isProductionHost(null), false);
});

test('versão é comparada por número, não por texto', () => {
  // O defeito que isto trava: em ordem alfabética '1.10.9' vence '1.10.338'.
  assert.ok(compareVersions('1.10.338', '1.10.9') > 0);
  assert.ok(compareVersions('1.10.9', '1.10.338') < 0);
  assert.equal(compareVersions('1.10.338', '1.10.338'), 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
});

test('primeira vez não anuncia nada', () => {
  assert.deepEqual(pickUnseenReleases(HISTORICO, null, '1.10.338'), []);
});

test('vários commits no mesmo push viram várias versões no mesmo aviso', () => {
  const vistas = pickUnseenReleases(HISTORICO, '1.10.335', '1.10.338');
  assert.deepEqual(vistas.map((r) => r.version), ['1.10.338', '1.10.337', '1.10.336']);
});

test('quem já viu a versão atual não vê aviso', () => {
  assert.deepEqual(pickUnseenReleases(HISTORICO, '1.10.338', '1.10.338'), []);
});

test('release ainda não publicada não vaza para o aviso', () => {
  // A lista pode estar à frente do pacote no ar: escrevemos a 338 e o navegador
  // ainda está com a 337. A 338 não pode ser anunciada como se já existisse.
  const vistas = pickUnseenReleases(HISTORICO, '1.10.336', '1.10.337');
  assert.deepEqual(vistas.map((r) => r.version), ['1.10.337']);
});

test('teto de versões e a conta do que sobrou', () => {
  const muitas: NewsRelease[] = [];
  for (let patch = 350; patch > 330; patch -= 1) {
    muitas.push(release(`1.10.${patch}`, [['feature', `v${patch}`]]));
  }
  const vistas = pickUnseenReleases(muitas, '1.10.330', '1.10.350', 10);
  assert.equal(vistas.length, 10);
  assert.equal(vistas[0].version, '1.10.350');
  assert.equal(countHiddenReleases(muitas, '1.10.330', '1.10.350', 10), 10);
});

test('as mudanças saem agrupadas por tipo, na ordem de leitura', () => {
  const grupos = groupChangesByType(HISTORICO[0]);
  assert.deepEqual(grupos.map((g) => g.type), ['feature', 'fix']);
  assert.equal(grupos[0].changes[0].moduleId, 'whatsapp');
});

test('tipo desconhecido não some do aviso', () => {
  const estranha: NewsRelease = {
    version: '1.10.400',
    date: '20/08/2026',
    modules: [{ moduleId: 'sistema', changes: [{ type: 'reformulacao', title: 'Escrito fora do padrão' }] }],
  };
  const grupos = groupChangesByType(estranha);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].changes[0].title, 'Escrito fora do padrão');
});

test('resumo conta as mudanças por tipo', () => {
  const contas = countChangesByType([HISTORICO[0], HISTORICO[1]]);
  assert.deepEqual(contas, { feature: 1, fix: 1, improvement: 1 });
});

test('o "já vi" é de cada pessoa', () => {
  assert.notEqual(seenStorageKey('abc'), seenStorageKey('def'));
  assert.equal(seenStorageKey(null), 'jurius:version-news:seen:anon');
});

test('o ensaio só liga com o parâmetro na URL', () => {
  assert.deepEqual(parsePreviewRequest(''), { active: false, since: null });
  assert.deepEqual(parsePreviewRequest('?outro=1'), { active: false, since: null });
  assert.deepEqual(parsePreviewRequest('?novidades=1'), { active: true, since: null });
  assert.deepEqual(parsePreviewRequest('?novidades='), { active: true, since: null });
  assert.deepEqual(parsePreviewRequest('?novidades=1.10.330'), { active: true, since: '1.10.330' });
});
