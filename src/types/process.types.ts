export type ProcessStatus =
  | 'nao_protocolado'
  | 'distribuido'
  | 'aguardando_confeccao'
  | 'andamento'
  | 'sentenca'
  | 'cumprimento'
  | 'arquivado';

export type ProcessPracticeArea =
  | 'trabalhista'
  | 'familia'
  | 'consumidor'
  | 'previdenciario'
  | 'civel';

export type HearingMode = 'presencial' | 'online';

export type RequirementRole = 'principal' | 'ms';

export interface Process {
  id: string;
  client_id: string;
  process_code: string;
  status: ProcessStatus;
  distributed_at: string | null;
  practice_area: ProcessPracticeArea;
  requirement_id?: string | null;
  requirement_role?: RequirementRole | null;
  court?: string | null;
  responsible_lawyer?: string | null;
  responsible_lawyer_id?: string | null;
  hearing_scheduled?: boolean | null;
  hearing_date?: string | null;
  hearing_time?: string | null;
  hearing_mode?: HearingMode | null;
  notes?: string | null;
  djen_synced?: boolean | null;
  djen_last_sync?: string | null;
  djen_has_data?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProcessDTO {
  client_id: string;
  process_code: string;
  status?: ProcessStatus;
  distributed_at?: string | null;
  practice_area: ProcessPracticeArea;
  requirement_id?: string | null;
  requirement_role?: RequirementRole | null;
  court?: string | null;
  responsible_lawyer?: string | null;
  responsible_lawyer_id?: string | null;
  hearing_scheduled?: boolean | null;
  hearing_date?: string | null;
  hearing_time?: string | null;
  hearing_mode?: HearingMode | null;
  notes?: string | null;
  djen_synced?: boolean | null;
  djen_last_sync?: string | null;
  djen_has_data?: boolean | null;
}

export interface UpdateProcessDTO extends Partial<CreateProcessDTO> {}

export interface ProcessFilters {
  status?: ProcessStatus;
  client_id?: string;
  search?: string;
  practice_area?: ProcessPracticeArea;
  requirement_id?: string;
  requirement_role?: RequirementRole;
}
