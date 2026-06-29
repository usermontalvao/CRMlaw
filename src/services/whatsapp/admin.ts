// Camada de administração: canais, departamentos, templates e equipe.
import { supabase } from '../../config/supabase';
import type {
  WhatsAppChannel, WhatsAppDepartment, WhatsAppTemplate, WhatsAppBusinessHoursRow,
  WhatsAppAiChannelConfig, WhatsAppAiPlaybook, AiPlaybookQuestion,
} from '../../types/whatsapp.types';
import {
  CHANNEL_TABLE, DEPT_TABLE, DEPT_MEMBER_TABLE, TEMPLATES_TABLE,
  invokeFn, type StaffOption, type AgentPrefs,
} from './shared';

export const adminApi = {
  // ── Canais ───────────────────────────────────────────────────
  async listChannels(): Promise<WhatsAppChannel[]> {
    const { data, error } = await supabase
      .from(CHANNEL_TABLE)
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppChannel[];
  },

  async createChannel(input: { name: string; instance_name: string; phone_number?: string; color?: string }): Promise<WhatsAppChannel> {
    const { data, error } = await supabase
      .from(CHANNEL_TABLE)
      .insert({
        name: input.name,
        instance_name: input.instance_name,
        phone_number: input.phone_number || null,
        color: input.color || null,
        status: 'disconnected',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppChannel;
  },

  async updateChannel(id: string, patch: Partial<Pick<WhatsAppChannel, 'name' | 'color' | 'phone_number' | 'is_active'>>): Promise<void> {
    const { error } = await supabase.from(CHANNEL_TABLE).update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteChannel(id: string): Promise<void> {
    const { error } = await supabase.from(CHANNEL_TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Conecta um canal (cria/gera QR na Evolution). */
  async connectChannel(channelId: string): Promise<{ status: string; qr?: string; phone?: string }> {
    return invokeFn('evolution-instance', { action: 'connect', channel_id: channelId });
  },

  async channelStatus(channelId: string): Promise<{ status: string; phone?: string }> {
    return invokeFn('evolution-instance', { action: 'status', channel_id: channelId });
  },

  // ── Departamentos ────────────────────────────────────────────
  async listDepartments(): Promise<WhatsAppDepartment[]> {
    const { data, error } = await supabase
      .from(DEPT_TABLE)
      .select('*')
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppDepartment[];
  },

  async createDepartment(input: { name: string; color?: string }): Promise<WhatsAppDepartment> {
    const { data, error } = await supabase
      .from(DEPT_TABLE)
      .insert({ name: input.name, color: input.color || null })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppDepartment;
  },

  async updateDepartment(id: string, patch: Partial<Pick<WhatsAppDepartment, 'name' | 'color' | 'is_active'>>): Promise<void> {
    const { error } = await supabase.from(DEPT_TABLE).update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteDepartment(id: string): Promise<void> {
    const { error } = await supabase.from(DEPT_TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  async listDepartmentMembers(departmentId: string): Promise<string[]> {
    const { data } = await supabase
      .from(DEPT_MEMBER_TABLE)
      .select('user_id')
      .eq('department_id', departmentId);
    return (data || []).map((r: any) => r.user_id);
  },

  async setDepartmentMembers(departmentId: string, userIds: string[]): Promise<void> {
    await supabase.from(DEPT_MEMBER_TABLE).delete().eq('department_id', departmentId);
    if (userIds.length) {
      await supabase.from(DEPT_MEMBER_TABLE).insert(
        userIds.map(uid => ({ department_id: departmentId, user_id: uid })),
      );
    }
  },

  // ── Templates / macros (Fase 8) ──────────────────────────────
  async listTemplates(opts?: { activeOnly?: boolean }): Promise<WhatsAppTemplate[]> {
    let q = supabase.from(TEMPLATES_TABLE).select('*').order('name', { ascending: true });
    if (opts?.activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppTemplate[];
  },

  async createTemplate(input: Pick<WhatsAppTemplate, 'name' | 'body'> & Partial<Pick<WhatsAppTemplate, 'category' | 'scope' | 'channel_id' | 'department_id'>>): Promise<WhatsAppTemplate> {
    const { data, error } = await supabase.from(TEMPLATES_TABLE).insert({
      name: input.name, body: input.body, category: input.category || null,
      scope: input.scope || 'global', channel_id: input.channel_id || null, department_id: input.department_id || null,
    }).select('*').single();
    if (error) throw new Error(error.message);
    return data as WhatsAppTemplate;
  },

  async updateTemplate(id: string, patch: Partial<Pick<WhatsAppTemplate, 'name' | 'body' | 'category' | 'scope' | 'channel_id' | 'department_id' | 'is_active'>>): Promise<void> {
    const { error } = await supabase.from(TEMPLATES_TABLE).update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTemplate(id: string): Promise<void> {
    const { error } = await supabase.from(TEMPLATES_TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ── Equipe (para atribuir/transferir) ────────────────────────
  async listStaff(): Promise<StaffOption[]> {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, name, gender, role, oab')
      .eq('is_active', true)
      .order('name', { ascending: true });
    return (data || []) as StaffOption[];
  },

  /** Preferências de atendimento do usuário logado (saudação automática etc.). */
  async getMyAgentPrefs(): Promise<AgentPrefs> {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { auto_greeting: true, short_name: null, role_label: null };
    const { data } = await supabase
      .from('whatsapp_agent_settings')
      .select('auto_greeting, short_name, role_label')
      .eq('user_id', uid)
      .maybeSingle();
    // Sem linha → saudação ligada por padrão (configurável depois).
    return data ? (data as AgentPrefs) : { auto_greeting: true, short_name: null, role_label: null };
  },

  // ── Horários de atendimento + ausência (Fase N) ───────────────
  async listBusinessHours(instanceId: string): Promise<WhatsAppBusinessHoursRow[]> {
    const { data, error } = await supabase
      .from('whatsapp_business_hours')
      .select('*')
      .eq('instance_id', instanceId)
      .order('day_of_week');
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppBusinessHoursRow[];
  },

  async upsertBusinessHours(instanceId: string, rows: Omit<WhatsAppBusinessHoursRow, 'id' | 'instance_id'>[]): Promise<void> {
    const payload = rows.map(r => ({ ...r, instance_id: instanceId }));
    const { error } = await supabase
      .from('whatsapp_business_hours')
      .upsert(payload, { onConflict: 'instance_id,day_of_week' });
    if (error) throw new Error(error.message);
  },

  async updateAbsenceConfig(instanceId: string, absenceMessage: string, absenceEnabled: boolean, timezone?: string): Promise<void> {
    const patch: Record<string, unknown> = {
      absence_message: absenceMessage || null,
      absence_enabled: absenceEnabled,
    };
    if (timezone) patch.timezone = timezone;
    const { error } = await supabase.from(CHANNEL_TABLE).update(patch).eq('id', instanceId);
    if (error) throw new Error(error.message);
  },

  // ── IA de atendimento (Fase J) ────────────────────────────────

  async getAiChannelConfig(channelId: string): Promise<WhatsAppAiChannelConfig | null> {
    const { data } = await supabase
      .from('whatsapp_ai_channel_config')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();
    return (data as WhatsAppAiChannelConfig) || null;
  },

  async upsertAiChannelConfig(
    channelId: string,
    patch: { ai_enabled?: boolean; max_ai_turns?: number; playbook_id?: string | null; require_human_approval?: boolean },
  ): Promise<void> {
    const { error } = await supabase
      .from('whatsapp_ai_channel_config')
      .upsert({ channel_id: channelId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'channel_id' });
    if (error) throw new Error(error.message);
  },

  async listPlaybooks(activeOnly = false): Promise<WhatsAppAiPlaybook[]> {
    let q = supabase.from('whatsapp_ai_playbooks').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppAiPlaybook[];
  },

  async createPlaybook(input: {
    name: string;
    description?: string;
    category?: string;
    welcome_message: string;
    questions: AiPlaybookQuestion[];
    handoff_message: string;
    system_prompt?: string;
  }): Promise<WhatsAppAiPlaybook> {
    const { data, error } = await supabase
      .from('whatsapp_ai_playbooks')
      .insert({
        name: input.name,
        description: input.description || null,
        category: input.category || 'intake',
        welcome_message: input.welcome_message,
        questions: input.questions,
        handoff_message: input.handoff_message,
        system_prompt: input.system_prompt || null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as WhatsAppAiPlaybook;
  },

  async updatePlaybook(id: string, patch: Partial<Pick<WhatsAppAiPlaybook,
    'name' | 'description' | 'category' | 'welcome_message' | 'questions' | 'handoff_message' | 'system_prompt' | 'is_active'
  >>): Promise<void> {
    const { error } = await supabase.from('whatsapp_ai_playbooks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deletePlaybook(id: string): Promise<void> {
    const { error } = await supabase.from('whatsapp_ai_playbooks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
