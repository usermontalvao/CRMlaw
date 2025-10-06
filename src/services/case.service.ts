import { supabase } from '../config/supabase';
import type {
  Case,
  CreateCaseDTO,
  UpdateCaseDTO,
  CaseDeadline,
  CreateDeadlineDTO,
  UpdateDeadlineDTO,
  AdministrativeRequest,
  CreateAdminRequestDTO,
  UpdateAdminRequestDTO,
} from '../types/case.types';

class CaseService {
  private tableName = 'cases';
  private deadlinesTable = 'case_deadlines';
  private adminRequestsTable = 'administrative_requests';

  // Cases
  async listCases(): Promise<Case[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getCaseById(id: string): Promise<Case | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async createCase(payload: CreateCaseDTO): Promise<Case> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateCase(id: string, payload: UpdateCaseDTO): Promise<Case> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteCase(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // Deadlines
  async listDeadlines(caseId?: string): Promise<CaseDeadline[]> {
    let query = supabase
      .from(this.deadlinesTable)
      .select('*')
      .order('deadline_date', { ascending: true });

    if (caseId) {
      query = query.eq('case_id', caseId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createDeadline(payload: CreateDeadlineDTO): Promise<CaseDeadline> {
    const { data, error } = await supabase
      .from(this.deadlinesTable)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateDeadline(id: string, payload: UpdateDeadlineDTO): Promise<CaseDeadline> {
    const { data, error } = await supabase
      .from(this.deadlinesTable)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteDeadline(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.deadlinesTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // Administrative Requests
  async listAdminRequests(caseId?: string): Promise<AdministrativeRequest[]> {
    let query = supabase
      .from(this.adminRequestsTable)
      .select('*')
      .order('created_at', { ascending: false });

    if (caseId) {
      query = query.eq('case_id', caseId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createAdminRequest(payload: CreateAdminRequestDTO): Promise<AdministrativeRequest> {
    const { data, error } = await supabase
      .from(this.adminRequestsTable)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateAdminRequest(id: string, payload: UpdateAdminRequestDTO): Promise<AdministrativeRequest> {
    const { data, error } = await supabase
      .from(this.adminRequestsTable)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteAdminRequest(id: string): Promise<void> {
    const { error} = await supabase
      .from(this.adminRequestsTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }
}

export const caseService = new CaseService();
