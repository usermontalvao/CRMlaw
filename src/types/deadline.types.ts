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

/** Print/arquivo anexado ao motivo do cancelamento (bucket anexos_chat). */
export interface DeadlineCancellationAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

/** Motivo registrado quando um prazo é cancelado (tabela deadline_cancellations). */
export interface DeadlineCancellation {
  id: string;
  deadline_id: string;
  reason: string;
  cancelled_by?: string | null;
  created_at: string;
  attachments?: DeadlineCancellationAttachment[] | null;
}

/**
 * Evento de auditoria do prazo — quem mexeu, quando e em quê.
 * Vem de audit_log via RPC get_deadline_timeline; o gatilho do banco é quem
 * grava, então o registro existe mesmo para alterações feitas fora do CRM.
 */
export interface DeadlineTimelineEvent {
  id: string;
  action: string;
  user_id?: string | null;
  user_name?: string | null;
  created_at: string;
  status_from?: string | null;
  status_to?: string | null;
}

/** Quem deu a baixa (cumpriu ou cancelou) — evento de fechamento mais recente. */
export interface DeadlineClosure {
  deadline_id: string;
  action: string;
  user_id?: string | null;
  user_name?: string | null;
  created_at: string;
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
