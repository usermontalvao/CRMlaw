import React, { useEffect, useState, useMemo } from 'react';
import {
  Bell,
  Clock,
  Calendar,
  FileText,
  CheckCircle,
  Loader2,
  Check,
  Search,
  CheckCheck,
  Trash2,
  RefreshCw,
  X,
  Filter,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
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
  isRead: boolean;
  data: any;
};

interface NotificationsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

const NotificationsModuleNew: React.FC<NotificationsModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'intimation' | 'deadline' | 'appointment'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read'>('all');

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const [intimationsData, deadlinesData, appointmentsData] = await Promise.all([
        djenLocalService.listComunicacoes(),
        deadlineService.listDeadlines(),
        calendarService.listEvents(),
      ]);

      setIntimations(intimationsData);
      setDeadlines(deadlinesData.filter(d => d.status === 'pendente'));
      
      const now = new Date();
      const futureAppointments = appointmentsData.filter(a => new Date(a.start_at) >= now);
      setAppointments(futureAppointments);
    } catch (err: any) {
      toast.error('Erro ao carregar', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    const readIds = localStorage.getItem('read_notifications');
    if (readIds) setReadNotifications(new Set(JSON.parse(readIds)));
  }, []);

  const notifications = useMemo((): NotificationItem[] => {
    const items: NotificationItem[] = [];

    intimations.forEach((int) => {
      const notifId = `intimation-${int.id}`;
      items.push({
        id: notifId,
        type: 'intimation',
        title: int.tipo_comunicacao || 'Nova Intimação',
        description: `Processo ${int.numero_processo_mascara || int.numero_processo}`,
        date: int.data_disponibilizacao,
        priority: 'urgent',
        isRead: readNotifications.has(notifId) || int.lida,
        data: int,
      });
    });

    deadlines.forEach((deadline) => {
      const daysUntil = Math.ceil((new Date(deadline.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      const notifId = `deadline-${deadline.id}`;
      items.push({
        id: notifId,
        type: 'deadline',
        title: deadline.title,
        description: `Vence ${daysUntil <= 0 ? 'hoje' : `em ${daysUntil} dia${daysUntil !== 1 ? 's' : ''}`}`,
        date: deadline.due_date,
        priority: daysUntil <= 2 ? 'urgent' : daysUntil <= 5 ? 'high' : 'normal',
        isRead: readNotifications.has(notifId),
        data: deadline,
      });
    });

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
        isRead: readNotifications.has(notifId),
        data: appt,
      });
    });

    return items.sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      const priorityOrder = { urgent: 0, high: 1, normal: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [intimations, deadlines, appointments, readNotifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      // Filtro de tipo
      if (filterType !== 'all' && n.type !== filterType) return false;
      
      // Filtro de status
      if (filterStatus === 'unread' && n.isRead) return false;
      if (filterStatus === 'read' && !n.isRead) return false;
      
      // Busca
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return n.title.toLowerCase().includes(search) || 
               n.description.toLowerCase().includes(search);
      }
      
      return true;
    });
  }, [notifications, filterType, filterStatus, searchTerm]);

  const stats = useMemo(() => {
    const total = notifications.length;
    const unread = notifications.filter(n => !n.isRead).length;
    const urgent = notifications.filter(n => n.priority === 'urgent' && !n.isRead).length;
    const byType = {
      intimation: notifications.filter(n => n.type === 'intimation').length,
      deadline: notifications.filter(n => n.type === 'deadline').length,
      appointment: notifications.filter(n => n.type === 'appointment').length,
    };
    return { total, unread, urgent, byType };
  }, [notifications]);

  const markAsRead = async (notificationId: string) => {
    const newReadSet = new Set(readNotifications);
    newReadSet.add(notificationId);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
    
    if (notificationId.startsWith('intimation-')) {
      const intimationId = notificationId.replace('intimation-', '');
      try {
        await djenLocalService.marcarComoLida(intimationId);
        setIntimations(prev => prev.map(int => int.id === intimationId ? { ...int, lida: true } : int));
      } catch (error) {
        console.error('Erro ao marcar intimação:', error);
      }
    }
  };

  const markAllAsRead = () => {
    const allIds = notifications.map(n => n.id);
    setReadNotifications(new Set(allIds));
    localStorage.setItem('read_notifications', JSON.stringify(allIds));
    toast.success('Marcadas como lidas', 'Todas as notificações foram marcadas');
  };

  const clearAllRead = () => {
    const readIds = notifications.filter(n => n.isRead).map(n => n.id);
    if (readIds.length === 0) {
      toast.info('Nada para limpar', 'Não há notificações lidas');
      return;
    }
    
    const newReadSet = new Set(readNotifications);
    readIds.forEach(id => newReadSet.delete(id));
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));
    toast.success('Limpeza concluída', `${readIds.length} notificação(ões) removida(s)`);
  };

  const handleNotificationClick = async (notification: NotificationItem) => {
    if (!notification.isRead) await markAsRead(notification.id);
    
    if (notification.type === 'intimation') onNavigateToModule?.('intimations');
    else if (notification.type === 'deadline') onNavigateToModule?.('prazos');
    else onNavigateToModule?.('calendar');
  };

  const getIcon = (type: NotificationItem['type'], priority: NotificationItem['priority']) => {
    const baseClass = "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm";
    
    if (type === 'intimation') {
      return <div className={`${baseClass} bg-gradient-to-br from-blue-500 to-blue-600`}><FileText className="w-6 h-6 text-white" /></div>;
    }
    if (type === 'deadline') {
      const isUrgent = priority === 'urgent';
      return <div className={`${baseClass} ${isUrgent ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-gradient-to-br from-amber-500 to-amber-600'}`}><Clock className="w-6 h-6 text-white" /></div>;
    }
    return <div className={`${baseClass} bg-gradient-to-br from-purple-500 to-purple-600`}><Calendar className="w-6 h-6 text-white" /></div>;
  };

  const getTypeLabel = (type: string) => {
    const labels = { intimation: 'Intimações', deadline: 'Prazos', appointment: 'Compromissos' };
    return labels[type as keyof typeof labels] || type;
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    if (days < 7) return `${days} dias atrás`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando notificações...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com Estatísticas */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold flex items-center gap-3 mb-2">
              <Bell className="w-8 h-8" />
              Central de Notificações
            </h2>
            <p className="text-blue-100 text-sm">Gerencie todas as suas notificações em um só lugar</p>
          </div>
          <button
            onClick={loadNotifications}
            disabled={loading}
            className="p-3 bg-white/20 hover:bg-white/30 rounded-xl transition disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <p className="text-blue-100 text-xs font-medium mb-1">Total</p>
            <p className="text-3xl font-bold">{stats.total}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <p className="text-blue-100 text-xs font-medium mb-1">Não Lidas</p>
            <p className="text-3xl font-bold">{stats.unread}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <p className="text-blue-100 text-xs font-medium mb-1">Urgentes</p>
            <p className="text-3xl font-bold text-red-300">{stats.urgent}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
            <p className="text-blue-100 text-xs font-medium mb-1">Lidas</p>
            <p className="text-3xl font-bold">{stats.total - stats.unread}</p>
          </div>
        </div>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Busca */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar notificações..."
              className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filtro de Tipo */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
          >
            <option value="all">Todos os tipos</option>
            <option value="intimation">Intimações ({stats.byType.intimation})</option>
            <option value="deadline">Prazos ({stats.byType.deadline})</option>
            <option value="appointment">Compromissos ({stats.byType.appointment})</option>
          </select>

          {/* Filtro de Status */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
          >
            <option value="all">Todas ({stats.total})</option>
            <option value="unread">Não lidas ({stats.unread})</option>
            <option value="read">Lidas ({stats.total - stats.unread})</option>
          </select>

          {/* Ações */}
          <div className="flex gap-2">
            {stats.unread > 0 && (
              <button
                onClick={markAllAsRead}
                className="inline-flex items-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition"
                title="Marcar todas como lidas"
              >
                <CheckCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Marcar todas</span>
              </button>
            )}
            {stats.total > stats.unread && (
              <button
                onClick={clearAllRead}
                className="inline-flex items-center gap-2 px-4 py-3 border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition"
                title="Limpar lidas"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Limpar lidas</span>
              </button>
            )}
          </div>
        </div>

        {/* Info de filtros ativos */}
        {(searchTerm || filterType !== 'all' || filterStatus !== 'all') && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
            <Filter className="w-4 h-4" />
            <span>
              Mostrando {filteredNotifications.length} de {stats.total} notificações
            </span>
            <button
              onClick={() => {
                setSearchTerm('');
                setFilterType('all');
                setFilterStatus('all');
              }}
              className="ml-2 text-blue-600 hover:text-blue-700 font-medium"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Lista de Notificações */}
      <div className="space-y-3">
        {filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-16 text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mx-auto mb-4">
              <Bell className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              {searchTerm || filterType !== 'all' || filterStatus !== 'all' ? 'Nenhuma notificação encontrada' : 'Você está em dia!'}
            </h3>
            <p className="text-slate-600">
              {searchTerm || filterType !== 'all' || filterStatus !== 'all' 
                ? 'Tente ajustar os filtros de busca' 
                : 'Não há notificações no momento'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              className={`group relative bg-white rounded-2xl shadow-sm border-2 transition-all cursor-pointer overflow-hidden ${
                notification.isRead
                  ? 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                  : 'border-blue-200 hover:border-blue-300 hover:shadow-lg bg-blue-50/30'
              }`}
            >
              {/* Indicador de não lida */}
              {!notification.isRead && (
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-600" />
              )}

              <div className="p-6 pl-8">
                <div className="flex gap-4">
                  {/* Ícone */}
                  {getIcon(notification.type, notification.priority)}

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            {getTypeLabel(notification.type)}
                          </span>
                          {notification.priority === 'urgent' && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3 h-3" />
                              Urgente
                            </span>
                          )}
                        </div>
                        <h3 className={`text-lg leading-tight mb-1 ${
                          notification.isRead ? 'font-medium text-slate-700' : 'font-bold text-slate-900'
                        }`}>
                          {notification.title}
                        </h3>
                        <p className={`text-sm ${notification.isRead ? 'text-slate-500' : 'text-slate-600'}`}>
                          {notification.description}
                        </p>
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-2">
                        {!notification.isRead && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(notification.id);
                            }}
                            className="p-2 hover:bg-blue-100 rounded-lg transition opacity-0 group-hover:opacity-100"
                            title="Marcar como lida"
                          >
                            <Check className="w-5 h-5 text-blue-600" />
                          </button>
                        )}
                        <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition" />
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(notification.date)}
                      </span>
                      {notification.isRead && (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Lida
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NotificationsModuleNew;
