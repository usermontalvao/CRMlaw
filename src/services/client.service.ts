/**
 * Serviço de Clientes - jurius.com.br
 * Gerencia todas as operações CRUD de clientes
 */

import { supabase } from '../config/supabase.js';
import type { Client, CreateClientDTO } from '../types/client.types.js';
import type { ClientFilters } from '../types/client.types.js';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { syncBus } from '../lib/syncBus';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { clientChangeHistoryService, type ClientChangeSource } from './clientChangeHistory.service';
import { areClientValuesEquivalent } from '../utils/clientValueEquivalence';

// ─── Cache ────────────────────────────────────────────────────────────────────
// Cache em memória por chave de filtros server-side (status, client_type).
// Filtros client-side (search, sort_order) são aplicados sobre os dados em cache,
// evitando round-trips ao Supabase a cada digitação de busca.
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

interface ClientCacheEntry {
  data: Client[];
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────

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

  // Cache: Map keyed by server-side filter JSON
  private _cache = new Map<string, ClientCacheEntry>();

  /** Gera a chave de cache usando apenas os filtros enviados ao Supabase. */
  private getCacheKey(serverFilters: Record<string, unknown>): string {
    return JSON.stringify(serverFilters);
  }

  private isCacheValid(key: string): boolean {
    const entry = this._cache.get(key);
    return !!entry && Date.now() - entry.timestamp < CACHE_DURATION;
  }

  /** Invalida todo o cache. Chamado em qualquer mutação (create/update/delete/merge). */
  invalidateCache(): void {
    this._cache.clear();
  }

