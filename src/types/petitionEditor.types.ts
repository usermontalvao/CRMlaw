// Tipos para o Editor de Petições
// Módulo isolado - pode ser removido sem afetar outros módulos

export type BlockCategory = string;

export type DocumentType = 'petition' | 'contestation' | 'impugnation' | 'appeal';

// Área Jurídica (Trabalhista, Cível, Penal, etc.)
export interface LegalArea {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateLegalAreaDTO {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  order?: number;
  is_active?: boolean;
}

export interface UpdateLegalAreaDTO {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string;
  order?: number;
  is_active?: boolean;
}

// Petição Padrão (Tipo de Petição por Área/Assunto)
// Ex: Previdenciário → Auxílio-acidente, BPC, Aposentadoria
export interface PetitionStandardType {
  id: string;
  legal_area_id: string;
  name: string;
  description?: string | null;
  default_document?: string | null; // SFDT base64 do documento pré-pronto
  default_document_name?: string | null;
  order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePetitionStandardTypeDTO {
  legal_area_id: string;
  name: string;
  description?: string | null;
  default_document?: string | null;
  default_document_name?: string | null;
  order?: number;
  is_active?: boolean;
}

export interface UpdatePetitionStandardTypeDTO {
  name?: string;
  description?: string | null;
  default_document?: string | null;
  default_document_name?: string | null;
  order?: number;
  is_active?: boolean;
}

// Vínculo entre Petição Padrão e Blocos
export interface PetitionStandardTypeBlock {
  id: string;
  standard_type_id: string;
  block_id: string;
  order: number;
  is_default_visible: boolean;
  created_at: string;
}

export interface PetitionBlockCategory {
  id: string;
  document_type: DocumentType;
  key: string;
  label: string;
  order: number;
  is_active: boolean;
  legal_area_id?: string | null;
  created_at: string;
  updated_at: string;
}

// Removido: formatação agora é gerenciada pelo Syncfusion (SFDT)

// Bloco reutilizável
export interface PetitionBlock {
  id: string;
  title: string;
  content: string; // Conteúdo em formato SFDT (Syncfusion)
  category: BlockCategory;
  document_type?: DocumentType;
  legal_area_id?: string | null; // NULL = disponível para todas as áreas
  order: number;
  is_default: boolean; // Se aparece por padrão em novas petições
  is_active: boolean;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreatePetitionBlockDTO {
  title: string;
  content: string; // SFDT
  category: BlockCategory;
  document_type?: DocumentType;
  legal_area_id?: string | null;
  order?: number;
  is_default?: boolean;
  is_active?: boolean;
  tags?: string[];
}

export interface UpdatePetitionBlockDTO {
  title?: string;
  content?: string; // SFDT
  category?: BlockCategory;
  document_type?: DocumentType;
  legal_area_id?: string | null;
  order?: number;
  is_default?: boolean;
  is_active?: boolean;
  tags?: string[];
}

// Petição salva (documento completo)
export interface SavedPetition {
  id: string;
  title: string;
  client_id?: string | null;
  client_name?: string | null;
  process_id?: string | null;
  process_number?: string | null;
  content: string; // HTML do documento
  content_delta?: any; // Quill Delta (JSON)
  blocks_used: string[]; // IDs dos blocos usados
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedPetitionDTO {
  title: string;
  client_id?: string | null;
  client_name?: string | null;
  process_id?: string | null;
  process_number?: string | null;
  content: string;
  content_delta?: any;
  blocks_used?: string[];
  created_by?: string | null;
}

export interface UpdateSavedPetitionDTO {
  title?: string;
  client_id?: string | null;
  client_name?: string | null;
  process_id?: string | null;
  process_number?: string | null;
  content?: string;
  content_delta?: any;
  blocks_used?: string[];
}

// Labels para categorias
export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  cabecalho: 'Cabeçalho',
  qualificacao: 'Qualificação',
  fatos: 'Dos Fatos',
  direito: 'Do Direito',
  pedidos: 'Dos Pedidos',
  citacao: 'Citação',
  encerramento: 'Encerramento',
  outros: 'Outros',
};

// Removido: CLAUSE_FORMATTING_LABELS (formatação agora é via Syncfusion)

// Configurações de formatação para exportação
export const FORMATTING_CONFIG = {
  paragrafo: {
    marginLeft: '4cm',
    textIndent: '0',
    textAlign: 'justify' as const,
    lineHeight: '1.5',
  },
  citacao: {
    marginLeft: '6cm',
    textIndent: '0',
    textAlign: 'justify' as const,
    lineHeight: '1.5',
    fontStyle: 'italic' as const,
    fontSize: '11pt',
  },
  titulo: {
    marginLeft: '0',
    textIndent: '0',
    textAlign: 'center' as const,
    fontWeight: 'bold' as const,
    fontSize: '14pt',
    textTransform: 'uppercase' as const,
  },
  subtitulo: {
    marginLeft: '0',
    textIndent: '0',
    textAlign: 'left' as const,
    fontWeight: 'bold' as const,
    fontSize: '12pt',
  },
};
