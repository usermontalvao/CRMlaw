export type BuiltInCalendarEventType =
  | 'deadline'
  | 'hearing'
  | 'requirement'
  | 'payment'
  | 'meeting'
  | 'pericia'
  | 'personal';

// A Agenda permite cadastrar tipos adicionais em Configurações. A interseção
// preserva o autocomplete dos tipos estruturais sem restringir os personalizados.
export type CalendarEventType = BuiltInCalendarEventType | (string & {});

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

  // ── Comunicar o cliente ────────────────────────────────────────────────
  // Separadas de `notify_minutes_before`, que é o lembrete da EQUIPE. Ver o
  // comentário da migration 20260901160000: são dois avisos com dono, texto e
  // consequência diferentes.
  /** Interruptor do painel. Nasce desligado. */
  client_notify_enabled?: boolean;
  /** Antecedência da mensagem ao cliente, em minutos. */
  client_notify_minutes_before?: number | null;
  /** O texto, ainda com as variáveis — quem as resolve é o envio. */
  client_notify_message?: string | null;
  /** Item da biblioteca de mídia do WhatsApp, opcional. */
  client_notify_media_id?: string | null;
  /** Quando saiu. NULL = agendada e ainda cancelável. */
  client_notify_sent_at?: string | null;
  /** A última falha, quando houve. */
  client_notify_error?: string | null;
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
  // Comunicar o cliente — gravada no mesmo INSERT/UPDATE do compromisso, para
  // não obrigar a criar-salvar-reabrir. `client_notify_sent_at` NÃO entra aqui
  // de propósito: quem carimba o envio é a Edge Function, nunca o formulário.
  client_notify_enabled?: boolean;
  client_notify_minutes_before?: number | null;
  client_notify_message?: string | null;
  client_notify_media_id?: string | null;
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
