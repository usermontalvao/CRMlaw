import { supabase } from '../config/supabase';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';
export type DurationType = 'permanent' | 'temporary';

export interface ModuleAccessRequest {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_role: string;
  module_key: string;
  module_label: string;
  justification: string | null;
  status: AccessRequestStatus;
  duration_type: DurationType | null;
  duration_days: number | null;
  expires_at: string | null;
  admin_id: string | null;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface UserModuleOverride {
  id: string;
  user_id: string;
  module: string;
  can_view: boolean;
  granted_by: string | null;
  request_id: string | null;
  expires_at: string | null;
  created_at: string;
}

class AccessRequestService {
  // ── Solicitações ───────────────────────────────────────────────────────────

  async createRequest(data: {
    requester_id: string;
    requester_name: string;
    requester_role: string;
    module_key: string;
    module_label: string;
    justification?: string;
  }): Promise<ModuleAccessRequest> {
    // Verificar se já existe solicitação pendente para este módulo
    const { data: existing } = await supabase
      .from('module_access_requests')
      .select('id, status')
      .eq('requester_id', data.requester_id)
      .eq('module_key', data.module_key)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      throw new Error('Já existe uma solicitação pendente para este módulo.');
    }

    const { data: req, error } = await supabase
      .from('module_access_requests')
      .insert({
        requester_id: data.requester_id,
        requester_name: data.requester_name,
        requester_role: data.requester_role,
        module_key: data.module_key,
        module_label: data.module_label,
        justification: data.justification ?? null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return req as ModuleAccessRequest;
  }

  async listPending(): Promise<ModuleAccessRequest[]> {
    const { data, error } = await supabase
      .from('module_access_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[AccessRequestService] listPending error:', error.code, error.message, error.details);
      throw error;
    }
    console.log('[AccessRequestService] listPending ok, rows:', data?.length);
    return (data ?? []) as ModuleAccessRequest[];
  }

  async listAll(): Promise<ModuleAccessRequest[]> {
    const { data, error } = await supabase
      .from('module_access_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[AccessRequestService] listAll error:', error.code, error.message, error.details);
      throw error;
    }
    console.log('[AccessRequestService] listAll ok, rows:', data?.length);
    return (data ?? []) as ModuleAccessRequest[];
  }

  async listByRequester(userId: string): Promise<ModuleAccessRequest[]> {
    const { data, error } = await supabase
      .from('module_access_requests')
      .select('*')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as ModuleAccessRequest[];
  }

