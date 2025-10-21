import React, { useEffect, useMemo, useState } from 'react';
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
  UserCircle,
  LayoutGrid,
  List,
} from 'lucide-react';
import * as XLSX from 'xlsx';
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

const emptyForm: DeadlineFormData = {
  title: '',
  description: '',
  due_date: '',
  status: 'pendente',
  priority: 'media',
  type: 'geral',
  process_id: '',
  requirement_id: '',
  client_id: '',
  responsible_id: '',
  notify_days_before: '3',
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
  const [activeStatusTab, setActiveStatusTab] = useState<DeadlineStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'map' | 'details'>('list');
  const [selectedDeadlineForView, setSelectedDeadlineForView] = useState<Deadline | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
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
  const [filtersExpanded, setFiltersExpanded] = useState(false);

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

    return filtered.slice().sort((a, b) => {
      if (a.status === 'vencido' && b.status !== 'vencido') return -1;
      if (a.status !== 'vencido' && b.status === 'vencido') return 1;
      if (a.status === 'pendente' && b.status !== 'pendente') return -1;
      if (a.status !== 'pendente' && b.status === 'pendente') return 1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
  }, [deadlines, activeStatusTab, filterSearch, filterType, filterPriority]);

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

  const criticalDeadlines = useMemo(() => {
    return deadlines
      .filter((d) => d.status === 'pendente')
      .filter((d) => getDaysUntilDue(d.due_date) === 1)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  }, [deadlines]);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

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
        notify_days_before: String(deadline.notify_days_before ?? 3),
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
        notify_days_before: formData.notify_days_before ? parseInt(formData.notify_days_before, 10) : 3,
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

  const deadlineModal = isModalOpen && (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {selectedDeadline ? 'Editar Prazo' : 'Novo Prazo'}
            </h3>
            <p className="text-sm text-slate-600">Cadastre prazos e vincule a processos ou requerimentos.</p>
          </div>
          <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div>
              <label className="text-sm font-medium text-slate-700">Data de Vencimento *</label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(event) => handleFormChange('due_date', event.target.value)}
                className="input-field"
                required
              />
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
              <label className="text-sm font-medium text-slate-700">Responsável</label>
              <select
                value={formData.responsible_id}
                onChange={(event) => handleFormChange('responsible_id', event.target.value)}
                className="input-field"
              >
                <option value="">Selecione um responsável</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
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
                placeholder="3"
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
              className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-2"
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
    <div className="space-y-6">
      {criticalDeadlines.length > 0 && (
        <div className="bg-red-100 border border-red-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Siren className="w-6 h-6 text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-red-900">Alerta máximo: prazo vencendo em 1 dia</h4>
              <p className="text-sm text-red-700 mt-1">
                {criticalDeadlines.length} prazo(s) exigem ação imediata. Garanta a execução antes do vencimento.
              </p>
              <div className="mt-3 space-y-2">
                {criticalDeadlines.slice(0, 3).map((deadline) => (
                  <div key={deadline.id} className="text-xs text-red-800 flex items-center gap-2">
                    <span className="font-semibold">{deadline.title}</span>
                    <span className="text-red-600">• Vence em 1 dia</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alertas de prazos */}
      {overdueDeadlines.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-red-900">Prazos Vencidos</h4>
              <p className="text-sm text-red-700 mt-1">
                Você tem {overdueDeadlines.length} prazo(s) vencido(s) que requerem atenção imediata.
              </p>
              <div className="mt-3 space-y-2">
                {overdueDeadlines.slice(0, 3).map((deadline) => (
                  <div key={deadline.id} className="text-xs text-red-800 flex items-center gap-2">
                    <span className="font-semibold">{deadline.title}</span>
                    <span className="text-red-600">• Venceu há {Math.abs(getDaysUntilDue(deadline.due_date))} dia(s)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapa de Prazos */}
      <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-sm">
          <div className="text-[10px] sm:text-xs font-semibold uppercase text-slate-500">Total</div>
          <div className="flex items-end justify-between mt-2 sm:mt-3">
            <div>
              <p className="text-xl sm:text-3xl font-bold text-slate-900">{deadlines.length}</p>
              <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Todos os prazos</p>
            </div>
            <Calendar className="w-5 h-5 sm:w-8 sm:h-8 text-slate-400" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-sm">
          <div className="text-[10px] sm:text-xs font-semibold uppercase text-slate-500">Pendentes</div>
          <div className="flex items-end justify-between mt-2 sm:mt-3">
            <div>
              <p className="text-xl sm:text-3xl font-bold text-amber-600">{pendingDeadlines.length}</p>
              <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Aguardando</p>
            </div>
            <Clock className="w-5 h-5 sm:w-8 sm:h-8 text-amber-400" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-sm">
          <div className="text-[10px] sm:text-xs font-semibold uppercase text-slate-500">Hoje</div>
          <div className="flex items-end justify-between mt-2 sm:mt-3">
            <div>
              <p className="text-xl sm:text-3xl font-bold text-red-600">{dueTodayDeadlines.length}</p>
              <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Atenção</p>
            </div>
            <AlertCircle className="w-5 h-5 sm:w-8 sm:h-8 text-red-400" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-sm">
          <div className="text-[10px] sm:text-xs font-semibold uppercase text-slate-500">Concluídos</div>
          <div className="flex items-end justify-between mt-2 sm:mt-3">
            <div>
              <p className="text-xl sm:text-3xl font-bold text-emerald-600">{completedDeadlines.length}</p>
              <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Finalizados</p>
            </div>
            <CheckCircle className="w-5 h-5 sm:w-8 sm:h-8 text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Heatmap simplificado */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h4 className="text-sm font-semibold text-slate-900 mb-4">Distribuição semanal</h4>
        <div className="grid grid-cols-7 gap-2">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, index) => {
            const count = deadlines.filter((deadline) => {
              const due = new Date(deadline.due_date);
              return due.getDay() === index;
            }).length;
            const intensity = Math.min(count / 4, 1);
            const bg = `rgba(37, 99, 235, ${0.15 + intensity * 0.55})`;
            return (
              <div key={day} className="text-center">
                <div
                  className="w-full rounded-lg py-6 text-sm font-semibold text-white"
                  style={{ backgroundColor: count ? bg : 'rgba(226, 232, 240, 0.8)' }}
                >
                  {count}
                </div>
                <span className="text-xs text-slate-500 mt-2 block">{day}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Gestão de Prazos</h3>
            <p className="text-sm text-slate-600 mt-1">Controle prazos processuais e administrativos</p>
          </div>

          <div className="flex gap-3">
            <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => {
                  setViewMode('list');
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                  viewMode === 'list' ? 'bg-white text-slate-900 shadow' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-4 h-4" />
                Lista
              </button>
              <button
                onClick={() => {
                  setViewMode('kanban');
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                  viewMode === 'kanban' ? 'bg-white text-slate-900 shadow' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                Kanban
              </button>
              <button
                onClick={() => {
                  setViewMode('map');
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition ${
                  viewMode === 'map' ? 'bg-white text-slate-900 shadow' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Mapa
              </button>
            </div>

            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium px-4 py-2.5 rounded-lg shadow-sm transition disabled:cursor-not-allowed"
            >
              {exportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {exportingExcel ? 'Gerando Excel...' : 'Exportar Excel'}
            </button>

            <button
              onClick={() => handleOpenModal()}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              Novo Prazo
            </button>
          </div>
        </div>

        {/* Abas de Status */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveStatusTab('todos')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeStatusTab === 'todos' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Todos ({statusCounts.todos})
          </button>
          {STATUS_FILTER_OPTIONS.map((status) => {
            const StatusIcon = status.icon;
            return (
              <button
                key={status.key}
                onClick={() => setActiveStatusTab(status.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition inline-flex items-center gap-2 ${
                  activeStatusTab === status.key ? status.badge : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <StatusIcon className="w-4 h-4" />
                {status.label} ({statusCounts[status.key]})
              </button>
            );
          })}
        </div>

        {/* Botão para expandir/recolher filtros */}
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="flex items-center justify-between w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition text-sm font-medium text-slate-700"
        >
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            Filtros de busca
            {(filterSearch || filterType || filterPriority) && (
              <span className="px-2 py-0.5 bg-blue-500 text-white rounded-full text-xs">
                Ativos
              </span>
            )}
          </span>
          {filtersExpanded ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {/* Filtros (expansível) */}
        {filtersExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={filterSearch}
                onChange={(event) => setFilterSearch(event.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Buscar por título ou descrição..."
              />
            </div>

            <select
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as DeadlineType | '')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">Todos os tipos</option>
              {TYPE_OPTIONS.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>

            <select
              value={filterPriority}
              onChange={(event) => setFilterPriority(event.target.value as DeadlinePriority | '')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">Todas as prioridades</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label}
                </option>
              ))}
            </select>
          </div>
        )}

      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {STATUS_FILTER_OPTIONS.map((statusOption) => {
            const StatusIcon = statusOption.icon;
            const statusDeadlines = filteredDeadlines.filter((d) => d.status === statusOption.key);
            return (
              <div key={statusOption.key} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <StatusIcon className="w-4 h-4" />
                    <h4 className="text-sm font-semibold text-slate-900">{statusOption.label}</h4>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{statusDeadlines.length}</span>
                </div>
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {statusDeadlines.map((deadline) => {
                    const daysUntil = getDaysUntilDue(deadline.due_date);
                    const dueSoon = isDueSoon(deadline.due_date);
                    const priorityConfig = getPriorityConfig(deadline.priority);
                    const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                    return (
                      <div
                        key={deadline.id}
                        className={`rounded-lg p-3 hover:shadow-md transition cursor-pointer border ${
                          dueSoon ? 'bg-red-50 border-red-300' : 'bg-slate-50 border-slate-200'
                        }`}
                        onClick={() => handleViewDeadline(deadline)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h5 className="text-sm font-semibold text-slate-900 flex-1">{deadline.title}</h5>
                          {priorityConfig && (
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${getPriorityBadge(deadline.priority)}`}>
                              {priorityConfig.label}
                            </span>
                          )}
                        </div>
                        {clientItem && (
                          <p className="text-xs text-slate-600 mb-2">{clientItem.full_name}</p>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">{formatDate(deadline.due_date)}</span>
                          {daysUntil >= 0 ? (
                            <span className={`flex items-center gap-1 ${dueSoon ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                              {dueSoon && <Siren className="w-3 h-3" />}
                              {daysUntil} dia(s)
                            </span>
                          ) : (
                            <span className="text-red-600 font-semibold">Vencido</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {statusDeadlines.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-8">Nenhum prazo neste status</p>
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

          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Título
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Vencimento
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Dias Restantes
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Cliente
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Prioridade
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Tipo
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Responsável
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedDeadlines.map((deadline) => {
                  const isUpdating = statusUpdatingId === deadline.id;
                  const priorityConfig = getPriorityConfig(deadline.priority);
                  const typeConfig = getTypeConfig(deadline.type);
                  const daysUntil = getDaysUntilDue(deadline.due_date);
                  const dueSoon = isDueSoon(deadline.due_date);
                  const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
                  const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;

                  return (
                    <tr
                      key={deadline.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        dueSoon && deadline.status === 'pendente' ? 'bg-red-50/70 animate-pulse' : ''
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{deadline.title}</div>
                        {deadline.description && (
                          <div className="text-xs text-slate-500 mt-1 truncate max-w-xs">{deadline.description}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{formatDate(deadline.due_date)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {daysUntil >= 0 ? (
                          <span className={`flex items-center gap-1 text-sm ${dueSoon ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                            {dueSoon && <Siren className="w-4 h-4" />}
                            {daysUntil} dia(s)
                          </span>
                        ) : (
                          <span className="text-sm text-red-600 font-semibold">Vencido há {Math.abs(daysUntil)} dia(s)</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {clientItem ? clientItem.full_name : 'Não vinculado'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${getPriorityBadge(deadline.priority)}`}>
                          {priorityConfig && <priorityConfig.icon className="w-3 h-3" />}
                          {getPriorityLabel(deadline.priority)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                          {typeConfig && <typeConfig.icon className="w-3 h-3" />}
                          {getTypeLabel(deadline.type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <UserCircle className="w-3 h-3" />
                          {responsibleItem ? responsibleItem.name : 'Não definido'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <select
                            value={deadline.status}
                            onChange={(e) => handleStatusChange(deadline.id, e.target.value as DeadlineStatus)}
                            disabled={isUpdating}
                            className={`text-xs font-semibold px-3 py-1 rounded-full border-0 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition ${getStatusBadge(deadline.status)}`}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {isUpdating && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleViewDeadline(deadline)}
                            className="text-cyan-600 hover:text-cyan-900 transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(deadline)}
                            className="text-blue-600 hover:text-blue-900 transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteDeadline(deadline.id)}
                            className="text-red-600 hover:text-red-900 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-5 h-5" />
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

      {/* Histórico de Prazos Cumpridos */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-lg font-semibold text-slate-900">Histórico - Últimos Prazos Cumpridos</h4>
            <p className="text-sm text-slate-600 mt-1">Últimos 10 prazos concluídos com opção de reabrir</p>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
        </div>

        {completedDeadlines.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">Nenhum prazo cumprido ainda.</p>
        ) : (
          <div className="space-y-3">
            {completedDeadlines.map((deadline) => {
              const clientItem = deadline.client_id ? clientMap.get(deadline.client_id) : null;
              const responsibleItem = deadline.responsible_id ? memberMap.get(deadline.responsible_id) : null;
              const priorityConfig = getPriorityConfig(deadline.priority);
              return (
                <div
                  key={deadline.id}
                  className="relative border border-emerald-100 bg-emerald-50/30 rounded-lg p-4 flex items-center justify-between hover:shadow-md transition overflow-hidden"
                >
                  {/* Badge CONCLUÍDO */}
                  <div className="absolute top-0 right-0 bg-emerald-600 text-white px-3 py-1 rounded-bl-lg text-xs font-bold flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    CONCLUÍDO
                  </div>
                  
                  <div className="flex-1 pr-24">
                    <div className="flex items-center gap-3 mb-2">
                      <h5 className="text-sm font-semibold text-slate-900">{deadline.title}</h5>
                      {priorityConfig && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPriorityBadge(deadline.priority)}`}>
                          {priorityConfig.label}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                      {clientItem && (
                        <span className="flex items-center gap-1">
                          <UserCircle className="w-3 h-3" />
                          {clientItem.full_name}
                        </span>
                      )}
                      <span>Vencimento: {formatDate(deadline.due_date)}</span>
                      {deadline.completed_at && (
                        <span className="text-emerald-600 font-semibold">
                          Cumprido em: {formatDate(deadline.completed_at)}
                        </span>
                      )}
                      {responsibleItem && (
                        <span>Responsável: {responsibleItem.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleViewDeadline(deadline)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 rounded-lg transition"
                      title="Ver detalhes"
                    >
                      <Eye className="w-4 h-4" />
                      Ver
                    </button>
                    <button
                      onClick={() => handleStatusChange(deadline.id, 'pendente')}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                      title="Reabrir prazo"
                    >
                      <Clock className="w-4 h-4" />
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
