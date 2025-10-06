import type { NotificationItem, NotificationCategory } from '../types/notification.types';

const STORAGE_KEY = 'crm-notifications';

const getNowISO = () => new Date().toISOString();

const ensureArray = (value: unknown): NotificationItem[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NotificationItem =>
    typeof item === 'object' &&
    item !== null &&
    typeof item.id === 'string' &&
    typeof item.category === 'string' &&
    typeof item.title === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.read === 'boolean'
  );
};

const readStorage = (): NotificationItem[] => {
  if (typeof window === 'undefined') return [];

  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : [];
  return ensureArray(parsed);
};

const writeStorage = (items: NotificationItem[]) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

const seedNotifications = (): NotificationItem[] => {
  const seeded: NotificationItem[] = [
    {
      id: 'seed-deadline',
      category: 'deadline',
      title: 'Prazo importante vence amanhã',
      description: 'Processo 0001234-56.2023.8.26.0100 está com prazo para 06/10.',
      createdAt: getNowISO(),
      read: false,
    },
    {
      id: 'seed-hearing',
      category: 'hearing',
      title: 'Audiência confirmada',
      description: 'Audiência da ação trabalhista nº 0009876-12.2022.5.02.0001 confirmada para 12/10 às 14h.',
      createdAt: getNowISO(),
      read: false,
    },
    {
      id: 'seed-djen',
      category: 'djen',
      title: 'DJEN sincronizado com sucesso',
      description: 'Foram importadas 3 comunicações novas na última busca automática.',
      createdAt: getNowISO(),
      read: true,
    },
  ];

  writeStorage(seeded);
  return seeded;
};

const loadNotifications = (): NotificationItem[] => {
  const items = readStorage();
  return items
    .map((item) => ({
      ...item,
      category: item.category as NotificationCategory,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const notificationService = {
  async list(): Promise<NotificationItem[]> {
    return loadNotifications();
  },

  async add(notification: Omit<NotificationItem, 'id' | 'createdAt' | 'read'> & { id?: string; createdAt?: string; read?: boolean }): Promise<NotificationItem> {
    const items = loadNotifications();
    const newNotification: NotificationItem = {
      id: notification.id ?? crypto.randomUUID(),
      category: notification.category,
      title: notification.title,
      description: notification.description,
      createdAt: notification.createdAt ?? getNowISO(),
      read: notification.read ?? false,
      metadata: notification.metadata,
    };

    const updated = [newNotification, ...items];
    writeStorage(updated);
    return newNotification;
  },

  async markAsRead(id: string): Promise<void> {
    const items = loadNotifications();
    const updated = items.map((item) =>
      item.id === id ? { ...item, read: true } : item
    );
    writeStorage(updated);
  },

  async markAllAsRead(): Promise<void> {
    const items = loadNotifications().map((item) => ({ ...item, read: true }));
    writeStorage(items);
  },

  async clear(): Promise<void> {
    writeStorage([]);
  },
};
