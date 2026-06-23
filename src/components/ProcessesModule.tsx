import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, ModalBody, ModalFooter, ProcessesSkeleton } from './ui';
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
  MapPin,
  Check,
  Zap,
  Bell,
  Users,
  PenTool,
  ExternalLink,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { signatureService } from '../services/signature.service';
import { profileService } from '../services/profile.service';
import { settingsService, type ModuleResponsibilityConfig } from '../services/settings.service';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { processDjenSyncService } from '../services/processDjenSync.service';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';
import { fetchDatajudMovimentos } from '../services/datajud.service';
import { deadlineService } from '../services/deadline.service';
import { userNotificationService } from '../services/userNotification.service';
import { calendarService } from '../services/calendar.service';
import { aiService } from '../services/ai.service';
import { formatDate as formatDateValue, formatDateTime as formatDateTimeValue } from '../utils/formatters';
import { ProcessTimeline } from './ProcessTimeline';
import { ProcessTimelineInline } from './ProcessTimelineInline';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useAuth } from '../contexts/AuthContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import type { Process, ProcessStatus, ProcessPracticeArea, HearingMode } from '../types/process.types';
import type { SignatureRequest } from '../types/signature.types';
import type { Client } from '../types/client.types';
import type { Profile } from '../services/profile.service';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { normalizeSearchText } from '../utils/search';
import { ClientAvatar } from './shared/ClientAvatar';
import { useClientPhotos } from '../hooks/useClientPhotos';
import { useMinLoading } from '../hooks/useMinLoading';
import { useFormLayout } from '../hooks/useFormLayout';
import { useSyncTick } from '../lib/syncBus';

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

const ACTIVE_PROCESS_STATUSES: ProcessStatus[] = [
  'citacao',
  'conciliacao',
  'contestacao',
  'instrucao',
  'andamento',
  'sentenca',
  'recurso',
  'cumprimento',
];

type ProcessStatusFilter = ProcessStatus | 'todos' | 'em_andamento_macro';

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
    const parsed = new Date(String(value).trim());
    if (Number.isNaN(parsed.getTime())) return 'Data inválida';
    return formatDateValue(String(value));
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
    return formatDateTimeValue(value);
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

// Detecta se uma string é, na verdade, um array de notas serializado (bug de
// dupla-serialização vindo da conversão Requerimento→Processo).
const looksLikeSerializedNotes = (s: string): boolean => {
  const t = s.trim();
  if (!(t.startsWith('[') && t.endsWith(']'))) return false;
  try {
    const arr = JSON.parse(t);
    return Array.isArray(arr) && arr.some(
      (i) => i && typeof i === 'object' && typeof i.text === 'string' && ('id' in i || 'created_at' in i),
    );
  } catch {
    return false;
  }
};

const normalizeNoteItem = (item: any): ProcessNote => ({
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
});

