import { supabase } from '../config/supabase';

export interface DashboardPreferences {
  id?: string;
  user_id: string;
  left_widgets: string[];
  right_widgets: string[];
  /** Layout responsivo do react-grid-layout (lg/md/sm/xs/xxs). NULL = auto-ajustado */
  grid_layout?: Record<string, Array<{ i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }>> | null;
  /** Timestamp até quando os valores financeiros ficam visíveis. NULL = sempre censurado. */
  financial_revealed_until?: string | null;
  updated_at?: string;
  created_at?: string;
}

/** Retorna true se o reveal ainda está ativo (dentro do prazo). */
export function isFinancialRevealed(prefs: Pick<DashboardPreferences, 'financial_revealed_until'> | null): boolean {
  if (!prefs?.financial_revealed_until) return false;
  return new Date(prefs.financial_revealed_until) > new Date();
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

  /**
   * Salva apenas o grid_layout (posições x/y/w/h do react-grid-layout).
   * Faz upsert preservando left_widgets e right_widgets existentes.
   */
  async saveGridLayout(
    userId: string,
    gridLayout: DashboardPreferences['grid_layout']
  ): Promise<boolean> {
    const updated_at = new Date().toISOString();

    // Try UPDATE first to preserve existing left_widgets/right_widgets
    const { data: updated, error: updErr } = await supabase
      .from(this.tableName)
      .update({ grid_layout: gridLayout, updated_at })
      .eq('user_id', userId)
      .select('user_id');

    if (!updErr && updated && updated.length > 0) return true;

    // No existing row — INSERT with empty defaults for required columns
    const { error: insErr } = await supabase
      .from(this.tableName)
      .insert({ user_id: userId, grid_layout: gridLayout, left_widgets: [], right_widgets: [], updated_at });

    if (insErr) {
      console.error('Erro ao salvar grid_layout do dashboard:', insErr);
      return false;
    }
    return true;
  }

  /**
   * Lê apenas o grid_layout do usuário (retorna null se não existir).
   */
  async getGridLayout(
    userId: string
  ): Promise<DashboardPreferences['grid_layout'] | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('grid_layout')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar grid_layout do dashboard:', error);
      return null;
    }

    return (data?.grid_layout as DashboardPreferences['grid_layout']) ?? null;
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

  /**
   * Define até quando os valores financeiros ficam visíveis.
   * Passa null para censurar imediatamente.
   */
  async updateFinancialRevealedUntil(userId: string, until: string | null): Promise<boolean> {
    const updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from(this.tableName)
      .update({ financial_revealed_until: until, updated_at })
      .eq('user_id', userId)
      .select('user_id');

    if (!updErr && updated && updated.length > 0) return true;

    const { error: insErr } = await supabase
      .from(this.tableName)
      .insert({ user_id: userId, financial_revealed_until: until, left_widgets: [], right_widgets: [], updated_at });

    if (insErr) {
      console.error('Erro ao salvar financial_revealed_until:', insErr);
      return false;
    }
    return true;
  }
}

export const dashboardPreferencesService = new DashboardPreferencesService();
