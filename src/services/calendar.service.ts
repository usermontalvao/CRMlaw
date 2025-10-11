import { supabase } from '../config/supabase';
import type {
  CalendarEvent,
  CreateCalendarEventDTO,
  UpdateCalendarEventDTO,
  CalendarEventType,
} from '../types/calendar.types';

class CalendarService {
  private tableName = 'calendar_events';

  // Converte data/hora local para formato com timezone
  private toLocalTimestamp(dateTimeString: string): string {
    // Se já tem timezone, retorna como está
    if (dateTimeString.includes('+') || dateTimeString.includes('Z')) {
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

    return data;
  }

  async deleteEvent(id: string): Promise<void> {
    const { error } = await supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      console.error('Erro ao excluir evento do calendário:', error);
      throw new Error(error.message);
    }
  }
}

export const calendarService = new CalendarService();
