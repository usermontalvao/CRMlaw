import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBuiltInTemplatePlaceholder,
  mergeTemplateFieldDefinitions,
  normalizeTemplateFieldKey,
} from './documentTemplateFields';

test('reconhece campos internos independentemente de acento e caixa', () => {
  assert.equal(isBuiltInTemplatePlaceholder('RÉU'), true);
  assert.equal(isBuiltInTemplatePlaceholder('reu'), true);
  assert.equal(isBuiltInTemplatePlaceholder('NOME_MENOR'), false);
});

test('campo desconhecido vira campo personalizado obrigatório do template', () => {
  const result = mergeTemplateFieldDefinitions(['NOME COMPLETO', 'NOME_MENOR'], [], []);
  const menor = result.fields.find((field) => field.placeholder === 'NOME_MENOR');

  assert.equal(menor?.name, 'Nome menor');
  assert.equal(menor?.field_type, 'text');
  assert.equal(menor?.required, true);
  assert.deepEqual(result.newCustomFieldKeys, [normalizeTemplateFieldKey('NOME_MENOR')]);
});

test('preserva campo cadastrado que não foi mais encontrado no arquivo', () => {
  const result = mergeTemplateFieldDefinitions([], [{
    id: 'field-1',
    template_id: 'template-1',
    name: 'Nome do menor',
    placeholder: 'M',
    field_type: 'name',
    enabled: true,
    required: true,
    default_value: null,
    options: null,
    description: null,
    order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }], []);

  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0]?.name, 'Nome do menor');
  assert.equal(result.fields[0]?.placeholder, 'M');
});