const parseNotes = (value?: string | null, depth = 0): ProcessNote[] => {
  if (!value || depth > 5) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const out: ProcessNote[] = [];
      for (const raw of parsed) {
        if (typeof raw !== 'object' || raw === null || typeof raw.text !== 'string') continue;
        // Caso corrompido: o text é um array de notas serializado → desembrulha
        if (looksLikeSerializedNotes(raw.text)) {
          out.push(...parseNotes(raw.text, depth + 1));
          continue;
        }
        out.push(normalizeNoteItem(raw));
      }
      // Dedup por id (a dupla-serialização gera duplicatas)
      const seen = new Set<string>();
      return out.filter((n) => {
        const key = `${n.id}|${n.created_at}|${n.text.slice(0, 40)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  } catch {
    // compatibilidade com notas antigas (texto puro)
  }

  // Texto puro legado: ainda pode ser um array serializado solto
  if (looksLikeSerializedNotes(value)) {
    return parseNotes(value, depth + 1);
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
    process_code?: string;
    court?: string;
    distributed_at?: string;
  };
  initialStatusFilter?: ProcessStatusFilter;
  initialSearchQuery?: string;
  onParamConsumed?: () => void;
}

const ProcessesModule: React.FC<ProcessesModuleProps> = ({ forceCreate, entityId, prefillData, initialStatusFilter, initialSearchQuery, onParamConsumed }) => {
  const { user } = useAuth();
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  
  // Sincronização DJEN removida - agora apenas via Edge Function (cron)
  const [statusOptions, setStatusOptions] = useState(STATUS_OPTIONS);
  const [practiceAreas, setPracticeAreas] = useState(PRACTICE_AREAS);
  const [defaultProcessStatus, setDefaultProcessStatus] = useState<string | null>(null);

  const makeEmptyForm = useCallback(() => {
    const preferredStatus = (
      defaultProcessStatus && statusOptions.some(s => s.key === defaultProcessStatus)
        ? defaultProcessStatus
        : statusOptions.some(s => s.key === emptyForm.status)
          ? emptyForm.status
          : statusOptions[0]?.key ?? emptyForm.status
    ) as typeof emptyForm.status;
    return {
      ...emptyForm,
      status: preferredStatus,
      practice_area: (practiceAreas.some(a => a.key === emptyForm.practice_area) ? emptyForm.practice_area : practiceAreas[0]?.key ?? emptyForm.practice_area) as typeof emptyForm.practice_area,
    };
  }, [statusOptions, practiceAreas, defaultProcessStatus]);
  const [timelineEventLimit, setTimelineEventLimit] = useState(30);
  const [aiSummaryMaxTokens, setAiSummaryMaxTokens] = useState(1000);

  useEffect(() => {
    profileService.getMyProfile().then(p => setCurrentUserProfile(p)).catch(() => {});
    settingsService.getResponsibilityConfig().then(cfgs => {
      const cfg = cfgs.find(c => c.module === 'processes');
      if (cfg) setResponsibilityConfig(cfg);
    }).catch(() => {});
    settingsService.getProcessModuleConfig().then(cfg => {
      if (cfg.statuses.length > 0) {
        const relabeled = STATUS_OPTIONS
          .filter(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return !sv || sv.active !== false; })
          .map(local => { const sv = cfg.statuses.find(s => s.key === (local.key as string)); return sv ? { ...local, label: sv.label, badge: sv.badge ?? local.badge } : local; });
        const newItems = cfg.statuses.filter(s => !STATUS_OPTIONS.some(l => l.key === s.key) && s.active !== false);
        const neutralized = newItems.map(s => ({
          key: s.key as ProcessStatus,
          label: s.label,
          badge: s.badge ?? 'bg-gray-100 text-gray-700',
        }));
        setStatusOptions([...relabeled, ...neutralized]);
        const defStatus = cfg.statuses.find(s => s.isDefault && s.active !== false);
        if (defStatus) setDefaultProcessStatus(defStatus.key);
      }
      if (cfg.practice_areas.length > 0) {
        setPracticeAreas(cfg.practice_areas.filter(a => a.active !== false).map(a => ({
          key: a.key as ProcessPracticeArea,
          label: a.label,
          description: a.description,
        })));
      }
      setTimelineEventLimit(cfg.timeline_event_limit ?? 30);
      setAiSummaryMaxTokens(cfg.ai_summary_max_tokens ?? 1000);
    }).catch(() => {});
  }, []);

  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [responsibilityConfig, setResponsibilityConfig] = useState<ModuleResponsibilityConfig | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const fl = useFormLayout('processes');
  const [selectedProcess, setSelectedProcess] = useState<Process | null>(null);
  const [searchingDjen, setSearchingDjen] = useState(false);
  const [djenData, setDjenData] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProcessStatusFilter>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [selectedProcessForView, setSelectedProcessForView] = useState<Process | null>(null);
  // #5 — Comarca editável inline
  const [editingCourtFor, setEditingCourtFor] = useState<string | null>(null);
  const [courtDraft, setCourtDraft] = useState('');
  const [savingCourt, setSavingCourt] = useState(false);
  // #6 — Badge de não lidas
  const [processesWithUnread, setProcessesWithUnread] = useState<Set<string>>(new Set());
  // #8 — Resumo IA do processo
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingAiSummary, setLoadingAiSummary] = useState(false);
  // Partes do processo (polo_ativo / polo_passivo das intimações)
  const [processParties, setProcessParties] = useState<{ polo_ativo: string | null; polo_passivo: string | null } | null>(null);
  const [loadingParties, setLoadingParties] = useState(false);
  // Assinaturas vinculadas ao processo
  const [processSignatures, setProcessSignatures] = useState<SignatureRequest[]>([]);
  const [loadingSignatures, setLoadingSignatures] = useState(false);
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
  const [syncingDjen, setSyncingDjen] = useState(false);
  const [djenSyncResult, setDjenSyncResult] = useState<{ total: number; synced: number; updated: number; errors: number } | null>(null);

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
  const [stayResponsibleId, setStayResponsibleId] = useState('');
  const [staySectionExpanded, setStaySectionExpanded] = useState(false);
  const [schedulingStay, setSchedulingStay] = useState(false);
  const [stayScheduleError, setStayScheduleError] = useState<string | null>(null);
  const [stayScheduleSuccess, setStayScheduleSuccess] = useState<string | null>(null);
  const [hearingResponsibleId, setHearingResponsibleId] = useState('');

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

  // Fotos dos clientes vinculados aos processos (reutiliza hook compartilhado)
  const clientsForPhotos = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; photo_path?: string | null; excluded_photo_paths?: string[] | null }[] = [];
    for (const p of processes) {
      if (p.client_id && !seen.has(p.client_id)) {
        seen.add(p.client_id);
        const c = clientMap.get(p.client_id) || allClientsMap.get(p.client_id);
        list.push({
          id: p.client_id,
          photo_path: (c as any)?.photo_path ?? null,
          excluded_photo_paths: (c as any)?.excluded_photo_paths ?? null,
        });
      }
    }
    return list;
  }, [processes, clientMap, allClientsMap]);
  const clientPhotoUrls = useClientPhotos(clientsForPhotos);

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
        : statusFilter === 'em_andamento_macro'
          ? processes.filter((process) => ACTIVE_PROCESS_STATUSES.includes(process.status))
          : processes.filter((process) => process.status === statusFilter);

    if (!term) return baseList;

    return baseList.filter((process) => {
      const client = allClientsMap.get(process.client_id);

      const practiceAreaLabel =
        practiceAreas.find((area) => area.key === process.practice_area)?.label ?? process.practice_area;

      // Nota: responsible_lawyer propositalmente excluído do composite —
      // em escritórios monoadvo o nome do advogado está em todos os processos
      // e polui a busca por cliente/código/área.
      const composite = [
        client?.full_name,
        process.process_code,
        process.court,
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

  const appliedInitialSearchRef = useRef(false);
  useEffect(() => {
    if (!initialSearchQuery) return;
    if (appliedInitialSearchRef.current) return;
    appliedInitialSearchRef.current = true;
    setSearchTerm(initialSearchQuery);
    onParamConsumed?.();
  }, [initialSearchQuery, onParamConsumed]);

  const processesSyncTick = useSyncTick('processes');

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
  }, [processesSyncTick]);

  // Realtime — atualiza processos automaticamente quando o cron DJEN/DataJud grava no banco
  useEffect(() => {
    const channel = supabase
      .channel('processes_realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'processes' },
        (payload) => {
          const updated = payload.new as Process;
          processService.invalidateCache();
          setProcesses(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          setSelectedProcessForView(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'processes' },
        (payload) => {
          processService.invalidateCache();
          setProcesses(prev => [payload.new as Process, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'processes' },
        (payload) => {
          const id = (payload.old as { id: string }).id;
          processService.invalidateCache();
          setProcesses(prev => prev.filter(p => p.id !== id));
          setSelectedProcessForView(prev => prev?.id === id ? null : prev);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // #6 — Carregar processos com intimações não lidas
  useEffect(() => {
    djenLocalService.getUnreadProcessIds().then(setProcessesWithUnread).catch(() => {});
  }, []);

  // #5 — Salvar comarca editada
  const saveCourtEdit = async () => {
    if (!selectedProcessForView || !editingCourtFor) return;
    setSavingCourt(true);
    try {
      await processService.updateProcess(selectedProcessForView.id, { court: courtDraft });
      setSelectedProcessForView(prev => prev ? { ...prev, court: courtDraft } : prev);
      setProcesses(prev => prev.map(p => p.id === selectedProcessForView.id ? { ...p, court: courtDraft } : p));
      setEditingCourtFor(null);
    } catch { /* silencioso */ } finally {
      setSavingCourt(false);
    }
  };

  // #8 — Gerar resumo IA do processo (vê TODO o andamento: DJEN + DataJud)
  const generateProcessSummary = async (proc: Process) => {
    if (loadingAiSummary) return;
    setLoadingAiSummary(true);
    setAiSummary(null);
    try {
      const normalizeWhitespace = (value?: string | null) =>
        String(value || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      const truncate = (value: string, max: number) =>
        value.length <= max ? value : `${value.slice(0, max).trimEnd()}...`;

      // Busca DJEN e DataJud em paralelo
      const [djenEvents, djResult] = await Promise.allSettled([
        processTimelineService.fetchTimelineFromDatabase(proc.id, proc.process_code ?? ''),
        proc.process_code ? fetchDatajudMovimentos(proc.process_code) : Promise.resolve(null),
      ]);

      const events = djenEvents.status === 'fulfilled' ? djenEvents.value : [];
      if (events.length === 0 && (djResult.status !== 'fulfilled' || !djResult.value?.processo?.movimentos?.length)) {
        setAiSummary('Sem movimentações registradas para resumir.');
        return;
      }

      // Timeline DJEN — todos os eventos com análise IA quando disponível
      const toDayKey = (d: string) => {
        if (!d) return '';
        if (d.includes('T')) return d.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) { const [dd,mm,yyyy] = d.split('/'); return `${yyyy}-${mm}-${dd}`; }
        return d;
      };

      const djenTimeline = events.map((e) => {
        const date = toDayKey(e.date);
        const type = e.type ? e.type.toUpperCase() : 'MOVIMENTAÇÃO';
        const body = e.aiAnalysis?.summary || e.description?.replace(/<[^>]*>/g, '').slice(0, 300) || '';
        return `[${date}] ${type} — ${e.title}${body ? `\n${body}` : ''}`;
      }).join('\n\n');

      // Timeline DataJud — movimentações do CNJ (complementa DJEN)
      let datajudTimeline = '';
      if (djResult.status === 'fulfilled' && djResult.value?.processo?.movimentos?.length) {
        const movs = djResult.value.processo.movimentos.map(m =>
          `[${m.dataHora.slice(0, 10)}] ${m.nome}`
        ).join('\n');
        datajudTimeline = `\n\nMOVIMENTAÇÕES CNJ (DataJud — ${djResult.value.processo.movimentos.length} total):\n${movs}`;
      }

      const clientName = clientMap.get(proc.client_id)?.full_name || 'Não identificado';
      const areaLabel  = practiceAreas.find(a => a.key === proc.practice_area)?.label || proc.practice_area || 'Não informada';
      const poloAtivo  = processParties?.polo_ativo  || clientName;
      const poloPassivo = processParties?.polo_passivo || 'Não identificado';

      // Data de ajuizamento do DataJud se disponível
      const dataAjuizamento = (djResult.status === 'fulfilled' && djResult.value?.processo?.dataAjuizamento)
        ? new Date(djResult.value.processo.dataAjuizamento).toLocaleDateString('pt-BR')
        : (proc.distributed_at ? new Date(proc.distributed_at).toLocaleDateString('pt-BR') : 'Não informado');

      const result = await aiService.generateText(
        `Você é um advogado sênior brasileiro especialista em análise processual. Leia os dados do processo com atenção cirúrgica antes de escrever qualquer coisa. Responda SEMPRE em português brasileiro formal, técnico e direto.

REGRAS ABSOLUTAS — violá-las invalida a resposta:
1. NUNCA atribua uma ação a uma parte (recorreu, peticionou, pagou, etc.) sem que o texto do evento EXPLICITAMENTE nomeie quem a praticou. Se não souber quem fez, escreva "uma das partes" ou "a parte não identificada no texto".
2. O polo ativo (autor/requerente) é quem INICIOU o processo. O polo passivo (réu/requerido) é quem foi acionado. Na maioria dos casos, quando há sentença favorável ao polo ativo, é o POLO PASSIVO que recorre.
3. NUNCA invente datas, valores, decisões ou prazos que não estejam nos dados.
4. Cite sempre a data real do evento que embasa cada afirmação.
5. Seja específico: diga O QUÊ foi decidido, não apenas "há uma decisão".`,
        `PROCESSO: ${proc.process_code || 'Não informado'}
POLO ATIVO (autor/requerente, nosso cliente): ${poloAtivo}
POLO PASSIVO (réu/requerido): ${poloPassivo}
ÁREA: ${areaLabel} | VARA/TRIBUNAL: ${proc.court || 'Não informado'} | DISTRIBUÍDO: ${dataAjuizamento}

═══ HISTÓRICO PROCESSUAL — DJEN (do mais recente ao mais antigo) ═══
${djenTimeline || 'Sem publicações no DJEN.'}
${datajudTimeline}
═══════════════════════════════════════════════════════════

TAREFA: leia TODO o histórico acima, identifique a sequência real de fatos e gere um resumo com EXATAMENTE estas 4 seções (use os marcadores literais):

**Situação Atual**
• [O que foi decidido até agora e em que fase o processo está — cite a última movimentação com data]

**Últimas Movimentações Relevantes**
• [Descreva a movimentação mais recente, quem a praticou SE explícito no texto, e qual o efeito prático]
• [Segunda movimentação relevante, se houver]

**Pontos de Atenção**
• [Riscos concretos, prazos identificados no texto, decisões desfavoráveis ao polo ativo]

**Próximo Passo Recomendado**
• [Ação concreta e adequada ao tipo de juízo (JE, Vara Cível, TJ etc.) — cite o fundamento legal se relevante]

Cada bullet = máximo 2 linhas. Baseie-se SOMENTE nos dados acima.`,
        aiSummaryMaxTokens
      );
      setAiSummary(result);
    } catch { setAiSummary('Erro ao gerar resumo. Tente novamente.'); }
    finally { setLoadingAiSummary(false); }
  };

  const generateProcessSummaryImproved = async (proc: Process) => {
    if (loadingAiSummary) return;
    setLoadingAiSummary(true);
    setAiSummary(null);
    try {
      const normalizeWhitespace = (value?: string | null) =>
        String(value || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

      const truncate = (value: string, max: number) =>
        value.length <= max ? value : `${value.slice(0, max).trimEnd()}...`;

      const toDayKey = (d: string) => {
        if (!d) return '';
        if (d.includes('T')) return d.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
          const [dd, mm, yyyy] = d.split('/');
          return `${yyyy}-${mm}-${dd}`;
        }
        return d;
      };

      const [djenEvents, djResult] = await Promise.allSettled([
        processTimelineService.fetchTimelineFromDatabase(proc.id, proc.process_code ?? ''),
        proc.process_code ? fetchDatajudMovimentos(proc.process_code) : Promise.resolve(null),
      ]);

      const events = djenEvents.status === 'fulfilled' ? djenEvents.value : [];
      const datajudMovs =
        djResult.status === 'fulfilled' && djResult.value?.processo?.movimentos?.length
          ? djResult.value.processo.movimentos
          : [];

      if (events.length === 0 && datajudMovs.length === 0) {
        setAiSummary('Sem movimentações registradas para resumir.');
        return;
      }

      const djenTimeline = events
        .slice(0, timelineEventLimit)
        .map((e) => {
          const date = toDayKey(e.date);
          const type = e.type ? e.type.toUpperCase() : 'MOVIMENTACAO';
          const summary = normalizeWhitespace(e.aiAnalysis?.summary);
          const excerpt = truncate(normalizeWhitespace(e.description), 900);
          const urgency = e.aiAnalysis?.urgency ? ` | urgencia IA: ${e.aiAnalysis.urgency}` : '';
          const actionRequired = e.aiAnalysis?.actionRequired ? ' | acao requerida: sim' : '';
          return [
            `[${date}] ${type} - ${e.title}${urgency}${actionRequired}`,
            e.orgao ? `Orgao: ${e.orgao}` : '',
            summary ? `Resumo previo: ${summary}` : '',
            excerpt ? `Trecho integral relevante: ${excerpt}` : '',
          ].filter(Boolean).join('\n');
        })
        .join('\n\n');

      let datajudTimeline = '';
      if (datajudMovs.length > 0) {
        const movs = datajudMovs
          .slice(0, timelineEventLimit)
          .map((m) => {
            const date = toDayKey(m.dataHora);
            const complements = (m.complementosTabelados ?? [])
              .slice(0, 3)
              .map((c) => c.descricao || c.nome)
              .filter(Boolean)
              .join('; ');

            return [
              `[${date}] ${m.nome}`,
              m.orgaoJulgador?.nomeOrgao ? `Orgao julgador: ${m.orgaoJulgador.nomeOrgao}` : '',
              complements ? `Complementos: ${complements}` : '',
            ].filter(Boolean).join('\n');
          })
          .join('\n\n');

        datajudTimeline = `\n\nMOVIMENTACOES CNJ (DataJud - ${datajudMovs.length} total, exibindo ate ${timelineEventLimit}):\n${movs}`;
      }

      const internalNotes = buildNoteThreads(parseNotes(selectedProcessForView?.notes))
        .slice(-6)
        .map((note) => {
          const author = getNoteAuthorDisplay(note);
          const text = truncate(normalizeWhitespace(note.text), 400);
          return text ? `[${formatDateTime(note.created_at)}] ${author}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n\n');

      const clientName = clientMap.get(proc.client_id)?.full_name || 'Não identificado';
      const areaLabel = practiceAreas.find(a => a.key === proc.practice_area)?.label || proc.practice_area || 'Não informada';
      const poloAtivo = processParties?.polo_ativo || clientName;
      const poloPassivo = processParties?.polo_passivo || 'Não identificado';
      const dataAjuizamento =
        djResult.status === 'fulfilled' && djResult.value?.processo?.dataAjuizamento
          ? new Date(djResult.value.processo.dataAjuizamento).toLocaleDateString('pt-BR')
          : (proc.distributed_at ? new Date(proc.distributed_at).toLocaleDateString('pt-BR') : 'Não informado');

      const result = await aiService.generateText(
        `Você é um advogado sênior brasileiro especialista em análise processual. Leia o histórico com precisão factual e escreva de forma técnica e direta.

REGRAS ABSOLUTAS:
1. Nunca atribua uma ação a uma parte sem que o texto identifique isso expressamente.
2. Nunca invente datas, prazos, decisões, recursos, petições, valores ou providências.
3. Distribuição, conclusão, juntada, remessa, recebimento, publicação/disponibilização no DJE e atos cartorários não significam, por si só, decisão de mérito nem medida da parte.
4. Se o histórico mostrar apenas atos ordinatórios ou fase inicial, diga isso expressamente.
5. Nunca recomende "apresentar petição inicial" se o processo já está distribuído/ajuizado.
6. Se não houver prazo ou decisão material identificável, escreva isso claramente em "Pontos de Atenção" e "Próximo Passo Recomendado".
7. O próximo passo recomendado deve ser conservador e aderente ao histórico real. Se faltarem elementos para uma providência ativa, recomende apenas acompanhar o andamento, aguardar citação/intimação ou revisar a última publicação integralmente.
8. Cite a data (dd/mm/aaaa) do evento que embasa cada afirmação inline, dentro da própria frase. NUNCA acrescente sufixos rotulados entre parênteses do tipo "(Ultima movimentação: ...)", "(Movimentação relevante: ...)" ou "(Prazos: ...)" — isso é proibido.
9. NÃO repita a mesma informação. Cada afirmação deve ser dita uma única vez.`,
        `PROCESSO: ${proc.process_code || 'Não informado'}
POLO ATIVO (autor/requerente, nosso cliente): ${poloAtivo}
POLO PASSIVO (réu/requerido): ${poloPassivo}
AREA: ${areaLabel} | VARA/TRIBUNAL: ${proc.court || 'Não informado'} | DISTRIBUIDO: ${dataAjuizamento}

=== HISTORICO PROCESSUAL - DJEN (mais recente para o mais antigo) ===
${djenTimeline || 'Sem publicações no DJEN.'}
${datajudTimeline}
${internalNotes ? `\n\n=== HISTORICO INTERNO DO ESCRITORIO ===\n${internalNotes}` : ''}
==============================================================

TAREFA:
Leia TODO o histórico acima e escreva a análise em DOIS blocos, exatamente neste formato:

Um único parágrafo corrido (3 a 5 frases, sem título, sem bullets) explicando: a fase atual e a última movimentação com sua data; as movimentações anteriores que tiveram efeito prático real; e qualquer prazo, risco ou ausência de decisão de mérito que mereça atenção. Texto fluido e técnico, cada informação dita uma única vez.

**Próximo Passo Recomendado**
• [Uma frase com a providência concreta e conservadora, aderente ao histórico; se não houver base para agir, oriente apenas acompanhar/aguardar.]

Não use outros títulos além de "Próximo Passo Recomendado". Sem sufixos entre parênteses. Baseie-se somente nos dados acima.`,
        aiSummaryMaxTokens
      );

      setAiSummary(result);
    } catch {
      setAiSummary('Erro ao gerar resumo. Tente novamente.');
    } finally {
      setLoadingAiSummary(false);
    }
  };

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

  const handleManualDjenSync = useCallback(async () => {
    if (syncingDjen) return;
    setSyncingDjen(true);
    setDjenSyncResult(null);
    try {
      const result = await processDjenSyncService.syncPendingProcesses();
      setDjenSyncResult(result);
      // Recarrega a lista pra refletir novos andamentos
      processService.invalidateCache();
      const data = await processService.listProcesses();
      setProcesses(data);
      fetchDjenCronLogs();
    } catch (err) {
      console.error('Erro na sincronização manual DJEN:', err);
      setDjenSyncResult({ total: 0, synced: 0, updated: 0, errors: 1 });
    } finally {
      setSyncingDjen(false);
    }
  }, [syncingDjen, fetchDjenCronLogs]);

  // Stats de sincronização DJEN derivados dos processos carregados
  const djenStats = useMemo(() => {
    const tracked = processes.filter((p) => p.status !== 'arquivado' && p.status !== 'nao_protocolado');
    const synced = tracked.filter((p) => p.djen_synced);
    const withData = tracked.filter((p) => p.djen_has_data);
    let lastSync: string | null = null;
    for (const p of processes) {
      if (p.djen_last_sync && (!lastSync || p.djen_last_sync > lastSync)) lastSync = p.djen_last_sync;
    }
    return {
      tracked: tracked.length,
      synced: synced.length,
      withData: withData.length,
      lastSync,
    };
  }, [processes]);

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
          process_code: prefillData.process_code || prev.process_code,
          court: prefillData.court || prev.court,
          distributed_at: prefillData.distributed_at || prev.distributed_at,
          status: prefillData.distributed_at ? 'distribuido' : prev.status,
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

  const appliedEntityIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!entityId || processes.length === 0) return;
    if (appliedEntityIdRef.current === entityId) return; // já aberto este processo
    appliedEntityIdRef.current = entityId;
    const process = processes.find((p) => p.id === entityId);
    if (process) {
      // Se já está com o detalhe aberto, fechar primeiro para garantir re-montagem do conteúdo
      if (viewMode === 'details') {
        setSelectedProcessForView(null);
        setViewMode('list');
      }
      handleViewProcess(process); // chama a versão completa: carrega parties, signatures, etc.
      onParamConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, processes]);

  useEffect(() => {
    let active = true;
    const loadMembers = async () => {
      try {
        // Usar settingsService.listUsers() que filtra is_active = true
        const data = await settingsService.listUsers();
        if (!active) return;
        const roleOrder = (r: string) => { const rl = r.toLowerCase(); return rl.includes('admin') ? 0 : rl.includes('advog') ? 1 : 2; };
        setMembers((data as any[]).sort((a, b) => roleOrder(a.role ?? '') - roleOrder(b.role ?? '')));
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
    if (selectedProcessForView && viewMode === 'details' && selectedProcessForView.process_code) {
      loadTimeline(selectedProcessForView.process_code);
    } else {
      setTimeline([]);
      setTimelineError(null);
    }
  }, [selectedProcessForView?.id, viewMode]);

  const handleReload = async (statusOverride?: { processId: string; status: ProcessStatus }) => {
    try {
      setLoading(true);
      const data = await processService.listProcesses();
      // Aplica override de status na lista (DB pode não ter persistido ainda)
      const patchedData = statusOverride
        ? data.map(p => p.id === statusOverride.processId ? { ...p, status: statusOverride.status } : p)
        : data;
      setProcesses(patchedData);
      if (selectedProcessForView) {
        const updated = patchedData.find((item) => item.id === selectedProcessForView.id);
        if (updated) {
          const fullProcess = await processService.getProcessById(updated.id);
          const result = fullProcess ?? updated;
          // Garante que o status novo não seja sobrescrito pelo valor antigo do banco
          if (statusOverride && result.id === statusOverride.processId) {
            setSelectedProcessForView({ ...result, status: statusOverride.status });
          } else {
            setSelectedProcessForView(result);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de processos.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = async (process?: Process) => {
    if (process) {
      const fullProcess = await processService.getProcessById(process.id);
      const processData = fullProcess ?? process;

      setSelectedProcess(processData);
      setFormData({
        client_id: processData.client_id,
        process_code: processData.process_code || '',
        status: (statusOptions.some(s => s.key === processData.status) ? processData.status : statusOptions[0]?.key ?? processData.status) as typeof emptyForm.status,
        distributed_at: toDateInputValue(processData.distributed_at),
        practice_area: (practiceAreas.some(a => a.key === processData.practice_area) ? processData.practice_area : practiceAreas[0]?.key ?? processData.practice_area) as typeof emptyForm.practice_area,
        court: processData.court || '',
        responsible_lawyer: processData.responsible_lawyer || '',
        responsible_lawyer_id: processData.responsible_lawyer_id || '',
        hearing_scheduled: processData.hearing_scheduled ? 'sim' : 'nao',
        hearing_date: toDateInputValue(processData.hearing_date),
        hearing_time: toTimeInputValue(processData.hearing_time),
        hearing_mode: processData.hearing_mode || 'presencial',
        notes: '',
      });
      if (processData.hearing_scheduled) {
        const hearingEvent = await calendarService.getEventByAutoKey(`hearing:${processData.id}`);
        setHearingResponsibleId(hearingEvent?.user_id || '');
      } else {
        setHearingResponsibleId('');
      }
      const client = clientMap.get(processData.client_id);
      if (client) {
        setClientSearchTerm(client.full_name);
      }
    } else {
      setSelectedProcess(null);
      let defaultLawyerId = '';
      let defaultLawyerName = '';
      if (responsibilityConfig?.default_mode === 'creator' && currentUserProfile) {
        defaultLawyerId = currentUserProfile.id;
        defaultLawyerName = currentUserProfile.name || '';
      } else if (responsibilityConfig?.default_mode === 'single' && responsibilityConfig.single_member_id) {
        const member = members.find(m => m.id === responsibilityConfig.single_member_id);
        defaultLawyerId = responsibilityConfig.single_member_id;
        defaultLawyerName = member?.name || '';
      }
      setFormData({ ...makeEmptyForm(), responsible_lawyer_id: defaultLawyerId, responsible_lawyer: defaultLawyerName });
      setClientSearchTerm('');
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedProcess(null);
    setFormData(makeEmptyForm());
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

  // Aceita código explícito para chamada automática (onChange antes de setState assentar)
  const handleSearchDjen = async (overrideCode?: string) => {
    const codeToSearch = overrideCode ?? formData.process_code;
    const processNumber = codeToSearch.replace(/\D/g, '');

    if (processNumber.length < 20) {
      setError('Número do processo inválido. Deve ter 20 dígitos.');
      return;
    }

    try {
      setSearchingDjen(true);
      setError(null);

      const yearMatch = codeToSearch.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;

      const djenParams: any = { numeroProcesso: processNumber, itensPorPagina: 100 };
      if (year) djenParams.dataDisponibilizacaoInicio = `${year}-01-01`;

      // Busca DJEN e DataJud em paralelo
      const [djenResult, djResult] = await Promise.allSettled([
        djenService.consultarComunicacoes(djenParams),
        fetchDatajudMovimentos(codeToSearch),
      ]);

      // Extrai dados do DataJud (fonte primária para metadados do processo)
      const djUpdates: { distributed_at?: string; court?: string } = {};
      if (djResult.status === 'fulfilled' && djResult.value.processo) {
        const proc = djResult.value.processo;
        if (proc.dataAjuizamento) {
          djUpdates.distributed_at = proc.dataAjuizamento.slice(0, 10);
        }
        if (proc.orgaoJulgador?.nome) {
          djUpdates.court = proc.orgaoJulgador.nome;
        }
      }

      // Aplica dados do DJEN (vara, área)
      if (djenResult.status === 'fulfilled' && djenResult.value.items?.length > 0) {
        const firstItem = djenResult.value.items[0];
        setDjenData(firstItem);
        setFormData((prev) => ({
          ...prev,
          // DataJud tem prioridade para vara se vier; DJEN como fallback
          court: djUpdates.court || firstItem.nomeOrgao || prev.court,
          practice_area: mapClasseToArea(firstItem.nomeClasse) || prev.practice_area,
          ...(djUpdates.distributed_at && !prev.distributed_at
            ? { distributed_at: djUpdates.distributed_at }
            : {}),
        }));
      } else {
        // Sem dados no DJEN — aplica só o que veio do DataJud
        if (Object.keys(djUpdates).length > 0) {
          setFormData((prev) => ({
            ...prev,
            ...(djUpdates.court ? { court: djUpdates.court } : {}),
            ...(djUpdates.distributed_at && !prev.distributed_at
              ? { distributed_at: djUpdates.distributed_at }
              : {}),
          }));
        }
        setError(
          'Nenhuma comunicação encontrada no DJEN para este processo. Possíveis motivos: processo muito recente, sem publicações ainda, ou tribunal não integrado ao DJEN.',
        );
        setDjenData({ _noData: true, message: 'Processo consultado mas sem comunicações no DJEN' });
      }
    } catch (err: any) {
      setError(`Erro ao buscar dados: ${err.message || 'Erro desconhecido'}`);
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
    const search = normalizeSearchText(quickAddClientSearch);
    return allClients
      .filter((c) => normalizeSearchText(c.full_name).includes(search))
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

      if (!selectedProcess && formData.hearing_scheduled === 'sim' && !hearingResponsibleId) {
        setError('Selecione o responsável pela audiência.');
        return;
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

        // Sync DataJud ao arquivar — garante que o histórico fica salvo
        const statusChangingToArchived =
          formData.status === 'arquivado' && editingProcess.status !== 'arquivado';
        if (statusChangingToArchived && trimmedProcessCode) {
          processDjenSyncService
            .syncProcessWithDjen({ ...editingProcess, ...updatePayload } as Process)
            .catch(() => {});
        }

        if (formData.hearing_scheduled === 'sim') {
          try {
            const hearingEvent = await calendarService.getEventByAutoKey(`hearing:${editingProcess.id}`);
            if (hearingEvent) {
              const hearingUpdatePayload: Record<string, any> = { user_id: hearingResponsibleId || null };
              if (formData.hearing_date) {
                hearingUpdatePayload.start_at = `${formData.hearing_date}T${formData.hearing_time || '09:00'}:00-04:00`;
              }
              await calendarService.updateEvent(hearingEvent.id, hearingUpdatePayload);
            }
          } catch {}
        }

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
              type: 'process_created',
              user_id: user.id,
              process_id: newProcess.id,
              metadata: {
                status: createPayload.status,
                client_name: clientName,
              },
            });
          } catch {}
        }

        if (newProcess && formData.hearing_scheduled === 'sim' && formData.hearing_date) {
          try {
            const hearingMode = formData.hearing_mode === 'online' ? 'POR VÍDEO' : 'PRESENCIAL';
            await calendarService.createEvent({
              title: `AUDIÊNCIA ${hearingMode} - ${newProcess.process_code || 'PROCESSO'}`,
              description: formData.court ? `Audiência do processo ${newProcess.process_code || ''} • ${formData.court}` : undefined,
              event_type: 'hearing',
              status: 'pendente',
              start_at: `${formData.hearing_date}T${formData.hearing_time || '09:00'}:00-04:00`,
              process_id: newProcess.id,
              client_id: (newProcess as any).client_id || null,
              user_id: hearingResponsibleId || null,
            });
          } catch (err) {
            console.error('Erro ao criar evento de audiência:', err);
          }
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
      setFormData(makeEmptyForm());
      setClientSearchTerm('');
      setHearingResponsibleId('');
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
      notifyDeleted(proc?.process_code || undefined);
      await handleReload();
      setProcesses((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o processo.');
    }
  };

  const handleViewProcess = async (process: Process) => {
    const fullProcess = await processService.getProcessById(process.id);
    setSelectedProcessForView(fullProcess ?? process);
    setViewMode('details');
    setNoteDraft('');
    setNoteError(null);
    setAiSummary(null);
    setProcessParties(null);
    setLoadingParties(false);
    setProcessSignatures([]);
    // Carregar assinaturas do cliente vinculadas a este processo ou ao cliente
    if (process.client_id) {
      setLoadingSignatures(true);
      signatureService.listRequests()
        .then(all => {
          // Prioridade: vinculadas ao número do processo; fallback: todas do cliente
          const byProcess = all.filter(s => s.process_number === process.process_code && process.process_code);
          const byClient  = all.filter(s => s.client_id === process.client_id);
          // Se há assinaturas com process_number preenchido, mostra só essas;
          // caso contrário, mostra todas do cliente
          setProcessSignatures(byProcess.length > 0 ? byProcess : byClient);
        })
        .catch(() => {})
        .finally(() => setLoadingSignatures(false));
    }
    // Carregar partes do processo a partir das intimações vinculadas (ou DJEN direto)
    await loadProcessParties(process.id, false, process.process_code);
  };

  // Extrai e persiste partes do processo (polo ativo/passivo)
  // force=true ignora cache do DB e re-extrai
  const loadProcessParties = async (processId: string, force: boolean, processCode?: string) => {
    setLoadingParties(true);
    // Limpa nomes vindos do DJEN — remove prefixo "Nome:", endereço/CPF/CNPJ concatenados
    const cleanDjenNome = (nome: string): string =>
      nome
        .replace(/^Nome:\s*/i, '')                                              // remove prefixo "Nome: "
        .replace(/\s*[-–]?\s*(Endere[çc]o|CPF|CNPJ|RG|CEP|Tel(?:efone)?|E[-\s]?mail)\s*:.*/i, '') // corta em Endereço/CPF/etc
        .replace(/\s*[-–]\s*$/, '')                                             // remove traço final solto
        .replace(/\s+/g, ' ')
        .trim();

    try {
      const comuns = await djenLocalService.listComunicacoes({ process_id: processId });

      // ── Se não há dados locais, consulta DJEN direto e extrai destinatários ──
      if (comuns.length === 0 && processCode) {
        const digits = processCode.replace(/\D/g, '');
        if (digits.length === 20) {
          try {
            const yearMatch = processCode.match(/\d{7}-\d{2}\.(\d{4})\./);
            const resp = await djenService.consultarComunicacoes({
              numeroProcesso: digits,
              itensPorPagina: 100,
              dataDisponibilizacaoInicio: yearMatch ? `${yearMatch[1]}-01-01` : undefined,
            });
            if (resp.items?.length > 0) {

              // Agrega destinatários de todas as comunicações
              const allDests = resp.items.flatMap(c => c.destinatarios ?? []);
              const ativo = [...new Set(
                allDests
                  .filter(d => /ativo|autor|requerente/i.test(d.polo ?? ''))
                  .map(d => cleanDjenNome(d.nome?.trim() ?? ''))
                  .filter(Boolean)
              )].join(', ') || null;
              const passivo = [...new Set(
                allDests
                  .filter(d => /passivo|r[eé]u|requerido/i.test(d.polo ?? ''))
                  .map(d => cleanDjenNome(d.nome?.trim() ?? ''))
                  .filter(Boolean)
              )].join(', ') || null;

              // Se não veio polo nos destinatários, tenta pelo texto das intimações
              if (!ativo && !passivo) {
                for (const item of resp.items) {
                  const t = item.texto ?? '';
                  const qa = t.match(/POLO\s+ATIVO\s*:?\s*(.+?)(?=\s*POLO\s+PASSIVO)/i);
                  const qp = t.match(/POLO\s+PASSIVO\s*:?\s*([A-ZÁÉÍÓÚÀÂÊÎÔÛÃÕÇ][^\n.]{2,80}?)(?=\s*(?:Vistos|INTIMAÇÃO|$|\.))/i);
                  if (qa || qp) {
                    setProcessParties({ polo_ativo: qa?.[1]?.trim() || null, polo_passivo: qp?.[1]?.trim() || null });
                    return;
                  }
                }
              }

              if (ativo || passivo) {
                setProcessParties({ polo_ativo: ativo, polo_passivo: passivo });
                return;
              }
            }
          } catch { /* DJEN direto falhou — continua sem partes */ }
        }
        return; // sem dados locais nem via DJEN
      }

      if (comuns.length === 0) return;

      // Helper: persiste as partes encontradas no primeiro registro da intimação
      const persistParties = async (id: string, ativo: string | null, passivo: string | null) => {
        try {
          await djenLocalService.updateComunicacao(id, { polo_ativo: ativo, polo_passivo: passivo });
        } catch { /* silently ignore persist errors */ }
      };

      // 1) Tentar polo_ativo/polo_passivo já gravados (somente se não for rebusca forçada)
      if (!force) {
        const withPolo = comuns.find(c => c.polo_ativo || c.polo_passivo);
        if (withPolo) {
          // Aplica limpeza mesmo no cache — garante que dados antigos sujos são exibidos corretamente
          setProcessParties({
            polo_ativo:  withPolo.polo_ativo  ? cleanDjenNome(withPolo.polo_ativo)  : null,
            polo_passivo: withPolo.polo_passivo ? cleanDjenNome(withPolo.polo_passivo) : null,
          });
          return;
        }
      }

      // 2) Tentar via djen_destinatarios (joinados)
      for (const c of comuns) {
        const dests = c.djen_destinatarios ?? [];
        if (dests.length > 0) {
          const ativo = dests
            .filter(d => d.polo && /ativo|autor|requerente/i.test(d.polo))
            .map(d => cleanDjenNome(d.nome ?? '')).filter(Boolean).join(', ') || null;
          const passivo = dests
            .filter(d => d.polo && /passivo|r[eé]u|requerido/i.test(d.polo))
            .map(d => cleanDjenNome(d.nome ?? '')).filter(Boolean).join(', ') || null;
          if (ativo || passivo) {
            setProcessParties({ polo_ativo: ativo, polo_passivo: passivo });
            await persistParties(c.id, ativo, passivo);
            return;
          }
        }

        // 3) Extrair do texto — tenta regex rápida primeiro, depois IA
        const texto = c.texto ?? '';
        if (!texto) continue;

        const cleanPartyName = (raw: string): string =>
          raw
            .replace(/^(?:AUTORA?|REQUERENTE|R[ÉE]U[AS]?|REQUERIDA?|LITISCONSORTE|PARTE)\s*:\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        const quickAtivo = texto.match(
          /POLO\s+ATIVO\s*:?\s*(?:AUTORA?|REQUERENTE)?\s*:?\s*(.+?)(?=\s*POLO\s+PASSIVO)/i
        );
        const quickPassivo = texto.match(
          /POLO\s+PASSIVO\s*:?\s*(?:R[ÉE]U[AS]?|REQUERIDA?)?\s*:?\s*([A-ZÁÉÍÓÚÀÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÀÂÊÎÔÛÃÕÇa-záéíóúàâêîôûãõç0-9\s.,'&-]{2,80}?)(?=\s*(?:Vistos|Nos\s+termos|Tendo\s+em|Procedo|INTIMAÇÃO|$|\.))/i
        );

        if (quickAtivo || quickPassivo) {
          const ativo   = quickAtivo   ? cleanPartyName(quickAtivo[1])   : null;
          const passivo = quickPassivo ? cleanPartyName(quickPassivo[1]) : null;
          setProcessParties({ polo_ativo: ativo, polo_passivo: passivo });
          await persistParties(c.id, ativo, passivo);
          return;
        }

        // 4) IA como fallback — chamada UMA única vez, resultado salvo no DB
        if (aiService.isEnabled()) {
          try {
            const snippet = texto.substring(0, 1500);
            const raw = await aiService.generateText(
              `Você é um analisador de documentos jurídicos brasileiros.
Extraia APENAS os nomes das partes do processo a partir do texto fornecido.
Retorne SOMENTE um JSON válido no formato:
{"polo_ativo":"NOME DO AUTOR OU NULL","polo_passivo":"NOME DO RÉU OU NULL"}
Regras:
- Use null (sem aspas) se não encontrar
- Retorne APENAS o nome, sem qualificações (ex: "BANCO BRADESCO S.A." e não "REU: BANCO BRADESCO S.A. Nos termos...")
- Não inclua texto jurídico, apenas nomes de pessoas ou empresas`,
              `Texto da intimação:\n${snippet}`,
              200
            );
            const jsonMatch = raw.match(/\{[\s\S]*?"polo_ativo"[\s\S]*?\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              const aiAtivo   = parsed.polo_ativo   && parsed.polo_ativo   !== 'NULL' ? String(parsed.polo_ativo).trim()   : null;
              const aiPassivo = parsed.polo_passivo && parsed.polo_passivo !== 'NULL' ? String(parsed.polo_passivo).trim() : null;
              if (aiAtivo || aiPassivo) {
                setProcessParties({ polo_ativo: aiAtivo, polo_passivo: aiPassivo });
                await persistParties(c.id, aiAtivo, aiPassivo); // salva → próxima abertura não gasta IA
                return;
              }
            }
          } catch { /* IA falhou — continua sem partes */ }
        }
      }
    } catch { /* silently fail */ }
    finally { setLoadingParties(false); }
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
    setProcessSignatures([]);
    setStayBaseDate('');
    setStayReason('prescricao');
    setStaySectionExpanded(false);
    setStayScheduleError(null);
    setStayScheduleSuccess(null);
    // Reseta o ref para que uma nova navegação via busca global funcione normalmente
    appliedEntityIdRef.current = null;
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
      user_id: stayResponsibleId || null,
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
    if (!stayResponsibleId) {
      setStayScheduleError('Selecione o responsável pelo compromisso.');
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
    if (!stayResponsibleId) {
      setStayScheduleError('Selecione o responsável pelo compromisso.');
      return;
    }
    try {
      setSchedulingStay(true);
      if (!selectedProcessForView.process_code) {
        throw new Error('Processo sem número para consultar timeline.');
      }
      const events = timeline.length > 0 ? timeline : await processTimelineService.fetchProcessTimeline(selectedProcessForView.process_code);
      const timelineText = events
        .slice(0, timelineEventLimit)
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
    const statusConfig = statusOptions.find((s) => s.key === status);
    return statusConfig ? statusConfig.badge : 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: ProcessStatus) => {
    const statusConfig = statusOptions.find((s) => s.key === status);
    return statusConfig ? statusConfig.label : status;
  };

  const getPracticeAreaLabel = (area: ProcessPracticeArea) => {
    const areaConfig = practiceAreas.find((item) => item.key === area);
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
      notifyDeleted();

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
        return 'bg-slate-100 text-slate-800 border-[#e7e5df]';
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

  const renderNote = (note: ProcessNote, depth: number = 0, isLast: boolean = true) => {
    const isReplying = replyingTo === note.id;
    const canDelete = note.author_id === user?.id || user?.user_metadata?.role === 'admin';
    const authorName = getNoteAuthorDisplay(note);
    const hasReplies = !!(note.replies && note.replies.length > 0);

    // Avatar: imagem se houver, senão iniciais coloridas determinísticas
    const initials = (() => {
      const parts = String(authorName).trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    })();
    const hue = (() => {
      let h = 0;
      for (let i = 0; i < authorName.length; i++) h = ((h << 5) - h) + authorName.charCodeAt(i);
      return Math.abs(h) % 360;
    })();
    const isSystem = authorName === 'Equipe do escritório';

    return (
      <div key={note.id} className="relative">
        <div className="flex gap-3">
          {/* Coluna do avatar + linha conectora */}
          <div className="flex flex-col items-center flex-shrink-0">
            {note.author_avatar ? (
              <img
                src={note.author_avatar}
                alt={authorName}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-white shadow-sm"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 ring-white shadow-sm"
                style={isSystem
                  ? { background: '#f1f5f9', color: '#64748b' }
                  : { background: `hsl(${hue},55%,93%)`, color: `hsl(${hue},50%,32%)` }}
              >
                {isSystem ? <FileText className="w-3.5 h-3.5" /> : initials}
              </div>
            )}
            {/* Linha vertical do thread */}
            {(!isLast || hasReplies || isReplying) && (
              <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[12px]" />
            )}
          </div>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0 pb-4">
            <div className="group rounded-xl border border-[#e7e5df] bg-[#f8f7f5] hover:border-slate-300 transition shadow-sm">
              <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-slate-900 truncate">{authorName}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap" title={formatDateTime(note.created_at)}>
                    {formatLastSync(note.created_at) ?? formatDateTime(note.created_at)}
                  </span>
                </div>
                {canDelete && (
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-slate-300 hover:text-red-600 transition opacity-0 group-hover:opacity-100 flex-shrink-0"
                    title="Excluir nota"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="px-3.5 py-2 text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                {note.text}
              </p>
              <div className="px-3.5 pb-2.5">
                <button
                  onClick={() => setReplyingTo(isReplying ? null : note.id)}
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold transition ${
                    isReplying ? 'text-slate-500' : 'text-blue-600 hover:text-blue-700'
                  }`}
                >
                  <Reply className="w-3 h-3" />
                  {isReplying ? 'Cancelar resposta' : 'Responder'}
                </button>
              </div>
            </div>

            {isReplying && (
              <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
                {replyError && <p className="text-xs text-red-600 mb-2">{replyError}</p>}
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={3}
                  autoFocus
                  className="w-full text-sm rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none transition"
                  placeholder="Escreva uma resposta…"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => setReplyingTo(null)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAddReply}
                    disabled={addingReply}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {addingReply ? <Loader2 className="w-3 h-3 animate-spin" /> : <Reply className="w-3 h-3" />}
                    {addingReply ? 'Enviando…' : 'Responder'}
                  </button>
                </div>
              </div>
            )}

            {hasReplies && (
              <div className="mt-1 space-y-0">
                {note.replies!.map((reply, idx) =>
                  renderNote(reply, depth + 1, idx === note.replies!.length - 1),
                )}
              </div>
            )}
          </div>
        </div>
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

    // Ordenar: urgentes primeiro, depois por data de criação
    Object.keys(grouped).forEach((status) => {
      grouped[status as ProcessStatus].sort((a, b) => {
        // Primeiro: urgentes vs não urgentes
        if (a.priority === 'urgente' && b.priority !== 'urgente') return -1;
        if (a.priority !== 'urgente' && b.priority === 'urgente') return 1;
        // Segundo: por data de criação (mais recentes primeiro)
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });

    return grouped;
  }, [filteredProcesses]);

  const filteredStageMapProcesses = useMemo(() => {
    const base = stageMapSelectedStatus ? processesByStatus[stageMapSelectedStatus] || [] : [];
    const q = stageMapSearch.trim().toLowerCase();
    if (!q) return base;

    return base.filter((process) => {
      const client = allClientsMap.get(process.client_id);
      const practiceAreaLabel = practiceAreas.find((area) => area.key === process.practice_area)?.label ?? process.practice_area;
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
    const counts: Record<string, number> = { todos: processes.length, em_andamento_macro: 0 };
    statusOptions.forEach((s) => {
      counts[s.key] = 0;
    });
    processes.forEach((p) => {
      if (counts[p.status] !== undefined) counts[p.status]++;
      if (ACTIVE_PROCESS_STATUSES.includes(p.status)) counts.em_andamento_macro++;
    });
    return counts;
  }, [processes]);

  const noteThreads = useMemo(() => {
    if (!selectedProcessForView) return [];
    return buildNoteThreads(parseNotes(selectedProcessForView.notes));
  }, [selectedProcessForView]);

  const inputStyle =
    'w-full h-[34px] px-3 rounded text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 transition';
  const textareaStyle =
    'w-full px-3 py-2 rounded text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 resize-none transition';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  const processModal = (
    <Modal
      open={isModalOpen}
      onClose={handleCloseModal}
      title={selectedProcess ? 'Editar Processo' : 'Novo Processo'}
      eyebrow="Processos"
      size="2xl"
      zIndex={80}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={saving}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-600 px-4 py-2.5 rounded text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 pb-1" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>

          {/* Seção: Identificação */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Identificação</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
              <div className="md:col-span-5">
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
              </div>
              <div className="md:col-span-6">
                <label className={labelStyle}>Número do Processo</label>
                <input
                  value={formData.process_code}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleFormChange('process_code', val);
                    // Pesquisa automática ao completar 20 dígitos (novo processo)
                    if (!selectedProcess && !searchingDjen && val.replace(/\D/g, '').length >= 20) {
                      handleSearchDjen(val);
                    }
                  }}
                  className={inputStyle}
                  placeholder="0001234-56.2024.8.26.0100"
                  required
                />
              </div>
              <div className="md:col-span-1">
                <button
                  type="button"
                  onClick={() => handleSearchDjen()}
                  disabled={searchingDjen || formData.process_code.replace(/\D/g, '').length < 20}
                  className="w-full h-9 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {searchingDjen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {djenData && (
              <div
                className={`mt-1.5 p-2 rounded-lg text-xs ${
                  djenData._noData
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
                    : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                }`}
              >
                {djenData._noData ? 'Nenhum dado encontrado no DJEN' : `Vara: ${djenData.nomeOrgao}`}
              </div>
            )}
          </div>

          {/* Seção: Dados do Processo */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Dados do Processo</span>
            </div>
            <div className="flex flex-col gap-3">

            {/* Linha 3 — Área | Status | Distribuição | Vara/Comarca */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12">
              {!fl.isHidden('practice_area') && (
              <div className="xl:col-span-3">
                <label className={labelStyle}>{fl.fieldLabel('practice_area', 'Área')}</label>
                <select
                  value={formData.practice_area}
                  onChange={(e) => handleFormChange('practice_area', e.target.value as ProcessPracticeArea)}
                  className={inputStyle}
                  required={fl.isRequired('practice_area')}
                >
                  {practiceAreas.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
              </div>
              )}
              {!fl.isHidden('status') && (
              <div className="xl:col-span-3">
                <label className={labelStyle}>{fl.fieldLabel('status', 'Status')}</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleFormChange('status', e.target.value as ProcessStatus)}
                  className={inputStyle}
                  required={fl.isRequired('status')}
                >
                  {statusOptions.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              )}
              <div className="xl:col-span-3">
                <label className={labelStyle}>Distribuição</label>
                <input
                  type="date"
                  value={formData.distributed_at}
                  onChange={(e) => handleFormChange('distributed_at', e.target.value)}
                  className={inputStyle}
                />
              </div>
              {!fl.isHidden('court') && (
              <div className="xl:col-span-3">
                <label className={labelStyle}>{fl.fieldLabel('court', 'Vara / Comarca')}</label>
                <input
                  value={formData.court}
                  onChange={(e) => handleFormChange('court', e.target.value)}
                  className={inputStyle}
                  required={fl.isRequired('court')}
                />
              </div>
              )}
            </div>

            {/* Linha 4 — Audiência | Modo */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

            {/* Responsável */}
            {!fl.isHidden('responsible') && (
            <div>
              <div className="flex items-baseline gap-3 mb-1">
                <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                  {fl.fieldLabel('responsible', 'Advogado do processo')}{fl.isRequired('responsible') && <span className="text-red-500"> *</span>}
                </label>
                {formData.responsible_lawyer
                  ? <span className="text-xs text-orange-600 font-semibold truncate">{formData.responsible_lawyer}</span>
                  : <span className="text-xs text-slate-400">Selecione um advogado</span>
                }
              </div>
              <div className="flex flex-wrap gap-2 bg-white dark:bg-zinc-800 rounded border border-slate-300 dark:border-zinc-600 p-3">
                {members.filter(m => (m as any).is_active !== false).map(m => {
                  const isSelected = formData.responsible_lawyer_id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      title={m.name || ''}
                      onClick={() => {
                        handleFormChange('responsible_lawyer_id', m.id);
                        handleFormChange('responsible_lawyer', m.name || '');
                      }}
                      className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all hover:z-10 hover:scale-110 ${isSelected ? 'ring-2 ring-offset-1 ring-orange-500 scale-110' : 'ring-1 ring-white dark:ring-zinc-600'}`}
                    >
                      {m.avatar_url
                        ? <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} />
                        : <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-xs font-bold text-amber-700 dark:text-amber-400">{(m.name || m.email || '?')[0].toUpperCase()}</div>
                      }
                      {isSelected && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full flex items-center justify-center">
                          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            )}

            {/* Linha 5 — Data | Hora | Responsável (só quando audiência = sim) */}
            {formData.hearing_scheduled === 'sim' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                <div className="xl:col-span-3">
                  <label className={labelStyle}>Data</label>
                  <input
                    type="date"
                    value={formData.hearing_date}
                    onChange={(e) => handleFormChange('hearing_date', e.target.value)}
                    className={inputStyle}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div className="xl:col-span-3">
                  <label className={labelStyle}>Hora</label>
                  <input
                    type="time"
                    value={formData.hearing_time}
                    onChange={(e) => handleFormChange('hearing_time', e.target.value)}
                    className={inputStyle}
                  />
                </div>
                <div className="xl:col-span-6">
                  <label className={labelStyle}>Responsável pela audiência</label>
                  <div className="flex flex-wrap items-center gap-1.5 min-h-9">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setHearingResponsibleId(hearingResponsibleId === (m.user_id || m.id) ? '' : (m.user_id || m.id))}
                        className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${
                          hearingResponsibleId === (m.user_id || m.id)
                            ? 'ring-2 ring-offset-2 ring-amber-500'
                            : 'ring-1 ring-transparent hover:ring-slate-300'
                        }`}
                        title={m.name || m.email || ''}
                      >
                        {m.avatar_url ? (
                          <img src={m.avatar_url} className="w-8 h-8 rounded-full object-cover" alt={m.name || ''} />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700">
                            {(m.name || m.email || '?')[0].toUpperCase()}
                          </div>
                        )}
                        {hearingResponsibleId === (m.user_id || m.id) && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 rounded-full flex items-center justify-center">
                            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 6l3 3 5-5"/>
                            </svg>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {hearingResponsibleId && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      ✓ {members.find(m => (m.user_id || m.id) === hearingResponsibleId)?.name || 'Responsável selecionado'}
                    </p>
                  )}
                </div>
              </div>
            )}
            </div>
          </div>

          {/* Linha 5 — Observações */}
          {!fl.isHidden('description') && (
          <div>
            <label className={labelStyle}>{fl.fieldLabel('description', 'Observações')}</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => handleFormChange('notes', e.target.value)}
              className={textareaStyle}
              placeholder=""
              required={fl.isRequired('description')}
            />
          </div>
          )}

        </form>
      </ModalBody>
    </Modal>
  );

  const detailsModal = (() => {
    if (!selectedProcessForView || viewMode !== 'details') return null;
    const client = clientMap.get(selectedProcessForView.client_id);
    const practiceAreaInfo = practiceAreas.find((area) => area.key === selectedProcessForView.practice_area);
    return (
      <Modal
        open
        onClose={handleBackToList}
        title={selectedProcessForView.process_code || 'Sem número'}
        eyebrow="Processo"
        icon={<FileText className="w-5 h-5" />}
        size="xl"
        zIndex={70}
        footer={
          <div className="flex flex-wrap gap-3">
            {selectedProcessForView.process_code && (
              <button
                onClick={() => {
                  const cl = clientMap.get(selectedProcessForView.client_id);
                  setTimelineProcessCode(selectedProcessForView.process_code);
                  setTimelineProcessId(selectedProcessForView.id);
                  setTimelineClientName(cl?.full_name || null);
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
              className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-medium px-4 py-2.5 rounded-lg transition"
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
        }
      >

          {/* Identity strip — cliente + status + sync (com integração) */}
          <div className="px-6 sm:px-8 py-4 border-b border-[#e7e5df] dark:border-zinc-800 flex flex-wrap items-center gap-x-5 gap-y-3 bg-white dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => {
                if (selectedProcessForView.client_id) {
                  events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, {
                    module: 'clientes',
                    params: { mode: 'details', entityId: selectedProcessForView.client_id },
                  });
                }
              }}
              className="group flex items-center gap-3 min-w-0"
              title="Abrir ficha do cliente"
            >
              <div className="ring-2 ring-slate-100 rounded-full group-hover:ring-orange-200 transition">
                <ClientAvatar client={client} photoUrl={client ? clientPhotoUrls.get(client.id) : undefined} size={48} />
              </div>
              <div className="text-left min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Cliente</div>
                <div className="text-base font-bold text-slate-900 dark:text-white truncate group-hover:text-[#f97316] transition">
                  {client?.full_name || 'Cliente removido'}
                </div>
                <div className="text-[10px] text-slate-400 group-hover:text-[#f97316] transition flex items-center gap-1">
                  Ver ficha do cliente
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                </div>
              </div>
            </button>
            <span className="hidden sm:block w-px h-10 bg-slate-200" />
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadge(selectedProcessForView.status)}`}>
              {getStatusLabel(selectedProcessForView.status)}
            </span>
            {selectedProcessForView.djen_has_data && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                DJEN {formatLastSync(selectedProcessForView.djen_last_sync) ?? 'sincronizado'}
              </span>
            )}
            <span className="ml-auto text-[10px] text-slate-400 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Atualizado {formatLastSync(selectedProcessForView.updated_at) ?? formatDate(selectedProcessForView.updated_at)}
            </span>
          </div>

          <div className="p-6 sm:p-8 bg-white dark:bg-zinc-900">
            {/* Grid de dados — card unificado com células divididas */}
            <div className="rounded-2xl border border-[#e7e5df] dark:border-zinc-800 overflow-hidden mb-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-slate-100 dark:divide-zinc-800">
                {/* Campos estáticos */}
                {[
                  { label: 'Distribuído em', value: formatDate(selectedProcessForView.distributed_at) },
                  { label: 'Área', value: practiceAreaInfo ? practiceAreaInfo.label : selectedProcessForView.practice_area },
                  { label: 'Advogado responsável', value: selectedProcessForView.responsible_lawyer || 'Não informado' },
                  {
                    label: 'Audiência',
                    value: selectedProcessForView.hearing_scheduled
                      ? `${selectedProcessForView.hearing_date ? formatDate(selectedProcessForView.hearing_date) : 'Data n/d'}${selectedProcessForView.hearing_time ? ` · ${selectedProcessForView.hearing_time.slice(0, 5)}` : ''}${selectedProcessForView.hearing_mode ? ` · ${selectedProcessForView.hearing_mode === 'presencial' ? 'Presencial' : 'Online'}` : ''}`
                      : 'Não agendada',
                  },
                  { label: 'Criado em', value: formatDate(selectedProcessForView.created_at) },
                ].map((f, i) => (
                  <div key={i} className="px-5 py-4">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{f.label}</div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{f.value}</div>
                  </div>
                ))}

                {/* #5 — Vara / Comarca — editável inline */}
                <div className="px-5 py-4">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5" /> Vara / Comarca
                  </div>
                  {editingCourtFor === selectedProcessForView.id ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        autoFocus
                        value={courtDraft}
                        onChange={e => setCourtDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveCourtEdit(); if (e.key === 'Escape') setEditingCourtFor(null); }}
                        className="flex-1 text-xs border border-amber-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-[#f8f7f5]"
                        placeholder="Ex: Juizado Especial Cível - Nova Friburgo"
                      />
                      <button onClick={saveCourtEdit} disabled={savingCourt}
                        className="p-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                        {savingCourt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => setEditingCourtFor(null)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {selectedProcessForView.court || <span className="text-slate-400 italic text-xs">Não informado</span>}
                      </span>
                      <button
                        onClick={() => { setEditingCourtFor(selectedProcessForView.id); setCourtDraft(selectedProcessForView.court || ''); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                        title="Editar vara/comarca">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Partes do processo */}
            <div className="mb-6 rounded-xl border border-[#e7e5df] bg-slate-50 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Partes do Processo</span>
                </div>
                <button
                  onClick={() => loadProcessParties(selectedProcessForView.id, true, selectedProcessForView.process_code)}
                  disabled={loadingParties}
                  title="Rebuscar partes (força nova extração)"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition disabled:opacity-40"
                >
                  {loadingParties
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <RefreshCw className="w-3 h-3" />}
                  {loadingParties ? 'Buscando...' : 'Rebuscar'}
                </button>
              </div>
              {loadingParties && !processParties && (
                <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Identificando partes...
                </div>
              )}
              {!loadingParties && !processParties && (
                <div className="px-4 py-3 text-xs text-slate-400">
                  Partes não identificadas. Clique em <span className="font-semibold">Rebuscar</span> para tentar extrair das intimações.
                </div>
              )}
              {processParties && (
                <div className="divide-y divide-slate-100">
                  {processParties.polo_ativo && (
                    <div className="px-4 py-3 flex items-start gap-3">
                      <span className="mt-0.5 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0">Polo Ativo</span>
                      <span className="text-sm text-slate-800 font-medium leading-snug">{processParties.polo_ativo}</span>
                    </div>
                  )}
                  {processParties.polo_passivo && (
                    <div className="px-4 py-3 flex items-start gap-3">
                      <span className="mt-0.5 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 flex-shrink-0">Polo Passivo</span>
                      <span className="text-sm text-slate-800 font-medium leading-snug">{processParties.polo_passivo}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* #8b — Resumo IA do processo */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Resumo Inteligente</span>
                <button
                  onClick={() => generateProcessSummaryImproved(selectedProcessForView)}
                  disabled={loadingAiSummary}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition disabled:opacity-50"
                >
                  {loadingAiSummary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {loadingAiSummary ? 'Analisando...' : 'Gerar resumo IA'}
                </button>
              </div>
              {aiSummary && (
                <div className="rounded-2xl border border-slate-100 bg-[#f8f7f5] shadow-sm overflow-hidden">
                  {/* Cabeçalho do bloco */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Análise IA</span>
                  </div>
                  {/* Conteúdo parseado */}
                  <div className="px-4 py-4 space-y-4">
                    {aiSummary.split(/\n(?=\*\*)/g).map((block, bi) => {
                      const titleMatch = block.match(/^\*\*(.+?)\*\*/);
                      if (!titleMatch) {
                        // bloco sem título (introdução livre)
                        return block.trim() ? (
                          <p key={bi} className="text-xs text-slate-600 leading-relaxed">{block.trim()}</p>
                        ) : null;
                      }
                      const sectionTitle = titleMatch[1];
                      const body = block.replace(/^\*\*.+?\*\*\n?/, '').trim();
                      // Cor do badge por seção
                      const sectionColors: Record<string, string> = {
                        'Situação Atual':                   'bg-blue-50 text-blue-700 border-blue-100',
                        'Últimas Movimentações Relevantes': 'bg-amber-50 text-amber-700 border-amber-100',
                        'Pontos de Atenção':                'bg-red-50 text-red-700 border-red-100',
                        'Próximo Passo Recomendado':        'bg-emerald-50 text-emerald-700 border-emerald-100',
                      };
                      const dotColors: Record<string, string> = {
                        'Situação Atual':                   'bg-blue-400',
                        'Últimas Movimentações Relevantes': 'bg-amber-400',
                        'Pontos de Atenção':                'bg-red-400',
                        'Próximo Passo Recomendado':        'bg-emerald-400',
                      };
                      const badgeCls = sectionColors[sectionTitle] ?? 'bg-slate-50 text-slate-700 border-slate-100';
                      const dotCls  = dotColors[sectionTitle]  ?? 'bg-slate-400';
                      const bullets = body.split('\n').filter(l => l.trim());
                      return (
                        <div key={bi}>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider mb-2 ${badgeCls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                            {sectionTitle}
                          </span>
                          <div className="space-y-1.5 pl-1">
                            {bullets.map((line, li) => (
                              <p key={li} className="text-[12.5px] text-slate-700 leading-relaxed">
                                {line.replace(/^•\s*/, '').trim()
                                  ? <><span className="text-slate-300 mr-1.5">›</span>{line.replace(/^•\s*/, '').trim()}</>
                                  : null}
                              </p>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Linha do tempo</span>
                    {noteThreads.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums bg-slate-100 text-slate-500">
                        {noteThreads.length}
                      </span>
                    )}
                  </div>
                </div>
                {noteThreads.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#e7e5df] py-8 text-center">
                    <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Nenhum registro na linha do tempo ainda.</p>
                  </div>
                ) : (
                  <div className="relative">
                    {noteThreads.map((thread, idx) =>
                      renderNote(thread, 0, idx === noteThreads.length - 1),
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Seção Prescrição Execução Sobrestada */}
            <div className="mt-8 pt-6 border-t border-[#e7e5df]">
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
                        className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-[#f8f7f5] dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Motivo</label>
                      <select
                        value={stayReason}
                        onChange={(e) => setStayReason(e.target.value as 'prescricao' | 'acordo_pagamento' | 'outro')}
                        className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-[#f8f7f5] dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 text-slate-900 dark:text-white"
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
                        className="h-10 px-4 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition disabled:opacity-60"
                      >
                        {schedulingStay ? 'Analisando...' : 'IA identificar'}
                      </button>
                    </div>
                  </div>

                  {members.length > 0 && (
                    <div className="mt-3">
                      <label className="text-xs font-semibold text-slate-500 uppercase block mb-2">Responsável pelo compromisso <span className="text-red-500">*</span></label>
                      <div className="flex flex-wrap gap-2">
                        {members.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setStayResponsibleId(stayResponsibleId === (m.user_id || m.id) ? '' : (m.user_id || m.id))}
                            className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${
                              stayResponsibleId === (m.user_id || m.id)
                                ? 'ring-2 ring-offset-2 ring-amber-500'
                                : 'ring-1 ring-transparent hover:ring-slate-300'
                            }`}
                            title={m.name || m.email || ''}
                          >
                            {m.avatar_url ? (
                              <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700">
                                {(m.name || m.email || '?')[0].toUpperCase()}
                              </div>
                            )}
                            {stayResponsibleId === (m.user_id || m.id) && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 6l3 3 5-5"/>
                                </svg>
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

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

            {/* ── Assinaturas Digitais ────────────────────────────────────── */}
            <div className="mt-6 pt-6 border-t border-[#e7e5df]">
              <div className="flex items-center gap-2 mb-3">
                <PenTool className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Assinaturas Digitais</span>
                {processSignatures.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums bg-violet-100 text-violet-700">{processSignatures.length}</span>
                )}
              </div>

              {loadingSignatures ? (
                <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando assinaturas...
                </div>
              ) : processSignatures.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#e7e5df] py-5 text-center">
                  <PenTool className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Nenhuma assinatura digital vinculada a este processo.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-[#e7e5df] overflow-hidden divide-y divide-slate-100">
                  {processSignatures.map(sig => {
                    const statusCfg: Record<string, { label: string; cls: string }> = {
                      pending:   { label: 'Pendente',  cls: 'bg-amber-100 text-amber-700' },
                      signed:    { label: 'Assinado',  cls: 'bg-emerald-100 text-emerald-700' },
                      expired:   { label: 'Expirado',  cls: 'bg-red-100 text-red-600' },
                      cancelled: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500' },
                    };
                    const sc = statusCfg[sig.status] ?? { label: sig.status, cls: 'bg-slate-100 text-slate-500' };
                    return (
                      <button
                        key={sig.id}
                        onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas', params: { mode: 'details', requestId: sig.id } })}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-50/50 text-left transition-colors group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                          <PenTool className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{sig.document_name}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{new Date(sig.created_at).toLocaleDateString('pt-BR')}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.cls}`}>{sc.label}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-violet-400 transition-colors" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {processSignatures.length > 0 && (
                <button
                  onClick={() => events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'assinaturas' })}
                  className="mt-2 w-full text-center text-[11px] font-semibold text-violet-500 hover:text-violet-700 transition py-1"
                >
                  Ver todas as assinaturas →
                </button>
              )}
            </div>

          </div>
      </Modal>
    );
  })();

  // Modal de Exportação com Filtros Avançados
  const exportModal = (() => {
    if (!showExportModal) return null;
    const filteredCount = getFilteredExportProcesses().length;
    return (
      <Modal
        open
        onClose={() => setShowExportModal(false)}
        title="Exportar Processos"
        eyebrow="Exportação"
        subtitle="Configure os filtros para exportação"
        size="sm"
        footer={
          <div className="flex gap-3 w-full">
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
        }
      >
        <ModalBody>
          <div className="space-y-4">
              {/* Filtro de Status */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  📊 Status do Processo
                </label>
                <select
                  value={exportFilters.status}
                  onChange={(e) => setExportFilters({ ...exportFilters, status: e.target.value as ProcessStatus | 'todos' })}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#e7e5df] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="todos">Todos os status</option>
                  {statusOptions.map((status) => (
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
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#e7e5df] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="todas">Todas as áreas</option>
                  {practiceAreas.map((area) => (
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
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#e7e5df] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-[#e7e5df] text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="recent">Mais recentes primeiro</option>
                  <option value="oldest">Mais antigos primeiro</option>
                </select>
              </div>

              {/* Prévia */}
              <div className="bg-slate-50 border border-[#e7e5df] rounded-lg p-3">
                <p className="text-xs text-slate-600">
                  💡 <strong>Prévia:</strong> {filteredCount} processo{filteredCount !== 1 ? 's' : ''} será{filteredCount !== 1 ? 'ão' : ''} exportado{filteredCount !== 1 ? 's' : ''} com os filtros selecionados.
                </p>
              </div>

          </div>
        </ModalBody>
      </Modal>
    );
  })();

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
                    className="flex items-center justify-between gap-3 bg-[#f8f7f5]/70 rounded-lg px-3 py-2 border border-red-100"
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

      {/* KPI Strip — enterprise, clicável p/ filtrar */}
      <div className="bg-[#f8f7f5] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-slate-100">
          {[
            { key: 'todos' as const, label: 'Total', value: statusCounts.todos, icon: Building2, accent: 'text-slate-900', ring: 'ring-slate-300', bg: 'bg-slate-50/60' },
            { key: 'aguardando_confeccao' as const, label: 'Aguardando', value: statusCounts.aguardando_confeccao || 0, icon: FileText, accent: 'text-orange-600', ring: 'ring-orange-300', bg: 'bg-orange-50/50' },
            { key: 'em_andamento_macro' as const, label: 'Em Andamento', value: statusCounts.em_andamento_macro || 0, icon: Clock, accent: 'text-emerald-600', ring: 'ring-emerald-300', bg: 'bg-emerald-50/50' },
            { key: 'distribuido' as const, label: 'Distribuídos', value: statusCounts.distribuido || 0, icon: FileText, accent: 'text-slate-900', ring: 'ring-slate-300', bg: 'bg-slate-50/60' },
            { key: 'arquivado' as const, label: 'Arquivados', value: statusCounts.arquivado || 0, icon: CheckCircle2, accent: 'text-slate-900', ring: 'ring-slate-300', bg: 'bg-slate-50/60' },
          ].map((card) => {
            const active = statusFilter === card.key;
            const Icon = card.icon;
            const pct = statusCounts.todos > 0 && card.key !== 'todos'
              ? Math.round((Number(card.value) / statusCounts.todos) * 100)
              : null;
            return (
              <button
                key={card.key}
                onClick={() => setStatusFilter(card.key)}
                className={`px-4 py-4 sm:px-5 sm:py-5 text-left transition relative ${active ? card.bg : 'hover:bg-slate-50/60'}`}
                title={active ? 'Mostrar todos' : `Filtrar: ${card.label}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{card.label}</span>
                  <Icon className={`w-3.5 h-3.5 ${active ? card.accent : 'text-slate-300'}`} />
                </div>
                <div className={`text-2xl sm:text-3xl font-bold tabular-nums leading-none ${card.accent}`}>{card.value}</div>
                <div className="mt-1.5 text-[10px] text-slate-400">
                  {card.key === 'todos' ? 'processos no sistema' : pct !== null ? `${pct}% do total` : '—'}
                </div>
                {active && <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${card.accent.replace('text-', 'bg-')}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra de Sincronização DJEN — visível e acionável */}
      <div className="bg-[#f8f7f5] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${syncingDjen ? 'bg-blue-100 text-blue-600' : djenStats.withData > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
            <RefreshCw className={`w-4 h-4 ${syncingDjen ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900">Sincronização DJEN</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Automático
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {syncingDjen ? (
                'Consultando o Diário de Justiça Eletrônico Nacional…'
              ) : djenSyncResult ? (
                <span className="text-emerald-700 font-medium">
                  {djenSyncResult.updated} com novidades · {djenSyncResult.synced} sincronizados de {djenSyncResult.total}
                </span>
              ) : (
                <>
                  <strong className="text-slate-700 tabular-nums">{djenStats.synced}</strong>/{djenStats.tracked} sincronizados
                  {djenStats.withData > 0 && <> · <strong className="text-emerald-700 tabular-nums">{djenStats.withData}</strong> com andamentos</>}
                  {djenStats.lastSync && <> · última: {formatLastSync(djenStats.lastSync) ?? '—'}</>}
                  {' · '}auto a cada 1h + cron 03h
                </>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleManualDjenSync}
          disabled={syncingDjen}
          className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white text-xs font-semibold transition"
        >
          {syncingDjen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {syncingDjen ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>

      {/* Seção Aguardando Confecção - Compacta */}
      {statusFilter === 'todos' && (
        <div className="bg-[#f8f7f5] rounded-2xl border border-[#e7e5df] shadow-sm overflow-hidden">
          {/* Header com botão de adicionar inline */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Aguardando Confecção</h3>
                <p className="text-[11px] text-slate-500">
                  <strong className="text-orange-600 font-semibold tabular-nums">{processesByStatus.aguardando_confeccao.length}</strong> no fluxo de protocolo
                </p>
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
                  <div className="absolute z-10 w-full mt-1 bg-white border border-[#e7e5df] rounded-lg shadow-lg max-h-40 overflow-y-auto">
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
                {practiceAreas.map((area) => (
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
                    <ClientAvatar client={client} photoUrl={client ? clientPhotoUrls.get(client.id) : undefined} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{client?.full_name || 'Cliente não informado'}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-slate-500">{process.practice_area ? practiceAreas.find(p => p.key === process.practice_area)?.label : 'Área não definida'}</p>
                        {process.priority === 'urgente' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800 border border-red-200 shadow-sm">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Urgente
                          </span>
                        )}
                      </div>
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

      <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-slate-100">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setKanbanMode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!kanbanMode ? 'bg-[#f8f7f5] text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </button>
            <button
              onClick={() => setKanbanMode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${kanbanMode ? 'bg-[#f8f7f5] text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 border border-[#e7e5df] hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
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
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 border border-[#e7e5df] hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
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

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 px-4 py-3 bg-slate-50/40 border-b border-slate-100 dark:bg-zinc-900/40 dark:border-zinc-800">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 rounded-xl text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400 transition-shadow"
              placeholder="Buscar por cliente, processo, vara…"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ProcessStatusFilter)}
              className="px-3 py-2 bg-white dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 rounded-xl text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400 transition-shadow"
            >
              <option value="todos">Todos os status</option>
              <option value="em_andamento_macro">Em andamento (geral)</option>
              {statusOptions.map((status) => (
                <option key={status.key} value={status.key}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4">

          {showSkeleton ? (
            <ProcessesSkeleton kanban={kanbanMode} />
          ) : filteredProcesses.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                <Search className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Nenhum processo encontrado</p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Tente ajustar os filtros ou o termo de busca</p>
              </div>
            </div>
          ) : kanbanMode ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto">
              {statusOptions.map((statusOption) => {
                const processesInColumn = processesByStatus[statusOption.key] || [];
                return (
                  <div key={statusOption.key} className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden flex flex-col">
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
                            className="bg-[#f8f7f5] dark:bg-zinc-900 border border-[#e7e5df] dark:border-zinc-700 rounded-xl p-3 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] active:shadow-sm transition-all duration-150 cursor-pointer"
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
                                <ClientAvatar client={client} photoUrl={client ? clientPhotoUrls.get(client.id) : undefined} size={32} />
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
                                {statusOptions.map((opt) => (
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
            <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]">
              <div className="block lg:hidden divide-y divide-[#e7e5df]">
                {filteredProcesses.map((process) => {
                  const client = clientMap.get(process.client_id);
                  return (
                    <div key={process.id} className="p-3 sm:p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-3">
                        <ClientAvatar client={client} photoUrl={client ? clientPhotoUrls.get(client.id) : undefined} size={40} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="text-xs sm:text-sm font-medium text-gray-900 truncate">{client?.full_name || 'Cliente removido'}</div>
                            {/* #6 — Badge não lidas */}
                            {processesWithUnread.has(process.id) && (
                              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-orange-500 ring-2 ring-white" title="Intimações não lidas" />
                            )}
                          </div>
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
                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 active:scale-95 transition-all duration-150 text-sm font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          Ver
                        </button>
                        <button
                          onClick={() => handleOpenModal(process)}
                          className="px-3 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 active:scale-95 transition-all duration-150"
                          title="Editar processo"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteProcess(process.id)} className="px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 active:scale-95 transition-all duration-150" title="Excluir processo">
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
              <div className="hidden lg:block overflow-x-auto w-full">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/60 border-b border-[#e7e5df]">
                    <tr>
                      <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[180px]">Cliente</th>
                      <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[200px]">Código do Processo</th>
                      <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[100px]">Distribuído</th>
                      <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[160px]">Status</th>
                      <th className="px-3 py-3.5 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest w-[150px]">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#f8f7f5] divide-y divide-[#e7e5df]">
                    {filteredProcesses.map((process) => {
                      const client = clientMap.get(process.client_id);
                      const isTimelineExpanded = expandedTimelineProcessId === process.id;
                      return (
                        <React.Fragment key={process.id}>
                          <tr
                            className={`row-enter hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors duration-100 cursor-pointer group ${isTimelineExpanded ? 'bg-slate-50 dark:bg-zinc-800/30' : ''}`}
                            onClick={() => {
                              if (process.process_code) {
                                setExpandedTimelineProcessId(isTimelineExpanded ? null : process.id);
                              }
                            }}
                          >
                            <td className="px-6 py-3 max-w-[220px]">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <ClientAvatar client={client} photoUrl={client ? clientPhotoUrls.get(client.id) : undefined} size={34} />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate leading-tight" title={client?.full_name || 'Cliente removido'}>
                                    {client?.full_name || 'Cliente removido'}
                                  </div>
                                  <div className="flex items-center gap-1 mt-0.5 min-w-0">
                                    <span className="text-[11px] text-gray-400 shrink-0 truncate max-w-[80px]" title={practiceAreas.find((area) => area.key === process.practice_area)?.label ?? process.practice_area ?? ''}>
                                      {practiceAreas.find((area) => area.key === process.practice_area)?.label ?? process.practice_area}
                                    </span>
                                    {process.responsible_lawyer && (
                                      <>
                                        <span className="text-gray-300 shrink-0">·</span>
                                        <span className="text-[11px] text-gray-400 truncate min-w-0" title={process.responsible_lawyer}>
                                          {process.responsible_lawyer}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 max-w-[240px]">
                              {/* Linha 1: número + badge nova intimação */}
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="text-[13px] font-mono text-gray-900 truncate min-w-0">{process.process_code}</div>
                                {processesWithUnread.has(process.id) && (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-semibold" title="Intimações não lidas">
                                    <Bell className="w-2.5 h-2.5" />Nova
                                  </span>
                                )}
                              </div>
                              {/* Linha 2: vara · DJEN · sync */}
                              <div className="flex items-center gap-1 mt-0.5 min-w-0">
                                {process.court && (
                                  <span className="text-[11px] text-gray-400 truncate min-w-0" title={process.court}>
                                    {process.court}
                                  </span>
                                )}
                                {process.djen_has_data && (
                                  <>
                                    {process.court && <span className="text-gray-300 shrink-0">·</span>}
                                    <span className="shrink-0 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-100/80" title="Dados sincronizados com DJEN">
                                      DJEN
                                    </span>
                                    {formatLastSync(process.djen_last_sync) && (
                                      <span className="shrink-0 text-[11px] text-slate-400" title={`Última sincronização: ${process.djen_last_sync}`}>
                                        {formatLastSync(process.djen_last_sync)}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-3 whitespace-nowrap text-xs text-gray-500">{formatDate(process.distributed_at)}</td>
                            <td className="px-6 py-3 whitespace-nowrap">
                              <span className={`px-2.5 py-0.5 inline-flex text-[11px] leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>{getStatusLabel(process.status)}</span>
                            </td>
                            <td className="px-3 py-3 w-[150px] shrink-0" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-0.5">
                                {process.process_code && (
                                  <button
                                    onClick={() => setExpandedTimelineProcessId(isTimelineExpanded ? null : process.id)}
                                    className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-amber-400/50 ${isTimelineExpanded ? 'text-orange-500 bg-orange-50' : 'text-slate-300 hover:text-orange-500 hover:bg-orange-50'}`}
                                    title={isTimelineExpanded ? 'Recolher Timeline' : 'Expandir Timeline'}
                                  >
                                    {isTimelineExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                                <button onClick={() => handleViewProcess(process)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-blue-400/50" title="Ver detalhes">
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleOpenModal(process)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-amber-400/50" title="Editar processo">
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleDeleteProcess(process.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-red-400/50" title="Excluir processo">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {/* Timeline Inline Expansível - Desktop */}
                          {isTimelineExpanded && process.process_code && (
                            <tr className="bg-slate-50">
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

      <Modal
        open={showStageMapModal}
        onClose={() => setShowStageMapModal(false)}
        title="Mapa de Fases"
        eyebrow="Visão geral"
        subtitle="Clique em uma fase para ver os processos"
        icon={<Clock className="w-5 h-5" />}
        size="xl"
      >

              <div className="p-4 border-b border-slate-100 bg-[#f8f7f5]">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {statusOptions.map((statusOption) => {
                    const count = (processesByStatus[statusOption.key] || []).length;
                    const isActive = stageMapSelectedStatus === statusOption.key;
                    return (
                      <button
                        key={statusOption.key}
                        type="button"
                        onClick={() => setStageMapSelectedStatus(statusOption.key)}
                        className={`text-left border rounded-xl px-3 py-3 transition ${isActive ? 'border-amber-500 bg-amber-50' : 'border-[#e7e5df] hover:bg-slate-50'}`}
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
                    <div className="p-4 border-b border-slate-100 bg-[#f8f7f5]">
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            value={stageMapSearch}
                            onChange={(e) => setStageMapSearch(e.target.value)}
                            placeholder="Buscar processos nesta fase..."
                            className="w-full pl-9 pr-3 py-2 bg-white border border-[#e7e5df] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                            autoFocus
                          />
                        </div>
                        <div className="text-xs font-medium text-slate-600 px-3 py-2 rounded-lg bg-slate-50 border border-[#e7e5df]">
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
      </Modal>

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
                const override = timelineProcessId
                  ? { processId: timelineProcessId, status: newStatus as ProcessStatus }
                  : undefined;
                // Atualiza badge imediatamente (antes do reload para não piscar)
                if (override && selectedProcessForView?.id === timelineProcessId) {
                  setSelectedProcessForView(prev =>
                    prev ? { ...prev, status: newStatus as ProcessStatus } : prev
                  );
                }
                // Recarrega lista preservando o novo status (evita race com dado antigo do banco)
                handleReload(override);
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
