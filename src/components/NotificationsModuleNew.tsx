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
  PenTool,
  PiggyBank,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import usePermissions from '../hooks/usePermissions';
import { djenLocalService } from '../services/djenLocal.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { signatureService } from '../services/signature.service';
import { userNotificationService } from '../services/userNotification.service';
import { financialService } from '../services/financial.service';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { Deadline } from '../types/deadline.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { SignatureRequest } from '../types/signature.types';
import type { UserNotification } from '../types/user-notification.types';
import type { Agreement, Installment } from '../types/financial.types';

type NotificationItem = {
  id: string;
  type: 'intimation' | 'deadline' | 'appointment' | 'signature' | 'user_notification' | 'financial';
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
  const { user } = useAuth();
  const { userRole, loading: permissionsLoading } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [signatureRequests, setSignatureRequests] = useState<SignatureRequest[]>([]);
  const [userNotifications, setUserNotifications] = useState<UserNotification[]>([]);
  const [overdueInstallments, setOverdueInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());

  const normalizeRoleKey = (role?: string | null) => {
    if (!role) return '';
    return role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  };

  const canSeeIntimacoes = !permissionsLoading && ['administrador', 'admin', 'advogado'].includes(normalizeRoleKey(userRole));

  const isIntimationUserNotification = (n: UserNotification) => {
    if (n.type === 'intimation_new') return true;
    if (n.intimation_id) return true;
    const originalType = String(n.metadata?.original_type ?? '');
    if (originalType === 'intimation_urgent') return true;
    if (originalType.includes('intimation')) return true;
    return false;
  };
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<
    'all' | 'intimation' | 'deadline' | 'appointment' | 'signature' | 'user_notification' | 'financial'
  >('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read'>('all');

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const [intimationsData, deadlinesData, appointmentsData] = await Promise.all([
        canSeeIntimacoes ? djenLocalService.listComunicacoes() : Promise.resolve([] as DjenComunicacaoLocal[]),
        deadlineService.listDeadlines(),
        calendarService.listEvents(),
      ]);

      setIntimations(intimationsData);
      setDeadlines(deadlinesData.filter(d => d.status === 'pendente'));
      
      const now = new Date();
      const futureAppointments = appointmentsData.filter(a => new Date(a.start_at) >= now);
      setAppointments(futureAppointments);

      try {
        const inst = await financialService.listAllInstallments({ overdue: true });
        setOverdueInstallments(inst || []);
      } catch (err) {
        console.error('Erro ao carregar parcelas vencidas (financeiro):', err);
        setOverdueInstallments([]);
      }

      try {
        const requests = await signatureService.listRequestsWithDerivedStatus();
        setSignatureRequests((requests || []).filter((r) => r.status === 'pending'));
      } catch (err) {
        console.error('Erro ao carregar assinaturas:', err);
        setSignatureRequests([]);
      }

      try {
        if (user?.id) {
          const notif = await userNotificationService.listNotifications(user.id, false);
          const filtered = canSeeIntimacoes ? (notif || []) : (notif || []).filter((n) => !isIntimationUserNotification(n));
          setUserNotifications(filtered);
        } else {
          setUserNotifications([]);
        }
      } catch (err) {
        console.error('Erro ao carregar user_notifications:', err);
        setUserNotifications([]);
      }
    } catch (err: any) {
      toast.error('Erro ao carregar', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permissionsLoading) return;
    loadNotifications();
    const readIds = localStorage.getItem('read_notifications');
    if (readIds) setReadNotifications(new Set(JSON.parse(readIds)));
  }, [permissionsLoading]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, filterType, filterStatus]);

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

    signatureRequests.forEach((req) => {
      const notifId = `signature-${req.id}`;
      const expiresAt = req.expires_at ? new Date(req.expires_at) : null;
      const daysUntil = expiresAt
        ? Math.ceil((expiresAt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const priority: NotificationItem['priority'] =
        daysUntil !== null && daysUntil <= 2 ? 'urgent' : daysUntil !== null && daysUntil <= 5 ? 'high' : 'normal';

      items.push({
        id: notifId,
        type: 'signature',
        title: `Assinatura pendente: ${req.document_name}`,
        description: req.client_name ? `Cliente: ${req.client_name}` : 'Ação necessária no módulo de Assinaturas.',
        date: req.created_at,
        priority,
        isRead: readNotifications.has(notifId),
        data: req,
      });
    });

    userNotifications.forEach((un) => {
      const notifId = `usernotif-${un.id}`;
      const urgent = Boolean(un.metadata && (un.metadata.urgent || un.metadata.original_type === 'intimation_urgent'));
      items.push({
        id: notifId,
        type: 'user_notification',
        title: un.title,
        description: un.message,
        date: un.created_at,
        priority: urgent ? 'urgent' : 'normal',
        isRead: Boolean(un.read) || readNotifications.has(notifId),
        data: un,
      });
    });

    overdueInstallments.forEach((inst) => {
      const notifId = `financial-${inst.id}`;
      const agreementTitle = (inst as any).agreement?.title as string | undefined;
      const agreement = (inst as any).agreement as Agreement | undefined;
      const descParts = [
        agreementTitle ? String(agreementTitle) : 'Parcela vencida',
        agreement?.client_id ? `Cliente: ${agreement.client_id}` : null,
        `Venc.: ${inst.due_date}`,
        `Parcela ${inst.installment_number}`,
      ].filter(Boolean);

      items.push({
        id: notifId,
        type: 'financial',
        title: 'Financeiro: parcela vencida',
        description: descParts.join(' • '),
        date: inst.due_date,
        priority: 'urgent',
        isRead: readNotifications.has(notifId),
        data: inst,
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
  }, [intimations, deadlines, appointments, signatureRequests, userNotifications, overdueInstallments, readNotifications]);

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

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  }, [filteredNotifications.length]);

  const currentPage = useMemo(() => {
    return Math.min(Math.max(1, page), totalPages);
  }, [page, totalPages]);

  const paginatedNotifications = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredNotifications.slice(start, start + PAGE_SIZE);
  }, [filteredNotifications, currentPage]);

  const pageRange = useMemo(() => {
    const total = filteredNotifications.length;
    if (total === 0) return { start: 0, end: 0, total };
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);
    return { start, end, total };
  }, [filteredNotifications.length, currentPage]);

  const stats = useMemo(() => {
    const total = notifications.length;
    const unread = notifications.filter(n => !n.isRead).length;
    const urgent = notifications.filter(n => n.priority === 'urgent' && !n.isRead).length;
    const byType = {
      intimation: notifications.filter(n => n.type === 'intimation').length,
      deadline: notifications.filter(n => n.type === 'deadline').length,
      appointment: notifications.filter(n => n.type === 'appointment').length,
      signature: notifications.filter(n => n.type === 'signature').length,
      user_notification: notifications.filter(n => n.type === 'user_notification').length,
      financial: notifications.filter(n => n.type === 'financial').length,
    };
    return { total, unread, urgent, byType };
  }, [notifications]);

  const markAsRead = async (notificationId: string) => {
    const newReadSet = new Set(readNotifications);
    newReadSet.add(notificationId);
    setReadNotifications(newReadSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newReadSet]));

    if (notificationId.startsWith('usernotif-')) {
      const userNotifId = notificationId.replace('usernotif-', '');
      try {
        await userNotificationService.markAsRead(userNotifId);
        setUserNotifications((prev) => prev.map((n) => (n.id === userNotifId ? { ...n, read: true } : n)));
      } catch (error) {
        console.error('Erro ao marcar user_notification como lida:', error);
      }
    }
  };

  const markAllAsRead = async () => {
    const allIds = notifications.map(n => n.id);
    setReadNotifications(new Set(allIds));
    localStorage.setItem('read_notifications', JSON.stringify(allIds));

    try {
      if (user?.id) {
        await userNotificationService.markAllAsRead(user.id);
        setUserNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } catch (error) {
      console.error('Erro ao marcar todas user_notifications como lidas:', error);
    }

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
    
    if (notification.type === 'intimation') onNavigateToModule?.('intimacoes');
    else if (notification.type === 'deadline') onNavigateToModule?.('prazos');
    else if (notification.type === 'appointment') onNavigateToModule?.('agenda');
    else if (notification.type === 'signature') {
      const req = notification.data as SignatureRequest;
      onNavigateToModule?.('assinaturas', { mode: 'details', requestId: req.id } as any);
    } else if (notification.type === 'financial') {
      onNavigateToModule?.('financeiro');
    } else {
      const un = notification.data as UserNotification;
      if (un.deadline_id) onNavigateToModule?.('prazos', { entityId: un.deadline_id } as any);
      else if (un.process_id) onNavigateToModule?.('processos', { entityId: un.process_id } as any);
      else if (un.requirement_id) onNavigateToModule?.('requerimentos', { entityId: un.requirement_id } as any);
      else if (un.intimation_id) onNavigateToModule?.('intimacoes');
      else if (un.appointment_id) onNavigateToModule?.('agenda');
    }
  };

  const getIcon = (type: NotificationItem['type'], priority: NotificationItem['priority']) => {
    const baseClass = "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm";
    
    if (type === 'intimation') {
      return <div className={`${baseClass} bg-gradient-to-br from-blue-500 to-blue-600`}><FileText className="w-5 h-5 text-white" /></div>;
    }
    if (type === 'deadline') {
      const isUrgent = priority === 'urgent';
      return <div className={`${baseClass} ${isUrgent ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-gradient-to-br from-amber-500 to-amber-600'}`}><Clock className="w-5 h-5 text-white" /></div>;
    }
    if (type === 'appointment') {
      return <div className={`${baseClass} bg-gradient-to-br from-purple-500 to-purple-600`}><Calendar className="w-5 h-5 text-white" /></div>;
    }
    if (type === 'signature') {
      return <div className={`${baseClass} bg-gradient-to-br from-emerald-500 to-emerald-600`}><PenTool className="w-5 h-5 text-white" /></div>;
    }
    if (type === 'financial') {
      return <div className={`${baseClass} bg-gradient-to-br from-rose-500 to-rose-600`}><PiggyBank className="w-5 h-5 text-white" /></div>;
    }
    return <div className={`${baseClass} bg-gradient-to-br from-slate-500 to-slate-600`}><Bell className="w-5 h-5 text-white" /></div>;
  };

  const getTypeLabel = (type: string) => {
    const labels = {
      intimation: 'Intimações',
      deadline: 'Prazos',
      appointment: 'Compromissos',
      signature: 'Assinaturas',
      user_notification: 'Sistema',
      financial: 'Financeiro',
    };
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

  return (
    <div className="space-y-6">
      {/* Barra única: Título + indicadores + atualizar */}
      <div className="bg-white border border-slate-100 rounded-lg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Bell className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-slate-800 text-sm">Central de Notificações</span>
            <span className="hidden sm:inline">•</span>
            <span>{stats.total} total</span>
            <span className="font-medium text-blue-600">{stats.unread} não lidas</span>
            {stats.urgent > 0 && <span className="font-medium text-red-600">{stats.urgent} urgentes</span>}
          </div>

          <button
            onClick={loadNotifications}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{loading ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>
      </div>

      {/* Barra de filtros (padrão do sistema) */}
      <div className="bg-white border border-slate-100 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-2">
            {/* Campo de Busca */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar notificações por processo, nome ou conteúdo..."
                className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filtros */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
            >
                <option value="all">Todos os tipos</option>
                <option value="intimation">Intimações ({stats.byType.intimation})</option>
                <option value="deadline">Prazos ({stats.byType.deadline})</option>
                <option value="appointment">Compromissos ({stats.byType.appointment})</option>
                <option value="signature">Assinaturas ({stats.byType.signature})</option>
                <option value="user_notification">Sistema ({stats.byType.user_notification})</option>
                <option value="financial">Financeiro ({stats.byType.financial})</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
            >
                <option value="all">Todas ({stats.total})</option>
                <option value="unread">Não lidas ({stats.unread})</option>
                <option value="read">Lidas ({stats.total - stats.unread})</option>
            </select>

            {stats.unread > 0 && (
              <button
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
              >
                <CheckCheck className="w-4 h-4" />
                Marcar todas
              </button>
            )}
            {stats.total > stats.unread && (
              <button
                onClick={clearAllRead}
                className="inline-flex items-center gap-1.5 border border-gray-200 text-slate-600 hover:bg-slate-50 text-sm px-3 py-1.5 rounded-lg transition"
              >
                <Trash2 className="w-4 h-4" />
                Limpar lidas
              </button>
            )}
          </div>

          {(searchTerm || filterType !== 'all' || filterStatus !== 'all') && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Filter className="w-4 h-4" />
                <span>
                  Mostrando {pageRange.start}-{pageRange.end} de {pageRange.total} notificações filtradas
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setFilterType('all');
                  setFilterStatus('all');
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>

        {/* Lista de Notificações */}
        <div className="space-y-3">
          {loading ? (
            <div className="bg-white border border-slate-100 rounded-lg p-8">
              <div className="flex items-center justify-center gap-3 text-slate-600">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Carregando notificações...</span>
              </div>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-lg p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                {searchTerm || filterType !== 'all' || filterStatus !== 'all' ? 'Nenhuma notificação encontrada' : 'Você está em dia!'}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {searchTerm || filterType !== 'all' || filterStatus !== 'all' 
                  ? 'Tente ajustar os filtros de busca' 
                  : 'Não há notificações no momento'}
              </p>
            </div>
          ) : (
            paginatedNotifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`group rounded-xl shadow-sm border-l-4 ${
                  !notification.isRead
                    ? notification.priority === 'urgent'
                      ? 'border-l-red-500 border-y border-r border-gray-200 dark:border-gray-700'
                      : 'border-l-blue-500 border-y border-r border-gray-200 dark:border-gray-700'
                    : 'border-l-transparent border border-gray-200 dark:border-gray-700'
                } p-5 hover:shadow-md transition-all duration-200 cursor-pointer relative overflow-hidden ${
                  !notification.isRead ? 'bg-blue-50/50 dark:bg-blue-950/20' : 'bg-white dark:bg-gray-800'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Ícone */}
                  <div className="flex-shrink-0">
                    {getIcon(notification.type, notification.priority)}
                  </div>

                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">
                          {getTypeLabel(notification.type)}
                        </span>
                        {notification.priority === 'urgent' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Urgente
                          </span>
                        )}
                        {notification.isRead && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Lida
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(notification.date)}
                      </span>
                    </div>

                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate pr-8 mb-1">
                      {notification.title}
                    </h3>

                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                      {notification.description}
                    </p>
                  </div>

                  {/* Ações */}
                  <div className="flex flex-col items-end justify-between self-stretch pl-2">
                    {!notification.isRead && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(notification.id);
                        }}
                        className="text-blue-600 hover:text-blue-700 dark:hover:text-blue-400 p-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        title="Marcar como lida"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                    <button className="mt-auto text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Paginação */}
        {filteredNotifications.length > 0 && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Próximo
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Mostrando <span className="font-medium">{pageRange.start}</span> a <span className="font-medium">{pageRange.end}</span> de <span className="font-medium">{pageRange.total}</span> resultados
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Página <span className="font-semibold ml-1">{currentPage}</span> de <span className="font-semibold ml-1">{totalPages}</span>
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default NotificationsModuleNew;
