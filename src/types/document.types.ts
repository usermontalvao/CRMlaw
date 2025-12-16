// Configuração de posição de assinatura no template
export interface SignatureFieldConfig {
  page: number; // Página onde a assinatura deve aparecer (1-indexed)
  x_percent: number; // Posição X em porcentagem (0-100)
  y_percent: number; // Posição Y em porcentagem (0-100)
  width_percent: number; // Largura em porcentagem
  height_percent: number; // Altura em porcentagem
}

export type SignatureFieldConfigValue = SignatureFieldConfig | SignatureFieldConfig[] | null;

// Arquivo individual dentro de um template (para múltiplos documentos)
export interface TemplateFile {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  order: number; // Ordem do documento no template
  signature_field_config?: SignatureFieldConfigValue; // Configuração de assinatura específica deste arquivo
  created_at: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  content: string;
  // Campos legados para compatibilidade (documento único)
  file_path?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  // Configuração de campos de assinatura (legado - documento único)
  signature_field_config?: SignatureFieldConfigValue;
  // NOVO: Múltiplos arquivos por template
  files?: TemplateFile[];
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentTemplateDTO {
  name: string;
  description?: string;
  content: string;
}

export interface GeneratedDocument {
  id: string;
  template_id: string;
  template_name: string;
  client_id: string;
  client_name: string;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
  created_at: string;
}

export interface CreateGeneratedDocumentDTO {
  template_id: string;
  template_name: string;
  client_id: string;
  client_name: string;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
}

// Campos personalizados GLOBAIS para documentos
// Complementam os campos padrão do cliente (NOME COMPLETO, CPF, etc.)
export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'textarea' | 'currency' | 'signature';

export interface CustomFieldOption {
  value: string;
  label: string;
}

export interface CustomField {
  id: string;
  name: string; // Nome do campo (ex: "Valor do Contrato")
  placeholder: string; // Placeholder no template (ex: "VALOR_CONTRATO")
  field_type: CustomFieldType;
  required: boolean;
  default_value?: string;
  options?: CustomFieldOption[]; // Para campos do tipo 'select'
  description?: string; // Descrição/ajuda para o usuário
  order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomFieldDTO {
  name: string;
  placeholder: string;
  field_type: CustomFieldType;
  required?: boolean;
  default_value?: string;
  options?: CustomFieldOption[];
  description?: string;
  order?: number;
}

export interface UpdateCustomFieldDTO {
  name?: string;
  placeholder?: string;
  field_type?: CustomFieldType;
  required?: boolean;
  default_value?: string;
  options?: CustomFieldOption[];
  description?: string;
  order?: number;
}
