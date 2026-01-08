import { supabase } from '../config/supabase';

export type PresenceStatus = 'online' | 'away' | 'offline';
export type ThemePreference = 'light' | 'dark' | 'system';

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
  presence_status?: PresenceStatus;
  theme_preference?: ThemePreference;
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
}

class ProfileService {
  private tableName = 'profiles';

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
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
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
