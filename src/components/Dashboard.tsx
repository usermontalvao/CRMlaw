import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Briefcase,
  Calendar,
  CheckSquare,
  AlertCircle,
  Clock,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  DollarSign,
  TrendingUp,
  PiggyBank,
  CircleDollarSign,
  ArrowRight,
  X,
  UserPlus,
  Bell,
  Scale,
  ChevronRight,
  ExternalLink,
  Zap,
  BarChart3,
  Wallet,
  AlertTriangle,
  CalendarDays,
  Gavel,
  Plus,
  Eye,
  Sparkles,
} from 'lucide-react';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { taskService } from '../services/task.service';
import { calendarService } from '../services/calendar.service';
import { requirementService } from '../services/requirement.service';
import { financialService } from '../services/financial.service';
import { djenLocalService } from '../services/djenLocal.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Deadline } from '../types/deadline.types';
import type { Task } from '../types/task.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { Requirement } from '../types/requirement.types';
import type { FinancialStats, Installment, Agreement } from '../types/financial.types';
import type { DjenComunicacaoLocal } from '../types/djen.types';
import { FinancialCard } from './dashboard/FinancialCard';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { events, SYSTEM_EVENTS } from '../utils/events';

interface DashboardProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
}

type StatCardProps = {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: string; isPositive: boolean };
  color: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  onClick?: () => void;
};

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, trend, color, onClick }) => {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
  };

  return (
    <div
      className={`rounded-xl border-2 ${colorClasses[color]} p-6 transition hover:shadow-lg ${
        onClick ? 'cursor-pointer' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
          {trend && (
            <div className="mt-2 flex items-center gap-1 text-sm">
              {trend.isPositive ? (
                <ArrowUpRight className="h-4 w-4 text-emerald-600" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-600" />
              )}
              <span className={trend.isPositive ? 'text-emerald-600' : 'text-red-600'}>
                {trend.value}
              </span>
            </div>
          )}
        </div>
        <div className="rounded-lg bg-white/50 p-3">{icon}</div>
      </div>
    </div>
  );
};

type QuickActionProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  accent?: 'amber' | 'blue' | 'green' | 'purple';
};

const QuickAction: React.FC<QuickActionProps> = ({ title, description, icon, onClick, accent = 'amber' }) => {
  const accentClasses: Record<NonNullable<QuickActionProps['accent']>, string> = {
    amber: 'bg-amber-50 text-amber-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-amber-300 hover:shadow-md"
    >
      <div className={`rounded-lg p-3 ${accentClasses[accent]}`}>{icon}</div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
    </button>
  );
};

interface ModuleShortcut {
  title: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  accent: NonNullable<QuickActionProps['accent']>;
}

// Cache keys e configuração
const DASHBOARD_CACHE_KEY = 'crm-dashboard-cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos (reduzir requisições)
const REQUEST_TIMEOUT_MS = 15000; // 15s por requisição pesada

interface DashboardCache {
  timestamp: number;
  data: {
    clients: Client[];
    processes: Process[];
    deadlines: Deadline[];
    tasks: Task[];
    calendarEvents: CalendarEvent[];
    requirements: Requirement[];
    financialStats: FinancialStats | null;
    overdueInstallments: (Installment & { agreement?: Agreement })[];
    djenIntimacoes: DjenComunicacaoLocal[];
  };
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToModule }) => {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [financialStats, setFinancialStats] = useState<FinancialStats | null>(null);
  const [overdueInstallments, setOverdueInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [djenIntimacoes, setDjenIntimacoes] = useState<DjenComunicacaoLocal[]>([]);
  const [djenUrgencyStats, setDjenUrgencyStats] = useState({ alta: 0, media: 0, baixa: 0, sem_analise: 0 });
  const [selectedEvent, setSelectedEvent] = useState<{
    id: string;
    title: string;
    start_at: string;
    type: string;
    client_id?: string | null;
  } | null>(null);
  const [selectedIntimacao, setSelectedIntimacao] = useState<DjenComunicacaoLocal | null>(null);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const withTimeout = useCallback(<T,>(promise: Promise<T>, label: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} excedeu ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }, []);

  const safeFetch = useCallback(<T,>(factory: () => Promise<T>, fallback: T, label: string): Promise<T> => {
    return withTimeout(factory(), label).catch((error: unknown) => {
      console.warn(`Dashboard: ${label} indisponível`, error);
      return fallback;
    });
  }, [withTimeout]);

  const loadDashboardData = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);

      // Tentar carregar do cache primeiro
      if (!forceRefresh) {
        const cachedData = localStorage.getItem(DASHBOARD_CACHE_KEY);
        if (cachedData) {
          try {
            const cache: DashboardCache = JSON.parse(cachedData);
            const now = Date.now();
            
            // Verificar se o cache ainda é válido
            if (now - cache.timestamp < CACHE_DURATION) {
              console.log(' Carregando Dashboard do cache');
              setClients(cache.data.clients);
              setProcesses(cache.data.processes);
              setDeadlines(cache.data.deadlines);
              setTasks(cache.data.tasks);
              setCalendarEvents(cache.data.calendarEvents);
              setRequirements(cache.data.requirements);
              setFinancialStats(cache.data.financialStats);
              setOverdueInstallments(cache.data.overdueInstallments);
              setDjenIntimacoes(cache.data.djenIntimacoes);
              setLoading(false);
              return;
            }
          } catch (e) {
            console.warn('Cache inválido, recarregando dados');
          }
        }
      }

      // Carregar dados da API com limites para reduzir egress
      console.log(' Carregando Dashboard da API (com limites)');
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const [
        clientsData,
        processesData,
        deadlinesData,
        tasksData,
        calendarEventsData,
        requirementsData,
        financialStatsData,
        allInstallmentsData,
        djenIntimacoesData,
      ] = await Promise.all([
        safeFetch(
          () => clientService.listClients().then((clients) => clients.filter((c) => c.status === 'ativo')),
          [],
          'Clientes'
        ),
        safeFetch(
          () => processService.listProcesses().then((procs) => procs.filter((p) => p.status !== 'arquivado').slice(0, 100)),
          [],
          'Processos'
        ),
        safeFetch(
          () => deadlineService.listDeadlines().then((deadlines) => deadlines.filter((d) => d.status === 'pendente').slice(0, 50)),
          [],
          'Prazos'
        ),
        safeFetch(
          () => taskService.listTasks().then((tasks) => tasks.filter((t) => t.status === 'pending').slice(0, 50)),
          [],
          'Tarefas'
        ),
        safeFetch(
          () =>
            calendarService.listEvents().then((events) => {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const futureDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
              return events
                .filter((e) => {
                  if (!e.start_at) return false;
                  const eventDate = new Date(e.start_at);
                  return eventDate >= now && eventDate <= futureDate;
                })
                .slice(0, 100);
            }),
          [],
          'Agenda'
        ),
        safeFetch(
          () => requirementService
            .listRequirements()
            .then((reqs) => reqs.filter((r) => r.status === 'aguardando_confeccao').slice(0, 50)),
          [],
          'Requerimentos'
        ),
        safeFetch(
          () => financialService.getFinancialStats(new Date().toISOString().slice(0, 7)),
          null,
          'Financeiro'
        ),
        safeFetch(
          () =>
            financialService.listAllInstallments().then((insts) =>
              insts
                .filter(
                  (i) => (i.status === 'pendente' || i.status === 'vencido') && i.due_date >= thirtyDaysAgo
                )
                .slice(0, 50)
            ),
          [],
          'Parcelas'
        ),
        safeFetch(
          () => djenLocalService.listComunicacoes({ lida: false }),
          [],
          'Intimações DJEN'
        ),
      ]);
      
      // Filtrar parcelas vencidas (reutilizar variável today já declarada)
      const overdue = allInstallmentsData
        .filter((inst: any) => (inst.status === 'pendente' || inst.status === 'vencido') && inst.due_date < today)
        .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5);

      // Carregar estatísticas de urgência das intimações
      if (djenIntimacoesData.length > 0) {
        try {
          const intimationIds = djenIntimacoesData.map((int: any) => int.id);
          const analyses = await intimationAnalysisService.getAnalysesByIntimationIds(intimationIds);
          
          const stats = { alta: 0, media: 0, baixa: 0, sem_analise: 0 };
          djenIntimacoesData.forEach((intimacao: any) => {
            const analysis = analyses.get(intimacao.id);
            if (analysis && analysis.urgency) {
              stats[analysis.urgency as 'alta' | 'media' | 'baixa']++;
            } else {
              stats.sem_analise++;
            }
          });
          setDjenUrgencyStats(stats);
        } catch (err) {
          console.error('Erro ao carregar estatísticas de urgência:', err);
        }
      }

      // Atualizar estados
      setClients(clientsData);
      setProcesses(processesData);
      setDeadlines(deadlinesData);
      setTasks(tasksData);
      setCalendarEvents(calendarEventsData);
      setRequirements(requirementsData);
      setFinancialStats(financialStatsData);
      setDjenIntimacoes(djenIntimacoesData);
      setOverdueInstallments(overdue);

      // Salvar no cache
      const cacheData: DashboardCache = {
        timestamp: Date.now(),
        data: {
          clients: clientsData,
          processes: processesData,
          deadlines: deadlinesData,
          tasks: tasksData,
          calendarEvents: calendarEventsData,
          requirements: requirementsData,
          financialStats: financialStatsData,
          overdueInstallments: overdue,
          djenIntimacoes: djenIntimacoesData,
        },
      };
      localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
      console.log(' Dashboard salvo no cache');
    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, [safeFetch]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 Dashboard: Mudança de clientes detectada, recarregando...');
      loadDashboardData(true); // Forçar recarregamento ignorando cache
    });
    
    return () => unsubscribe();
  }, [loadDashboardData]);

  const activeClients = clients.filter((c) => c.status === 'ativo').length;
  const activeProcesses = processes.length;
  // ... (rest of the code remains the same)
  const pendingDeadlines = deadlines.filter((d) => d.status === 'pendente').length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const awaitingRequirements = requirements.filter((r) => r.status === 'aguardando_confeccao');
  const awaitingDraftProcesses = processes.filter((p) => p.status === 'aguardando_confeccao');
  const pendingProcesses = processes.filter((p) => p.status === 'andamento' || p.status === 'distribuido');

  const upcomingDeadlines = deadlines
    .filter((d) => d.status === 'pendente' && d.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 5);

  const recentTasks = tasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  // Combinar compromissos manuais + audiências dos processos
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Compromissos manuais
    const manualEvents = calendarEvents
      .filter((e) => {
        if (!e.start_at) return false;
        const eventDate = new Date(e.start_at);
        return eventDate >= today;
      })
      .map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        type: e.event_type || 'meeting',
        client_id: e.client_id,
      }));

    // Audiências dos processos
    const hearingEvents = processes
      .filter((p) => p.hearing_scheduled && p.hearing_date)
      .filter((p) => {
        const hearingDate = new Date(p.hearing_date!);
        return hearingDate >= today;
      })
      .map((p) => {
        const client = clients.find((c) => c.id === p.client_id);
        const clientName = client?.full_name || 'Sem cliente';
        const modeLabel = p.hearing_mode ? p.hearing_mode.toUpperCase() : '';
        return {
          id: `hearing-${p.id}`,
          title: `Audiência${modeLabel ? ` - ${modeLabel}` : ''} - ${clientName}`,
          start_at: p.hearing_time ? `${p.hearing_date}T${p.hearing_time}` : p.hearing_date!,
          type: 'hearing',
          client_id: p.client_id,
        };
      });

    // Combinar e ordenar
    return [...manualEvents, ...hearingEvents]
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 10);
  }, [calendarEvents, processes, clients]);

  const pendingRequirementsList = awaitingRequirements
    .sort((a, b) => {
      const dateA = a.entry_date ? new Date(a.entry_date).getTime() : 0;
      const dateB = b.entry_date ? new Date(b.entry_date).getTime() : 0;
      return dateA - dateB;
    })
    .slice(0, 5);

  const awaitingDraftProcessesList = awaitingDraftProcesses
    .sort((a, b) => {
      const dateA = a.distributed_at ? new Date(a.distributed_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.distributed_at ? new Date(b.distributed_at).getTime() : new Date(b.created_at).getTime();
      return dateA - dateB;
    })
    .slice(0, 5);

  const pendingProcessesList = pendingProcesses
    .sort((a, b) => {
      const dateA = a.distributed_at ? new Date(a.distributed_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.distributed_at ? new Date(b.distributed_at).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA;
    })
    .slice(0, 5);

  const nowDate = new Date();
  const dayDescription = nowDate.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const newClientsThisMonth = clients.filter((client) => {
    if (!client.created_at) return false;
    const created = new Date(client.created_at);
    return created.getMonth() === nowDate.getMonth() && created.getFullYear() === nowDate.getFullYear();
  }).length;

  const newProcessesThisMonth = processes.filter((process) => {
    if (!process.created_at) return false;
    const created = new Date(process.created_at);
    return created.getMonth() === nowDate.getMonth() && created.getFullYear() === nowDate.getFullYear();
  }).length;

  const completedTasksCount = tasks.filter((task) => {
    const normalized = (task.status || '').toLowerCase();
    return normalized === 'completed' || normalized === 'done' || normalized === 'concluido';
  }).length;

  const totalTrackedTasks = completedTasksCount + pendingTasks;
  const tasksCompletionRate = totalTrackedTasks ? Math.round((completedTasksCount / totalTrackedTasks) * 100) : 0;

  const summaryCards = [
    {
      id: 'clients',
      label: 'Clientes',
      value: activeClients,
      helper: `${newClientsThisMonth} novos este mês`,
      accent: 'text-blue-600 bg-blue-50',
      icon: Users,
      action: 'clientes',
    },
    {
      id: 'processes',
      label: 'Processos',
      value: activeProcesses,
      helper: `${newProcessesThisMonth} iniciados`,
      accent: 'text-purple-600 bg-purple-50',
      icon: Briefcase,
      action: 'processos',
    },
    {
      id: 'deadlines',
      label: 'Prazos',
      value: pendingDeadlines,
      helper: 'pendentes',
      accent: 'text-rose-600 bg-rose-50',
      icon: CalendarDays,
      action: 'prazos',
    },
    {
      id: 'tasks',
      label: 'Tarefas',
      value: `${tasksCompletionRate}%`,
      helper: `${completedTasksCount}/${totalTrackedTasks} concluídas`,
      accent: 'text-amber-600 bg-amber-50',
      icon: CheckSquare,
      action: 'tarefas',
    },
  ];

  const handleNavigate = (moduleWithParams: string) => {
    if (!onNavigateToModule) return;
    
    // Extrair módulo e parâmetros da string (ex: "clients?mode=create")
    const [module, queryString] = moduleWithParams.split('?');
    
    if (queryString) {
      // Parsear query string em objeto de parâmetros
      const params: Record<string, string> = {};
      queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        params[key] = value;
      });
      onNavigateToModule(module, params);
    } else {
      onNavigateToModule(module);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  // Calcular saudação baseada na hora
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  // Calcular alertas urgentes
  const urgentAlerts = useMemo(() => {
    const alerts: { type: string; count: number; color: string; icon: React.ReactNode; action: string }[] = [];
    
    if (pendingDeadlines > 0) {
      const urgentDeadlines = deadlines.filter(d => {
        if (d.status !== 'pendente') return false;
        const dueDate = new Date(d.due_date!);
        const today = new Date();
        const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 3 && diffDays >= 0;
      }).length;
      if (urgentDeadlines > 0) {
        alerts.push({ type: 'Prazos Urgentes', count: urgentDeadlines, color: 'red', icon: <AlertTriangle className="w-5 h-5" />, action: 'prazos' });
      }
    }
    
    if (djenIntimacoes.length > 0) {
      alerts.push({ type: 'Intimações Não Lidas', count: djenIntimacoes.length, color: 'orange', icon: <Bell className="w-5 h-5" />, action: 'intimacoes' });
    }
    
    if (financialStats && financialStats.overdue_installments > 0) {
      alerts.push({ type: 'Parcelas Vencidas', count: financialStats.overdue_installments, color: 'amber', icon: <Wallet className="w-5 h-5" />, action: 'financeiro' });
    }
    
    return alerts;
  }, [pendingDeadlines, deadlines, djenIntimacoes, financialStats]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-amber-600 border-t-transparent"></div>
          <p className="text-slate-600">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 bg-slate-50 -m-6 p-4 sm:p-6 min-h-screen">

      {/* Header repaginado */}
      <DashboardHeader onNewClient={() => handleNavigate('clientes?mode=create')} />

      {/* Barra de Atenção / Alertas Urgentes */}
      {urgentAlerts.length > 0 && (
        <div className="flex items-center justify-between gap-2 sm:gap-4 rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 px-3 sm:px-5 py-2.5 sm:py-3 shadow-md">
          {/* Header */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
            <div className="relative flex-shrink-0">
              <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-orange-500 text-white">
                <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-red-500 text-white text-[9px] sm:text-[10px] font-bold border-2 border-slate-900">
                {urgentAlerts.reduce((sum, a) => sum + a.count, 0)}
              </span>
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-semibold text-white">Centro de Atenção</p>
              <p className="text-xs text-slate-400 truncate">
                {urgentAlerts.reduce((sum, a) => sum + a.count, 0)} itens precisam da sua atenção
              </p>
            </div>
          </div>

          {/* Botões de alerta */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
            {urgentAlerts.map((alert, index) => {
              const colorClass =
                alert.action === 'prazos' ? 'bg-red-500 hover:bg-red-600' :
                alert.action === 'intimacoes' ? 'bg-orange-500 hover:bg-orange-600' :
                'bg-amber-500 hover:bg-amber-600';

              return (
                <button
                  key={index}
                  onClick={() => handleNavigate(alert.action)}
                  className={`inline-flex items-center gap-1 sm:gap-2 rounded-lg ${colorClass} px-2.5 sm:px-4 py-1.5 sm:py-2 text-white text-[11px] sm:text-sm font-medium transition-colors flex-shrink-0`}
                >
                  <span className="font-bold">{alert.count}</span>
                  <span className="hidden sm:inline truncate max-w-[180px]">{alert.type}</span>
                  <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Estatísticas em linha única */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <button
          onClick={() => handleNavigate('clientes')}
          className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-200 transition-all text-left"
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold text-slate-900">{activeClients}</p>
              <p className="text-[10px] sm:text-xs text-slate-500">Clientes</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('processos')}
          className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-purple-200 transition-all text-left"
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500 flex items-center justify-center flex-shrink-0">
              <Gavel className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold text-slate-900">{activeProcesses}</p>
              <p className="text-[10px] sm:text-xs text-slate-500">Processos</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('prazos')}
          className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-red-200 transition-all text-left"
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-red-500 flex items-center justify-center flex-shrink-0">
              <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold text-slate-900">{pendingDeadlines}</p>
              <p className="text-[10px] sm:text-xs text-slate-500">Prazos</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('tarefas')}
          className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-amber-200 transition-all text-left"
        >
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold text-slate-900">{pendingTasks}</p>
              <p className="text-[10px] sm:text-xs text-slate-500">Tarefas</p>
            </div>
          </div>
        </button>
      </div>

      {/* Grid Principal - Agenda + Financeiro lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Widget de Agenda */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-lg overflow-hidden">
        <div className="relative">
          <div className="relative p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Agenda Jurídica</h2>
                  <p className="text-[10px] text-white/60">{upcomingEvents.length} compromisso{upcomingEvents.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>

            {upcomingEvents.length === 0 ? (
              <div className="bg-white/5 rounded-lg p-6 text-center border border-white/10">
                <Calendar className="w-10 h-10 text-white/30 mx-auto mb-2" />
                <p className="text-white/60 text-sm">Nenhum compromisso agendado</p>
                <button
                  onClick={() => handleNavigate('agenda')}
                  className="mt-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  Criar Compromisso
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {upcomingEvents.slice(0, 6).map((event, index) => {
                  const eventDate = new Date(event.start_at);
                  const isToday = eventDate.toDateString() === new Date().toDateString();
                  const isTomorrow = eventDate.toDateString() === new Date(Date.now() + 86400000).toDateString();
                  
                  return (
                    <div 
                      key={event.id} 
                      className="group relative bg-white/10 hover:bg-white/15 rounded-lg p-3 border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(event);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          isToday ? 'bg-amber-500 text-white' : isTomorrow ? 'bg-blue-500 text-white' : 'bg-white/20 text-white'
                        }`}>
                          {eventDate.getDate()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">
                            {event.title}
                          </p>
                          <p className="text-[10px] text-white/50">
                            {eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {isToday && <span className="ml-1 text-amber-400">• Hoje</span>}
                            {isTomorrow && <span className="ml-1 text-blue-400">• Amanhã</span>}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Botão Ver Agenda Completa */}
            <div className="mt-4 pt-3 border-t border-white/10">
              <button
                onClick={() => handleNavigate('agenda')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition-all"
              >
                Ver Agenda Completa
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        </div>

        {/* Controle Financeiro */}
        {financialStats && (
          <FinancialCard 
            stats={financialStats}
            onNavigate={() => handleNavigate('financeiro')}
          />
        )}
      </div>

      {/* Grid de 2 Colunas - Prazos e Tarefas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Próximos Prazos */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Próximos Prazos</h2>
                  <p className="text-xs text-slate-500">{upcomingDeadlines.length} pendente{upcomingDeadlines.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                onClick={() => handleNavigate('prazos')}
                className="flex items-center gap-1 text-red-500 hover:text-red-600 text-xs font-semibold"
              >
                Ver todos
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <div className="text-center py-8">
                <CalendarDays className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhum prazo pendente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {upcomingDeadlines.map((deadline) => {
                  const client = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                  const dueDate = new Date(deadline.due_date!);
                  const today = new Date();
                  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const isUrgent = diffDays <= 3;
                  
                  return (
                    <div
                      key={deadline.id}
                      onClick={() => handleNavigate('prazos')}
                      className={`flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all hover:scale-[1.02] ${
                        isUrgent ? 'bg-red-50 border border-red-100' : 'bg-slate-50 border border-slate-100'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isUrgent ? 'bg-red-100' : 'bg-slate-200'
                      }`}>
                        <span className="text-sm font-bold text-slate-700">
                          {dueDate.getDate()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">{deadline.title}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {client?.full_name || 'Sem cliente'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                          isUrgent ? 'bg-red-500 text-white' : 
                          deadline.priority === 'alta' ? 'bg-red-100 text-red-700' :
                          deadline.priority === 'media' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {isUrgent ? `${diffDays}d` : deadline.priority}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tarefas Recentes */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <CheckSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Tarefas Pendentes</h2>
                  <p className="text-xs text-slate-500">{recentTasks.length} tarefa{recentTasks.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                onClick={() => handleNavigate('tarefas')}
                className="flex items-center gap-1 text-emerald-500 hover:text-emerald-600 text-xs font-semibold"
              >
                Ver todas
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {recentTasks.length === 0 ? (
              <div className="text-center py-8">
                <CheckSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhuma tarefa pendente</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <div 
                    key={task.id} 
                    onClick={() => handleNavigate('tarefas')}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-emerald-50 hover:border-emerald-100 cursor-pointer transition-all hover:scale-[1.02]"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{task.title}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>

      {/* Grid de 4 Colunas - DJEN, Processos e Requerimentos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Widget de Intimações DJEN */}
        <div className="bg-gradient-to-br from-red-700 to-red-800 rounded-xl shadow-lg overflow-hidden">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Intimações DJEN</h2>
                  <p className="text-[10px] text-white/60">{djenIntimacoes.length} não lida{djenIntimacoes.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            </div>
            {djenIntimacoes.length === 0 ? (
              <div className="bg-white/10 rounded-lg p-4 text-center border border-white/10">
                <Scale className="w-6 h-6 text-white/30 mx-auto mb-1" />
                <p className="text-white/60 text-xs">Nenhuma intimação</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {djenIntimacoes.slice(0, 2).map((intimacao) => (
                  <div 
                    key={intimacao.id} 
                    className="bg-white/10 hover:bg-white/15 rounded-lg p-2 border border-white/10 cursor-pointer transition-all"
                    onClick={() => setSelectedIntimacao(intimacao)}
                  >
                    <p className="text-xs font-medium text-white truncate">{intimacao.tipo_comunicacao || 'Comunicação'}</p>
                    <p className="text-[10px] text-white/50 truncate">{intimacao.numero_processo_mascara}</p>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => handleNavigate('intimacoes')}
              className="w-full mt-3 flex items-center justify-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-xs transition-all"
            >
              Ver Todas <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Processos Aguardando Confecção */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">Aguardando Confecção</h2>
                <p className="text-xs text-slate-500">{awaitingDraftProcessesList.length} processo{awaitingDraftProcessesList.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('processos')}
              className="flex items-center gap-1 text-amber-500 hover:text-amber-600 text-xs font-semibold"
            >
              Ver
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {awaitingDraftProcessesList.length === 0 ? (
            <div className="text-center py-6">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum processo aguardando</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {awaitingDraftProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;
                return (
                  <div 
                    key={process.id} 
                    onClick={() => handleNavigate('processos')}
                    className="p-3 rounded-xl bg-amber-50 border border-amber-100 hover:bg-amber-100 cursor-pointer transition-all"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">{client?.full_name || 'Cliente não informado'}</p>
                    <p className="text-xs text-slate-500 truncate">{process.process_code || 'Sem código'}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Requerimentos Aguardando Confecção */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
                <Target className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">Requerimentos</h2>
                <p className="text-xs text-slate-500">{pendingRequirementsList.length} pendente{pendingRequirementsList.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('requerimentos')}
              className="flex items-center gap-1 text-purple-500 hover:text-purple-600 text-xs font-semibold"
            >
              Ver
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {pendingRequirementsList.length === 0 ? (
            <div className="text-center py-6">
              <Target className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum requerimento pendente</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {pendingRequirementsList.map((requirement) => (
                <div 
                  key={requirement.id} 
                  onClick={() => handleNavigate('requerimentos')}
                  className="p-3 rounded-xl bg-purple-50 border border-purple-100 hover:bg-purple-100 cursor-pointer transition-all"
                >
                  <p className="text-sm font-medium text-slate-900 truncate">{requirement.beneficiary || 'Sem beneficiário'}</p>
                  <p className="text-xs text-slate-500 truncate">Aguardando confecção</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Processos em Andamento */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                <Gavel className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">Em Andamento</h2>
                <p className="text-xs text-slate-500">{pendingProcessesList.length} processo{pendingProcessesList.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('processos')}
              className="flex items-center gap-1 text-blue-500 hover:text-blue-600 text-xs font-semibold"
            >
              Ver
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {pendingProcessesList.length === 0 ? (
            <div className="text-center py-6">
              <Gavel className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum processo em andamento</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {pendingProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;
                return (
                  <div 
                    key={process.id} 
                    onClick={() => handleNavigate('processos')}
                    className="p-3 rounded-xl bg-blue-50 border border-blue-100 hover:bg-blue-100 cursor-pointer transition-all"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">{client?.full_name || 'Cliente não informado'}</p>
                    <p className="text-xs text-slate-500 truncate">{process.process_code || 'Sem código'}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Detalhes do Evento */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-blue-50 to-white p-6 border-b border-slate-100">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedEvent.title}</h3>
                  <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
                    Compromisso
                  </span>
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-2 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {/* Tipo de Evento */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  selectedEvent.type === 'hearing' ? 'bg-red-500' :
                  selectedEvent.type === 'deadline' ? 'bg-blue-500' :
                  selectedEvent.type === 'payment' ? 'bg-green-500' :
                  'bg-purple-500'
                }`}></div>
                <span className="font-semibold text-slate-700">Tipo:</span>
                <span className="text-slate-600 capitalize">
                  {selectedEvent.type === 'deadline' && 'Prazo'}
                  {selectedEvent.type === 'hearing' && 'Audiência'}
                  {selectedEvent.type === 'requirement' && 'Exigência'}
                  {selectedEvent.type === 'payment' && 'Pagamento'}
                  {selectedEvent.type === 'meeting' && 'Reunião'}
                  {selectedEvent.type === 'pericia' && 'Perícia'}
                </span>
              </div>

              {/* Data */}
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-slate-600" />
                <div className="flex-1">
                  <span className="font-semibold text-slate-700">Data:</span>
                  <span className="text-slate-600 ml-2">
                    {new Date(selectedEvent.start_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Cliente */}
              {selectedEvent.client_id && (
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-slate-600" />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-700">Cliente:</span>
                    <span className="text-slate-600 ml-2">
                      {clientMap.get(selectedEvent.client_id)?.full_name || 'Cliente vinculado'}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setSelectedEvent(null);
                    handleNavigate('agenda');
                  }}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                >
                  Ver na Agenda
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Intimação */}
      {selectedIntimacao && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedIntimacao(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-red-50 to-white p-6 border-b border-slate-100">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedIntimacao.tipo_comunicacao || 'Comunicação'}</h3>
                  <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold uppercase">
                    {selectedIntimacao.sigla_tribunal}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedIntimacao(null)}
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full p-2 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-slate-600" />
                <div>
                  <span className="font-semibold text-slate-700">Data de Disponibilização:</span>
                  <span className="text-slate-600 ml-2">
                    {new Date(selectedIntimacao.data_disponibilizacao).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              <div>
                <span className="font-semibold text-slate-700">Processo:</span>
                <p className="text-slate-600 mt-1">{selectedIntimacao.numero_processo_mascara || selectedIntimacao.numero_processo}</p>
              </div>

              {selectedIntimacao.nome_orgao && (
                <div>
                  <span className="font-semibold text-slate-700">Órgão:</span>
                  <p className="text-slate-600 mt-1">{selectedIntimacao.nome_orgao}</p>
                </div>
              )}

              {selectedIntimacao.texto && (
                <div>
                  <span className="font-semibold text-slate-700">Texto:</span>
                  <p className="text-slate-600 mt-1 text-sm max-h-40 overflow-y-auto">{selectedIntimacao.texto}</p>
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setSelectedIntimacao(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setSelectedIntimacao(null);
                    handleNavigate('intimacoes');
                  }}
                  className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
                >
                  Ver Todas Intimações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
