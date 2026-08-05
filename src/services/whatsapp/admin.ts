// Camada de administração: canais, departamentos, templates e equipe.
import { supabase } from '../../config/supabase';
import type {
  WhatsAppChannel, WhatsAppDepartment, WhatsAppTemplate, WhatsAppBusinessHoursRow,
  WhatsAppAiChannelConfig, WhatsAppAiPlaybook, AiPlaybookQuestion, WhatsAppChannelVisibility,
  WhatsAppChannelFunnelStage,
} from '../../types/whatsapp.types';
import {
  CHANNEL_TABLE, CHANNEL_MEMBER_TABLE, CHANNEL_FUNNEL_STAGE_TABLE, DEPT_TABLE, DEPT_MEMBER_TABLE, TEMPLATES_TABLE,
  invokeFn, type StaffOption, type AgentPrefs, type AgentTreatment,
} from './shared';

export interface WhatsAppChannelMemberRow {
  channel_id: string;
  user_id: string;
}

/**
 * Aviso de que o expediente de algum canal mudou. Quem depende dele (o SLA da
 * inbox, o banner de ausência) recarrega ao ouvir — a tela que edita e a tela
 * que consome vivem em módulos diferentes.
 */
export const BUSINESS_HOURS_CHANGED_EVENT = 'whatsapp:business-hours-changed';

