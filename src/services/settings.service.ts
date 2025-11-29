/**
 * Serviço de Configurações do Sistema
 * Gerencia todas as configurações, permissões e auditoria
 */

import { supabase } from '../config/supabase';

// Tipos
export interface OfficeIdentity {
  name: string;
  email: string;
  phone: string;
  address: string;
  cnpj: string;
  oab_number: string;
  logo_url: string;
}

export interface DjenConfig {
  auto_sync: boolean;
  sync_interval_hours: number;
  default_tribunal: string;
  search_days_back: number;
  api_timeout_seconds: number;
  max_retries: number;
  lawyers_to_monitor: string[];
}

export interface NotificationConfig {
  email_enabled: boolean;
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  deadline_reminder_days: number[];
  new_intimation_alert: boolean;
  daily_digest: boolean;
  digest_time: string;
}

export interface Preferences {
  timezone: string;
  date_format: string;
  currency: string;
  default_deadline_days: number;
  business_hours_start: string;
  business_hours_end: string;
  work_days: number[];
}

export interface SecurityConfig {
  session_timeout_hours: number;
  require_2fa: boolean;
  password_min_length: number;
  max_login_attempts: number;
  audit_log_enabled: boolean;
}

export interface ModulesConfig {
  leads_enabled: boolean;
  financial_enabled: boolean;
  requirements_enabled: boolean;
  documents_enabled: boolean;
  calendar_enabled: boolean;
  tasks_enabled: boolean;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: any;
  description: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role: string;
  module: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: any;
  new_value: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

class SettingsService {
  // ==================== CONFIGURAÇÕES DO SISTEMA ====================

