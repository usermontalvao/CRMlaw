export type LeadStage = 'novo' | 'qualificando' | 'qualificado' | 'aguardando_documentos' | 'nao_qualificado';

export interface Lead {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  stage: LeadStage;
  notes?: string | null;
  converted_to_client_id?: string | null;
  converted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeadDTO {
  name: string;
  email?: string;
  phone?: string;
  source?: string;
  stage?: LeadStage;
  notes?: string;
}

export interface UpdateLeadDTO {
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  stage?: LeadStage;
  notes?: string;
  converted_to_client_id?: string;
  converted_at?: string;
}
