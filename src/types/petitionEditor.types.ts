// Tipos para o Editor de Petições Trabalhistas
// Módulo isolado - pode ser removido sem afetar outros módulos

export type BlockCategory = string;

export type DocumentType = 'petition' | 'contestation' | 'impugnation' | 'appeal';

export interface PetitionBlockCategory {
  id: string;
  document_type: DocumentType;
  key: string;
  label: string;
  order: number;
  is_active: boolean;
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
