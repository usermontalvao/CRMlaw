import { supabase } from '../config/supabase';

export interface DjenSyncLog {
  id: string;
  source?: string | null;
  origin?: string | null;
  trigger_type?: string | null;
  status?: string | null;
  run_started_at?: string | null;
  run_finished_at?: string | null;
  created_at?: string | null;
  next_run_at?: string | null;
  items_found?: number | null;
  items_saved?: number | null;
  error_message?: string | null;
  message?: string | null;
}

class DjenSyncStatusService {
  private tableName = 'djen_sync_history';

  async listRecent(limit = 5): Promise<DjenSyncLog[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Erro ao buscar histórico de sincronização DJEN:', error);
      return [];
    }

    return (data ?? []) as DjenSyncLog[];
  }

  async logSync(params: {
    source: string;
    origin: string;
    trigger_type: string;
    status: 'running' | 'success' | 'error';
    items_found?: number;
    items_saved?: number;
    error_message?: string;
    message?: string;
  }): Promise<DjenSyncLog | null> {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        source: params.source,
        origin: params.origin,
        trigger_type: params.trigger_type,
        status: params.status,
        run_started_at: now,
        run_finished_at: params.status !== 'running' ? now : null,
        items_found: params.items_found ?? 0,
        items_saved: params.items_saved ?? 0,
        error_message: params.error_message,
        message: params.message,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao registrar sincronização DJEN:', error);
      return null;
    }

    return data as DjenSyncLog;
  }

  async updateSync(id: string, params: {
    status: 'running' | 'success' | 'error';
    items_found?: number;
    items_saved?: number;
    error_message?: string;
    message?: string;
  }): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({
        status: params.status,
        run_finished_at: new Date().toISOString(),
        items_found: params.items_found,
        items_saved: params.items_saved,
        error_message: params.error_message,
        message: params.message,
      })
      .eq('id', id);

    if (error) {
      console.error('Erro ao atualizar sincronização DJEN:', error);
    }
  }
}

export const djenSyncStatusService = new DjenSyncStatusService();
