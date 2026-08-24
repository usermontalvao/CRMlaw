import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBuiltInTemplatePlaceholder,
  mergeTemplateFieldDefinitions,
  normalizeTemplateFieldKey,
  selectActiveCustomTemplateFields,
} from './documentTemplateFields.ts';

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
  assert.equal(menor?.show_in_generation, true);
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
    show_in_generation: true,
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

test('campo oculto da geração não é solicitado, mesmo ativo no formulário público', () => {
  const merged = mergeTemplateFieldDefinitions(['NOME_MENOR'], [{
    id: 'field-2',
    template_id: 'template-1',
    name: 'Nome do menor',
    placeholder: 'NOME_MENOR',
    field_type: 'name',
    enabled: true,
    show_in_generation: false,
    required: false,
    default_value: null,
    options: null,
    description: null,
    order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }], []);

  assert.equal(merged.fields[0]?.enabled, true);
  assert.equal(merged.fields[0]?.show_in_generation, false);
  assert.deepEqual(selectActiveCustomTemplateFields(merged.fields, ['NOME_MENOR']), []);
});

test('campo desativado no formulário público continua disponível na geração interna', () => {
  const merged = mergeTemplateFieldDefinitions(['NOME_MENOR'], [{
    id: 'field-3',
    template_id: 'template-1',
    name: 'Nome do menor',
    placeholder: 'NOME_MENOR',
    field_type: 'name',
    enabled: false,
    show_in_generation: true,
    required: true,
    default_value: null,
    options: null,
    description: null,
    order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }], []);

  assert.equal(merged.fields[0]?.enabled, false);
  assert.equal(selectActiveCustomTemplateFields(merged.fields, ['NOME_MENOR']).length, 1);
});
