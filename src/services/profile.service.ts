import { supabase } from '../config/supabase';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';

export type PresenceStatus = 'online' | 'away' | 'offline';
export type ThemePreference = 'light' | 'dark' | 'system';
export type PetitionEditorThemePreference = 'light' | 'dark';
export type SidebarMode = 'compact' | 'normal';

export type ProfileBadge = 'advogado' | 'administrador' | 'estagiario' | 'secretario' | null;
export interface PetitionRibbonCustomStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlignment: '' | 'Left' | 'Center' | 'Right' | 'Justify';
  leftIndent: number;
  rightIndent: number;
  firstLineIndent: number;
  beforeSpacing: number;
  afterSpacing: number;
  lineSpacing: number;
  lineSpacingType: string;
  tabStops: Array<{
    position: number;
    deletePosition: number;
    tabJustification: string;
    tabLeader: string;
  }>;
  listMode: 'none' | 'bullet' | 'number';
  listText: string;
  numberFormat: string;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  role: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  oab?: string | null;
  lawyer_full_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
  badge?: ProfileBadge;
  location?: string | null;
  joined_at?: string | null;
  presence_status?: PresenceStatus;
  theme_preference?: ThemePreference;
  petition_editor_theme_preference?: PetitionEditorThemePreference | null;
  sidebar_mode?: SidebarMode;
  petition_ribbon_custom_styles?: PetitionRibbonCustomStyle[] | null;
  last_seen_at?: string | null;
  updated_at: string;
  created_at: string;
}

export interface UpdateProfileInput {
  name: string;
  email: string;
  role: string;
  cpf?: string | null;
  phone?: string | null;
  oab?: string | null;
  lawyer_full_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  theme_preference?: ThemePreference;
  petition_editor_theme_preference?: PetitionEditorThemePreference | null;
}

class ProfileService {
  private tableName = 'profiles';
  private ribbonStylesColumn = 'petition_ribbon_custom_styles';
  private petitionEditorThemeColumn = 'petition_editor_theme_preference';
  private petitionEditorThemeUnavailable = false;

