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
  /** Tamanho do widget de mensagens flutuante. NULL = padrão. */
  chat_widget_prefs?: ChatWidgetPrefs | null;
  /** Larguras das colunas do módulo de e-mail. NULL = padrão. */
  email_layout_prefs?: EmailLayoutPrefs | null;
  updated_at?: string;
  created_at?: string;
}

export interface ChatWidgetPrefs {
  w: number;
  h: number;
}

export interface EmailLayoutPrefs {
  /** Largura da coluna de pastas (px). */
  foldersW: number;
  /** Largura da coluna da lista de mensagens (px). */
  listW: number;
  /** Último rascunho aberto no módulo de e-mail. */
  activeDraftId?: string | null;
  /** Se o composer estava minimizado quando o usuário saiu. */
  composeMinimized?: boolean;
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

  /** Lê o tamanho salvo do widget de mensagens (null se não existir). */
  async getChatWidgetPrefs(userId: string): Promise<ChatWidgetPrefs | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('chat_widget_prefs')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar prefs do widget de mensagens:', error);
      return null;
    }
    return (data?.chat_widget_prefs as ChatWidgetPrefs | null) ?? null;
  }

  /** Salva (ou limpa, com null) o tamanho do widget de mensagens, preservando o resto. */
  async saveChatWidgetPrefs(userId: string, prefs: ChatWidgetPrefs | null): Promise<boolean> {
    const updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from(this.tableName)
      .update({ chat_widget_prefs: prefs, updated_at })
      .eq('user_id', userId)
      .select('user_id');

    if (!updErr && updated && updated.length > 0) return true;

    const { error: insErr } = await supabase
      .from(this.tableName)
      .insert({ user_id: userId, chat_widget_prefs: prefs, left_widgets: [], right_widgets: [], updated_at });

    if (insErr) {
      console.error('Erro ao salvar prefs do widget de mensagens:', insErr);
      return false;
    }
    return true;
  }

  /** Lê as larguras salvas das colunas do módulo de e-mail (null se não existir). */
  async getEmailLayoutPrefs(userId: string): Promise<EmailLayoutPrefs | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('email_layout_prefs')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar layout do módulo de e-mail:', error);
      return null;
    }
    return (data?.email_layout_prefs as EmailLayoutPrefs | null) ?? null;
  }

  /** Salva as larguras das colunas do módulo de e-mail, preservando o resto. */
  async saveEmailLayoutPrefs(userId: string, prefs: EmailLayoutPrefs | null): Promise<boolean> {
    const updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from(this.tableName)
      .update({ email_layout_prefs: prefs, updated_at })
      .eq('user_id', userId)
      .select('user_id');

    if (!updErr && updated && updated.length > 0) return true;

    const { error: insErr } = await supabase
      .from(this.tableName)
      .insert({ user_id: userId, email_layout_prefs: prefs, left_widgets: [], right_widgets: [], updated_at });

    if (insErr) {
      console.error('Erro ao salvar layout do módulo de e-mail:', insErr);
      return false;
    }
    return true;
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
