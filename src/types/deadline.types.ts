export type DeadlineStatus = 'pendente' | 'cumprido' | 'vencido' | 'cancelado';

export type DeadlineType = 'processo' | 'requerimento' | 'geral';

export type DeadlinePriority = 'baixa' | 'media' | 'alta' | 'urgente';

export interface Deadline {
  id: string;
  title: string;
  description?: string | null;
  due_date: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  type: DeadlineType;

  // Vinculação opcional com outros módulos
  process_id?: string | null;
  requirement_id?: string | null;
  client_id?: string | null;
  responsible_id?: string | null;
  intimation_id?: string | null;

  // Guardião de prazos
  origin?: string | null;
  confirmed_at?: string | null;

  // Calculadora de prazo (inputs que geraram o due_date)
  publication_date?: string | null;
  deadline_days?: number | null;
  counting_type?: string | null;

  // Notificações
  notify_days_before?: number | null;
  notified_at?: string | null;

  // Metadados
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  completed_at?: string | null;
}

export interface CreateDeadlineDTO {
  title: string;
  description?: string | null;
  due_date: string;
  status?: DeadlineStatus;
  priority?: DeadlinePriority;
  type: DeadlineType;
  process_id?: string | null;
  requirement_id?: string | null;
  client_id?: string | null;
  responsible_id: string;
  intimation_id?: string | null;
  origin?: string | null;
  notify_days_before?: number | null;
  publication_date?: string | null;
  deadline_days?: number | null;
  counting_type?: string | null;
}

export interface UpdateDeadlineDTO extends Partial<Omit<CreateDeadlineDTO, 'responsible_id'>> {
  responsible_id?: string | null;
  completed_at?: string | null;
}

export interface DeadlineFilters {
  status?: DeadlineStatus;
  priority?: DeadlinePriority;
  type?: DeadlineType;
  process_id?: string;
  requirement_id?: string;
  client_id?: string;
  responsible_id?: string;
  search?: string;
  due_date_from?: string;
  due_date_to?: string;
}
