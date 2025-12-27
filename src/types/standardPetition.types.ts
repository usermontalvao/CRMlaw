// Tipos para Petições Padrões

export type StandardPetitionFieldType = 'text' | 'number' | 'date' | 'select' | 'textarea' | 'currency' | 'cpf' | 'phone' | 'cep';

export interface StandardPetitionFieldOption {
  value: string;
  label: string;
}

// Campo personalizado de uma petição padrão
export interface StandardPetitionField {
  id: string;
  petition_id: string;
  name: string; // Nome do campo (ex: "Valor do Benefício")
  placeholder: string; // Placeholder no template (ex: "VALOR_BENEFICIO")
  field_type: StandardPetitionFieldType;
  required: boolean;
  default_value?: string | null;
  options?: StandardPetitionFieldOption[] | null; // Para campos do tipo 'select'
  description?: string | null; // Descrição/ajuda para o usuário
  order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStandardPetitionFieldDTO {
  name: string;
  placeholder: string;
  field_type: StandardPetitionFieldType;
  required?: boolean;
  default_value?: string | null;
  options?: StandardPetitionFieldOption[] | null;
  description?: string | null;
  order?: number;
}

export interface UpdateStandardPetitionFieldDTO {
  name?: string;
  placeholder?: string;
  field_type?: StandardPetitionFieldType;
  required?: boolean;
  default_value?: string | null;
  options?: StandardPetitionFieldOption[] | null;
  description?: string | null;
  order?: number;
}

// Categoria de petição
export type StandardPetitionCategory = 
  | 'requerimento_administrativo'
  | 'peticao_inicial'
  | 'recurso'
  | 'contestacao'
  | 'outros';

// Petição Padrão
export interface StandardPetition {
  id: string;
  name: string; // Nome da petição (ex: "Requerimento Administrativo INSS")
  description?: string | null;
  category: StandardPetitionCategory;
  content: string; // Conteúdo do template com placeholders [[CAMPO]]
  file_path?: string | null; // Arquivo DOCX opcional
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  is_active: boolean;
  fields?: StandardPetitionField[]; // Campos personalizados
  created_at: string;
  updated_at: string;
}

export interface CreateStandardPetitionDTO {
  name: string;
  description?: string | null;
  category: StandardPetitionCategory;
  content: string;
  is_active?: boolean;
}

export interface UpdateStandardPetitionDTO {
  name?: string;
  description?: string | null;
  category?: StandardPetitionCategory;
  content?: string;
  is_active?: boolean;
}

// Histórico de documentos gerados
export interface GeneratedPetitionDocument {
  id: string;
  petition_id: string;
  petition_name: string;
  client_id?: string | null;
  client_name?: string | null;
  requirement_id?: string | null;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
  field_values?: Record<string, string> | null; // Valores preenchidos
  created_by?: string | null;
  created_at: string;
}

export interface CreateGeneratedPetitionDocumentDTO {
  petition_id: string;
  petition_name: string;
  client_id?: string | null;
  client_name?: string | null;
  requirement_id?: string | null;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
  field_values?: Record<string, string> | null;
  created_by?: string | null;
}

// Labels para categorias
export const PETITION_CATEGORY_LABELS: Record<StandardPetitionCategory, string> = {
  requerimento_administrativo: 'Requerimento Administrativo',
  peticao_inicial: 'Petição Inicial',
  recurso: 'Recurso',
  contestacao: 'Contestação',
  outros: 'Outros',
};

// Labels para tipos de campo
export const PETITION_FIELD_TYPE_LABELS: Record<StandardPetitionFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  textarea: 'Texto Longo',
  currency: 'Moeda',
  cpf: 'CPF',
  phone: 'Telefone',
  cep: 'CEP',
};
