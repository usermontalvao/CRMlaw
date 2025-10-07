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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/15 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        role="button"
        aria-label="Fechar notificações"
      />

      <div className="relative w-full max-w-md bg-white h-full sm:h-auto sm:max-h-[85vh] sm:mt-16 sm:mr-6 rounded-none sm:rounded-2xl shadow-2xl flex flex-col animate-slide-in-right">
        <div className="px-6 py-5 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">Notificações</h3>
            {unreadCount > 0 && (
              <p className="text-sm text-blue-100 mt-0.5">
                {unreadCount} não lida{unreadCount > 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition"
            aria-label="Fechar notificações"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {notifications.length > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <button
              onClick={onMarkAllAsRead}
              disabled={unreadCount === 0}
              className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <CheckCircle className="w-4 h-4" />
              Marcar todas como lidas
            </button>
            <span className="text-slate-300">•</span>
            <button
              onClick={onClearAll}
              className="text-xs font-semibold text-red-600 hover:text-red-700 transition"
            >
              Limpar tudo
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-slate-50">
          {loading ? (
            <div className="p-8 text-center">
              <div className="inline-block w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-3"></div>
              <p className="text-sm text-slate-600 font-medium">Carregando notificações...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-200 flex items-center justify-center">
                <Inbox className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 font-medium">Nenhuma notificação</p>
              <p className="text-xs text-slate-500 mt-1">Você está em dia!</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {notifications.map((notification) => {
                const config = categoryConfig[notification.category];
                const Icon = config?.icon ?? Inbox;

                return (
                  <div
                    key={notification.id}
                    className={`px-6 py-4 flex gap-4 transition-colors ${
                      notification.read
                        ? 'bg-white hover:bg-slate-50'
                        : 'bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-500'
                    }`}
                  >
                    <div className={`flex-none w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ${config?.color ?? 'text-slate-600 bg-slate-100'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1">
                          {config && (
                            <span className="inline-block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                              {config.label}
                            </span>
                          )}
                          <p className={`text-sm font-bold leading-snug ${notification.read ? 'text-slate-600' : 'text-slate-900'}`}>
                            {notification.title}
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 whitespace-nowrap font-medium">
                          {formatDateTime(notification.createdAt)}
                        </span>
                      </div>
                      {notification.description && (
                        <p className={`mt-1.5 text-xs leading-relaxed ${notification.read ? 'text-slate-500' : 'text-slate-700'}`}>
                          {notification.description}
                        </p>
                      )}

                      {!notification.read && (
                        <button
                          onClick={() => onMarkAsRead(notification.id)}
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 transition"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
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
