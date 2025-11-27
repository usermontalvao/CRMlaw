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
      throw new Error(error.message);
    }

    return (data ?? []) as DjenSyncLog[];
  }
}

export const djenSyncStatusService = new DjenSyncStatusService();