  /**
   * Lista todos os clientes com filtros opcionais.
   *
   * Filtros server-side (status, client_type) determinam a chave de cache.
   * Filtros client-side (search, sort_order) são aplicados sobre o cache,
   * permitindo buscas instantâneas sem round-trip ao Supabase.
   */
  async listClients(filters?: ClientFilters): Promise<Client[]> {
    // Separar filtros: server-side vs client-side
    const { search, sort_order, pre_cadastro, ...serverFilters } = filters ?? {};
    const cacheKey = this.getCacheKey(serverFilters);

    let rows: Client[];

    if (this.isCacheValid(cacheKey)) {
      rows = this._cache.get(cacheKey)!.data;
    } else {
      try {
        let query = supabase.from(this.tableName).select('*');

        if (serverFilters.status) {
          query = query.eq('status', serverFilters.status as string);
        }
        if (serverFilters.client_type) {
          query = query.eq('client_type', serverFilters.client_type as string);
        }

        query = query.order('full_name', { ascending: true });

        const { data, error } = await query;

        if (error) {
          console.error('Erro ao listar clientes:', error);
          throw new Error(`Erro ao listar clientes: ${error.message}`);
        }

        // Cadastros absorvidos numa mesclagem não são clientes: existem só para
        // auditoria. Ficam fora da listagem e, por tabela, da busca global.
        // O corte é feito aqui e não no `select` de propósito — se a coluna
        // ainda não estiver no cache de schema do PostgREST, um filtro na query
        // derrubaria a listagem inteira, e ficar sem clientes é pior que ver um
        // duplicado.
        rows = ((data as Client[]) ?? []).filter((client) => !client.merged_into_client_id);
        this._cache.set(cacheKey, { data: rows, timestamp: Date.now() });
      } catch (error) {
        console.error('Erro ao listar clientes:', error);
        throw error;
      }
    }

    // ── Filtros client-side ───────────────────────────────────────────────────
    let result = rows;

    // Pré-cadastros. O corte é feito aqui, e não no `select`, pelo mesmo motivo
    // do `merged_into_client_id`: coluna nova fora do cache de schema do
    // PostgREST derruba a listagem inteira, e ficar sem clientes é pior.
    if (pre_cadastro === 'exclude') {
      result = result.filter((client) => !client.is_pre_cadastro);
    } else if (pre_cadastro === 'only') {
      result = result.filter((client) => !!client.is_pre_cadastro);
    }

    if (search) {
      const normalizedSearch = normalizeSearchText(search);
      if (normalizedSearch) {
        result = result.filter((client) =>
          matchesNormalizedSearch(normalizedSearch, [client.full_name, client.cpf_cnpj, client.email])
        );
      }
    }

    // Ordenação: ativo > suspenso > inativo, depois nome A-Z (ou Z-A)
    const statusOrder = (s: string) => (s === 'ativo' ? 0 : s === 'suspenso' ? 1 : 2);
    const nameAsc = sort_order !== 'oldest';
    result = [...result].sort((a, b) => {
      const statusDiff = statusOrder(a.status) - statusOrder(b.status);
      if (statusDiff !== 0) return statusDiff;
      const nameA = (a.full_name || '').toLowerCase();
      const nameB = (b.full_name || '').toLowerCase();
      return nameAsc ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });

    return result;
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

      const allClients = [target, ...sources].sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || '0').getTime() -
          new Date(a.updated_at || a.created_at || '0').getTime()
      );

      // Campo a campo, vence o dado mais recente que NÃO esteja em branco.
      // Ou seja: um cadastro novo e incompleto atualiza só o que ele traz
      // preenchido — o resto permanece como estava no cadastro antigo.
      //
      // E se o valor que venceu for o MESMO dado do principal escrito de outro
      // jeito ("Advogado"/"advogado", "65984046375"/"(65) 98404-6375"), o
      // principal fica como está: não é atualização, é troca de máscara, e não
      // tem por que virar linha no histórico.
      const mergedPayload: Partial<CreateClientDTO> = {};
      const origins = new Map<string, Client>();

      for (const field of clientMergeFields) {
        if (field === 'notes') continue;
        for (const client of allClients) {
          const candidate = client[field];
          if (isBlankValue(candidate)) continue;
          if (areClientValuesEquivalent(field as string, target[field], candidate)) {
            // Mesmo dado: preserva exatamente o que já estava no principal.
            if (!isBlankValue(target[field])) mergedPayload[field] = target[field] as any;
            else mergedPayload[field] = candidate as any;
          } else {
            mergedPayload[field] = candidate as any;
            origins.set(field, client);
          }
          break;
        }
      }

      const notes = allClients
        .map((c) => String(c.notes || '').trim())
        .filter(Boolean);
      const uniqueNotes = notes.filter(
        (note, index) => notes.findIndex((other) => areClientValuesEquivalent('notes', other, note)) === index,
      );
      if (uniqueNotes.length > 0) {
        mergedPayload.notes = uniqueNotes.join(' | ');
        origins.set('notes', allClients.find((c) => String(c.notes || '').trim()) ?? target);
      }

      if (!mergedPayload.status) {
        mergedPayload.status = target.status || 'ativo';
      }

      // O que o cadastro principal perdeu na mesclagem fica registrado — nada
      // do valor antigo é descartado, ele só sai da tela.
      const historyEntries = clientMergeFields
        .filter((field) => !isBlankValue(mergedPayload[field]))
        .filter((field) => !areClientValuesEquivalent(field as string, target[field], mergedPayload[field]))
        .map((field) => {
          const from = origins.get(field as string);
          return {
            field: field as string,
            oldValue: target[field],
            newValue: mergedPayload[field],
            sourceClientId: from && from.id !== targetId ? from.id : null,
            sourceLabel: from && from.id !== targetId ? from.full_name : null,
          };
        });

      // Antes de esvaziar o duplicado, leva junto tudo que estava pendurado
      // nele — processos, prazos, pastas do Nextcloud, acordos, assinaturas.
      // Sem isso o trabalho do cliente ficava órfão num cadastro inativo.
      const movedRelations: Record<string, number> = {};
      for (const source of sources) {
        const { data: moved, error: relError } = await supabase.rpc('merge_client_relations', {
          p_target: targetId,
          p_source: source.id,
        });
        if (relError) {
          throw new Error(`Erro ao transferir os vínculos do contato duplicado: ${relError.message}`);
        }
        for (const [key, value] of Object.entries((moved ?? {}) as Record<string, number>)) {
          movedRelations[key] = (movedRelations[key] ?? 0) + Number(value || 0);
        }
      }

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

      await clientChangeHistoryService.record(targetId, 'mesclagem', historyEntries);

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
            // Marca o cadastro como absorvido: ele continua existindo para
            // auditoria, mas some das listagens e da busca — antes ficava
            // aparecendo e dava a impressão de que a mesclagem não rodou.
            merged_into_client_id: targetId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', source.id);

        if (error) {
          throw new Error(`Erro ao inativar contato mesclado: ${error.message}`);
        }
      }

      this.invalidateCache();
      localStorage.removeItem('crm-dashboard-cache');
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, {
        action: 'merge',
        targetId,
        sourceIds: uniqueSourceIds,
        client: updatedTarget,
        movedRelations,
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
      if (clientData.full_name) {
        clientData = { ...clientData, full_name: clientData.full_name.toUpperCase() };
      }

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

      this.invalidateCache();
      localStorage.removeItem('crm-dashboard-cache');
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'create', client: data });
      syncBus.emit('clients');

      return data;
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      throw error;
    }
  }

  /**
   * Atualiza um cliente existente
   */
  /**
   * Atualiza o cadastro. `source` diz de onde veio a alteração — é o que a
   * ficha mostra no histórico ("Edição manual", "Dados da assinatura"...).
   */
  async updateClient(
    id: string,
    updates: Partial<CreateClientDTO>,
    source: ClientChangeSource = 'edicao',
  ): Promise<Client> {
    try {
      if (updates.full_name) {
        updates = { ...updates, full_name: updates.full_name.toUpperCase() };
      }

      const existing = await this.getClientById(id);
      if (!existing) {
        throw new Error('Cliente não encontrado');
      }

      if (updates.cpf_cnpj && updates.cpf_cnpj !== existing.cpf_cnpj) {
        const duplicate = await this.getClientByCpfCnpj(updates.cpf_cnpj);
        if (duplicate && duplicate.id !== id) {
          throw new Error('Já existe outro cliente cadastrado com este CPF/CNPJ');
        }
      }

      // Pré-cadastro que ganhou CPF/CNPJ deixou de ser pré-cadastro: alguém
      // sentou e preencheu a ficha. Promover aqui evita o registro completo que
      // continua escondido da lista de clientes sem ninguém entender por quê.
      const promovendo = !!existing.is_pre_cadastro
        && !!updates.cpf_cnpj
        && updates.is_pre_cadastro === undefined;
      const payload = promovendo ? { ...updates, is_pre_cadastro: false } : updates;

      const { data, error } = await supabase
        .from(this.tableName)
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Erro ao atualizar cliente:', error);
        throw new Error(`Erro ao atualizar cliente: ${error.message}`);
      }

      // Guarda o valor anterior de cada campo tocado. A ficha do cliente mostra
      // essa trilha, então nenhum dado sobrescrito se perde.
      await clientChangeHistoryService.record(
        id,
        source,
        clientChangeHistoryService.diff(existing as any, data as any, Object.keys(payload)),
      );

      this.invalidateCache();
      localStorage.removeItem('crm-dashboard-cache');
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', client: data });
      syncBus.emit('clients');

      return data;
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      throw error;
    }
  }

  /**
   * Promove um pré-cadastro a cliente de verdade.
   *
   * É só apagar a marca — o registro é o MESMO, então compromissos, prazos,
   * documentos pedidos e links de assinatura que já estavam pendurados nele
   * continuam exatamente onde estavam. Nada é copiado, nada é movido.
   */
  async promoteFromPreCadastro(id: string): Promise<Client> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ is_pre_cadastro: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Erro ao promover pré-cadastro: ${error.message}`);
    }

    await clientChangeHistoryService.record(id, 'edicao', [{
      field: 'is_pre_cadastro',
      oldValue: true,
      newValue: false,
      sourceLabel: 'Pré-cadastro promovido a cliente',
    }]);

    this.invalidateCache();
    localStorage.removeItem('crm-dashboard-cache');
    events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', client: data });
    syncBus.emit('clients');

    return data as Client;
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

      this.invalidateCache();
      localStorage.removeItem('crm-dashboard-cache');
      events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'delete', id });
      syncBus.emit('clients');
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
      throw error;
    }
  }

  /**
   * Conta o total de clientes com filtros opcionais.
   * Mantido para compatibilidade — prefira derivar contagens do listClients() em cache.
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
   */
  async setClientPhoto(id: string, photoPath: string | null): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      throw new Error(`Erro ao salvar foto do perfil: ${error.message}`);
    }

    this.invalidateCache();
    localStorage.removeItem('crm-dashboard-cache');
    this.clearClientPhotoCache(id);
    events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', id });
  }

  private clearClientPhotoCache(id: string): void {
    try {
      const KEY = 'jurius.clientPhotoCache.v1';
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const cache = JSON.parse(raw);
      if (cache && typeof cache === 'object' && id in cache) {
        delete cache[id];
        localStorage.setItem(KEY, JSON.stringify(cache));
      }
    } catch {
      /* ignora */
    }
  }

  async excludeClientPhoto(id: string, photoPath: string): Promise<string[]> {
    const { data, error: fetchErr } = await supabase
      .from(this.tableName)
      .select('excluded_photo_paths, photo_path')
      .eq('id', id)
      .single();
    if (fetchErr) {
      throw new Error(`Erro ao carregar fotos excluídas: ${fetchErr.message}`);
    }
    const current: string[] = Array.isArray((data as any)?.excluded_photo_paths)
      ? (data as any).excluded_photo_paths
      : [];
    const nextExcluded = current.includes(photoPath) ? current : [...current, photoPath];
    const update: Record<string, any> = {
      excluded_photo_paths: nextExcluded,
      updated_at: new Date().toISOString(),
    };
    if ((data as any)?.photo_path === photoPath) {
      update.photo_path = null;
    }
    const { error } = await supabase.from(this.tableName).update(update).eq('id', id);
    if (error) {
      throw new Error(`Erro ao excluir foto: ${error.message}`);
    }
    this.invalidateCache();
    localStorage.removeItem('crm-dashboard-cache');
    this.clearClientPhotoCache(id);
    events.emit(SYSTEM_EVENTS.CLIENTS_CHANGED, { action: 'update', id });
    return nextExcluded;
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
        .neq('status', 'inativo')
        // Busca rápida do topo do sistema: quem digita aqui procura cliente.
        // Pré-cadastro aparece no atendimento e na aba própria do módulo.
        .eq('is_pre_cadastro', false)
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
