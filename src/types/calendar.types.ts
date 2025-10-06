export type CalendarEventType =
  | 'deadline'
  | 'hearing'
  | 'requirement'
  | 'payment'
  | 'meeting'
  | 'pericia';

export type CalendarEventStatus = 'pendente' | 'concluido' | 'cancelado';

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
  created_at: string;
  updated_at: string;
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
}

export interface UpdateCalendarEventDTO extends Partial<CreateCalendarEventDTO> {}
