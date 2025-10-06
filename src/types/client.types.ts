/**
 * Tipos para o módulo de Clientes - Advogado\Web
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
  
  // Metadados
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
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
}

export interface UpdateClientDTO extends Partial<CreateClientDTO> {
  id: string;
}

export interface ClientFilters {
  status?: ClientStatus;
  client_type?: ClientType;
  search?: string; // Busca por nome, CPF/CNPJ, email
}
