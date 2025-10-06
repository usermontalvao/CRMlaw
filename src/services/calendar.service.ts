import { supabase } from '../config/supabase';
import type {
  CalendarEvent,
  CreateCalendarEventDTO,
  UpdateCalendarEventDTO,
  CalendarEventType,
} from '../types/calendar.types';

class CalendarService {
  private tableName = 'calendar_events';

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
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ ...payload })
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
