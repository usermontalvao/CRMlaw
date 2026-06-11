import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DeadlineFormModal } from './DeadlineFormModal';
import { Modal, ModalBody } from './ui';
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
  Check,
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
  Copy,
  MessageSquare,
  Send,
  SquareCheck,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { matchesNormalizedSearch } from '../utils/search';
import { supabase } from '../config/supabase';
import { deadlineService } from '../services/deadline.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { settingsService, type ModuleResponsibilityConfig } from '../services/settings.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { userNotificationService } from '../services/userNotification.service';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { usePermissions } from '../hooks/usePermissions';
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

import { events, SYSTEM_EVENTS } from '../utils/events';

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
  calendarMonth?: number;
  calendarYear?: number;
  onCalendarChange?: (month: number, year: number) => void;
}

const DeadlinesModule: React.FC<DeadlinesModuleProps> = ({ forceCreate, entityId, onParamConsumed, prefillData, calendarMonth: propCalendarMonth, calendarYear: propCalendarYear, onCalendarChange }) => {
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const { user } = useAuth();
  const { navigateTo } = useNavigation();
  const { isAdmin, loading: permissionsLoading } = usePermissions();

  const [statusOptions, setStatusOptions] = useState(STATUS_OPTIONS);
  const [priorityOptions, setPriorityOptions] = useState(PRIORITY_OPTIONS);
  const [typeOptions, setTypeOptions] = useState(TYPE_OPTIONS);
  const [defaultDeadlineStatus, setDefaultDeadlineStatus] = useState<string | null>(null);
  const [defaultDeadlinePriority, setDefaultDeadlinePriority] = useState<string | null>(null);
  const statusFilterOptions = statusOptions.filter(s => s.key !== 'cumprido');
  const [soonDaysThreshold, setSoonDaysThreshold] = useState(2);
  const [weekDaysThreshold, setWeekDaysThreshold] = useState(7);
  const [defaultNotifyDays, setDefaultNotifyDays] = useState(2);
  const [defaultDeadlineDays, setDefaultDeadlineDays] = useState(0);

  const resolvedBuckets = useMemo(() => MAP_BUCKETS.map(b => {
    if (b.key === 'soon') return {
      ...b,
      label: `Próximos ${soonDaysThreshold} Dia${soonDaysThreshold === 1 ? '' : 's'}`,
      predicate: (days: number) => days > 0 && days <= soonDaysThreshold,
    };
    if (b.key === 'week') return {
      ...b,
      label: `Próximos ${soonDaysThreshold + 1}-${weekDaysThreshold} Dias`,
      predicate: (days: number) => days > soonDaysThreshold && days <= weekDaysThreshold,
    };
    return b;
  }), [soonDaysThreshold, weekDaysThreshold]);

  const checkIsDueSoon = useCallback((dueDate: string) => {
    const days = getDaysUntilDue(dueDate);
    return days >= 0 && days <= soonDaysThreshold;
  }, [soonDaysThreshold]);

  useEffect(() => {
    settingsService.getResponsibilityConfig().then(cfgs => {
      const cfg = cfgs.find(c => c.module === 'deadlines');
      if (cfg) setResponsibilityConfig(cfg);
    }).catch(() => {});
    settingsService.getPreferences().then(prefs => {
      if (prefs.default_deadline_days && prefs.default_deadline_days > 0) {
        setDefaultDeadlineDays(prefs.default_deadline_days);
      }
    }).catch(() => {});
    settingsService.getDeadlineModuleConfig().then(cfg => {
      setSoonDaysThreshold(cfg.soon_days_threshold ?? 2);
      setWeekDaysThreshold(cfg.week_days_threshold ?? 7);
      setDefaultNotifyDays(cfg.default_notify_days ?? 2);
      if (cfg.statuses.length > 0) {
        const relabeled = STATUS_OPTIONS
          .filter(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return !sv || sv.active !== false; })
          .map(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return sv ? { ...local, label: sv.label, badge: sv.badge ?? local.badge } : local; });
        const newItems = cfg.statuses.filter(s => !STATUS_OPTIONS.some(l => l.key === s.key) && s.active !== false);
        const neutralized = newItems.map(s => ({
          key: s.key as DeadlineStatus,
          label: s.label,
          badge: s.badge ?? 'bg-gray-100 text-gray-700',
          icon: Clock,
        }));
        setStatusOptions([...relabeled, ...neutralized]);
        const defStatus = cfg.statuses.find(s => s.isDefault && s.active !== false);
        if (defStatus) setDefaultDeadlineStatus(defStatus.key);
      }
      if (cfg.priorities.length > 0) {
        const relabeled = PRIORITY_OPTIONS
          .filter(local => { const sv = cfg.priorities.find(p => p.key === (local.key as string)); return !sv || sv.active !== false; })
          .map(local => { const sv = cfg.priorities.find(p => p.key === (local.key as string)); return sv ? { ...local, label: sv.label, badge: sv.badge ?? local.badge } : local; });
        const newItems = cfg.priorities.filter(p => !PRIORITY_OPTIONS.some(l => l.key === p.key) && p.active !== false);
        const neutralized = newItems.map(p => ({
          key: p.key as DeadlinePriority,
          label: p.label,
          badge: p.badge ?? 'bg-gray-100 text-gray-700',
          icon: Clock,
        }));
        setPriorityOptions([...relabeled, ...neutralized]);
        const defPriority = cfg.priorities.find(p => p.isDefault && p.active !== false);
        if (defPriority) setDefaultDeadlinePriority(defPriority.key);
      }
      if (cfg.types.length > 0) {
        setTypeOptions(cfg.types.filter(t => t.active !== false).map(t => {
          const local = TYPE_OPTIONS.find(to => to.key === (t.key as DeadlineType));
          return local ? { ...local, label: t.label } : { key: t.key as DeadlineType, label: t.label, icon: TYPE_OPTIONS[0].icon };
        }));
      }
    }).catch(() => {});
  }, []);

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
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'map' | 'details' | 'workload'>('list');
  const [selectedDeadlineForView, setSelectedDeadlineForView] = useState<Deadline | null>(null);
  const [showViewDeadlineModal, setShowViewDeadlineModal] = useState(false);
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
  const [responsibilityConfig, setResponsibilityConfig] = useState<ModuleResponsibilityConfig | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [internalCalendarMonth, setInternalCalendarMonth] = useState(propCalendarMonth || new Date().getMonth());
  const [internalCalendarYear, setInternalCalendarYear] = useState(propCalendarYear || new Date().getFullYear());
  
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

  // Estados para operações em lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Estados para comentários
  type DeadlineComment = { id: string; content: string; user_name: string; created_at: string; user_id: string | null; parent_id: string | null };
  const [comments, setComments] = useState<DeadlineComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [savingComment, setSavingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [showCommentsFor, setShowCommentsFor] = useState<string | null>(null);

  // Estados do histórico
  const [historySearch, setHistorySearch] = useState('');
  const [historyMonth, setHistoryMonth] = useState<number | ''>('');
  const [historyYear, setHistoryYear] = useState<number | ''>('');
  const [historyType, setHistoryType] = useState<DeadlineType | ''>('');
  const [historyPriority, setHistoryPriority] = useState<DeadlinePriority | ''>('');
  const [historyResponsible, setHistoryResponsible] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFiltersExpanded, setHistoryFiltersExpanded] = useState(false);
  const HISTORY_PAGE_SIZE = 10;

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
    async (id: string) => {
      const filter = savedFilters.find((f) => f.id === id);
      const confirmed = await confirmDelete({
        title: 'Remover filtro salvo',
        entityName: filter?.name || undefined,
        message: 'Tem certeza que deseja remover este filtro salvo?',
        confirmLabel: 'Remover',
      });
      if (!confirmed) return;
      notifyDeleted(filter?.name || undefined);
      setSavedFilters((prev) => prev.filter((f) => f.id !== id));
      if (selectedSavedFilterId === id) {
        setSelectedSavedFilterId('');
      }
    },
    [selectedSavedFilterId, savedFilters, confirmDelete, notifyDeleted],
  );

  // ── Operações em lote ─────────────────────────────────────────────────────
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => prev.size === ids.length ? new Set() : new Set(ids));
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    const confirmed = await confirmDelete({
      title: `Excluir ${selectedIds.size} prazo(s)`,
      message: `Deseja realmente excluir ${selectedIds.size} prazo(s) selecionado(s)? Essa ação é irreversível.`,
      confirmLabel: 'Excluir todos',
    });
    if (!confirmed) return;
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.deleteDeadline(id)));
      notifyDeleted();
      setDeadlines((prev) => prev.filter((d) => !selectedIds.has(d.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir prazos.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds, confirmDelete, notifyDeleted]);

  const handleBulkStatusChange = useCallback(async (status: DeadlineStatus) => {
    if (!selectedIds.size) return;
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.updateStatus(id, status)));
      setDeadlines((prev) => prev.map((d) => selectedIds.has(d.id) ? { ...d, status } : d));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status em lote.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds]);

  const handleBulkResponsibleChange = useCallback(async (responsibleId: string) => {
    if (!selectedIds.size || !responsibleId) return;
    setBulkActionLoading(true);
    try {
      await Promise.all([...selectedIds].map((id) => deadlineService.updateDeadline(id, { responsible_id: responsibleId })));
      setDeadlines((prev) => prev.map((d) => selectedIds.has(d.id) ? { ...d, responsible_id: responsibleId } : d));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar responsável em lote.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [selectedIds]);

  // ── Duplicar prazo ────────────────────────────────────────────────────────
  const handleCloneDeadline = useCallback(async (deadline: Deadline) => {
    try {
      setSaving(true);
      const clone = await deadlineService.createDeadline({
        title: `[CÓPIA] ${deadline.title}`,
        description: deadline.description,
        due_date: deadline.due_date,
        status: 'pendente',
        priority: deadline.priority,
        type: deadline.type,
        process_id: deadline.process_id,
        requirement_id: deadline.requirement_id,
        client_id: deadline.client_id,
        responsible_id: deadline.responsible_id,
        notify_days_before: deadline.notify_days_before,
      });
      setDeadlines((prev) => [clone, ...prev]);
    } catch (err: any) {
      setError(err.message || 'Erro ao duplicar prazo.');
    } finally {
      setSaving(false);
    }
  }, []);


  // ── Comentários ───────────────────────────────────────────────────────────
  const resolveUserNames = useCallback(async (userIds: string[]): Promise<Map<string, string>> => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data } = await supabase
      .from('profiles')
      .select('user_id, name')
      .in('user_id', ids);
    return new Map((data || []).map((p: any) => [p.user_id, p.name]));
  }, []);

  const loadComments = useCallback(async (deadlineId: string) => {
    setCommentsLoading(true);
    setComments([]);
    try {
      const { data, error: err } = await supabase
        .from('deadline_comments')
        .select('id, content, created_at, user_id, parent_id')
        .eq('deadline_id', deadlineId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      const rows = data || [];
      // Resolve nomes primeiro pelos membros já em memória; só consulta o banco p/ os faltantes
      const localMap = new Map(members.map((mem) => [mem.user_id, mem.name]));
      const missing = rows
        .map((r: any) => r.user_id)
        .filter((uid: string) => uid && !localMap.has(uid));
      const fetchedMap = missing.length > 0 ? await resolveUserNames(missing) : new Map();
      const nameOf = (uid: string) => localMap.get(uid) || fetchedMap.get(uid) || 'Usuário';
      setComments(rows.map((c: any) => ({
        id: c.id,
        content: c.content,
        user_name: nameOf(c.user_id),
        created_at: c.created_at,
        user_id: c.user_id,
        parent_id: c.parent_id ?? null,
      })));
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [resolveUserNames, members]);

  const handleAddComment = useCallback(async (deadlineId: string) => {
    const text = commentText.trim();
    if (!text) return;
    setSavingComment(true);
    const parentId = replyingTo?.id ?? null;
    // ── Otimista: o comentário aparece na hora ───────────────────────
    const tempId = `temp-${Date.now()}`;
    const optimistic: DeadlineComment = {
      id: tempId,
      content: text,
      user_name: currentUser?.name || 'Você',
      created_at: new Date().toISOString(),
      user_id: user?.id ?? null,
      parent_id: parentId,
    };
    setComments((prev) => [...prev, optimistic]);
    setCommentText('');
    setReplyingTo(null);
    setMentionQuery(null);
    try {
      const { data, error: err } = await supabase
        .from('deadline_comments')
        .insert({ deadline_id: deadlineId, content: text, user_id: user?.id, parent_id: parentId })
        .select('id, content, created_at, user_id, parent_id')
        .single();
      if (err) throw err;
      // Substitui o temporário pelo registro real
      setComments((prev) => prev.map((c) => c.id === tempId ? {
        id: data.id,
        content: data.content,
        user_name: currentUser?.name || 'Você',
        created_at: data.created_at,
        user_id: data.user_id,
        parent_id: data.parent_id ?? null,
      } : c));

      // ── Processar @menções ──────────────────────────────────────────
      const mentionRegex = /@([A-Za-zÀ-ÖØ-öø-ÿ]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      const mentioned = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = mentionRegex.exec(text)) !== null) {
        mentioned.add(m[1].toLowerCase().trim());
      }
      if (mentioned.size > 0) {
        const authorName = currentUser?.name || 'Um colega';
        const deadlineTitle = deadlines.find((d) => d.id === deadlineId)?.title || 'Prazo';
        const targets = members.filter((mem) => {
          if (!mem.user_id || mem.user_id === user?.id) return false;
          const memName = (mem.name || '').toLowerCase().trim();
          const memFirst = memName.split(/\s+/)[0];
          return [...mentioned].some((q) => memName === q || memName.includes(q) || q.includes(memFirst));
        });
        for (const target of targets) {
          userNotificationService.createNotification({
            user_id: target.user_id,
            type: 'mention',
            title: `${authorName} mencionou você em um comentário`,
            message: text.length > 120 ? text.slice(0, 120) + '...' : text,
            deadline_id: deadlineId,
            metadata: { deadline_id: deadlineId, comment_id: data.id, author_id: user?.id, author_name: authorName },
          }).catch((e) => console.error('Erro ao notificar menção:', e));

          supabase.functions.invoke('notify-comment-mention', {
            body: {
              deadline_id: deadlineId,
              mentioned_profile_id: target.id,
              author_name: authorName,
              comment_text: text,
            },
          }).catch((e) => console.error('Erro ao enviar email de menção:', e));
        }
      }
    } catch (err: any) {
      // Falhou: remove o comentário otimista e devolve o texto ao input
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setCommentText(text);
      setError(err.message || 'Erro ao salvar comentário.');
    } finally {
      setSavingComment(false);
    }
  }, [commentText, user?.id, currentUser?.name, members, deadlines, replyingTo]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    setDeletingCommentId(commentId);
    try {
      const { error: err } = await supabase.from('deadline_comments').delete().eq('id', commentId);
      if (err) throw err;
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_id !== commentId));
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir comentário.');
    } finally {
      setDeletingCommentId(null);
    }
  }, []);

  const handleCommentChange = useCallback((value: string) => {
    setCommentText(value);
    const match = value.match(/@([\p{L}]*)$/u);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  }, []);

  const pickMention = useCallback((memberName: string) => {
    setCommentText((prev) => prev.replace(/@[\p{L}]*$/u, `@${memberName} `));
    setMentionQuery(null);
  }, []);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    return members
      .filter((mem) => (mem.name || '').toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, members]);

  const filteredDeadlines = useMemo(() => {
    let filtered = deadlines;

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((deadline) => deadline.status === activeStatusTab);
    } else {
      filtered = filtered.filter((deadline) => deadline.status !== 'cumprido');
    }

    if (filterSearch.trim()) {
      const term = filterSearch;
      filtered = filtered.filter(
        (deadline) =>
          matchesNormalizedSearch(term, [deadline.title, deadline.description || '']),
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
      .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime());
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

  const isPastMonth = useMemo(() => {
    const today = new Date();
    const currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const selectedDate = new Date(internalCalendarYear, internalCalendarMonth, 1);
    return selectedDate < currentDate;
  }, [internalCalendarMonth, internalCalendarYear]);

  const monthlyDeadlines = useMemo(() => {
    return deadlines.filter((deadline) => {
      if (isPastMonth) {
        if (deadline.status !== 'cumprido' || !deadline.completed_at) return false;
        const completed = new Date(deadline.completed_at);
        return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
      }

      // Se o prazo foi concluído, considerar o mês da conclusão
      if (deadline.status === 'cumprido' && deadline.completed_at) {
        const completed = new Date(deadline.completed_at);
        return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
      }

      // Para prazos pendentes, vencidos ou cancelados, considerar o mês de vencimento
      const due = parseDateOnly(deadline.due_date);
      if (!due) return false;
      return due.getMonth() === internalCalendarMonth && due.getFullYear() === internalCalendarYear;
    });
  }, [deadlines, internalCalendarMonth, internalCalendarYear, isPastMonth]);

  const monthlyPending = useMemo(
    () => monthlyDeadlines.filter((deadline) => deadline.status === 'pendente'),
    [monthlyDeadlines],
  );

  const monthlyCompleted = useMemo(() => {
    return deadlines.filter((deadline) => {
      if (deadline.status !== 'cumprido' || !deadline.completed_at) return false;
      const completed = new Date(deadline.completed_at);
      return completed.getMonth() === internalCalendarMonth && completed.getFullYear() === internalCalendarYear;
    });
  }, [deadlines, internalCalendarMonth, internalCalendarYear]);

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
    () => new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    [internalCalendarMonth, internalCalendarYear],
  );

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  // ── Histórico filtrado ────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    let base = isPastMonth ? monthlyCompleted : completedDeadlines;

    if (historySearch.trim()) {
      const term = historySearch.trim().toLowerCase();
      base = base.filter((d) =>
        d.title.toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term) ||
        (d.client_id ? (clientMap.get(d.client_id)?.full_name || '').toLowerCase().includes(term) : false)
      );
    }
    if (historyMonth !== '') {
      base = base.filter((d) => {
        const dt = new Date(d.completed_at || d.updated_at);
        return dt.getMonth() === historyMonth;
      });
    }
    if (historyYear !== '') {
      base = base.filter((d) => {
        const dt = new Date(d.completed_at || d.updated_at);
        return dt.getFullYear() === historyYear;
      });
    }
    if (historyType) base = base.filter((d) => d.type === historyType);
    if (historyPriority) base = base.filter((d) => d.priority === historyPriority);
    if (historyResponsible) base = base.filter((d) => d.responsible_id === historyResponsible);
    return base;
  }, [isPastMonth, monthlyCompleted, completedDeadlines, historySearch, historyMonth, historyYear, historyType, historyPriority, historyResponsible, clientMap]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

  const historyYears = useMemo(() => {
    const years = new Set(completedDeadlines.map((d) => new Date(d.completed_at || d.updated_at).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [completedDeadlines]);

  // ── Exportar lista filtrada ───────────────────────────────────────────────
  const handleExportFiltered = useCallback(() => {
    if (!filteredDeadlines.length) {
      alert('Nenhum prazo na lista filtrada para exportar.');
      return;
    }
    const data = filteredDeadlines.map((d) => ({
      'Título': d.title,
      'Vencimento': formatDate(d.due_date),
      'Status': getStatusLabel(d.status),
      'Prioridade': getPriorityLabel(d.priority),
      'Tipo': getTypeLabel(d.type),
      'Cliente': d.client_id ? (clientMap.get(d.client_id)?.full_name || '-') : '-',
      'Responsável': d.responsible_id ? (memberMap.get(d.responsible_id)?.name || '-') : '-',
      'Dias p/ vencimento': getDaysUntilDue(d.due_date),
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 35 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Prazos Filtrados');
    XLSX.writeFile(wb, `prazos_filtrados_${new Date().toISOString().split('T')[0]}.xlsx`);
  }, [filteredDeadlines, clientMap, memberMap]);

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
    
    const byStatus: Record<string, number> = {};
    statusOptions.forEach(s => { byStatus[s.key] = periodDeadlines.filter(d => d.status === s.key).length; });

    const byPriority: Record<string, number> = {};
    priorityOptions.forEach(p => { byPriority[p.key] = periodDeadlines.filter(d => d.priority === p.key).length; });

    const byType: Record<string, number> = {};
    typeOptions.forEach(t => { byType[t.key] = periodDeadlines.filter(d => d.type === t.key).length; });
    
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
    const completed = byStatus['cumprido'] ?? 0;
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
  }, [deadlines, reportPeriod, reportStartDate, reportEndDate, memberMap, clientMap, statusOptions, priorityOptions, typeOptions]);

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
        // Usar settingsService.listUsers() que filtra is_active = true
        const data = await settingsService.listUsers();
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

  // Filtro padrão: usuário logado vê apenas seus prazos, admin vê tudo
  useEffect(() => {
    if (permissionsLoading || !currentUser) return;
    if (!isAdmin && currentUser.id) {
      setFilterResponsible(currentUser.id);
    }
  }, [permissionsLoading, isAdmin, currentUser]);

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
          status: (defaultDeadlineStatus && statusOptions.some(s => s.key === defaultDeadlineStatus)
            ? defaultDeadlineStatus : emptyForm.status) as DeadlineStatus,
          priority: (defaultDeadlinePriority && priorityOptions.some(p => p.key === defaultDeadlinePriority)
            ? defaultDeadlinePriority : emptyForm.priority) as DeadlinePriority,
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
        const defaultDueDate = defaultDeadlineDays > 0
          ? (() => { const d = new Date(); d.setDate(d.getDate() + defaultDeadlineDays); return d.toISOString().slice(0, 10); })()
          : '';
        setFormData({ ...emptyForm, notify_days_before: String(defaultNotifyDays), due_date: defaultDueDate });
      }

      setIsModalOpen(true);
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed, prefillData]);

  useEffect(() => {
    if (!entityId) return;
    const local = deadlines.find(d => d.id === entityId);
    if (local) {
      setSelectedDeadlineForView(local);
      setShowViewDeadlineModal(true);
      onParamConsumed?.();
      return;
    }
    // Não está na lista (ex.: usuário mencionado não é o responsável) — busca direto
    let active = true;
    (async () => {
      const fetched = await deadlineService.getDeadlineById(entityId);
      if (active && fetched) {
        setSelectedDeadlineForView(fetched);
        setShowViewDeadlineModal(true);
        onParamConsumed?.();
      }
    })();
    return () => { active = false; };
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
        notify_days_before: String(deadline.notify_days_before ?? defaultNotifyDays),
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
      setDataPublicacao(deadline.publication_date ? toDateInputValue(deadline.publication_date) : '');
      setDiasPrazo(deadline.deadline_days != null ? String(deadline.deadline_days) : '');
      setTipoPrazoCalculadora((deadline.counting_type as TipoPrazo) || 'processual');
    } else {
      setSelectedDeadline(null);
      let defaultResponsibleId = '';
      if (responsibilityConfig?.default_mode === 'creator' && currentUser?.id) {
        defaultResponsibleId = currentUser.id;
      } else if (responsibilityConfig?.default_mode === 'single' && responsibilityConfig.single_member_id) {
        defaultResponsibleId = responsibilityConfig.single_member_id;
      }
      const defaultDueDate = defaultDeadlineDays > 0
        ? (() => { const d = new Date(); d.setDate(d.getDate() + defaultDeadlineDays); return d.toISOString().slice(0, 10); })()
        : '';
      setFormData({
        ...emptyForm,
        status: (defaultDeadlineStatus && statusOptions.some(s => s.key === defaultDeadlineStatus)
          ? defaultDeadlineStatus : emptyForm.status) as DeadlineStatus,
        priority: (defaultDeadlinePriority && priorityOptions.some(p => p.key === defaultDeadlinePriority)
          ? defaultDeadlinePriority : emptyForm.priority) as DeadlinePriority,
        responsible_id: defaultResponsibleId,
        notify_days_before: String(defaultNotifyDays),
        due_date: defaultDueDate,
      });
      setProcessSearchTerm('');
      setRequirementSearchTerm('');
      setDataPublicacao('');
      setDiasPrazo('');
      setTipoPrazoCalculadora('processual');
    }

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
        notify_days_before: formData.notify_days_before ? parseInt(formData.notify_days_before, 10) : defaultNotifyDays,
        publication_date: dataPublicacao || null,
        deadline_days: diasPrazo ? parseInt(diasPrazo, 10) : null,
        counting_type: tipoPrazoCalculadora || null,
      };

      const editingDeadline = selectedDeadline;
      let updatedDeadline: Deadline | null = null;

      if (editingDeadline) {
        const responsibleChanged = payloadBase.responsible_id && payloadBase.responsible_id !== editingDeadline.responsible_id;
        await deadlineService.updateDeadline(editingDeadline.id, payloadBase);
        updatedDeadline = await deadlineService.getDeadlineById(editingDeadline.id);
        if (updatedDeadline) {
          setDeadlines((prev) => prev.map((item) => (item.id === updatedDeadline!.id ? updatedDeadline! : item)));
          setSelectedDeadline(updatedDeadline);
          if (selectedDeadlineForView?.id === updatedDeadline.id) {
            setSelectedDeadlineForView(updatedDeadline);
          }

          // 🔔 Notificação de sistema + email se o responsável mudou
          const newRespAuthId = payloadBase.responsible_id ? memberMap.get(payloadBase.responsible_id)?.user_id : null;
          if (responsibleChanged && user?.id && newRespAuthId && newRespAuthId !== user.id) {
            try {
              const assignerName = currentUser?.name || 'Alguém';
              const daysUntilDue = Math.ceil((new Date(payloadBase.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const isUrgent = daysUntilDue <= 3 || payloadBase.priority === 'urgente' || payloadBase.priority === 'alta';
              const deadlineTypeLabels: Record<string, string> = { geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' };
              const deadlineTypeLabel = deadlineTypeLabels[payloadBase.type] || payloadBase.type || 'Prazo';
              const priorityLabels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
              const priorityLabel = priorityLabels[payloadBase.priority] || '';
              const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;
              await userNotificationService.createNotification({
                title: isUrgent ? `⚠️ Prazo ${deadlineTypeLabel} — ${priorityLabel}` : `📅 Prazo ${deadlineTypeLabel} Atribuído`,
                message: `${assignerName} atribuiu um prazo a você\n"${payloadBase.title}" • ${daysLabel}`,
                type: 'deadline_assigned',
                user_id: newRespAuthId,
                deadline_id: editingDeadline.id,
                metadata: { priority: payloadBase.priority, type: payloadBase.type, days_until_due: daysUntilDue },
              });
            } catch {}
            supabase.functions.invoke('notify-deadline-assigned', {
              body: { deadline_id: editingDeadline.id, assigned_by_id: user.id },
            }).catch((err) => console.error('Erro ao enviar email de prazo:', err));
          }
        } else {
          await handleReload();
        }
      } else {
        const newDeadline = await deadlineService.createDeadline(payloadBase as any);
        
        // 🔔 Criar notificação para novo prazo
        const responsibleAuthId = payloadBase.responsible_id ? memberMap.get(payloadBase.responsible_id)?.user_id : null;
        if (user?.id && newDeadline && responsibleAuthId && responsibleAuthId !== user.id) {
          try {
            const assignerName = currentUser?.name || 'Alguém';
            const daysUntilDue = Math.ceil((new Date(payloadBase.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const isUrgent = daysUntilDue <= 3 || payloadBase.priority === 'urgente' || payloadBase.priority === 'alta';
            const deadlineTypeLabels: Record<string, string> = { geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' };
            const deadlineTypeLabel = deadlineTypeLabels[payloadBase.type] || payloadBase.type || 'Prazo';
            const priorityLabels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
            const priorityLabel = priorityLabels[payloadBase.priority] || '';
            const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;

            await userNotificationService.createNotification({
              title: isUrgent ? `⚠️ Prazo ${deadlineTypeLabel} — ${priorityLabel}` : `📅 Prazo ${deadlineTypeLabel} Atribuído`,
              message: `${assignerName} atribuiu um prazo a você\n"${payloadBase.title}" • ${daysLabel}`,
              type: 'deadline_assigned',
              user_id: responsibleAuthId,
              deadline_id: newDeadline.id,
              metadata: {
                priority: payloadBase.priority,
                type: payloadBase.type,
                days_until_due: daysUntilDue,
              },
            });
          } catch {}

          // 📧 Enviar email de notificação (não-bloqueante)
          supabase.functions.invoke('notify-deadline-assigned', {
            body: { deadline_id: newDeadline.id, assigned_by_id: user.id },
          }).catch((err) => console.error('Erro ao enviar email de prazo:', err));
        }
        
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
    const deadline = deadlines.find((d) => d.id === id);
    const confirmed = await confirmDelete({
      title: 'Excluir prazo',
      entityName: deadline?.title || undefined,
      message: 'Deseja realmente remover este prazo? Essa ação é irreversível.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      await deadlineService.deleteDeadline(id);
      notifyDeleted(deadline?.title || undefined);
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
    setShowViewDeadlineModal(true);
  };

  // Força o carregamento dos comentários sempre que o modal abre,
  // independente de como foi aberto (clique, notificação, deep-link).
  useEffect(() => {
    const id = selectedDeadlineForView?.id;
    if ((showViewDeadlineModal || viewMode === 'details') && id) {
      setShowCommentsFor(id);
      void loadComments(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showViewDeadlineModal, viewMode, selectedDeadlineForView?.id]);

  const handleCloseViewDeadlineModal = () => {
    setShowViewDeadlineModal(false);
    setSelectedDeadlineForView(null);
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

  const getStatusConfig = (status: DeadlineStatus) => statusOptions.find((s) => s.key === status);
  const getPriorityConfig = (priority: DeadlinePriority) => priorityOptions.find((p) => p.key === priority);
  const getTypeConfig = (type: DeadlineType) => typeOptions.find((t) => t.key === type);
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
      ...statusOptions.map(s => [s.label, reportStats.byStatus[s.key] ?? 0]),
      [''],
      ['POR PRIORIDADE'],
      ...priorityOptions.map(p => [p.label, reportStats.byPriority[p.key] ?? 0]),
      [''],
      ['POR TIPO'],
      ...typeOptions.map(t => [t.label, reportStats.byType[t.key] ?? 0]),
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
    const scopedRequirements = formData.client_id
      ? requirements.filter((r) => r.client_id === formData.client_id)
      : requirements;

    if (!requirementSearchTerm.trim()) return scopedRequirements.slice(0, 10);
    const term = requirementSearchTerm.trim().toLowerCase();
    return scopedRequirements
      .filter((r) => {
        const protocol = (r.protocol ?? '').toLowerCase();
        const beneficiary = (r.beneficiary ?? '').toLowerCase();
        return protocol.includes(term) || beneficiary.includes(term);
      })
      .slice(0, 10);
  }, [requirements, requirementSearchTerm, formData.client_id]);

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
  const reportModal = (
    <Modal
      open={showReportModal}
      onClose={() => setShowReportModal(false)}
      title="Relatório de Prazos"
      eyebrow="Relatório"
      size="xl"
      zIndex={70}
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => setShowReportModal(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition">Fechar</button>
          <button type="button" onClick={handleExportPdf} disabled={exportingPdf} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Exportar PDF
          </button>
          <button type="button" onClick={handleExportReport} className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition">
            <Download className="w-4 h-4" /> Exportar Excel
          </button>
        </div>
      }
    >
      <ModalBody className="p-6 space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {/* Seletor de Período */}
          <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4">
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
                      : 'bg-[#f8f7f5] text-slate-600 border border-[#e7e5df] hover:border-indigo-300'
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
                    className="w-full mt-1 px-3 py-2 border border-[#e7e5df] rounded-lg text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500">Data Final</label>
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-[#e7e5df] rounded-lg text-sm"
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
              <p className="text-3xl font-bold">{reportStats.byStatus['vencido'] ?? 0}</p>
              <p className="text-xs text-red-100">Vencidos no Período</p>
            </div>
          </div>

          {/* Gráficos em Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Por Status */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-slate-400" />
                Por Status
              </h4>
              <div className="space-y-2">
                {statusOptions.map((s) => {
                  const value = reportStats.byStatus[s.key] ?? 0;
                  const color = s.badge.split(' ')[0];
                  return (
                    <div key={s.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{s.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Prioridade */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-slate-400" />
                Por Prioridade
              </h4>
              <div className="space-y-2">
                {priorityOptions.map((p) => {
                  const value = reportStats.byPriority[p.key] ?? 0;
                  const color = p.badge.split(' ')[0];
                  return (
                    <div key={p.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{p.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Tipo */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
              <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-400" />
                Por Tipo
              </h4>
              <div className="space-y-2">
                {typeOptions.map((t, idx) => {
                  const TYPE_COLORS = ['bg-slate-500', 'bg-indigo-500', 'bg-purple-500', 'bg-teal-500', 'bg-cyan-500', 'bg-rose-500'];
                  const value = reportStats.byType[t.key] ?? 0;
                  const color = TYPE_COLORS[idx % TYPE_COLORS.length];
                  return (
                    <div key={t.key} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded ${color}`} />
                      <span className="text-xs text-slate-600 flex-1">{t.label}</span>
                      <span className="text-sm font-semibold text-slate-800">{value}</span>
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${reportStats.total > 0 ? (value / reportStats.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Por Responsável */}
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
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
          <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4">
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

      </ModalBody>
    </Modal>
  );

  const getMemberInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };
  const getMemberHue = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) { h = (h << 5) - h + name.charCodeAt(i); h |= 0; }
    return Math.abs(h) % 360;
  };

  const renderCommentText = (text: string): React.ReactNode => {
    const names = members
      .map((mem) => (mem.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (names.length === 0) return text;
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${escaped.join('|')})`, 'gi');
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const matchedName = match[1];
      const mentionedMember = members.find(
        (mem) => (mem.name || '').trim().toLowerCase() === matchedName.toLowerCase(),
      );
      parts.push(
        <button
          key={key++}
          type="button"
          disabled={!mentionedMember?.user_id}
          onClick={() => {
            if (!mentionedMember?.user_id) return;
            handleCloseViewDeadlineModal();
            navigateTo('perfil', { userId: mentionedMember.user_id } as any);
          }}
          className={`font-semibold text-orange-600 bg-orange-50 rounded px-1 py-0.5 ${
            mentionedMember?.user_id ? 'hover:bg-orange-100 hover:underline cursor-pointer' : 'cursor-default'
          }`}
        >
          @{matchedName}
        </button>,
      );
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length > 0 ? parts : text;
  };

  const renderComment = (c: DeadlineComment, isReply: boolean) => {
    const hue = getMemberHue(c.user_name || '?');
    const canDelete = isAdmin || (!!c.user_id && c.user_id === user?.id);
    return (
      <div key={c.id} className="flex gap-2.5 group">
        <div
          className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
          style={{
            width: isReply ? 24 : 28,
            height: isReply ? 24 : 28,
            fontSize: isReply ? 10 : 11,
            background: `hsl(${hue}, 50%, 90%)`,
            color: `hsl(${hue}, 45%, 30%)`,
          }}
        >
          {(c.user_name[0] || '?').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-slate-50 rounded-xl px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-slate-700">{c.user_name}</span>
              <span className="text-[10px] text-slate-400">{formatDateTime(c.created_at)}</span>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{renderCommentText(c.content)}</p>
          </div>
          <div className="flex items-center gap-3 mt-1 ml-1">
            {!isReply && (
              <button
                type="button"
                onClick={() => setReplyingTo({ id: c.id, name: c.user_name })}
                className="text-[11px] font-semibold text-slate-400 hover:text-orange-600 transition"
              >
                Responder
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDeleteComment(c.id)}
                disabled={deletingCommentId === c.id}
                className="text-[11px] font-semibold text-slate-400 hover:text-red-600 transition opacity-0 group-hover:opacity-100 disabled:opacity-40"
              >
                {deletingCommentId === c.id ? 'Excluindo...' : 'Excluir'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const viewDeadlineModal = (() => {
    const d = selectedDeadlineForView;
    if (!d) return null;
      const daysLeft = getDaysUntilDue(d.due_date);
      const isCumprido = d.status === 'cumprido';
      const isOverdue = !isCumprido && daysLeft < 0;
      const isUrgent = !isCumprido && daysLeft >= 0 && daysLeft <= 3;
      const accentColor =
        d.priority === 'urgente' ? 'bg-red-500' :
        d.priority === 'alta' ? 'bg-orange-500' :
        d.priority === 'media' ? 'bg-amber-400' : 'bg-blue-500';

      // Para prazos cumpridos, calcula se foi dentro ou fora do prazo com base no completed_at
      const completedOnTime = (() => {
        if (!isCumprido) return false;
        const due = parseDateOnly(d.due_date);
        if (!due) return daysLeft >= 0;
        const completed = d.completed_at ? parseDateOnly(d.completed_at) : null;
        if (!completed) return daysLeft >= 0;
        return completed.getTime() <= due.getTime();
      })();

      const countdownBg = isCumprido
        ? completedOnTime ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        : isOverdue ? 'bg-red-50 border-red-200'
        : isUrgent ? 'bg-orange-50 border-orange-200'
        : 'bg-slate-50 border-[#e7e5df]';
      const countdownColor = isCumprido
        ? completedOnTime ? 'text-emerald-600' : 'text-amber-600'
        : isOverdue ? 'text-red-600'
        : isUrgent ? 'text-orange-600'
        : 'text-slate-800';
      const countdownLabel = isOverdue ? 'dias atrasado' : daysLeft === 0 ? 'vence hoje' : 'dias restantes';

      return (
        <Modal
          open={showViewDeadlineModal && !!selectedDeadlineForView}
          onClose={handleCloseViewDeadlineModal}
          title={d.title}
          eyebrow={getTypeLabel(d.type)}
          icon={<Clock className="w-5 h-5" />}
          size="lg"
          zIndex={70}
          headerActions={
            <div className="flex items-center gap-2">
              {d.status === 'pendente' && (
                <button onClick={() => { void handleStatusChange(d.id, 'cumprido'); handleCloseViewDeadlineModal(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Marcar cumprido
                </button>
              )}
              <button onClick={() => { handleCloseViewDeadlineModal(); handleOpenModal(d); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition">
                <Edit2 className="w-3.5 h-3.5" /> Editar
              </button>
            </div>
          }
          footer={
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2 flex-wrap">
                {isAdmin && (
                  <button onClick={() => void handleCloneDeadline(d)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#f8f7f5] border border-[#e7e5df] text-slate-600 hover:bg-slate-50 transition">
                    <Copy className="w-3.5 h-3.5" /> Duplicar
                  </button>
                )}
                <button onClick={() => { handleDeleteDeadline(d.id); handleCloseViewDeadlineModal(); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#f8f7f5] border border-red-200 text-red-600 hover:bg-red-50 transition">
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              </div>
              <button onClick={handleCloseViewDeadlineModal} className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 transition">Fechar</button>
            </div>
          }
        >
          <ModalBody className="p-5 space-y-5">
              {/* Title + description */}
              <div>
                <h2 className="text-lg font-bold text-slate-900 leading-snug">{d.title}</h2>
                {d.description && (
                  <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{d.description}</p>
                )}
              </div>

              {/* Key metrics row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {/* Countdown card */}
                <div className={`flex flex-col items-center justify-center rounded-xl p-3 border ${countdownBg}`}>
                  {isCumprido ? (
                    <>
                      <span className={`text-2xl font-black leading-none ${countdownColor}`}>✓</span>
                      <span className={`text-[10px] font-semibold mt-1 text-center ${completedOnTime ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {completedOnTime ? 'dentro do prazo' : 'fora do prazo'}
                      </span>
                      {d.completed_at && (
                        <span className={`text-[9px] mt-0.5 text-center ${completedOnTime ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {new Date(d.completed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className={`text-3xl font-black leading-none ${countdownColor}`}>{Math.abs(daysLeft)}</span>
                      <span className={`text-[10px] font-semibold mt-1 text-center ${isOverdue ? 'text-red-500' : 'text-slate-500'}`}>{countdownLabel}</span>
                    </>
                  )}
                </div>
                {/* Due date */}
                <div className="flex flex-col gap-1 p-3 rounded-xl bg-slate-50 border border-[#e7e5df]">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Vencimento</span>
                  <span className="text-sm font-bold text-slate-800">{formatDate(d.due_date)}</span>
                </div>
                {/* Status */}
                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-50 border border-[#e7e5df]">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Status</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${getStatusBadge(d.status)}`}>
                    {getStatusLabel(d.status)}
                  </span>
                </div>
                {/* Priority */}
                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-50 border border-[#e7e5df]">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Prioridade</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${getPriorityBadge(d.priority)}`}>
                    {getPriorityLabel(d.priority)}
                  </span>
                </div>
              </div>

              {/* People row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!d.client_id}
                  onClick={() => {
                    if (!d.client_id) return;
                    handleCloseViewDeadlineModal();
                    navigateTo('clientes', { mode: 'details', entityId: d.client_id } as any);
                  }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border bg-slate-50 text-left transition ${
                    d.client_id ? 'border-[#e7e5df] hover:border-orange-300 hover:bg-orange-50 cursor-pointer group' : 'border-[#e7e5df] cursor-default'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <UserCircle className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente</p>
                    <p className={`text-sm font-semibold truncate ${d.client_id ? 'text-slate-800 group-hover:text-orange-700 group-hover:underline' : 'text-slate-800'}`}>
                      {d.client_id ? clientMap.get(d.client_id)?.full_name || '—' : '—'}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={!d.responsible_id || !memberMap.get(d.responsible_id || '')?.user_id}
                  onClick={() => {
                    const m = d.responsible_id ? memberMap.get(d.responsible_id) : null;
                    if (!m?.user_id) return;
                    handleCloseViewDeadlineModal();
                    navigateTo('perfil', { userId: m.user_id } as any);
                  }}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border bg-slate-50 text-left transition ${
                    d.responsible_id && memberMap.get(d.responsible_id || '')?.user_id
                      ? 'border-[#e7e5df] hover:border-emerald-300 hover:bg-emerald-50 cursor-pointer group'
                      : 'border-[#e7e5df] cursor-default'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <UserCircle className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Responsável</p>
                    <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-emerald-700 group-hover:underline">
                      {d.responsible_id ? memberMap.get(d.responsible_id)?.name || '—' : '—'}
                    </p>
                  </div>
                </button>
              </div>

              {/* Process/Requirement link */}
              {(d.process_id || d.requirement_id) && (
                <button
                  type="button"
                  onClick={() => {
                    handleCloseViewDeadlineModal();
                    if (d.process_id) navigateTo('processos', { entityId: d.process_id } as any);
                    else if (d.requirement_id) navigateTo('requerimentos', { entityId: d.requirement_id } as any);
                  }}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-purple-100 bg-purple-50 text-left transition hover:border-purple-300 hover:bg-purple-100 cursor-pointer group"
                >
                  <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200">
                    <FileText className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-purple-500">
                      {d.process_id ? 'Processo Vinculado' : 'Requerimento Vinculado'}
                    </p>
                    <p className="text-sm font-bold text-purple-900 font-mono group-hover:underline">
                      {d.process_id
                        ? processes.find(p => p.id === d.process_id)?.process_code || '—'
                        : requirements.find(r => r.id === d.requirement_id)?.protocol || '—'}
                    </p>
                  </div>
                </button>
              )}

              {/* Comments */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-semibold text-slate-700">Comentários</h4>
                  {comments.length > 0 && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">{comments.length}</span>
                  )}
                </div>
                {commentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 mb-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-slate-400 italic mb-3">Nenhum comentário ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto mb-3 pr-1">
                    {comments.filter((c) => !c.parent_id).map((c) => {
                      const replies = comments.filter((r) => r.parent_id === c.id);
                      return (
                        <div key={c.id} className="space-y-2">
                          {renderComment(c, false)}
                          {replies.length > 0 && (
                            <div className="ml-6 pl-3 border-l-2 border-slate-100 space-y-2">
                              {replies.map((r) => renderComment(r, true))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {replyingTo && (
                  <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 bg-orange-50 border border-orange-100 rounded-lg">
                    <span className="text-xs text-orange-700">
                      Respondendo a <b>{replyingTo.name}</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className="text-orange-500 hover:text-orange-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex gap-2 relative">
                  {mentionSuggestions.length > 0 && (
                    <div className="absolute bottom-12 left-0 right-12 bg-white border border-[#e7e5df] rounded-xl shadow-lg overflow-hidden z-10 max-h-52 overflow-y-auto">
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Mencionar</p>
                      {mentionSuggestions.map((mem) => {
                        const hue = getMemberHue(mem.name || '');
                        return (
                          <button
                            key={mem.id}
                            type="button"
                            onClick={() => pickMention(mem.name || '')}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-orange-50 transition"
                          >
                            <div
                              className="relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 overflow-hidden"
                              style={{ background: `hsl(${hue}, 50%, 90%)`, color: `hsl(${hue}, 45%, 30%)` }}
                            >
                              {getMemberInitials(mem.name || '')}
                              {(mem as any).avatar_url && (
                                <img src={(mem as any).avatar_url} alt="" className="absolute w-7 h-7 rounded-full object-cover" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{mem.name}</p>
                              {mem.role && <p className="text-[10px] text-slate-400 truncate">{mem.role}</p>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => handleCommentChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mentionSuggestions.length === 0) { e.preventDefault(); void handleAddComment(d.id); } if (e.key === 'Escape') { setMentionQuery(null); setReplyingTo(null); } }}
                    placeholder={replyingTo ? `Responder a ${replyingTo.name}...` : 'Escreva um comentário... use @ para mencionar'}
                    className="flex-1 px-3 py-2 text-sm border border-[#e7e5df] rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                  />
                  <button
                    onClick={() => void handleAddComment(d.id)}
                    disabled={savingComment || !commentText.trim()}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition disabled:opacity-40"
                  >
                    {savingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>

          </ModalBody>
        </Modal>
      );
  })();

  const inputStyle = 'w-full h-10 px-3 py-2 rounded-lg text-sm bg-white border border-[#e7e5df] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-colors';
  const labelStyle = 'block text-xs font-semibold text-slate-500 mb-1.5';

  const deadlineModal = (
    <DeadlineFormModal
      open={isModalOpen}
      onClose={handleCloseModal}
      onSaved={async () => {
        await handleReload();
        setIsModalOpen(false);
        setSelectedDeadline(null);
      }}
      selectedDeadline={selectedDeadline}
      members={members}
      processes={processes}
      clients={clients}
      requirements={requirements}
      statusOptions={statusOptions.map(s => ({ key: s.key, label: s.label }))}
      priorityOptions={priorityOptions.map(p => ({ key: p.key, label: p.label }))}
      typeOptions={typeOptions.map(t => ({ key: t.key as DeadlineType, label: t.label }))}
    />
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
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-6">
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
              {selectedDeadlineForView.status === 'cumprido' ? (
                (() => {
                  const onTime = (() => {
                    const due = parseDateOnly(selectedDeadlineForView.due_date);
                    const completed = selectedDeadlineForView.completed_at ? parseDateOnly(selectedDeadlineForView.completed_at) : null;
                    if (!due) return daysUntil >= 0;
                    return completed ? completed.getTime() <= due.getTime() : daysUntil >= 0;
                  })();
                  return onTime
                    ? <p className="text-xs text-emerald-600 mt-1 font-semibold">✓ Cumprido dentro do prazo</p>
                    : <p className="text-xs text-amber-600 mt-1 font-semibold">✓ Cumprido fora do prazo</p>;
                })()
              ) : daysUntil >= 0 ? (
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
              <p className="text-base text-slate-900 mt-1">{selectedDeadlineForView.notify_days_before ?? 2} dias</p>
            </div>

            {selectedDeadlineForView.completed_at && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Cumprido em</label>
                <p className="text-base text-slate-900 mt-1">{formatDateTime(selectedDeadlineForView.completed_at)}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-[#e7e5df]">
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
            {isAdmin && (
              <button
                onClick={() => void handleCloneDeadline(selectedDeadlineForView)}
                className="inline-flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Copy className="w-4 h-4" />
                Duplicar Prazo
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

          {/* ── Comentários ─────────────────────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-[#e7e5df]">
            <button
              onClick={() => {
                if (showCommentsFor === selectedDeadlineForView.id) {
                  setShowCommentsFor(null);
                } else {
                  setShowCommentsFor(selectedDeadlineForView.id);
                  void loadComments(selectedDeadlineForView.id);
                }
              }}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-blue-600 transition"
            >
              <MessageSquare className="w-4 h-4" />
              Comentários
              {showCommentsFor === selectedDeadlineForView.id ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              )}
            </button>

            {showCommentsFor === selectedDeadlineForView.id && (
              <div className="mt-4 space-y-3">
                {commentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">Nenhum comentário ainda. Seja o primeiro!</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {comments.map((c) => (
                      <div key={c.id} className="bg-slate-50 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-700">{c.user_name}</span>
                          <span className="text-[10px] text-slate-400">{formatDateTime(c.created_at)}</span>
                        </div>
                        <p className="text-sm text-slate-800 whitespace-pre-wrap">{renderCommentText(c.content)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAddComment(selectedDeadlineForView.id); } }}
                    placeholder="Escreva um comentário..."
                    className="flex-1 px-3 py-2 text-sm border border-[#e7e5df] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <button
                    onClick={() => void handleAddComment(selectedDeadlineForView.id)}
                    disabled={savingComment || !commentText.trim()}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-40"
                  >
                    {savingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {deadlineModal}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Total do mês',
            value: monthlyDeadlines.length,
            icon: Calendar,
            color: 'blue',
            active: activeStatusTab === 'todos',
            onClick: () => setActiveStatusTab('todos'),
            gradient: 'from-blue-500 to-blue-600',
            ring: 'ring-blue-400',
            bg: 'bg-blue-50',
          },
          {
            label: 'Pendentes',
            value: monthlyPending.length,
            icon: Clock,
            color: 'amber',
            active: activeStatusTab === 'pendente',
            onClick: () => setActiveStatusTab('pendente'),
            gradient: 'from-amber-400 to-amber-500',
            ring: 'ring-amber-400',
            bg: 'bg-amber-50',
          },
          {
            label: 'Atenção',
            value: monthlyAttentionCount,
            icon: AlertCircle,
            color: 'red',
            active: activeStatusTab === 'vencido',
            onClick: () => setActiveStatusTab('vencido'),
            gradient: monthlyAttentionCount > 0 ? 'from-red-500 to-red-600' : 'from-slate-300 to-slate-400',
            ring: 'ring-red-400',
            bg: 'bg-red-50',
            pulse: monthlyAttentionCount > 0,
          },
          {
            label: 'Concluídos',
            value: monthlyCompleted.length,
            icon: CheckCircle,
            color: 'emerald',
            active: false,
            onClick: undefined,
            gradient: 'from-emerald-500 to-emerald-600',
            ring: '',
            bg: '',
          },
        ].map(({ label, value, icon: Icon, active, onClick, gradient, ring, bg, pulse }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className={`group relative flex flex-col gap-3 p-4 rounded-2xl border transition-all text-left overflow-hidden ${
              active
                ? `${bg} border-transparent ring-2 ${ring}`
                : onClick
                ? 'bg-[#f8f7f5] border-[#e7e5df] hover:shadow-md hover:border-slate-300'
                : 'bg-[#f8f7f5] border-[#e7e5df] cursor-default'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm ${pulse ? 'animate-pulse' : ''}`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-3xl font-black text-slate-900">{value}</p>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
          </button>
        ))}
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

      {/* Toolbar */}
      <div className="bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-sm overflow-hidden">
        {/* Linha principal */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Views */}
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-1">
            {([
              { key: 'list', icon: List, label: 'Lista', action: () => setViewMode('list'), active: viewMode === 'list' },
              { key: 'kanban', icon: LayoutGrid, label: 'Kanban', action: () => setViewMode('kanban'), active: viewMode === 'kanban' },
              { key: 'calendar', icon: Calendar, label: 'Calendário', action: () => setCalendarExpanded(!calendarExpanded), active: calendarExpanded },
              { key: 'workload', icon: Users, label: 'Carga', action: () => setViewMode(viewMode === 'workload' ? 'list' : 'workload'), active: viewMode === 'workload' },
            ] as const).map(({ key, icon: Icon, label, action, active }) => (
              <button key={key} onClick={action} title={label}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${active ? 'bg-[#f8f7f5] text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Mês */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => { const m = internalCalendarMonth === 0 ? 11 : internalCalendarMonth - 1; const y = internalCalendarMonth === 0 ? internalCalendarYear - 1 : internalCalendarYear; setInternalCalendarMonth(m); setInternalCalendarYear(y); onCalendarChange?.(m, y); }} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-semibold text-slate-800 capitalize w-36 text-center select-none">
              {new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => { const m = internalCalendarMonth === 11 ? 0 : internalCalendarMonth + 1; const y = internalCalendarMonth === 11 ? internalCalendarYear + 1 : internalCalendarYear; setInternalCalendarMonth(m); setInternalCalendarYear(y); onCalendarChange?.(m, y); }} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          {/* Busca */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Buscar prazo..."
              className="w-full h-8 pl-8 pr-3 bg-slate-50 border border-[#e7e5df] rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
            />
          </div>

          {/* Filtros */}
          <button
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-xl border text-sm font-medium transition-all ${
              filtersExpanded || filterType || filterPriority || filterResponsible
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-[#e7e5df] text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros</span>
            {(filterType || filterPriority || filterResponsible) && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </button>

          <div className="flex-1" />

          {/* Ações secundárias */}
          <div className="flex items-center gap-1">
            <button onClick={handleExportFiltered} title="Exportar lista filtrada"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={() => setShowReportModal(true)} title="Relatórios"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
              <BarChart3 className="w-4 h-4" />
            </button>
          </div>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-1.5 h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-blue-600/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Prazo
          </button>
        </div>

        {/* Painel de filtros */}
        {filtersExpanded && (
          <div className="border-t border-slate-100 px-3 py-2.5 flex flex-wrap items-center gap-2 bg-slate-50/60">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as DeadlineType | '')}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Tipo</option>
              <option value="processo">Processo</option>
              <option value="requerimento">Requerimento</option>
              <option value="geral">Geral</option>
            </select>
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as DeadlinePriority | '')}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Prioridade</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
            <select value={filterResponsible} onChange={(e) => setFilterResponsible(e.target.value)}
              className="h-8 px-2 pr-7 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer">
              <option value="">Responsável</option>
              <option value={UNASSIGNED_FILTER_VALUE}>Sem responsável</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {(filterType || filterPriority || filterResponsible) && (
              <button onClick={() => { setFilterType(''); setFilterPriority(''); setFilterResponsible(''); }}
                className="h-8 px-3 text-xs text-red-600 border border-red-200 bg-[#f8f7f5] rounded-lg hover:bg-red-50 transition">
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Calendário Mensal de Prazos - Retrátil */}
      {calendarExpanded && (
      <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm overflow-hidden">
        <div className="p-4">
            {/* Navegação do mês */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => {
                  if (internalCalendarMonth === 0) {
                    const newMonth = 11;
                    const newYear = internalCalendarYear - 1;
                    setInternalCalendarMonth(newMonth);
                    setInternalCalendarYear(newYear);
                    onCalendarChange?.(newMonth, newYear);
                  } else {
                    const newMonth = internalCalendarMonth - 1;
                    setInternalCalendarMonth(newMonth);
                    onCalendarChange?.(newMonth, internalCalendarYear);
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
                  {new Date(internalCalendarYear, internalCalendarMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
                {(internalCalendarMonth !== new Date().getMonth() || internalCalendarYear !== new Date().getFullYear()) && (
                  <button
                    onClick={() => {
                      const currentMonth = new Date().getMonth();
                      const currentYear = new Date().getFullYear();
                      setInternalCalendarMonth(currentMonth);
                      setInternalCalendarYear(currentYear);
                      onCalendarChange?.(currentMonth, currentYear);
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Hoje
                  </button>
                )}
              </div>
              
              <button
                onClick={() => {
                  if (internalCalendarMonth === 11) {
                    const newMonth = 0;
                    const newYear = internalCalendarYear + 1;
                    setInternalCalendarMonth(newMonth);
                    setInternalCalendarYear(newYear);
                    onCalendarChange?.(newMonth, newYear);
                  } else {
                    const newMonth = internalCalendarMonth + 1;
                    setInternalCalendarMonth(newMonth);
                    onCalendarChange?.(newMonth, internalCalendarYear);
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
                const year = internalCalendarYear;
                const month = internalCalendarMonth;
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
                      onClick={() => {
                        setFormData((prev) => ({ ...emptyForm, due_date: dateStr, responsible_id: prev.responsible_id }));
                        setSelectedDeadline(null);
                        setIsModalOpen(true);
                      }}
                      className={`relative h-8 flex items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        isToday
                          ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                          : count > 0 && hasUrgent
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : count > 0
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : isWeekend
                          ? 'text-red-300 bg-red-50/50 hover:bg-red-100'
                          : isPast
                          ? 'text-slate-300 hover:bg-slate-50'
                          : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                      title={count > 0 ? `${count} prazo(s) · clique para criar novo` : 'Clique para criar prazo neste dia'}
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
          {statusFilterOptions.map((statusOption) => {
            const StatusIcon = statusOption.icon;
            const statusDeadlines = filteredDeadlines.filter((d) => d.status === statusOption.key);
            const columnColors: Record<string, { bg: string; border: string; headerBg: string }> = {
              pendente: { bg: 'bg-blue-50/50', border: 'border-blue-200', headerBg: 'bg-blue-500' },
              vencido: { bg: 'bg-red-50/50', border: 'border-red-200', headerBg: 'bg-red-500' },
              cancelado: { bg: 'bg-slate-50/50', border: 'border-[#e7e5df]', headerBg: 'bg-slate-500' },
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
                  <span className="bg-[#f8f7f5]/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {statusDeadlines.length}
                  </span>
                </div>
                
                {/* Cards */}
                <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
                  {statusDeadlines.map((deadline) => {
                    const daysUntil = getDaysUntilDue(deadline.due_date);
                    const dueSoon = checkIsDueSoon(deadline.due_date);
                    const priorityConfig = getPriorityConfig(deadline.priority);
                    const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                    
                    return (
                      <div
                        key={deadline.id}
                        className={`bg-[#f8f7f5] rounded-xl p-3 shadow-sm hover:shadow-md transition-all cursor-pointer border-l-4 ${
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
                          {deadline.status === 'cumprido' ? (
                            (() => {
                              const onTime = (() => { const due = parseDateOnly(deadline.due_date); const comp = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null; if (!due) return daysUntil >= 0; return comp ? comp.getTime() <= due.getTime() : daysUntil >= 0; })();
                              return (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${onTime ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {onTime ? '✓ no prazo' : '✓ com atraso'}
                                </span>
                              );
                            })()
                          ) : daysUntil >= 0 ? (
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
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-6">
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
            {resolvedBuckets.map((bucket) => {
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
                <div key={bucket.key} className="border border-[#e7e5df] rounded-xl p-5 bg-slate-50/60">
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
                        const dueSoon = checkIsDueSoon(deadline.due_date);

                        return (
                          <div
                            key={deadline.id}
                            className={`rounded-lg border bg-[#f8f7f5] p-4 hover:shadow-md transition cursor-pointer ${
                              dueSoon ? 'border-red-300' : 'border-[#e7e5df]'
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
                                <span className={`flex items-center gap-1 font-semibold ${
                                  deadline.status === 'cumprido' ? 'text-emerald-600' : dueSoon ? 'text-red-600' : 'text-slate-600'
                                }`}>
                                  {dueSoon && deadline.status !== 'cumprido' && <Siren className="w-3 h-3" />}
                                  {deadline.status === 'cumprido'
                                    ? '✓ Cumprido'
                                    : deadline.daysUntil >= 0 ? `${deadline.daysUntil} dia(s)` : 'Vencido'}
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
      ) : (!isPastMonth && viewMode !== 'workload' && loading) ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-16 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando prazos...</p>
        </div>
      ) : (!isPastMonth && viewMode !== 'workload' && filteredDeadlines.length === 0) ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-12 text-center">
          <p className="text-slate-600">Nenhum prazo encontrado.</p>
        </div>
      ) : (!isPastMonth && viewMode !== 'workload') ? (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden">
          {/* Mobile Cards */}
          <div className="block lg:hidden divide-y divide-[#e7e5df]">
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
                      <span className="text-slate-500">Situação:</span>
                      {deadline.status === 'cumprido' ? (
                        (() => {
                          const onTime = (() => {
                            const due = parseDateOnly(deadline.due_date);
                            const completed = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null;
                            if (!due || !completed) return daysUntil >= 0;
                            return completed.getTime() <= due.getTime();
                          })();
                          return <p className={`font-medium ${onTime ? 'text-emerald-600' : 'text-amber-600'}`}>{onTime ? '✓ No prazo' : '✓ Com atraso'}</p>;
                        })()
                      ) : daysUntil >= 0 ? (
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
              {selectedIds.size > 0 && (
                <thead>
                  <tr>
                    <td colSpan={7} className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-blue-700">{selectedIds.size} selecionado(s)</span>
                        <div className="flex items-center gap-2">
                          <select
                            disabled={bulkActionLoading}
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) void handleBulkStatusChange(e.target.value as DeadlineStatus); e.target.value = ''; }}
                            className="h-8 px-2 text-xs border border-blue-200 rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Alterar status...</option>
                            {statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                          <select
                            disabled={bulkActionLoading}
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) void handleBulkResponsibleChange(e.target.value); e.target.value = ''; }}
                            className="h-8 px-2 text-xs border border-blue-200 rounded-lg bg-[#f8f7f5] text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="" disabled>Alterar responsável...</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <button
                            onClick={() => void handleBulkDelete()}
                            disabled={bulkActionLoading}
                            className="inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition disabled:opacity-50"
                          >
                            {bulkActionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Excluir
                          </button>
                          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 underline">Limpar</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                </thead>
              )}
              <thead className="border-b border-[#e7e5df]">
                <tr>
                  <th className="pl-4 pr-2 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={paginatedDeadlines.length > 0 && paginatedDeadlines.every((d) => selectedIds.has(d.id))}
                      onChange={() => handleSelectAll(paginatedDeadlines.map((d) => d.id))}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
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
                        selectedIds.has(deadline.id) ? 'bg-blue-50/50' :
                        dueSoon && deadline.status === 'pendente' ? 'bg-red-50/30' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="pl-4 pr-2 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(deadline.id)}
                          onChange={() => handleToggleSelect(deadline.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
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
                        {deadline.status === 'cumprido' ? (
                          (() => {
                            const onTime = (() => {
                              const due = parseDateOnly(deadline.due_date);
                              const completed = deadline.completed_at ? parseDateOnly(deadline.completed_at) : null;
                              if (!due || !completed) return daysUntil >= 0;
                              return completed.getTime() <= due.getTime();
                            })();
                            return (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${onTime ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {onTime ? '✓ No prazo' : '✓ Com atraso'}
                              </span>
                            );
                          })()
                        ) : daysUntil >= 0 ? (
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
                          className="text-xs font-medium px-3 py-1.5 rounded-md border border-[#e7e5df] bg-[#f8f7f5] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 cursor-pointer"
                        >
                          {statusOptions.map((opt) => (
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
                          {isAdmin && (
                            <button
                              onClick={() => void handleCloneDeadline(deadline)}
                              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              title="Duplicar prazo"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          )}
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
      ) : null}

      {/* ── Visão de carga por responsável ─────────────────────────────── */}
      {viewMode === 'workload' && (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-900">Carga por Responsável</h4>
              <p className="text-xs text-slate-400">prazos pendentes e vencidos em aberto</p>
            </div>
          </div>

          {members.length === 0 ? (
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-12 text-center">
              <p className="text-sm text-slate-400">Nenhum membro encontrado.</p>
            </div>
          ) : (() => {
            const workloadRows = members.map((member) => {
              const memberDeadlines = deadlines.filter((d) =>
                d.responsible_id === member.id && (d.status === 'pendente' || d.status === 'vencido')
              );
              const overdue = memberDeadlines.filter((d) => d.status === 'vencido' || getDaysUntilDue(d.due_date) < 0).length;
              const urgent = memberDeadlines.filter((d) => d.priority === 'urgente' || d.priority === 'alta').length;
              const total = memberDeadlines.length;
              return { member, total, overdue, urgent };
            }).sort((a, b) => b.total - a.total);

            const maxTotal = Math.max(...workloadRows.map((r) => r.total), 1);

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workloadRows.map(({ member, total, overdue, urgent }) => {
                  const initials = member.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() || '?';
                  const pct = Math.round((total / maxTotal) * 100);
                  const barColor = overdue > 0 ? 'bg-red-500' : urgent > 0 ? 'bg-orange-400' : 'bg-blue-500';
                  const cardBorder = overdue > 0 ? 'border-red-200' : 'border-[#e7e5df]';

                  return (
                    <div key={member.id} className={`bg-[#f8f7f5] rounded-xl border ${cardBorder} p-4 hover:shadow-sm transition`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                          overdue > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{member.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-slate-500 font-medium">{total} prazo{total !== 1 ? 's' : ''}</span>
                            {overdue > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                <AlertTriangle className="w-2.5 h-2.5" /> {overdue} vencido{overdue !== 1 ? 's' : ''}
                              </span>
                            )}
                            {urgent > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">
                                {urgent} urgente{urgent !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-2xl font-black text-slate-200 flex-shrink-0">{total}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {!isPastMonth && viewMode !== 'workload' && filteredDeadlines.length > pageSize && (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-4 flex items-center justify-between">
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
      {viewDeadlineModal}
      {reportModal}

      {/* ── Histórico de Prazos Cumpridos ───────────────────────────────── */}
      <div className="bg-[#f8f7f5] rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]">

        {/* Header */}
        <div className="px-5 py-3.5 flex items-center justify-between gap-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <h4 className="text-sm font-bold text-slate-800">Histórico de Prazos Cumpridos</h4>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredHistory.length}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Busca inline */}
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                placeholder="Buscar..."
                className="h-7 pl-7 pr-3 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none focus:ring-1 focus:ring-emerald-400/40 w-36"
              />
            </div>

            {/* Mês */}
            <select
              value={historyMonth === '' ? '' : String(historyMonth)}
              onChange={(e) => { setHistoryMonth(e.target.value === '' ? '' : Number(e.target.value)); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600"
            >
              <option value="">Mês</option>
              {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>

            {/* Ano */}
            <select
              value={historyYear === '' ? '' : String(historyYear)}
              onChange={(e) => { setHistoryYear(e.target.value === '' ? '' : Number(e.target.value)); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600"
            >
              <option value="">Ano</option>
              {historyYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            {/* Mais filtros toggle */}
            <button
              onClick={() => setHistoryFiltersExpanded(!historyFiltersExpanded)}
              className={`h-7 px-2.5 text-xs border rounded-lg font-medium transition flex items-center gap-1 ${
                historyFiltersExpanded || historyType || historyPriority || historyResponsible
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'border-[#e7e5df] text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3 h-3" />
              Filtros
              {(historyType || historyPriority || historyResponsible) && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>

            {/* Limpar */}
            {(historySearch || historyMonth !== '' || historyYear !== '' || historyType || historyPriority || historyResponsible) && (
              <button
                onClick={() => { setHistorySearch(''); setHistoryMonth(''); setHistoryYear(''); setHistoryType(''); setHistoryPriority(''); setHistoryResponsible(''); setHistoryPage(1); }}
                className="h-7 px-2 text-xs text-red-500 hover:text-red-700 transition"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Filtros extras */}
        {historyFiltersExpanded && (
          <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/60 flex flex-wrap gap-2">
            <select value={historyType} onChange={(e) => { setHistoryType(e.target.value as DeadlineType | ''); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Tipo</option>
              <option value="processo">Processo</option>
              <option value="requerimento">Requerimento</option>
              <option value="geral">Geral</option>
            </select>
            <select value={historyPriority} onChange={(e) => { setHistoryPriority(e.target.value as DeadlinePriority | ''); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Prioridade</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
            <select value={historyResponsible} onChange={(e) => { setHistoryResponsible(e.target.value); setHistoryPage(1); }}
              className="h-7 px-2 text-xs border border-[#e7e5df] rounded-lg bg-[#f8f7f5] focus:outline-none cursor-pointer text-slate-600">
              <option value="">Responsável</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

        {/* Tabela */}
        {filteredHistory.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Nenhum prazo cumprido encontrado.</p>
          </div>
        ) : (
          <>
            {/* Header da tabela */}
            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Prazo / Cliente</span>
              <span className="w-24 text-center">Vencimento</span>
              <span className="w-24 text-center">Cumprido em</span>
              <span className="w-28 text-center">Responsável</span>
              <span className="w-16 text-right">Ações</span>
            </div>

            <div className="divide-y divide-slate-100">
              {paginatedHistory.map((deadline) => {
                const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
                const priorityDot: Record<string, string> = {
                  urgente: 'bg-red-500', alta: 'bg-orange-400', media: 'bg-amber-400', baixa: 'bg-slate-300',
                };
                return (
                  <div key={deadline.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3 hover:bg-slate-50/70 transition group">
                    {/* Prazo */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot[deadline.priority] || 'bg-slate-300'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{deadline.title}</p>
                        {clientItem && <p className="text-xs text-slate-400 truncate">{clientItem.full_name}</p>}
                      </div>
                    </div>
                    {/* Vencimento */}
                    <div className="w-24 text-center">
                      <p className="text-xs text-slate-600 font-medium">{formatDate(deadline.due_date)}</p>
                    </div>
                    {/* Cumprido em */}
                    <div className="w-24 text-center">
                      <p className="text-xs font-semibold text-emerald-600">{deadline.completed_at ? formatDate(deadline.completed_at) : '—'}</p>
                    </div>
                    {/* Responsável */}
                    <div className="w-28 text-center">
                      <p className="text-xs text-slate-500 truncate">{responsibleItem?.name || '—'}</p>
                    </div>
                    {/* Ações */}
                    <div className="w-16 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => handleViewDeadline(deadline)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Ver">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleStatusChange(deadline.id, 'pendente')} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition" title="Reabrir">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Paginação */}
            {historyTotalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
                <p className="text-xs text-slate-400">
                  {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(historyPage * HISTORY_PAGE_SIZE, filteredHistory.length)} de {filteredHistory.length}
                </p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage === 1}
                    className="h-7 px-3 text-xs font-medium bg-[#f8f7f5] border border-[#e7e5df] rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
                    Anterior
                  </button>
                  <span className="text-xs text-slate-500 px-2">{historyPage} / {historyTotalPages}</span>
                  <button onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} disabled={historyPage === historyTotalPages}
                    className="h-7 px-3 text-xs font-medium bg-[#f8f7f5] border border-[#e7e5df] rounded-lg hover:bg-slate-50 disabled:opacity-40 transition">
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DeadlinesModule;
