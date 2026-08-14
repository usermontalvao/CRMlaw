import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDocumentRequestPreset,
  normalizeDocumentRequestPresets,
  removeDocumentRequestPreset,
} from './documentRequestPresets.ts';

test('normaliza padrões pessoais sem vazios ou duplicatas de caixa', () => {
  assert.deepEqual(
    normalizeDocumentRequestPresets(['  CPF  ', '', 'cpf', 'Comprovante de residência']),
    ['CPF', 'Comprovante de residência'],
  );
});

test('adiciona e remove um padrão pelo rótulo normalizado', () => {
  const added = addDocumentRequestPreset(['CPF'], '  Holerite ');
  assert.deepEqual(added, ['CPF', 'Holerite']);
  assert.deepEqual(removeDocumentRequestPreset(added, 'holerite'), ['CPF']);
});
