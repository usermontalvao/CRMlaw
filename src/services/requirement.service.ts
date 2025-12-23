import { supabase } from '../config/supabase';
import type {
  Requirement,
  CreateRequirementDTO,
  UpdateRequirementDTO,
  RequirementFilters,
  RequirementStatus,
  RequirementStatusHistoryEntry,
} from '../types/requirement.types';

class RequirementService {
  private tableName = 'requirements';
  private statusHistoryTableName = 'requirement_status_history';

  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]> {
    let query = supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.protocol) {
      query = query.ilike('protocol', `%${filters.protocol}%`);
    }

    if (filters?.beneficiary) {
      query = query.ilike('beneficiary', `%${filters.beneficiary}%`);
    }

    if (filters?.cpf) {
      query = query.ilike('cpf', `%${filters.cpf}%`);
    }

    if (filters?.benefit_type) {
      query = query.eq('benefit_type', filters.benefit_type);
    }

    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar requerimentos:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  async getRequirementById(id: string): Promise<Requirement | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar requerimento:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createRequirement(payload: CreateRequirementDTO): Promise<Requirement> {
    const nextPayload: Record<string, any> = { ...payload };
    if (payload.status === 'em_analise' && nextPayload.analysis_started_at === undefined) {
      nextPayload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...nextPayload,
        status: nextPayload.status ?? 'aguardando_confeccao',
        protocol: nextPayload.protocol || null,
        exigency_due_date: nextPayload.exigency_due_date ?? null,
        pericia_medica_at: nextPayload.pericia_medica_at ?? null,
        pericia_social_at: nextPayload.pericia_social_at ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar requerimento:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async updateRequirement(id: string, payload: UpdateRequirementDTO): Promise<Requirement> {
    const nextPayload: Record<string, any> = { ...payload };
    if (payload.status === 'em_analise' && nextPayload.analysis_started_at === undefined) {
      nextPayload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...nextPayload,
        exigency_due_date: nextPayload.exigency_due_date ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar requerimento:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async updateStatus(id: string, status: RequirementStatus): Promise<Requirement> {
    const payload: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (status === 'em_analise') {
      payload.analysis_started_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status do requerimento:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async deleteRequirement(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar requerimento:', error);
      throw new Error(error.message);
    }
  }

  async listStatusHistory(requirementId: string): Promise<RequirementStatusHistoryEntry[]> {
    const { data, error } = await supabase
      .from(this.statusHistoryTableName)
      .select('*')
      .eq('requirement_id', requirementId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar histórico de status do requerimento:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as RequirementStatusHistoryEntry[];
  }
}

export const requirementService = new RequirementService();
