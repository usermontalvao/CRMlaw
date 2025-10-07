import { supabase } from '../config/supabase';

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  role: string;
  email: string;
  phone?: string | null;
  oab?: string | null;
  lawyer_full_name?: string | null; // Nome completo para pesquisa no DJEN
  bio?: string | null;
  avatar_url?: string | null;
  updated_at: string;
  created_at: string;
}

export interface UpdateProfileInput {
  name: string;
  email: string;
  role: string;
  phone?: string | null;
  oab?: string | null;
  lawyer_full_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
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
    const { data, error } = await supabase
      .from(this.tableName)
      .upsert(
        {
          user_id: userId,
          ...payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
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
}

export const profileService = new ProfileService();
