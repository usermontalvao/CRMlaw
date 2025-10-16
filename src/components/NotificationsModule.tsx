import React, { useEffect, useState, useMemo } from 'react';
import {
  Bell,
  Clock,
  Calendar,
  FileText,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Check,
  Eye,
  Filter,
  Search,
  CheckCheck,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { djenLocalService } from '../services/djenLocal.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { Deadline } from '../types/deadline.types';
import type { CalendarEvent } from '../types/calendar.types';

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

interface NotificationsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

const NotificationsModule: React.FC<NotificationsModuleProps> = ({ onNavigateToModule }) => {
  const [loading, setLoading] = useState(false);
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'intimation' | 'deadline' | 'appointment'>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | 'urgent' | 'high' | 'normal'>('all');
  const [showReadOnly, setShowReadOnly] = useState(false);

  // Carregar dados
  const loadNotifications = async () => {
    try {
      setLoading(true);
      const [intimationsData, deadlinesData, appointmentsData] = await Promise.all([
        djenLocalService.listComunicacoes(),
        deadlineService.listDeadlines(),
        calendarService.listEvents(),
      ]);

      setIntimations(intimationsData);
      
      // Filtrar prazos pendentes
      setDeadlines(
        deadlinesData.filter((d) => d.status === 'pendente')
      );

      // Filtrar compromissos futuros
      const now = new Date();
      setAppointments(
        appointmentsData.filter((a) => {
          const eventDate = new Date(a.start_at);
          return eventDate >= now;
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
    
    // Carregar notificações lidas
    const readIds = localStorage.getItem('read_notifications');
    if (readIds) {
      setReadNotifications(new Set(JSON.parse(readIds)));
    }
  }, []);

  // Transformar dados em notificações
  const allNotifications = useMemo((): NotificationItem[] => {
    const items: NotificationItem[] = [];

    // Intimações
    intimations.forEach((int) => {
      items.push({
        id: `intimation-${int.id}`,
        type: 'intimation',
        title: `${int.tipo_comunicacao || 'Intimação'} - Processo ${int.numero_processo_mascara || int.numero_processo}`,
        description: int.texto?.substring(0, 150) || '',
        date: int.data_disponibilizacao,
        priority: 'urgent',
        unread: !int.lida,
        data: int,
        read: int.lida,
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
      // Primeiro, não lidas
      if (a.read !== b.read) {
        return a.read ? 1 : -1;
      }
      // Depois por prioridade
      const priorityOrder = { urgent: 0, high: 1, normal: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      // Por último por data
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [intimations, deadlines, appointments, readNotifications]);

  // Aplicar filtros
  const filteredNotifications = useMemo(() => {
    return allNotifications.filter((notif) => {
      // Filtro de tipo
      if (filterType !== 'all' && notif.type !== filterType) {
        return false;
      }
      
      // Filtro de prioridade
      if (filterPriority !== 'all' && notif.priority !== filterPriority) {
        return false;
      }
      
      // Filtro de lidas
      if (showReadOnly && !notif.read) {
        return false;
      }
      if (!showReadOnly && notif.read) {
        return false;
      }
      
      // Busca
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          notif.title.toLowerCase().includes(search) ||
          notif.description.toLowerCase().includes(search)
        );
      }
      
      return true;
    });
  }, [allNotifications, filterType, filterPriority, showReadOnly, searchTerm]);

  const stats = useMemo(() => {
    const unreadCount = allNotifications.filter((n) => !n.read).length;
    const urgentCount = allNotifications.filter((n) => n.priority === 'urgent' && !n.read).length;
    const intimationsCount = intimations.filter((i) => !i.lida).length;
    const deadlinesCount = deadlines.filter((d) => {
      const notifId = `deadline-${d.id}`;
      return !readNotifications.has(notifId);
    }).length;
    const appointmentsCount = appointments.filter((a) => {
      const notifId = `appointment-${a.id}`;
      return !readNotifications.has(notifId);
    }).length;
    
    return {
      total: allNotifications.length,
      unread: unreadCount,
      urgent: urgentCount,
      intimations: intimationsCount,
      deadlines: deadlinesCount,
      appointments: appointmentsCount,
    };
  }, [allNotifications, intimations, deadlines, appointments, readNotifications]);

  const markAsRead = async (notificationId: string) => {
    const newReadSet = new Set(readNotifications);
    newReadSet.add(notificationId);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
    
    // Se for intimação, marcar no banco sem recarregar
    if (notificationId.startsWith('intimation-')) {
      const intimationId = notificationId.replace('intimation-', '');
      try {
        await djenLocalService.marcarComoLida(intimationId);
        // Atualizar estado local da intimação
        setIntimations(prev => prev.map(int => 
          int.id === intimationId ? { ...int, lida: true } : int
        ));
      } catch (error) {
        console.error('Erro ao marcar intimação como lida:', error);
      }
    }
  };

  const markAllAsRead = async () => {
    const allIds = allNotifications.map((n) => n.id);
    const newReadSet = new Set([...readNotifications, ...allIds]);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
    
    // Marcar intimações como lidas sem recarregar
    const intimationsToMark = intimations.filter(int => !int.lida);
    for (const int of intimationsToMark) {
      try {
        await djenLocalService.marcarComoLida(int.id);
      } catch (error) {
        console.error('Erro ao marcar intimação como lida:', error);
      }
    }
    
    // Atualizar estado local
    setIntimations(prev => prev.map(int => ({ ...int, lida: true })));
  };

  const clearAllRead = () => {
    if (confirm('Deseja limpar todas as notificações lidas?')) {
      setReadNotifications(new Set());
      localStorage.setItem('read_notifications', JSON.stringify([]));
      loadNotifications();
    }
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    // Marcar como lida sem recarregar
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    
    // Navegar para o módulo
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

  const getNotificationColor = (priority: NotificationItem['priority'], isRead: boolean) => {
    if (isRead) {
      return 'border-l-4 border-gray-300 bg-white';
    }
    switch (priority) {
      case 'urgent':
        return 'border-l-4 border-red-500 bg-red-50/50';
      case 'high':
        return 'border-l-4 border-orange-500 bg-orange-50/50';
      default:
        return 'border-l-4 border-indigo-500 bg-indigo-50/50';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header com estatísticas */}
      <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <Bell className="w-7 h-7" />
              Central de Notificações
            </h1>
            <p className="text-slate-300 text-sm mt-1">Gerencie todas as suas notificações em um só lugar</p>
          </div>
          <button
            onClick={loadNotifications}
            disabled={loading}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-lg transition"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-6">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-xs text-slate-300 mt-1">Total</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-300">{stats.unread}</div>
            <div className="text-xs text-slate-300 mt-1">Não Lidas</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold text-red-300">{stats.urgent}</div>
            <div className="text-xs text-slate-300 mt-1">Urgentes</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold text-red-300">{stats.intimations}</div>
            <div className="text-xs text-slate-300 mt-1">Intimações</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold text-orange-300">{stats.deadlines}</div>
            <div className="text-xs text-slate-300 mt-1">Prazos</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
            <div className="text-3xl font-bold text-indigo-300">{stats.appointments}</div>
            <div className="text-xs text-slate-300 mt-1">Compromissos</div>
          </div>
        </div>
      </div>

      {/* Filtros e ações */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Busca */}
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar notificações..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Filtro de tipo */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">Todos os tipos</option>
            <option value="intimation">Intimações</option>
            <option value="deadline">Prazos</option>
            <option value="appointment">Compromissos</option>
          </select>

          {/* Filtro de prioridade */}
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as any)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="all">Todas prioridades</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="normal">Normal</option>
          </select>

          {/* Toggle lidas */}
          <button
            onClick={() => setShowReadOnly(!showReadOnly)}
            className={`px-4 py-2.5 rounded-lg font-medium transition ${
              showReadOnly
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {showReadOnly ? 'Mostrar não lidas' : 'Mostrar lidas'}
          </button>
        </div>

        {/* Ações em massa */}
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={markAllAsRead}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition"
          >
            <CheckCheck className="w-4 h-4" />
            Marcar todas como lidas
          </button>
          <button
            onClick={clearAllRead}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-slate-700 hover:bg-slate-50 font-medium rounded-lg transition"
          >
            <Trash2 className="w-4 h-4" />
            Limpar lidas
          </button>
        </div>
      </div>

      {/* Lista de notificações */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-3" />
            <p className="text-slate-600">Carregando notificações...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Bell className="w-10 h-10 text-slate-400" />
            </div>
            <h4 className="text-lg font-bold text-slate-900 mb-2">Nenhuma notificação encontrada</h4>
            <p className="text-slate-600 text-sm">Ajuste os filtros ou adicione novas notificações</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredNotifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              const isRead = notification.read || false;

              return (
                <div
                  key={notification.id}
                  className={`relative group hover:shadow-md cursor-pointer transition-all duration-200 ${getNotificationColor(notification.priority, isRead)}`}
                >
                  <div
                    onClick={() => handleNotificationClick(notification)}
                    className="p-5"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl shadow-sm ${
                        notification.priority === 'urgent' && !isRead
                          ? 'bg-red-500 text-white'
                          : notification.priority === 'high' && !isRead
                          ? 'bg-orange-500 text-white'
                          : !isRead
                          ? 'bg-indigo-500 text-white'
                          : 'bg-gray-300 text-gray-600'
                      }`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className={`text-base font-bold ${isRead ? 'text-gray-600' : 'text-slate-900'}`}>
                            {notification.title}
                          </h4>
                          {!isRead && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                await markAsRead(notification.id);
                              }}
                              className="p-2 hover:bg-slate-200 rounded-lg transition opacity-0 group-hover:opacity-100"
                              title="Marcar como lido"
                            >
                              <Check className="w-5 h-5 text-emerald-600" />
                            </button>
                          )}
                        </div>
                        <p className={`text-sm mb-3 ${isRead ? 'text-gray-500' : 'text-slate-700'}`}>
                          {notification.description}
                        </p>
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(notification.date).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                          {notification.priority === 'urgent' && !isRead && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-100 px-3 py-1 rounded-full">
                              <AlertTriangle className="w-3 h-3" />
                              URGENTE
                            </span>
                          )}
                          {notification.priority === 'high' && !isRead && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
                              Alta Prioridade
                            </span>
                          )}
                          {isRead && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                              <Eye className="w-3 h-3" />
                              Lido
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
    </div>
  );
};

export default NotificationsModule;
