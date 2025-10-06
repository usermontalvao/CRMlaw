import { X, AlarmClock, Gavel, Newspaper, BellRing, CheckCircle, Inbox } from 'lucide-react';
import { useMemo } from 'react';
import type { NotificationItem } from '../types/notification.types';

interface NotificationPanelProps {
  open: boolean;
  notifications: NotificationItem[];
  loading?: boolean;
  onClose: () => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
}

const categoryConfig = {
  deadline: {
    label: 'Prazos',
    icon: AlarmClock,
    color: 'text-amber-600 bg-amber-100',
  },
  hearing: {
    label: 'Audiências',
    icon: Gavel,
    color: 'text-purple-600 bg-purple-100',
  },
  djen: {
    label: 'DJEN',
    icon: Newspaper,
    color: 'text-blue-600 bg-blue-100',
  },
  intimation: {
    label: 'Intimações',
    icon: BellRing,
    color: 'text-emerald-600 bg-emerald-100',
  },
  system: {
    label: 'Sistema',
    icon: Inbox,
    color: 'text-slate-600 bg-slate-100',
  },
} as const;

const formatDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch (error) {
    return iso;
  }
};

export function NotificationPanel({
  open,
  notifications,
  loading,
  onClose,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAll,
}: NotificationPanelProps) {
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        role="button"
        aria-label="Fechar notificações"
      />

      <div className="pointer-events-auto w-full max-w-md bg-white h-full sm:h-auto sm:max-h-[80vh] sm:mt-20 sm:mr-6 rounded-none sm:rounded-2xl shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Notificações</h3>
            <p className="text-xs text-slate-500">{unreadCount} não lida(s)</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition"
            aria-label="Fechar notificações"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
          <button
            onClick={onMarkAllAsRead}
            className="inline-flex items-center gap-2 text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            <CheckCircle className="w-4 h-4" />
            Marcar todas como lidas
          </button>
          <span className="text-slate-300">•</span>
          <button
            onClick={onClearAll}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Limpar tudo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-500">Carregando notificações...</div>
          ) : notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">Nenhuma notificação no momento.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map((notification) => {
                const config = categoryConfig[notification.category];
                const Icon = config?.icon ?? Inbox;

                return (
                  <div key={notification.id} className="px-5 py-4 flex gap-3">
                    <div className={`flex-none w-10 h-10 rounded-full flex items-center justify-center ${config?.color ?? 'text-slate-600 bg-slate-100'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {config && (
                            <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                              {config.label}
                            </span>
                          )}
                          <p className={`text-sm font-semibold ${notification.read ? 'text-slate-600' : 'text-slate-900'}`}>
                            {notification.title}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </div>
                      {notification.description && (
                        <p className={`mt-1 text-xs ${notification.read ? 'text-slate-400' : 'text-slate-600'}`}>
                          {notification.description}
                        </p>
                      )}

                      {!notification.read && (
                        <button
                          onClick={() => onMarkAsRead(notification.id)}
                          className="mt-2 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                        >
                          Marcar como lida
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
