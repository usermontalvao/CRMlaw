import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Search,
  Eye,
  X,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Calendar,
  FileSpreadsheet,
  Layers,
  Briefcase,
  AlertTriangle,
  Siren,
  BookmarkPlus,
  BookmarkX,
  UserCircle,
  LayoutGrid,
  List,
  BarChart3,
  PieChart,
  TrendingUp,
  Download,
  Filter,
  Users,
  FileText,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { deadlineService } from '../services/deadline.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import type { Deadline, DeadlineStatus, DeadlinePriority, DeadlineType } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Profile } from '../services/profile.service';
import type { Client } from '../types/client.types';

const STATUS_OPTIONS: {
  key: DeadlineStatus;
  label: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'pendente', label: 'Pendentes', badge: 'bg-blue-500 text-white', icon: Clock },
  { key: 'cumprido', label: 'Cumpridos', badge: 'bg-green-600 text-white', icon: CheckCircle2 },
  { key: 'vencido', label: 'Vencidos', badge: 'bg-red-600 text-white', icon: AlertCircle },
  { key: 'cancelado', label: 'Cancelados', badge: 'bg-slate-400 text-white', icon: XCircle },
];

const STATUS_FILTER_OPTIONS = STATUS_OPTIONS.filter((status) => status.key !== 'cumprido');

const PRIORITY_OPTIONS: {
  key: DeadlinePriority;
  label: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'urgente', label: 'Urgente', badge: 'bg-red-600 text-white', icon: AlertTriangle },
  { key: 'alta', label: 'Alta', badge: 'bg-orange-500 text-white', icon: AlertCircle },
  { key: 'media', label: 'Média', badge: 'bg-yellow-500 text-white', icon: Clock },
  { key: 'baixa', label: 'Baixa', badge: 'bg-slate-400 text-white', icon: Clock },
];

const MAP_BUCKETS: {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  predicate: (days: number) => boolean;
}[] = [
  {
    key: 'awaiting_drafting',
    label: 'Processos e Requerimentos Administrativos',
    description: 'Casos que precisam de petição inicial. Verifique os requisitos antes de seguir.',
    icon: Briefcase,
    colorClass: 'text-blue-600',
    predicate: () => false,
  },
  {
    key: 'critical',
    label: 'Atrasados / Hoje',
    description: 'Prioridade máxima: execute imediatamente para evitar prejuízos.',
    icon: AlertTriangle,
    colorClass: 'text-red-600',
    predicate: (days) => days <= 0,
  },
  {
    key: 'soon',
    label: 'Próximos 2 Dias',
    description: 'Planeje ações para hoje e amanhã antes que o prazo expire.',
    icon: Clock,
    colorClass: 'text-orange-600',
    predicate: (days) => days > 0 && days <= 2,
  },
  {
    key: 'week',
    label: 'Próximos 3-7 Dias',
    description: 'Organize a semana garantindo que nada fique para a última hora.',
    icon: Calendar,
    colorClass: 'text-amber-600',
    predicate: (days) => days >= 3 && days <= 7,
  },
  {
    key: 'future',
    label: 'Planejamento Futuro (> 7 dias)',
    description: 'Registre lembretes e materiais necessários com antecedência.',
    icon: Calendar,
    colorClass: 'text-slate-600',
    predicate: (days) => days > 7,
  },
];

const TYPE_OPTIONS: {
  key: DeadlineType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'processo', label: 'Processo', icon: Layers },
  { key: 'requerimento', label: 'Requerimento', icon: Briefcase },
  { key: 'geral', label: 'Geral', icon: Calendar },
];

type DeadlineFormData = {
  title: string;
  description: string;
  due_date: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  type: DeadlineType;
  process_id: string;
  requirement_id: string;
  client_id: string;
  responsible_id: string;
  notify_days_before: string;
};

type SavedFilter = {
  id: string;
  name: string;
  search: string;
  type: DeadlineType | '';
  priority: DeadlinePriority | '';
  status: DeadlineStatus | 'todos';
  responsibleId: string;
};

type SmartAlert = {
  id: string;
  title: string;
  description: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
  actionLabel?: string;
  onAction?: () => void;
  icon: React.ReactNode;
};

const SAVED_FILTERS_KEY = 'deadlines_saved_filters';
const UNASSIGNED_FILTER_VALUE = '__unassigned__';

const ALERT_TONE_STYLES: Record<SmartAlert['tone'], { bg: string; border: string; text: string; button: string; buttonText: string }> = {
  danger: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-900',
    button: 'bg-red-600 hover:bg-red-700 text-white',
    buttonText: 'text-red-700',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-900',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    buttonText: 'text-amber-700',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-900',
    button: 'bg-blue-600 hover:bg-blue-700 text-white',
    buttonText: 'text-blue-700',
  },
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    buttonText: 'text-emerald-700',
  },
};

