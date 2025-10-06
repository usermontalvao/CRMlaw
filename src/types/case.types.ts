export type CaseStatus = 'ativo' | 'arquivado' | 'suspenso' | 'finalizado';
export type DeadlinePriority = 'baixa' | 'media' | 'alta' | 'urgente';
export type AdminRequestStatus = 'em_analise' | 'deferido' | 'indeferido' | 'pendente';

export interface Case {
  id: string;
  client_id: string;
  case_number: string;
  title: string;
  description?: string | null;
  court?: string | null;
  status: CaseStatus;
  case_type?: string | null;
  is_filed: boolean;
  filed_at?: string | null;
  value?: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCaseDTO {
  client_id: string;
  case_number: string;
  title: string;
  description?: string;
  court?: string;
  status?: CaseStatus;
  case_type?: string;
  is_filed?: boolean;
  filed_at?: string;
  value?: number;
}

export interface UpdateCaseDTO {
  case_number?: string;
  title?: string;
  description?: string;
  court?: string;
  status?: CaseStatus;
  case_type?: string;
  is_filed?: boolean;
  filed_at?: string;
  value?: number;
}

export interface CaseDeadline {
  id: string;
  case_id: string;
  title: string;
  description?: string | null;
  deadline_date: string;
  completed: boolean;
  completed_at?: string | null;
  priority: DeadlinePriority;
  created_at: string;
  updated_at: string;
}

export interface CreateDeadlineDTO {
  case_id: string;
  title: string;
  description?: string;
  deadline_date: string;
  priority?: DeadlinePriority;
}

export interface UpdateDeadlineDTO {
  title?: string;
  description?: string;
  deadline_date?: string;
  completed?: boolean;
  completed_at?: string;
  priority?: DeadlinePriority;
}

export interface AdministrativeRequest {
  id: string;
  case_id?: string | null;
  client_id?: string | null;
  protocol_number?: string | null;
  request_type: string;
  status: AdminRequestStatus;
  submitted_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAdminRequestDTO {
  case_id?: string;
  client_id?: string;
  protocol_number?: string;
  request_type: string;
  status?: AdminRequestStatus;
  submitted_at?: string;
  notes?: string;
}

export interface UpdateAdminRequestDTO {
  protocol_number?: string;
  request_type?: string;
  status?: AdminRequestStatus;
  submitted_at?: string;
  notes?: string;
}
