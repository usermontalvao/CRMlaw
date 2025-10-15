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
} from 'lucide-react';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { taskService } from '../services/task.service';
import { calendarService } from '../services/calendar.service';
import { requirementService } from '../services/requirement.service';
import { financialService } from '../services/financial.service';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Deadline } from '../types/deadline.types';
import type { Task } from '../types/task.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { Requirement } from '../types/requirement.types';
import type { FinancialStats, Installment, Agreement } from '../types/financial.types';

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
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [
        clientsData,
        processesData,
        deadlinesData,
        tasksData,
        calendarEventsData,
        requirementsData,
        financialStatsData,
        allInstallmentsData,
      ] = await Promise.all([
        clientService.listClients(),
        processService.listProcesses(),
        deadlineService.listDeadlines(),
        taskService.listTasks(),
        calendarService.listEvents(),
        requirementService.listRequirements(),
        financialService.getFinancialStats(new Date().toISOString().slice(0, 7)),
        financialService.listAllInstallments(),
      ]);
      setClients(clientsData);
      setProcesses(processesData);
      setDeadlines(deadlinesData);
      setTasks(tasksData);
      setCalendarEvents(calendarEventsData);
      setRequirements(requirementsData);
      setFinancialStats(financialStatsData);
      
      // Filtrar parcelas vencidas
      const today = new Date().toISOString().split('T')[0];
      const overdue = allInstallmentsData
        .filter(inst => (inst.status === 'pendente' || inst.status === 'vencido') && inst.due_date < today)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .slice(0, 5);
      setOverdueInstallments(overdue);
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

      {/* Grid de 3 Colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Próximos Compromissos */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Próximos Compromissos</h2>
              <button
                onClick={() => handleNavigate('calendar')}
                className="text-blue-500 hover:text-blue-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhum compromisso agendado</p>
            ) : (
              <div className="space-y-2">
                {upcomingEvents.slice(0, 6).map((event) => (
                  <div key={event.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">
                        {new Date(event.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} - {event.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
