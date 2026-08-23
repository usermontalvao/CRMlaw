import { supabase } from '../config/supabase';
import type { Lead, CreateLeadDTO, UpdateLeadDTO } from '../types/lead.types';

class LeadService {
  private tableName = 'leads';

  async listLeads(): Promise<Lead[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getLeadById(id: string): Promise<Lead | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async createLead(payload: CreateLeadDTO): Promise<Lead> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateLead(id: string, payload: UpdateLeadDTO): Promise<Lead> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteLead(id: string): Promise<void> {
    const { data: deleted, error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw new Error(error.message);
    if (!deleted?.length) throw new Error('O lead não foi excluído. Verifique sua permissão.');
  }

  async convertLeadToClient(leadId: string, clientId: string): Promise<Lead> {
    return this.updateLead(leadId, {
      converted_to_client_id: clientId,
      converted_at: new Date().toISOString(),
      stage: 'qualificado',
    });
  }
}

export const leadService = new LeadService();