  /**
   * Busca todas as configurações
   */
  async getAllSettings(): Promise<SystemSetting[]> {
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .order('category');

    if (error) {
      console.error('Erro ao buscar configurações:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Busca uma configuração específica por chave
   */
  async getSetting<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('Erro ao buscar configuração:', error);
      throw new Error(error.message);
    }

    return data?.value as T;
  }

  /**
   * Atualiza uma configuração
   */
  async updateSetting<T>(key: string, value: T, userName?: string): Promise<void> {
    // Buscar valor antigo para auditoria
    const oldValue = await this.getSetting(key);

    const { error } = await supabase
      .from('system_settings')
      .update({ 
        value, 
        updated_at: new Date().toISOString() 
      })
      .eq('key', key);

    if (error) {
      console.error('Erro ao atualizar configuração:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update',
      entity_type: 'system_settings',
      entity_id: key,
      old_value: oldValue,
      new_value: value,
      user_name: userName,
    });
  }

  /**
   * Busca configurações de identidade do escritório
   */
  async getOfficeIdentity(): Promise<OfficeIdentity> {
    const value = await this.getSetting<OfficeIdentity>('office_identity');
    return value || {
      name: '',
      email: '',
      phone: '',
      address: '',
      cnpj: '',
      oab_number: '',
      logo_url: '',
    };
  }

  /**
   * Atualiza configurações de identidade
   */
  async updateOfficeIdentity(identity: OfficeIdentity, userName?: string): Promise<void> {
    await this.updateSetting('office_identity', identity, userName);
  }

  /**
   * Busca configurações do DJEN
   */
  async getDjenConfig(): Promise<DjenConfig> {
    const value = await this.getSetting<DjenConfig>('djen_config');
    return value || {
      auto_sync: true,
      sync_interval_hours: 24,
      default_tribunal: 'all',
      search_days_back: 30,
      api_timeout_seconds: 30,
      max_retries: 3,
      lawyers_to_monitor: [],
    };
  }

  /**
   * Atualiza configurações do DJEN
   */
  async updateDjenConfig(config: DjenConfig, userName?: string): Promise<void> {
    await this.updateSetting('djen_config', config, userName);
  }

  /**
   * Busca configurações de notificações
   */
  async getNotificationConfig(): Promise<NotificationConfig> {
    const value = await this.getSetting<NotificationConfig>('notification_config');
    return value || {
      email_enabled: true,
      push_enabled: true,
      whatsapp_enabled: false,
      deadline_reminder_days: [1, 3, 7],
      new_intimation_alert: true,
      daily_digest: false,
      digest_time: '08:00',
    };
  }

  /**
   * Atualiza configurações de notificações
   */
  async updateNotificationConfig(config: NotificationConfig, userName?: string): Promise<void> {
    await this.updateSetting('notification_config', config, userName);
  }

  /**
   * Busca preferências operacionais
   */
  async getPreferences(): Promise<Preferences> {
    const value = await this.getSetting<Preferences>('preferences');
    return value || {
      timezone: 'America/Sao_Paulo',
      date_format: 'DD/MM/YYYY',
      currency: 'BRL',
      default_deadline_days: 15,
      business_hours_start: '08:00',
      business_hours_end: '18:00',
      work_days: [1, 2, 3, 4, 5],
    };
  }

  /**
   * Atualiza preferências operacionais
   */
  async updatePreferences(prefs: Preferences, userName?: string): Promise<void> {
    await this.updateSetting('preferences', prefs, userName);
  }

  /**
   * Busca configurações de segurança
   */
  async getSecurityConfig(): Promise<SecurityConfig> {
    const value = await this.getSetting<SecurityConfig>('security_config');
    return value || {
      session_timeout_hours: 6,
      require_2fa: false,
      password_min_length: 8,
      max_login_attempts: 5,
      audit_log_enabled: true,
    };
  }

  /**
   * Atualiza configurações de segurança
   */
  async updateSecurityConfig(config: SecurityConfig, userName?: string): Promise<void> {
    await this.updateSetting('security_config', config, userName);
  }

  /**
   * Busca configurações de módulos
   */
  async getModulesConfig(): Promise<ModulesConfig> {
    const value = await this.getSetting<ModulesConfig>('modules_config');
    return value || {
      leads_enabled: true,
      financial_enabled: true,
      requirements_enabled: true,
      documents_enabled: true,
      calendar_enabled: true,
      tasks_enabled: true,
    };
  }

  /**
   * Atualiza configurações de módulos
   */
  async updateModulesConfig(config: ModulesConfig, userName?: string): Promise<void> {
    await this.updateSetting('modules_config', config, userName);
  }

  // ==================== PERMISSÕES ====================

  /**
   * Busca todas as permissões
   */
  async getAllPermissions(): Promise<RolePermission[]> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .order('role')
      .order('module');

    if (error) {
      console.error('Erro ao buscar permissões:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Busca permissões de um papel específico
   */
  async getPermissionsByRole(role: string): Promise<RolePermission[]> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .order('module');

    if (error) {
      console.error('Erro ao buscar permissões do papel:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Atualiza uma permissão específica
   */
  async updatePermission(
    role: string, 
    module: string, 
    permissions: { can_view?: boolean; can_create?: boolean; can_edit?: boolean; can_delete?: boolean },
    userName?: string
  ): Promise<void> {
    // Buscar permissão atual
    const { data: current } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .eq('module', module)
      .single();

    const { error } = await supabase
      .from('role_permissions')
      .upsert({
        role: role.toLowerCase(),
        module,
        can_view: permissions.can_view ?? current?.can_view ?? true,
        can_create: permissions.can_create ?? current?.can_create ?? false,
        can_edit: permissions.can_edit ?? current?.can_edit ?? false,
        can_delete: permissions.can_delete ?? current?.can_delete ?? false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'role,module' });

    if (error) {
      console.error('Erro ao atualizar permissão:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_permission',
      entity_type: 'role_permissions',
      entity_id: `${role}:${module}`,
      old_value: current,
      new_value: permissions,
      user_name: userName,
    });
  }

  /**
   * Atualiza todas as permissões de um papel
   */
  async updateRolePermissions(
    role: string, 
    permissions: Array<{ module: string; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }>,
    userName?: string
  ): Promise<void> {
    const updates = permissions.map(p => ({
      role: role.toLowerCase(),
      module: p.module,
      can_view: p.can_view,
      can_create: p.can_create,
      can_edit: p.can_edit,
      can_delete: p.can_delete,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('role_permissions')
      .upsert(updates, { onConflict: 'role,module' });

    if (error) {
      console.error('Erro ao atualizar permissões do papel:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_role_permissions',
      entity_type: 'role_permissions',
      entity_id: role,
      new_value: permissions,
      user_name: userName,
    });
  }

  /**
   * Verifica se um papel tem permissão para uma ação em um módulo
   */
  async checkPermission(role: string, module: string, action: 'view' | 'create' | 'edit' | 'delete'): Promise<boolean> {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', role.toLowerCase())
      .eq('module', module)
      .single();

    if (error || !data) return false;

    switch (action) {
      case 'view': return data.can_view;
      case 'create': return data.can_create;
      case 'edit': return data.can_edit;
      case 'delete': return data.can_delete;
      default: return false;
    }
  }

  // ==================== AUDITORIA ====================

  /**
   * Registra uma entrada no log de auditoria
   */
  async logAudit(entry: {
    action: string;
    entity_type: string;
    entity_id?: string;
    old_value?: any;
    new_value?: any;
    user_name?: string;
  }): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      await supabase.from('audit_log').insert({
        user_id: user?.id,
        user_name: entry.user_name || user?.email,
        action: entry.action,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        old_value: entry.old_value,
        new_value: entry.new_value,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    } catch (err) {
      console.error('Erro ao registrar auditoria:', err);
      // Não lançar erro para não interromper a operação principal
    }
  }

  /**
   * Busca log de auditoria com filtros
   */
  async getAuditLog(filters?: {
    entity_type?: string;
    entity_id?: string;
    user_id?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]> {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.entity_type) {
      query = query.eq('entity_type', filters.entity_type);
    }
    if (filters?.entity_id) {
      query = query.eq('entity_id', filters.entity_id);
    }
    if (filters?.user_id) {
      query = query.eq('user_id', filters.user_id);
    }
    if (filters?.action) {
      query = query.eq('action', filters.action);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar log de auditoria:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  // ==================== USUÁRIOS ====================

  /**
   * Lista todos os usuários com seus perfis
   */
  async listUsers(): Promise<any[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Erro ao listar usuários:', error);
      throw new Error(error.message);
    }

    return data || [];
  }

  /**
   * Atualiza o papel de um usuário
   */
  async updateUserRole(userId: string, role: string, userName?: string): Promise<void> {
    // Buscar papel atual
    const { data: current } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', userId)
      .single();

    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao atualizar papel do usuário:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_user_role',
      entity_type: 'profiles',
      entity_id: userId,
      old_value: { role: current?.role },
      new_value: { role },
      user_name: userName,
    });
  }

  /**
   * Atualiza perfil de um usuário
   */
  async updateUserProfile(userId: string, profile: {
    name?: string;
    email?: string;
    phone?: string;
    oab?: string;
    role?: string;
    lawyer_full_name?: string;
    avatar_url?: string;
    bio?: string;
  }, userName?: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ ...profile, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao atualizar perfil:', error);
      throw new Error(error.message);
    }

    // Registrar auditoria
    await this.logAudit({
      action: 'update_user_profile',
      entity_type: 'profiles',
      entity_id: userId,
      new_value: profile,
      user_name: userName,
    });
  }

  /**
   * Remove o perfil de um usuário do CRM (não remove a conta de autenticação)
   */
  async deleteUserProfile(userId: string, userName?: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('Erro ao remover perfil:', error);
      throw new Error(error.message);
    }

    await this.logAudit({
      action: 'delete_user_profile',
      entity_type: 'profiles',
      entity_id: userId,
      user_name: userName,
    });
  }

  /** Bucket público para avatares */
  private avatarBucket = 'profile-avatars';

  private async ensureAvatarBucket() {
    try {
      const { data } = await supabase.storage.getBucket(this.avatarBucket);
      if (data) return;

      await supabase.storage.createBucket(this.avatarBucket, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
      });
    } catch (error) {
      console.warn('Não foi possível validar bucket de avatares:', error);
    }
  }

  /**
   * Upload de avatar para o Storage do Supabase
   */
  async uploadUserAvatar(userId: string, file: File): Promise<string> {
    await this.ensureAvatarBucket();

    const extension = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from(this.avatarBucket)
      .upload(path, file, {
        upsert: true,
        cacheControl: '3600',
        contentType: file.type,
      });

    if (error) {
      console.error('Erro ao enviar avatar:', error);
      throw new Error('Falha ao enviar imagem. Tente novamente.');
    }

    const { data } = supabase.storage.from(this.avatarBucket).getPublicUrl(path);
    return data.publicUrl;
  }
}

export const settingsService = new SettingsService();
