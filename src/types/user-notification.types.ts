// Tipos para notificações individuais de usuários

export type UserNotificationType = 
  | 'deadline_assigned' 
  | 'appointment_assigned'
  | 'process_updated'
  | 'intimation_new'
  | 'deadline_reminder'
  | 'appointment_reminder';

export interface UserNotification {
  id: string;
  user_id: string;
  type: UserNotificationType;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  
  // Referências opcionais
  deadline_id?: string | null;
  appointment_id?: string | null;
  process_id?: string | null;
  intimation_id?: string | null;
  
  // Metadados
  metadata?: Record<string, any> | null;
}

export interface CreateUserNotificationDTO {
  user_id: string;
  type: UserNotificationType;
  title: string;
  message: string;
  deadline_id?: string | null;
  appointment_id?: string | null;
  process_id?: string | null;
  intimation_id?: string | null;
  metadata?: Record<string, any> | null;
}
