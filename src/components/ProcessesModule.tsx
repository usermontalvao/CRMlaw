import React, { useEffect, useMemo, useState } from 'react';
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
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { djenService } from '../services/djen.service';
import { processDjenSyncService } from '../services/processDjenSync.service';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useAuth } from '../contexts/AuthContext';
import type { Process, ProcessStatus, ProcessPracticeArea, HearingMode } from '../types/process.types';
import type { Client } from '../types/client.types';
import type { Profile } from '../services/profile.service';

const STATUS_OPTIONS: { key: ProcessStatus; label: string; badge: string }[] = [
  { key: 'nao_protocolado', label: 'Não Protocolado', badge: 'bg-slate-100 text-slate-700' },
  { key: 'distribuido', label: 'Distribuído', badge: 'bg-amber-100 text-amber-700' },
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção', badge: 'bg-blue-100 text-blue-700' },
  { key: 'andamento', label: 'Em Andamento', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'sentenca', label: 'Sentença', badge: 'bg-purple-100 text-purple-700' },
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
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Data inválida';
    return parsed.toLocaleDateString('pt-BR');
  } catch (error) {
    console.error('Erro ao formatar data:', value, error);
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

const formatDateTime = (value: string) => {
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Data inválida';
    return parsed.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    console.error('Erro ao formatar data/hora:', value, error);
    return 'Data inválida';
  }
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
  };
  onParamConsumed?: () => void;
}