const emptyForm: DeadlineFormData = {
  title: '',
  description: '',
  due_date: '',
  status: 'pendente',
  priority: 'media',
  type: 'processo',
  process_id: '',
  requirement_id: '',
  client_id: '',
  responsible_id: '',
  notify_days_before: '2',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Calcula data de vencimento baseado em dias úteis (exclui finais de semana)
// Prazos processuais começam no dia subsequente à publicação
type TipoPrazo = 'processual' | 'material';

const calcularDataVencimento = (dataPublicacao: string, diasPrazo: number, tipo: TipoPrazo): string => {
  const data = new Date(dataPublicacao + 'T12:00:00');
  
  // Começa no dia subsequente (regra processual)
  data.setDate(data.getDate() + 1);
  
  let diasContados = 0;
  
  while (diasContados < diasPrazo) {
    const diaSemana = data.getDay();
    const isFinalSemana = diaSemana === 0 || diaSemana === 6;

    if (tipo === 'processual') {
      if (!isFinalSemana) {
        diasContados++;
      }
    } else {
      diasContados++;
    }

    if (diasContados < diasPrazo) {
      data.setDate(data.getDate() + 1);
    }
  }

  if (tipo === 'processual') {
    while (data.getDay() === 0 || data.getDay() === 6) {
      data.setDate(data.getDate() + 1);
    }
  }
  
  return data.toISOString().split('T')[0];
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  // Extrai apenas a parte da data (YYYY-MM-DD) sem conversão de timezone
  if (value.includes('T')) return value.split('T')[0];
  // Se já está no formato YYYY-MM-DD, retorna direto
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return value;
};

const parseDateOnly = (value: string): Date | null => {
  if (!value) return null;
  const datePart = value.includes('T') ? value.split('T')[0] : value;
  const parts = datePart.split('-').map((part) => Number.parseInt(part, 10));
  if (parts.length === 3 && parts.every((num) => Number.isFinite(num))) {
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const getDaysUntilDue = (dueDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = parseDateOnly(dueDate);
  if (!due) return 0;

  const dueStart = due.getTime();
  const todayStart = today.getTime();
  const diffTime = dueStart - todayStart;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

const isDueSoon = (dueDate: string): boolean => {
  const days = getDaysUntilDue(dueDate);
  return days >= 0 && days <= 2;
};

interface DeadlinesModuleProps {
  forceCreate?: boolean;
  entityId?: string;
  onParamConsumed?: () => void;
  prefillData?: {
    title?: string;
    description?: string;
    client_id?: string;
    process_id?: string;
    process_code?: string;
    client_name?: string;
  };
}

const DeadlinesModule: React.FC<DeadlinesModuleProps> = ({ forceCreate, entityId, onParamConsumed, prefillData }) => {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<DeadlineFormData>(emptyForm);
  const [selectedDeadline, setSelectedDeadline] = useState<Deadline | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterType, setFilterType] = useState<DeadlineType | ''>('');
  const [filterPriority, setFilterPriority] = useState<DeadlinePriority | ''>('');
  const [filterResponsible, setFilterResponsible] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<DeadlineStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'map' | 'details'>('list');
  const [selectedDeadlineForView, setSelectedDeadlineForView] = useState<Deadline | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [selectedSavedFilterId, setSelectedSavedFilterId] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [processSearchTerm, setProcessSearchTerm] = useState('');
  const [requirementSearchTerm, setRequirementSearchTerm] = useState('');
  const [showProcessSuggestions, setShowProcessSuggestions] = useState(false);
  const [showRequirementSuggestions, setShowRequirementSuggestions] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  
  // Estados para calculadora de prazo
  const [dataPublicacao, setDataPublicacao] = useState('');
  const [diasPrazo, setDiasPrazo] = useState('');
  const [tipoPrazoCalculadora, setTipoPrazoCalculadora] = useState<TipoPrazo>('processual');
  const calculadoraAtiva = Boolean(dataPublicacao && diasPrazo);

  const hasFilterCriteria = Boolean(
    filterSearch.trim() ||
      filterType ||
      filterPriority ||
      filterResponsible ||
      activeStatusTab !== 'todos',
  );
  
  // Estados para relatórios
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'quarter' | 'year' | 'custom'>('month');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');

  const applyFilterPreset = useCallback(
    (preset: {
      search?: string;
      type?: DeadlineType | '';
      priority?: DeadlinePriority | '';
      responsibleId?: string;
      status?: DeadlineStatus | 'todos';
    }) => {
      setCurrentPage(1);
      if (preset.search !== undefined) setFilterSearch(preset.search);
      if (preset.type !== undefined) setFilterType(preset.type);
      if (preset.priority !== undefined) setFilterPriority(preset.priority);
      if (preset.responsibleId !== undefined) setFilterResponsible(preset.responsibleId);
      if (preset.status !== undefined) setActiveStatusTab(preset.status);
    },
    [],
  );

  const handleSaveCurrentFilter = useCallback(() => {
    if (!hasFilterCriteria) {
      alert('Defina algum filtro antes de salvar.');
      return;
    }
    const name = prompt('Nome do filtro salvo:');
    if (!name || !name.trim()) return;
    const newFilter: SavedFilter = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      search: filterSearch,
      type: filterType,
      priority: filterPriority,
      status: activeStatusTab,
      responsibleId: filterResponsible,
    };
    setSavedFilters((prev) => [newFilter, ...prev].slice(0, 10));
    setSelectedSavedFilterId(newFilter.id);
  }, [hasFilterCriteria, filterSearch, filterType, filterPriority, filterResponsible, activeStatusTab]);

  const handleSavedFilterChange = useCallback(
    (id: string) => {
      setSelectedSavedFilterId(id);
      if (!id) return;
      const filter = savedFilters.find((f) => f.id === id);
      if (filter) {
        applyFilterPreset(filter);
      }
    },
    [savedFilters, applyFilterPreset],
  );

  const handleDeleteSavedFilter = useCallback(
    (id: string) => {
      if (!confirm('Remover este filtro salvo?')) return;
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
      if (selectedSavedFilterId === id) {
        setSelectedSavedFilterId('');
      }
    },
    [selectedSavedFilterId],
  );

  const filteredDeadlines = useMemo(() => {
    let filtered = deadlines;

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((deadline) => deadline.status === activeStatusTab);
    } else {
      filtered = filtered.filter((deadline) => deadline.status !== 'cumprido');
    }

    if (filterSearch.trim()) {
      const term = filterSearch.trim().toLowerCase();
      filtered = filtered.filter(
        (deadline) =>
          deadline.title.toLowerCase().includes(term) ||
          (deadline.description && deadline.description.toLowerCase().includes(term)),
      );
    }

    if (filterType) {
      filtered = filtered.filter((deadline) => deadline.type === filterType);
    }

    if (filterPriority) {
      filtered = filtered.filter((deadline) => deadline.priority === filterPriority);
    }

    if (filterResponsible === UNASSIGNED_FILTER_VALUE) {
      filtered = filtered.filter((deadline) => !deadline.responsible_id);
    } else if (filterResponsible) {
      filtered = filtered.filter((deadline) => deadline.responsible_id === filterResponsible);
    }

    return filtered.slice().sort((a, b) => {
      if (a.status === 'vencido' && b.status !== 'vencido') return -1;
      if (a.status !== 'vencido' && b.status === 'vencido') return 1;
      if (a.status === 'pendente' && b.status !== 'pendente') return -1;
      if (a.status !== 'pendente' && b.status === 'pendente') return 1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }, [deadlines, activeStatusTab, filterSearch, filterType, filterPriority, filterResponsible]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredDeadlines.length / pageSize));

  const paginatedDeadlines = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDeadlines.slice(start, start + pageSize);
  }, [filteredDeadlines, currentPage]);

  const statusCounts = useMemo(() => {
    const counts: Record<DeadlineStatus | 'todos', number> = {
      todos: deadlines.length,
      pendente: 0,
      cumprido: 0,
      vencido: 0,
      cancelado: 0,
    };

    deadlines.forEach((deadline) => {
      counts[deadline.status]++;
    });

    return counts;
  }, [deadlines]);

  const pendingDeadlines = useMemo(
    () => deadlines.filter((deadline) => deadline.status === 'pendente'),
    [deadlines],
  );

  const upcomingDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pendente')
      .filter((d) => {
        const days = getDaysUntilDue(d.due_date);
        return days >= 0 && days <= 7;
      })
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines]);

  const overdueDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pendente')
      .filter((d) => getDaysUntilDue(d.due_date) < 0)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines]);

  const criticalDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pendente')
      .filter((d) => getDaysUntilDue(d.due_date) === 1)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines]);

  const unassignedPending = useMemo(() => deadlines.filter((d) => d.status === 'pendente' && !d.responsible_id), [deadlines]);

  const smartAlerts = useMemo<SmartAlert[]>(() => {
    const alerts: SmartAlert[] = [];
    if (overdueDeadlines.length) {
      alerts.push({
        id: 'overdue',
        title: 'Prazos vencidos',
        description: `${overdueDeadlines.length} prazo(s) pendente(s) estão atrasados e precisam de ação imediata.`,
        tone: 'danger',
        actionLabel: 'Ver vencidos',
        onAction: () => applyFilterPreset({ status: 'vencido' }),
        icon: <AlertCircle className="w-5 h-5 text-red-600" />,
      });
    }
    if (criticalDeadlines.length) {
      alerts.push({
        id: 'soon',
        title: 'Prazos vencendo em até 2 dias',
        description: `${criticalDeadlines.length} prazo(s) expiram nas próximas 48h.`,
        tone: 'warning',
        actionLabel: 'Filtrar urgentes',
        onAction: () => applyFilterPreset({ status: 'pendente', priority: 'urgente' }),
        icon: <Siren className="w-5 h-5 text-amber-600" />,
      });
    }
    if (unassignedPending.length) {
      alerts.push({
        id: 'unassigned',
        title: 'Prazos sem responsável',
        description: `${unassignedPending.length} prazo(s) aguardam designação.`,
        tone: 'info',
        actionLabel: 'Ver não atribuídos',
        onAction: () => applyFilterPreset({ responsibleId: UNASSIGNED_FILTER_VALUE }),
        icon: <Users className="w-5 h-5 text-blue-600" />,
      });
    }
    return alerts;
  }, [overdueDeadlines.length, criticalDeadlines.length, unassignedPending.length, applyFilterPreset]);

  const completedDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'cumprido')
      .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime())
      .slice(0, 10);
  }, [deadlines]);

  const dueTodayDeadlines = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deadlines.filter((deadline) => {
      const dueDate = new Date(deadline.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate.getTime() === today.getTime() && deadline.status === 'pendente';
    });
  }, [deadlines]);

  const monthlyDeadlines = useMemo(() => {
    return deadlines.filter((deadline) => {
      const due = parseDateOnly(deadline.due_date);
      if (!due) return false;
      return due.getMonth() === calendarMonth && due.getFullYear() === calendarYear;
    });
  }, [deadlines, calendarMonth, calendarYear]);

  const monthlyPending = useMemo(
    () => monthlyDeadlines.filter((deadline) => deadline.status === 'pendente'),
    [monthlyDeadlines],
  );

  const monthlyCompleted = useMemo(() => {
    return deadlines.filter((deadline) => {
      if (deadline.status !== 'cumprido' || !deadline.completed_at) return false;
      const completed = new Date(deadline.completed_at);
      return completed.getMonth() === calendarMonth && completed.getFullYear() === calendarYear;
    });
  }, [deadlines, calendarMonth, calendarYear]);

  const monthlyDueToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return monthlyDeadlines.filter((deadline) => {
      if (deadline.status !== 'pendente') return false;
      const due = parseDateOnly(deadline.due_date);
      if (!due) return false;
      due.setHours(0, 0, 0, 0);
      return due.getTime() === today.getTime();
    });
  }, [monthlyDeadlines]);

  const monthlyOverdue = useMemo(
    () =>
      monthlyDeadlines.filter(
        (deadline) => deadline.status === 'pendente' && getDaysUntilDue(deadline.due_date) < 0,
      ),
    [monthlyDeadlines],
  );

  const monthlyAttentionCount = useMemo(
    () => monthlyDueToday.length + monthlyOverdue.length,
    [monthlyDueToday, monthlyOverdue],
  );

  const currentMonthLabel = useMemo(
    () => new Date(calendarYear, calendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    [calendarMonth, calendarYear],
  );

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  // Estatísticas para relatórios
  const reportStats = useMemo(() => {
    const getDateRange = () => {
      const today = new Date();
      let start: Date;
      let end: Date = new Date();
      
      switch (reportPeriod) {
        case 'week':
          start = new Date(today);
          start.setDate(today.getDate() - 7);
          break;
        case 'month':
          start = new Date(today.getFullYear(), today.getMonth(), 1);
          end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          break;
        case 'quarter':
          const quarter = Math.floor(today.getMonth() / 3);
          start = new Date(today.getFullYear(), quarter * 3, 1);
          end = new Date(today.getFullYear(), quarter * 3 + 3, 0);
          break;
        case 'year':
          start = new Date(today.getFullYear(), 0, 1);
          end = new Date(today.getFullYear(), 11, 31);
          break;
        case 'custom':
          start = reportStartDate ? new Date(reportStartDate) : new Date(today.getFullYear(), today.getMonth(), 1);
          end = reportEndDate ? new Date(reportEndDate) : new Date();
          break;
        default:
          start = new Date(today.getFullYear(), today.getMonth(), 1);
      }
      
      return { start, end };
    };
    
    const { start, end } = getDateRange();
    
    const periodDeadlines = deadlines.filter(d => {
      const dueDate = new Date(d.due_date);
      return dueDate >= start && dueDate <= end;
    });
    
    const byStatus = {
      pendente: periodDeadlines.filter(d => d.status === 'pendente').length,
      cumprido: periodDeadlines.filter(d => d.status === 'cumprido').length,
      vencido: periodDeadlines.filter(d => d.status === 'vencido').length,
      cancelado: periodDeadlines.filter(d => d.status === 'cancelado').length,
    };
    
    const byPriority = {
      urgente: periodDeadlines.filter(d => d.priority === 'urgente').length,
      alta: periodDeadlines.filter(d => d.priority === 'alta').length,
      media: periodDeadlines.filter(d => d.priority === 'media').length,
      baixa: periodDeadlines.filter(d => d.priority === 'baixa').length,
    };
    
    const byType = {
      geral: periodDeadlines.filter(d => d.type === 'geral').length,
      processo: periodDeadlines.filter(d => d.type === 'processo').length,
      requerimento: periodDeadlines.filter(d => d.type === 'requerimento').length,
    };
    
    // Por responsável
    const byResponsible: Record<string, number> = {};
    periodDeadlines.forEach(d => {
      const name = d.responsible_id ? (memberMap.get(d.responsible_id)?.name || 'Não atribuído') : 'Não atribuído';
      byResponsible[name] = (byResponsible[name] || 0) + 1;
    });
    
    // Por cliente (top 10)
    const byClient: Record<string, number> = {};
    periodDeadlines.forEach(d => {
      const name = d.client_id ? (clientMap.get(d.client_id)?.full_name || 'Sem cliente') : 'Sem cliente';
      byClient[name] = (byClient[name] || 0) + 1;
    });
    
    // Taxa de cumprimento
    const total = periodDeadlines.length;
    const completed = byStatus.cumprido;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // Média de dias para cumprir (dos cumpridos)
    const completedDeadlinesInPeriod = periodDeadlines.filter(d => d.status === 'cumprido' && d.completed_at);
    let avgDaysToComplete = 0;
    if (completedDeadlinesInPeriod.length > 0) {
      const totalDays = completedDeadlinesInPeriod.reduce((acc, d) => {
        const created = new Date(d.created_at);
        const completed = new Date(d.completed_at!);
        return acc + Math.ceil((completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }, 0);
      avgDaysToComplete = Math.round(totalDays / completedDeadlinesInPeriod.length);
    }
    
    return {
      total,
      byStatus,
      byPriority,
      byType,
      byResponsible,
      byClient,
      completionRate,
      avgDaysToComplete,
      periodStart: start,
      periodEnd: end,
    };
  }, [deadlines, reportPeriod, reportStartDate, reportEndDate, memberMap, clientMap]);

  useEffect(() => {
    const fetchDeadlines = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await deadlineService.listDeadlines();
        setDeadlines(data);
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar os prazos.');
      } finally {
        setLoading(false);
      }
    };

    fetchDeadlines();
  }, []);

  useEffect(() => {
    let active = true;

    const loadProcesses = async () => {
      try {
        const data = await processService.listProcesses();
        if (!active) return;
        setProcesses(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadProcesses();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadRequirements = async () => {
      try {
        const data = await requirementService.listRequirements();
        if (!active) return;
        setRequirements(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadRequirements();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadMembers = async () => {
      try {
        const data = await profileService.listMembers();
        if (!active) return;
        setMembers(data);
      } catch (err) {
        console.error(err);
      }
    };

    loadMembers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(SAVED_FILTERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedFilters(parsed);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar filtros salvos de prazos.', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(savedFilters));
    } catch (err) {
      console.error('Erro ao persistir filtros salvos de prazos.', err);
    }
  }, [savedFilters]);

  useEffect(() => {
    const match = savedFilters.find(
      (filter) =>
        filter.search === filterSearch &&
        filter.type === filterType &&
        filter.priority === filterPriority &&
        filter.responsibleId === filterResponsible &&
        filter.status === activeStatusTab,
    );
    setSelectedSavedFilterId(match?.id ?? '');
  }, [filterSearch, filterType, filterPriority, filterResponsible, activeStatusTab, savedFilters]);

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      try {
        const profile = await profileService.getMyProfile();
        if (!active) return;
        setCurrentUser(profile);
      } catch (err) {
        console.error('Não foi possível carregar o perfil do usuário para o relatório.', err);
      }
    };

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setClientsLoading(true);

    const handler = setTimeout(async () => {
      try {
        const term = clientSearchTerm.trim();
        const data = await clientService.listClients(term ? { search: term } : undefined);
        if (!active) return;
        setClients(data);
      } catch (err) {
        if (active) {
          console.error(err);
        }
      } finally {
        if (active) {
          setClientsLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(handler);
    };
  }, [clientSearchTerm]);


  useEffect(() => {
    if (forceCreate && !isModalOpen) {
      setSelectedDeadline(null);
      
      // Aplica dados prefill se fornecidos
      if (prefillData) {
        setFormData({
          ...emptyForm,
          title: prefillData.title || emptyForm.title,
          description: prefillData.description || emptyForm.description,
          client_id: prefillData.client_id || emptyForm.client_id,
          process_id: prefillData.process_id || emptyForm.process_id,
        });
        
        // Se tem nome do cliente, atualiza o clientSearchTerm
        if (prefillData.client_name) {
          setClientSearchTerm(prefillData.client_name);
        }
        
        // Se tem código do processo, atualiza o processSearchTerm
        if (prefillData.process_code) {
          setProcessSearchTerm(prefillData.process_code);
        }
      } else {
        setFormData(emptyForm);
      }
      
      setIsModalOpen(true);
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed, prefillData]);

  useEffect(() => {
    if (entityId && deadlines.length > 0) {
      const deadline = deadlines.find(d => d.id === entityId);
      if (deadline) {
        setSelectedDeadlineForView(deadline);
        setViewMode('details');
        if (onParamConsumed) {
          onParamConsumed();
        }
      }
    }
  }, [entityId, deadlines, onParamConsumed]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleReload = async () => {
    try {
      setLoading(true);
      const data = await deadlineService.listDeadlines();
      setDeadlines(data);
      if (selectedDeadlineForView) {
        const updated = data.find((item) => item.id === selectedDeadlineForView.id);
        if (updated) {
          setSelectedDeadlineForView(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de prazos.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (deadline?: Deadline) => {
    if (deadline) {
      setSelectedDeadline(deadline);
      setFormData({
        title: deadline.title,
        description: deadline.description || '',
        due_date: toDateInputValue(deadline.due_date),
        status: deadline.status,
        priority: deadline.priority,
        type: deadline.type,
        process_id: deadline.process_id || '',
        requirement_id: deadline.requirement_id || '',
        client_id: deadline.client_id || '',
        responsible_id: deadline.responsible_id || '',
        notify_days_before: String(deadline.notify_days_before ?? 2),
      });

      if (deadline.process_id) {
        const process = processes.find((p) => p.id === deadline.process_id);
        if (process) {
          setProcessSearchTerm(process.process_code ?? '');
        }
      }

      if (deadline.requirement_id) {
        const requirement = requirements.find((r) => r.id === deadline.requirement_id);
        if (requirement) {
          setRequirementSearchTerm(requirement.protocol ?? '');
        }
      }
    } else {
      setSelectedDeadline(null);
      setFormData(emptyForm);
      setProcessSearchTerm('');
      setRequirementSearchTerm('');
    }

    setDataPublicacao('');
    setDiasPrazo('');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedDeadline(null);
    setFormData(emptyForm);
    setProcessSearchTerm('');
    setRequirementSearchTerm('');
    setShowProcessSuggestions(false);
    setShowRequirementSuggestions(false);
    setDataPublicacao('');
    setDiasPrazo('');
  };

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.title.trim()) {
      setError('Informe o título do prazo.');
      return;
    }

    if (!formData.due_date) {
      setError('Informe a data de vencimento.');
      return;
    }

    if (!formData.client_id) {
      setError('Selecione o cliente relacionado ao prazo.');
      return;
    }

    if (!formData.responsible_id) {
      setError('Selecione o responsável pelo prazo.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payloadBase = {
        title: formData.title.trim(),
        description: formData.description?.trim() || null,
        due_date: new Date(formData.due_date).toISOString(),
        status: formData.status,
        priority: formData.priority,
        type: formData.type,
        process_id: formData.process_id || null,
        requirement_id: formData.requirement_id || null,
        client_id: formData.client_id || null,
        responsible_id: formData.responsible_id || null,
        notify_days_before: formData.notify_days_before ? parseInt(formData.notify_days_before, 10) : 2,
      };

      const editingDeadline = selectedDeadline;
      let updatedDeadline: Deadline | null = null;

      if (editingDeadline) {
        await deadlineService.updateDeadline(editingDeadline.id, payloadBase);
        updatedDeadline = await deadlineService.getDeadlineById(editingDeadline.id);
        if (updatedDeadline) {
          setDeadlines((prev) => prev.map((item) => (item.id === updatedDeadline!.id ? updatedDeadline! : item)));
          setSelectedDeadline(updatedDeadline);
          if (selectedDeadlineForView?.id === updatedDeadline.id) {
            setSelectedDeadlineForView(updatedDeadline);
          }
        } else {
          await handleReload();
        }
      } else {
        await deadlineService.createDeadline(payloadBase as any);
        await handleReload();
      }

      setIsModalOpen(false);
      if (!updatedDeadline) {
        setSelectedDeadline(null);
      }
      setFormData(emptyForm);
      setProcessSearchTerm('');
      setRequirementSearchTerm('');
      setDataPublicacao('');
      setDiasPrazo('');
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o prazo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDeadline = async (id: string) => {
    if (!confirm('Deseja realmente remover este prazo? Essa ação é irreversível.')) return;

    try {
      await deadlineService.deleteDeadline(id);
      setDeadlines((prev) => prev.filter((item) => item.id !== id));
      if (selectedDeadlineForView?.id === id) {
        handleBackToList();
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o prazo.');
    }
  };

  const handleViewDeadline = (deadline: Deadline) => {
    setSelectedDeadlineForView(deadline);
    setViewMode('details');
  };

  const handleBackToList = () => {
    setSelectedDeadlineForView(null);
    setViewMode('list');
  };

  const handleStatusChange = async (deadlineId: string, newStatus: DeadlineStatus) => {
    try {
      setStatusUpdatingId(deadlineId);
      const deadline = deadlines.find((d) => d.id === deadlineId);
      
      await deadlineService.updateStatus(deadlineId, newStatus);
      
      // Se o prazo for de exigência e foi marcado como cumprido, atualizar o requerimento para em_analise
      if (
        deadline &&
        deadline.type === 'requerimento' &&
        deadline.requirement_id &&
        newStatus === 'cumprido'
      ) {
        try {
          await requirementService.updateStatus(deadline.requirement_id, 'em_analise');
        } catch (reqErr) {
          console.error('Erro ao atualizar status do requerimento:', reqErr);
        }
      }
      
      // Se o prazo for de exigência e foi reaberto (cumprido → pendente), voltar requerimento para em_exigencia
      if (
        deadline &&
        deadline.type === 'requerimento' &&
        deadline.requirement_id &&
        deadline.status === 'cumprido' &&
        newStatus === 'pendente'
      ) {
        try {
          await requirementService.updateStatus(deadline.requirement_id, 'em_exigencia');
        } catch (reqErr) {
          console.error('Erro ao atualizar status do requerimento:', reqErr);
        }
      }
      
      await handleReload();
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar o status.');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const getStatusConfig = (status: DeadlineStatus) => STATUS_OPTIONS.find((s) => s.key === status);
  const getPriorityConfig = (priority: DeadlinePriority) => PRIORITY_OPTIONS.find((p) => p.key === priority);
  const getTypeConfig = (type: DeadlineType) => TYPE_OPTIONS.find((t) => t.key === type);
  const getStatusBadge = (status: DeadlineStatus) => {
    const config = getStatusConfig(status);
    return config ? config.badge : 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: DeadlineStatus) => {
    const config = getStatusConfig(status);
    return config ? config.label : status;
  };

  const getPriorityBadge = (priority: DeadlinePriority) => {
    const config = getPriorityConfig(priority);
    return config ? config.badge : 'bg-slate-100 text-slate-600';
  };

  const getPriorityLabel = (priority: DeadlinePriority) => {
    const config = getPriorityConfig(priority);
    return config ? config.label : priority;
  };

  const getTypeLabel = (type: DeadlineType) => {
    const config = getTypeConfig(type);
    return config ? config.label : type;
  };

  const handleExportExcel = async () => {
    if (!deadlines.length) {
      alert('Não há prazos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      const excelData = deadlines.map((deadline) => ({
        'Título': deadline.title,
        'Descrição': deadline.description || '',
        'Data de Vencimento': formatDate(deadline.due_date),
        'Status': getStatusLabel(deadline.status),
        'Prioridade': getPriorityLabel(deadline.priority),
        'Tipo': getTypeLabel(deadline.type),
        'Dias para Vencimento': getDaysUntilDue(deadline.due_date),
        'Notificar (dias antes)': deadline.notify_days_before ?? 3,
        'Criado em': deadline.created_at ? new Date(deadline.created_at).toLocaleDateString('pt-BR') : '',
        'Atualizado em': deadline.updated_at ? new Date(deadline.updated_at).toLocaleDateString('pt-BR') : '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 30 }, // Título
        { wch: 40 }, // Descrição
        { wch: 18 }, // Data de Vencimento
        { wch: 15 }, // Status
        { wch: 12 }, // Prioridade
        { wch: 15 }, // Tipo
        { wch: 20 }, // Dias para Vencimento
        { wch: 20 }, // Notificar
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Prazos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const filename = `prazos_${dateSlug}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Não foi possível exportar os dados para Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportReport = () => {
    const { periodStart, periodEnd } = reportStats;
    
    // Criar workbook com múltiplas abas
    const wb = XLSX.utils.book_new();
    
    // Aba 1: Resumo
    const resumoData = [
      ['RELATÓRIO DE PRAZOS'],
      [''],
      ['Período:', `${periodStart.toLocaleDateString('pt-BR')} a ${periodEnd.toLocaleDateString('pt-BR')}`],
      ['Gerado em:', new Date().toLocaleString('pt-BR')],
      [''],
      ['RESUMO GERAL'],
      ['Total de Prazos:', reportStats.total],
      ['Taxa de Cumprimento:', `${reportStats.completionRate}%`],
      ['Média de Dias para Cumprir:', reportStats.avgDaysToComplete],
      [''],
      ['POR STATUS'],
      ['Pendentes:', reportStats.byStatus.pendente],
      ['Cumpridos:', reportStats.byStatus.cumprido],
      ['Vencidos:', reportStats.byStatus.vencido],
      ['Cancelados:', reportStats.byStatus.cancelado],
      [''],
      ['POR PRIORIDADE'],
      ['Urgente:', reportStats.byPriority.urgente],
      ['Alta:', reportStats.byPriority.alta],
      ['Média:', reportStats.byPriority.media],
      ['Baixa:', reportStats.byPriority.baixa],
      [''],
      ['POR TIPO'],
      ['Geral:', reportStats.byType.geral],
      ['Processo:', reportStats.byType.processo],
      ['Requerimento:', reportStats.byType.requerimento],
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoData);
    wsResumo['!cols'] = [{ wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
    
    // Aba 2: Por Responsável
    const responsavelData = [
      ['Responsável', 'Quantidade'],
      ...Object.entries(reportStats.byResponsible).sort((a, b) => b[1] - a[1]),
    ];
    const wsResponsavel = XLSX.utils.aoa_to_sheet(responsavelData);
    wsResponsavel['!cols'] = [{ wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsResponsavel, 'Por Responsável');
    
    // Aba 3: Por Cliente
    const clienteData = [
      ['Cliente', 'Quantidade'],
      ...Object.entries(reportStats.byClient).sort((a, b) => b[1] - a[1]).slice(0, 20),
    ];
    const wsCliente = XLSX.utils.aoa_to_sheet(clienteData);
    wsCliente['!cols'] = [{ wch: 40 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsCliente, 'Por Cliente');
    
    // Aba 4: Detalhamento
    const periodDeadlines = deadlines.filter(d => {
      const dueDate = new Date(d.due_date);
      return dueDate >= periodStart && dueDate <= periodEnd;
    });
    
    const detalheData = periodDeadlines.map(d => ({
      'Título': d.title,
      'Vencimento': formatDate(d.due_date),
      'Status': getStatusLabel(d.status),
      'Prioridade': getPriorityLabel(d.priority),
      'Tipo': getTypeLabel(d.type),
      'Cliente': d.client_id ? (clientMap.get(d.client_id)?.full_name || '-') : '-',
      'Responsável': d.responsible_id ? (memberMap.get(d.responsible_id)?.name || '-') : '-',
    }));
    const wsDetalhe = XLSX.utils.json_to_sheet(detalheData);
    wsDetalhe['!cols'] = [
      { wch: 30 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 30 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDetalhe, 'Detalhamento');
    
    // Salvar arquivo
    const dateSlug = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `relatorio_prazos_${dateSlug}.xlsx`);
  };

  const handleExportPdf = async () => {
    if (!deadlines.length) {
      alert('Não há prazos disponíveis para exportar.');
      return;
    }

    try {
      setExportingPdf(true);

      let effectiveUser = currentUser;
      if (!effectiveUser) {
        try {
          effectiveUser = await profileService.getMyProfile();
          setCurrentUser(effectiveUser);
        } catch (err) {
          console.error('Não foi possível carregar o perfil do usuário antes da exportação.', err);
        }
      }

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      // Cores
      const blue = rgb(0.13, 0.4, 0.7);
      const green = rgb(0.1, 0.55, 0.4);
      const orange = rgb(0.85, 0.5, 0.15);
      const red = rgb(0.75, 0.2, 0.2);
      const darkText = rgb(0.15, 0.15, 0.15);
      const grayText = rgb(0.4, 0.4, 0.4);
      const lightGray = rgb(0.94, 0.94, 0.96);
      const white = rgb(1, 1, 1);

      // Página A4
      let page = pdfDoc.addPage([595.28, 841.89]);
      let { width, height } = page.getSize();
      const margin = 40;
      const usableWidth = width - margin * 2;
      let y = height - margin;

      const createNewPage = () => {
        page = pdfDoc.addPage([595.28, 841.89]);
        ({ width, height } = page.getSize());
        y = height - margin;
      };

      const checkSpace = (needed: number) => {
        if (y - needed < margin + 30) {
          createNewPage();
        }
      };

      const text = (
        str: string,
        x: number,
        yPos: number,
        size = 10,
        bold = false,
        color = darkText,
        maxW?: number,
      ) => {
        let display = str || '';
        if (maxW) {
          const avgChar = size * 0.52;
          const maxChars = Math.floor(maxW / avgChar);
          if (display.length > maxChars) {
            display = display.substring(0, maxChars - 2) + '..';
          }
        }
        page.drawText(display, {
          x,
          y: yPos,
          size,
          font: bold ? boldFont : font,
          color,
        });
      };

      const rect = (x: number, yPos: number, w: number, h: number, color: ReturnType<typeof rgb>) => {
        page.drawRectangle({ x, y: yPos, width: w, height: h, color });
      };

      const { periodStart, periodEnd, total, completionRate, avgDaysToComplete, byStatus, byPriority, byType } = reportStats;
      const periodDeadlines = deadlines
        .filter((d) => {
          const dueDate = new Date(d.due_date);
          return dueDate >= periodStart && dueDate <= periodEnd;
        })
        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

      const exportTimestamp = new Date();
      const exportedBy = effectiveUser?.name?.trim().length ? effectiveUser.name : 'Usuário do sistema';
      const exportedEmail = effectiveUser?.email?.trim().length ? effectiveUser.email : 'E-mail não informado';
      const exportedRole = effectiveUser?.role?.trim().length ? effectiveUser.role : 'Não informado';
      const exportLogId = `${exportTimestamp.getTime()}-${effectiveUser?.id ?? 'anon'}`;
      const periodLabel = `${periodStart.toLocaleDateString('pt-BR')} a ${periodEnd.toLocaleDateString('pt-BR')}`;

      // ===== HEADER =====
      const headerHeight = 110;
      rect(0, height - headerHeight, width, headerHeight, blue);
      text('RELATÓRIO DE PRAZOS', margin, height - 38, 20, true, white);
      text(`Período: ${periodLabel}`, margin, height - 58, 10, false, rgb(0.85, 0.9, 1));
      text(`Gerado em: ${exportTimestamp.toLocaleString('pt-BR')}`, margin, height - 74, 9, false, rgb(0.7, 0.8, 0.95));
      text(`Exportado por: ${exportedBy}`, margin, height - 90, 9, false, rgb(0.7, 0.8, 0.95));
      y = height - headerHeight - 20;

      // ===== RESUMO (4 CARDS) =====
      const cardW = (usableWidth - 24) / 4;
      const cardH = 50;
      checkSpace(cardH + 20);
      const cardColors = [blue, green, orange, red];
      const cardLabels = ['Total', 'Cumpridos', 'Média dias', 'Vencidos'];
      const cardValues = [String(total), `${completionRate}%`, String(avgDaysToComplete || 0), String(byStatus.vencido)];

      for (let i = 0; i < 4; i++) {
        const cx = margin + i * (cardW + 8);
        const cy = y - cardH;
        rect(cx, cy, cardW, cardH, cardColors[i]);
        text(cardValues[i], cx + 10, cy + 28, 18, true, white);
        text(cardLabels[i], cx + 10, cy + 10, 9, false, rgb(0.9, 0.95, 1));
      }
      y -= cardH + 20;

      // ===== SEÇÕES DE LISTA =====
      const addList = (title: string, items: [string, number][]) => {
        const rowH = 16;
        const neededH = 28 + items.length * rowH + 10;
        checkSpace(neededH);

        // Título
        rect(margin, y - 20, usableWidth, 22, lightGray);
        text(title, margin + 8, y - 14, 11, true, blue);
        y -= 30;

        if (!items.length) {
          text('Nenhum dado disponível.', margin + 8, y, 10, false, grayText);
          y -= 20;
          return;
        }

        // Itens em lista vertical simples
        items.forEach(([label, value]) => {
          checkSpace(rowH + 5);
          text(label, margin + 8, y, 10, false, darkText, usableWidth - 60);
          text(String(value), margin + usableWidth - 40, y, 10, true, blue);
          y -= rowH;
        });
        y -= 10;
      };

      addList('Por Status', Object.entries(byStatus).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));
      addList('Por Prioridade', Object.entries(byPriority).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));
      addList('Por Tipo', Object.entries(byType).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v]));

      const responsibleEntries = Object.entries(reportStats.byResponsible).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (responsibleEntries.length) {
        addList('Top 5 Responsáveis', responsibleEntries as [string, number][]);
      }

      const clientEntries = Object.entries(reportStats.byClient).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (clientEntries.length) {
        addList('Top 5 Clientes', clientEntries as [string, number][]);
      }

      // ===== DETALHAMENTO DOS PRAZOS =====
      if (periodDeadlines.length) {
        checkSpace(80);
        rect(margin, y - 20, usableWidth, 22, lightGray);
        text('DETALHAMENTO DOS PRAZOS', margin + 8, y - 14, 11, true, blue);
        y -= 32;

        const cardHeight = 32;

        periodDeadlines.forEach((deadline, idx) => {
          const extraHeight = 18; // for meta line
          const totalHeight = cardHeight + extraHeight;
          if (y - totalHeight < margin + 30) {
            createNewPage();
            rect(margin, y - 20, usableWidth, 22, lightGray);
            text('DETALHAMENTO DOS PRAZOS (cont.)', margin + 8, y - 14, 11, true, blue);
            y -= 32;
          }

          const cardY = y - cardHeight;
          if (idx % 2 === 0) {
            rect(margin, cardY - 6, usableWidth, totalHeight, lightGray);
          }

          const clientName = deadline.client_id ? clientMap.get(deadline.client_id)?.full_name : null;
          const responsibleName = deadline.responsible_id ? memberMap.get(deadline.responsible_id)?.name : null;
          const titleStr = clientName ? `${deadline.title} (${clientName})` : deadline.title;
          text(titleStr, margin + 10, cardY + 12, 10, true, darkText, usableWidth - 20);

          const metaLine = [
            `Vencimento: ${formatDate(deadline.due_date)}`,
            `Status: ${getStatusLabel(deadline.status)}`,
            `Prioridade: ${getPriorityLabel(deadline.priority)}`,
            `Tipo: ${getTypeLabel(deadline.type)}`,
            `Responsável: ${responsibleName ?? 'Não atribuído'}`,
          ].join('   |   ');

          text(metaLine, margin + 10, cardY - 2, 9, false, grayText, usableWidth - 20);

          y -= totalHeight + 6;
        });
      }

      const pages = pdfDoc.getPages();
      pages.forEach((pg, index) => {
        const { width: pageWidth } = pg.getSize();
        const footerMargin = 40;
        pg.drawLine({
          start: { x: footerMargin, y: 40 },
          end: { x: pageWidth - footerMargin, y: 40 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });

        pg.drawText('Sistema de Gestão de Prazos', {
          x: footerMargin,
          y: 27,
          size: 8,
          font,
          color: grayText,
        });

        pg.drawText(`Página ${index + 1} de ${pages.length}`, {
          x: pageWidth - footerMargin - 60,
          y: 27,
          size: 8,
          font,
          color: grayText,
        });

        pg.drawText(`Exportado por: ${exportedBy}`, {
          x: footerMargin,
          y: 17,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Email: ${exportedEmail}`, {
          x: footerMargin,
          y: 9,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Data/Hora: ${exportTimestamp.toLocaleString('pt-BR')}`, {
          x: footerMargin + 220,
          y: 17,
          size: 7.5,
          font,
          color: grayText,
        });

        pg.drawText(`Log: ${exportLogId}`, {
          x: footerMargin + 220,
          y: 9,
          size: 7.5,
          font,
          color: grayText,
        });
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const dateSlug = new Date().toISOString().split('T')[0];
      saveAs(blob, `relatorio_prazos_${dateSlug}.pdf`);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Não foi possível exportar o relatório em PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const filteredProcesses = useMemo(() => {
    const scopedProcesses = formData.client_id
      ? processes.filter((p) => p.client_id === formData.client_id)
      : processes;

    if (!processSearchTerm.trim()) return scopedProcesses.slice(0, 10);
    const term = processSearchTerm.trim().toLowerCase();
    return scopedProcesses
      .filter((p) => {
        const processCode = (p.process_code ?? '').toLowerCase();
        const court = (p.court ?? '').toLowerCase();
        return processCode.includes(term) || court.includes(term);
      })
      .slice(0, 10);
  }, [processes, processSearchTerm, formData.client_id]);

  const filteredRequirements = useMemo(() => {
    if (!requirementSearchTerm.trim()) return requirements.slice(0, 10);
    const term = requirementSearchTerm.trim().toLowerCase();
    return requirements
      .filter((r) => {
        const protocol = (r.protocol ?? '').toLowerCase();
        const beneficiary = (r.beneficiary ?? '').toLowerCase();
        return protocol.includes(term) || beneficiary.includes(term);
      })
      .slice(0, 10);
  }, [requirements, requirementSearchTerm]);

  const filteredClients = useMemo(() => {
    if (!clientSearchTerm.trim()) return clients.slice(0, 10);
    const term = clientSearchTerm.trim().toLowerCase();
    return clients
      .filter((client) => {
        const name = (client.full_name || '').toLowerCase();
        const cpf = (client.cpf_cnpj || '').replace(/\D/g, '');
        return name.includes(term) || cpf.includes(term);
      })
      .slice(0, 10);
  }, [clients, clientSearchTerm]);

  // Modal de Relatórios
  const reportModal = showReportModal && (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Relatório de Prazos</h3>
              <p className="text-sm text-slate-500">Análise detalhada do período selecionado</p>
            </div>
          </div>
          <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Seletor de Período */}
          <div className="bg-slate-50 rounded-xl p-4">
            <label className="text-sm font-semibold text-slate-700 mb-3 block">Período do Relatório</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { key: 'week', label: 'Última Semana' },
                { key: 'month', label: 'Este Mês' },
                { key: 'quarter', label: 'Este Trimestre' },
                { key: 'year', label: 'Este Ano' },
                { key: 'custom', label: 'Personalizado' },
              ].map((period) => (
                <button
                  key={period.key}
                  type="button"
                  onClick={() => setReportPeriod(period.key as typeof reportPeriod)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    reportPeriod === period.key
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
            
            {reportPeriod === 'custom' && (
              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500">Data Inicial</label>
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500">Data Final</label>
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
              </div>
            )}
            
            <p className="text-xs text-slate-500 mt-2">
              Período: {reportStats.periodStart.toLocaleDateString('pt-BR')} a {reportStats.periodEnd.toLocaleDateString('pt-BR')}
            </p>
          </div>

          {/* Cards de Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.total}</p>
              <p className="text-xs text-blue-100">Total de Prazos</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.completionRate}%</p>
              <p className="text-xs text-emerald-100">Taxa de Cumprimento</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.avgDaysToComplete}</p>
              <p className="text-xs text-amber-100">Média Dias p/ Cumprir</p>
            </div>
            <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-4 text-white">
              <p className="text-3xl font-bold">{reportStats.byStatus.vencido}</p>
              <p className="text-xs text-red-100">Vencidos no Período</p>
            </div>
          </div>

          {/* Gráficos em Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Por Status */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-slate-400" />
                Por Status
              </h4>
              <div className="space-y-2">
                {[
                  { label: 'Pendentes', value: reportStats.byStatus.pendente, color: 'bg-blue-500' },
                  { label: 'Cumpridos', value: reportStats.byStatus.cumprido, color: 'bg-emerald-500' },
                  { label: 'Vencidos', value: reportStats.byStatus.vencido, color: 'bg-red-500' },
                  { label: 'Cancelados', value: reportStats.byStatus.cancelado, color: 'bg-slate-400' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded ${item.color}`} />
                    <span className="text-xs text-slate-600 flex-1">{item.label}</span>
                    <span className="text-sm font-semibold text-slate-800">{item.value}</span>
                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color}`}
                        style={{ width: `${reportStats.total > 0 ? (item.value / reportStats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Por Prioridade */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-slate-400" />
                Por Prioridade
              </h4>
              <div className="space-y-2">
                {[
                  { label: 'Urgente', value: reportStats.byPriority.urgente, color: 'bg-red-500' },
                  { label: 'Alta', value: reportStats.byPriority.alta, color: 'bg-orange-500' },
                  { label: 'Média', value: reportStats.byPriority.media, color: 'bg-amber-500' },
                  { label: 'Baixa', value: reportStats.byPriority.baixa, color: 'bg-slate-400' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded ${item.color}`} />
                    <span className="text-xs text-slate-600 flex-1">{item.label}</span>
                    <span className="text-sm font-semibold text-slate-800">{item.value}</span>
                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color}`}
                        style={{ width: `${reportStats.total > 0 ? (item.value / reportStats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Por Tipo */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-400" />
                Por Tipo
              </h4>
              <div className="space-y-2">
                {[
                  { label: 'Geral', value: reportStats.byType.geral, color: 'bg-slate-500' },
                  { label: 'Processo', value: reportStats.byType.processo, color: 'bg-indigo-500' },
                  { label: 'Requerimento', value: reportStats.byType.requerimento, color: 'bg-purple-500' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded ${item.color}`} />
                    <span className="text-xs text-slate-600 flex-1">{item.label}</span>
                    <span className="text-sm font-semibold text-slate-800">{item.value}</span>
                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color}`}
                        style={{ width: `${reportStats.total > 0 ? (item.value / reportStats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Por Responsável */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Por Responsável (Top 5)
              </h4>
              <div className="space-y-2">
                {Object.entries(reportStats.byResponsible)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([name, value]) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-indigo-600">
                          {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs text-slate-600 flex-1 truncate">{name}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                    </div>
                  ))}
                {Object.keys(reportStats.byResponsible).length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-2">Nenhum dado disponível</p>
                )}
              </div>
            </div>
          </div>

          {/* Top Clientes */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-slate-400" />
              Clientes com Mais Prazos (Top 10)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(reportStats.byClient)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, value]) => (
                  <div key={name} className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-slate-800">{value}</p>
                    <p className="text-[10px] text-slate-500 truncate" title={name}>{name}</p>
                  </div>
                ))}
              {Object.keys(reportStats.byClient).length === 0 && (
                <p className="text-xs text-slate-400 col-span-5 text-center py-4">Nenhum dado disponível</p>
              )}
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setShowReportModal(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-black transition-all disabled:opacity-50"
            >
              {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Exportar PDF
            </button>
            <button
              type="button"
              onClick={handleExportReport}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-indigo-700 hover:to-purple-700 transition-all"
            >
              <Download className="w-4 h-4" />
              Exportar Relatório (Excel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const deadlineModal = isModalOpen && (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-3 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-6 max-h-[90vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {selectedDeadline ? 'Editar Prazo' : 'Novo Prazo'}
            </h3>
            <p className="text-xs text-slate-500">Cadastre prazos e vincule a processos ou requerimentos.</p>
          </div>
          <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-slate-700">Título do Prazo *</label>
              <input
                value={formData.title}
                onChange={(event) => handleFormChange('title', event.target.value)}
                className="input-field"
                placeholder="Ex: Contestação - Processo 123456"
                required
              />
            </div>

            {/* Calculadora de Prazo Processual */}
            <div className="md:col-span-2 bg-blue-50 rounded-lg p-3 border border-blue-200">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-blue-700" />
                <div>
                  <p className="text-sm font-semibold text-blue-900">Calculadora de Prazo Processual</p>
                  <p className="text-[11px] text-blue-700">
                    Informe a data de publicação no DJEN e os dias de prazo. O sistema calcula automaticamente ignorando finais de semana.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-semibold text-blue-900 mb-1">Tipo de prazo</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Processual (dias úteis)', value: 'processual' },
                      { label: 'Material (dias corridos)', value: 'material' },
                    ].map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        onClick={() => {
                          setTipoPrazoCalculadora(option.value as TipoPrazo);
                          if (dataPublicacao && diasPrazo) {
                            const dias = Number(diasPrazo);
                            if (!Number.isNaN(dias) && dias > 0) {
                              const dataVenc = calcularDataVencimento(dataPublicacao, dias, option.value as TipoPrazo);
                              handleFormChange('due_date', dataVenc);
                            }
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                          tipoPrazoCalculadora === option.value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-blue-800">Data Publicação DJEN</label>
                  <input
                    type="date"
                    value={dataPublicacao}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDataPublicacao(value);
                      if (value && diasPrazo) {
                        const dataVenc = calcularDataVencimento(value, parseInt(diasPrazo), tipoPrazoCalculadora);
                        handleFormChange('due_date', dataVenc);
                      }
                    }}
                    className="w-full mt-1 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-blue-800">Dias de Prazo (úteis)</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={diasPrazo}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDiasPrazo(value);
                        if (dataPublicacao && value) {
                          const dias = Number(value);
                          if (!Number.isNaN(dias) && dias > 0) {
                            const dataVenc = calcularDataVencimento(dataPublicacao, dias, tipoPrazoCalculadora);
                            handleFormChange('due_date', dataVenc);
                          }
                        }
                      }}
                      className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 15"
                    />
                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setDiasPrazo(e.target.value);
                        if (dataPublicacao) {
                          const dias = parseInt(e.target.value, 10);
                          const dataVenc = calcularDataVencimento(dataPublicacao, dias, tipoPrazoCalculadora);
                          handleFormChange('due_date', dataVenc);
                        }
                        e.currentTarget.selectedIndex = 0;
                      }}
                      className="px-2 py-2 border border-blue-300 rounded-lg text-xs text-blue-700 bg-white"
                    >
                      <option value="">Atalhos</option>
                      <option value="5">5 dias</option>
                      <option value="10">10 dias</option>
                      <option value="15">15 dias</option>
                      <option value="20">20 dias</option>
                      <option value="30">30 dias</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-blue-800">Data de Vencimento Calculada</label>
                  <div className="mt-1 px-3 py-2 bg-white border border-blue-300 rounded-lg text-sm font-semibold text-blue-900 min-h-[42px] flex items-center justify-between">
                    {formData.due_date ? (
                      <>
                        <span>{formatDate(formData.due_date)}</span>
                        <span className="text-xs font-normal text-blue-600">
                          {new Date(formData.due_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">Preencha data e dias para calcular</span>
                    )}
                  </div>
                  {calculadoraAtiva && (
                    <p className="text-[10px] text-blue-600 mt-1">
                      Resultado pronto! Salve o prazo para registrar esta data calculada.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-blue-200 pt-3">
                <p className="text-xs font-semibold text-blue-900 mb-2">Precisa ajustar manualmente?</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700">Data de Vencimento *</label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(event) => {
                        const selectedDate = new Date(event.target.value + 'T12:00:00');
                        const dayOfWeek = selectedDate.getDay();
                        
                        if (dayOfWeek === 0 || dayOfWeek === 6) {
                          alert('⚠️ Não é permitido cadastrar prazos em finais de semana.\n\nSelecione um dia útil (segunda a sexta).');
                          return;
                        }
                        setDataPublicacao('');
                        setDiasPrazo('');
                        handleFormChange('due_date', event.target.value);
                      }}
                      className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div className="flex items-end">
                    {formData.due_date && (
                      <p className="text-sm text-slate-600 pb-2">
                        {new Date(formData.due_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-blue-700 mt-2 space-y-1">
                <p>💡 Regras do CPC/2015 (art. 219):</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Processuais contam apenas dias úteis, iniciam no primeiro dia útil após a intimação e excluem finais de semana/feriados.</li>
                  <li>Materiais seguem dias corridos; use esta opção apenas quando a lei não determina dias úteis.</li>
                  <li>Feriado local precisa ser comprovado; nacionais são aplicados automaticamente.</li>
                </ul>
                <p className="text-[10px] text-blue-600">O prazo projetado é estimado; sempre confirme com o diário e normas locais.</p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Prioridade</label>
              <select
                value={formData.priority}
                onChange={(event) => handleFormChange('priority', event.target.value as DeadlinePriority)}
                className="input-field"
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority.key} value={priority.key}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Tipo</label>
              <select
                value={formData.type}
                onChange={(event) => {
                  const newType = event.target.value as DeadlineType;
                  handleFormChange('type', newType);
                  if (newType === 'processo') {
                    handleFormChange('requirement_id', '');
                    setRequirementSearchTerm('');
                  } else if (newType === 'requerimento') {
                    handleFormChange('process_id', '');
                    setProcessSearchTerm('');
                  } else {
                    handleFormChange('process_id', '');
                    handleFormChange('requirement_id', '');
                    setProcessSearchTerm('');
                    setRequirementSearchTerm('');
                  }
                }}
                className="input-field"
              >
                {TYPE_OPTIONS.map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Status</label>
              <select
                value={formData.status}
                onChange={(event) => handleFormChange('status', event.target.value as DeadlineStatus)}
                className="input-field"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <ClientSearchSelect
                value={formData.client_id}
                onChange={(clientId) => {
                  handleFormChange('client_id', clientId);
                  // Limpar processo ao trocar cliente
                  if (!clientId) {
                    handleFormChange('process_id', '');
                    setProcessSearchTerm('');
                  }
                }}
                label="Cliente *"
                placeholder="Buscar cliente..."
                required
                allowCreate={true}
              />
            </div>

            {formData.type === 'processo' && (
              <div className="md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">Vincular a Processo</label>
                  <span className="text-xs text-slate-500">
                    {formData.client_id ? 'Filtrando processos do cliente selecionado' : 'Selecione um cliente para habilitar os processos'}
                  </span>
                </div>
                <div className="relative">
                  <input
                    value={processSearchTerm}
                    onChange={(event) => {
                      setProcessSearchTerm(event.target.value);
                      if (!event.target.value) {
                        handleFormChange('process_id', '');
                      }
                    }}
                    onFocus={() => setShowProcessSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowProcessSuggestions(false), 150)}
                    className="input-field"
                    placeholder="Digite o código do processo"
                  />
                  {showProcessSuggestions && (
                    <div className="absolute mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto z-10">
                      {formData.client_id && filteredProcesses.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Nenhum processo encontrado para este cliente.</div>
                      ) : !formData.client_id ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Selecione um cliente para listar processos.</div>
                      ) : (
                        filteredProcesses.map((process) => (
                          <button
                            type="button"
                            key={process.id}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 transition"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              handleFormChange('process_id', process.id);
                              setProcessSearchTerm(process.process_code);
                              setShowProcessSuggestions(false);
                            }}
                          >
                            <div className="font-semibold text-slate-800">{process.process_code}</div>
                            <div className="text-xs text-slate-500">{process.court || 'Vara não informada'} • {process.status}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.process_id && (
                  <div className="mt-3 bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Processo selecionado:</span> {processSearchTerm || 'Código desconhecido'}
                  </div>
                )}
              </div>
            )}

            {formData.type === 'requerimento' && (
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-700">Vincular a Requerimento</label>
                <div className="relative">
                  <input
                    value={requirementSearchTerm}
                    onChange={(event) => {
                      setRequirementSearchTerm(event.target.value);
                      if (!event.target.value) {
                        handleFormChange('requirement_id', '');
                      }
                    }}
                    onFocus={() => setShowRequirementSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowRequirementSuggestions(false), 150)}
                    className="input-field"
                    placeholder="Digite o protocolo ou beneficiário"
                  />
                  {showRequirementSuggestions && (
                    <div className="absolute mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto z-10">
                      {filteredRequirements.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Nenhum requerimento encontrado.</div>
                      ) : (
                        filteredRequirements.map((requirement) => (
                          <button
                            type="button"
                            key={requirement.id}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 transition"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              handleFormChange('requirement_id', requirement.id);
                              setRequirementSearchTerm(`${requirement.protocol} - ${requirement.beneficiary}`);
                              setShowRequirementSuggestions(false);
                            }}
                          >
                            <div className="font-semibold text-slate-800">{requirement.protocol}</div>
                            <div className="text-xs text-slate-500">{requirement.beneficiary}</div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">Responsável *</label>
              <div className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => handleFormChange('responsible_id', member.id)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                      formData.responsible_id === member.id
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                    title={member.name}
                  >
                    {member.avatar_url ? (
                      <img
                        src={member.avatar_url}
                        alt={member.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-semibold text-slate-600">
                        {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="text-[10px] text-slate-600 font-medium max-w-[60px] truncate">
                      {member.name.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
              {!formData.responsible_id && (
                <p className="text-xs text-red-500 mt-1">Selecione um responsável</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Notificar (dias antes)</label>
              <input
                type="number"
                value={formData.notify_days_before}
                onChange={(event) => handleFormChange('notify_days_before', event.target.value)}
                className="input-field"
                min="0"
                max="30"
                placeholder="2"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Descrição</label>
            <textarea
              value={formData.description}
              onChange={(event) => handleFormChange('description', event.target.value)}
              rows={4}
              className="input-field"
              placeholder="Informações adicionais sobre o prazo"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {selectedDeadline ? 'Salvar alterações' : 'Criar prazo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (viewMode === 'details' && selectedDeadlineForView) {
    const statusConfig = getStatusConfig(selectedDeadlineForView.status);
    const priorityConfig = getPriorityConfig(selectedDeadlineForView.priority);
    const typeConfig = getTypeConfig(selectedDeadlineForView.type);
    const daysUntil = getDaysUntilDue(selectedDeadlineForView.due_date);
    const linkedProcess = selectedDeadlineForView.process_id
      ? processes.find((p) => p.id === selectedDeadlineForView.process_id)
      : null;
    const linkedRequirement = selectedDeadlineForView.requirement_id
      ? requirements.find((r) => r.id === selectedDeadlineForView.requirement_id)
      : null;
    const linkedClient = selectedDeadlineForView.client_id
      ? clientMap.get(selectedDeadlineForView.client_id)
      : null;
    const responsibleProfile = selectedDeadlineForView.responsible_id
      ? memberMap.get(selectedDeadlineForView.responsible_id)
      : null;

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Detalhes do Prazo</h3>
              <p className="text-sm text-slate-600 mt-1">Informações completas sobre o prazo.</p>
            </div>
            <button
              onClick={handleBackToList}
              className="text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-2"
            >
              ← Voltar para lista
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Título</label>
              <p className="text-base text-slate-900 mt-1 font-semibold">{selectedDeadlineForView.title}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Data de Vencimento</label>
              <p className="text-base text-slate-900 mt-1">{formatDate(selectedDeadlineForView.due_date)}</p>
              {daysUntil >= 0 ? (
                <p className="text-xs text-slate-500 mt-1">Faltam {daysUntil} dia(s)</p>
              ) : (
                <p className="text-xs text-red-600 mt-1 font-semibold">Vencido há {Math.abs(daysUntil)} dia(s)</p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
              <p className="mt-1">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedDeadlineForView.status)}`}>
                  {statusConfig && <statusConfig.icon className="w-3 h-3" />}
                  {getStatusLabel(selectedDeadlineForView.status)}
                </span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Prioridade</label>
              <p className="mt-1">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getPriorityBadge(selectedDeadlineForView.priority)}`}>
                  {priorityConfig && <priorityConfig.icon className="w-3 h-3" />}
                  {getPriorityLabel(selectedDeadlineForView.priority)}
                </span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Tipo</label>
              <p className="mt-1">
                <span className="inline-flex items-center gap-2 text-sm text-slate-900">
                  {typeConfig && <typeConfig.icon className="w-4 h-4" />}
                  {getTypeLabel(selectedDeadlineForView.type)}
                </span>
              </p>
            </div>

            {linkedProcess && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Processo Vinculado</label>
                <p className="text-base text-slate-900 mt-1 font-mono">{linkedProcess.process_code}</p>
              </div>
            )}

            {linkedRequirement && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Requerimento Vinculado</label>
                <p className="text-base text-slate-900 mt-1">
                  {linkedRequirement.protocol} - {linkedRequirement.beneficiary}
                </p>
              </div>
            )}

            {linkedClient && (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Cliente</label>
                <p className="text-base text-slate-900 mt-1">{linkedClient.full_name}</p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Responsável</label>
              <p className="text-base text-slate-900 mt-1 flex items-center gap-2">
                <UserCircle className="w-4 h-4 text-slate-500" />
                {responsibleProfile ? responsibleProfile.name : 'Não definido'}
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Descrição</label>
              <p className="text-base text-slate-900 mt-1 whitespace-pre-wrap">
                {selectedDeadlineForView.description || 'Nenhuma descrição'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Notificar (dias antes)</label>
              <p className="text-base text-slate-900 mt-1">{selectedDeadlineForView.notify_days_before ?? 3} dias</p>
            </div>

            {selectedDeadlineForView.completed_at && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Cumprido em</label>
                <p className="text-base text-slate-900 mt-1">{formatDateTime(selectedDeadlineForView.completed_at)}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => handleOpenModal(selectedDeadlineForView)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Edit2 className="w-4 h-4" />
              Editar Prazo
            </button>
            {selectedDeadlineForView.status === 'pendente' && (
              <button
                onClick={() => handleStatusChange(selectedDeadlineForView.id, 'cumprido')}
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Marcar como Cumprido
              </button>
            )}
            <button
              onClick={() => {
                handleDeleteDeadline(selectedDeadlineForView.id);
                handleBackToList();
              }}
              className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Excluir Prazo
            </button>
          </div>
        </div>
        {deadlineModal}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Prazos</h1>
          <p className="text-sm text-slate-500">Controle compromissos e prazos vinculados aos seus casos</p>
        </div>
        
        {/* Seletor de Mês */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (calendarMonth === 0) {
                setCalendarMonth(11);
                setCalendarYear(calendarYear - 1);
              } else {
                setCalendarMonth(calendarMonth - 1);
              }
            }}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-slate-800 capitalize min-w-[140px] text-center">
            {new Date(calendarYear, calendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => {
              if (calendarMonth === 11) {
                setCalendarMonth(0);
                setCalendarYear(calendarYear + 1);
              } else {
                setCalendarMonth(calendarMonth + 1);
              }
            }}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Cards de Estatísticas - Layout Horizontal */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setActiveStatusTab('todos')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${
            activeStatusTab === 'todos' ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-200' : 'bg-white border-slate-200'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{monthlyDeadlines.length}</p>
            <p className="text-xs text-slate-500">Total no mês</p>
          </div>
        </button>

        <button
          onClick={() => setActiveStatusTab('pendente')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${
            activeStatusTab === 'pendente' ? 'ring-2 ring-amber-500 bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{monthlyPending.length}</p>
            <p className="text-xs text-slate-500">Pendentes no mês</p>
          </div>
        </button>

        <button
          onClick={() => setActiveStatusTab('vencido')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${
            activeStatusTab === 'vencido' ? 'ring-2 ring-red-500 bg-red-50 border-red-200' : 'bg-white border-slate-200'
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            monthlyAttentionCount > 0 ? 'bg-red-500' : 'bg-slate-300'
          }`}>
            <AlertCircle className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{monthlyAttentionCount}</p>
            <p className="text-xs text-slate-500">Atenção no mês</p>
          </div>
        </button>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{monthlyCompleted.length}</p>
            <p className="text-xs text-slate-500">Concluídos no mês</p>
          </div>
        </div>
      </div>

      {/* Alertas inteligentes - Compacto */}
      {smartAlerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {smartAlerts.map((alert) => {
            const tone = ALERT_TONE_STYLES[alert.tone];
            return (
              <button
                key={alert.id}
                onClick={alert.onAction}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border ${tone.border} ${tone.bg} ${tone.text} hover:shadow-sm transition-all`}
              >
                {alert.icon}
                <span>{alert.title}: {alert.description.match(/\d+/)?.[0] || ''}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Abas de Navegação e Ações */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-slate-100">
          {/* Abas de Visualização */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'map' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Mapa
            </button>
            <button
              onClick={() => setCalendarExpanded(!calendarExpanded)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                calendarExpanded ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Calendário de Prazos
            </button>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReportModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Relatórios
            </button>
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Prazo
            </button>
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-slate-50/50 border-b border-slate-100">
          {/* Busca */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              placeholder="Buscar prazo..."
            />
          </div>

          {/* Filtros */}
          <div className="flex items-center gap-2">
            <select
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as DeadlineType | '')}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="">Tipo</option>
              {TYPE_OPTIONS.map((type) => (
                <option key={type.key} value={type.key}>{type.label}</option>
              ))}
            </select>

            <select
              value={filterPriority}
              onChange={(event) => setFilterPriority(event.target.value as DeadlinePriority | '')}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="">Prioridade</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority.key} value={priority.key}>{priority.label}</option>
              ))}
            </select>

            {(filterSearch || filterType || filterPriority) && (
              <button
                onClick={() => {
                  setFilterSearch('');
                  setFilterType('');
                  setFilterPriority('');
                }}
                className="px-2 py-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                title="Limpar filtros"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Calendário Mensal de Prazos - Retrátil */}
      {calendarExpanded && (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4">
            {/* Navegação do mês */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => {
                  if (calendarMonth === 0) {
                    setCalendarMonth(11);
                    setCalendarYear(calendarYear - 1);
                  } else {
                    setCalendarMonth(calendarMonth - 1);
                  }
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 capitalize">
                  {new Date(calendarYear, calendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
                {(calendarMonth !== new Date().getMonth() || calendarYear !== new Date().getFullYear()) && (
                  <button
                    onClick={() => {
                      setCalendarMonth(new Date().getMonth());
                      setCalendarYear(new Date().getFullYear());
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Hoje
                  </button>
                )}
              </div>
              
              <button
                onClick={() => {
                  if (calendarMonth === 11) {
                    setCalendarMonth(0);
                    setCalendarYear(calendarYear + 1);
                  } else {
                    setCalendarMonth(calendarMonth + 1);
                  }
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            {/* Dias da semana */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, i) => (
                <div key={day} className={`text-center text-[10px] font-medium py-1 ${
                  i === 0 || i === 6 ? 'text-red-400' : 'text-slate-500'
                }`}>
                  {day}
                </div>
              ))}
            </div>
        
            {/* Dias do mês */}
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const today = new Date();
                const year = calendarYear;
                const month = calendarMonth;
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells = [];
                
                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} className="h-8" />);
                }
                
                for (let day = 1; day <= daysInMonth; day++) {
                  const date = new Date(year, month, day);
                  const isToday = date.toDateString() === today.toDateString();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  
                  const dayStr = String(day).padStart(2, '0');
                  const monthStr = String(month + 1).padStart(2, '0');
                  const dateStr = `${year}-${monthStr}-${dayStr}`;
                  
                  const dayDeadlines = pendingDeadlines.filter(d => {
                    const dueDateStr = d.due_date?.split('T')[0];
                    return dueDateStr === dateStr;
                  });
                  const count = dayDeadlines.length;
                  const hasUrgent = dayDeadlines.some(d => d.priority === 'urgente' || d.priority === 'alta');
                  const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                  
                  cells.push(
                    <div
                      key={day}
                      className={`relative h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-all ${
                        isToday
                          ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                          : count > 0 && hasUrgent
                          ? 'bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer'
                          : count > 0
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 cursor-pointer'
                          : isWeekend
                          ? 'text-red-300 bg-red-50/50'
                          : isPast
                          ? 'text-slate-300'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title={count > 0 ? `${count} prazo(s)` : ''}
                    >
                      {day}
                      {count > 0 && (
                        <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${
                          hasUrgent ? 'bg-red-500 text-white' : 'bg-amber-500 text-white'
                        }`}>
                          {count}
                        </span>
                      )}
                    </div>
                  );
                }
                
                return cells;
              })()}
            </div>
        
            {/* Legenda */}
            <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                <span className="text-[10px] text-slate-500">Com prazo</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
                <span className="text-[10px] text-slate-500">Urgente</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-50 border border-red-200" />
                <span className="text-[10px] text-slate-500">Fim de semana</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Conteúdo Principal baseado no viewMode */}
      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {STATUS_FILTER_OPTIONS.map((statusOption) => {
            const StatusIcon = statusOption.icon;
            const statusDeadlines = filteredDeadlines.filter((d) => d.status === statusOption.key);
            const columnColors: Record<string, { bg: string; border: string; headerBg: string }> = {
              pendente: { bg: 'bg-blue-50/50', border: 'border-blue-200', headerBg: 'bg-blue-500' },
              vencido: { bg: 'bg-red-50/50', border: 'border-red-200', headerBg: 'bg-red-500' },
              cancelado: { bg: 'bg-slate-50/50', border: 'border-slate-200', headerBg: 'bg-slate-500' },
            };
            const colors = columnColors[statusOption.key] || columnColors.pendente;
            
            return (
              <div key={statusOption.key} className={`${colors.bg} border ${colors.border} rounded-2xl overflow-hidden`}>
                {/* Header da coluna */}
                <div className={`${colors.headerBg} px-4 py-3 flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <StatusIcon className="w-4 h-4 text-white" />
                    <h4 className="text-sm font-semibold text-white">{statusOption.label}</h4>
                  </div>
                  <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {statusDeadlines.length}
                  </span>
                </div>
                
                {/* Cards */}
                <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
                  {statusDeadlines.map((deadline) => {
                    const daysUntil = getDaysUntilDue(deadline.due_date);
                    const dueSoon = isDueSoon(deadline.due_date);
                    const priorityConfig = getPriorityConfig(deadline.priority);
                    const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                    
                    return (
                      <div
                        key={deadline.id}
                        className={`bg-white rounded-xl p-3 shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${
                          dueSoon || daysUntil < 0
                            ? 'border-l-red-500'
                            : deadline.priority === 'urgente'
                            ? 'border-l-red-500'
                            : deadline.priority === 'alta'
                            ? 'border-l-orange-500'
                            : deadline.priority === 'media'
                            ? 'border-l-amber-500'
                            : 'border-l-slate-300'
                        }`}
                        onClick={() => handleViewDeadline(deadline)}
                      >
                        {/* Título e prioridade */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h5 className="text-sm font-semibold text-slate-800 line-clamp-2">{deadline.title}</h5>
                          {priorityConfig && (
                            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${getPriorityBadge(deadline.priority)}`}>
                              {priorityConfig.label.slice(0, 3).toUpperCase()}
                            </span>
                          )}
                        </div>
                        
                        {/* Cliente */}
                        {clientItem && (
                          <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                            <UserCircle className="w-3 h-3" />
                            <span className="truncate">{clientItem.full_name}</span>
                          </p>
                        )}
                        
                        {/* Data e dias */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <span className="text-[10px] text-slate-400">{formatDate(deadline.due_date)}</span>
                          {daysUntil >= 0 ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              dueSoon ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {daysUntil === 0 ? 'Hoje' : daysUntil === 1 ? 'Amanhã' : `${daysUntil}d`}
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500 text-white">
                              {Math.abs(daysUntil)}d atrás
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {statusDeadlines.length === 0 && (
                    <div className="text-center py-8">
                      <StatusIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Nenhum prazo</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'map' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div>
              <h4 className="text-lg font-semibold text-slate-900">Mapa de Prazos: plano de ação</h4>
              <p className="text-sm text-slate-600">
                Utilize este quadro como caminho de execução. Priorize blocos da esquerda para a direita.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Siren className="w-3 h-3 text-red-600" />
              <span>Indica prazos que expiram em até 2 dias.</span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {MAP_BUCKETS.map((bucket) => {
              const BucketIcon = bucket.icon;
              const bucketDeadlines = pendingDeadlines
                .map((deadline) => ({
                  ...deadline,
                  daysUntil: getDaysUntilDue(deadline.due_date),
                }))
                .filter((deadline) => bucket.predicate(deadline.daysUntil))
                .sort((a, b) => {
                  const priorityOrder: Record<DeadlinePriority, number> = {
                    urgente: 0,
                    alta: 1,
                    media: 2,
                    baixa: 3,
                  };
                  const comparePriority = priorityOrder[a.priority] - priorityOrder[b.priority];
                  if (comparePriority !== 0) return comparePriority;
                  return a.daysUntil - b.daysUntil;
                });

              const awaitingProcesses = bucket.key === 'awaiting_drafting'
                ? processes.filter((processItem) => processItem.status === 'aguardando_confeccao')
                : [];
              const awaitingRequirements = bucket.key === 'awaiting_drafting'
                ? requirements.filter((requirementItem) => requirementItem.status === 'aguardando_confeccao')
                : [];
              const totalItems = bucket.key === 'awaiting_drafting'
                ? awaitingProcesses.length + awaitingRequirements.length
                : bucketDeadlines.length;

              return (
                <div key={bucket.key} className="border border-slate-200 rounded-xl p-5 shadow-sm bg-slate-50/60">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <BucketIcon className={`w-4 h-4 ${bucket.colorClass}`} />
                        <h5 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">{bucket.label}</h5>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 max-w-lg">{bucket.description}</p>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{totalItems}</span>
                  </div>

                  {bucket.key === 'awaiting_drafting' ? (
                    awaitingProcesses.length === 0 && awaitingRequirements.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-8">Nenhum processo ou requerimento aguardando confecção.</p>
                    ) : (
                      <div className="space-y-3">
                        {awaitingProcesses.map((processItem) => {
                          const clientItem = clientMap.get(processItem.client_id);
                          const displayCode = processItem.process_code?.length ? processItem.process_code : 'Sem número definido';
                          return (
                            <div
                              key={processItem.id}
                              className="rounded-lg border border-blue-200 bg-white p-4 hover:shadow-lg transition"
                            >
                              <div className="flex items-start justify-between">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 uppercase">
                                  Processo
                                </span>
                                <span className="text-sm font-medium text-slate-600">{displayCode}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-slate-600">
                                {clientItem && (
                                  <div>
                                    <span className="font-semibold text-slate-900">Cliente:</span> {clientItem.full_name}
                                  </div>
                                )}
                                <p className="text-xs text-slate-500">
                                  Prepare a petição inicial e atualize o processo para liberar o protocolo e criação de prazos.
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        {awaitingRequirements.map((requirementItem) => {
                          const displayProtocol = requirementItem.protocol?.length ? requirementItem.protocol : 'Sem protocolo gerado';
                          return (
                            <div
                              key={requirementItem.id}
                              className="rounded-lg border border-sky-200 bg-white p-4 hover:shadow-lg transition"
                            >
                              <div className="flex items-start justify-between">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-700 uppercase">
                                  Requerimento
                                </span>
                                <span className="text-sm font-medium text-slate-600">{displayProtocol}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-slate-600">
                                <div>
                                  <span className="font-semibold text-slate-900">Beneficiário:</span> {requirementItem.beneficiary}
                                </div>
                                <p className="text-xs text-slate-500">
                                  Organize documentos e protocole o requerimento administrativo antes de prosseguir.
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : totalItems === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-8">Nenhum prazo neste momento.</p>
                  ) : (
                    <div className="space-y-3">
                      {bucketDeadlines.map((deadline) => {
                        const priorityConfig = getPriorityConfig(deadline.priority);
                        const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                        const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
                        const dueSoon = isDueSoon(deadline.due_date);

                        return (
                          <div
                            key={deadline.id}
                            className={`rounded-lg border bg-white p-4 hover:shadow-md transition cursor-pointer ${
                              dueSoon ? 'border-red-300' : 'border-slate-200'
                            }`}
                            onClick={() => handleViewDeadline(deadline)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h6 className="text-sm font-semibold text-slate-900">{deadline.title}</h6>
                                  {priorityConfig && (
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getPriorityBadge(deadline.priority)}`}>
                                      {priorityConfig.label}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-600 mt-1 flex flex-wrap gap-3">
                                  {clientItem && (
                                    <span className="flex items-center gap-1">
                                      <UserCircle className="w-3 h-3" />
                                      {clientItem.full_name}
                                    </span>
                                  )}
                                  {responsibleItem && <span>Responsável: {responsibleItem.name}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1 text-xs">
                                <span className="text-slate-500">{formatDate(deadline.due_date)}</span>
                                <span className={`flex items-center gap-1 font-semibold ${dueSoon ? 'text-red-600' : 'text-slate-600'}`}>
                                  {dueSoon && <Siren className="w-3 h-3" />}
                                  {deadline.daysUntil >= 0 ? `${deadline.daysUntil} dia(s)` : 'Vencido'}
                                </span>
                              </div>
                            </div>
                            {deadline.description && (
                              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{deadline.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-16 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando prazos...</p>
        </div>
      ) : filteredDeadlines.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-slate-600">Nenhum prazo encontrado.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="block lg:hidden divide-y divide-gray-200">
            {paginatedDeadlines.map((deadline) => {
              const priorityConfig = getPriorityConfig(deadline.priority);
              const typeConfig = getTypeConfig(deadline.type);
              const daysUntil = getDaysUntilDue(deadline.due_date);
              const dueSoon = isDueSoon(deadline.due_date);
              const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
              const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;

              return (
                <div key={deadline.id} className={`p-3 sm:p-4 ${dueSoon && deadline.status === 'pendente' ? 'bg-red-50/70' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{deadline.title}</h3>
                      {deadline.description && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{deadline.description}</p>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${getPriorityBadge(deadline.priority)}`}>
                      {priorityConfig && <priorityConfig.icon className="w-3 h-3" />}
                      {getPriorityLabel(deadline.priority)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <span className="text-slate-500">Vencimento:</span>
                      <p className="font-medium text-gray-900">{formatDate(deadline.due_date)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Dias:</span>
                      {daysUntil >= 0 ? (
                        <p className={`font-medium ${dueSoon ? 'text-red-600' : 'text-gray-900'}`}>
                          {daysUntil} dia(s)
                        </p>
                      ) : (
                        <p className="font-medium text-red-600">Vencido</p>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">Cliente:</span>
                      <p className="font-medium text-gray-900 truncate">{clientItem ? clientItem.full_name : 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Tipo:</span>
                      <p className="font-medium text-gray-900">{getTypeLabel(deadline.type)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDeadline(deadline)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-xs font-medium"
                    >
                      <Eye className="w-3 h-3" />
                      Ver
                    </button>
                    <button
                      onClick={() => handleOpenModal(deadline)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-amber-50 text-amber-700 px-3 py-2 rounded-lg text-xs font-medium"
                    >
                      <Edit2 className="w-3 h-3" />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteDeadline(deadline.id)}
                      className="px-3 py-2 bg-red-50 text-red-700 rounded-lg"
                      title="Excluir"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table - Layout conforme imagem */}
          <div className="hidden lg:block">
            <table className="w-full">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Prazo</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Vencimento</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Dias</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Cliente / Prioridade</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedDeadlines.map((deadline) => {
                  const isUpdating = statusUpdatingId === deadline.id;
                  const priorityConfig = getPriorityConfig(deadline.priority);
                  const daysUntil = getDaysUntilDue(deadline.due_date);
                  const dueSoon = isDueSoon(deadline.due_date);
                  const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                  const linkedProcess = deadline.process_id ? processes.find(p => p.id === deadline.process_id) : null;

                  return (
                    <tr
                      key={deadline.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        dueSoon && deadline.status === 'pendente' ? 'bg-red-50/30' : ''
                      }`}
                    >
                      {/* Coluna PRAZO */}
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-blue-600 hover:text-blue-700 cursor-pointer" onClick={() => handleViewDeadline(deadline)}>
                            {deadline.title.toUpperCase()}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {linkedProcess ? `Prazos vinculados aos prazos` : 'Prazos vinculados aos prazos'}
                          </p>
                        </div>
                      </td>
                      
                      {/* Coluna VENCIMENTO */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-700">{formatDate(deadline.due_date)}</span>
                      </td>
                      
                      {/* Coluna DIAS */}
                      <td className="px-4 py-3">
                        {daysUntil >= 0 ? (
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${
                            dueSoon ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {daysUntil} dias
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500 text-white">
                            {Math.abs(daysUntil)} dias
                          </span>
                        )}
                      </td>
                      
                      {/* Coluna CLIENTE / PRIORIDADE */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm text-slate-800">
                            {clientItem ? clientItem.full_name : '-'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                              deadline.priority === 'media' ? 'bg-amber-100 text-amber-700' :
                              deadline.priority === 'alta' ? 'bg-red-100 text-red-700' :
                              deadline.priority === 'urgente' ? 'bg-red-500 text-white' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {priorityConfig?.label}
                            </span>
                            {(deadline.priority === 'alta' || deadline.priority === 'urgente') && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                                Alta
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      
                      {/* Coluna STATUS */}
                      <td className="px-4 py-3">
                        <select
                          value={deadline.status}
                          onChange={(e) => handleStatusChange(deadline.id, e.target.value as DeadlineStatus)}
                          disabled={isUpdating}
                          className="text-xs font-medium px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 cursor-pointer"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.key} value={opt.key}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      
                      {/* Coluna AÇÕES */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleViewDeadline(deadline)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Ver"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(deadline)}
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteDeadline(deadline.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredDeadlines.length > pageSize && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Anterior
          </button>
          <div className="text-sm text-slate-600">
            Página {currentPage} de {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Próxima
          </button>
        </div>
      )}

      {deadlineModal}
      {reportModal}

      {/* Histórico de Prazos Cumpridos */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <h4 className="text-base font-semibold text-slate-900">Histórico - Últimos Prazos Cumpridos</h4>
        </div>

        {completedDeadlines.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Nenhum prazo cumprido ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {completedDeadlines.map((deadline) => {
              const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
              const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
              const priorityConfig = getPriorityConfig(deadline.priority);
              return (
                <div
                  key={deadline.id}
                  className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-6 py-4 hover:bg-slate-50 transition"
                >
                  {/* Info do prazo */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <h5 className="text-sm font-semibold text-slate-900">{deadline.title}</h5>
                      {priorityConfig && (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          deadline.priority === 'media' ? 'bg-amber-100 text-amber-700' :
                          deadline.priority === 'alta' ? 'bg-red-100 text-red-700' :
                          deadline.priority === 'urgente' ? 'bg-red-500 text-white' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {priorityConfig.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {clientItem ? `Cliente ${clientItem.full_name}` : 'Sem cliente'}
                    </p>
                  </div>
                  
                  {/* Datas */}
                  <div className="flex flex-wrap items-center gap-4 text-sm min-w-[240px]">
                    <div>
                      <p className="text-slate-500 text-xs uppercase tracking-wide">Vencimento</p>
                      <p className="text-slate-800 font-medium">{formatDate(deadline.due_date)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs uppercase tracking-wide">Cumprido</p>
                      <p className="text-slate-800 font-medium">{deadline.completed_at ? formatDate(deadline.completed_at) : '-'}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs uppercase tracking-wide">Responsável</p>
                      <p className="text-slate-800 font-medium">{responsibleItem ? responsibleItem.name : '—'}</p>
                    </div>
                  </div>
                  
                  {/* Badge e Ações */}
                  <div className="flex items-center gap-3 md:ml-6">
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                      <CheckCircle className="w-3 h-3" />
                      CONCLUÍDO
                    </span>
                    <button
                      onClick={() => handleViewDeadline(deadline)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition"
                    >
                      Ver
                    </button>
                    <button
                      onClick={() => handleStatusChange(deadline.id, 'pendente')}
                      className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg transition"
                    >
                      Reabrir
                    </button>
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

export default DeadlinesModule;
