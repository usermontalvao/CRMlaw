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
  AlertCircle,
  PenTool,
  PiggyBank,
  User,
  Building2,
  Hash,
  ChevronRight,
  ArrowRight,
  Users,
} from 'lucide-react';
import { ModuleSkeleton } from './ui';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import usePermissions from '../hooks/usePermissions';
import { supabase } from '../config/supabase';
import { calendarService } from '../services/calendar.service';
import { signatureService } from '../services/signature.service';
import { userNotificationService } from '../services/userNotification.service';
import { financialService } from '../services/financial.service';
import { matchesNormalizedSearch } from '../utils/search';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { SignatureRequest } from '../types/signature.types';
import type { UserNotification } from '../types/user-notification.types';
import type { Agreement, Installment } from '../types/financial.types';

// Deadline enriquecido com joins
interface EnrichedDeadline {
  id: string;
  title: string;
  description?: string | null;
  due_date: string;
  status: string;
  priority: string;
  type: string;
  process_id?: string | null;
  client_id?: string | null;
  responsible_id?: string | null;
  created_at: string;
  updated_at: string;
  clients?: { name: string } | null;
  profiles?: { name: string } | null;
}

type NotifType = 'intimation' | 'deadline' | 'appointment' | 'signature' | 'user_notification' | 'financial';

type NotificationItem = {
  id: string;
  type: NotifType;
  title: string;
  date: string;
  priority: 'urgent' | 'high' | 'normal';
  isRead: boolean;
  data: any;
};

interface NotificationsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

const TYPE_CONFIG: Record<NotifType, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  intimation: {
    label: 'INTIMAÇÕES',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    icon: <FileText className="w-4 h-4 text-blue-600" />,
  },
  deadline: {
    label: 'PRAZOS',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    icon: <Clock className="w-4 h-4 text-amber-600" />,
  },
  appointment: {
    label: 'COMPROMISSOS',
    color: 'text-purple-700',
    bg: 'bg-purple-100',
    icon: <Calendar className="w-4 h-4 text-purple-600" />,
  },
  signature: {
    label: 'ASSINATURAS',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    icon: <PenTool className="w-4 h-4 text-emerald-600" />,
  },
  financial: {
    label: 'FINANCEIRO',
    color: 'text-rose-700',
    bg: 'bg-rose-100',
    icon: <PiggyBank className="w-4 h-4 text-rose-600" />,
  },
  user_notification: {
    label: 'SISTEMA',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    icon: <Bell className="w-4 h-4 text-slate-500" />,
  },
};

const PRIORITY_BORDER: Record<'urgent' | 'high' | 'normal', string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-amber-400',
  normal: 'border-l-slate-300',
};

