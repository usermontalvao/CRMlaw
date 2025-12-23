import { supabase } from '../config/supabase';
import type {
  Process,
  CreateProcessDTO,
  UpdateProcessDTO,
  ProcessFilters,
  ProcessStatus,
} from '../types/process.types';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface ProcessCache {
  data: Process[];
  timestamp: number;
  filters?: string;
}

class ProcessService {
  private tableName = 'processes';
  private cache: ProcessCache | null = null;

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
      .select('*')
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

    if (filters?.search) {
      const term = filters.search.trim();
      if (term) {
        query = query.or(
          `process_code.ilike.%${term}%,court.ilike.%${term}%,responsible_lawyer.ilike.%${term}%,notes.ilike.%${term}%`
        );
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar processos:', error);
      throw new Error(error.message);
    }

    const result = data ?? [];

    // Save to cache
    this.cache = {
      data: result,
      timestamp: Date.now(),
      filters: filtersKey,
    };

    return result;
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
  }
}

export const processService = new ProcessService();
