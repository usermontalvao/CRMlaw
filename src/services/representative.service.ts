import { supabase } from '../config/supabase';
import type {
  Representative,
  CreateRepresentativeDTO,
  UpdateRepresentativeDTO,
  RepresentativeAppointment,
  CreateRepresentativeAppointmentDTO,
  UpdateRepresentativeAppointmentDTO,
} from '../types/representative.types';

// =====================================================
// SERVICE DE PREPOSTOS
// =====================================================

class RepresentativeService {
  // =====================================================
  // CRUD DE PREPOSTOS
  // =====================================================

  async listRepresentatives(): Promise<Representative[]> {
    const { data, error } = await supabase
      .from('representatives')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getRepresentativeById(id: string): Promise<Representative | null> {
    const { data, error } = await supabase
      .from('representatives')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async createRepresentative(dto: CreateRepresentativeDTO): Promise<Representative> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { data, error } = await supabase
      .from('representatives')
      .insert({
        ...dto,
        status: dto.status || 'ativo',
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateRepresentative(id: string, dto: UpdateRepresentativeDTO): Promise<Representative> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { data, error } = await supabase
      .from('representatives')
      .update({
        ...dto,
        updated_by: userId,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteRepresentative(id: string): Promise<void> {
    const { error } = await supabase
      .from('representatives')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // =====================================================
  // CRUD DE VÍNCULOS PREPOSTO-COMPROMISSO
  // =====================================================

  async listAppointments(filters?: {
    representative_id?: string;
    calendar_event_id?: string;
    service_status?: string;
    payment_status?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<RepresentativeAppointment[]> {
    let query = supabase
      .from('representative_appointments')
      .select(`
        *,
        representative:representatives(*),
        calendar_event:calendar_events(id, title, start_at, event_type, client_id)
      `)
      .order('service_date', { ascending: false });

    if (filters?.representative_id) {
      query = query.eq('representative_id', filters.representative_id);
    }
    if (filters?.calendar_event_id) {
      query = query.eq('calendar_event_id', filters.calendar_event_id);
    }
    if (filters?.service_status) {
      query = query.eq('service_status', filters.service_status);
    }
    if (filters?.payment_status) {
      query = query.eq('payment_status', filters.payment_status);
    }
    if (filters?.date_from) {
      query = query.gte('service_date', filters.date_from);
    }
    if (filters?.date_to) {
      query = query.lte('service_date', filters.date_to);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getAppointmentById(id: string): Promise<RepresentativeAppointment | null> {
    const { data, error } = await supabase
      .from('representative_appointments')
      .select(`
        *,
        representative:representatives(*),
        calendar_event:calendar_events(id, title, start_at, event_type, client_id)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getAppointmentsByEventId(calendarEventId: string): Promise<RepresentativeAppointment[]> {
    const { data, error } = await supabase
      .from('representative_appointments')
      .select(`
        *,
        representative:representatives(*)
      `)
      .eq('calendar_event_id', calendarEventId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async createAppointment(dto: CreateRepresentativeAppointmentDTO): Promise<RepresentativeAppointment> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { data, error } = await supabase
      .from('representative_appointments')
      .insert({
        ...dto,
        service_status: dto.service_status || 'agendado',
        payment_status: dto.payment_status || 'pendente',
        created_by: userId,
        updated_by: userId,
      })
      .select(`
        *,
        representative:representatives(*),
        calendar_event:calendar_events(id, title, start_at, event_type, client_id)
      `)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateAppointment(id: string, dto: UpdateRepresentativeAppointmentDTO): Promise<RepresentativeAppointment> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { data, error } = await supabase
      .from('representative_appointments')
      .update({
        ...dto,
        updated_by: userId,
      })
      .eq('id', id)
      .select(`
        *,
        representative:representatives(*),
        calendar_event:calendar_events(id, title, start_at, event_type, client_id)
      `)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteAppointment(id: string): Promise<void> {
    const { error } = await supabase
      .from('representative_appointments')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // =====================================================
  // MÉTODOS AUXILIARES
  // =====================================================

  async markAsPaid(id: string, paymentData: {
    payment_date: string;
    payment_method: 'pix' | 'transferencia' | 'dinheiro' | 'cheque' | 'outro';
    payment_receipt?: string;
    payment_notes?: string;
  }): Promise<RepresentativeAppointment> {
    return this.updateAppointment(id, {
      payment_status: 'pago',
      ...paymentData,
    });
  }

  async updateServiceStatus(id: string, status: string): Promise<RepresentativeAppointment> {
    return this.updateAppointment(id, {
      service_status: status as any,
    });
  }

  // Estatísticas
  async getStats(filters?: { date_from?: string; date_to?: string }): Promise<{
    total_appointments: number;
    total_value: number;
    paid_value: number;
    pending_value: number;
    by_status: Record<string, number>;
    by_payment_status: Record<string, number>;
  }> {
    let query = supabase
      .from('representative_appointments')
      .select('service_value, service_status, payment_status');

    if (filters?.date_from) {
      query = query.gte('service_date', filters.date_from);
    }
    if (filters?.date_to) {
      query = query.lte('service_date', filters.date_to);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    const appointments = data || [];
    const stats = {
      total_appointments: appointments.length,
      total_value: 0,
      paid_value: 0,
      pending_value: 0,
      by_status: {} as Record<string, number>,
      by_payment_status: {} as Record<string, number>,
    };

    appointments.forEach((apt) => {
      const value = Number(apt.service_value) || 0;
      stats.total_value += value;

      if (apt.payment_status === 'pago') {
        stats.paid_value += value;
      } else if (apt.payment_status === 'pendente') {
        stats.pending_value += value;
      }

      stats.by_status[apt.service_status] = (stats.by_status[apt.service_status] || 0) + 1;
      stats.by_payment_status[apt.payment_status] = (stats.by_payment_status[apt.payment_status] || 0) + 1;
    });

    return stats;
  }
}

export const representativeService = new RepresentativeService();