const Chip: React.FC<{ icon?: React.ReactNode; text: string; muted?: boolean }> = ({ icon, text, muted }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      muted ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-700'
    }`}
  >
    {icon}
    {text}
  </span>
);

const NotificationsModuleNew: React.FC<NotificationsModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const { user } = useAuth();
  const { userRole, loading: permissionsLoading } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [deadlines, setDeadlines] = useState<EnrichedDeadline[]>([]);
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [signatureRequests, setSignatureRequests] = useState<SignatureRequest[]>([]);
  const [userNotifications, setUserNotifications] = useState<UserNotification[]>([]);
  const [overdueInstallments, setOverdueInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());

  const normalizeRoleKey = (role?: string | null) =>
    (role ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const canSeeIntimacoes =
    !permissionsLoading && ['administrador', 'admin', 'advogado'].includes(normalizeRoleKey(userRole));

  const isIntimationUserNotification = (n: UserNotification) => {
    if (n.type === 'intimation_new') return true;
    if (n.intimation_id) return true;
    const originalType = String(n.metadata?.original_type ?? '');
    return originalType === 'intimation_urgent' || originalType.includes('intimation');
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | NotifType>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'read'>('all');

  const PAGE_SIZE = 15;
  const [page, setPage] = useState(1);

  const loadNotifications = async () => {
    try {
      setLoading(true);

      const [deadlinesResult, appointmentsData] = await Promise.all([
        supabase
          .from('deadlines')
          .select('*, clients(name), profiles!deadlines_responsible_id_fkey(name)')
          .eq('status', 'pendente')
          .order('due_date', { ascending: true }),
        calendarService.listEvents(),
      ]);

      setDeadlines((deadlinesResult.data ?? []) as EnrichedDeadline[]);

      const now = new Date();
      setAppointments(appointmentsData.filter((a) => new Date(a.start_at) >= now));

      if (canSeeIntimacoes) {
        try {
          const { data: intData } = await supabase
            .from('djen_comunicacoes')
            .select('*, djen_destinatarios(id, nome, polo), djen_advogados(id, nome, numero_oab, uf_oab)')
            .eq('ativo', true)
            .order('data_disponibilizacao', { ascending: false })
            .limit(200);
          setIntimations((intData ?? []) as DjenComunicacaoLocal[]);
        } catch {
          setIntimations([]);
        }
      }

      try {
        const inst = await financialService.listAllInstallments({ overdue: true });
        setOverdueInstallments(inst || []);
      } catch {
        setOverdueInstallments([]);
      }

      try {
        const requests = await signatureService.listRequestsWithDerivedStatus();
        setSignatureRequests((requests || []).filter((r) => r.status === 'pending'));
      } catch {
        setSignatureRequests([]);
      }

      try {
        if (user?.id) {
          const notif = await userNotificationService.listNotifications(user.id, false);
          const filtered = canSeeIntimacoes
            ? notif ?? []
            : (notif ?? []).filter((n) => !isIntimationUserNotification(n));
          setUserNotifications(filtered);
        }
      } catch {
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
        date: int.data_disponibilizacao,
        priority: 'urgent',
        isRead: readNotifications.has(notifId) || int.lida,
        data: int,
      });
    });

    deadlines.forEach((deadline) => {
      const daysUntil = Math.ceil(
        (new Date(deadline.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      const notifId = `deadline-${deadline.id}`;
      items.push({
        id: notifId,
        type: 'deadline',
        title: deadline.title,
        date: deadline.due_date,
        priority: daysUntil <= 2 ? 'urgent' : daysUntil <= 5 ? 'high' : 'normal',
        isRead: readNotifications.has(notifId),
        data: deadline,
      });
    });

    appointments.forEach((appt) => {
      const notifId = `appointment-${appt.id}`;
      items.push({
        id: notifId,
        type: 'appointment',
        title: appt.title,
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
      items.push({
        id: notifId,
        type: 'signature',
        title: req.document_name,
        date: req.created_at,
        priority: daysUntil !== null && daysUntil <= 2 ? 'urgent' : daysUntil !== null && daysUntil <= 5 ? 'high' : 'normal',
        isRead: readNotifications.has(notifId),
        data: req,
      });
    });

    userNotifications.forEach((un) => {
      const notifId = `usernotif-${un.id}`;
      const urgent = Boolean(un.metadata?.urgent || un.metadata?.original_type === 'intimation_urgent');
      items.push({
        id: notifId,
        type: 'user_notification',
        title: un.title,
        date: un.created_at,
        priority: urgent ? 'urgent' : 'normal',
        isRead: Boolean(un.read) || readNotifications.has(notifId),
        data: un,
      });
    });

    overdueInstallments.forEach((inst) => {
      const notifId = `financial-${inst.id}`;
      items.push({
        id: notifId,
        type: 'financial',
        title: (inst as any).agreement?.title || 'Parcela vencida',
        date: inst.due_date,
        priority: 'urgent',
        isRead: readNotifications.has(notifId),
        data: inst,
      });
    });

    return items.sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      const po = { urgent: 0, high: 1, normal: 2 };
      if (po[a.priority] !== po[b.priority]) return po[a.priority] - po[b.priority];
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [intimations, deadlines, appointments, signatureRequests, userNotifications, overdueInstallments, readNotifications]);

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (hiddenIds.has(n.id)) return false;
      if (filterType !== 'all' && n.type !== filterType) return false;
      if (filterStatus === 'unread' && n.isRead) return false;
      if (filterStatus === 'read' && !n.isRead) return false;
      if (searchTerm) return matchesNormalizedSearch(searchTerm, [n.title]);
      return true;
    });
  }, [notifications, filterType, filterStatus, searchTerm, hiddenIds]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE)), [filteredNotifications.length]);
  const currentPage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const paginatedNotifications = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredNotifications.slice(start, start + PAGE_SIZE);
  }, [filteredNotifications, currentPage]);

  const stats = useMemo(() => {
    const total = notifications.length;
    const unread = notifications.filter((n) => !n.isRead).length;
    const urgent = notifications.filter((n) => n.priority === 'urgent' && !n.isRead).length;
    const byType = {
      intimation: notifications.filter((n) => n.type === 'intimation').length,
      deadline: notifications.filter((n) => n.type === 'deadline').length,
      appointment: notifications.filter((n) => n.type === 'appointment').length,
      signature: notifications.filter((n) => n.type === 'signature').length,
      user_notification: notifications.filter((n) => n.type === 'user_notification').length,
      financial: notifications.filter((n) => n.type === 'financial').length,
    };
    return { total, unread, urgent, byType };
  }, [notifications]);

  const markAsRead = async (notificationId: string) => {
    const newSet = new Set(readNotifications);
    newSet.add(notificationId);
    setReadNotifications(newSet);
    localStorage.setItem('read_notifications', JSON.stringify([...newSet]));
    if (notificationId.startsWith('usernotif-')) {
      const uid = notificationId.replace('usernotif-', '');
      try {
        await userNotificationService.markAsRead(uid);
        setUserNotifications((prev) => prev.map((n) => (n.id === uid ? { ...n, read: true } : n)));
      } catch {}
    }
  };

  const markAllAsRead = async () => {
    const allIds = notifications.map((n) => n.id);
    setReadNotifications(new Set(allIds));
    localStorage.setItem('read_notifications', JSON.stringify(allIds));
    try {
      if (user?.id) {
        await userNotificationService.markAllAsRead(user.id);
        setUserNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } catch {}
    toast.success('Marcadas como lidas', 'Todas as notificações foram marcadas');
  };

  const clearAllRead = () => {
    const readIds = notifications.filter((n) => n.isRead).map((n) => n.id);
    if (readIds.length === 0) { toast.info('Nada para limpar', 'Não há notificações lidas'); return; }
    setHiddenIds((prev) => new Set([...prev, ...readIds]));
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
    } else if (notification.type === 'financial') onNavigateToModule?.('financeiro');
    else {
      const un = notification.data as UserNotification;
      if (un.type === 'email_new') onNavigateToModule?.('email', un.metadata?.email_id ? { emailId: String(un.metadata.email_id) } : undefined);
      else if (un.metadata?.post_id) onNavigateToModule?.('feed', { openPostModal: un.metadata.post_id } as any);
      else if (un.deadline_id) onNavigateToModule?.('prazos', { entityId: un.deadline_id } as any);
      else if (un.process_id) onNavigateToModule?.('processos', { entityId: un.process_id } as any);
      else if (un.requirement_id) onNavigateToModule?.('requerimentos', { entityId: un.requirement_id } as any);
      else if (un.intimation_id) onNavigateToModule?.('intimacoes');
      else if (un.appointment_id) onNavigateToModule?.('agenda');
    }
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Ontem';
    if (days < 7) return `${days}d atrás`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const formatDueDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const daysUntil = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return `Venceu há ${Math.abs(daysUntil)}d`;
    if (daysUntil === 0) return 'Vence hoje';
    if (daysUntil === 1) return 'Vence amanhã';
    return `Vence em ${daysUntil}d`;
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ─── Card content renderers ──────────────────────────────────────────────

  const renderDeadlineDetail = (n: NotificationItem) => {
    const d = n.data as EnrichedDeadline;
    const daysUntil = Math.ceil((new Date(d.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    const dueLabel = formatDueDate(d.due_date);
    const dueColor = daysUntil <= 0 ? 'bg-red-100 text-red-700' : daysUntil <= 2 ? 'bg-orange-100 text-orange-700' : daysUntil <= 5 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
    const typeLabel = { processo: 'Processo', requerimento: 'Requerimento', geral: 'Geral' }[d.type] ?? d.type;
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${dueColor}`}>
          <Clock className="w-3 h-3" />{dueLabel}
        </span>
        <Chip text={typeLabel} />
        {d.clients?.name && <Chip icon={<User className="w-3 h-3" />} text={d.clients.name} />}
        {d.profiles?.name && <Chip icon={<Users className="w-3 h-3" />} text={d.profiles.name} />}
        {d.description && (
          <span className="w-full text-xs text-slate-500 mt-0.5 truncate">{d.description}</span>
        )}
      </div>
    );
  };

  const renderIntimationDetail = (n: NotificationItem) => {
    const int = n.data as DjenComunicacaoLocal;
    const processo = int.numero_processo_mascara || int.numero_processo;
    const advogados = int.djen_advogados ?? [];
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {processo && <Chip icon={<Hash className="w-3 h-3" />} text={processo} />}
        {int.nome_orgao && <Chip icon={<Building2 className="w-3 h-3" />} text={int.nome_orgao} />}
        {int.polo_ativo && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
            <span className="font-semibold">Ativo:</span> {int.polo_ativo}
          </span>
        )}
        {int.polo_passivo && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
            <span className="font-semibold">Passivo:</span> {int.polo_passivo}
          </span>
        )}
        {advogados.slice(0, 2).map((adv) => (
          <Chip key={adv.id} icon={<User className="w-3 h-3" />} text={`${adv.nome} (OAB ${adv.numero_oab}/${adv.uf_oab})`} muted />
        ))}
      </div>
    );
  };

  const renderAppointmentDetail = (n: NotificationItem) => {
    const appt = n.data as CalendarEvent;
    const start = new Date(appt.start_at);
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        <Chip
          icon={<Calendar className="w-3 h-3" />}
          text={`${start.toLocaleDateString('pt-BR')} às ${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
        />
        {appt.client_name && <Chip icon={<User className="w-3 h-3" />} text={appt.client_name} />}
      </div>
    );
  };

  const renderSignatureDetail = (n: NotificationItem) => {
    const req = n.data as SignatureRequest;
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {req.client_name && <Chip icon={<User className="w-3 h-3" />} text={req.client_name} />}
        {req.process_number && <Chip icon={<Hash className="w-3 h-3" />} text={req.process_number} />}
        {req.expires_at && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">
            <Clock className="w-3 h-3" />
            {formatDueDate(req.expires_at)}
          </span>
        )}
      </div>
    );
  };

  const renderFinancialDetail = (n: NotificationItem) => {
    const inst = n.data as Installment & { agreement?: Agreement };
    const agreement = (inst as any).agreement as Agreement | undefined;
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-700">
          <PiggyBank className="w-3 h-3" />
          {formatCurrency(inst.value)}
        </span>
        <Chip text={`Parcela ${inst.installment_number}`} />
        <Chip icon={<Clock className="w-3 h-3" />} text={`Venceu em ${new Date(inst.due_date).toLocaleDateString('pt-BR')}`} />
        {agreement?.client_id && <Chip icon={<User className="w-3 h-3" />} text="Ver cliente" muted />}
      </div>
    );
  };

  const renderUserNotifDetail = (n: NotificationItem) => {
    const un = n.data as UserNotification;
    return (
      <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">{un.message}</p>
    );
  };

  const renderDetail = (n: NotificationItem) => {
    switch (n.type) {
      case 'deadline': return renderDeadlineDetail(n);
      case 'intimation': return renderIntimationDetail(n);
      case 'appointment': return renderAppointmentDetail(n);
      case 'signature': return renderSignatureDetail(n);
      case 'financial': return renderFinancialDetail(n);
      case 'user_notification': return renderUserNotifDetail(n);
    }
  };

  const pageRange = useMemo(() => {
    const total = filteredNotifications.length;
    if (total === 0) return { start: 0, end: 0, total };
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    return { start, end: Math.min(currentPage * PAGE_SIZE, total), total };
  }, [filteredNotifications.length, currentPage]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <Bell className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Central de Notificações</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{stats.total} total</span>
              {stats.unread > 0 && <span className="text-amber-600 font-medium">{stats.unread} não lidas</span>}
              {stats.urgent > 0 && <span className="text-red-600 font-medium">{stats.urgent} urgentes</span>}
            </div>
          </div>
        </div>
        <button
          onClick={loadNotifications}
          disabled={loading}
          className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-8 pr-8 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-sm"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-sm"
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
          className="px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 text-sm"
        >
          <option value="all">Todas ({stats.total})</option>
          <option value="unread">Não lidas ({stats.unread})</option>
          <option value="read">Lidas ({stats.total - stats.unread})</option>
        </select>

        <div className="flex items-center gap-1.5 ml-auto">
          {stats.unread > 0 && (
            <button
              onClick={markAllAsRead}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar todas
            </button>
          )}
          {stats.total > stats.unread && (
            <button
              onClick={clearAllRead}
              className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs px-3 py-1.5 rounded-lg transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar lidas
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <ModuleSkeleton variant="list" rows={7} />
      ) : filteredNotifications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <Bell className="w-7 h-7 text-amber-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">
            {searchTerm || filterType !== 'all' || filterStatus !== 'all' ? 'Nenhuma notificação encontrada' : 'Você está em dia!'}
          </h3>
          <p className="text-sm text-slate-500">
            {searchTerm || filterType !== 'all' || filterStatus !== 'all'
              ? 'Tente ajustar os filtros'
              : 'Não há notificações pendentes'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {paginatedNotifications.map((notification) => {
            const cfg = TYPE_CONFIG[notification.type];
            return (
              <div
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`group bg-white border-l-4 ${PRIORITY_BORDER[notification.priority]} border-y border-r border-slate-200 rounded-r-xl p-4 hover:shadow-md transition-all duration-150 cursor-pointer ${
                  !notification.isRead ? 'bg-amber-50/30' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon badge */}
                  <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    {cfg.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: type label + urgente badge + date */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold tracking-widest ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        {notification.priority === 'urgent' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                            <AlertCircle className="w-2.5 h-2.5" />
                            Urgente
                          </span>
                        )}
                        {notification.priority === 'high' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                            Alta prioridade
                          </span>
                        )}
                        {!notification.isRead && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 flex-shrink-0">{formatDate(notification.date)}</span>
                    </div>

                    {/* Row 2: title */}
                    <h3 className={`text-sm font-semibold truncate ${notification.isRead ? 'text-slate-600' : 'text-slate-900'}`}>
                      {notification.title}
                    </h3>

                    {/* Row 3: rich detail chips */}
                    {renderDetail(notification)}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-center gap-2 flex-shrink-0 pl-1 self-center">
                    {!notification.isRead && (
                      <button
                        onClick={(e) => { e.stopPropagation(); markAsRead(notification.id); }}
                        className="text-slate-400 hover:text-emerald-600 transition-colors p-1 rounded hover:bg-emerald-50"
                        title="Marcar como lida"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-amber-500 transition-colors" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {filteredNotifications.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-slate-500">
            {pageRange.start}–{pageRange.end} de {pageRange.total}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="px-3 py-1.5 text-xs font-medium text-slate-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsModuleNew;
