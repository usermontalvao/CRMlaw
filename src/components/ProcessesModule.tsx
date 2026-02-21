import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Search,
  Building2,
  User,
  Eye,
  X,
  LayoutGrid,
  List,
  Reply,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { settingsService } from '../services/settings.service';
import { djenService } from '../services/djen.service';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { processDjenSyncService } from '../services/processDjenSync.service';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';
import { deadlineService } from '../services/deadline.service';
import { userNotificationService } from '../services/userNotification.service';
import { calendarService } from '../services/calendar.service';
import { aiService } from '../services/ai.service';
import { ProcessTimeline } from './ProcessTimeline';
import { ProcessTimelineInline } from './ProcessTimelineInline';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import type { Process, ProcessStatus, ProcessPracticeArea, HearingMode } from '../types/process.types';
import type { Client } from '../types/client.types';
import type { Profile } from '../services/profile.service';
import { events, SYSTEM_EVENTS } from '../utils/events';

const STATUS_OPTIONS: { key: ProcessStatus; label: string; badge: string }[] = [
  { key: 'nao_protocolado', label: 'Não Protocolado', badge: 'bg-slate-100 text-slate-700' },
  { key: 'distribuido', label: 'Distribuído', badge: 'bg-amber-100 text-amber-700' },
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção', badge: 'bg-blue-100 text-blue-700' },
  { key: 'citacao', label: 'Citação', badge: 'bg-cyan-100 text-cyan-700' },
  { key: 'conciliacao', label: 'Conciliação', badge: 'bg-teal-100 text-teal-700' },
  { key: 'contestacao', label: 'Contestação', badge: 'bg-orange-100 text-orange-700' },
  { key: 'instrucao', label: 'Instrução', badge: 'bg-indigo-100 text-indigo-700' },
  { key: 'andamento', label: 'Em Andamento', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'sentenca', label: 'Sentença', badge: 'bg-purple-100 text-purple-700' },
  { key: 'recurso', label: 'Recurso', badge: 'bg-yellow-100 text-yellow-700' },
  { key: 'cumprimento', label: 'Cumprimento', badge: 'bg-rose-100 text-rose-700' },
  { key: 'arquivado', label: 'Arquivado', badge: 'bg-slate-100 text-slate-600' },
];

const PRACTICE_AREAS: { key: ProcessPracticeArea; label: string; description: string }[] = [
  { key: 'trabalhista', label: 'Trabalhista', description: 'Demandas trabalhistas e relações de emprego' },
  { key: 'familia', label: 'Família', description: 'Divórcios, guarda, pensão e outros temas familiares' },
  { key: 'consumidor', label: 'Consumidor', description: 'Direitos do consumidor e relações de consumo' },
  { key: 'previdenciario', label: 'Previdenciário', description: 'Benefícios do INSS, aposentadorias e afins' },
  { key: 'civel', label: 'Cível', description: 'Demandas cíveis em geral' },
];

const HEARING_MODE_LABELS: Record<HearingMode, string> = {
  presencial: 'Presencial',
  online: 'Online',
};

