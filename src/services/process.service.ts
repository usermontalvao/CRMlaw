import { supabase } from '../config/supabase';
import { syncBus } from '../lib/syncBus';
import type {
  Process,
  CreateProcessDTO,
  UpdateProcessDTO,
  ProcessFilters,
  ProcessStatus,
} from '../types/process.types';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface ProcessCache {
  data: Process[];
  timestamp: number;
  filters?: string;
}

/** Uma movimentação processual local (espelho do DataJud). */
export interface ProcessMovement {
  id: string;
  nome: string;
  data_hora: string;
  orgao_julgador: string | null;
}

class ProcessService {
  private tableName = 'processes';
  private cache: ProcessCache | null = null;
  private listSelectFields = 'id, client_id, process_code, status, distributed_at, practice_area, priority, requirement_id, requirement_role, court, responsible_lawyer, responsible_lawyer_id, hearing_scheduled, hearing_date, hearing_time, hearing_mode, djen_synced, djen_last_sync, djen_has_data, execution_pending, execution_merit, execution_pending_source, execution_flagged_at, execution_resolved_at, execution_resolved_by, created_at, updated_at';

  // Invalidate cache
  invalidateCache(): void {
    this.cache = null;
  }

  // Check if cache is valid
  private isCacheValid(filters?: ProcessFilters): boolean {
    if (!this.cache) return false;
    
    const now = Date.now();
    const isExpired = now - this.cache.timestamp > CACHE_DURATION;
    const filtersKey = filters ? JSON.stringify(filters) : '';
    const sameFilters = this.cache.filters === filtersKey;
    
    return !isExpired && sameFilters;
  }

  async listProcesses(filters?: ProcessFilters): Promise<Process[]> {
    // Check cache first (only for no filters or empty filters)
    const filtersKey = filters ? JSON.stringify(filters) : '';
    if (this.isCacheValid(filters)) {
      return this.cache!.data;
    }
    let query = supabase
      .from(this.tableName)
      .select(this.listSelectFields)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }

    if (filters?.practice_area) {
      query = query.eq('practice_area', filters.practice_area);
    }

    if (filters?.requirement_id) {
      query = query.eq('requirement_id', filters.requirement_id);
    }

    if (filters?.requirement_role) {
      query = query.eq('requirement_role', filters.requirement_role);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar processos:', error);
      throw new Error(error.message);
    }

    const rows = ((data ?? []) as unknown) as Process[];
    const result = filters?.search
      ? rows.filter((item) => matchesNormalizedSearch(filters.search || '', [item.process_code, item.court, item.responsible_lawyer]))
      : rows;

    // Save to cache
    this.cache = {
      data: result,
      timestamp: Date.now(),
      filters: filtersKey,
    };

    return result;
  }

  /**
   * Movimentações processuais (DataJud) já sincronizadas localmente em
   * datajud_movimentos. Mais recentes primeiro. Leitura, não chama a API remota.
   */
  async listProcessMovements(processId: string, limit = 40): Promise<ProcessMovement[]> {
    const { data, error } = await supabase
      .from('datajud_movimentos')
      .select('id, nome, data_hora, orgao_julgador')
      .eq('process_id', processId)
      .order('data_hora', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as ProcessMovement[];
  }

  /**
   * Movimentações de vários processos em UMA query (evita N+1 quando a UI
   * mostra a mini timeline de cada processo do cliente). Agrupa por
   * process_id, já ordenado do mais recente ao antigo e limitado por processo.
   */
  async listProcessMovementsBatch(processIds: string[], perProcessLimit = 40): Promise<Record<string, ProcessMovement[]>> {
    const ids = Array.from(new Set(processIds.filter(Boolean)));
    if (ids.length === 0) return {};
    const { data, error } = await supabase
      .from('datajud_movimentos')
      .select('id, process_id, nome, data_hora, orgao_julgador')
      .in('process_id', ids)
      .order('data_hora', { ascending: false });
    if (error) throw new Error(error.message);
    const byProc: Record<string, ProcessMovement[]> = {};
    for (const id of ids) byProc[id] = [];
    for (const row of (data || []) as Array<ProcessMovement & { process_id: string }>) {
      const bucket = byProc[row.process_id];
      if (bucket && bucket.length < perProcessLimit) bucket.push(row);
    }
    return byProc;
  }

  async getProcessById(id: string): Promise<Process | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar processo:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createProcess(payload: CreateProcessDTO): Promise<Process> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        status: payload.status ?? 'nao_protocolado',
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar processo:', error);
      throw new Error(error.message);
    }

    // Invalidate cache on create
    this.invalidateCache();
    syncBus.emit('processes');
    return data;
  }

  async updateProcess(id: string, payload: UpdateProcessDTO): Promise<Process> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar processo:', error);
      throw new Error(error.message);
    }

    // Invalidate cache on update
    this.invalidateCache();
    syncBus.emit('processes');
    return data;
  }

  async updateStatus(id: string, status: ProcessStatus): Promise<Process> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status do processo:', error);
      throw new Error(error.message);
    }

    // Invalidate cache on status update
    this.invalidateCache();
    syncBus.emit('processes');
    return data;
  }

  /**
   * Marca a pendência de execução como resolvida (o advogado avaliou / entrou
   * com o cumprimento de sentença, ou decidiu que não é o caso). Some do banner.
   */
  async resolveExecutionPending(id: string, resolvedByUserId?: string | null): Promise<Process> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        execution_pending: false,
        execution_resolved_at: new Date().toISOString(),
        execution_resolved_by: resolvedByUserId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao resolver pendência de execução:', error);
      throw new Error(error.message);
    }

    this.invalidateCache();
    syncBus.emit('processes');
    return data;
  }

  async deleteProcess(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar processo:', error);
      throw new Error(error.message);
    }

    // Invalidate cache on delete
    this.invalidateCache();
    syncBus.emit('processes');
  }
}

export const processService = new ProcessService();
