// Gerenciamento de Push Notifications

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  requireInteraction?: boolean;
  silent?: boolean;
}

class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;

  /**
   * Verifica se o navegador suporta notificações
   */
  isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  /**
   * Obtém o status de permissão atual
   */
  getPermissionStatus(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  /**
   * Verifica se as notificações estão habilitadas
   */
  isEnabled(): boolean {
    return this.getPermissionStatus() === 'granted';
  }

  /**
   * Solicita permissão para notificações
   */
  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('Notificações push não são suportadas neste navegador');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('Erro ao solicitar permissão de notificação:', error);
      return false;
    }
  }

  /**
   * Registra o service worker
   */
  async registerServiceWorker(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker não é suportado');
      return false;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registrado com sucesso');
      return true;
    } catch (error) {
      console.error('Erro ao registrar Service Worker:', error);
      return false;
    }
  }

  /**
   * Envia uma notificação local
   */
  async showNotification(payload: PushNotificationPayload): Promise<void> {
    if (!this.isEnabled()) {
      console.warn('Notificações não estão habilitadas');
      return;
    }

    try {
      // Se temos service worker, usa ele
      if (this.registration) {
        await this.registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon || '/logo192.png',
          badge: payload.badge || '/favicon.ico',
          tag: payload.tag,
          data: payload.data,
          requireInteraction: payload.requireInteraction || false,
          silent: payload.silent || false,
        });
      } else {
        // Fallback para notificação direta
        new Notification(payload.title, {
          body: payload.body,
          icon: payload.icon || '/logo192.png',
          tag: payload.tag,
          data: payload.data,
          requireInteraction: payload.requireInteraction || false,
          silent: payload.silent || false,
        });
      }
    } catch (error) {
      console.error('Erro ao mostrar notificação:', error);
    }
  }

  /**
   * Notifica sobre novo prazo atribuído
   */
  async notifyDeadlineAssigned(deadlineTitle: string, daysLeft: number) {
    await this.showNotification({
      title: '🔔 Novo Prazo Atribuído',
      body: `Você foi designado para: ${deadlineTitle}\nVence em ${daysLeft} dias`,
      tag: 'deadline-assigned',
      requireInteraction: true,
    });
  }

  /**
   * Notifica sobre novo compromisso atribuído
   */
  async notifyAppointmentAssigned(appointmentTitle: string, dateTime: string) {
    await this.showNotification({
      title: '📅 Novo Compromisso',
      body: `Você foi designado para: ${appointmentTitle}\n${dateTime}`,
      tag: 'appointment-assigned',
      requireInteraction: true,
    });
  }

  /**
   * Notifica sobre prazo próximo do vencimento
   */
  async notifyDeadlineReminder(deadlineTitle: string, daysLeft: number) {
    await this.showNotification({
      title: '⏰ Lembrete de Prazo',
      body: `${deadlineTitle}\nVence em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`,
      tag: 'deadline-reminder',
      requireInteraction: daysLeft <= 1,
    });
  }

  /**
   * Notifica sobre nova intimação DJEN
   */
  async notifyNewIntimation(processNumber: string) {
    await this.showNotification({
      title: '📄 Nova Intimação DJEN',
      body: `Processo: ${processNumber}`,
      tag: 'intimation-new',
      requireInteraction: true,
    });
  }

  /**
   * Limpa todas as notificações
   */
  async clearAllNotifications() {
    if (!this.registration) return;

    try {
      const notifications = await this.registration.getNotifications();
      notifications.forEach((notification) => notification.close());
    } catch (error) {
      console.error('Erro ao limpar notificações:', error);
    }
  }

  /**
   * Inicializa o serviço de push notifications
   */
  async initialize(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    // Registra service worker
    await this.registerServiceWorker();

    // Verifica se já tem permissão
    if (this.getPermissionStatus() === 'default') {
      // Não solicita automaticamente, deixa para o usuário decidir
      return false;
    }

    return this.isEnabled();
  }
}

export const pushNotifications = new PushNotificationService();
