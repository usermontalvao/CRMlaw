import { supabase } from '../config/supabase';
import { syncBus } from '../lib/syncBus';
import type {
  Deadline,
  CreateDeadlineDTO,
  UpdateDeadlineDTO,
  DeadlineFilters,
  DeadlineStatus,
} from '../types/deadline.types';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';

// ─── Cache ────────────────────────────────────────────────────────────────────
// Cache em memória por chave de filtros server-side (eq + date ranges).
// O filtro client-side (search) é aplicado sobre os dados em cache.
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

interface DeadlineCacheEntry {
  data: Deadline[];
  timestamp: number;
}
// ─────────────────────────────────────────────────────────────────────────────

class DeadlineService {
  private tableName = 'deadlines';

  private _cache = new Map<string, DeadlineCacheEntry>();

  private getCacheKey(serverFilters: Record<string, unknown>): string {
    return JSON.stringify(serverFilters);
  }

  private isCacheValid(key: string): boolean {
    const entry = this._cache.get(key);
    return !!entry && Date.now() - entry.timestamp < CACHE_DURATION;
  }

  /** Invalida todo o cache. Chamado em qualquer mutação. */
  invalidateCache(): void {
    this._cache.clear();
  }

  /**
   * Lista prazos com filtros opcionais.
   *
   * Todos os filtros de eq/range determinam a chave de cache.
   * O filtro `search` é aplicado client-side sobre os dados em cache.
   */
  async listDeadlines(filters?: DeadlineFilters): Promise<Deadline[]> {
    // Separar search (client-side) dos demais filtros (server-side)
    const { search, ...serverFilters } = filters ?? {};
    const cacheKey = this.getCacheKey(serverFilters);

    let rows: Deadline[];

    if (this.isCacheValid(cacheKey)) {
      rows = this._cache.get(cacheKey)!.data;
    } else {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .order('due_date', { ascending: true });

      if (serverFilters.status) {
        query = query.eq('status', serverFilters.status as string);
      }

      if (serverFilters.priority) {
        query = query.eq('priority', serverFilters.priority as string);
      }

      if (serverFilters.type) {
        query = query.eq('type', serverFilters.type as string);
      }

      if (serverFilters.process_id) {
        query = query.eq('process_id', serverFilters.process_id as string);
      }

      if (serverFilters.requirement_id) {
        query = query.eq('requirement_id', serverFilters.requirement_id as string);
      }

      if (serverFilters.client_id) {
        query = query.eq('client_id', serverFilters.client_id as string);
      }

      if (serverFilters.responsible_id) {
        query = query.eq('responsible_id', serverFilters.responsible_id as string);
      }

      if (serverFilters.due_date_from) {
        query = query.gte('due_date', serverFilters.due_date_from as string);
      }

      if (serverFilters.due_date_to) {
        query = query.lte('due_date', serverFilters.due_date_to as string);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Erro ao listar prazos:', error);
        throw new Error(error.message);
      }

      rows = (data ?? []) as Deadline[];
      this._cache.set(cacheKey, { data: rows, timestamp: Date.now() });
    }

    // ── Filtro client-side ────────────────────────────────────────────────────
    if (search) {
      const normalizedSearch = normalizeSearchText(search);
      if (normalizedSearch) {
        return rows.filter((item) =>
          matchesNormalizedSearch(normalizedSearch, [item.title, item.description])
        );
      }
    }

    return rows;
  }

  async getDeadlineById(id: string): Promise<Deadline | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar prazo:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createDeadline(payload: CreateDeadlineDTO): Promise<Deadline> {
    if (!payload.responsible_id?.trim()) {
      throw new Error('Selecione o responsável pelo prazo.');
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        status: payload.status ?? 'pendente',
        priority: payload.priority ?? 'media',
        client_id: payload.client_id ?? null,
        responsible_id: payload.responsible_id,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async updateDeadline(id: string, payload: UpdateDeadlineDTO): Promise<Deadline> {
    if (Object.prototype.hasOwnProperty.call(payload, 'responsible_id') && !payload.responsible_id?.trim()) {
      throw new Error('Selecione o responsável pelo prazo.');
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...payload,
        client_id: payload.client_id ?? null,
        responsible_id: payload.responsible_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async updateStatus(id: string, status: DeadlineStatus): Promise<Deadline> {
    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'cumprido') {
      updatePayload.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status do prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
    return data;
  }

  async deleteDeadline(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar prazo:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('deadlines');
  }

  async getUpcomingDeadlines(daysAhead: number = 7): Promise<Deadline[]> {
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + daysAhead);

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('status', 'pendente')
      .gte('due_date', today.toISOString())
      .lte('due_date', futureDate.toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar prazos próximos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  async getOverdueDeadlines(): Promise<Deadline[]> {
    const today = new Date().toISOString();

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('status', 'pendente')
      .lt('due_date', today)
      .order('due_date', { ascending: true });

    if (error) {
      console.error('Erro ao buscar prazos vencidos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }
}

export const deadlineService = new DeadlineService();
