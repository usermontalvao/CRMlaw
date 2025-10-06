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

export interface Process {
  id: string;
  client_id: string;
  process_code: string;
  status: ProcessStatus;
  distributed_at: string | null;
  practice_area: ProcessPracticeArea;
  court?: string | null;
  responsible_lawyer?: string | null;
  responsible_lawyer_id?: string | null;
  hearing_scheduled?: boolean | null;
  hearing_date?: string | null;
  hearing_time?: string | null;
  hearing_mode?: HearingMode | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProcessDTO {
  client_id: string;
  process_code: string;
  status?: ProcessStatus;
  distributed_at?: string | null;
  practice_area: ProcessPracticeArea;
  court?: string | null;
  responsible_lawyer?: string | null;
  responsible_lawyer_id?: string | null;
  hearing_scheduled?: boolean | null;
  hearing_date?: string | null;
  hearing_time?: string | null;
  hearing_mode?: HearingMode | null;
  notes?: string | null;
}

export interface UpdateProcessDTO extends Partial<CreateProcessDTO> {}

export interface ProcessFilters {
  status?: ProcessStatus;
  client_id?: string;
  search?: string;
  practice_area?: ProcessPracticeArea;
}