  private isMissingRibbonStylesColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (
      msg.includes(this.ribbonStylesColumn) ||
      details.includes(this.ribbonStylesColumn) ||
      (String(error?.code || '').toUpperCase() === 'PGRST204' && (msg.includes('column') || details.includes('column')))
    );
  }

  private isMissingPetitionEditorThemeColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return (
      msg.includes(this.petitionEditorThemeColumn) ||
      details.includes(this.petitionEditorThemeColumn) ||
      (String(error?.code || '').toUpperCase() === 'PGRST204' && (msg.includes('column') || details.includes('column')))
    );
  }

  private async requireUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);
    const userId = data.user?.id;
    if (!userId) throw new Error('Usuário não autenticado');
    return userId;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async upsertProfile(userId: string, payload: UpdateProfileInput): Promise<Profile> {
    const attempt = async (attemptPayload: UpdateProfileInput) => {
      const { data, error } = await supabase
        .from(this.tableName)
        .upsert(
          {
            user_id: userId,
            ...attemptPayload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    };

    try {
      return await attempt(payload);
    } catch (err: any) {
      const message = String(err?.message || err || '');
      const shouldRetryWithoutCpf =
        message.includes("Could not find the 'cpf' column") ||
        message.includes('Could not find the \"cpf\" column') ||
        message.includes('cpf') && message.includes('schema cache');

      if (!shouldRetryWithoutCpf || payload.cpf === undefined) {
        throw err;
      }

      const { cpf: _cpf, ...payloadWithoutCpf } = payload as any;
      return await attempt(payloadWithoutCpf);
    }
  }

  async listMembers(): Promise<Profile[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    const roleOrder = (r: string) => { const rl = r.toLowerCase(); return rl.includes('admin') ? 0 : rl.includes('advog') ? 1 : 2; };
    return (data ?? []).sort((a, b) => roleOrder(a.role ?? '') - roleOrder(b.role ?? ''));
  }

  async searchMembers(query: string): Promise<Profile[]> {
    if (!query || query.length < 2) return [];

    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .or(`name.ilike.%${query}%,email.ilike.%${query}%`)
      .order('name', { ascending: true })
      .limit(10);

    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const normalizedSearch = normalizeSearchText(query);
    return rows.filter((member) => matchesNormalizedSearch(normalizedSearch, [member.name, member.email]));
  }

  async getMyProfile(): Promise<Profile | null> {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('Usuário não autenticado');
    }

    return this.getProfile(user.id);
  }

  async updateThemePreference(userId: string, theme: ThemePreference): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ theme_preference: theme, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }

  async updateSidebarMode(userId: string, mode: SidebarMode): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ sidebar_mode: mode, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }

  async getMyPetitionEditorThemePreference(): Promise<PetitionEditorThemePreference | null> {
    if (this.petitionEditorThemeUnavailable) return null;

    const userId = await this.requireUserId();
    const { data, error } = await supabase
      .from(this.tableName)
      .select(this.petitionEditorThemeColumn)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (this.isMissingPetitionEditorThemeColumn(error)) {
        this.petitionEditorThemeUnavailable = true;
        return null;
      }

      const message = String(error.message || '').toLowerCase();
      const details = String((error as any)?.details || '').toLowerCase();
      if (message.includes('bad request') || details.includes(this.petitionEditorThemeColumn)) {
        this.petitionEditorThemeUnavailable = true;
        return null;
      }

      throw new Error(error.message);
    }

    const value = (data as any)?.[this.petitionEditorThemeColumn];
    return value === 'dark' || value === 'light' ? (value as PetitionEditorThemePreference) : null;
  }

  async updateMyPetitionEditorThemePreference(theme: PetitionEditorThemePreference): Promise<boolean> {
    if (this.petitionEditorThemeUnavailable) return false;

    const userId = await this.requireUserId();
    const { error } = await supabase
      .from(this.tableName)
      .update({
        [this.petitionEditorThemeColumn]: theme,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      if (this.isMissingPetitionEditorThemeColumn(error)) {
        this.petitionEditorThemeUnavailable = true;
        return false;
      }

      const message = String(error.message || '').toLowerCase();
      const details = String((error as any)?.details || '').toLowerCase();
      if (message.includes('bad request') || details.includes(this.petitionEditorThemeColumn)) {
        this.petitionEditorThemeUnavailable = true;
        return false;
      }

      throw new Error(error.message);
    }

    return true;
  }

  async getMyPetitionRibbonCustomStyles(): Promise<PetitionRibbonCustomStyle[] | null> {
    const userId = await this.requireUserId();
    const { data, error } = await supabase
      .from(this.tableName)
      .select(this.ribbonStylesColumn)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (this.isMissingRibbonStylesColumn(error)) return null;
      throw new Error(error.message);
    }

    const styles = (data as any)?.[this.ribbonStylesColumn];
    return Array.isArray(styles) ? (styles as PetitionRibbonCustomStyle[]) : null;
  }

  async updateMyPetitionRibbonCustomStyles(styles: PetitionRibbonCustomStyle[]): Promise<boolean> {
    const userId = await this.requireUserId();
    const { error } = await supabase
      .from(this.tableName)
      .update({
        [this.ribbonStylesColumn]: styles,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      if (this.isMissingRibbonStylesColumn(error)) return false;
      throw new Error(error.message);
    }

    return true;
  }

  async setPresenceStatus(userId: string, status: PresenceStatus): Promise<void> {
    const { error } = await supabase.rpc(`set_user_${status}`, { p_user_id: userId });
    if (error) throw new Error(error.message);
  }

  async setOnline(userId: string): Promise<void> {
    await this.setPresenceStatus(userId, 'online');
  }

  async setAway(userId: string): Promise<void> {
    await this.setPresenceStatus(userId, 'away');
  }

  async setOffline(userId: string): Promise<void> {
    await this.setPresenceStatus(userId, 'offline');
  }

  getPresenceLabel(status?: PresenceStatus): string {
    switch (status) {
      case 'online':
        return 'Online agora';
      case 'away':
        return 'Ausente';
      case 'offline':
        return 'Offline';
      default:
        return 'Offline';
    }
  }

  getPresenceColor(status?: PresenceStatus): string {
    switch (status) {
      case 'online':
        return 'bg-emerald-400';
      case 'away':
        return 'bg-yellow-400';
      case 'offline':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  }

  getPresenceTextColor(status?: PresenceStatus): string {
    switch (status) {
      case 'online':
        return 'text-emerald-400';
      case 'away':
        return 'text-yellow-400';
      case 'offline':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  }
}

export const profileService = new ProfileService();
