import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { taskService } from '../services/task.service';
import { calendarService } from '../services/calendar.service';
import { requirementService } from '../services/requirement.service';
import { financialService } from '../services/financial.service';
import { djenLocalService } from '../services/djenLocal.service';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Deadline } from '../types/deadline.types';
import type { Task } from '../types/task.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { Requirement } from '../types/requirement.types';
import type { FinancialStats, Installment, Agreement } from '../types/financial.types';
import type { DjenComunicacaoLocal } from '../types/djen.types';

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
};

const QuickAction: React.FC<QuickActionProps> = ({ title, description, icon, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-amber-300 hover:shadow-md"
  >
    <div className="rounded-lg bg-amber-50 p-3 text-amber-600">{icon}</div>
    <div className="flex-1">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600">{description}</p>
    </div>
  </button>
);

// Cache keys e configuração
const DASHBOARD_CACHE_KEY = 'crm-dashboard-cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedIntimacao, setSelectedIntimacao] = useState<DjenComunicacaoLocal | null>(null);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async (forceRefresh = false) => {
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
              console.log('📦 Carregando Dashboard do cache');
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

      // Carregar dados da API
      console.log('🔄 Carregando Dashboard da API');
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
        clientService.listClients(),
        processService.listProcesses(),
        deadlineService.listDeadlines(),
        taskService.listTasks(),
        calendarService.listEvents(),
        requirementService.listRequirements(),
        financialService.getFinancialStats(new Date().toISOString().slice(0, 7)),
        financialService.listAllInstallments(),
        djenLocalService.listComunicacoes({ lida: false }),
      ]);
      
      // Filtrar parcelas vencidas
      const today = new Date().toISOString().split('T')[0];
      const overdue = allInstallmentsData
        .filter(inst => (inst.status === 'pendente' || inst.status === 'vencido') && inst.due_date < today)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5);

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
      console.log('💾 Dashboard salvo no cache');
    } catch (error) {
      console.error('Erro ao carregar dados do dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const activeClients = clients.filter((c) => c.status === 'ativo').length;
  const activeProcesses = processes.length;
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

  const upcomingEvents = calendarEvents
    .filter((e) => e.start_at && new Date(e.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 10);

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

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-amber-600 border-t-transparent"></div>
          <p className="text-slate-600">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 bg-slate-50 -m-6 p-6 min-h-screen">
      {/* Grid Layout Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Estatísticas Gerais */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Estatísticas Gerais</h2>
            <button className="text-amber-500 hover:text-amber-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{activeClients}</p>
                <p className="text-xs text-slate-600">Clientes Ativos</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-50 border border-purple-100">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{activeProcesses}</p>
                <p className="text-xs text-slate-600">Processos</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
              <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{pendingDeadlines}</p>
                <p className="text-xs text-slate-600">Prazos Pendentes</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-100">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{pendingTasks}</p>
                <p className="text-xs text-slate-600">Tarefas Pendentes</p>
              </div>
            </div>
          </div>
        </div>

        {/* Controle Financeiro */}
        {financialStats && (
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Controle Financeiro</h2>
              <button className="text-amber-500 hover:text-amber-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">Honorários do mês</p>
                </div>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(financialStats.monthly_fees_received)}</p>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-emerald-100 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">Recebidos ({financialStats.paid_installments} parc.)</p>
                </div>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(financialStats.monthly_fees_received)}</p>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">Pendentes ({financialStats.pending_installments} parc.)</p>
                </div>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(financialStats.monthly_fees_pending)}</p>
              </div>

              <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded bg-red-100 flex items-center justify-center">
                    <X className="w-4 h-4 text-red-600" />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">Vencidos ({financialStats.overdue_installments} parc.)</p>
                </div>
                <p className="text-xl font-bold text-slate-900">{formatCurrency(financialStats.total_overdue)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Ações Rápidas */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Ações Rápidas</h2>
          <button className="text-amber-500 hover:text-amber-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            onClick={() => handleNavigate('clientes?mode=create')}
            className="flex items-center justify-center gap-2 p-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span className="text-sm font-semibold">Novo Cliente</span>
          </button>
          
          <button
            onClick={() => handleNavigate('processos?mode=create')}
            className="flex items-center justify-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            <span className="text-sm font-semibold">Processo</span>
          </button>
          
          <button
            onClick={() => handleNavigate('prazos?mode=create')}
            className="flex items-center justify-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            <span className="text-sm font-semibold">Prazo</span>
          </button>
          
          <button
            onClick={() => handleNavigate('tarefas?mode=create')}
            className="flex items-center justify-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <CheckSquare className="w-4 h-4" />
            <span className="text-sm font-semibold">Tarefa</span>
          </button>
          
          <button
            onClick={() => handleNavigate('financeiro')}
            className="flex items-center justify-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <DollarSign className="w-4 h-4" />
            <span className="text-sm font-semibold">Financeiro</span>
          </button>
        </div>
      </div>

      {/* Grid de Widgets Principais - Agenda e DJEN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Widget de Agenda - Destaque (2 colunas) */}
        <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-transparent to-purple-600/10" />
          <div className="relative p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Calendar className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Agenda Jurídica</h2>
                  <p className="text-xs text-white/70">Próximos compromissos e prazos</p>
                </div>
              </div>
              <button
                onClick={() => handleNavigate('agenda')}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition-all duration-200 hover:scale-105 border border-white/20"
              >
                Ver Agenda Completa →
              </button>
            </div>

            {upcomingEvents.length === 0 ? (
              <div className="bg-white/5 rounded-xl p-8 text-center border border-white/10">
                <Calendar className="w-12 h-12 text-white/30 mx-auto mb-3" />
                <p className="text-white/60 text-sm">Nenhum compromisso agendado</p>
                <button
                  onClick={() => handleNavigate('agenda')}
                  className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all"
                >
                  Criar Compromisso
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {upcomingEvents.slice(0, 6).map((event, index) => {
                  const eventDate = new Date(event.start_at);
                  const isToday = eventDate.toDateString() === new Date().toDateString();
                  const isTomorrow = eventDate.toDateString() === new Date(Date.now() + 86400000).toDateString();
                  
                  return (
                    <div 
                      key={event.id} 
                      className="group relative bg-white/10 hover:bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(event);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isToday ? 'bg-amber-500' : isTomorrow ? 'bg-blue-500' : 'bg-white/20'
                        }`}>
                          <Calendar className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-white/90">
                              {eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </span>
                            {isToday && (
                              <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                                HOJE
                              </span>
                            )}
                            {isTomorrow && (
                              <span className="px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full">
                                AMANHÃ
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-white truncate group-hover:text-blue-200 transition-colors">
                            {event.title}
                          </p>
                          <p className="text-xs text-white/60 mt-1">
                            {eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      {/* Seta indicando sequência */}
                      {index < upcomingEvents.slice(0, 6).length - 1 && (
                        <div className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 hidden lg:block">
                          <ChevronRight className="w-6 h-6 text-white/40" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Botão Ver Agenda Completa - Sempre Visível */}
            <div className="mt-6 pt-4 border-t border-white/10">
              <button
                onClick={() => handleNavigate('agenda')}
                className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl"
              >
                <Calendar className="w-5 h-5" />
                Ver Agenda Completa
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Widget de Intimações DJEN - Destaque (1 coluna) */}
      <div className="lg:col-span-1 bg-gradient-to-br from-red-900 via-red-800 to-red-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-orange-600/10 via-transparent to-red-600/10" />
          <div className="relative p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-lg">
                  <Bell className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Intimações DJEN</h2>
                  <p className="text-xs text-white/70">Comunicações não lidas do Diário Eletrônico</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {djenIntimacoes.length > 0 && (
                  <span className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full animate-pulse">
                    {djenIntimacoes.length} NOVA{djenIntimacoes.length > 1 ? 'S' : ''}
                  </span>
                )}
                <button
                  onClick={() => handleNavigate('intimacoes')}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-semibold transition-all duration-200 hover:scale-105 border border-white/20"
                >
                  Ver Todas →
                </button>
              </div>
            </div>

            {djenIntimacoes.length === 0 ? (
              <div className="bg-white/5 rounded-xl p-8 text-center border border-white/10">
                <Scale className="w-12 h-12 text-white/30 mx-auto mb-3" />
                <p className="text-white/60 text-sm">Nenhuma intimação não lida</p>
                <p className="text-white/40 text-xs mt-1">Todas as comunicações estão em dia</p>
              </div>
            ) : (
              <div className="space-y-3">
                {djenIntimacoes.slice(0, 3).map((intimacao) => {
                  const dataDisponibilizacao = new Date(intimacao.data_disponibilizacao);
                  const isRecent = Date.now() - dataDisponibilizacao.getTime() < 24 * 60 * 60 * 1000; // últimas 24h
                  
                  return (
                    <div 
                      key={intimacao.id} 
                      className="group bg-white/10 hover:bg-white/15 backdrop-blur-sm rounded-xl p-4 border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIntimacao(intimacao);
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isRecent ? 'bg-orange-500 animate-pulse' : 'bg-white/20'
                        }`}>
                          <Bell className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-white/90">
                              {dataDisponibilizacao.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </span>
                            <span className="text-xs text-white/60">•</span>
                            <span className="text-xs text-white/60 uppercase font-semibold">
                              {intimacao.sigla_tribunal}
                            </span>
                            {isRecent && (
                              <span className="px-2 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full">
                                NOVA
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-white truncate group-hover:text-red-200 transition-colors">
                            {intimacao.tipo_comunicacao || 'Comunicação'}
                          </p>
                          <p className="text-xs text-white/60 mt-1 truncate">
                            Processo: {intimacao.numero_processo_mascara || intimacao.numero_processo}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {/* Botão Ver Todas - Sempre Visível */}
            <div className="mt-6 pt-4 border-t border-white/10">
              <button
                onClick={() => handleNavigate('intimacoes')}
                className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white rounded-xl font-semibold transition-all duration-200 hover:scale-105 shadow-lg hover:shadow-xl"
              >
                <Bell className="w-5 h-5" />
                Ver Todas as Intimações
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Grid de 3 Colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Próximos Prazos */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Próximos Prazos</h2>
              <button
                onClick={() => handleNavigate('prazos')}
                className="text-red-500 hover:text-red-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhum prazo pendente</p>
            ) : (
              <div className="space-y-3">
                {upcomingDeadlines.map((deadline) => {
                  const client = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                  return (
                    <div
                      key={deadline.id}
                      className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                    >
                      <div className="rounded-lg bg-amber-100 p-2 text-amber-600">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{deadline.title}</p>
                        <p className="text-xs text-slate-600">
                          {client?.full_name || 'Sem cliente'} • Vencimento: {new Date(deadline.due_date!).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          deadline.priority === 'alta'
                            ? 'bg-red-100 text-red-700'
                            : deadline.priority === 'media'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {deadline.priority}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tarefas Recentes */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Tarefas Recentes</h2>
              <button
                onClick={() => handleNavigate('tarefas')}
                className="text-emerald-500 hover:text-emerald-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            {recentTasks.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhuma tarefa pendente</p>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <CheckSquare className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">{task.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>

      {/* Grid de 3 Colunas - Processos e Requerimentos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Processos Aguardando Confecção */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Processos Aguardando Confecção</h2>
            <button
              onClick={() => handleNavigate('processos')}
              className="text-amber-500 hover:text-amber-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {awaitingDraftProcessesList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum processo aguardando</p>
          ) : (
            <div className="space-y-2">
              {awaitingDraftProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;
                return (
                  <div key={process.id} className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-slate-900">{client?.full_name || 'Cliente não informado'}</p>
                      <button
                        onClick={() => handleNavigate('processos')}
                        className="text-amber-600 hover:text-amber-700"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-slate-600">{process.process_code || 'Processo sem código'}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Requerimentos Aguardando Confecção */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Requerimentos Aguardando Confecção</h2>
            <button
              onClick={() => handleNavigate('requirements')}
              className="text-purple-500 hover:text-purple-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {pendingRequirementsList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum requerimento aguardando</p>
          ) : (
            <div className="space-y-2">
              {pendingRequirementsList.map((requirement) => (
                <div key={requirement.id} className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-900">{requirement.beneficiary || 'Sem beneficiário'}</p>
                    <button
                      onClick={() => handleNavigate('requirements')}
                      className="text-purple-600 hover:text-purple-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">Cliente: {requirement.beneficiary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Processos em Andamento */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Processos em Andamento</h2>
            <button
              onClick={() => handleNavigate('processos')}
              className="text-blue-500 hover:text-blue-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {pendingProcessesList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum processo em andamento</p>
          ) : (
            <div className="space-y-2">
              {pendingProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;
                return (
                  <div key={process.id} className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-slate-900">{client?.full_name || 'Cliente não informado'}</p>
                      <button
                        onClick={() => handleNavigate('processos')}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-slate-600">{process.process_code || 'Processo sem código'}</p>
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
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="font-semibold text-slate-700">Tipo:</span>
                <span className="text-slate-600 capitalize">
                  {selectedEvent.event_type === 'deadline' && 'Prazo'}
                  {selectedEvent.event_type === 'hearing' && 'Audiência'}
                  {selectedEvent.event_type === 'requirement' && 'Exigência'}
                  {selectedEvent.event_type === 'payment' && 'Pagamento'}
                  {selectedEvent.event_type === 'meeting' && 'Reunião'}
                  {selectedEvent.event_type === 'pericia' && 'Perícia'}
                </span>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  selectedEvent.status === 'concluido' ? 'bg-green-500' : 
                  selectedEvent.status === 'cancelado' ? 'bg-red-500' : 'bg-amber-500'
                }`}></div>
                <span className="font-semibold text-slate-700">Status:</span>
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  selectedEvent.status === 'concluido' ? 'bg-green-100 text-green-700' : 
                  selectedEvent.status === 'cancelado' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {selectedEvent.status === 'pendente' && 'Pendente'}
                  {selectedEvent.status === 'concluido' && 'Concluído'}
                  {selectedEvent.status === 'cancelado' && 'Cancelado'}
                </span>
              </div>

              {/* Data de Início */}
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-slate-600" />
                <div className="flex-1">
                  <span className="font-semibold text-slate-700">Data de Início:</span>
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

              {/* Data de Término */}
              {selectedEvent.end_at && (
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-600" />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-700">Data de Término:</span>
                    <span className="text-slate-600 ml-2">
                      {new Date(selectedEvent.end_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              )}

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

              {/* Notificação */}
              {selectedEvent.notify_minutes_before && (
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-slate-600" />
                  <div className="flex-1">
                    <span className="font-semibold text-slate-700">Notificar:</span>
                    <span className="text-slate-600 ml-2">
                      {selectedEvent.notify_minutes_before} minutos antes
                    </span>
                  </div>
                </div>
              )}

              {/* Descrição */}
              {selectedEvent.description && (
                <div className="border-t border-slate-200 pt-4">
                  <span className="font-semibold text-slate-700 block mb-2">Descrição:</span>
                  <p className="text-slate-600 text-sm whitespace-pre-wrap bg-slate-50 p-3 rounded-lg">
                    {selectedEvent.description}
                  </p>
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

      {/* Footer Stats */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{clients.length}</span>
            <span>Clientes</span>
          </div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{processes.length}</span>
            <span>Processos</span>
          </div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{tasks.filter((t) => t.status === 'completed').length}</span>
            <span>Tarefas Concluídas</span>
          </div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{awaitingRequirements.length}</span>
            <span>Aguardando Confecção</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
