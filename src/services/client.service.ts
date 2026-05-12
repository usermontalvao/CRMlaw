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

      // Busca sem ordenação no banco — vamos ordenar client-side para suportar
      // prioridade de status (ativo > suspenso > inativo) + nome alfabético.
      query = query.order('full_name', { ascending: true });

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar clientes:', error);
        throw new Error(`Erro ao listar clientes: ${error.message}`);
      }

      let rows = (data as Client[]) || [];

      // Filtro de texto client-side (accent-insensitive)
      if (filters?.search) {
        const normalizedSearch = normalizeSearchText(filters.search);
        if (normalizedSearch) {
          rows = rows.filter((client) =>
            matchesNormalizedSearch(normalizedSearch, [client.full_name, client.cpf_cnpj, client.email])
          );
        }
      }

      // Ordenação: ativo > suspenso > inativo, depois nome A-Z (ou Z-A se oldest)
      const statusOrder = (s: string) => (s === 'ativo' ? 0 : s === 'suspenso' ? 1 : 2);
      const nameAsc = filters?.sort_order !== 'oldest';
      rows.sort((a, b) => {
        const statusDiff = statusOrder(a.status) - statusOrder(b.status);
        if (statusDiff !== 0) return statusDiff;
        const nameA = (a.full_name || '').toLowerCase();
        const nameB = (b.full_name || '').toLowerCase();
        return nameAsc ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      });

      return rows;
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

      // Sort all clients by recency (most recently updated first).
      // This means: for any field where multiple records have data, we pick
      // the value from the most recently updated record (recency wins conflicts).
      // For fields only one record has, it gets filled in regardless (complementary merge).
      const allClients = [target, ...sources].sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || '0').getTime() -
          new Date(a.updated_at || a.created_at || '0').getTime()
      );

      const mergedPayload: Partial<CreateClientDTO> = {};

      for (const field of clientMergeFields) {
        // Skip notes — handled separately below
        if (field === 'notes') continue;
        for (const client of allClients) {
          const candidate = client[field];
          if (!isBlankValue(candidate)) {
            mergedPayload[field] = candidate as any;
            break; // first non-blank from recency-sorted list wins
          }
        }
      }

      // Merge notes: concatenate all unique non-blank notes separated by " | "
      const notes = allClients
        .map((c) => String(c.notes || '').trim())
        .filter(Boolean);
      const uniqueNotes = Array.from(new Set(notes));
      if (uniqueNotes.length > 0) {
        mergedPayload.notes = uniqueNotes.join(' | ');
      }

      if (!mergedPayload.status) {
        mergedPayload.status = target.status || 'ativo';
      }

      // ── Step 1: clear unique-constrained fields on ALL sources FIRST ──────────
      // This must happen before we update the target, because the target may
      // be receiving a cpf_cnpj / email that is currently held by a source.
      // Postgres would throw a unique violation if both rows hold the same value
      // even briefly.
      for (const source of sources) {
        const { error: clearError } = await supabase
          .from(this.tableName)
          .update({
            cpf_cnpj: null,
            email: null,
            phone: null,
            mobile: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', source.id);

        if (clearError) {
          throw new Error(`Erro ao limpar campos do contato duplicado: ${clearError.message}`);
        }
      }

      // ── Step 2: update the target with the merged data ────────────────────────
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

      // ── Step 3: inactivate sources and record the merge note ──────────────────
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
      // Normalizar nome para maiúsculas
      if (clientData.full_name) {
        clientData = { ...clientData, full_name: clientData.full_name.toUpperCase() };
      }

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
      // Normalizar nome para maiúsculas
      if (updates.full_name) {
        updates = { ...updates, full_name: updates.full_name.toUpperCase() };
      }

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

  /**
   * Define ou remove a foto de perfil do cliente (path no Storage).
   * Requer coluna photo_path na tabela clients.
   */
  async setClientPhoto(id: string, photoPath: string | null): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error(`Erro ao salvar foto do perfil: ${error.message}`);
    }

    localStorage.removeItem('crm-dashboard-cache');
    events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', id });
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
      // Busca todos os clientes e filtra client-side com normalização de acentos.
      // Não usamos ILIKE direto no Supabase porque PostgreSQL ILIKE é case-insensitive
      // mas NÃO é accent-insensitive: "fabiola" não casa com "Fabíola" no banco.
      const { data, error } = await supabase
        .from(this.tableName)
        .select('id, full_name, email, phone, mobile, status, client_type')
        .neq('status', 'inativo')
        .order('full_name', { ascending: true });

      if (error) {
        console.error('Erro ao buscar clientes:', error);
        throw new Error(`Erro ao buscar clientes: ${error.message}`);
      }

      const rows = (data as Array<Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'mobile' | 'status' | 'client_type'>>) || [];
      const normalizedSearch = normalizeSearchText(term);

      const filtered = rows.filter((client) =>
        matchesNormalizedSearch(normalizedSearch, [client.full_name, client.email, client.phone, client.mobile])
      );

      // Deduplica por nome normalizado, priorizando o registro com mais dados
      const seen = new Map<string, typeof filtered[number]>();
      for (const client of filtered) {
        const key = normalizeSearchText(client.full_name);
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, client);
        } else {
          const existingScore = [existing.email, existing.phone, existing.mobile].filter(Boolean).length;
          const newScore = [client.email, client.phone, client.mobile].filter(Boolean).length;
          if (newScore > existingScore) seen.set(key, client);
        }
      }

      const deduped = Array.from(seen.values());

      // Ordena: nomes que começam com o termo pesquisado primeiro
      const normalizedName = (c: typeof deduped[number]) => normalizeSearchText(c.full_name);
      deduped.sort((a, b) => {
        const aStarts = normalizedName(a).startsWith(normalizedSearch);
        const bStarts = normalizedName(b).startsWith(normalizedSearch);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return normalizedName(a).localeCompare(normalizedName(b));
      });

      return deduped.slice(0, limit);
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      throw error;
    }
  }
}

// Exportar instância singleton
export const clientService = new ClientService();
