import { supabase } from '../config/supabase';
import type {
  Requirement,
  CreateRequirementDTO,
  UpdateRequirementDTO,
  RequirementFilters,
  RequirementStatus,
} from '../types/requirement.types';

class RequirementService {
  private tableName = 'requirements';

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
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        status: payload.status ?? 'nao_iniciado',
        protocol: payload.protocol || null,
        exigency_due_date: payload.exigency_due_date ?? null,
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
    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...payload,
        exigency_due_date: payload.exigency_due_date ?? null,
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
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ status, updated_at: new Date().toISOString() })
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
}

export const requirementService = new RequirementService();
