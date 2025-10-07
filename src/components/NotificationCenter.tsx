import React, { useEffect, useState, useMemo } from 'react';
import {
  Bell,
  X,
  Clock,
  Calendar,
  FileText,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Check,
  Eye,
} from 'lucide-react';
import { djenLocalService } from '../services/djenLocal.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { Deadline } from '../types/deadline.types';
import type { CalendarEvent } from '../types/calendar.types';

interface NotificationCenterProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

type NotificationItem = {
  id: string;
  type: 'intimation' | 'deadline' | 'appointment';
  title: string;
  description: string;
  date: string;
  priority: 'urgent' | 'high' | 'normal';
  unread: boolean;
  data: any;
  read?: boolean;
};

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ onNavigateToModule }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [hasViewed, setHasViewed] = useState(false);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());

  // Carregar dados
  const loadNotifications = async () => {
    try {
      setLoading(true);
      const [intimationsData, deadlinesData, appointmentsData] = await Promise.all([
        djenLocalService.listComunicacoes({ lida: false }),
        deadlineService.listDeadlines(),
        calendarService.listEvents(),
      ]);

      setIntimations(intimationsData);
      
      // Filtrar apenas prazos pendentes e próximos (7 dias)
      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setDeadlines(
        deadlinesData.filter(
          (d) =>
            d.status === 'pendente' &&
            new Date(d.due_date) <= sevenDaysFromNow
        )
      );

      // Filtrar compromissos dos próximos 7 dias
      setAppointments(
        appointmentsData.filter((a) => {
          const eventDate = new Date(a.start_at);
          return eventDate >= now && eventDate <= sevenDaysFromNow;
        })
      );
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    
    // Verificar se foi visualizado previamente
    const viewedState = localStorage.getItem('notifications_viewed');
    if (viewedState === 'true') {
      setHasViewed(true);
    }
    
    // Carregar notificações lidas
    const readIds = localStorage.getItem('read_notifications');
    if (readIds) {
      setReadNotifications(new Set(JSON.parse(readIds)));
    }
    
    // Recarregar a cada 5 minutos
    const interval = setInterval(loadNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Verificar se há novas notificações desde a última visualização
  useEffect(() => {
    const lastViewedCount = localStorage.getItem('notifications_last_count');
    const currentCount = intimations.length + deadlines.length + appointments.length;
    
    if (lastViewedCount && parseInt(lastViewedCount, 10) < currentCount) {
      // Novas notificações chegaram, mostrar badge novamente
      setHasViewed(false);
      localStorage.setItem('notifications_viewed', 'false');
    }
  }, [intimations, deadlines, appointments]);

  // Transformar dados em notificações unificadas
  const notifications = useMemo((): NotificationItem[] => {
    const items: NotificationItem[] = [];

    // Intimações
    intimations.forEach((int) => {
      items.push({
        id: `intimation-${int.id}`,
        type: 'intimation',
        title: `Nova Intimação - ${int.tipo_comunicacao || 'DJEN'}`,
        description: `Processo ${int.numero_processo_mascara || int.numero_processo}`,
        date: int.data_disponibilizacao,
        priority: 'urgent',
        unread: !int.lida,
        data: int,
      });
    });

    // Prazos
    deadlines.forEach((deadline) => {
      const daysUntil = Math.ceil(
        (new Date(deadline.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const notifId = `deadline-${deadline.id}`;
      items.push({
        id: notifId,
        type: 'deadline',
        title: deadline.title,
        description: `Vence em ${daysUntil} dia${daysUntil !== 1 ? 's' : ''}`,
        date: deadline.due_date,
        priority: daysUntil <= 2 ? 'urgent' : daysUntil <= 5 ? 'high' : 'normal',
        unread: true,
        data: deadline,
        read: readNotifications.has(notifId),
      });
    });

    // Compromissos
    appointments.forEach((appt) => {
      const startDate = new Date(appt.start_at);
      const notifId = `appointment-${appt.id}`;
      items.push({
        id: notifId,
        type: 'appointment',
        title: appt.title,
        description: `${startDate.toLocaleDateString('pt-BR')} às ${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        date: appt.start_at,
        priority: 'normal',
        unread: true,
        data: appt,
        read: readNotifications.has(notifId),
      });
    });

    // Ordenar por prioridade e data
    return items.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [intimations, deadlines, appointments]);

  const unreadCount = notifications.filter((n) => n.unread).length;

  const getNotificationIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'intimation':
        return FileText;
      case 'deadline':
        return Clock;
      case 'appointment':
        return Calendar;
    }
  };

  const markAsRead = async (notificationId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const newReadSet = new Set(readNotifications);
    newReadSet.add(notificationId);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    // Marca como lida automaticamente ao clicar
    if (!readNotifications.has(notification.id)) {
      const newReadSet = new Set(readNotifications);
      newReadSet.add(notification.id);
      setReadNotifications(newReadSet);
      localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
    }
    
    setIsOpen(false);
    
    switch (notification.type) {
      case 'intimation':
        onNavigateToModule?.('intimations');
        break;
      case 'deadline':
        onNavigateToModule?.('deadlines');
        break;
      case 'appointment':
        onNavigateToModule?.('calendar');
        break;
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    // Marcar como visualizado
    setHasViewed(true);
    localStorage.setItem('notifications_viewed', 'true');
    const currentCount = intimations.length + deadlines.length + appointments.length;
    localStorage.setItem('notifications_last_count', currentCount.toString());
  };

  return (
    <div className="relative">
      {/* Botão do sino */}
      <button
        onClick={handleOpen}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && !hasViewed && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown de notificações */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="absolute right-0 top-full mt-2 w-[420px] max-h-[85vh] bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-0 z-50 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 bg-white border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-2xl font-bold text-slate-900">
                Notificações
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
                  <p className="text-slate-600 text-sm">Carregando notificações...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center mb-4">
                    <CheckCircle className="w-10 h-10 text-indigo-500" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Você está em dia!</h4>
                  <p className="text-slate-500 text-sm">Sem novas notificações</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {notifications.map((notification) => {
                    const Icon = getNotificationIcon(notification.type);
                    const isRead = notification.read || false;
                    return (
                      <div
                        key={notification.id}
                        className={`relative group cursor-pointer transition-all ${
                          isRead ? 'bg-white hover:bg-slate-50' : 'bg-blue-50/30 hover:bg-blue-50/50'
                        }`}
                      >
                        <div
                          onClick={() => handleNotificationClick(notification)}
                          className="p-4"
                        >
                          <div className="flex items-start gap-3">
                            {/* Ícone */}
                            <div className="relative flex-shrink-0">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                notification.priority === 'urgent' && !isRead
                                  ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30'
                                  : notification.priority === 'high' && !isRead
                                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
                                  : !isRead
                                  ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                  : 'bg-gray-200 text-gray-600'
                              }`}>
                                <Icon className="w-5 h-5" />
                              </div>
                              {!isRead && (
                                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></div>
                              )}
                            </div>

                            {/* Conteúdo */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <h4 className={`text-sm leading-tight ${
                                  isRead ? 'font-normal text-gray-700' : 'font-semibold text-slate-900'
                                }`}>
                                  {notification.title}
                                </h4>
                                {!isRead && (
                                  <button
                                    onClick={(e) => markAsRead(notification.id, e)}
                                    className="p-1.5 hover:bg-blue-100 rounded-full transition opacity-0 group-hover:opacity-100 flex-shrink-0"
                                    title="Marcar como lido"
                                  >
                                    <Check className="w-3.5 h-3.5 text-blue-600" />
                                  </button>
                                )}
                              </div>
                              <p className={`text-xs leading-relaxed mb-2 ${
                                isRead ? 'text-gray-500' : 'text-slate-600'
                              }`}>
                                {notification.description}
                              </p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-blue-600">
                                  {(() => {
                                    const date = new Date(notification.date);
                                    const now = new Date();
                                    const diff = now.getTime() - date.getTime();
                                    const minutes = Math.floor(diff / 60000);
                                    const hours = Math.floor(minutes / 60);
                                    const days = Math.floor(hours / 24);
                                    
                                    if (minutes < 1) return 'Agora';
                                    if (minutes < 60) return `${minutes}m`;
                                    if (hours < 24) return `${hours}h`;
                                    if (days < 7) return `${days}d`;
                                    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
                                  })()}
                                </span>
                                {notification.priority === 'urgent' && !isRead && (
                                  <span className="text-xs font-semibold text-red-600">
                                    • Urgente
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer com link para central */}
            {notifications.length > 0 && (
              <div className="p-4 bg-white border-t border-gray-100">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onNavigateToModule?.('notifications');
                  }}
                  className="w-full py-3 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  Ver todas as notificações
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
