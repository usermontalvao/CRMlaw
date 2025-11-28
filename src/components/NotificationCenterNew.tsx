import React, { useEffect, useState, useMemo } from 'react';
import { Bell, X, Clock, Calendar, FileText, CheckCircle, Loader2, Check, CheckCheck } from 'lucide-react';
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
  isRead: boolean;
  data: any;
};

export const NotificationCenterNew: React.FC<NotificationCenterProps> = ({ onNavigateToModule }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'intimation' | 'deadline' | 'appointment'>('all');
  const [expandedNotifications, setExpandedNotifications] = useState<Set<string>>(new Set());
  const [isCompactMode, setIsCompactMode] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactMode(window.innerWidth < 520);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const [intimationsData, deadlinesData, appointmentsData] = await Promise.all([
        djenLocalService.listComunicacoes({ lida: false }),
        deadlineService.listDeadlines(),
        calendarService.listEvents(),
      ]);

      setIntimations(intimationsData);
      
      const now = new Date();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setDeadlines(deadlinesData.filter((d) => d.status === 'pendente' && new Date(d.due_date) <= sevenDaysFromNow));
      setAppointments(appointmentsData.filter((a) => {
        const eventDate = new Date(a.start_at);
        return eventDate >= now && eventDate <= sevenDaysFromNow;
      }));
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    const readIds = localStorage.getItem('read_notifications');
    if (readIds) setReadNotifications(new Set(JSON.parse(readIds)));
    const interval = setInterval(loadNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const notifications = useMemo((): NotificationItem[] => {
    const items: NotificationItem[] = [];

    intimations.forEach((int) => {
      const notifId = `intimation-${int.id}`;
      if (readNotifications.has(notifId) || int.lida) {
        return;
      }
      items.push({
        id: notifId,
        type: 'intimation',
        title: int.tipo_comunicacao || 'Nova Intimação',
        description: `Processo ${int.numero_processo_mascara || int.numero_processo}`,
        date: int.data_disponibilizacao,
        priority: 'urgent',
        isRead: false,
        data: int,
      });
    });

    deadlines.forEach((deadline) => {
      const daysUntil = Math.ceil((new Date(deadline.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `deadline-${deadline.id}`;
      if (readNotifications.has(notifId)) {
        return;
      }
      items.push({
        id: notifId,
        type: 'deadline',
        title: deadline.title,
        description: `Vence ${daysUntil <= 0 ? 'hoje' : `em ${daysUntil} dia${daysUntil !== 1 ? 's' : ''}`}`,
        date: deadline.due_date,
        priority: daysUntil <= 2 ? 'urgent' : daysUntil <= 5 ? 'high' : 'normal',
        isRead: false,
        data: deadline,
      });
    });

    appointments.forEach((appt) => {
      const startDate = new Date(appt.start_at);
      const notifId = `appointment-${appt.id}`;
      if (readNotifications.has(notifId)) {
        return;
      }
      items.push({
        id: notifId,
        type: 'appointment',
        title: appt.title,
        description: `${startDate.toLocaleDateString('pt-BR')} às ${startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        date: appt.start_at,
        priority: 'normal',
        isRead: false,
        data: appt,
      });
    });

    return items.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [intimations, deadlines, appointments, readNotifications]);

  const typeCounts = useMemo(
    () => ({
      all: notifications.length,
      intimation: notifications.filter((n) => n.type === 'intimation').length,
      deadline: notifications.filter((n) => n.type === 'deadline').length,
      appointment: notifications.filter((n) => n.type === 'appointment').length,
    }),
    [notifications]
  );

  const typeFiltered = typeFilter === 'all' ? notifications : notifications.filter((n) => n.type === typeFilter);
  const filteredNotifications = filter === 'unread' ? typeFiltered.filter((n) => !n.isRead) : typeFiltered;
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const getIcon = (type: NotificationItem['type'], priority: NotificationItem['priority']) => {
    const baseClass = 'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-semibold';
    if (type === 'intimation') return <div className={`${baseClass} bg-blue-500`}><FileText className="w-4 h-4" /></div>;
    if (type === 'deadline') {
      const urgent = priority === 'urgent';
      return <div className={`${baseClass} ${urgent ? 'bg-red-500' : 'bg-amber-500'}`}><Clock className="w-4 h-4" /></div>;
    }
    return <div className={`${baseClass} bg-purple-500`}><Calendar className="w-4 h-4" /></div>;
  };

  const markAsRead = async (notificationId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const newReadSet = new Set(readNotifications);
    newReadSet.add(notificationId);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));

    if (notificationId.startsWith('intimation-')) {
      const intimationId = notificationId.replace('intimation-', '');
      try {
        await djenLocalService.marcarComoLida(intimationId);
        setIntimations(prev => prev.filter(int => int.id !== intimationId));
      } catch (error) {
        console.error('Erro ao marcar intimação como lida:', error);
      }
    } else if (notificationId.startsWith('deadline-')) {
      const deadlineId = notificationId.replace('deadline-', '');
      setDeadlines(prev => prev.filter(deadline => deadline.id !== deadlineId));
    } else if (notificationId.startsWith('appointment-')) {
      const appointmentId = notificationId.replace('appointment-', '');
      setAppointments(prev => prev.filter(appointment => appointment.id !== appointmentId));
    }
  };

  const markAllAsRead = () => {
    const allIds = notifications.map(n => n.id);
    setReadNotifications(new Set(allIds));
    localStorage.setItem('read_notifications', JSON.stringify(allIds));
    setIntimations([]);
    setDeadlines([]);
    setAppointments([]);
    setExpandedNotifications(new Set());
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.isRead) await markAsRead(notification.id);
    setIsOpen(false);
    if (notification.type === 'intimation') onNavigateToModule?.('intimations');
    else if (notification.type === 'deadline') onNavigateToModule?.('prazos');
    else onNavigateToModule?.('calendar');
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const notifDate = new Date(date);
    const diff = now.getTime() - notifDate.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (minutes < 1) return 'Agora';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return notifDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const toggleExpanded = (id: string) => {
    setExpandedNotifications((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const typeTabs: { id: 'all' | 'intimation' | 'deadline' | 'appointment'; label: string; count: number }[] = [
    { id: 'all', label: 'Todos', count: typeCounts.all },
    { id: 'intimation', label: 'DJEN', count: typeCounts.intimation },
    { id: 'deadline', label: 'Prazos', count: typeCounts.deadline },
    { id: 'appointment', label: 'Agenda', count: typeCounts.appointment },
  ];

  const getTypeBadge = (notification: NotificationItem) => {
    const base = 'text-[11px] font-semibold px-2 py-0.5 rounded-full';
    switch (notification.type) {
      case 'intimation':
        return <span className={`${base} bg-blue-50 text-blue-700`}>DJEN</span>;
      case 'deadline':
        return <span className={`${base} bg-amber-50 text-amber-700`}>Prazo</span>;
      case 'appointment':
      default:
        return <span className={`${base} bg-purple-50 text-purple-700`}>Agenda</span>;
    }
  };

  const getPreviewText = (notification: NotificationItem, isExpanded: boolean) => {
    if (isExpanded) return notification.description;
    if (notification.description.length <= 110) return notification.description;
    return `${notification.description.slice(0, 110)}...`;
  };

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)} className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className={`${
              isCompactMode
                ? 'fixed left-4 right-4 top-20 w-auto max-h-[85vh]'
                : 'absolute right-0 top-full mt-2 w-[380px] max-h-[80vh]'
            } bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden flex flex-col`}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Notificações</h3>
                <p className="text-xs text-slate-500">{unreadCount === 0 ? 'Nenhum alerta novo' : `${unreadCount} novas`}</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition" aria-label="Fechar">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-slate-100 text-xs font-semibold">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-full transition ${filter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Todas
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-3 py-1 rounded-full transition ${filter === 'unread' ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Não lidas
              </button>
              {filteredNotifications.length > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="ml-auto flex items-center gap-1 text-blue-600 hover:text-blue-700"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Marcar todas
                </button>
              )}
            </div>

            <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-slate-100 text-[11px] font-semibold text-slate-600">
              {typeTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setTypeFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-full transition flex items-center gap-1 justify-center ${
                    typeFilter === tab.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="text-[10px] opacity-80">{tab.count}</span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
                  <p className="text-slate-600 text-sm">Carregando...</p>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center mb-4">
                    <CheckCircle className="w-8 h-8 text-blue-600" />
                  </div>
                  <h4 className="text-base font-semibold text-slate-900 mb-1">{filter === 'unread' ? 'Tudo lido!' : 'Nada por aqui'}</h4>
                  <p className="text-sm text-slate-500">{filter === 'unread' ? 'Você não tem notificações não lidas' : 'Sem notificações no momento'}</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className="relative flex gap-3 pl-5 pr-4 py-3 hover:bg-slate-50 transition cursor-pointer"
                    >
                      <span
                        className={`pointer-events-none absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${
                          notification.priority === 'urgent' ? 'bg-red-500/80' : 'bg-blue-500/60'
                        }`}
                      />
                      {getIcon(notification.type, notification.priority)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900 leading-tight">
                                {notification.title}
                              </p>
                              {getTypeBadge(notification)}
                              {notification.priority === 'urgent' && (
                                <span className="text-[11px] font-semibold text-red-600">Urgente</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-600">
                              {getPreviewText(notification, expandedNotifications.has(notification.id))}
                              {notification.description.length > 110 && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleExpanded(notification.id);
                                  }}
                                  className="ml-1 text-[11px] font-semibold text-blue-600 hover:underline"
                                >
                                  {expandedNotifications.has(notification.id) ? 'ver menos' : 'ver mais'}
                                </button>
                              )}
                            </p>
                          </div>
                          <button
                            onClick={(e) => markAsRead(notification.id, e)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition"
                            title="Marcar como lida"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {formatTimeAgo(notification.date)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {filteredNotifications.length > 0 && (
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-center">
                <button onClick={() => { setIsOpen(false); onNavigateToModule?.('notifications'); }} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                  Ver todas
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
