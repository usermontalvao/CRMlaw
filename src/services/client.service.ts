/**
 * Serviço de Clientes - jurius.com.br
 * Gerencia todas as operações CRUD de clientes
 */

import { supabase } from '../config/supabase.js';
import type { Client, CreateClientDTO } from '../types/client.types.js';
import type { ClientFilters } from '../types/client.types.js';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';

const isBlankValue = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const clientMergeFields: Array<keyof CreateClientDTO> = [
  'full_name',
  'cpf_cnpj',
  'rg',
  'birth_date',
  'nationality',
  'marital_status',
  'profession',
  'client_type',
  'email',
  'phone',
  'mobile',
  'address_street',
  'address_number',
  'address_complement',
  'address_neighborhood',
  'address_city',
  'address_state',
  'address_zip_code',
  'notes',
  'status',
];

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

      // Ordenação
      const sortAscending = filters?.sort_order === 'oldest';
      query = query.order('full_name', { ascending: !sortAscending ? true : true });

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar clientes:', error);
        throw new Error(`Erro ao listar clientes: ${error.message}`);
      }

      const rows = (data as Client[]) || [];
      if (!filters?.search) return rows;

      const normalizedSearch = normalizeSearchText(filters.search);
      if (!normalizedSearch) return rows;

      return rows.filter((client) => matchesNormalizedSearch(normalizedSearch, [client.full_name, client.cpf_cnpj, client.email]));
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
   * Busca um cliente por e-mail
   */
  async getClientByEmail(email: string): Promise<Client | null> {
    try {
      const normalizedEmail = email.trim();
      if (!normalizedEmail) {
        return null;
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .ilike('email', normalizedEmail)
        .maybeSingle();

      if (error) {
        console.error('Erro ao buscar cliente por e-mail:', error);
        throw new Error(`Erro ao buscar cliente: ${error.message}`);
      }

      return data ?? null;
    } catch (error) {
      console.error('Erro ao buscar cliente por e-mail:', error);
      throw error;
    }
  }

  async mergeClients(targetId: string, sourceIds: string[]): Promise<Client> {
    try {
      const uniqueSourceIds = Array.from(new Set(sourceIds.filter((id) => id && id !== targetId)));
      if (uniqueSourceIds.length === 0) {
        throw new Error('Nenhum contato duplicado informado para mesclagem');
      }

      const target = await this.getClientById(targetId);
      if (!target) {
        throw new Error('Cliente principal não encontrado');
      }

      const { data: sourceRows, error: sourceError } = await supabase
        .from(this.tableName)
        .select('*')
        .in('id', uniqueSourceIds);

      if (sourceError) {
        throw new Error(`Erro ao carregar contatos para mesclagem: ${sourceError.message}`);
      }

      const sources = (sourceRows as Client[] | null) ?? [];
      if (sources.length === 0) {
        throw new Error('Nenhum contato duplicado encontrado para mesclagem');
      }

      const mergedPayload: Partial<CreateClientDTO> = {};

      for (const field of clientMergeFields) {
        const currentValue = target[field];
        if (!isBlankValue(currentValue)) continue;

        for (const source of sources) {
          const candidate = source[field];
          if (!isBlankValue(candidate)) {
            mergedPayload[field] = candidate as any;
            break;
          }
        }
      }

      const notes = [target.notes, ...sources.map((source) => source.notes).filter(Boolean)]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      const uniqueNotes = Array.from(new Set(notes));
      if (uniqueNotes.length > 0) {
        mergedPayload.notes = uniqueNotes.join(' | ');
      }

      if (!mergedPayload.status) {
        mergedPayload.status = target.status || 'ativo';
      }

      const { data: updatedTarget, error: updateError } = await supabase
        .from(this.tableName)
        .update({
          ...mergedPayload,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetId)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(`Erro ao atualizar cliente principal: ${updateError.message}`);
      }

      for (const source of sources) {
        const mergeNote = `Mesclado com ${updatedTarget.full_name} (${updatedTarget.id}) em ${new Date().toLocaleString('pt-BR')}`;
        const sourceNotes = [source.notes, mergeNote]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .join(' | ');

        const { error } = await supabase
          .from(this.tableName)
          .update({
            status: 'inativo',
            cpf_cnpj: null,
            email: null,
            phone: null,
            mobile: null,
            notes: sourceNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', source.id);

        if (error) {
          throw new Error(`Erro ao inativar contato mesclado: ${error.message}`);
        }
      }

      localStorage.removeItem('crm-dashboard-cache');
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, {
        action: 'merge',
        targetId,
        sourceIds: uniqueSourceIds,
        client: updatedTarget,
      });

      return updatedTarget as Client;
    } catch (error) {
      console.error('Erro ao mesclar clientes:', error);
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

      // Invalida cache do dashboard para forçar recarregamento
      localStorage.removeItem('crm-dashboard-cache');
      
      // Dispara evento global de mudança de clientes
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'create', client: data });

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

      // Invalida cache do dashboard para forçar recarregamento
      localStorage.removeItem('crm-dashboard-cache');
      
      // Dispara evento global de mudança de clientes
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', client: data });

      return data;
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      throw error;
    }
  }

  /**
   * Deleta um cliente permanentemente
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

      // Invalida cache do dashboard para forçar recarregamento
      localStorage.removeItem('crm-dashboard-cache');
      
      // Dispara evento global de mudança de clientes
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'delete', id });
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
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
  ): Promise<Array<Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'mobile' | 'status' | 'client_type'>>> {
    const term = query.trim();
    if (!term) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('id, full_name, email, phone, mobile, status, client_type')
        .order('full_name', { ascending: true })
        .limit(200);

      if (error) {
        console.error('Erro ao buscar clientes:', error);
        throw new Error(`Erro ao buscar clientes: ${error.message}`);
      }

      const rows = (data as Array<Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'mobile' | 'status' | 'client_type'>>) || [];
      const normalizedSearch = normalizeSearchText(term);
      return rows
        .filter((client) => matchesNormalizedSearch(normalizedSearch, [client.full_name, client.email, client.phone, client.mobile]))
        .slice(0, limit);
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      throw error;
    }
  }
}

// Exportar instância singleton
export const clientService = new ClientService();