/** Identidade "no automático": nome do perfil, tratamento deduzido, saudação ligada. */
export const DEFAULT_AGENT_PREFS: AgentPrefs = {
  auto_greeting: true, short_name: null, role_label: null, treatment: null,
};

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

  async updateChannel(
    id: string,
    patch: Partial<Pick<WhatsAppChannel, 'name' | 'color' | 'phone_number' | 'is_active' | 'default_assignee_id'>>,
  ): Promise<void> {
    const { error } = await supabase.from(CHANNEL_TABLE).update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Matriz de acesso canal × usuário. Carregada uma vez pelo editor de acessos. */
  async listChannelMembers(): Promise<WhatsAppChannelMemberRow[]> {
    const { data, error } = await supabase
      .from(CHANNEL_MEMBER_TABLE)
      .select('channel_id, user_id');
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppChannelMemberRow[];
  },

  /**
   * Salva a visibilidade do canal sem janela acidental de exposição:
   * - ao restringir, inclui os novos membros antes de ativar a restrição;
   * - ao abrir para todos, muda o modo antes de limpar os vínculos antigos.
   * As policies exigem Administrador para todas as mutações.
   */
  async updateChannelAccess(
    channelId: string,
    visibilityMode: WhatsAppChannelVisibility,
    userIds: string[],
  ): Promise<void> {
    const desired = Array.from(new Set(userIds.filter(Boolean)));
    const { data: currentRows, error: currentError } = await supabase
      .from(CHANNEL_MEMBER_TABLE)
      .select('user_id')
      .eq('channel_id', channelId);
    if (currentError) throw new Error(currentError.message);

    const current = new Set((currentRows || []).map(row => row.user_id as string));
    const missing = desired.filter(id => !current.has(id));
    const removed = Array.from(current).filter(id => !desired.includes(id));

    if (visibilityMode === 'all') {
      const { error } = await supabase
        .from(CHANNEL_TABLE)
        .update({ visibility_mode: 'all' })
        .eq('id', channelId);
      if (error) throw new Error(error.message);
    }

    if (missing.length > 0) {
      const { error } = await supabase.from(CHANNEL_MEMBER_TABLE).insert(
        missing.map(userId => ({ channel_id: channelId, user_id: userId })),
      );
      if (error) throw new Error(error.message);
    }

    if (visibilityMode === 'restricted') {
      const { error } = await supabase
        .from(CHANNEL_TABLE)
        .update({ visibility_mode: 'restricted' })
        .eq('id', channelId);
      if (error) throw new Error(error.message);
    }

    if (removed.length > 0 || visibilityMode === 'all') {
      let query = supabase.from(CHANNEL_MEMBER_TABLE).delete().eq('channel_id', channelId);
      if (visibilityMode !== 'all') query = query.in('user_id', removed);
      const { error } = await query;
      if (error) throw new Error(error.message);
    }
  },

  /** Etapas de todos os canais visíveis (ou apenas dos ids solicitados). */
  async listChannelFunnelStages(channelIds?: string[]): Promise<WhatsAppChannelFunnelStage[]> {
    if (channelIds?.length === 0) return [];
    let query = supabase
      .from(CHANNEL_FUNNEL_STAGE_TABLE)
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (channelIds?.length) query = query.in('channel_id', channelIds);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []) as WhatsAppChannelFunnelStage[];
  },

  /**
   * Salva o funil completo de um canal. As chaves das etapas existentes são
   * estáveis, pois também identificam o estágio nas automações e conversas.
   */
  async updateChannelFunnel(
    channelId: string,
    input: {
      enabled: boolean;
      initialStage: string;
      stages: Array<Pick<WhatsAppChannelFunnelStage,
        'stage_key' | 'label' | 'description' | 'color' | 'labels' | 'position' | 'is_active' | 'is_default' | 'entry_actions'>>;
    },
  ): Promise<void> {
    const stageKeys = input.stages.map(stage => stage.stage_key);
    const payload = input.stages.map(stage => ({ ...stage, channel_id: channelId }));

    if (payload.length > 0) {
      const { error } = await supabase
        .from(CHANNEL_FUNNEL_STAGE_TABLE)
        .upsert(payload, { onConflict: 'channel_id,stage_key' });
      if (error) throw new Error(error.message);
    }

    const { data: existing, error: existingError } = await supabase
      .from(CHANNEL_FUNNEL_STAGE_TABLE)
      .select('stage_key')
      .eq('channel_id', channelId);
    if (existingError) throw new Error(existingError.message);
    const removedKeys = (existing || [])
      .map(row => row.stage_key as string)
      .filter(key => !stageKeys.includes(key));
    if (removedKeys.length > 0) {
      const { error: obsoleteError } = await supabase
        .from(CHANNEL_FUNNEL_STAGE_TABLE)
        .delete()
        .eq('channel_id', channelId)
        .in('stage_key', removedKeys);
      if (obsoleteError) throw new Error(obsoleteError.message);
    }

    const { error: channelError } = await supabase
      .from(CHANNEL_TABLE)
      .update({ funnel_enabled: input.enabled, funnel_initial_stage: input.initialStage })
      .eq('id', channelId);
    if (channelError) throw new Error(channelError.message);
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

  /**
   * Mapa setor → membros, de uma vez só. A versão por setor obrigaria uma
   * consulta por departamento só para saber quem pode receber o quê — e a
   * distribuição da fila precisa da matriz inteira antes de decidir qualquer
   * coisa.
   */
  async listAllDepartmentMembers(): Promise<Record<string, string[]>> {
    const { data, error } = await supabase
      .from(DEPT_MEMBER_TABLE)
      .select('department_id, user_id');
    if (error) throw new Error(error.message);
    const byDept: Record<string, string[]> = {};
    for (const row of (data || []) as { department_id: string; user_id: string }[]) {
      (byDept[row.department_id] ??= []).push(row.user_id);
    }
    return byDept;
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
    // A identidade de atendimento (nome exibido, tratamento, cargo) vem de outra
    // tabela e vale para TODO mundo que vê a conversa — a assinatura da mensagem
    // é a do autor, não a de quem está lendo. Por isso as duas viajam juntas.
    const [profilesResp, settingsResp] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, name, gender, role, oab')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('whatsapp_agent_settings')
        .select('user_id, short_name, role_label, treatment'),
    ]);
    const prefsByUser = new Map<string, { short_name: string | null; role_label: string | null; treatment: AgentTreatment }>();
    for (const row of (settingsResp.data || []) as any[]) {
      prefsByUser.set(row.user_id, {
        short_name: row.short_name ?? null,
        role_label: row.role_label ?? null,
        treatment: (row.treatment ?? null) as AgentTreatment,
      });
    }
    return ((profilesResp.data || []) as StaffOption[]).map(p => ({ ...p, ...(prefsByUser.get(p.user_id) || {}) }));
  },

  /** Preferências de atendimento do usuário logado (saudação automática etc.). */
  async getMyAgentPrefs(): Promise<AgentPrefs> {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return DEFAULT_AGENT_PREFS;
    const { data } = await supabase
      .from('whatsapp_agent_settings')
      .select('auto_greeting, short_name, role_label, treatment')
      .eq('user_id', uid)
      .maybeSingle();
    // Sem linha → saudação ligada por padrão (configurável depois).
    return data ? { ...DEFAULT_AGENT_PREFS, ...(data as AgentPrefs) } : DEFAULT_AGENT_PREFS;
  },

  /**
   * Grava a identidade de atendimento do usuário logado. Campos em branco viram
   * NULL de propósito: é assim que se volta ao automático (nome do perfil e
   * Dr./Dra. deduzido do cadastro) em vez de gravar string vazia.
   */
  async saveMyAgentPrefs(prefs: AgentPrefs): Promise<AgentPrefs> {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error('Não autenticado');
    const payload = {
      user_id: uid,
      auto_greeting: prefs.auto_greeting,
      short_name: prefs.short_name?.trim() || null,
      role_label: prefs.role_label?.trim() || null,
      treatment: prefs.treatment || '',
    };
    const { error } = await supabase
      .from('whatsapp_agent_settings')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
    return { ...payload, treatment: payload.treatment as AgentTreatment };
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

  /**
   * Horários de TODOS os canais numa consulta. O SLA da inbox precisa da agenda
   * de cada canal ao mesmo tempo (a lista mistura canais), e uma consulta por
   * canal a cada render é o tipo de N+1 que só aparece quando o escritório
   * cresce para cinco números.
   */
  async listAllBusinessHours(): Promise<Record<string, WhatsAppBusinessHoursRow[]>> {
    const { data, error } = await supabase
      .from('whatsapp_business_hours')
      .select('*')
      .order('day_of_week');
    if (error) throw new Error(error.message);
    const byInstance: Record<string, WhatsAppBusinessHoursRow[]> = {};
    for (const row of (data || []) as WhatsAppBusinessHoursRow[]) {
      (byInstance[row.instance_id] ??= []).push(row);
    }
    return byInstance;
  },

  async upsertBusinessHours(instanceId: string, rows: Omit<WhatsAppBusinessHoursRow, 'id' | 'instance_id'>[]): Promise<void> {
    const payload = rows.map(r => ({ ...r, instance_id: instanceId }));
    const { error } = await supabase
      .from('whatsapp_business_hours')
      .upsert(payload, { onConflict: 'instance_id,day_of_week' });
    if (error) throw new Error(error.message);
    // O expediente é editado em Configurações, mas quem mede o SLA por ele é a
    // inbox — que já está montada em outro ponto da árvore. Sem este aviso, o
    // horário novo só valeria no próximo carregamento da página.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BUSINESS_HOURS_CHANGED_EVENT, { detail: { instanceId } }));
    }
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
