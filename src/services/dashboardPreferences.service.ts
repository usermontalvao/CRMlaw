import { supabase } from '../config/supabase';

export interface DashboardPreferences {
  id?: string;
  user_id: string;
  left_widgets: string[];
  right_widgets: string[];
  updated_at?: string;
  created_at?: string;
}

class DashboardPreferencesService {
  private tableName = 'dashboard_preferences';

  async getPreferences(userId: string): Promise<DashboardPreferences | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar preferências do dashboard:', error);
      return null;
    }

    return data ?? null;
  }

  async savePreferences(
    userId: string,
    leftWidgets: string[],
    rightWidgets: string[]
  ): Promise<DashboardPreferences | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .upsert(
        {
          user_id: userId,
          left_widgets: leftWidgets,
          right_widgets: rightWidgets,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Erro ao salvar preferências do dashboard:', error);
      return null;
    }

    return data;
  }

  async updateLeftWidgets(userId: string, leftWidgets: string[]): Promise<boolean> {
    const { error } = await supabase
      .from(this.tableName)
      .update({
        left_widgets: leftWidgets,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao atualizar widgets da esquerda:', error);
      return false;
    }

    return true;
  }

  async updateRightWidgets(userId: string, rightWidgets: string[]): Promise<boolean> {
    const { error } = await supabase
      .from(this.tableName)
      .update({
        right_widgets: rightWidgets,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao atualizar widgets da direita:', error);
      return false;
    }

    return true;
  }
}

export const dashboardPreferencesService = new DashboardPreferencesService();