const emptyForm = {
  client_id: '',
  process_code: '',
  status: 'nao_protocolado' as ProcessStatus,
  distributed_at: '',
  practice_area: 'trabalhista' as ProcessPracticeArea,
  court: '',
  responsible_lawyer: '',
  responsible_lawyer_id: '',
  hearing_scheduled: 'nao' as 'sim' | 'nao',
  hearing_date: '',
  hearing_time: '',
  hearing_mode: 'presencial' as HearingMode,
  notes: '',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Pendente';
  try {
    const raw = String(value).trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [yyyy, mm, dd] = datePart.split('-');
      return `${dd}/${mm}/${yyyy}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return 'Data inválida';
    return parsed.toLocaleDateString('pt-BR');
  } catch (error) {
    console.error('Erro ao formatar data:', value, error);
    return 'Data inválida';
  }
};

const formatLastSync = (syncDate?: string | null) => {
  if (!syncDate) return null;
  
  try {
    const date = new Date(syncDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) {
      return 'há poucos minutos';
    } else if (diffHours < 24) {
      return `há ${diffHours}h`;
    } else if (diffDays === 1) {
      return 'ontem';
    } else if (diffDays < 7) {
      return `há ${diffDays} dias`;
    } else {
      return date.toLocaleDateString('pt-BR');
    }
  } catch (error) {
    return null;
  }
};

const formatLocalDateTime = (date: Date, hour: number, minute: number = 0) => {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return d;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Pendente';
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Data inválida';
    return parsed.toLocaleString('pt-BR');
  } catch (error) {
    console.error('Erro ao formatar data/hora:', value, error);
    return 'Data inválida';
  }
};

type ProcessNote = {
  id: string;
  text: string;
  created_at: string;
  author?: string;
  author_id?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
  parent_id?: string | null;
  replies?: ProcessNote[];
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const parseNotes = (value?: string | null): ProcessNote[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => typeof item === 'object' && item !== null && typeof item.text === 'string')
        .map((item) => ({
          id: typeof item.id === 'string' ? item.id : generateId(),
          text: String(item.text),
          created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
          author: typeof item.author === 'string' ? item.author : undefined,
          author_id: typeof item.author_id === 'string' ? item.author_id : undefined,
          author_name:
            typeof item.author_name === 'string'
              ? item.author_name
              : typeof item.author === 'string'
              ? item.author
              : undefined,
          author_avatar: typeof item.author_avatar === 'string' ? item.author_avatar : undefined,
          parent_id: typeof item.parent_id === 'string' ? item.parent_id : null,
        }));
    }
  } catch {
    // compatibilidade com notas antigas
  }

  return [
    {
      id: generateId(),
      text: value,
      created_at: new Date().toISOString(),
      author_name: 'Equipe do escritório',
    },
  ];
};

const serializeNotes = (notes: ProcessNote[]): string =>
  JSON.stringify(
    notes.map(({ id, text, created_at, author, author_id, author_name, author_avatar, parent_id }) => ({
      id,
      text,
      created_at,
      author,
      author_id,
      author_name,
      author_avatar,
      parent_id,
    })),
  );

const buildNoteThreads = (notes: ProcessNote[]): ProcessNote[] => {
  const items = notes
    .slice()
    .map((note) => ({ ...note, replies: [] }))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const map = new Map<string, ProcessNote>();
  items.forEach((note) => {
    map.set(note.id, note);
  });

  const roots: ProcessNote[] = [];
  map.forEach((note) => {
    if (note.parent_id && map.has(note.parent_id)) {
      map.get(note.parent_id)!.replies!.push(note);
    } else {
      roots.push(note);
    }
  });

  const sortRecursive = (threads: ProcessNote[]) => {
    threads.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    threads.forEach((thread) => {
      if (thread.replies) {
        sortRecursive(thread.replies);
      }
    });
  };

  sortRecursive(roots);
  return roots;
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  try {
    if (value.includes('T')) return value.split('T')[0];
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  } catch (error) {
    console.error('Erro ao converter data:', value, error);
  }
  return '';
};

const toTimeInputValue = (value?: string | null) => {
  if (!value) return '';
  try {
    if (value.includes(':')) return value.slice(0, 5);
  } catch (error) {
    console.error('Erro ao converter hora:', value, error);
  }
  return '';
};

interface ProcessesModuleProps {
  forceCreate?: boolean;
  entityId?: string;
  prefillData?: {
    client_id?: string;
    client_name?: string;
    responsible_lawyer_id?: string;
  };
  initialStatusFilter?: ProcessStatus | 'todos';
  onParamConsumed?: () => void;
}

const ProcessesModule: React.FC<ProcessesModuleProps> = ({ forceCreate, entityId, prefillData, initialStatusFilter, onParamConsumed }) => {
  const { user } = useAuth();
  const { confirmDelete } = useDeleteConfirm();
  
  // Sincronização DJEN removida - agora apenas via Edge Function (cron)
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null);
  const [searchingDjen, setSearchingDjen] = useState(false);
  const [djenData, setDjenData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProcessStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [selectedProcessForView, setSelectedProcessForView] = useState<Process | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [addingReply, setAddingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [kanbanMode, setKanbanMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('processesKanbanMode') === 'true';
    }
    return false;
  });
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [draggingProcessId, setDraggingProcessId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [djenCronLogs, setDjenCronLogs] = useState<DjenSyncLog[]>([]);
  const [djenCronLoading, setDjenCronLoading] = useState(false);

  // Quick add form for Aguardando Confecção
  const [quickAddClientId, setQuickAddClientId] = useState('');
  const [quickAddClientSearch, setQuickAddClientSearch] = useState('');
  const [quickAddArea, setQuickAddArea] = useState<ProcessPracticeArea>('trabalhista');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const [quickAddShowSuggestions, setQuickAddShowSuggestions] = useState(false);

  // Timeline
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [expandedTimelineEvents, setExpandedTimelineEvents] = useState<Set<string>>(new Set());

  // Prescrição execução sobrestada
  const [stayBaseDate, setStayBaseDate] = useState('');
  const [stayReason, setStayReason] = useState<'prescricao' | 'acordo_pagamento' | 'outro'>('prescricao');
  const [staySectionExpanded, setStaySectionExpanded] = useState(false);
  const [schedulingStay, setSchedulingStay] = useState(false);
  const [stayScheduleError, setStayScheduleError] = useState<string | null>(null);
  const [stayScheduleSuccess, setStayScheduleSuccess] = useState<string | null>(null);

  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [timelineProcessCode, setTimelineProcessCode] = useState<string | null>(null);
  const [timelineProcessId, setTimelineProcessId] = useState<string | null>(null);
  const [timelineClientName, setTimelineClientName] = useState<string | null>(null);
  const [expandedTimelineProcessId, setExpandedTimelineProcessId] = useState<string | null>(null);

  const [showStageMapModal, setShowStageMapModal] = useState(false);
  const [stageMapSelectedStatus, setStageMapSelectedStatus] = useState<ProcessStatus | null>(null);
  const [stageMapSearch, setStageMapSearch] = useState('');
  
  // Alerta: processos arquivados com prazos pendentes
  const [archivedWithDeadlines, setArchivedWithDeadlines] = useState<Array<{
    processId: string;
    processCode: string;
    clientName: string;
    deadlineCount: number;
  }>>([]);

  // Modal de exportação
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    status: 'todos' as ProcessStatus | 'todos',
    practiceArea: 'todas' as ProcessPracticeArea | 'todas',
    responsibleLawyer: 'todos',
    dateFrom: '',
    dateTo: '',
    orderBy: 'recent' as 'recent' | 'oldest',
  });

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  const allClientsMap = useMemo(() => new Map(allClients.map((client) => [client.id, client])), [allClients]);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const resolveResponsibleLawyer = (process: Process) => {
    if (process.responsible_lawyer_id && memberMap.has(process.responsible_lawyer_id)) {
      return memberMap.get(process.responsible_lawyer_id) as Profile;
    }

    if (process.responsible_lawyer) {
      return {
        id: 'custom',
        user_id: 'custom',
        name: process.responsible_lawyer,
        role: '',
        email: '',
        created_at: '',
        updated_at: '',
        avatar_url: undefined,
      } as Profile;
    }

    return null;
  };

  const detailNotes = useMemo(() => {
    if (!selectedProcessForView) return [] as ProcessNote[];
    return parseNotes(selectedProcessForView.notes);
  }, [selectedProcessForView]);

  const filteredProcesses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    const baseList =
      statusFilter === 'todos'
        ? processes
        : processes.filter((process) => process.status === statusFilter);

    if (!term) return baseList;

    return baseList.filter((process) => {
      const client = allClientsMap.get(process.client_id);
      const processCode = process.process_code || '';

      const practiceAreaLabel =
        PRACTICE_AREAS.find((area) => area.key === process.practice_area)?.label ?? process.practice_area;

      const composite = [
        process.process_code,
        process.court,
        process.responsible_lawyer,
        client?.full_name,
        practiceAreaLabel,
        process.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return composite.includes(term);
    });
  }, [processes, statusFilter, searchTerm, allClientsMap]);

  const appliedInitialFilterRef = useRef(false);
  useEffect(() => {
    if (!initialStatusFilter) return;
    if (appliedInitialFilterRef.current) return;
    appliedInitialFilterRef.current = true;
    setStatusFilter(initialStatusFilter);
    onParamConsumed?.();
  }, [initialStatusFilter, onParamConsumed]);

  useEffect(() => {
    const fetchProcesses = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await processService.listProcesses();
        setProcesses(data);
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar os processos.');
      } finally {
        setLoading(false);
      }
    };

    fetchProcesses();
  }, []);

  // Verificar processos arquivados com prazos pendentes
  useEffect(() => {
    const checkArchivedWithDeadlines = async () => {
      try {
        const archivedProcesses = processes.filter(p => p.status === 'arquivado');
        if (archivedProcesses.length === 0) {
          setArchivedWithDeadlines([]);
          return;
        }

        const alerts: Array<{
          processId: string;
          processCode: string;
          clientName: string;
          deadlineCount: number;
        }> = [];

        for (const process of archivedProcesses) {
          const deadlines = await deadlineService.listDeadlines({ process_id: process.id });
          const pendingDeadlines = deadlines.filter(d => d.status === 'pendente');
          
          if (pendingDeadlines.length > 0) {
            const client = allClientsMap.get(process.client_id);
            alerts.push({
              processId: process.id,
              processCode: process.process_code || 'Sem número',
              clientName: client?.full_name || 'Cliente não encontrado',
              deadlineCount: pendingDeadlines.length,
            });
          }
        }

        setArchivedWithDeadlines(alerts);
        
        if (alerts.length > 0) {
          console.log(`⚠️ ${alerts.length} processo(s) arquivado(s) com prazos pendentes`);
        }
      } catch (err) {
        console.error('Erro ao verificar processos arquivados com prazos:', err);
      }
    };

    if (processes.length > 0 && allClients.length > 0) {
      checkArchivedWithDeadlines();
    }
  }, [processes, allClients, allClientsMap]);

  const fetchDjenCronLogs = useCallback(async () => {
    try {
      setDjenCronLoading(true);
      const logs = await djenSyncStatusService.listRecent(30);
      setDjenCronLogs(logs);
    } catch (err) {
      console.error('Erro ao carregar histórico do cron DJEN:', err);
    } finally {
      setDjenCronLoading(false);
    }
  }, []);

  const processStatusCronLog = useMemo(() => {
    return (
      djenCronLogs.find(
        (log) => log.source === 'process_status_cron' || log.trigger_type === 'update_process_status',
      ) ?? null
    );
  }, [djenCronLogs]);

  useEffect(() => {
    fetchDjenCronLogs();
  }, [fetchDjenCronLogs]);

  useEffect(() => {
    const loadAllClients = async () => {
      try {
        const data = await clientService.listClients();
        setAllClients(data);
      } catch (err) {
        console.error('Erro ao carregar clientes:', err);
      }
    };
    loadAllClients();
  }, []);

  // Escutar eventos globais de mudança de clientes
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, async () => {
      console.log('🔄 ProcessesModule: Mudança de clientes detectada, atualizando...');
      try {
        const data = await clientService.listClients();
        setAllClients(data);
      } catch (err) {
        console.error('Erro ao recarregar clientes:', err);
      }
    });
    
    return () => unsubscribe();
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
    if (typeof window !== 'undefined') {
      localStorage.setItem('processesKanbanMode', kanbanMode ? 'true' : 'false');
    }
  }, [kanbanMode]);

  useEffect(() => {
    if (forceCreate && !isModalOpen) {
      handleOpenModal();

      if (prefillData) {
        setFormData((prev) => ({
          ...prev,
          client_id: prefillData.client_id || prev.client_id,
        }));

        if (prefillData.client_name) {
          setClientSearchTerm(prefillData.client_name);
        }
      }

      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed, prefillData]);

  useEffect(() => {
    if (entityId && processes.length > 0) {
      const process = processes.find((p) => p.id === entityId);
      if (process) {
        setSelectedProcessForView(process);
        setViewMode('details');
        if (onParamConsumed) {
          onParamConsumed();
        }
      }
    }
  }, [entityId, processes, onParamConsumed]);

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
    if (!user) {
      setCurrentProfile(null);
      return;
    }

    const member = members.find((item) => item.user_id === user.id);
    if (member) {
      setCurrentProfile(member);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const profile = await profileService.getProfile(user.id);
        if (isMounted) {
          setCurrentProfile(profile);
        }
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [user, members]);

  useEffect(() => {
    if (selectedProcessForView && viewMode === 'details') {
      loadTimeline(selectedProcessForView.process_code);
    } else {
      setTimeline([]);
      setTimelineError(null);
    }
  }, [selectedProcessForView?.id, viewMode]);

  const handleReload = async () => {
    try {
      setLoading(true);
      const data = await processService.listProcesses();
      setProcesses(data);
      if (selectedProcessForView) {
        const updated = data.find((item) => item.id === selectedProcessForView.id);
        if (updated) {
          setSelectedProcessForView(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de processos.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (process?: Process) => {
    if (process) {
      setSelectedProcess(process);
      setFormData({
        client_id: process.client_id,
        process_code: process.process_code || '',
        status: process.status,
        distributed_at: toDateInputValue(process.distributed_at),
        practice_area: process.practice_area,
        court: process.court || '',
        responsible_lawyer: process.responsible_lawyer || '',
        responsible_lawyer_id: process.responsible_lawyer_id || '',
        hearing_scheduled: process.hearing_scheduled ? 'sim' : 'nao',
        hearing_date: toDateInputValue(process.hearing_date),
        hearing_time: toTimeInputValue(process.hearing_time),
        hearing_mode: process.hearing_mode || 'presencial',
        notes: '',
      });
      const client = clientMap.get(process.client_id);
      if (client) {
        setClientSearchTerm(client.full_name);
      }
    } else {
      setSelectedProcess(null);
      setFormData(emptyForm);
      setClientSearchTerm('');
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedProcess(null);
    setFormData(emptyForm);
    setClientSearchTerm('');
    setDjenData(null);
  };

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const resolveAuthorInfo = async () => {
    const metadataName =
      (user?.user_metadata?.name as string | undefined) ||
      (user?.user_metadata?.full_name as string | undefined);
    const fallbackName = metadataName || user?.email || (user ? 'Usuário' : 'Equipe do escritório');

    if (currentProfile) {
      return {
        name: currentProfile.name || fallbackName,
        id: currentProfile.id || currentProfile.user_id || user?.id || null,
        avatar: currentProfile.avatar_url || undefined,
      };
    }

    if (user) {
      try {
        const profile = await profileService.getProfile(user.id);
        if (profile) {
          setCurrentProfile(profile);
          return {
            name: profile.name || fallbackName,
            id: profile.id || profile.user_id || user.id || null,
            avatar: profile.avatar_url || undefined,
          };
        }
      } catch (err) {
        console.error(err);
      }
    }

    return {
      name: fallbackName,
      id: user?.id || null,
      avatar: undefined,
    };
  };

  const handleSearchDjen = async () => {
    const processNumber = formData.process_code.replace(/\D/g, '');

    if (processNumber.length < 20) {
      setError('Número do processo inválido. Deve ter 20 dígitos.');
      return;
    }

    try {
      setSearchingDjen(true);
      setError(null);

      const yearMatch = formData.process_code.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;

      const searchParams: any = {
        numeroProcesso: processNumber,
        itensPorPagina: 100,
      };

      if (year) {
        searchParams.dataDisponibilizacaoInicio = `${year}-01-01`;
      }

      const response = await djenService.consultarComunicacoes(searchParams);

      if (response.items && response.items.length > 0) {
        const firstItem = response.items[0];

        setDjenData(firstItem);

        setFormData((prev) => ({
          ...prev,
          court: firstItem.nomeOrgao || prev.court,
          practice_area: mapClasseToArea(firstItem.nomeClasse) || prev.practice_area,
        }));
      } else {
        setError(
          'Nenhuma comunicação encontrada no DJEN para este processo. Possíveis motivos: processo muito recente, sem publicações ainda, ou tribunal não integrado ao DJEN.',
        );

        setDjenData({
          _noData: true,
          message: 'Processo consultado mas sem comunicações no DJEN',
        });
      }
    } catch (err: any) {
      setError(`Erro ao buscar dados no DJEN: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setSearchingDjen(false);
    }
  };

  const mapClasseToArea = (nomeClasse?: string): ProcessPracticeArea | undefined => {
    if (!nomeClasse) return undefined;

    const classe = nomeClasse.toLowerCase();

    if (classe.includes('trabalh')) return 'trabalhista';
    if (classe.includes('cível') || classe.includes('civil')) return 'civel';
    if (classe.includes('família') || classe.includes('familia')) return 'familia';
    if (classe.includes('previdenc')) return 'previdenciario';
    if (classe.includes('consumidor')) return 'consumidor';

    return 'civel';
  };

  const handleQuickAddAguardando = async () => {
    if (!quickAddClientId) {
      setError('Selecione um cliente.');
      return;
    }

    try {
      setQuickAddSaving(true);
      setError(null);

      // Criar o processo como "Aguardando Confecção" para o cliente selecionado
      const newProcess = await processService.createProcess({
        client_id: quickAddClientId,
        process_code: '',
        status: 'aguardando_confeccao',
        practice_area: quickAddArea,
      });

      // Atualizar lista de processos
      setProcesses((prev) => [...prev, newProcess]);

      // Limpar formulário
      setQuickAddClientId('');
      setQuickAddClientSearch('');
      setQuickAddArea('trabalhista');
    } catch (err) {
      console.error('Erro ao adicionar cliente aguardando confecção:', err);
      setError('Erro ao adicionar. Tente novamente.');
    } finally {
      setQuickAddSaving(false);
    }
  };

  // Filtrar clientes para sugestões no quick add
  const quickAddFilteredClients = useMemo(() => {
    if (!quickAddClientSearch.trim()) return [];
    const search = quickAddClientSearch.toLowerCase();
    return allClients
      .filter((c) => c.full_name.toLowerCase().includes(search))
      .slice(0, 5);
  }, [allClients, quickAddClientSearch]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.client_id) {
      setError('Selecione um cliente.');
      return;
    }

    const trimmedProcessCode = formData.process_code.trim();
    const requiresProcessCode = formData.status !== 'aguardando_confeccao';

    if (requiresProcessCode && !trimmedProcessCode) {
      setError('Informe o código do processo.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const responsibleMember = formData.responsible_lawyer_id ? memberMap.get(formData.responsible_lawyer_id) : null;

      let distributedAt = formData.distributed_at;
      if (!distributedAt && trimmedProcessCode) {
        const autoDate = processDjenSyncService.extractDistributedDate(trimmedProcessCode);
        if (autoDate) {
          distributedAt = autoDate;
        }
      }

      let distributedAtISO: string | null = null;
      if (distributedAt) {
        try {
          const dateObj = new Date(distributedAt);
          if (!Number.isNaN(dateObj.getTime())) {
            distributedAtISO = dateObj.toISOString();
          }
        } catch (err) {
          console.error('Erro ao converter data de distribuição:', distributedAt, err);
        }
      }

      // Validar data da audiência não seja anterior a hoje
      if (formData.hearing_scheduled === 'sim' && formData.hearing_date) {
        const hearingDate = new Date(formData.hearing_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        hearingDate.setHours(0, 0, 0, 0);
        
        if (hearingDate < today) {
          setError('Data da audiência não pode ser anterior à data atual.');
          return;
        }
      }

      const hasDjenData = djenData && !djenData._noData;

      const payloadBase = {
        client_id: formData.client_id,
        process_code: requiresProcessCode ? trimmedProcessCode : null,
        status: formData.status,
        distributed_at: distributedAtISO,
        practice_area: formData.practice_area,
        court: formData.court?.trim() || null,
        responsible_lawyer: responsibleMember?.name || formData.responsible_lawyer?.trim() || null,
        responsible_lawyer_id: responsibleMember?.id || null,
        hearing_scheduled: formData.hearing_scheduled === 'sim',
        hearing_date: formData.hearing_scheduled === 'sim' && formData.hearing_date ? formData.hearing_date : null,
        hearing_time: formData.hearing_scheduled === 'sim' && formData.hearing_time ? formData.hearing_time : null,
        hearing_mode: formData.hearing_scheduled === 'sim' ? formData.hearing_mode : null,
        djen_synced: hasDjenData ? true : undefined,
        djen_has_data: hasDjenData ? true : undefined,
        djen_last_sync: hasDjenData ? new Date().toISOString() : undefined,
      };

      const trimmedNote = formData.notes.trim();

      const editingProcess = selectedProcess;
      let updatedProcess: Process | null = null;

      if (editingProcess) {
        const updatePayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const existingNotes = parseNotes(editingProcess.notes);
          const newNote: ProcessNote = {
            id: generateId(),
            text: trimmedNote,
            created_at: new Date().toISOString(),
            author: authorInfo.name,
            author_name: authorInfo.name,
            author_id: authorInfo.id,
            author_avatar: authorInfo.avatar,
          };
          updatePayload.notes = serializeNotes([...existingNotes, newNote]);
        }

        await processService.updateProcess(editingProcess.id, updatePayload);
        updatedProcess = await processService.getProcessById(editingProcess.id);
        if (updatedProcess) {
          setProcesses((prev) => prev.map((item) => (item.id === updatedProcess!.id ? updatedProcess! : item)));
          setSelectedProcess(updatedProcess);
          if (selectedProcessForView?.id === updatedProcess.id) {
            setSelectedProcessForView(updatedProcess);
          }
        } else {
          await handleReload();
        }
      } else {
        const createPayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const newNote: ProcessNote = {
            id: generateId(),
            text: trimmedNote,
            created_at: new Date().toISOString(),
            author: authorInfo.name,
            author_name: authorInfo.name,
            author_id: authorInfo.id,
            author_avatar: authorInfo.avatar,
          };
          createPayload.notes = serializeNotes([newNote]);
        }

        const newProcess = await processService.createProcess(createPayload as any);

        // 🔔 Criar notificação para novo processo
        if (user?.id && newProcess) {
          try {
            const clientName = clients.find(c => c.id === createPayload.client_id)?.full_name || 'Cliente';
            await userNotificationService.createNotification({
              title: '📋 Novo Processo',
              message: `${createPayload.process_code || 'Sem número'} • ${clientName}`,
              type: 'process_updated',
              user_id: user.id,
              process_id: newProcess.id,
              metadata: {
                status: createPayload.status,
                client_name: clientName,
              },
            });
          } catch {}
        }

        if (newProcess && trimmedProcessCode) {
          processDjenSyncService
            .syncProcessWithDjen(newProcess as Process)
            .then((result) => {
              if (result.updated) {
                handleReload();
              }
            })
            .catch((err) => console.error('Erro na sincronização automática:', err));
        }

        await handleReload();
      }
      setIsModalOpen(false);
      if (!updatedProcess) {
        setSelectedProcess(null);
      }
      setFormData(emptyForm);
      setClientSearchTerm('');
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o processo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProcess = async (id: string) => {
    const proc = processes.find((p) => p.id === id);
    const confirmed = await confirmDelete({
      title: 'Excluir processo',
      entityName: proc?.process_code || undefined,
      message: 'Deseja realmente remover este processo? Essa ação é irreversível.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      await processService.deleteProcess(id);
      await handleReload();
      setProcesses((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o processo.');
    }
  };

  const handleViewProcess = (process: Process) => {
    setSelectedProcessForView(process);
    setViewMode('details');
    setNoteDraft('');
    setNoteError(null);
  };

  const handleOpenTimeline = (process: Process) => {
    if (!process.process_code) return;
    const client = clientMap.get(process.client_id);
    setTimelineProcessCode(process.process_code);
    setTimelineProcessId(process.id);
    setTimelineClientName(client?.full_name || null);
    setShowTimelineModal(true);
  };


  const handleBackToList = () => {
    setSelectedProcessForView(null);
    setViewMode('list');
    setNoteDraft('');
    setNoteError(null);
    setStayBaseDate('');
    setStayReason('prescricao');
    setStaySectionExpanded(false);
    setStayScheduleError(null);
    setStayScheduleSuccess(null);
  };

  const createStayPrescriptionCalendarEvent = async (params: {
    process: Process;
    baseDateISO: string;
    source: 'manual' | 'ai';
  }) => {
    const { process, baseDateISO, source } = params;
    const base = new Date(baseDateISO);
    if (Number.isNaN(base.getTime())) {
      throw new Error('Data-base inválida.');
    }
    const prescriptionDate = addMonths(base, 24);
    const alertDate = addMonths(base, 18);
    const title = `Prescrição (Execução Sobrestada) • ${process.process_code || 'Processo'}`;
    const description =
      `Data-base do sobrestamento: ${formatDate(baseDateISO)}\n` +
      `Prescrição estimada: ${formatDate(prescriptionDate.toISOString())}\n` +
      `Aviso (6 meses antes): ${formatDate(alertDate.toISOString())}\n` +
      `Origem: ${source === 'ai' ? 'IA' : 'Manual'}`;
    await calendarService.createEvent({
      title,
      description,
      event_type: 'deadline',
      status: 'pendente',
      start_at: formatLocalDateTime(alertDate, 9, 0),
      notify_minutes_before: null,
      process_id: process.id,
      client_id: process.client_id || null,
    });
  };

  const scheduleStayManual = async () => {
    if (!selectedProcessForView) return;
    setStayScheduleSuccess(null);
    setStayScheduleError(null);
    if (stayReason !== 'prescricao') {
      setStayScheduleError('Agendamento disponível apenas para sobrestamento por risco de prescrição.');
      return;
    }
    const trimmed = stayBaseDate.trim();
    if (!trimmed) {
      setStayScheduleError('Informe a data-base do sobrestamento.');
      return;
    }
    try {
      setSchedulingStay(true);
      await createStayPrescriptionCalendarEvent({
        process: selectedProcessForView,
        baseDateISO: trimmed,
        source: 'manual',
      });
      setStayScheduleSuccess('Compromisso criado na agenda com sucesso.');
    } catch (err: any) {
      setStayScheduleError(err?.message || 'Não foi possível criar o compromisso.');
    } finally {
      setSchedulingStay(false);
    }
  };

  const scheduleStayWithAI = async () => {
    if (!selectedProcessForView) return;
    setStayScheduleSuccess(null);
    setStayScheduleError(null);
    try {
      setSchedulingStay(true);
      if (!selectedProcessForView.process_code) {
        throw new Error('Processo sem número para consultar timeline.');
      }
      const events = timeline.length > 0 ? timeline : await processTimelineService.fetchProcessTimeline(selectedProcessForView.process_code);
      const timelineText = events
        .slice(0, 30)
        .map((e) => {
          const date = e.date ? (e.date.includes('T') ? e.date.split('T')[0] : e.date) : '';
          const title = e.title || '';
          const description = (e.description || '').replace(/\s+/g, ' ').trim();
          return `DATA: ${date}\nTITULO: ${title}\nTEXTO: ${description.substring(0, 800)}`;
        })
        .join('\n\n---\n\n');
      let baseDate: string | null = null;
      let reason: 'prescricao' | 'acordo_pagamento' | 'outro' | null = null;
      if (aiService.isEnabled()) {
        const systemPrompt = 'Você é um assistente jurídico. Identifique se há sobrestamento/suspensão e classifique o motivo (prescrição vs acordo/pagamento vs outro). Retorne JSON.';
        const userPrompt =
          `Analise as movimentações abaixo e responda APENAS com JSON no formato:\n` +
          `{\n  "hasStay": true|false,\n  "baseDate": "YYYY-MM-DD"|null,\n  "stayReason": "prescricao"|"acordo_pagamento"|"outro"|null,\n  "reason": "..."\n}\n\n` +
          `Regras:\n- baseDate deve ser a DATA do evento que indica sobrestamento/suspensão (se existir).\n- stayReason deve ser "prescricao" somente quando o sobrestamento está ligado a risco de prescrição intercorrente/arquivamento provisório por inércia.\n- Se for sobrestamento por acordo/pagamento/cumprimento, use "acordo_pagamento".\n- Se não houver, hasStay=false.\n\n` +
          `Importante:\n- NÃO considere como sobrestamento quando o texto for apenas um AVISO CONDICIONAL, por exemplo: "pode ser sobrestado", "caso não haja manifestação será sobrestado", "poderá ser sobrestado", "sob pena de sobrestamento".\n- Considere hasStay=true apenas quando houver determinação/ato efetivo de sobrestamento/suspensão/arquivamento provisório (ex.: "sobresto/sobrestar", "determino o sobrestamento", "processo sobrestado", "arquivamento provisório", "remessa ao arquivo provisório").\n\n` +
          `MOVIMENTAÇÕES:\n${timelineText}`;
        const content = await aiService.generateText(systemPrompt, userPrompt, 500);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (parsed?.hasStay && typeof parsed.baseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.baseDate)) {
          baseDate = parsed.baseDate;
        }
        if (parsed?.stayReason === 'prescricao' || parsed?.stayReason === 'acordo_pagamento' || parsed?.stayReason === 'outro') {
          reason = parsed.stayReason;
        }
      }
      if (!baseDate) {
        const paymentKeywords = ['acordo', 'pagamento', 'parcel', 'cumprimento do acordo', 'quit', 'homolog'];
        const prescriptionKeywords = ['prescri', 'arquivamento provis', 'arquivo provis', 'inércia', 'inercia', 'intercorrente'];
        const stayKeywords = ['sobrestad', 'suspens', 'suspenso', 'suspensão', 'sobrestamento'];
        const stayEffectiveKeywords = ['determino o sobrestamento', 'sobresto', 'sobrestar', 'processo sobrestado', 'autos sobrestados', 'arquivamento provis', 'arquivo provis', 'remessa ao arquivo provis', 'remetam-se ao arquivo provis'];
        const stayConditionalKeywords = ['pode ser sobrest', 'poderá ser sobrest', 'caso não', 'na ausência', 'se não houver', 'sob pena', 'ensejar'];
        const hit = events.find((e) => {
          const text = `${e.title || ''} ${e.description || ''}`.toLowerCase();
          const hasStaySignal = stayKeywords.some((k) => text.includes(k));
          if (!hasStaySignal) return false;
          const hasEffectiveStay = stayEffectiveKeywords.some((k) => text.includes(k));
          const hasConditionalStay = stayConditionalKeywords.some((k) => text.includes(k));
          if (!hasEffectiveStay && hasConditionalStay) return false;
          const isPaymentStay = paymentKeywords.some((k) => text.includes(k));
          const isPrescriptionStay = prescriptionKeywords.some((k) => text.includes(k));
          if (isPrescriptionStay) {
            reason = 'prescricao';
          } else if (isPaymentStay) {
            reason = 'acordo_pagamento';
          } else {
            reason = 'outro';
          }
          return true;
        });
        if (hit?.date) {
          baseDate = hit.date.includes('T') ? hit.date.split('T')[0] : hit.date;
        }
      }
      if (!baseDate) {
        throw new Error('IA não identificou sobrestamento na timeline. Use o cadastro manual.');
      }
      if (reason !== 'prescricao') {
        throw new Error('Sobrestamento identificado, mas não é por prescrição. Nenhum compromisso foi criado.');
      }
      await createStayPrescriptionCalendarEvent({
        process: selectedProcessForView,
        baseDateISO: baseDate,
        source: 'ai',
      });
      setStayBaseDate(baseDate);
      setStayReason('prescricao');
      setStayScheduleSuccess('Compromisso criado na agenda com sucesso (via IA).');
    } catch (err: any) {
      setStayScheduleError(err?.message || 'Não foi possível criar o compromisso.');
    } finally {
      setSchedulingStay(false);
    }
  };

  const getStatusBadge = (status: ProcessStatus) => {
    const statusConfig = STATUS_OPTIONS.find((s) => s.key === status);
    return statusConfig ? statusConfig.badge : 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: ProcessStatus) => {
    const statusConfig = STATUS_OPTIONS.find((s) => s.key === status);
    return statusConfig ? statusConfig.label : status;
  };

  const getPracticeAreaLabel = (area: ProcessPracticeArea) => {
    const areaConfig = PRACTICE_AREAS.find((item) => item.key === area);
    return areaConfig ? areaConfig.label : area;
  };

  const getNoteAuthorDisplay = (note: ProcessNote) => {
    if (note.author_name) return note.author_name;
    if (note.author) return note.author;
    if (note.author_id && memberMap.has(note.author_id)) {
      return memberMap.get(note.author_id)!.name || 'Equipe do escritório';
    }
    if (note.author_id && note.author_id === user?.id && currentProfile?.name) {
      return currentProfile.name;
    }
    if (note.author_id && note.author_id === user?.id) {
      return 'Usuário';
    }
    return 'Equipe do escritório';
  };

  const handleAddNote = async () => {
    if (!selectedProcessForView) return;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError('Escreva uma nota antes de salvar.');
      return;
    }

    try {
      setAddingNote(true);
      setNoteError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedProcessForView.notes);
      const newNote: ProcessNote = {
        id: generateId(),
        text: trimmed,
        created_at: new Date().toISOString(),
        author: authorInfo.name,
        author_name: authorInfo.name,
        author_id: authorInfo.id,
        author_avatar: authorInfo.avatar,
      };

      const updatedNotes = [...existingNotes, newNote];
      const serialized = serializeNotes(updatedNotes);
      await processService.updateProcess(selectedProcessForView.id, { notes: serialized });

      const refreshed = await processService.getProcessById(selectedProcessForView.id);
      if (refreshed) {
        setSelectedProcessForView(refreshed);
        setProcesses((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }

      setNoteDraft('');
    } catch (err: any) {
      setNoteError(err.message || 'Não foi possível adicionar a nota.');
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddReply = async () => {
    if (!selectedProcessForView || !replyingTo) return;
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      setReplyError('Escreva uma resposta antes de enviar.');
      return;
    }

    try {
      setAddingReply(true);
      setReplyError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedProcessForView.notes);
      const newReply: ProcessNote = {
        id: generateId(),
        text: trimmed,
        created_at: new Date().toISOString(),
        author: authorInfo.name,
        author_name: authorInfo.name,
        author_id: authorInfo.id,
        author_avatar: authorInfo.avatar,
        parent_id: replyingTo,
      };

      const updatedNotes = [...existingNotes, newReply];
      const serialized = serializeNotes(updatedNotes);
      await processService.updateProcess(selectedProcessForView.id, { notes: serialized });

      const refreshed = await processService.getProcessById(selectedProcessForView.id);
      if (refreshed) {
        setSelectedProcessForView(refreshed);
        setProcesses((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }

      setReplyDraft('');
      setReplyingTo(null);
    } catch (err: any) {
      setReplyError(err.message || 'Não foi possível adicionar a resposta.');
    } finally {
      setAddingReply(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!selectedProcessForView) return;
    const confirmed = await confirmDelete({
      title: 'Excluir nota',
      message: 'Tem certeza que deseja excluir esta nota? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      const existingNotes = parseNotes(selectedProcessForView.notes);
      const updatedNotes = existingNotes.filter((note) => note.id !== noteId);
      const serialized = serializeNotes(updatedNotes);
      await processService.updateProcess(selectedProcessForView.id, { notes: serialized });

      const refreshed = await processService.getProcessById(selectedProcessForView.id);
      if (refreshed) {
        setSelectedProcessForView(refreshed);
        setProcesses((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }
    } catch (err) {
      console.error('Erro ao excluir nota:', err);
      alert('Não foi possível excluir a nota.');
    }
  };

  const handleStatusChange = async (processId: string, newStatus: ProcessStatus) => {
    try {
      setStatusUpdatingId(processId);
      await processService.updateStatus(processId, newStatus);
      await handleReload();
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar o status.');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const loadTimeline = async (processCode: string, forceRefresh: boolean = false) => {
    try {
      setTimelineError(null);

      // 1. Tentar exibir cache imediatamente (sem loading)
      const cached = processTimelineService.getCachedTimeline(processCode);
      if (cached && cached.length > 0 && !forceRefresh) {
        setTimeline(cached);
        
        // 2. Verificar em background se há atualizações (sem bloquear UI)
        processTimelineService.checkForUpdates(processCode).then(async (hasUpdates) => {
          if (hasUpdates) {
            console.log('🔄 Atualizando timeline com novos dados...');
            setLoadingTimeline(true);
            try {
              const events = await processTimelineService.fetchProcessTimeline(processCode);
              setTimeline(events);
            } finally {
              setLoadingTimeline(false);
            }
          }
        });
        return;
      }

      // 3. Sem cache ou forçando refresh - buscar da API
      setLoadingTimeline(true);
      setTimeline([]);

      const events = await processTimelineService.fetchProcessTimeline(processCode);
      setTimeline(events);

      if (events.length === 0) {
        setTimelineError('Nenhuma publicação encontrada no DJEN para este processo.');
      }
    } catch (err: any) {
      console.error('Erro ao carregar timeline:', err);
      setTimelineError(err.message || 'Erro ao carregar linha do tempo');
    } finally {
      setLoadingTimeline(false);
    }
  };

  const analyzeTimelineWithAI = async () => {
    if (!selectedProcessForView || timeline.length === 0 || analyzingTimeline) return;

    try {
      setAnalyzingTimeline(true);
      setAnalyzeProgress({ current: 0, total: Math.min(timeline.length, 10) });

      const analyzedEvents = await processTimelineService.fetchAndAnalyzeTimeline(
        selectedProcessForView.process_code,
        (current, total) => setAnalyzeProgress({ current, total }),
      );

      setTimeline(analyzedEvents);
    } catch (err) {
      console.error('Erro ao analisar timeline:', err);
    } finally {
      setAnalyzingTimeline(false);
    }
  };

  const toggleTimelineEvent = (eventId: string) => {
    setExpandedTimelineEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  const getUrgencyColor = (urgency?: string) => {
    switch (urgency) {
      case 'critica':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'alta':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'media':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'baixa':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getEventTypeIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'intimacao':
        return <FileText className="w-4 h-4" />;
      case 'citacao':
        return <AlertTriangle className="w-4 h-4" />;
      case 'despacho':
        return <FileText className="w-4 h-4" />;
      case 'sentenca':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'decisao':
        return <FileText className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  // handleSyncAllDjen removido - sincronização agora apenas via Edge Function

  // Aplicar filtros de exportação
  const getFilteredExportProcesses = () => {
    let filtered = [...processes];

    // Filtro de status
    if (exportFilters.status !== 'todos') {
      filtered = filtered.filter(p => p.status === exportFilters.status);
    }

    // Filtro de tipo/área
    if (exportFilters.practiceArea !== 'todas') {
      filtered = filtered.filter(p => p.practice_area === exportFilters.practiceArea);
    }

    // Filtro de advogado responsável
    if (exportFilters.responsibleLawyer !== 'todos') {
      filtered = filtered.filter(p => p.responsible_lawyer_id === exportFilters.responsibleLawyer);
    }

    // Filtro de data (criação/atualização)
    if (exportFilters.dateFrom) {
      const fromDate = new Date(exportFilters.dateFrom);
      filtered = filtered.filter(p => {
        const processDate = new Date(p.updated_at || p.created_at || 0);
        return processDate >= fromDate;
      });
    }

    if (exportFilters.dateTo) {
      const toDate = new Date(exportFilters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(p => {
        const processDate = new Date(p.updated_at || p.created_at || 0);
        return processDate <= toDate;
      });
    }

    // Ordenação
    filtered.sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
      return exportFilters.orderBy === 'recent' ? dateB - dateA : dateA - dateB;
    });

    return filtered;
  };

  const handleExportExcel = async () => {
    const processesToExport = getFilteredExportProcesses();

    if (!processesToExport.length) {
      alert('Não há processos disponíveis para exportar com os filtros selecionados.');
      return;
    }

    try {
      setExportingExcel(true);
      setShowExportModal(false);

      const sortedProcesses = processesToExport;

      const excelData = sortedProcesses.map((process, index) => {
        const client = clientMap.get(process.client_id);
        const lawyer = process.responsible_lawyer_id ? memberMap.get(process.responsible_lawyer_id) : null;

        return {
          '#': index + 1,
          'Código do Processo': process.process_code || 'Não informado',
          'Tipo de Processo': getPracticeAreaLabel(process.practice_area),
          'Status do Processo': getStatusLabel(process.status),
          Cliente: client?.full_name || 'Cliente removido',
          'CPF/CNPJ': client?.cpf_cnpj || '',
          Email: client?.email || '',
          Telefone: client?.phone || '',
          Celular: client?.mobile || '',
          'Advogado Responsável': lawyer?.name || process.responsible_lawyer || '',
          'Vara/Comarca': process.court || '',
          'Distribuído em': formatDate(process.distributed_at),
          'Audiência Agendada': process.hearing_scheduled ? 'Sim' : 'Não',
          'Data da Audiência': process.hearing_date ? formatDate(process.hearing_date) : '',
          'Horário da Audiência': process.hearing_time || '',
          'Modo da Audiência': process.hearing_mode ? HEARING_MODE_LABELS[process.hearing_mode] : '',
          'DJEN Sincronizado': process.djen_synced ? 'Sim' : 'Não',
          'DJEN Tem Dados': process.djen_has_data ? 'Sim' : 'Não',
          'Última Sync DJEN': process.djen_last_sync ? new Date(process.djen_last_sync).toLocaleDateString('pt-BR') : '',
          'Criado em': process.created_at ? new Date(process.created_at).toLocaleDateString('pt-BR') : '',
          'Atualizado em': process.updated_at ? new Date(process.updated_at).toLocaleDateString('pt-BR') : '',
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Larguras de colunas otimizadas
      const colWidths = [
        { wch: 5 },  // #
        { wch: 25 }, // Código
        { wch: 18 }, // Tipo
        { wch: 18 }, // Status
        { wch: 30 }, // Cliente
        { wch: 15 }, // CPF/CNPJ
        { wch: 25 }, // Email
        { wch: 15 }, // Telefone
        { wch: 15 }, // Celular
        { wch: 25 }, // Advogado
        { wch: 25 }, // Vara
        { wch: 15 }, // Distribuído
        { wch: 12 }, // Audiência Agendada
        { wch: 15 }, // Data Audiência
        { wch: 12 }, // Horário
        { wch: 15 }, // Modo
        { wch: 12 }, // DJEN Sync
        { wch: 12 }, // DJEN Dados
        { wch: 15 }, // Última Sync
        { wch: 15 }, // Criado
        { wch: 15 }, // Atualizado
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Processos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const timeSlug = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      const statusSuffix = statusFilter !== 'todos' ? `_${statusFilter}` : '';
      const filename = `processos${statusSuffix}_${dateSlug}_${timeSlug}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Não foi possível exportar os dados para Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const renderNote = (note: ProcessNote, depth: number = 0) => {
    const isReplying = replyingTo === note.id;
    const canDelete = note.author_id === user?.id || user?.user_metadata?.role === 'admin';

    return (
      <div key={note.id} className={`${depth > 0 ? 'ml-8 border-l-2 border-slate-200 pl-4' : ''}`}>
        <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>{getNoteAuthorDisplay(note)}</span>
            <div className="flex items-center gap-2">
              <span>{formatDateTime(note.created_at)}</span>
              {canDelete && (
                <button
                  onClick={() => handleDeleteNote(note.id)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                  title="Excluir nota"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <p className="whitespace-pre-wrap">{note.text}</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setReplyingTo(isReplying ? null : note.id)}
              className="text-blue-600 hover:text-blue-700 text-xs flex items-center gap-1 transition-colors"
            >
              <Reply className="w-3 h-3" />
              Responder
            </button>
          </div>
        </div>

        {isReplying && (
          <div className="mt-3 ml-8">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              {replyError && <p className="text-sm text-red-600 mb-2">{replyError}</p>}
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={3}
                className="input-field w-full text-sm"
                placeholder="Digite sua resposta..."
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => setReplyingTo(null)}
                  className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddReply}
                  disabled={addingReply}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1 disabled:opacity-60"
                >
                  {addingReply && <Loader2 className="w-3 h-3 animate-spin" />}
                  {addingReply ? 'Enviando...' : 'Responder'}
                </button>
              </div>
            </div>
          </div>
        )}

        {note.replies && note.replies.map((reply) => renderNote(reply, depth + 1))}
      </div>
    );
  };

  const processesByStatus = useMemo(() => {
    const grouped: Record<ProcessStatus, Process[]> = {
      nao_protocolado: [],
      distribuido: [],
      aguardando_confeccao: [],
      citacao: [],
      conciliacao: [],
      contestacao: [],
      instrucao: [],
      andamento: [],
      sentenca: [],
      recurso: [],
      cumprimento: [],
      arquivado: [],
    };

    filteredProcesses.forEach((process) => {
      if (grouped[process.status]) {
        grouped[process.status].push(process);
      }
    });

    return grouped;
  }, [filteredProcesses]);

  const filteredStageMapProcesses = useMemo(() => {
    const base = stageMapSelectedStatus ? processesByStatus[stageMapSelectedStatus] || [] : [];
    const q = stageMapSearch.trim().toLowerCase();
    if (!q) return base;

    return base.filter((process) => {
      const client = allClientsMap.get(process.client_id);
      const practiceAreaLabel = PRACTICE_AREAS.find((area) => area.key === process.practice_area)?.label ?? process.practice_area;
      const composite = [
        process.process_code,
        process.court,
        process.responsible_lawyer,
        client?.full_name,
        practiceAreaLabel,
        process.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return composite.includes(q);
    });
  }, [stageMapSelectedStatus, stageMapSearch, processesByStatus, allClientsMap]);

  const pendingDjenCount = useMemo(() => {
    return processes.filter((p) => !p.djen_synced || (p.djen_synced && !p.djen_has_data)).length;
  }, [processes]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { todos: processes.length };
    STATUS_OPTIONS.forEach((s) => {
      counts[s.key] = 0;
    });
    processes.forEach((p) => {
      if (counts[p.status] !== undefined) counts[p.status]++;
    });
    return counts;
  }, [processes]);

  const noteThreads = useMemo(() => {
    if (!selectedProcessForView) return [];
    return buildNoteThreads(parseNotes(selectedProcessForView.notes));
  }, [selectedProcessForView]);

  const inputStyle =
    'w-full h-11 px-3 py-2 rounded-lg text-sm leading-normal bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors';
  const labelStyle = 'block text-sm text-zinc-600 dark:text-zinc-300 mb-1';

  const processModal = isModalOpen ? createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={handleCloseModal}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Formulário</p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {selectedProcess ? 'Editar Processo' : 'Novo Processo'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
          {error && (
            <div className="mx-6 mt-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm relative z-[90]">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <ClientSearchSelect
              value={formData.client_id}
              onChange={(clientId, clientName) => {
                handleFormChange('client_id', clientId);
                setClientSearchTerm(clientName);
              }}
              label="Cliente"
              placeholder="Buscar cliente..."
              required
              allowCreate={true}
            />

            <div>
              <label className={labelStyle}>Número do Processo</label>
              <div className="flex gap-2">
                <input
                  value={formData.process_code}
                  onChange={(e) => handleFormChange('process_code', e.target.value)}
                  className={`${inputStyle} flex-1`}
                  placeholder="0001234-56.2024.8.26.0100"
                  required
                />
                <button
                  type="button"
                  onClick={handleSearchDjen}
                  disabled={searchingDjen || formData.process_code.replace(/\D/g, '').length < 20}
                  className="px-3 h-10 flex-shrink-0 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-sm"
                >
                  {searchingDjen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
              {djenData && (
                <div
                  className={`mt-2 p-2 rounded-lg text-xs ${
                    djenData._noData
                      ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
                      : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  }`}
                >
                  {djenData._noData ? 'Nenhum dado encontrado no DJEN' : `Vara: ${djenData.nomeOrgao}`}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className={labelStyle}>Área</label>
                <select
                  value={formData.practice_area}
                  onChange={(e) => handleFormChange('practice_area', e.target.value as ProcessPracticeArea)}
                  className={inputStyle}
                >
                  {PRACTICE_AREAS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelStyle}>Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleFormChange('status', e.target.value as ProcessStatus)}
                  className={inputStyle}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelStyle}>Distribuição</label>
                <input
                  type="date"
                  value={formData.distributed_at}
                  onChange={(e) => handleFormChange('distributed_at', e.target.value)}
                  className={inputStyle}
                />
              </div>
              <div>
                <label className={labelStyle}>Vara / Comarca</label>
                <input
                  value={formData.court}
                  onChange={(e) => handleFormChange('court', e.target.value)}
                  className={inputStyle}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className={labelStyle}>Advogado</label>
                <select
                  value={formData.responsible_lawyer_id}
                  onChange={(e) => {
                    handleFormChange('responsible_lawyer_id', e.target.value);
                    const m = memberMap.get(e.target.value);
                    if (m) handleFormChange('responsible_lawyer', m.name);
                  }}
                  className={inputStyle}
                >
                  <option value="">Selecione</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelStyle}>Audiência</label>
                <select
                  value={formData.hearing_scheduled}
                  onChange={(e) => handleFormChange('hearing_scheduled', e.target.value)}
                  className={inputStyle}
                >
                  <option value="nao">Não</option>
                  <option value="sim">Sim</option>
                </select>
              </div>
              {formData.hearing_scheduled === 'sim' && (
                <>
                  <div>
                    <label className={labelStyle}>Data</label>
                    <input
                      type="date"
                      value={formData.hearing_date}
                      onChange={(e) => handleFormChange('hearing_date', e.target.value)}
                      className={inputStyle}
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Hora</label>
                    <input
                      type="time"
                      value={formData.hearing_time}
                      onChange={(e) => handleFormChange('hearing_time', e.target.value)}
                      className={inputStyle}
                    />
                  </div>
                </>
              )}
              {formData.hearing_scheduled === 'sim' && (
                <div>
                  <label className={labelStyle}>Modo</label>
                  <select
                    value={formData.hearing_mode}
                    onChange={(e) => handleFormChange('hearing_mode', e.target.value as HearingMode)}
                    className={inputStyle}
                  >
                    <option value="presencial">Presencial</option>
                    <option value="online">Online</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className={labelStyle}>Observações</label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleFormChange('notes', e.target.value)}
                className={`${inputStyle} h-16 resize-none`}
                placeholder=""
              />
            </div>
          </form>
        </div>

        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  const detailsModal = viewMode === 'details' && selectedProcessForView ? (() => {
    const client = clientMap.get(selectedProcessForView.client_id);
    const practiceAreaInfo = PRACTICE_AREAS.find((area) => area.key === selectedProcessForView.practice_area);
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          onClick={handleBackToList}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Detalhes</p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Detalhes do Processo</h2>
            </div>
            <button
              type="button"
              onClick={handleBackToList}
              className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Cliente</label>
                <p className="text-base text-slate-900 mt-1 flex items-center gap-2">
                  {client?.client_type === 'pessoa_juridica' ? <Building2 className="w-4 h-4 text-purple-500" /> : <User className="w-4 h-4 text-blue-500" />}
                  {client?.full_name || 'Cliente removido'}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Código do Processo</label>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-base text-slate-900 font-mono">{selectedProcessForView.process_code}</p>
                  {selectedProcessForView.djen_has_data ? (
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">✓ Sincronizado</span>
                      {formatLastSync(selectedProcessForView.djen_last_sync) && (
                        <span className="text-xs text-slate-500">
                          {formatLastSync(selectedProcessForView.djen_last_sync)}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
                {/* Timer de última atualização do registro */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span className="text-xs text-slate-400">
                    Atualizado {formatLastSync(selectedProcessForView.updated_at) ?? formatDate(selectedProcessForView.updated_at)}
                  </span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Distribuído em</label>
                <p className="text-base text-slate-900 mt-1">{formatDate(selectedProcessForView.distributed_at)}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Vara / Comarca</label>
                <p className="text-base text-slate-900 mt-1">{selectedProcessForView.court || 'Não informado'}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                <p className="mt-1">
                  <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedProcessForView.status)}`}>
                    {getStatusLabel(selectedProcessForView.status)}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Área</label>
                <p className="text-base text-slate-900 mt-1">{practiceAreaInfo ? practiceAreaInfo.label : selectedProcessForView.practice_area}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Advogado responsável</label>
                <p className="text-base text-slate-900 mt-1">{selectedProcessForView.responsible_lawyer || 'Não informado'}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Audiência</label>
                <p className="text-base text-slate-900 mt-1">
                  {selectedProcessForView.hearing_scheduled ? (
                    <span>
                      {selectedProcessForView.hearing_date ? formatDate(selectedProcessForView.hearing_date) : 'Data não informada'}
                      {selectedProcessForView.hearing_time && ` às ${selectedProcessForView.hearing_time.slice(0, 5)}`}
                      {selectedProcessForView.hearing_mode && (
                        <span className="ml-2 text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                          {selectedProcessForView.hearing_mode === 'presencial' ? 'Presencial' : 'Online'}
                        </span>
                      )}
                    </span>
                  ) : (
                    'Não agendada'
                  )}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase">Histórico de notas</label>
                {noteThreads.length === 0 ? (
                  <p className="text-sm text-slate-500 mt-2">Nenhuma nota registrada no momento.</p>
                ) : (
                  <div className="mt-2 space-y-4">{noteThreads.map((thread) => renderNote(thread))}</div>
                )}
              </div>
            </div>

            {/* Seção Prescrição Execução Sobrestada */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setStaySectionExpanded((prev) => !prev)}
                className="w-full flex items-start justify-between gap-3 text-left"
              >
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Execução Sobrestada (Prescrição 2 anos)</h3>
                  <p className="text-xs text-slate-500 mt-1">O sistema cria um compromisso 6 meses antes da prescrição estimada (data-base + 18 meses).</p>
                </div>
                <div className="mt-0.5 text-slate-400">
                  {staySectionExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {staySectionExpanded && (
                <>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Data-base do sobrestamento</label>
                      <input
                        type="date"
                        value={stayBaseDate}
                        onChange={(e) => setStayBaseDate(e.target.value)}
                        className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Motivo</label>
                      <select
                        value={stayReason}
                        onChange={(e) => setStayReason(e.target.value as 'prescricao' | 'acordo_pagamento' | 'outro')}
                        className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-900 dark:text-white"
                      >
                        <option value="prescricao">Prescrição</option>
                        <option value="acordo_pagamento">Cumprimento / Pagamento de acordo</option>
                        <option value="outro">Outro</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={scheduleStayManual}
                        disabled={schedulingStay}
                        className="h-10 px-4 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition disabled:opacity-60"
                      >
                        {schedulingStay ? 'Criando...' : 'Criar na Agenda'}
                      </button>
                      <button
                        type="button"
                        onClick={scheduleStayWithAI}
                        disabled={schedulingStay}
                        className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition disabled:opacity-60"
                      >
                        {schedulingStay ? 'Analisando...' : 'IA identificar'}
                      </button>
                    </div>
                  </div>

                  {(stayScheduleError || stayScheduleSuccess) && (
                    <div
                      className={`mt-3 w-full px-3 py-2 rounded-lg text-xs border ${
                        stayScheduleError
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {stayScheduleError || stayScheduleSuccess}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-gray-200">
              {selectedProcessForView.process_code && (
                <button
                  onClick={() => {
                    const client = clientMap.get(selectedProcessForView.client_id);
                    setTimelineProcessCode(selectedProcessForView.process_code);
                    setTimelineProcessId(selectedProcessForView.id);
                    setTimelineClientName(client?.full_name || null);
                    setShowTimelineModal(true);
                  }}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium px-4 py-2.5 rounded-lg transition shadow-lg"
                >
                  <Clock className="w-4 h-4" />
                  Linha do Tempo
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => handleOpenModal(selectedProcessForView)}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Edit2 className="w-4 h-4" />
                Editar Processo
              </button>
              <button
                onClick={() => {
                  handleDeleteProcess(selectedProcessForView.id);
                  handleBackToList();
                }}
                className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2.5 rounded-lg transition"
              >
                <Trash2 className="w-4 h-4" />
                Excluir Processo
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  })() : null;

  // Modal de Exportação com Filtros Avançados
  const exportModal = showExportModal ? (() => {
    const filteredCount = getFilteredExportProcesses().length;

    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowExportModal(false)} aria-hidden="true" />
        <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Exportação</p>
              <h2 className="text-xl font-semibold text-slate-900">Exportar Processos</h2>
              <p className="text-sm text-slate-500 mt-0.5">Configure os filtros para exportação</p>
            </div>
            <button
              type="button"
              onClick={() => setShowExportModal(false)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 bg-white overflow-y-auto max-h-[calc(90vh-180px)]">
            <div className="space-y-4">
              {/* Filtro de Status */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  📊 Status do Processo
                </label>
                <select
                  value={exportFilters.status}
                  onChange={(e) => setExportFilters({ ...exportFilters, status: e.target.value as ProcessStatus | 'todos' })}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="todos">Todos os status</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.key} value={status.key}>{status.label}</option>
                  ))}
                </select>
              </div>

              {/* Filtro de Tipo/Área */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  ⚖️ Tipo de Processo
                </label>
                <select
                  value={exportFilters.practiceArea}
                  onChange={(e) => setExportFilters({ ...exportFilters, practiceArea: e.target.value as ProcessPracticeArea | 'todas' })}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="todas">Todas as áreas</option>
                  {PRACTICE_AREAS.map((area) => (
                    <option key={area.key} value={area.key}>{area.label}</option>
                  ))}
                </select>
              </div>

              {/* Filtro de Advogado Responsável */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  👤 Advogado Responsável
                </label>
                <select
                  value={exportFilters.responsibleLawyer}
                  onChange={(e) => setExportFilters({ ...exportFilters, responsibleLawyer: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="todos">Todos os advogados</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </div>

              {/* Filtro de Período */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  📅 Período
                </label>
                <div className="grid grid-cols-2 gap-3 p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div>
                    <label className="block text-xs font-semibold text-orange-900 mb-1.5">
                      Data Início
                    </label>
                    <input
                      type="date"
                      value={exportFilters.dateFrom}
                      onChange={(e) => setExportFilters({ ...exportFilters, dateFrom: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border-2 border-orange-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-orange-900 mb-1.5">
                      Data Fim
                    </label>
                    <input
                      type="date"
                      value={exportFilters.dateTo}
                      onChange={(e) => setExportFilters({ ...exportFilters, dateTo: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border-2 border-orange-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Ordenação */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  🔄 Ordenação
                </label>
                <select
                  value={exportFilters.orderBy}
                  onChange={(e) => setExportFilters({ ...exportFilters, orderBy: e.target.value as 'recent' | 'oldest' })}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="recent">Mais recentes primeiro</option>
                  <option value="oldest">Mais antigos primeiro</option>
                </select>
              </div>

              {/* Prévia */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-600">
                  💡 <strong>Prévia:</strong> {filteredCount} processo{filteredCount !== 1 ? 's' : ''} será{filteredCount !== 1 ? 'ão' : ''} exportado{filteredCount !== 1 ? 's' : ''} com os filtros selecionados.
                </p>
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border-2 border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={exportingExcel || filteredCount === 0}
                  className="flex-1 px-4 py-2.5 rounded-lg text-white font-bold shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 border border-transparent whitespace-nowrap bg-emerald-600 hover:bg-emerald-500 bg-gradient-to-r from-emerald-600 to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {exportingExcel ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Exportando...
                    </>
                  ) : (
                    '📥 Exportar Excel'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <div className="space-y-4">

      {/* Alerta: Processos arquivados com prazos pendentes */}
      {archivedWithDeadlines.length > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-red-800 flex items-center gap-2">
                ⚠️ Atenção: Processos arquivados com prazos pendentes
                <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full">
                  {archivedWithDeadlines.length}
                </span>
              </h3>
              <p className="text-xs text-red-700 mt-1 mb-3">
                Os seguintes processos foram arquivados mas ainda possuem prazos pendentes. Verifique se os prazos devem ser concluídos ou cancelados.
              </p>
              <div className="space-y-2">
                {archivedWithDeadlines.map((alert) => (
                  <div
                    key={alert.processId}
                    className="flex items-center justify-between gap-3 bg-white/70 rounded-lg px-3 py-2 border border-red-100"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {alert.clientName}
                      </p>
                      <p className="text-[10px] font-mono text-slate-500 truncate">
                        {alert.processCode}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                        {alert.deadlineCount} prazo{alert.deadlineCount > 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => {
                          const process = processes.find(p => p.id === alert.processId);
                          if (process) handleViewProcess(process);
                        }}
                        className="px-2 py-1 bg-blue-100 text-blue-700 text-[10px] font-medium rounded hover:bg-blue-200 transition"
                      >
                        Ver
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cards de Estatísticas - Design Compacto */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter('todos')}
          className={`bg-white p-3 rounded-xl shadow-sm flex items-center gap-3 transition-all hover:shadow-md ${statusFilter === 'todos' ? 'border-2 border-primary' : 'border border-slate-200 hover:border-slate-300'}`}
        >
          <div className="w-10 h-10 bg-orange-100 text-primary rounded-lg flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{statusCounts.todos}</div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-tighter">Processos Total</div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('aguardando_confeccao')}
          className={`bg-white p-3 rounded-xl shadow-sm flex items-center gap-3 transition-all hover:shadow-md ${statusFilter === 'aguardando_confeccao' ? 'border-2 border-orange-500' : 'border border-slate-200 hover:border-slate-300'}`}
        >
          <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{statusCounts.aguardando_confeccao || 0}</div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-tighter">Aguardando</div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('andamento')}
          className={`bg-white p-3 rounded-xl shadow-sm flex items-center gap-3 transition-all hover:shadow-md ${statusFilter === 'andamento' ? 'border-2 border-blue-500' : 'border border-slate-200 hover:border-slate-300'}`}
        >
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{statusCounts.andamento || 0}</div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-tighter">Em Andamento</div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('distribuido')}
          className={`bg-white p-3 rounded-xl shadow-sm flex items-center gap-3 transition-all hover:shadow-md ${statusFilter === 'distribuido' ? 'border-2 border-purple-500' : 'border border-slate-200 hover:border-slate-300'}`}
        >
          <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{statusCounts.distribuido || 0}</div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-tighter">Distribuídos</div>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('arquivado')}
          className={`bg-white p-3 rounded-xl shadow-sm flex items-center gap-3 transition-all hover:shadow-md ${statusFilter === 'arquivado' ? 'border-2 border-green-500' : 'border border-slate-200 hover:border-slate-300'}`}
        >
          <div className="w-10 h-10 bg-green-100 text-green-600 rounded-lg flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold">{statusCounts.arquivado || 0}</div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-tighter">Arquivados</div>
          </div>
        </button>
      </div>

      {/* Seção Aguardando Confecção - Compacta */}
      {statusFilter === 'todos' && (
        <div className="bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
          {/* Header com botão de adicionar inline */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center">
                <FileText className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-orange-900">Aguardando Confecção</h3>
                <p className="text-[11px] text-orange-600">{processesByStatus.aguardando_confeccao.length} no fluxo</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!quickAddExpanded && (
                <button
                  onClick={() => setQuickAddExpanded(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar
                </button>
              )}
              {processesByStatus.aguardando_confeccao.length > 4 && (
                <button
                  onClick={() => setStatusFilter('aguardando_confeccao')}
                  className="text-xs font-medium text-orange-600 hover:text-orange-700"
                >
                  Ver todos
                </button>
              )}
            </div>
          </div>

          {/* Formulário inline expandido */}
          {quickAddExpanded && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-3 sm:px-4 py-3 bg-orange-50/50 border-b border-orange-100">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={quickAddClientSearch}
                  onChange={(e) => {
                    setQuickAddClientSearch(e.target.value);
                    setQuickAddClientId('');
                    setQuickAddShowSuggestions(true);
                  }}
                  onFocus={() => setQuickAddShowSuggestions(true)}
                  placeholder="Buscar cliente..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuickAddExpanded(false);
                      setQuickAddClientSearch('');
                      setQuickAddClientId('');
                    }
                  }}
                />
                {quickAddShowSuggestions && quickAddFilteredClients.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {quickAddFilteredClients.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => {
                          setQuickAddClientId(client.id);
                          setQuickAddClientSearch(client.full_name);
                          setQuickAddShowSuggestions(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 flex items-center gap-2 border-b border-slate-100 last:border-0"
                      >
                        <User className="w-3.5 h-3.5 text-orange-400" />
                        <span className="truncate">{client.full_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select
                value={quickAddArea}
                onChange={(e) => setQuickAddArea(e.target.value as ProcessPracticeArea)}
                className="px-2 py-1.5 text-xs border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white"
              >
                {PRACTICE_AREAS.map((area) => (
                  <option key={area.key} value={area.key}>{area.label}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  await handleQuickAddAguardando();
                  setQuickAddExpanded(false);
                }}
                disabled={quickAddSaving || !quickAddClientId}
                className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white text-xs font-medium rounded-lg transition"
              >
                {quickAddSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => {
                  setQuickAddExpanded(false);
                  setQuickAddClientSearch('');
                  setQuickAddClientId('');
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Lista de clientes */}
          {processesByStatus.aguardando_confeccao.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {processesByStatus.aguardando_confeccao.slice(0, 4).map((process) => {
                const client = process.client_id ? clients.find(c => c.id === process.client_id) : null;
                return (
                  <div
                    key={process.id}
                    onClick={() => setSelectedProcessForView(process)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50/50 cursor-pointer transition-all group"
                  >
                    <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{client?.full_name || 'Cliente não informado'}</p>
                      <p className="text-xs text-slate-500">{process.practice_area ? PRACTICE_AREAS.find(p => p.key === process.practice_area)?.label : 'Área não definida'}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenModal(process);
                      }}
                      className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-100 rounded-lg transition opacity-0 group-hover:opacity-100"
                      title="Editar e protocolar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {processesByStatus.aguardando_confeccao.length > 4 && (
                <button
                  onClick={() => setStatusFilter('aguardando_confeccao')}
                  className="w-full px-4 py-2 text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 transition"
                >
                  Ver mais {processesByStatus.aguardando_confeccao.length - 4} cliente{processesByStatus.aguardando_confeccao.length - 4 !== 1 ? 's' : ''}...
                </button>
              )}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">
              Nenhum cliente aguardando confecção
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-slate-100">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setKanbanMode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!kanbanMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </button>
            <button
              onClick={() => setKanbanMode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${kanbanMode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Kanban
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <button
              onClick={() => {
                setStageMapSelectedStatus(null);
                setStageMapSearch('');
                setShowStageMapModal(true);
              }}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
              title="Mapa de Fases"
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mapa de Fases</span>
            </button>
            {processStatusCronLog?.status === 'success' && (
              <button
                onClick={fetchDjenCronLogs}
                disabled={djenCronLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-600 rounded-full border border-green-100 text-[11px] font-semibold hover:bg-green-100 transition-colors"
              >
                {djenCronLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                CRON ATIVO (03h)
              </button>
            )}
            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
            <button onClick={() => handleOpenModal()} className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Novo</span>
              <span className="hidden sm:inline">Processo</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-slate-50/50 border-b border-slate-100">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              placeholder="Buscar processo..."
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProcessStatus | 'todos')}
              className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
            >
              <option value="todos">Todos os status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4">

          {loading ? (
            <div className="py-16 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
              <p className="text-slate-600">Carregando processos...</p>
            </div>
          ) : filteredProcesses.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-slate-600">Nenhum processo encontrado.</p>
            </div>
          ) : kanbanMode ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto">
              {STATUS_OPTIONS.map((statusOption) => {
                const processesInColumn = processesByStatus[statusOption.key] || [];
                return (
                  <div key={statusOption.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                    <div className={`px-4 py-3 font-semibold text-sm ${statusOption.badge}`}>
                      <div className="flex items-center justify-between">
                        <span>{statusOption.label}</span>
                        <span className="text-xs opacity-75">({processesInColumn.length})</span>
                      </div>
                    </div>
                    <div
                      className="p-3 space-y-3 flex-1 overflow-y-auto max-h-[calc(100vh-300px)]"
                      onDragOver={(event) => {
                        if (!draggingProcessId) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={async (event) => {
                        if (!draggingProcessId) return;
                        event.preventDefault();
                        setIsDragging(false);
                        setDraggingProcessId(null);
                        const draggedProcess = processes.find((item) => item.id === draggingProcessId);
                        if (!draggedProcess || draggedProcess.status === statusOption.key) return;
                        await handleStatusChange(draggingProcessId, statusOption.key);
                      }}
                    >
                      {processesInColumn.map((process) => {
                        const client = clientMap.get(process.client_id);
                        const isUpdating = statusUpdatingId === process.id;
                        return (
                          <div
                            key={process.id}
                            className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => {
                              if (isDragging) return;
                              handleViewProcess(process);
                            }}
                            draggable
                            onDragStart={(event) => {
                              event.stopPropagation();
                              setIsDragging(true);
                              setDraggingProcessId(process.id);
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', process.id);
                            }}
                            onDragEnd={() => {
                              setIsDragging(false);
                              setDraggingProcessId(null);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ${client?.client_type === 'pessoa_fisica' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}
                                >
                                  {client?.client_type === 'pessoa_fisica' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900 truncate">{client?.full_name || 'Cliente removido'}</p>
                                  <p className="text-xs text-slate-500 font-mono truncate">{process.process_code}</p>
                                  {process.djen_has_data && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 rounded-full">✓ DJEN</span>
                                      {formatLastSync(process.djen_last_sync) && (
                                        <span className="text-[10px] text-slate-500">
                                          {formatLastSync(process.djen_last_sync)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {process.court && <p className="text-xs text-slate-600 mb-2 line-clamp-2">{process.court}</p>}
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                              <select
                                value={process.status}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleStatusChange(process.id, e.target.value as ProcessStatus);
                                }}
                                disabled={isUpdating}
                                className="text-xs px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              {isUpdating && <Loader2 className="w-3 h-3 animate-spin text-amber-600" />}
                            </div>

                            {/* Timeline Inline Expansível */}
                            {process.process_code && (
                              <ProcessTimelineInline
                                processCode={process.process_code}
                                processId={process.id}
                                isExpanded={expandedTimelineProcessId === process.id}
                                onToggle={() => {
                                  setExpandedTimelineProcessId(
                                    expandedTimelineProcessId === process.id ? null : process.id
                                  );
                                }}
                                onOpenFullTimeline={() => {
                                  handleOpenTimeline(process);
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                      {processesInColumn.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Nenhum processo</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="block lg:hidden divide-y divide-gray-200">
                {filteredProcesses.map((process) => {
                  const client = clientMap.get(process.client_id);
                  return (
                    <div key={process.id} className="p-3 sm:p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-3">
                        <div
                          className={`flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center ${client?.client_type === 'pessoa_fisica' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}
                        >
                          {client?.client_type === 'pessoa_fisica' ? <User className="w-4 h-4 sm:w-5 sm:h-5" /> : <Building2 className="w-4 h-4 sm:w-5 sm:h-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs sm:text-sm font-medium text-gray-900 mb-1 truncate">{client?.full_name || 'Cliente removido'}</div>
                          <div className="text-[10px] sm:text-xs font-mono text-gray-700 break-all">{process.process_code}</div>
                          {process.court && <div className="text-xs text-gray-500 mb-2">{process.court}</div>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>{getStatusLabel(process.status)}</span>
                        <span className="text-xs text-gray-600">{formatDate(process.distributed_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewProcess(process)}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          Ver
                        </button>
                        <button
                          onClick={() => handleOpenModal(process)}
                          className="px-3 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteProcess(process.id)} className="px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Timeline Inline Expansível - Mobile */}
                      {process.process_code && (
                        <ProcessTimelineInline
                          processCode={process.process_code}
                          processId={process.id}
                          isExpanded={expandedTimelineProcessId === process.id}
                          onToggle={() => {
                            setExpandedTimelineProcessId(
                              expandedTimelineProcessId === process.id ? null : process.id
                            );
                          }}
                          onOpenFullTimeline={() => {
                            handleOpenTimeline(process);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="hidden lg:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Nome do Cliente</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Código do Processo</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Distribuído</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredProcesses.map((process) => {
                      const client = clientMap.get(process.client_id);
                      const isTimelineExpanded = expandedTimelineProcessId === process.id;
                      return (
                        <React.Fragment key={process.id}>
                          <tr 
                            className={`hover:bg-gray-50 transition-colors cursor-pointer ${isTimelineExpanded ? 'bg-orange-50/50' : ''}`} 
                            onClick={() => {
                              if (process.process_code) {
                                setExpandedTimelineProcessId(isTimelineExpanded ? null : process.id);
                              }
                            }}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${client?.client_type === 'pessoa_fisica' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}
                                >
                                  {client?.client_type === 'pessoa_fisica' ? <User className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-900">{client?.full_name || 'Cliente removido'}</div>
                                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                                    <span className="inline-flex items-center gap-1">
                                      Área: <span className="font-medium">{PRACTICE_AREAS.find((area) => area.key === process.practice_area)?.label ?? process.practice_area}</span>
                                    </span>
                                    {process.responsible_lawyer && (
                                      <span className="inline-flex items-center gap-1">
                                        Advogado: <span className="font-medium">{process.responsible_lawyer}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-mono text-gray-900">{process.process_code}</div>
                                {process.djen_has_data && (
                                  <div className="flex items-center gap-1">
                                    <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full" title="Dados sincronizados com DJEN">
                                      ✓ DJEN
                                    </span>
                                    {formatLastSync(process.djen_last_sync) && (
                                      <span className="text-xs text-slate-500" title={`Última sincronização: ${process.djen_last_sync}`}>
                                        {formatLastSync(process.djen_last_sync)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {process.court && <div className="text-xs text-gray-500 mt-1">{process.court}</div>}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatDate(process.distributed_at)}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>{getStatusLabel(process.status)}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-2">
                                {process.process_code && (
                                  <button 
                                    onClick={() => setExpandedTimelineProcessId(isTimelineExpanded ? null : process.id)} 
                                    className={`transition-colors ${isTimelineExpanded ? 'text-orange-600' : 'text-orange-400 hover:text-orange-600'}`} 
                                    title={isTimelineExpanded ? 'Recolher Timeline' : 'Expandir Timeline'}
                                  >
                                    {isTimelineExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                  </button>
                                )}
                                <button onClick={() => handleViewProcess(process)} className="text-blue-600 hover:text-blue-900 transition-colors" title="Ver detalhes">
                                  <Eye className="w-5 h-5" />
                                </button>
                                <button onClick={() => handleOpenModal(process)} className="text-amber-600 hover:text-amber-900 transition-colors" title="Editar">
                                  <Edit2 className="w-5 h-5" />
                                </button>
                                <button onClick={() => handleDeleteProcess(process.id)} className="text-red-600 hover:text-red-900 transition-colors" title="Excluir">
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Timeline Inline Expansível - Desktop */}
                          {isTimelineExpanded && process.process_code && (
                            <tr className="bg-gradient-to-r from-orange-50 to-amber-50">
                              <td colSpan={5} className="px-6 py-4">
                                <ProcessTimelineInline
                                  processCode={process.process_code}
                                  processId={process.id}
                                  isExpanded={true}
                                  onToggle={() => setExpandedTimelineProcessId(null)}
                                  onOpenFullTimeline={() => handleOpenTimeline(process)}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {processModal}
      {detailsModal}
      {exportModal}

      {showStageMapModal && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setShowStageMapModal(false)}
          />
          <div className="relative z-10 w-full max-w-5xl">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-slate-900">Mapa de Fases</div>
                    <div className="text-xs text-slate-600">Clique em uma fase para ver os processos</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowStageMapModal(false)}
                  className="p-2 rounded-lg hover:bg-slate-200/60 text-slate-500 hover:text-slate-700 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 border-b border-slate-100 bg-white">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {STATUS_OPTIONS.map((statusOption) => {
                    const count = (processesByStatus[statusOption.key] || []).length;
                    const isActive = stageMapSelectedStatus === statusOption.key;
                    return (
                      <button
                        key={statusOption.key}
                        type="button"
                        onClick={() => setStageMapSelectedStatus(statusOption.key)}
                        className={`text-left border rounded-xl px-3 py-3 transition ${isActive ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-900">{statusOption.label}</div>
                          <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusOption.badge}`}>{count}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">Clique para ver processos</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="max-h-[75vh] overflow-y-auto">
                {!stageMapSelectedStatus ? (
                  <div className="py-14 text-center text-slate-500">Selecione uma fase acima.</div>
                ) : (
                  <div>
                    <div className="p-4 border-b border-slate-100 bg-white">
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            value={stageMapSearch}
                            onChange={(e) => setStageMapSearch(e.target.value)}
                            placeholder="Buscar processos nesta fase..."
                            className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                            autoFocus
                          />
                        </div>
                        <div className="text-xs font-medium text-slate-600 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                          {getStatusLabel(stageMapSelectedStatus)}: {filteredStageMapProcesses.length}
                        </div>
                      </div>
                    </div>

                    {filteredStageMapProcesses.length === 0 ? (
                      <div className="py-14 text-center text-slate-500">Nenhum processo nesta fase.</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {filteredStageMapProcesses.slice(0, 200).map((process) => {
                          const client = clientMap.get(process.client_id);
                          return (
                            <div
                              key={process.id}
                              className="px-5 py-4 hover:bg-slate-50 transition cursor-pointer"
                              onClick={() => {
                                setShowStageMapModal(false);
                                handleViewProcess(process);
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-slate-900 font-mono truncate">{process.process_code}</span>
                                    {client?.full_name && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-semibold truncate">{client.full_name}</span>
                                    )}
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getStatusBadge(process.status)}`}>{getStatusLabel(process.status)}</span>
                                  </div>
                                  {process.court && <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{process.court}</div>}
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                  {process.process_code && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowStageMapModal(false);
                                        handleOpenTimeline(process);
                                      }}
                                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 hover:bg-amber-100 transition"
                                    >
                                      Ver timeline
                                    </button>
                                  )}
                                  <ChevronRight className="w-5 h-5 text-slate-300" />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {filteredStageMapProcesses.length > 200 && (
                          <div className="px-5 py-3 text-[11px] text-slate-500">Mostrando 200 itens. Use a busca para refinar.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Timeline Modal */}
      {showTimelineModal && timelineProcessCode && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              setShowTimelineModal(false);
              setTimelineProcessCode(null);
              setTimelineProcessId(null);
              setTimelineClientName(null);
            }}
          />
          <div className="relative z-10">
            <ProcessTimeline
              processCode={timelineProcessCode}
              processId={timelineProcessId || undefined}
              clientName={timelineClientName || undefined}
              onClose={() => {
                setShowTimelineModal(false);
                setTimelineProcessCode(null);
                setTimelineProcessId(null);
                setTimelineClientName(null);
              }}
              onStatusUpdated={(newStatus) => {
                // Atualizar a lista de processos quando o status mudar
                handleReload();
              }}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ProcessesModule;
