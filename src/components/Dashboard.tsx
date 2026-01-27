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
  RefreshCw,
  Eye,
  Sparkles,
  User,
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
import { QuickActions } from './dashboard/QuickActions';
import { profileService } from '../services/profile.service';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { usePermissions } from '../hooks/usePermissions';

interface DashboardProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, string>) => void;
  params?: any;
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
const DASHBOARD_CACHE_VERSION = 2;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos (mais frequente para agenda)
const REQUEST_TIMEOUT_MS = 15000; // 15s por requisição pesada

interface DashboardCache {
  version: number;
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

const parseLocalDateTime = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  }

  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = m[6] ? Number(m[6]) : 0;
    return new Date(y, mo - 1, d, hh, mm, ss, 0);
  }

  return new Date(value);
};

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToModule }) => {
  // Adicionar animação CSS dinamicamente
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes wave {
        0% { transform: rotate(0deg); }
        25% { transform: rotate(20deg); }
        75% { transform: rotate(-10deg); }
        100% { transform: rotate(0deg); }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);
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
  const [userName, setUserName] = useState<string>('');
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
            const cacheValid =
              cache?.version === DASHBOARD_CACHE_VERSION &&
              typeof cache?.timestamp === 'number' &&
              cache?.data &&
              Array.isArray(cache.data.clients) &&
              Array.isArray(cache.data.processes) &&
              Array.isArray(cache.data.deadlines) &&
              Array.isArray(cache.data.tasks) &&
              Array.isArray(cache.data.calendarEvents) &&
              Array.isArray(cache.data.requirements) &&
              typeof cache.data.financialStats !== 'undefined' &&
              Array.isArray(cache.data.overdueInstallments) &&
              Array.isArray(cache.data.djenIntimacoes);
            
            // Verificar se o cache ainda é válido
            if (cacheValid && now - cache.timestamp < CACHE_DURATION) {
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
                  const eventDate = parseLocalDateTime(e.start_at);
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
        version: DASHBOARD_CACHE_VERSION,
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
      try {
        localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
      } catch (cacheError) {
        // Se localStorage estiver cheio, limpa caches antigos e tenta novamente
        console.warn('Cache cheio, limpando dados antigos...');
        try {
          // Remove caches antigos do CRM
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('crm-') || key.startsWith('syncfusion-') || key.startsWith('petition-'))) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => localStorage.removeItem(key));
          // Tenta salvar novamente
          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
        } catch {
          // Se ainda falhar, ignora o cache
          console.warn('Não foi possível salvar cache do dashboard');
        }
      }
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
    const loadUserName = async () => {
      try {
        const profile = await profileService.getMyProfile();
        const fullName = profile?.name || '';
        const firstName = fullName.split(' ')[0];
        setUserName(firstName);
      } catch (error) {
        console.warn('Não foi possível carregar o nome do usuário:', error);
      }
    };
    
    loadUserName();
  }, []);

  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 Dashboard: Mudança de clientes detectada, recarregando...');
      loadDashboardData(true); // Forçar recarregamento ignorando cache
    });
    
    return () => unsubscribe();
  }, [loadDashboardData]);

  const { canView, canCreate, loading: permissionsLoading } = usePermissions();

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
        const eventDate = parseLocalDateTime(e.start_at);
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
        const hearingDate = parseLocalDateTime(p.hearing_date!);
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
      .sort((a, b) => parseLocalDateTime(a.start_at).getTime() - parseLocalDateTime(b.start_at).getTime())
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
        alerts.push({ type: 'Prazos Urgentes', count: urgentDeadlines, color: 'red', icon: <AlertTriangle className="w-4 h-4" />, action: 'prazos' });
      }
    }
    
    if (djenIntimacoes.length > 0) {
      alerts.push({ type: 'Intimações Não Lidas', count: djenIntimacoes.length, color: 'orange', icon: <Bell className="w-4 h-4" />, action: 'intimacoes' });
    }
    
    if (financialStats && financialStats.overdue_installments > 0) {
      alerts.push({ type: 'Parcelas Vencidas', count: financialStats.overdue_installments, color: 'amber', icon: <Wallet className="w-4 h-4" />, action: 'financeiro' });
    }
    
    return alerts;
  }, [pendingDeadlines, deadlines, djenIntimacoes, financialStats]);

  if (loading || permissionsLoading) {
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
    <div className="space-y-4 sm:space-y-6 bg-slate-50/50 -m-6 p-3 sm:p-6 min-h-screen">

      {/* Header - Tudo em uma linha */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        {/* Esquerda: Saudação e Estatísticas */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          {/* Saudação e Nome */}
          <div className="flex items-center gap-2">
            <p className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider">{getGreeting()}</p>
            <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900">
              {userName || 'Dashboard'}
            </h1>
            {userName && (
              <span
                className="text-base sm:text-xl leading-none select-none"
                style={{
                  animation: 'wave 1s ease-in-out infinite',
                  transformOrigin: '70% 70%',
                  display: 'inline-block',
                }}
              >
                👋
              </span>
            )}
          </div>

          {/* Estatísticas */}
          <div className="flex items-center gap-2 sm:gap-3">
            {canView('clientes') && (
              <button
                onClick={() => handleNavigate('clientes')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-all text-xs sm:text-sm"
              >
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{activeClients}</span>
                <span className="text-blue-600 hidden sm:inline">clientes</span>
                {newClientsThisMonth > 0 && (
                  <span className="text-blue-500 font-medium">+{newClientsThisMonth}</span>
                )}
              </button>
            )}
            {canView('processos') && (
              <button
                onClick={() => handleNavigate('processos')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 transition-all text-xs sm:text-sm"
              >
                <Gavel className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{activeProcesses}</span>
                <span className="text-purple-600 hidden sm:inline">processos</span>
              </button>
            )}
            {canView('prazos') && (
              <button
                onClick={() => handleNavigate('prazos')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 transition-all text-xs sm:text-sm"
              >
                <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{pendingDeadlines}</span>
                <span className="text-red-600 hidden sm:inline">prazos</span>
              </button>
            )}
            {canView('tarefas') && (
              <button
                onClick={() => handleNavigate('tarefas')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all text-xs sm:text-sm"
              >
                <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="font-semibold">{pendingTasks}</span>
                <span className="text-emerald-600 hidden sm:inline">tarefas</span>
              </button>
            )}
          </div>
        </div>

        {/* Direita: Botão Novo Cliente e Badges de Alerta */}
        <div className="flex items-center gap-2">
          {/* Badges de Alerta */}
          {urgentAlerts.length > 0 && (
            <div className="flex items-center gap-2">
              {urgentAlerts.filter((a) => canView(a.action)).map((alert, index) => (
                <button
                  key={index}
                  onClick={() => handleNavigate(alert.action)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                    alert.action === 'prazos'
                      ? 'border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100'
                      : alert.action === 'intimacoes'
                        ? 'border-orange-200 bg-orange-50/70 text-orange-700 hover:bg-orange-100'
                        : 'border-amber-200 bg-amber-50/70 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  {alert.icon}
                  <span>
                    {alert.action === 'prazos'
                      ? 'Prazos'
                      : alert.action === 'intimacoes'
                        ? 'Intimações'
                        : 'Financeiro'}
                  </span>
                  <span className="font-bold">{alert.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Botão Novo Cliente */}
          {canView('clientes') && canCreate('clientes') && (
            <button
              onClick={() => handleNavigate('clientes?mode=create')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-medium rounded-lg transition-all"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Novo Cliente</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid Principal - Agenda + Financeiro */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="flex flex-col gap-4">
          {/* Widget de Agenda - Design Limpo */}
          {canView('agenda') && (
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-blue-100 flex items-center justify-center">
                    <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Agenda</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500">{upcomingEvents.length} próximo{upcomingEvents.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <button
                    onClick={() => loadDashboardData(true)}
                    className="text-[10px] sm:text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    title="Atualizar agenda"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleNavigate('agenda')}
                    className="text-[10px] sm:text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <span className="hidden sm:inline">Ver todos</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-2 sm:p-3">
              {upcomingEvents.length === 0 ? (
                <div className="text-center py-4 sm:py-6">
                  <Calendar className="w-8 h-8 sm:w-10 sm:h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-500 text-[10px] sm:text-xs">Nenhum compromisso</p>
                  <button
                    onClick={() => handleNavigate('agenda')}
                    className="mt-2 sm:mt-3 px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors"
                  >
                    Criar Compromisso
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {upcomingEvents.slice(0, 4).map((event) => {
                    const eventDate = parseLocalDateTime(event.start_at);
                    const now = new Date();
                    now.setHours(0, 0, 0, 0);
                    const tomorrow = new Date(now.getTime() + 86400000);
                    const isToday = eventDate >= now && eventDate < tomorrow;
                    const isTomorrow = eventDate >= tomorrow && eventDate < new Date(tomorrow.getTime() + 86400000);
                    
                    return (
                      <div 
                        key={event.id} 
                        className="group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors border border-slate-100"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${
                          isToday ? 'bg-blue-500 text-white' : isTomorrow ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          <span className="text-xs sm:text-sm font-bold leading-none">{eventDate.getDate()}</span>
                          <span className="text-[8px] uppercase">{eventDate.toLocaleDateString('pt-BR', { month: 'short' })}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">{event.title}</p>
                          <p className="text-[10px] sm:text-xs text-slate-500">
                            {eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {isToday && <span className="ml-1 text-blue-600 font-medium">Hoje</span>}
                            {isTomorrow && <span className="ml-1 text-blue-500">Amanhã</span>}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

          {/* Tarefas Pendentes */}
          {canView('tarefas') && (
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-emerald-100 flex items-center justify-center">
                    <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-semibold text-slate-900">Tarefas</h2>
                    <p className="text-[10px] sm:text-xs text-slate-500">{recentTasks.length} pendente{recentTasks.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleNavigate('tarefas')}
                  className="text-xs sm:text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                >
                  <span className="hidden sm:inline">Ver todas</span>
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>
            </div>
            <div className="p-2 sm:p-3">
              {recentTasks.length === 0 ? (
                <div className="text-center py-6 sm:py-8">
                  <CheckSquare className="w-10 h-10 sm:w-12 sm:h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-500 text-xs sm:text-sm">Nenhuma tarefa pendente</p>
                </div>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {recentTasks.map((task) => (
                    <div 
                      key={task.id} 
                      onClick={() => handleNavigate('tarefas')}
                      className="group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg sm:rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">{task.title}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:gap-4 h-full">
          {/* Ações Rápidas - Botões com mais espaço */}
          {(canView('clientes') || canView('prazos') || canView('tarefas') || canView('agenda') || canView('requerimentos') || canView('processos') || canView('financeiro')) && (
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="p-2.5 sm:p-3 border-b border-slate-100">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Ações rápidas</h3>
                  <p className="text-[10px] sm:text-xs text-slate-500">Crie itens em 1 clique</p>
                </div>
              </div>
            </div>
            <div className="p-2 sm:p-3">
              <QuickActions onNavigate={handleNavigate} canView={canView} canCreate={canCreate} />
            </div>
          </div>
          )}

          {canView('financeiro') && financialStats && (
            <FinancialCard 
              stats={financialStats}
              onNavigate={() => handleNavigate('financeiro')}
            />
          )}

          {canView('prazos') && (
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="p-3 sm:p-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-red-100 flex items-center justify-center">
                    <CalendarDays className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Prazos</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500">{upcomingDeadlines.length} pendente{upcomingDeadlines.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleNavigate('prazos')}
                  className="text-[10px] sm:text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
                >
                  <span className="hidden sm:inline">Ver todos</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="p-2 sm:p-3">
              {upcomingDeadlines.length === 0 ? (
                <div className="text-center py-4 sm:py-6">
                  <CalendarDays className="w-8 h-8 sm:w-10 sm:h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-500 text-[10px] sm:text-xs">Nenhum prazo pendente</p>
                </div>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {upcomingDeadlines.map((deadline) => {
                    const client = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                    const dueDate = new Date(deadline.due_date!);
                    const today = new Date();
                    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    const isUrgent = diffDays <= 3 && diffDays >= 0;
                    
                    return (
                      <div
                        key={deadline.id}
                        onClick={() => handleNavigate('prazos')}
                        className="group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors border border-slate-100"
                      >
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex flex-col items-center justify-center flex-shrink-0 ${
                          isUrgent ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          <span className="text-[10px] sm:text-sm font-bold leading-none">{dueDate.getDate()}</span>
                          <span className="text-[8px] sm:text-[9px] uppercase">{dueDate.toLocaleDateString('pt-BR', { month: 'short' })}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">{deadline.title}</p>
                          <p className="text-[10px] sm:text-xs text-slate-500 truncate">{client?.full_name || 'Sem cliente'}</p>
                        </div>
                        <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[8px] sm:text-[9px] font-semibold rounded-md ${
                          isUrgent ? 'bg-red-500 text-white' :
                          deadline.priority === 'alta' ? 'bg-red-100 text-red-700' :
                          deadline.priority === 'media' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {isUrgent ? (diffDays === 0 ? 'Hoje' : `${diffDays}d`) : (deadline.priority || 'normal')}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Grid de 3 Colunas - Intimações, Aguardando, Requerimentos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Widget de Intimações */}
        {canView('intimacoes') && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-orange-100 flex items-center justify-center">
                <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Intimações</h3>
                <p className="text-[10px] sm:text-xs text-slate-500">{djenIntimacoes.length} não lida{djenIntimacoes.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('intimacoes')}
              className="text-[10px] sm:text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
            >
              <span className="hidden sm:inline">Ver todas</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-2 sm:p-3">
            {djenIntimacoes.length === 0 ? (
              <div className="text-center py-6 sm:py-8">
                <Scale className="w-10 h-10 sm:w-12 sm:h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-xs sm:text-sm">Nenhuma intimação</p>
              </div>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {djenIntimacoes.slice(0, 3).map((intimacao) => (
                  <div 
                    key={intimacao.id} 
                    className="group p-2 sm:p-3 rounded-lg sm:rounded-xl hover:bg-slate-50 cursor-pointer transition-colors border border-slate-100"
                    onClick={() => setSelectedIntimacao(intimacao)}
                  >
                    <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                      <span className="px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-semibold rounded-full bg-orange-100 text-orange-700">
                        {intimacao.tipo_comunicacao || 'Intimação'}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                    <p className="text-[10px] sm:text-xs font-medium text-slate-900 truncate mb-1">
                      {intimacao.numero_processo_mascara || intimacao.numero_processo}
                    </p>
                    {intimacao.nome_orgao && (
                      <p className="text-[9px] sm:text-[10px] text-slate-500 truncate mb-1">
                        {intimacao.nome_orgao}
                      </p>
                    )}
                    {(intimacao.polo_ativo || intimacao.polo_passivo) && (
                      <div className="text-[9px] sm:text-[10px] text-slate-600 mt-1 pt-1 border-t border-slate-100">
                        {intimacao.polo_ativo && (
                          <p className="truncate"><span className="text-slate-400">Autor:</span> {intimacao.polo_ativo}</p>
                        )}
                        {intimacao.polo_passivo && (
                          <p className="truncate"><span className="text-slate-400">Réu:</span> {intimacao.polo_passivo}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Processos Aguardando Confecção */}
        {canView('processos') && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-amber-100 flex items-center justify-center">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Aguardando</h3>
                <p className="text-[10px] sm:text-xs text-slate-500">{awaitingDraftProcessesList.length} processo{awaitingDraftProcessesList.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('processos')}
              className="text-[10px] sm:text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
            >
              <span className="hidden sm:inline">Ver todos</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-2 sm:p-3">
            {awaitingDraftProcessesList.length === 0 ? (
              <div className="text-center py-6 sm:py-8">
                <FileText className="w-10 h-10 sm:w-12 sm:h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-xs sm:text-sm">Nenhum processo</p>
              </div>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {awaitingDraftProcessesList.slice(0, 4).map((process) => {
                  const client = process.client_id ? clientMap.get(process.client_id) : null;
                  return (
                    <div 
                      key={process.id} 
                      onClick={() => handleNavigate('processos')}
                      className="group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg sm:rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">{client?.full_name || 'Cliente'}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Requerimentos */}
        {canView('requerimentos') && (
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/60 overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-100 flex items-center justify-center">
                <Target className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">Requerimentos</h3>
                <p className="text-[10px] sm:text-xs text-slate-500">{pendingRequirementsList.length} pendente{pendingRequirementsList.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => handleNavigate('requerimentos')}
              className="text-[10px] sm:text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
            >
              <span className="hidden sm:inline">Ver todos</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="p-2 sm:p-3">
            {pendingRequirementsList.length === 0 ? (
              <div className="text-center py-6 sm:py-8">
                <Target className="w-10 h-10 sm:w-12 sm:h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500 text-xs sm:text-sm">Nenhum requerimento</p>
              </div>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {pendingRequirementsList.slice(0, 4).map((requirement) => (
                  <div 
                    key={requirement.id} 
                    onClick={() => handleNavigate('requerimentos')}
                    className="group flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg sm:rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-slate-900 truncate">{requirement.beneficiary || 'Beneficiário'}</p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}

      </div>

      {/* Modal de Detalhes do Evento */}
      {selectedEvent && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-2 sm:px-4 py-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSelectedEvent(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg max-h-[90vh] sm:max-h-[92vh] bg-white !bg-white rounded-xl sm:rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1.5 sm:h-2 w-full bg-orange-500" />
            <div className="px-4 sm:px-6 py-3 sm:py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Detalhes
                </p>
                <h3 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 truncate">{selectedEvent.title}</h3>
                <span className="inline-flex items-center gap-1 mt-2 sm:mt-3 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-blue-100 text-blue-700 text-[10px] sm:text-xs font-semibold">
                  Compromisso
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg sm:rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            <div className="p-3 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto">
              {/* Tipo de Evento */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 sm:w-2 h-1.5 sm:h-2 rounded-full ${
                  selectedEvent.type === 'hearing' ? 'bg-red-500' :
                  selectedEvent.type === 'deadline' ? 'bg-blue-500' :
                  selectedEvent.type === 'payment' ? 'bg-green-500' :
                  'bg-purple-500'
                }`}></div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Tipo:</span>
                <span className="text-xs sm:text-sm text-slate-600 capitalize">
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
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                <div className="flex-1">
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Data:</span>
                  <span className="text-xs sm:text-sm text-slate-600 ml-2">
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
                  <Users className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                  <div className="flex-1">
                    <span className="text-xs sm:text-sm font-semibold text-slate-700">Cliente:</span>
                    <span className="text-xs sm:text-sm text-slate-600 ml-2">
                      {clientMap.get(selectedEvent.client_id)?.full_name || 'Cliente vinculado'}
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="w-full sm:w-auto px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setSelectedEvent(null);
                    handleNavigate('agenda');
                  }}
                  className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg sm:rounded-xl transition"
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-2 sm:px-4 py-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSelectedIntimacao(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg max-h-[90vh] sm:max-h-[92vh] bg-white !bg-white rounded-xl sm:rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1.5 sm:h-2 w-full bg-orange-500" />
            <div className="px-4 sm:px-6 py-3 sm:py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                  DJEN
                </p>
                <h3 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 truncate">{selectedIntimacao.tipo_comunicacao || 'Comunicação'}</h3>
                <span className="inline-flex items-center gap-1 mt-2 sm:mt-3 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-orange-100 text-orange-700 text-[10px] sm:text-xs font-semibold uppercase">
                  {selectedIntimacao.sigla_tribunal}
                </span>
              </div>
              <button
                onClick={() => setSelectedIntimacao(null)}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg sm:rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            <div className="p-3 sm:p-6 space-y-3 sm:space-y-4 overflow-y-auto">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                <div className="flex-1">
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Data de Disponibilização:</span>
                  <span className="text-xs sm:text-sm text-slate-600 ml-2">
                    {new Date(selectedIntimacao.data_disponibilizacao).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-xs sm:text-sm font-semibold text-slate-700">Processo:</span>
                <p className="text-xs sm:text-sm text-slate-600 mt-1">{selectedIntimacao.numero_processo_mascara || selectedIntimacao.numero_processo}</p>
              </div>

              {selectedIntimacao.nome_orgao && (
                <div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Órgão:</span>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">{selectedIntimacao.nome_orgao}</p>
                </div>
              )}

              {selectedIntimacao.texto && (
                <div>
                  <span className="text-xs sm:text-sm font-semibold text-slate-700">Texto:</span>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 max-h-40 overflow-y-auto">{selectedIntimacao.texto}</p>
                </div>
              )}

              <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-end gap-2 sm:gap-3">
                <button
                  onClick={() => setSelectedIntimacao(null)}
                  className="w-full sm:w-auto px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setSelectedIntimacao(null);
                    handleNavigate('intimacoes');
                  }}
                  className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg sm:rounded-xl transition"
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
