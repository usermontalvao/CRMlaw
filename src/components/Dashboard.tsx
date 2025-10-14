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
    <div className="space-y-6 bg-gradient-to-br from-slate-50 to-slate-100 -m-6 p-6 min-h-screen">
      {/* Header Melhorado */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-600 mt-1">Visão geral do escritório</p>
        </div>
        {financialStats && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <p className="text-xs text-emerald-700 font-medium">Honorários do mês</p>
            <p className="text-xl font-bold text-emerald-900">{formatCurrency(financialStats.monthly_fees_received)}</p>
          </div>
        )}
      </div>

      {/* Estatísticas Principais */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          onClick={() => handleNavigate('clientes')}
          className="group flex flex-col gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-blue-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg">
              <Users className="h-6 w-6" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Clientes Ativos</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{activeClients}</p>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('processos')}
          className="group flex flex-col gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-indigo-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <Briefcase className="h-6 w-6" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Processos</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{activeProcesses}</p>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('prazos')}
          className="group flex flex-col gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-amber-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white shadow-lg">
              <Clock className="h-6 w-6" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Prazos Pendentes</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{pendingDeadlines}</p>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('tarefas')}
          className="group flex flex-col gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-emerald-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg">
              <CheckSquare className="h-6 w-6" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tarefas Pendentes</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{pendingTasks}</p>
          </div>
        </button>

        <button
          onClick={() => handleNavigate('financeiro')}
          className="group flex flex-col gap-3 rounded-xl border-2 border-slate-200 bg-white p-4 text-left hover:border-green-400 hover:shadow-lg transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white shadow-lg">
              <DollarSign className="h-6 w-6" />
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">A Receber</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {financialStats ? formatCurrency(financialStats.monthly_fees_pending) : '--'}
            </p>
          </div>
        </button>
      </div>

      {/* Layout 2 Colunas - Financeiro e Parcelas Vencidas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Widget Financeiro Compacto - 2/3 */}
        {financialStats && (
          <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">Financeiro</h2>
              <button
                onClick={() => handleNavigate('financial')}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Ver tudo
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="border border-emerald-200 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="h-6 w-6 rounded bg-emerald-100 flex items-center justify-center">
                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">Recebidos</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(financialStats.monthly_fees_received)}</p>
                <p className="text-xs text-slate-500">{financialStats.paid_installments} parc.</p>
              </div>

              <div className="border border-amber-200 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="h-6 w-6 rounded bg-amber-100 flex items-center justify-center">
                    <Clock className="w-3 h-3 text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">Pendentes</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(financialStats.monthly_fees_pending)}</p>
                <p className="text-xs text-slate-500">{financialStats.pending_installments} parc.</p>
              </div>

              <div className="border border-red-200 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="h-6 w-6 rounded bg-red-100 flex items-center justify-center">
                    <AlertCircle className="w-3 h-3 text-red-600" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">Vencidos</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(financialStats.total_overdue)}</p>
                <p className="text-xs text-slate-500">{financialStats.overdue_installments} parc.</p>
              </div>
            </div>
          </div>
        )}

        {/* Widget Parcelas Vencidas Compacto - 1/3 - COM URGÊNCIA */}
        {overdueInstallments.length > 0 && (
          <div className="lg:col-span-1 bg-gradient-to-br from-red-50 to-red-100 rounded-lg border-2 border-red-300 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-lg bg-red-600 flex items-center justify-center animate-pulse">
                <AlertCircle className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xs font-bold text-red-900">Parcelas Vencidas</h3>
                <p className="text-xs text-red-700">{overdueInstallments.length} pend.</p>
              </div>
            </div>
            
            <div className="space-y-1.5">
              {overdueInstallments.map((inst) => {
                const client = inst.agreement?.client_id ? clientMap.get(inst.agreement.client_id) : null;
                const clientName = client?.full_name || (client as any)?.name || 'Cliente não identificado';
                const daysOverdue = Math.floor((new Date().getTime() - new Date(inst.due_date).getTime()) / (1000 * 60 * 60 * 24));
                const feeValue = inst.agreement ? inst.agreement.fee_value / inst.agreement.installments_count : 0;
                
                return (
                  <div 
                    key={inst.id} 
                    onClick={() => handleNavigate('financial')}
                    className="bg-white rounded-lg border border-red-200 p-2 hover:border-red-400 hover:shadow-md transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-white">{daysOverdue}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-xs truncate">{clientName}</p>
                        <p className="text-xs text-slate-600">Parc. {inst.installment_number}/{inst.agreement?.installments_count || '?'}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-slate-900">{formatCurrency(feeValue)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <button
              onClick={() => handleNavigate('financial')}
              className="w-full mt-2 bg-red-600 hover:bg-red-700 text-white py-1.5 px-3 rounded-lg text-xs font-semibold transition"
            >
              Ver todas
            </button>
          </div>
        )}
      </div>

      {/* Ações Rápidas */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Ações Rápidas</h2>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            onClick={() => handleNavigate('clientes?mode=create')}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white transition shadow-md hover:shadow-lg flex-shrink-0"
          >
            <Users className="h-5 w-5" />
            <span className="text-sm font-semibold">Novo Cliente</span>
          </button>
          <button
            onClick={() => handleNavigate('processos?mode=create')}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white transition shadow-md hover:shadow-lg flex-shrink-0"
          >
            <Briefcase className="h-5 w-5" />
            <span className="text-sm font-semibold">Novo Processo</span>
          </button>
          <button
            onClick={() => handleNavigate('prazos?mode=create')}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white transition shadow-md hover:shadow-lg flex-shrink-0"
          >
            <Clock className="h-5 w-5" />
            <span className="text-sm font-semibold">Novo Prazo</span>
          </button>
          <button
            onClick={() => handleNavigate('tarefas?mode=create')}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white transition shadow-md hover:shadow-lg flex-shrink-0"
          >
            <CheckSquare className="h-5 w-5" />
            <span className="text-sm font-semibold">Nova Tarefa</span>
          </button>
          <button
            onClick={() => handleNavigate('financeiro')}
            className="group flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white transition shadow-md hover:shadow-lg flex-shrink-0"
          >
            <CircleDollarSign className="h-5 w-5" />
            <span className="text-sm font-semibold">Financeiro</span>
          </button>
        </div>
      </div>

      {/* Main Content - 2 Columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Upcoming Events */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Próximos Compromissos</h2>
              <button
                onClick={() => handleNavigate('calendar')}
                className="text-sm font-medium text-amber-600 hover:text-amber-700"
              >
                Ver agenda
              </button>
            </div>
            {upcomingEvents.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhum compromisso agendado</p>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="rounded-lg bg-purple-100 p-2 text-purple-600">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{event.title}</p>
                      <p className="text-xs text-slate-600">
                        {new Date(event.start_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        event.event_type === 'hearing'
                          ? 'bg-red-100 text-red-700'
                          : event.event_type === 'meeting'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {event.event_type === 'hearing' ? 'Audiência' : event.event_type === 'meeting' ? 'Reunião' : event.event_type}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Deadlines */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Próximos Prazos</h2>
              <button
                onClick={() => handleNavigate('deadlines')}
                className="text-sm font-medium text-amber-600 hover:text-amber-700"
              >
                Ver todos
              </button>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhum prazo pendente</p>
            ) : (
              <div className="space-y-3">
                {upcomingDeadlines.map((deadline) => (
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
                        Vencimento: {new Date(deadline.due_date!).toLocaleDateString('pt-BR')}
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
                ))}
              </div>
            )}
          </div>

          {/* Recent Tasks */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Tarefas Recentes</h2>
              <button
                onClick={() => handleNavigate('tasks')}
                className="text-sm font-medium text-amber-600 hover:text-amber-700"
              >
                Ver todas
              </button>
            </div>
            {recentTasks.length === 0 ? (
              <p className="text-center text-sm text-slate-500">Nenhuma tarefa pendente</p>
            ) : (
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="rounded-lg bg-emerald-100 p-2 text-emerald-600">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{task.title}</p>
                      <p className="text-xs text-slate-600">
                        Criado em {new Date(task.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Pending Requirements */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Requerimentos aguardando confecção</h2>
            <button
              onClick={() => handleNavigate('requirements')}
              className="text-sm font-medium text-amber-600 hover:text-amber-700"
            >
              Ver requerimentos
            </button>
          </div>
          {pendingRequirementsList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum requerimento aguardando confecção</p>
          ) : (
            <div className="space-y-3">
              {pendingRequirementsList.map((requirement) => (
                <div
                  key={requirement.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="rounded-lg bg-amber-100 p-2 text-amber-600">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{requirement.beneficiary || 'Requerimento sem beneficiário'}</p>
                    <p className="text-xs text-slate-600">
                      Entrada: {requirement.entry_date ? new Date(requirement.entry_date).toLocaleDateString('pt-BR') : 'não informada'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleNavigate('requirements')}
                    className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                  >
                    Ver
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Processes Awaiting Draft */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Processos aguardando confecção</h2>
            <button
              onClick={() => handleNavigate('cases')}
              className="text-sm font-medium text-amber-600 hover:text-amber-700"
            >
              Ver processos
            </button>
          </div>
          {awaitingDraftProcessesList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum processo aguardando confecção</p>
          ) : (
            <div className="space-y-3">
              {awaitingDraftProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;
                const displayDate = process.distributed_at || process.created_at;

                return (
                  <div
                    key={process.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="rounded-lg bg-blue-100 p-2 text-blue-600">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{process.process_code || 'Processo sem código'}</p>
                      <p className="text-xs text-slate-600">
                        Cliente: {client?.full_name || 'Não informado'}
                      </p>
                      {displayDate && (
                        <p className="text-xs text-slate-500">
                          Distribuído em {new Date(displayDate).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleNavigate('cases')}
                      className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                    >
                      Ver
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending Processes */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Processos em andamento</h2>
            <button
              onClick={() => handleNavigate('cases')}
              className="text-sm font-medium text-amber-600 hover:text-amber-700"
            >
              Ver todos
            </button>
          </div>
          {pendingProcessesList.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Nenhum processo em andamento</p>
          ) : (
            <div className="space-y-3">
              {pendingProcessesList.map((process) => {
                const client = process.client_id ? clientMap.get(process.client_id) : null;

                return (
                  <div
                    key={process.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="rounded-lg bg-purple-100 p-2 text-purple-600">
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{process.process_code || 'Processo sem código'}</p>
                      <p className="text-xs text-slate-600">
                        Cliente: {client?.full_name || 'Não informado'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Status: {process.status === 'andamento' ? 'Em andamento' : 'Distribuído'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleNavigate('cases')}
                      className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                    >
                      Ver
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Activity Summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-slate-900">Resumo de Atividades</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-4">
            <FileText className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-2xl font-bold text-blue-900">{clients.length}</p>
              <p className="text-sm text-blue-700">Total de Clientes</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-purple-50 p-4">
            <Briefcase className="h-8 w-8 text-purple-600" />
            <div>
              <p className="text-2xl font-bold text-purple-900">{processes.length}</p>
              <p className="text-sm text-purple-700">Total de Processos</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4">
            <Target className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold text-emerald-900">
                {tasks.filter((t) => t.status === 'completed').length}
              </p>
              <p className="text-sm text-emerald-700">Tarefas Concluídas</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-4">
            <FileText className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-amber-900">{awaitingRequirements.length}</p>
              <p className="text-sm text-amber-700">Requerimentos em Confecção</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-4">
            <Briefcase className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-2xl font-bold text-blue-900">{awaitingDraftProcesses.length}</p>
              <p className="text-sm text-blue-700">Processos aguardando confecção</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
