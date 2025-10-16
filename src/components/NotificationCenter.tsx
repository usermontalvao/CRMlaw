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
  ChevronDown,
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['intimation', 'deadline', 'appointment']));

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

  // Agrupar notificações por tipo
  const groupedNotifications = useMemo(() => {
    const groups: Record<string, NotificationItem[]> = {
      intimation: [],
      deadline: [],
      appointment: [],
    };

    // Intimações
    intimations.forEach((int) => {
      groups.intimation.push({
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
      groups.deadline.push({
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
      groups.appointment.push({
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

    return groups;
  }, [intimations, deadlines, appointments, readNotifications]);

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
    
    // Se for intimação, marcar no banco
    if (notificationId.startsWith('intimation-')) {
      const intimationId = notificationId.replace('intimation-', '');
      try {
        await djenLocalService.marcarComoLida(intimationId);
        // Atualizar estado local
        setIntimations(prev => prev.map(int => 
          int.id === intimationId ? { ...int, lida: true } : int
        ));
      } catch (error) {
        console.error('Erro ao marcar intimação como lida:', error);
      }
    }
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    // Marca como lida automaticamente ao clicar
    if (!readNotifications.has(notification.id)) {
      const newReadSet = new Set(readNotifications);
      newReadSet.add(notification.id);
      setReadNotifications(newReadSet);
      localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
      
      // Se for intimação, marcar no banco
      if (notification.type === 'intimation') {
        const intimationId = notification.id.replace('intimation-', '');
        try {
          await djenLocalService.marcarComoLida(intimationId);
          setIntimations(prev => prev.map(int => 
            int.id === intimationId ? { ...int, lida: true } : int
          ));
        } catch (error) {
          console.error('Erro ao marcar intimação como lida:', error);
        }
      }
    }
    
    setIsOpen(false);
    
    switch (notification.type) {
      case 'intimation':
        onNavigateToModule?.('intimations');
        break;
      case 'deadline':
        onNavigateToModule?.('prazos');
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

      {/* Modal/Dropdown de notificações */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-[9999] md:relative md:inset-auto md:z-auto">
            {/* Backdrop - apenas mobile */}
            <div
              className="fixed inset-0 bg-black/50 z-[9998] md:hidden"
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <div className="fixed inset-x-0 top-0 bottom-0 md:absolute md:right-0 md:top-full md:left-auto md:inset-x-auto md:bottom-auto md:mt-2 w-full md:w-[420px] h-full md:h-auto md:max-h-[85vh] bg-white md:rounded-2xl shadow-2xl md:shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-0 z-[9999] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-4 md:px-6 py-4 md:py-4 bg-white border-b border-gray-100 flex items-center justify-between flex-shrink-0 safe-area-top">
              <h3 className="text-xl md:text-2xl font-bold text-slate-900">
                Notificações
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
              >
                <X className="w-6 h-6 md:w-5 md:h-5" />
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
                <div className="divide-y divide-gray-100">
                  {/* Grupos de notificações */}
                  {Object.entries(groupedNotifications).map(([type, items]) => {
                    if (items.length === 0) return null;
                    
                    const isExpanded = expandedGroups.has(type);
                    const unreadInGroup = items.filter(n => !n.read).length;
                    const Icon = getNotificationIcon(type as any);
                    const typeLabel = type === 'intimation' ? 'Intimações' : type === 'deadline' ? 'Prazos' : 'Compromissos';
                    
                    return (
                      <div key={type}>
                        {/* Header do grupo - CLIQUE AQUI PARA EXPANDIR */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Clicou no grupo:', type, 'Expandido:', isExpanded);
                            const newExpanded = new Set(expandedGroups);
                            if (isExpanded) {
                              newExpanded.delete(type);
                              console.log('Recolhendo grupo:', type);
                            } else {
                              newExpanded.add(type);
                              console.log('Expandindo grupo:', type);
                            }
                            setExpandedGroups(newExpanded);
                            console.log('Novos grupos expandidos:', Array.from(newExpanded));
                          }}
                          className="w-full p-4 bg-gradient-to-r from-slate-50 to-slate-100 hover:from-slate-100 hover:to-slate-200 transition-all flex items-center justify-between border-b-2 border-slate-200"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
                              <Icon className="w-5 h-5" />
                            </div>
                            <div className="text-left">
                              <h4 className="text-sm font-bold text-slate-900">{typeLabel}</h4>
                              <p className="text-xs text-slate-600 font-medium">{items.length} {items.length === 1 ? 'notificação' : 'notificações'} • Clique para {isExpanded ? 'recolher' : 'expandir'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {unreadInGroup > 0 && (
                              <span className="bg-blue-600 text-white text-xs font-bold rounded-full min-w-[1.5rem] h-6 px-2 flex items-center justify-center shadow-md">
                                {unreadInGroup}
                              </span>
                            )}
                            <div className={`p-1.5 rounded-full transition-colors ${isExpanded ? 'bg-indigo-100' : 'bg-slate-200'}`}>
                              {isExpanded ? <ChevronDown className="w-5 h-5 text-indigo-600" /> : <ChevronRight className="w-5 h-5 text-slate-600" />}
                            </div>
                          </div>
                        </button>
                        
                        {/* Itens expandidos */}
                        {isExpanded && (
                          <div className="divide-y divide-gray-50 bg-white">
                            {items.map((notification) => {
                              const isRead = notification.read || false;
                              return (
                                <div
                                  key={notification.id}
                                  onClick={() => handleNotificationClick(notification)}
                                  className={`relative group cursor-pointer transition-all p-4 pl-16 ${
                                    isRead ? 'bg-white hover:bg-slate-50' : 'bg-blue-50/30 hover:bg-blue-100/50'
                                  }`}
                                >
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
                              );
                            })}
                          </div>
                        )}
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
          </div>
        </>
      )}
    </div>
  );
};