  async approve(
    requestId: string,
    adminId: string,
    opts: {
      durationType: DurationType;
      durationDays?: number;   // inteiro (1-365)
      durationHours?: number;  // inteiro (1-72) — usado quando a unidade é horas
      adminNotes?: string;
    }
  ): Promise<void> {
    // 1) Buscar a solicitação
    const { data: req, error: reqErr } = await supabase
      .from('module_access_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqErr || !req) throw new Error('Solicitação não encontrada.');

    // Calcular expires_at — horas têm prioridade sobre dias
    let expiresAt: string | null = null;
    if (opts.durationType === 'temporary') {
      if (opts.durationHours && opts.durationHours > 0) {
        expiresAt = new Date(Date.now() + opts.durationHours * 3_600_000).toISOString();
      } else if (opts.durationDays && opts.durationDays > 0) {
        expiresAt = new Date(Date.now() + opts.durationDays * 86_400_000).toISOString();
      }
    }

    // duration_days aceita apenas inteiro no banco → null para acesso por horas
    const durationDaysDb =
      opts.durationHours ? null
      : opts.durationDays ? Math.round(opts.durationDays)
      : null;

    // 2) Atualizar a solicitação
    const { error: updErr } = await supabase
      .from('module_access_requests')
      .update({
        status: 'approved',
        duration_type: opts.durationType,
        duration_days: durationDaysDb,
        expires_at: expiresAt,
        admin_id: adminId,
        admin_notes: opts.adminNotes ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (updErr) throw updErr;

    // 3) Criar/atualizar override individual
    const { error: ovErr } = await supabase
      .from('user_module_overrides')
      .upsert(
        {
          user_id: req.requester_id,
          module: req.module_key,
          can_view: true,
          granted_by: adminId,
          request_id: requestId,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id,module' }
      );

    if (ovErr) throw ovErr;

    // 4) Notificar o solicitante
    const durationLabel =
      opts.durationType === 'permanent'
        ? 'permanentemente'
        : opts.durationHours
        ? `por ${opts.durationHours} hora${opts.durationHours !== 1 ? 's' : ''}`
        : `por ${opts.durationDays} dia${(opts.durationDays ?? 0) !== 1 ? 's' : ''}`;

    await supabase.from('user_notifications').insert({
      user_id: req.requester_id,
      type: 'access_request_resolved',
      title: '✅ Acesso concedido',
      message: `Seu acesso ao módulo "${req.module_label}" foi aprovado ${durationLabel}.`,
      metadata: { request_id: requestId, module_key: req.module_key, status: 'approved' },
    });
  }

  async deny(requestId: string, adminId: string, adminNotes?: string): Promise<void> {
    const { data: req, error: reqErr } = await supabase
      .from('module_access_requests')
      .select('requester_id, module_label, module_key')
      .eq('id', requestId)
      .single();

    if (reqErr || !req) throw new Error('Solicitação não encontrada.');

    const { error } = await supabase
      .from('module_access_requests')
      .update({
        status: 'denied',
        admin_id: adminId,
        admin_notes: adminNotes ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', requestId);

    if (error) throw error;

    // Notificar o solicitante (inclui module_key para que o clique na notificação navegue corretamente)
    await supabase.from('user_notifications').insert({
      user_id: req.requester_id,
      type: 'access_request_resolved',
      title: '❌ Solicitação negada',
      message: `Sua solicitação de acesso ao módulo "${req.module_label}" foi negada.${adminNotes ? ` Motivo: ${adminNotes}` : ''}`,
      metadata: { request_id: requestId, module_key: req.module_key, status: 'denied' },
    });
  }

  // ── Overrides individuais ──────────────────────────────────────────────────

  async getUserOverrides(userId: string): Promise<UserModuleOverride[]> {
    const { data, error } = await supabase
      .from('user_module_overrides')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return (data ?? []) as UserModuleOverride[];
  }

  async revokeOverride(userId: string, module: string): Promise<void> {
    const { error } = await supabase
      .from('user_module_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('module', module);

    if (error) throw error;
  }

  // ── Notificar admins ───────────────────────────────────────────────────────

  async notifyAdmins(requestId: string, requesterName: string, moduleLabel: string): Promise<void> {
    const { data: admins, error: adminsErr } = await supabase
      .from('profiles')
      .select('user_id, name')
      .ilike('role', 'administrador');

    if (adminsErr) {
      console.error('[AccessRequest] Erro ao buscar admins:', adminsErr);
      return;
    }
    if (!admins?.length) {
      console.warn('[AccessRequest] Nenhum administrador encontrado para notificar.');
      return;
    }

    const notifications = admins.map(a => ({
      user_id: a.user_id,
      type: 'access_request' as const,
      title: '🔐 Solicitação de acesso',
      message: `${requesterName} solicitou acesso ao módulo "${moduleLabel}". Acesse Configurações → Solicitações para gerenciar.`,
      metadata: { request_id: requestId, module_label: moduleLabel },
    }));

    const { error: notifErr } = await supabase.from('user_notifications').insert(notifications);
    if (notifErr) {
      console.error('[AccessRequest] Erro ao inserir notificações para admins:', notifErr);
    }
  }

  // ── Verificar contagem pendente (para badge admin) ─────────────────────────

  async getPendingCount(): Promise<number> {
    const { count, error } = await supabase
      .from('module_access_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) return 0;
    return count ?? 0;
  }
}

export const accessRequestService = new AccessRequestService();
