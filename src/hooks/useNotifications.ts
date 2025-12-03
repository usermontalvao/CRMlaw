import { useEffect, useState, useCallback } from 'react';
import { pushNotifications } from '../utils/pushNotifications';
import { notificationSound, NotificationSoundType } from '../utils/notificationSound';

export interface NotificationSettings {
  pushEnabled: boolean;
  soundEnabled: boolean;
  permission: NotificationPermission;
}

export function useNotifications() {
  const [settings, setSettings] = useState<NotificationSettings>({
    pushEnabled: false,
    soundEnabled: notificationSound.isEnabled(),
    permission: 'default',
  });

  const [isInitializing, setIsInitializing] = useState(false);

  // Atualiza o status de permissão
  const updatePermissionStatus = useCallback(() => {
    const permission = pushNotifications.getPermissionStatus();
    const pushEnabled = pushNotifications.isEnabled();
    
    setSettings((prev) => ({
      ...prev,
      permission,
      pushEnabled,
    }));
  }, []);

  // Inicializa o sistema de notificações
  useEffect(() => {
    const init = async () => {
      if (!pushNotifications.isSupported()) {
        console.warn('Push notifications não suportadas');
        return;
      }

      await pushNotifications.initialize();
      updatePermissionStatus();
    };

    init();
  }, [updatePermissionStatus]);

  // Solicita permissão para notificações
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setIsInitializing(true);
    try {
      const granted = await pushNotifications.requestPermission();
      updatePermissionStatus();
      return granted;
    } finally {
      setIsInitializing(false);
    }
  }, [updatePermissionStatus]);

  // Envia notificação com som
  const notify = useCallback(
    async (title: string, body: string, soundType: NotificationSoundType = 'default') => {
      if (settings.soundEnabled) {
        notificationSound.play(soundType);
      }

      if (settings.pushEnabled) {
        await pushNotifications.showNotification({
          title,
          body,
          requireInteraction: soundType === 'urgent',
          icon: '/icon-192x192.png',
          badge: '/icon-192x192.png',
        });
      } else if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/icon-192x192.png',
          badge: '/icon-192x192.png',
        });
      }
    },
    [settings.soundEnabled, settings.pushEnabled]
  );

  // Notifica sobre novo prazo
  const notifyDeadlineAssigned = useCallback(
    async (deadlineTitle: string, daysLeft: number) => {
      await notify(
        '🔔 Novo Prazo Atribuído',
        `Você foi designado para: ${deadlineTitle}\nVence em ${daysLeft} dias`,
        'urgent'
      );
    },
    [notify]
  );

  // Notifica sobre novo compromisso
  const notifyAppointmentAssigned = useCallback(
    async (appointmentTitle: string, dateTime: string) => {
      await notify(
        '📅 Novo Compromisso',
        `Você foi designado para: ${appointmentTitle}\n${dateTime}`,
        'default'
      );
    },
    [notify]
  );

  // Notifica sobre lembrete de prazo
  const notifyDeadlineReminder = useCallback(
    async (deadlineTitle: string, daysLeft: number) => {
      await notify(
        '⏰ Lembrete de Prazo',
        `${deadlineTitle}\nVence em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`,
        daysLeft <= 1 ? 'urgent' : 'info'
      );
    },
    [notify]
  );

  // Notifica sobre nova intimação
  const notifyNewIntimation = useCallback(
    async (processNumber: string) => {
      await notify(
        '📄 Nova Intimação DJEN',
        `Processo: ${processNumber}`,
        'urgent'
      );
    },
    [notify]
  );

  // Habilita/desabilita sons
  const toggleSound = useCallback(() => {
    if (settings.soundEnabled) {
      notificationSound.disable();
    } else {
      notificationSound.enable();
      notificationSound.test(); // Toca som de teste
    }
    
    setSettings((prev) => ({
      ...prev,
      soundEnabled: !prev.soundEnabled,
    }));
  }, [settings.soundEnabled]);

  // Testa notificação
  const testNotification = useCallback(async () => {
    await notify('🔔 Teste de Notificação', 'Sistema de notificações funcionando!', 'success');
  }, [notify]);

  return {
    settings,
    isInitializing,
    requestPermission,
    notify,
    notifyDeadlineAssigned,
    notifyAppointmentAssigned,
    notifyDeadlineReminder,
    notifyNewIntimation,
    toggleSound,
    testNotification,
  };
}
