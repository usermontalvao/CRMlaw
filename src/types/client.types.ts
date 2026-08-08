/**
 * Tipos para o módulo de Clientes - jurius.com.br
 */

export type ClientType = 'pessoa_fisica' | 'pessoa_juridica';
export type ClientStatus = 'ativo' | 'inativo' | 'suspenso';
export type MaritalStatus = 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel';

export interface Client {
  id: string;
  
  // Dados Pessoais
  full_name: string;
  cpf_cnpj?: string;
  rg?: string;
  birth_date?: string;
  nationality?: string;
  marital_status?: MaritalStatus;
  profession?: string;
  
  // Tipo de Cliente
  client_type: ClientType;
  
  // Dados de Contato
  email?: string;
  phone?: string;
  mobile?: string;
  
  // Endereço
  address_street?: string;
  address_number?: string;
  address_complement?: string;
  address_neighborhood?: string;
  address_city?: string;
  address_state?: string;
  address_zip_code?: string;
  
  // Informações Adicionais
  notes?: string;
  status: ClientStatus;

  // Foto de perfil (path no Supabase Storage, derivada da assinatura facial)
  photo_path?: string | null;
  // Paths de fotos coletadas excluídas/ocultas do perfil (não apaga a prova)
  excluded_photo_paths?: string[] | null;

  // Metadados
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;

  /** Preenchido quando este cadastro foi absorvido por outro na mesclagem de
   *  duplicados. Registros assim ficam fora das listagens e da busca. */
  merged_into_client_id?: string | null;

  /** Pré-cadastro: nome de exibição + telefone anotados no atendimento, de
   *  alguém que ainda não é cliente. Serve para pendurar compromisso, prazo e
   *  documento sem inventar um cliente que não existe — e por isso fica fora da
   *  lista, da busca e das estatísticas do módulo Clientes até ser promovido. */
  is_pre_cadastro?: boolean;
}

export interface CreateClientDTO {
  full_name: string;
  cpf_cnpj?: string;
  rg?: string;
  birth_date?: string;
  nationality?: string;
  marital_status?: MaritalStatus;
  profession?: string;
  client_type: ClientType;
  email?: string;
  phone?: string;
  mobile?: string;
  address_street?: string;
  address_number?: string;
  address_complement?: string;
  address_neighborhood?: string;
  address_city?: string;
  address_state?: string;
  address_zip_code?: string;
  notes?: string;
  status?: ClientStatus;
  photo_path?: string | null;
  is_pre_cadastro?: boolean;
}

export interface UpdateClientDTO extends Partial<CreateClientDTO> {
  id: string;
}

export interface ClientFilters {
  status?: ClientStatus;
  client_type?: ClientType;
  search?: string; // Busca por nome, CPF/CNPJ, email
  sort_order?: 'newest' | 'oldest';
  /**
   * O que fazer com os pré-cadastros (`is_pre_cadastro`).
   *
   * O padrão é `include` de propósito: quem chama `listClients` quase sempre
   * quer resolver um `client_id` num nome ou oferecer um seletor, e sumir com a
   * linha ali significaria compromisso sem dono na tela e campo em branco na
   * hora de editar. Quem mostra a POPULAÇÃO de clientes — a lista do módulo, as
   * estatísticas, a busca global — pede `exclude` explicitamente.
   */
  pre_cadastro?: 'include' | 'exclude' | 'only';
}
