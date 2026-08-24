import type {
  CustomField,
  TemplateCustomField,
  TemplateCustomFieldType,
  UpsertTemplateCustomFieldDTO,
} from '../types/document.types';

export interface BuiltInTemplateField {
  placeholder: string;
  label: string;
  fieldType: TemplateCustomFieldType;
}

export const normalizeTemplateFieldKey = (value: string) =>
  (value || '')
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
    .toUpperCase();

export const BUILT_IN_TEMPLATE_FIELDS: BuiltInTemplateField[] = [
  { label: 'Nome completo', placeholder: 'NOME COMPLETO', fieldType: 'name' },
  { label: 'Nome completo', placeholder: 'NOME', fieldType: 'name' },
  { label: 'Nacionalidade', placeholder: 'nacionalidade', fieldType: 'text' },
  { label: 'Estado civil', placeholder: 'estado civil', fieldType: 'text' },
  { label: 'Profissão', placeholder: 'profissão', fieldType: 'text' },
  { label: 'RG', placeholder: 'RG', fieldType: 'text' },
  { label: 'Data de nascimento', placeholder: 'DATA_NASCIMENTO', fieldType: 'date' },
  { label: 'CPF/CNPJ', placeholder: 'CPF', fieldType: 'cpf' },
  { label: 'Endereço (rua)', placeholder: 'endereço', fieldType: 'text' },
  { label: 'Número', placeholder: 'número', fieldType: 'text' },
  { label: 'Complemento', placeholder: 'complemento', fieldType: 'text' },
  { label: 'Bairro', placeholder: 'bairro', fieldType: 'text' },
  { label: 'Cidade', placeholder: 'cidade', fieldType: 'text' },
  { label: 'Estado', placeholder: 'estado', fieldType: 'text' },
  { label: 'UF', placeholder: 'UF', fieldType: 'text' },
  { label: 'CEP', placeholder: 'CEP', fieldType: 'cep' },
  { label: 'Endereço completo', placeholder: 'ENDERECO_COMPLETO', fieldType: 'textarea' },
  { label: 'Telefone', placeholder: 'telefone', fieldType: 'phone' },
  { label: 'Celular/WhatsApp', placeholder: 'celular', fieldType: 'phone' },
  { label: 'E-mail', placeholder: 'email', fieldType: 'text' },
  { label: 'Réu/Parte contrária', placeholder: 'réu', fieldType: 'name' },
  { label: 'Data de geração', placeholder: 'data', fieldType: 'date' },
  { label: 'Data de geração', placeholder: 'DATA_ATUAL', fieldType: 'date' },
];

const builtInByKey = new Map(
  BUILT_IN_TEMPLATE_FIELDS.map((field) => [normalizeTemplateFieldKey(field.placeholder), field]),
);

export const getBuiltInTemplateField = (placeholder: string) =>
  builtInByKey.get(normalizeTemplateFieldKey(placeholder));

export const isBuiltInTemplatePlaceholder = (placeholder: string) =>
  builtInByKey.has(normalizeTemplateFieldKey(placeholder));

export const humanizeTemplatePlaceholder = (placeholder: string) => {
  const humanized = (placeholder || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
  return humanized ? humanized.charAt(0).toLocaleUpperCase('pt-BR') + humanized.slice(1) : 'Campo personalizado';
};

const toTemplateFieldType = (field?: CustomField): TemplateCustomFieldType => {
  if (!field) return 'text';
  if (['text', 'number', 'date', 'select', 'textarea'].includes(field.field_type)) {
    return field.field_type as TemplateCustomFieldType;
  }
  return 'text';
};

export interface MergeTemplateFieldsResult {
  fields: UpsertTemplateCustomFieldDTO[];
  newCustomFieldKeys: string[];
}

/**
 * Une o que foi encontrado nos arquivos com a configuração já salva.
 * Configurações salvas que deixaram de aparecer no DOCX são preservadas para
 * que o administrador possa corrigi-las ou removê-las conscientemente.
 */
export const mergeTemplateFieldDefinitions = (
  detectedPlaceholders: string[],
  existingFields: TemplateCustomField[],
  globalFields: CustomField[] = [],
): MergeTemplateFieldsResult => {
  const existingByKey = new Map(existingFields.map((field) => [normalizeTemplateFieldKey(field.placeholder), field]));
  const globalByKey = new Map(globalFields.map((field) => [normalizeTemplateFieldKey(field.placeholder), field]));
  const detectedKeys = new Set(detectedPlaceholders.map(normalizeTemplateFieldKey));
  const seen = new Set<string>();
  const newCustomFieldKeys: string[] = [];

  const fields = detectedPlaceholders.map((placeholder, index): UpsertTemplateCustomFieldDTO => {
    const key = normalizeTemplateFieldKey(placeholder);
    seen.add(key);
    const existing = existingByKey.get(key);
    const globalField = globalByKey.get(key);
    const builtIn = getBuiltInTemplateField(placeholder);

    if (!existing && !globalField && !builtIn) newCustomFieldKeys.push(key);

    return {
      name: existing?.name ?? globalField?.name ?? builtIn?.label ?? humanizeTemplatePlaceholder(placeholder),
      placeholder,
      field_type: existing?.field_type ?? builtIn?.fieldType ?? toTemplateFieldType(globalField),
      enabled: existing?.enabled ?? true,
      show_in_generation: existing?.show_in_generation ?? true,
      required: existing?.required ?? globalField?.required ?? (!builtIn),
      default_value: existing?.default_value ?? globalField?.default_value ?? null,
      options: existing?.options ?? globalField?.options ?? null,
      description: existing?.description ?? globalField?.description ?? null,
      order: existing?.order ?? index,
    };
  });

  for (const existing of existingFields) {
    const key = normalizeTemplateFieldKey(existing.placeholder);
    if (seen.has(key)) continue;
    fields.push({
      name: existing.name,
      placeholder: existing.placeholder,
      field_type: existing.field_type,
      enabled: existing.enabled,
      show_in_generation: existing.show_in_generation ?? true,
      required: existing.required,
      default_value: existing.default_value ?? null,
      options: existing.options ?? null,
      description: existing.description ?? null,
      order: existing.order,
    });
  }

  fields.sort((a, b) => {
    const aDetected = detectedKeys.has(normalizeTemplateFieldKey(a.placeholder));
    const bDetected = detectedKeys.has(normalizeTemplateFieldKey(b.placeholder));
    if (aDetected !== bDetected) return aDetected ? -1 : 1;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  return {
    fields: fields.map((field, index) => ({ ...field, order: index })),
    newCustomFieldKeys,
  };
};

/** Campos adicionais que realmente devem ser solicitados na geração. */
export const selectActiveCustomTemplateFields = (
  fields: UpsertTemplateCustomFieldDTO[],
  detectedPlaceholders: string[],
) => {
  const detectedKeys = new Set(detectedPlaceholders.map(normalizeTemplateFieldKey));
  return fields.filter((field) =>
    field.show_in_generation !== false
    && !isBuiltInTemplatePlaceholder(field.placeholder)
    && detectedKeys.has(normalizeTemplateFieldKey(field.placeholder)),
  );
};
