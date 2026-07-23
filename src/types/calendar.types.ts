export type CalendarEventType =
  | 'deadline'
  | 'hearing'
  | 'requirement'
  | 'payment'
  | 'meeting'
  | 'pericia'
  | 'personal';

export type CalendarEventStatus = 'pendente' | 'concluido' | 'cancelado';

export type DjenStatus = 'confirmed' | 'divergence' | 'unconfirmed' | 'confirmed_manual';

export type CalendarEventMode = 'presencial' | 'online';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string | null;
  event_type: CalendarEventType;
  status: CalendarEventStatus;
  start_at: string;
  end_at?: string | null;
  notify_minutes_before?: number | null;
  deadline_id?: string | null;
  requirement_id?: string | null;
  process_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  user_id?: string | null;
  is_private?: boolean;
  shared_with_ids?: string[];
  event_mode?: CalendarEventMode | null;
  created_at: string;
  updated_at: string;
  djen_status?: DjenStatus | null;
  djen_intimation_id?: string | null;
  djen_checked_at?: string | null;
  manual_confirmed_at?: string | null;
  manual_confirmed_by?: string | null;
  manual_confirmed_date?: string | null;
  manual_note?: string | null;
}

export interface CreateCalendarEventDTO {
  title: string;
  description?: string | null;
  event_type: CalendarEventType;
  status?: CalendarEventStatus;
  start_at: string;
  end_at?: string | null;
  notify_minutes_before?: number | null;
  deadline_id?: string | null;
  requirement_id?: string | null;
  process_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  user_id?: string | null;
  is_private?: boolean;
  shared_with_ids?: string[];
  event_mode?: CalendarEventMode | null;
  djen_intimation_id?: string | null;
}

export interface UpdateCalendarEventDTO extends Partial<CreateCalendarEventDTO> {}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export type CalendarAuditAction = 'create' | 'update' | 'delete';

export interface CalendarAuditField {
  before: unknown;
  after: unknown;
}

export interface CalendarEventAudit {
  id: string;
  calendar_event_id: string | null;
  action: CalendarAuditAction;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  /** Presente somente em `update`: { campo: { before, after } } */
  changed_fields: Record<string, CalendarAuditField> | null;
}
