import { supabase } from '../config/supabase';
import { syncBus } from '../lib/syncBus';
import type {
  CalendarEvent,
  CalendarEventAudit,
  CreateCalendarEventDTO,
  UpdateCalendarEventDTO,
  CalendarEventType,
} from '../types/calendar.types';

class CalendarService {
  private tableName = 'calendar_events';

  // Converte data/hora local para formato com timezone
  private toLocalTimestamp(dateTimeString: string): string {
    // Se já tem timezone (positivo, negativo ou Z), retorna como está
    if (dateTimeString.includes('+') || dateTimeString.includes('Z')) {
      return dateTimeString;
    }
    // Offset negativo no final, ex: "2026-07-17T16:00:00-04:00"
    if (/T\d{2}:\d{2}:\d{2}-\d{2}:\d{2}$/.test(dateTimeString)) {
      return dateTimeString;
    }

    // Adiciona o timezone local (ex: -03:00 para Brasília)
    const date = new Date(dateTimeString);
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
    const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
    const sign = offset >= 0 ? '+' : '-';

    return `${dateTimeString}${sign}${offsetHours}:${offsetMinutes}`;
  }

  async listEvents(typeFilters?: CalendarEventType[]): Promise<CalendarEvent[]> {
    let query = supabase.from(this.tableName).select('*').order('start_at', { ascending: true });

    if (typeFilters && typeFilters.length > 0) {
      query = query.in('event_type', typeFilters);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar eventos do calendário:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  async getEventById(id: string): Promise<CalendarEvent | null> {
    const { data, error } = await supabase.from(this.tableName).select('*').eq('id', id).single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Erro ao buscar evento do calendário:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async getEventByAutoKey(key: string): Promise<CalendarEvent | null> {
    const { data, error } = await supabase.from(this.tableName).select('*').eq('auto_event_key', key).single();
    if (error) return null;
    return data;
  }

  async createEvent(payload: CreateCalendarEventDTO): Promise<CalendarEvent> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        start_at: this.toLocalTimestamp(payload.start_at),
        end_at: payload.end_at ? this.toLocalTimestamp(payload.end_at) : null,
        status: payload.status ?? 'pendente',
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar evento do calendário:', error);
      throw new Error(error.message);
    }

    syncBus.emit('calendar');
    return data;
  }

  async updateEvent(id: string, payload: UpdateCalendarEventDTO): Promise<CalendarEvent> {
    const updateData: any = { ...payload };
    
    if (payload.start_at) {
      updateData.start_at = this.toLocalTimestamp(payload.start_at);
    }
    
    if (payload.end_at) {
      updateData.end_at = this.toLocalTimestamp(payload.end_at);
    }
    
    const { data, error } = await supabase
      .from(this.tableName)
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar evento do calendário:', error);
      throw new Error(error.message);
    }

    syncBus.emit('calendar');
    return data;
  }

  /**
   * Confirma manualmente uma audiência/perícia (designada em ata, sem publicação
   * no DJEN). A regra de precedência vive no banco: um despacho DJEN posterior à
   * confirmação prevalece e reverte para divergência. Retorna o evento atualizado.
   */
  async manualConfirmHearing(id: string, note?: string | null): Promise<CalendarEvent | null> {
    const { error } = await supabase.rpc('fn_manual_confirm_hearing', {
      p_event_id: id,
      p_note: note ?? null,
    });
    if (error) {
      console.error('Erro ao confirmar manualmente:', error);
      throw new Error(error.message);
    }
    return this.getEventById(id);
  }

  /** Desfaz a confirmação manual; o status volta a ser ditado pelo DJEN. */
  async manualUnconfirmHearing(id: string): Promise<CalendarEvent | null> {
    const { error } = await supabase.rpc('fn_manual_unconfirm_hearing', { p_event_id: id });
    if (error) {
      console.error('Erro ao desfazer confirmação manual:', error);
      throw new Error(error.message);
    }
    return this.getEventById(id);
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      console.error('Erro ao excluir evento do calendário:', error);
      throw new Error(error.message);
    }
    syncBus.emit('calendar');
  }

  async deleteEventsByRequirementId(requirementId: string, eventType?: string): Promise<void> {
    let query = supabase.from(this.tableName).delete().eq('requirement_id', requirementId);
    if (eventType) query = query.eq('event_type', eventType);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  /**
   * Retorna o histórico de auditoria de um compromisso específico,
   * ordenado do mais recente para o mais antigo.
   */
  async getEventAudit(calendarEventId: string): Promise<CalendarEventAudit[]> {
    const { data, error } = await supabase
      .from('calendar_event_audit')
      .select('*')
      .eq('calendar_event_id', calendarEventId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar auditoria do evento:', error);
      throw new Error(error.message);
    }

    return (data ?? []) as CalendarEventAudit[];
  }

  /**
   * Retorna todas as entradas de auditoria de um período, útil para
   * relatórios administrativos. Limit padrão de 200 registros.
   */
  async listAudit(options?: {
    from?: string;
    to?: string;
    action?: 'create' | 'update' | 'delete';
    limit?: number;
  }): Promise<CalendarEventAudit[]> {
    let query = supabase
      .from('calendar_event_audit')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(options?.limit ?? 200);

    if (options?.from) query = query.gte('changed_at', options.from);
    if (options?.to)   query = query.lte('changed_at', options.to);
    if (options?.action) query = query.eq('action', options.action);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as CalendarEventAudit[];
  }
}

export const calendarService = new CalendarService();
