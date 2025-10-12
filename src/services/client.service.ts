/**
 * Serviço de Clientes - Advogado\Web
 * Gerencia todas as operações CRUD de clientes
 */

import { supabase } from '../config/supabase.js';
import type { Client, CreateClientDTO } from '../types/client.types.js';
import type { ClientFilters } from '../types/client.types.js';

export class ClientService {
  private tableName = 'clients';

  /**
   * Lista todos os clientes com filtros opcionais
   */
  async listClients(filters?: ClientFilters): Promise<Client[]> {
    try {
      let query = supabase.from(this.tableName).select('*');

      // Aplicar filtros
      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.client_type) {
        query = query.eq('client_type', filters.client_type);
      }

      if (filters?.search) {
        query = query.or(
          `full_name.ilike.%${filters.search}%,cpf_cnpj.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
        );
      }

      // Ordenar por data de criação (mais recentes primeiro)
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar clientes:', error);
        throw new Error(`Erro ao listar clientes: ${error.message}`);
      }

      return (data as Client[]) || [];
    } catch (error) {
      console.error('Erro ao listar clientes:', error);
      throw error;
    }
  }

  /**
   * Busca um cliente por ID
   */
  async getClientById(id: string): Promise<Client | null> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Cliente não encontrado
        }
        console.error('Erro ao buscar cliente:', error);
        throw new Error(`Erro ao buscar cliente: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao buscar cliente:', error);
      throw error;
    }
  }

  /**
   * Busca um cliente por CPF/CNPJ
   */
  async getClientByCpfCnpj(cpfCnpj: string): Promise<Client | null> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('cpf_cnpj', cpfCnpj)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Cliente não encontrado
        }
        console.error('Erro ao buscar cliente por CPF/CNPJ:', error);
        throw new Error(`Erro ao buscar cliente: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao buscar cliente por CPF/CNPJ:', error);
      throw error;
    }
  }

  /**
   * Cria um novo cliente
   */
  async createClient(clientData: CreateClientDTO): Promise<Client> {
    try {
      // Validar se CPF/CNPJ já existe (se fornecido)
      if (clientData.cpf_cnpj) {
        const existing = await this.getClientByCpfCnpj(clientData.cpf_cnpj);
        if (existing) {
          throw new Error('Já existe um cliente cadastrado com este CPF/CNPJ');
        }
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([{
          ...clientData,
          status: clientData.status || 'ativo'
        }])
        .select()
        .single();

      if (error) {
        console.error('Erro ao criar cliente:', error);
        throw new Error(`Erro ao criar cliente: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      throw error;
    }
  }

  /**
   * Atualiza um cliente existente
   */
  async updateClient(id: string, updates: Partial<CreateClientDTO>): Promise<Client> {
    try {
      // Verificar se o cliente existe
      const existing = await this.getClientById(id);
      if (!existing) {
        throw new Error('Cliente não encontrado');
      }

      // Validar CPF/CNPJ único (se estiver sendo atualizado)
      if (updates.cpf_cnpj && updates.cpf_cnpj !== existing.cpf_cnpj) {
        const duplicate = await this.getClientByCpfCnpj(updates.cpf_cnpj);
        if (duplicate && duplicate.id !== id) {
          throw new Error('Já existe outro cliente cadastrado com este CPF/CNPJ');
        }
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Erro ao atualizar cliente:', error);
        throw new Error(`Erro ao atualizar cliente: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      throw error;
    }
  }

  /**
   * Deleta um cliente (soft delete - marca como inativo)
   */
  async deleteClient(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erro ao deletar cliente:', error);
        throw new Error(`Erro ao deletar cliente: ${error.message}`);
      }
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
      throw error;
    }
  }

  /**
   * Deleta permanentemente um cliente
   */
  async permanentlyDeleteClient(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erro ao deletar cliente permanentemente:', error);
        throw new Error(`Erro ao deletar cliente: ${error.message}`);
      }
    } catch (error) {
      console.error('Erro ao deletar cliente permanentemente:', error);
      throw error;
    }
  }

  /**
   * Conta o total de clientes com filtros opcionais
   */
  async countClients(filters?: ClientFilters): Promise<number> {
    try {
      let query = supabase.from(this.tableName).select('*', { count: 'exact', head: true });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.client_type) {
        query = query.eq('client_type', filters.client_type);
      }

      const { count, error } = await query;

      if (error) {
        console.error('Erro ao contar clientes:', error);
        throw new Error(`Erro ao contar clientes: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      console.error('Erro ao contar clientes:', error);
      throw error;
    }
  }

  async searchClients(
    query: string,
    limit: number = 8
  ): Promise<Array<Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'status' | 'client_type'>>> {
    const term = query.trim();
    if (!term) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('id, full_name, email, phone, status, client_type')
        .or(`full_name.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,email.ilike.%${term}%`)
        .order('full_name', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Erro ao buscar clientes:', error);
        throw new Error(`Erro ao buscar clientes: ${error.message}`);
      }

      return (data as Array<Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'status' | 'client_type'>>) || [];
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      throw error;
    }
  }
}

// Exportar instância singleton
export const clientService = new ClientService();
