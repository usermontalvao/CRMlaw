import { supabase } from '../config/supabase';
import type { UserNotification, CreateUserNotificationDTO } from '../types/user-notification.types';

class UserNotificationService {
  private tableName = 'user_notifications';

  /**
   * Lista notificações do usuário
   */
  async listNotifications(userId: string, unreadOnly: boolean = false): Promise<UserNotification[]> {
    let query = supabase
      .from(this.tableName)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao listar notificações:', error);
      throw new Error(error.message);
    }

    return data ?? [];
  }

  /**
   * Cria uma nova notificação para usuário
   */
  async createNotification(payload: CreateUserNotificationDTO): Promise<UserNotification> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        read: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar notificação:', error);
      throw new Error(error.message);
    }

    return data;
  }

  async createNotificationDeduped(params: {
    payload: CreateUserNotificationDTO;
    dedupeKey?: string;
  }): Promise<UserNotification | null> {
    try {
      const { payload, dedupeKey } = params;

      if (dedupeKey && payload.user_id && payload.type) {
        let query = supabase
          .from(this.tableName)
          .select('id')
          .eq('user_id', payload.user_id)
          .eq('type', payload.type)
          .eq('read', false)
          .limit(1);

        if (payload.process_id) {
          query = query.eq('process_id', payload.process_id);
        }

        query = query.filter('metadata->>dedupe_key', 'eq', dedupeKey);

        const { data } = await query;
        if (data && data.length > 0) {
          return null;
        }
      }
    } catch {
      // ignore
    }

    return this.createNotification({
      ...params.payload,
      metadata: {
        ...(params.payload.metadata || {}),
        ...(params.dedupeKey ? { dedupe_key: params.dedupeKey } : {}),
      },
    });
  }

  /**
   * Marca notificação como lida
   */
  async markAsRead(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ read: true })
      .eq('id', id);

    if (error) {
      console.error('Erro ao marcar notificação como lida:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Marca todas as notificações do usuário como lidas
   */
  async markAllAsRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      console.error('Erro ao marcar todas como lidas:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Conta notificações não lidas
   */
  async countUnread(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) {
      console.error('Erro ao contar não lidas:', error);
      return 0;
    }

    return count ?? 0;
  }

  /**
   * Deleta notificação
   */
  async deleteNotification(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar notificação:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Notifica usuário sobre novo prazo atribuído
   */
  async notifyDeadlineAssigned(params: {
    userId: string;
    deadlineId: string;
    deadlineTitle: string;
    assignedBy?: string;
  }): Promise<UserNotification> {
    return this.createNotification({
      user_id: params.userId,
      type: 'deadline_assigned',
      title: 'Novo prazo atribuído',
      message: `Você foi designado para o prazo: ${params.deadlineTitle}`,
      deadline_id: params.deadlineId,
      metadata: params.assignedBy ? { assigned_by: params.assignedBy } : null,
    });
  }

  /**
   * Notifica usuário sobre novo compromisso atribuído
   */
  async notifyAppointmentAssigned(params: {
    userId: string;
    appointmentId: string;
    appointmentTitle: string;
    assignedBy?: string;
  }): Promise<UserNotification> {
    return this.createNotification({
      user_id: params.userId,
      type: 'appointment_assigned',
      title: 'Novo compromisso atribuído',
      message: `Você foi designado para o compromisso: ${params.appointmentTitle}`,
      appointment_id: params.appointmentId,
      metadata: params.assignedBy ? { assigned_by: params.assignedBy } : null,
    });
  }

  /**
   * Notifica sobre lembrete de prazo
   */
  async notifyDeadlineReminder(params: {
    userId: string;
    deadlineId: string;
    deadlineTitle: string;
    daysLeft: number;
  }): Promise<UserNotification> {
    return this.createNotification({
      user_id: params.userId,
      type: 'deadline_reminder',
      title: 'Lembrete de prazo',
      message: `O prazo "${params.deadlineTitle}" vence em ${params.daysLeft} dia${params.daysLeft !== 1 ? 's' : ''}`,
      deadline_id: params.deadlineId,
    });
  }
}

export const userNotificationService = new UserNotificationService();
