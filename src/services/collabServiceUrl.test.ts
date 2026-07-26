import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_COLLAB_URL,
  resolveCollabServiceUrl,
} from './collabServiceUrl.ts';

/**
 * A regra protege contra o apagão de 26/07/2026: produção publicada com a
 * variável de build vazia e a coedição desligada em silêncio. Em produção o
 * padrão embutido assume; fora dela, sem variável é sem coedição mesmo.
 */

test('a variável de build vence sempre que estiver preenchida', () => {
  assert.equal(
    resolveCollabServiceUrl('https://coedicao-de-teste.exemplo.com', 'jurius.com.br'),
    'https://coedicao-de-teste.exemplo.com',
  );
  assert.equal(
    resolveCollabServiceUrl('  https://com-espacos.exemplo.com  ', 'localhost'),
    'https://com-espacos.exemplo.com',
  );
});

test('produção sem a variável cai no padrão embutido', () => {
  assert.equal(resolveCollabServiceUrl('', 'jurius.com.br'), PRODUCTION_COLLAB_URL);
  assert.equal(resolveCollabServiceUrl(undefined, 'jurius.com.br'), PRODUCTION_COLLAB_URL);
  assert.equal(resolveCollabServiceUrl(null, 'www.jurius.com.br'), PRODUCTION_COLLAB_URL);
  // Variável só com espaços é o mesmo que vazia — foi exatamente o caso real.
  assert.equal(resolveCollabServiceUrl('   ', 'jurius.com.br'), PRODUCTION_COLLAB_URL);
});

test('fora de produção, sem variável não há coedição (nem chamada ao servidor de produção)', () => {
  assert.equal(resolveCollabServiceUrl('', 'localhost'), '');
  assert.equal(resolveCollabServiceUrl(undefined, '127.0.0.1'), '');
  assert.equal(resolveCollabServiceUrl('', 'preview-123--jurius.netlify.app'), '');
  assert.equal(resolveCollabServiceUrl('', null), '');
  assert.equal(resolveCollabServiceUrl('', undefined), '');
});

test('subdomínio parecido não ganha o padrão de produção', () => {
  assert.equal(resolveCollabServiceUrl('', 'app.jurius.com.br'), '');
  assert.equal(resolveCollabServiceUrl('', 'jurius.com.br.malicioso.com'), '');
});