const ProcessesModule: React.FC<ProcessesModuleProps> = ({ forceCreate, entityId, prefillData, onParamConsumed }) => {
  const { user } = useAuth();
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
  const [syncingDjen, setSyncingDjen] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; synced: number; updated: number; errors: number; intimationsFound: number } | null>(null);

  // Timeline
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [analyzingTimeline, setAnalyzingTimeline] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [expandedTimelineEvents, setExpandedTimelineEvents] = useState<Set<string>>(new Set());

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

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

  const allClientsMap = useMemo(() => new Map(allClients.map((c) => [c.id, c])), [allClients]);

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
    if (!confirm('Deseja realmente remover este processo? Essa ação é irreversível.')) return;

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

  const handleBackToList = () => {
    setSelectedProcessForView(null);
    setViewMode('list');
    setNoteDraft('');
    setNoteError(null);
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
    if (!confirm('Tem certeza que deseja excluir esta nota? Esta ação não pode ser desfeita.')) return;

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

  const loadTimeline = async (processCode: string) => {
    try {
      setLoadingTimeline(true);
      setTimelineError(null);
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

  const handleSyncAllDjen = async () => {
    if (syncingDjen) return;

    try {
      setSyncingDjen(true);
      setSyncResult(null);

      const pendingProcesses = processes.filter(
        (p) => !p.djen_synced || (p.djen_synced && !p.djen_has_data),
      );

      if (pendingProcesses.length === 0) {
        setSyncResult({ total: 0, synced: 0, updated: 0, errors: 0, intimationsFound: 0 });
        return;
      }

      let synced = 0;
      let updated = 0;
      let errors = 0;
      let intimationsFound = 0;

      for (const process of pendingProcesses) {
        try {
          const result = await processDjenSyncService.syncProcessWithDjen(process);

          if (result.success) {
            synced++;
            if (result.updated) {
              updated++;
            }
            if (result.intimationsCount) {
              intimationsFound += result.intimationsCount;
            }
          } else {
            errors++;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch {
          errors++;
        }
      }

      setSyncResult({
        total: pendingProcesses.length,
        synced,
        updated,
        errors,
        intimationsFound,
      });

      await handleReload();
    } catch (err: any) {
      console.error('Erro na sincronização em massa:', err);
      setError(err.message || 'Erro ao sincronizar processos com DJEN.');
    } finally {
      setSyncingDjen(false);
    }
  };

  const handleExportExcel = async () => {
    if (!processes.length) {
      alert('Não há processos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      const excelData = processes.map((process) => {
        const client = clientMap.get(process.client_id);
        const lawyer = process.responsible_lawyer_id ? memberMap.get(process.responsible_lawyer_id) : null;

        return {
          'Código do Processo': process.process_code,
          Cliente: client?.full_name || 'Cliente removido',
          'CPF/CNPJ': client?.cpf_cnpj || '',
          Email: client?.email || '',
          Telefone: client?.phone || '',
          Celular: client?.mobile || '',
          Status: getStatusLabel(process.status),
          Área: getPracticeAreaLabel(process.practice_area),
          'Distribuído em': formatDate(process.distributed_at),
          'Vara/Comarca': process.court || '',
          'Advogado Responsável': lawyer?.name || process.responsible_lawyer || '',
          'Audiência Agendada': process.hearing_scheduled ? 'Sim' : 'Não',
          'Data da Audiência': process.hearing_date ? formatDate(process.hearing_date) : '',
          'Horário da Audiência': process.hearing_time || '',
          'Modo da Audiência': process.hearing_mode ? HEARING_MODE_LABELS[process.hearing_mode] : '',
          'Criado em': process.created_at ? new Date(process.created_at).toLocaleDateString('pt-BR') : '',
          'Atualizado em': process.updated_at ? new Date(process.updated_at).toLocaleDateString('pt-BR') : '',
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 20 },
        { wch: 30 },
        { wch: 15 },
        { wch: 25 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 20 },
        { wch: 20 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 12 },
        { wch: 12 },
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Processos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const filename = `processos_${dateSlug}.xlsx`;

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
      andamento: [],
      sentenca: [],
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
    'w-full h-10 px-3 rounded-lg text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors';
  const labelStyle = 'block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5';

  const processModal = isModalOpen && (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
            {selectedProcess ? 'Editar Processo' : 'Novo Processo'}
          </h1>
          <button
            onClick={handleCloseModal}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
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

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div className="grid grid-cols-2 gap-4">
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

            <div>
              <label className={labelStyle}>Advogado Responsável</label>
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

            <div className="grid grid-cols-4 gap-4">
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
                </>
              )}
            </div>

            <div>
              <label className={labelStyle}>Observações</label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleFormChange('notes', e.target.value)}
                className={`${inputStyle} h-20 resize-none`}
                placeholder="Notas internas..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={saving}
              className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (viewMode === 'details' && selectedProcessForView) {
    const client = clientMap.get(selectedProcessForView.client_id);
    const practiceAreaInfo = PRACTICE_AREAS.find((area) => area.key === selectedProcessForView.practice_area);
    const noteCount = detailNotes.length;

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Detalhes do Processo</h3>
              <p className="text-sm text-slate-600 mt-1">Consulte rapidamente os dados principais e o histórico de anotações.</p>
            </div>
            <button onClick={handleBackToList} className="text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-2">
              ← Voltar para lista
            </button>
          </div>

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
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">✓ Sincronizado</span>
                ) : null}
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

          <div className="flex flex-wrap gap-3 mt-8 pt-6 border-t border-gray-200">
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

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h4 className="text-base font-semibold text-slate-900">Adicionar nota</h4>
          <div className="mt-4 space-y-3">
            {noteError && <p className="text-sm text-red-600">{noteError}</p>}
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={4}
              className="input-field"
              placeholder="Ex: Cliente enviou documentos complementares em 04/10."
            />
            <div className="flex justify-end">
              <button
                onClick={handleAddNote}
                disabled={addingNote}
                className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-2.5 rounded-lg transition disabled:opacity-60"
              >
                {addingNote && <Loader2 className="w-4 h-4 animate-spin" />}
                {addingNote ? 'Salvando nota...' : 'Adicionar nota'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-slate-900">Linha do Tempo</h4>
                  <p className="text-xs text-slate-600">Publicações do Diário de Justiça (DJEN)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {timeline.length > 0 && !timeline.some((e) => e.aiAnalysis) && (
                  <button
                    onClick={analyzeTimelineWithAI}
                    disabled={analyzingTimeline}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-60"
                  >
                    {analyzingTimeline ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Analisando {analyzeProgress.current}/{analyzeProgress.total}...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Analisar com IA</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => loadTimeline(selectedProcessForView.process_code)}
                  disabled={loadingTimeline}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition disabled:opacity-60"
                >
                  {loadingTimeline ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  <span className="hidden sm:inline">Atualizar</span>
                </button>
              </div>
            </div>
          </div>

          <div className="p-6">
            {loadingTimeline ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
                <p className="text-slate-600">Buscando publicações no DJEN...</p>
              </div>
            ) : timelineError ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600" />
                </div>
                <p className="text-slate-600">{timelineError}</p>
              </div>
            ) : timeline.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Clock className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-slate-600">Nenhuma publicação encontrada</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
                <div className="space-y-4">
                  {timeline.map((event) => {
                    const isExpanded = expandedTimelineEvents.has(event.id);
                    const hasAnalysis = !!event.aiAnalysis;
                    return (
                      <div key={event.id} className="relative pl-10">
                        <div
                          className={`absolute left-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            hasAnalysis && event.aiAnalysis?.urgency === 'critica'
                              ? 'bg-red-500 text-white'
                              : hasAnalysis && event.aiAnalysis?.urgency === 'alta'
                              ? 'bg-orange-500 text-white'
                              : 'bg-blue-500 text-white'
                          }`}
                        >
                          {getEventTypeIcon(event.type)}
                        </div>
                        <div className={`border rounded-lg overflow-hidden transition-all ${hasAnalysis ? `border-l-4 ${getUrgencyColor(event.aiAnalysis?.urgency)}` : 'border-slate-200'}`}>
                          <button
                            onClick={() => toggleTimelineEvent(event.id)}
                            className="w-full px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 transition text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium text-blue-600">{new Date(event.date).toLocaleDateString('pt-BR')}</span>
                                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{event.type}</span>
                              </div>
                              <p className="text-sm font-medium text-slate-900 mt-1 truncate">{hasAnalysis ? event.aiAnalysis?.summary : event.title}</p>
                              <p className="text-xs text-slate-500 mt-0.5">{event.orgao}</p>
                            </div>
                            {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />}
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-slate-100">
                              {hasAnalysis && event.aiAnalysis?.keyPoints && event.aiAnalysis.keyPoints.length > 0 && (
                                <div className="mt-3 p-3 bg-purple-50 rounded-lg">
                                  <p className="text-xs font-semibold text-purple-800 mb-2 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> Análise da IA
                                  </p>
                                  <ul className="space-y-1">
                                    {event.aiAnalysis.keyPoints.map((point, i) => (
                                      <li key={i} className="text-xs text-purple-700 flex items-start gap-2">
                                        <span className="text-purple-400">•</span>
                                        {point}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <div className="mt-3">
                                <p className="text-xs font-semibold text-slate-500 mb-1">Texto completo:</p>
                                <p className="text-xs text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto bg-slate-50 p-3 rounded">{event.description || 'Conteúdo não disponível'}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {processModal}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestão de Processos</h1>
          <p className="text-sm text-slate-500">Cadastre e acompanhe todos os processos jurídicos</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setStatusFilter('todos')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${statusFilter === 'todos' ? 'ring-2 ring-amber-500 bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}
        >
          <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{statusCounts.todos}</p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('andamento')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${statusFilter === 'andamento' ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}
        >
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{statusCounts.andamento || 0}</p>
            <p className="text-xs text-slate-500">Em Andamento</p>
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('distribuido')}
          className={`flex items-center gap-3 p-4 rounded-xl transition-all hover:shadow-md border ${statusFilter === 'distribuido' ? 'ring-2 ring-purple-500 bg-purple-50 border-purple-200' : 'bg-white border-slate-200'}`}
        >
          <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{statusCounts.distribuido || 0}</p>
            <p className="text-xs text-slate-500">Distribuídos</p>
          </div>
        </button>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <p className="text-2xl font-bold text-slate-900">{statusCounts.arquivado || 0}</p>
            <p className="text-xs text-slate-500">Arquivados</p>
          </div>
        </div>
      </div>

      {syncResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm ${syncResult.errors > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
          {syncResult.errors > 0 ? <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <p className="font-semibold mb-1">Sincronização DJEN concluída</p>
            {syncResult.total === 0 ? (
              <p>Todos os processos já estão sincronizados!</p>
            ) : (
              <div className="space-y-1">
                <p>
                  <span className="font-medium">{syncResult.synced}</span> de <span className="font-medium">{syncResult.total}</span> processos verificados
                </p>
                {syncResult.updated > 0 && <p className="text-green-700">✓ {syncResult.updated} processos atualizados</p>}
                {syncResult.errors > 0 && <p className="text-red-600">⚠ {syncResult.errors} erros</p>}
              </div>
            )}
          </div>
          <button onClick={() => setSyncResult(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
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

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncAllDjen}
              disabled={syncingDjen || pendingDjenCount === 0}
              className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${pendingDjenCount > 0 ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-slate-200 text-slate-400'}`}
            >
              {syncingDjen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Sync DJEN
              {pendingDjenCount > 0 && !syncingDjen && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{pendingDjenCount}</span>
              )}
            </button>
            <button
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-all"
            >
              {exportingExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              Exportar
            </button>
            <button onClick={() => handleOpenModal()} className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              Novo Processo
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
          {error && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4">
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
                          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors text-sm font-medium"
                        >
                          <Edit2 className="w-4 h-4" />
                          Editar
                        </button>
                        <button onClick={() => handleDeleteProcess(process.id)} className="px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
                      return (
                        <tr key={process.id} className="hover:bg-gray-50 transition-colors">
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
                                <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full" title="Dados sincronizados com DJEN">
                                  ✓ DJEN
                                </span>
                              )}
                            </div>
                            {process.court && <div className="text-xs text-gray-500 mt-1">{process.court}</div>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatDate(process.distributed_at)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>{getStatusLabel(process.status)}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex items-center justify-end gap-2">
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
    </div>
  );
};

export default ProcessesModule;
