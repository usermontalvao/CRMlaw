import { supabase } from '../config/supabase';
import { settingsService } from './settings.service';
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

/**
 * Colunas usadas nas listagens de membros. Deixa de fora as preferências
 * pessoais (tema, barra lateral e os estilos do editor de petições, que são um
 * jsonb que pode crescer bastante) — nenhuma tela precisa da preferência dos
 * outros, e essas listagens são das leituras mais frequentes do sistema.
 */
/** Migrações de avatar em voo, para que chamadas simultâneas não subam duas vezes. */
const inlineAvatarMigrations = new Map<string, Promise<string>>();

const MEMBER_COLUMNS =
  'id,user_id,name,role,email,phone,oab,bio,avatar_url,cover_url,badge,location,gender,cpf,lawyer_full_name,presence_status,last_seen_at,is_active,joined_at,created_at,updated_at' as const;

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
      .select(MEMBER_COLUMNS)
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
      .select(MEMBER_COLUMNS)
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

  /**
   * Envia a foto de perfil para o bucket `perfil` e devolve a URL pública.
   *
   * O avatar nunca deve ser gravado como base64 na coluna: `profiles` é lida
   * em toda listagem de membros e é publicada no Realtime — uma foto embutida
   * viaja junto em cada leitura.
   */
  async uploadAvatar(userId: string, file: File): Promise<string> {
    const extFromName = file.name?.split('.').pop()?.toLowerCase();
    const extFromType = file.type?.split('/').pop()?.toLowerCase();
    const ext = (extFromName && extFromName.length <= 5 ? extFromName : extFromType) || 'jpg';
    const filePath = `avatars/avatar_${userId}_${Date.now()}.${ext}`;
    return settingsService.uploadToProfileBucket(filePath, file);
  }

  /**
   * Converte um avatar que ficou gravado como data URL em arquivo no Storage.
   *
   * Roda uma vez por usuário afetado, com a sessão do próprio usuário (logo
   * passa pelo RLS). Devolve a nova URL, ou null se não havia nada a migrar.
   *
   * O carregamento do perfil pode disparar mais de uma vez em paralelo (efeito
   * remontado, StrictMode), e as duas execuções enxergariam o mesmo base64
   * antes de qualquer uma gravar — o que subiria o mesmo arquivo duas vezes.
   * Por isso as chamadas simultâneas do mesmo usuário compartilham uma única
   * migração.
   */
  async migrateInlineAvatarToStorage(userId: string, avatarUrl?: string | null): Promise<string | null> {
    if (!avatarUrl || !avatarUrl.startsWith('data:')) return null;

    const emAndamento = inlineAvatarMigrations.get(userId);
    if (emAndamento) return emAndamento;

    const migracao = (async () => {
      const response = await fetch(avatarUrl);
      const blob = await response.blob();
      const mime = blob.type || 'image/jpeg';
      const ext = mime.split('/').pop()?.toLowerCase() || 'jpg';
      const file = new File([blob], `avatar_${userId}.${ext}`, { type: mime });

      const publicUrl = await this.uploadAvatar(userId, file);

      const { error } = await supabase
        .from(this.tableName)
        .update({ avatar_url: publicUrl })
        .eq('user_id', userId);

      if (error) throw new Error(error.message);
      return publicUrl;
    })();

    inlineAvatarMigrations.set(userId, migracao);
    try {
      return await migracao;
    } finally {
      inlineAvatarMigrations.delete(userId);
    }
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
