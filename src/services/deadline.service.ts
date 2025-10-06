import { supabase } from '../config/supabase';
import type {
  Deadline,
  CreateDeadlineDTO,
  UpdateDeadlineDTO,
  DeadlineFilters,
  DeadlineStatus,
} from '../types/deadline.types';

class DeadlineService {
  private tableName = 'deadlines';

  async listDeadlines(filters?: DeadlineFilters): Promise<Deadline[]> {
    let query = supabase
      .from(this.tableName)
      .select('*')
      .order('due_date', { ascending: true });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.priority) {
      query = query.eq('priority', filters.priority);
    }

    if (filters?.type) {
      query = query.eq('type', filters.type);
    }

    if (filters?.process_id) {
      query = query.eq('process_id', filters.process_id);
    }

    if (filters?.requirement_id) {
      query = query.eq('requirement_id', filters.requirement_id);
    }

    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }

    if (filters?.responsible_id) {
      query = query.eq('responsible_id', filters.responsible_id);
    }

    if (filters?.due_date_from) {
      query = query.gte('due_date', filters.due_date_from);
    }

    if (filters?.due_date_to) {
      query = query.lte('due_date', filters.due_date_to);
    }

    if (filters?.search) {
      const term = filters.search.trim();
      if (term) {
        query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar prazos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
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
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        status: payload.status ?? 'pendente',
        priority: payload.priority ?? 'media',
        client_id: payload.client_id ?? null,
        responsible_id: payload.responsible_id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar prazo:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async updateDeadline(id: string, payload: UpdateDeadlineDTO): Promise<Deadline> {
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
