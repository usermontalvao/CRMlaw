// Cobertura da REGRA DE SEGURANÇA: sanitização de caminho WebDAV (path traversal).
// Execução: `npx ts-node --esm supabase/functions/_shared/nextcloud-path.test.ts`
// (não há framework de testes no stack — node:test embutido + ts-node.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNextcloudPath } from './nextcloud-path.ts';

test('aceita caminhos normais e normaliza barras nas pontas', () => {
  assert.equal(sanitizeNextcloudPath('Clientes/2026/doc.pdf'), 'Clientes/2026/doc.pdf');
  assert.equal(sanitizeNextcloudPath('/Clientes/doc.pdf/'), 'Clientes/doc.pdf');
  assert.equal(sanitizeNextcloudPath('Pasta com acento çãé/arquivo.docx'), 'Pasta com acento çãé/arquivo.docx');
});

test('rejeita traversal com ".." e "."', () => {
  assert.equal(sanitizeNextcloudPath('../etc/passwd'), null);
  assert.equal(sanitizeNextcloudPath('Clientes/../../secret'), null);
  assert.equal(sanitizeNextcloudPath('Clientes/./doc.pdf'), null);
  assert.equal(sanitizeNextcloudPath('..'), null);
  assert.equal(sanitizeNextcloudPath('.'), null);
});

test('rejeita NUL, caracteres de controle e barra invertida', () => {
  assert.equal(sanitizeNextcloudPath('doc\x00.pdf'), null);
  assert.equal(sanitizeNextcloudPath('pasta\nnova/doc.pdf'), null);
  assert.equal(sanitizeNextcloudPath('pasta\\windows\\doc.pdf'), null);
});

test('caminho vazio: null por padrão, "" só com allowRoot', () => {
  assert.equal(sanitizeNextcloudPath(''), null);
  assert.equal(sanitizeNextcloudPath('/'), null);
  assert.equal(sanitizeNextcloudPath('', { allowRoot: true }), '');
  assert.equal(sanitizeNextcloudPath('///', { allowRoot: true }), '');
});

test('rejeita tipos não-string e valores extremos', () => {
  assert.equal(sanitizeNextcloudPath(null), null);
  assert.equal(sanitizeNextcloudPath(undefined), null);
  assert.equal(sanitizeNextcloudPath(42), null);
  assert.equal(sanitizeNextcloudPath({}), null);
  assert.equal(sanitizeNextcloudPath('a'.repeat(4097)), null); // caminho > 4096
  assert.equal(sanitizeNextcloudPath('x/' + 'n'.repeat(256)), null); // segmento > 255
});
