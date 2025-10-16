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
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { profileService } from '../services/profile.service';
import { djenService } from '../services/djen.service';
import { processDjenSyncService } from '../services/processDjenSync.service';
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
  } catch (error) {
    // Mantém compatibilidade com notas antigas
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

  const filteredProcesses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const baseList =
      statusFilter === 'todos'
        ? processes
        : processes.filter((process) => process.status === statusFilter);

    if (!term) return baseList;

    return baseList.filter((process) => {
      const client = clientMap.get(process.client_id);
      const responsibleProfile = resolveResponsibleLawyer(process);
      const lawyerName = responsibleProfile?.name;
      const composite = [
        process.process_code,
        process.court,
        lawyerName,
        client?.full_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return composite.includes(term);
    });
  }, [processes, statusFilter, searchTerm, clientMap, members]);

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
      
      // Aplicar prefill se fornecido
      if (prefillData) {
        setFormData(prev => ({
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
      const process = processes.find(p => p.id === entityId);
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
    console.log('=== ABRINDO MODAL ===');
    console.log('Processo:', process?.id);
    console.log('Modo:', process ? 'EDITAR' : 'CRIAR');
    
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
      console.log('FormData preenchido:', {
        process_code: process.process_code,
        client_id: process.client_id,
      });
    } else {
      setSelectedProcess(null);
      setFormData(emptyForm);
      setClientSearchTerm('');
      console.log('FormData limpo para novo processo');
    }

    setIsModalOpen(true);
    console.log('Modal aberto: isModalOpen = true');
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedProcess(null);
    setFormData(emptyForm);
    setClientSearchTerm('');
    setDjenData(null); // Limpar dados do DJEN
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

  // Buscar dados do processo no DJEN
  const handleSearchDjen = async () => {
    const processNumber = formData.process_code.replace(/\D/g, '');
    
    console.log('=== BUSCA DJEN ===');
    console.log('Número digitado:', formData.process_code);
    console.log('Número limpo:', processNumber);
    console.log('Tamanho:', processNumber.length);
    
    if (processNumber.length < 20) {
      setError('Número do processo inválido. Deve ter 20 dígitos.');
      return;
    }

    try {
      setSearchingDjen(true);
      setError(null);
      
      // Extrair ano do número do processo (posições 9-12)
      // Formato: NNNNNNN-DD.AAAA.J.TT.OOOO
      const yearMatch = formData.process_code.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;
      
      console.log('Ano extraído do processo:', year);
      
      // Se tiver ano, buscar desde o início do ano
      const searchParams: any = {
        numeroProcesso: processNumber,
        itensPorPagina: 100, // Aumentar para pegar mais resultados
      };
      
      if (year) {
        searchParams.dataDisponibilizacaoInicio = `${year}-01-01`;
        console.log('Buscando desde:', searchParams.dataDisponibilizacaoInicio);
      }
      
      console.log('Iniciando busca no DJEN com parâmetros:', searchParams);
      
      const response = await djenService.consultarComunicacoes(searchParams);

      console.log('Resposta DJEN:', response);
      console.log('Status:', response.status);
      console.log('Count:', response.count);
      console.log('Items:', response.items?.length || 0);

      if (response.items && response.items.length > 0) {
        const firstItem = response.items[0];
        console.log('Primeiro item:', firstItem);
        
        setDjenData(firstItem);
        
        // Preencher dados automaticamente
        setFormData(prev => ({
          ...prev,
          court: firstItem.nomeOrgao || prev.court,
          practice_area: mapClasseToArea(firstItem.nomeClasse) || prev.practice_area,
        }));
        
        console.log('Dados preenchidos - Vara:', firstItem.nomeOrgao);
        console.log('Dados preenchidos - Classe:', firstItem.nomeClasse);
        
        // Buscar partes envolvidas
        if (firstItem.destinatarios && firstItem.destinatarios.length > 0) {
          const partes = firstItem.destinatarios.map(d => `${d.nome} (${d.polo})`).join(', ');
          console.log('Partes envolvidas:', partes);
        }
      } else {
        console.log('Nenhum item encontrado na resposta');
        setError('Nenhuma comunicação encontrada no DJEN para este processo. Possíveis motivos: processo muito recente, sem publicações ainda, ou tribunal não integrado ao DJEN.');
        
        // Mostrar mensagem informativa mesmo sem dados
        setDjenData({
          _noData: true,
          message: 'Processo consultado mas sem comunicações no DJEN',
        });
      }
    } catch (err: any) {
      console.error('=== ERRO DJEN ===');
      console.error('Tipo:', err.constructor.name);
      console.error('Mensagem:', err.message);
      console.error('Stack:', err.stack);
      console.error('Erro completo:', err);
      setError(`Erro ao buscar dados no DJEN: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setSearchingDjen(false);
      console.log('=== FIM BUSCA DJEN ===');
    }
  };

  // Mapear classe do processo para área de atuação
  const mapClasseToArea = (nomeClasse?: string): ProcessPracticeArea | undefined => {
    if (!nomeClasse) return undefined;
    
    const classe = nomeClasse.toLowerCase();
    
    if (classe.includes('trabalh')) return 'trabalhista';
    if (classe.includes('cível') || classe.includes('civil')) return 'civel';
    if (classe.includes('família') || classe.includes('familia')) return 'familia';
    if (classe.includes('previdenc')) return 'previdenciario';
    if (classe.includes('consumidor')) return 'consumidor';
    
    // Padrão para casos não mapeados
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

      const responsibleMember = formData.responsible_lawyer_id
        ? memberMap.get(formData.responsible_lawyer_id)
        : null;

      // Preencher data de distribuição automaticamente se não foi informada
      let distributedAt = formData.distributed_at;
      if (!distributedAt && trimmedProcessCode) {
        const autoDate = processDjenSyncService.extractDistributedDate(trimmedProcessCode);
        if (autoDate) {
          distributedAt = autoDate;
          console.log('Data de distribuição extraída automaticamente:', autoDate);
        }
      }

      // Converter data de distribuição com validação
      let distributedAtISO: string | null = null;
      if (distributedAt) {
        try {
          const dateObj = new Date(distributedAt);
          if (!Number.isNaN(dateObj.getTime())) {
            distributedAtISO = dateObj.toISOString();
          } else {
            console.error('Data de distribuição inválida:', distributedAt);
          }
        } catch (error) {
          console.error('Erro ao converter data de distribuição:', distributedAt, error);
        }
      }

      // Marcar como sincronizado se tiver dados do DJEN
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
        
        // Buscar dados no DJEN automaticamente após criar
        if (newProcess && trimmedProcessCode) {
          console.log('Iniciando sincronização automática com DJEN...');
          processDjenSyncService.syncProcessWithDjen(newProcess as Process)
            .then(result => {
              if (result.updated) {
                console.log('Processo atualizado com dados do DJEN!');
                handleReload(); // Recarregar para mostrar dados atualizados
              } else {
                console.log('DJEN consultado, mas sem dados para preencher');
              }
            })
            .catch(err => console.error('Erro na sincronização automática:', err));
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
      const updatedNotes = existingNotes.filter(note => note.id !== noteId);
      const serialized = serializeNotes(updatedNotes);
      await processService.updateProcess(selectedProcessForView.id, { notes: serialized });

      const refreshed = await processService.getProcessById(selectedProcessForView.id);
      if (refreshed) {
        setSelectedProcessForView(refreshed);
        setProcesses((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }
    } catch (err: any) {
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

  const handleExportExcel = async () => {
    if (!processes.length) {
      alert('Não há processos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      // Preparar dados para Excel
      const excelData = processes.map((process) => {
        const client = clientMap.get(process.client_id);
        const lawyer = process.responsible_lawyer_id ? memberMap.get(process.responsible_lawyer_id) : null;

        return {
          'Código do Processo': process.process_code,
          'Cliente': client?.full_name || 'Cliente removido',
          'CPF/CNPJ': client?.cpf_cnpj || '',
          'Email': client?.email || '',
          'Telefone': client?.phone || '',
          'Celular': client?.mobile || '',
          'Status': getStatusLabel(process.status),
          'Área': getPracticeAreaLabel(process.practice_area),
          'Distribuído em': formatDate(process.distributed_at),
          'Vara/Comarca': process.court || '',
          'Advogado Responsável': lawyer?.avatar_url || process.responsible_lawyer || '',
          'Audiência Agendada': process.hearing_scheduled ? 'Sim' : 'Não',
          'Data da Audiência': process.hearing_date ? formatDate(process.hearing_date) : '',
          'Horário da Audiência': process.hearing_time || '',
          'Modo da Audiência': process.hearing_mode ? HEARING_MODE_LABELS[process.hearing_mode] : '',
          'Criado em': process.created_at ? new Date(process.created_at).toLocaleDateString('pt-BR') : '',
          'Atualizado em': process.updated_at ? new Date(process.updated_at).toLocaleDateString('pt-BR') : '',
        };
      });

      // Criar workbook e worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Configurar larguras das colunas
      const colWidths = [
        { wch: 20 }, // Código do Processo
        { wch: 30 }, // Cliente
        { wch: 15 }, // CPF/CNPJ
        { wch: 25 }, // Email
        { wch: 15 }, // Telefone
        { wch: 15 }, // Celular
        { wch: 15 }, // Status
        { wch: 15 }, // Área
        { wch: 15 }, // Distribuído em
        { wch: 20 }, // Vara/Comarca
        { wch: 20 }, // Advogado Responsável
        { wch: 15 }, // Audiência Agendada
        { wch: 15 }, // Data da Audiência
        { wch: 15 }, // Horário da Audiência
        { wch: 15 }, // Modo da Audiência
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;

      // Adicionar worksheet ao workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Processos');

      // Gerar arquivo e fazer download
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

        {note.replies && note.replies.map(reply => renderNote(reply, depth + 1))}
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

  const noteThreads = useMemo(() => {
    if (!selectedProcessForView) return [];
    return buildNoteThreads(parseNotes(selectedProcessForView.notes));
  }, [selectedProcessForView]);

  const processModal =
    isModalOpen && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-2xl max-w-full sm:max-w-3xl w-full my-4 sm:my-8 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
          <div className="px-3 sm:px-6 py-2 sm:py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                {selectedProcess ? 'Editar Processo' : 'Novo Processo'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 hidden sm:block">
                Vincule o processo a um cliente e defina o status atual.
              </p>
            </div>
            <button
              onClick={handleCloseModal}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-3 sm:p-6 space-y-3 sm:space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Cliente *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={clientSearchTerm}
                    onChange={(event) => {
                      const value = event.target.value;
                      setClientSearchTerm(value);
                      if (!value) {
                        handleFormChange('client_id', '');
                      }
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowClientSuggestions(false), 150)}
                    placeholder="Digite para buscar clientes"
                    className={`input-field ${formData.client_id ? 'border-emerald-400 bg-emerald-50/50' : ''}`}
                  />
                  {clientsLoading && (
                    <Loader2 className="w-4 h-4 text-amber-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                  )}
                  {showClientSuggestions && (
                    <div className="absolute mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto z-10">
                      {clientsLoading ? (
                        <div className="px-4 py-3 text-sm text-slate-500">Buscando clientes...</div>
                      ) : clients.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Nenhum cliente encontrado.</div>
                      ) : (
                        clients.map((client) => (
                          <button
                            type="button"
                            key={client.id}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-amber-50 transition ${
                              client.id === formData.client_id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'
                            }`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              handleFormChange('client_id', client.id);
                              setClientSearchTerm(client.full_name);
                              setShowClientSuggestions(false);
                            }}
                          >
                            <div className="font-semibold flex items-center gap-2">
                              {client.client_type === 'pessoa_fisica' ? (
                                <User className="w-4 h-4 text-blue-500" />
                              ) : (
                                <Building2 className="w-4 h-4 text-purple-500" />
                              )}
                              {client.full_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {client.cpf_cnpj || 'CPF/CNPJ não informado'} • {client.email || 'Sem e-mail'}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.client_id === '' && (
                  <p className="text-xs text-slate-500">Selecione um cliente para vincular ao processo.</p>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-700">Código do Processo *</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={formData.process_code}
                    onChange={(event) => handleFormChange('process_code', event.target.value)}
                    className="input-field flex-1"
                    placeholder="Ex: 0001234-56.2024.8.26.0100"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleSearchDjen}
                    disabled={searchingDjen || formData.process_code.replace(/\D/g, '').length < 20}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap sm:w-auto w-full text-xs sm:text-sm"
                  >
                    {searchingDjen ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Buscando...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Buscar DJEN</span>
                      </>
                    )}
                  </button>
                </div>
                {djenData && (
                  <div className={`mt-2 p-3 rounded-lg text-sm ${
                    djenData._noData 
                      ? 'bg-yellow-50 border border-yellow-200' 
                      : 'bg-green-50 border border-green-200'
                  }`}>
                    {djenData._noData ? (
                      <>
                        <p className="font-semibold text-yellow-800">⚠️ Processo consultado no DJEN</p>
                        <p className="text-yellow-700 mt-1">
                          Nenhuma comunicação encontrada. O processo pode ser muito recente ou ainda não ter publicações.
                        </p>
                        <p className="text-yellow-600 text-xs mt-2">
                          💡 Dica: Preencha os dados manualmente ou tente novamente mais tarde.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-green-800">✓ Dados encontrados no DJEN:</p>
                        <p className="text-green-700 mt-1">
                          <strong>Vara:</strong> {djenData.nomeOrgao}
                        </p>
                        <p className="text-green-700">
                          <strong>Classe:</strong> {djenData.nomeClasse}
                        </p>
                        {djenData.destinatarios && djenData.destinatarios.length > 0 && (
                          <p className="text-green-700">
                            <strong>Partes:</strong> {djenData.destinatarios.map((d: any) => `${d.nome} (${d.polo})`).join(', ')}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Área do Processo</label>
                <select
                  value={formData.practice_area}
                  onChange={(event) => handleFormChange('practice_area', event.target.value as ProcessPracticeArea)}
                  className="input-field"
                >
                  {PRACTICE_AREAS.map((area) => (
                    <option key={area.key} value={area.key}>
                      {area.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Status</label>
                <select
                  value={formData.status}
                  onChange={(event) => handleFormChange('status', event.target.value as ProcessStatus)}
                  className="input-field"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.key} value={status.key}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Data de Distribuição</label>
                <input
                  type="date"
                  value={formData.distributed_at}
                  onChange={(event) => handleFormChange('distributed_at', event.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Vara / Comarca</label>
                <input
                  value={formData.court}
                  onChange={(event) => handleFormChange('court', event.target.value)}
                  className="input-field"
                  placeholder="Informe a vara ou comarca"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Advogado responsável</label>
                <select
                  value={formData.responsible_lawyer_id}
                  onChange={(event) => {
                    const memberId = event.target.value;
                    handleFormChange('responsible_lawyer_id', memberId);
                    const member = memberMap.get(memberId);
                    if (member) {
                      handleFormChange('responsible_lawyer', member.name);
                    }
                  }}
                  className="input-field"
                >
                  <option value="">Selecione um advogado</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} {member.oab ? `(OAB: ${member.oab})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <label className="text-sm font-medium text-slate-700 mb-3 block">Audiência</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Audiência agendada?</label>
                  <select
                    value={formData.hearing_scheduled}
                    onChange={(event) => handleFormChange('hearing_scheduled', event.target.value)}
                    className="input-field"
                  >
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
                </div>

                {formData.hearing_scheduled === 'sim' && (
                  <>
                    <div>
                      <label className="text-sm font-medium text-slate-700">Data da audiência</label>
                      <input
                        type="date"
                        value={formData.hearing_date}
                        onChange={(event) => handleFormChange('hearing_date', event.target.value)}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-700">Horário</label>
                      <input
                        type="time"
                        value={formData.hearing_time}
                        onChange={(event) => handleFormChange('hearing_time', event.target.value)}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-slate-700">Tipo</label>
                      <select
                        value={formData.hearing_mode}
                        onChange={(event) => handleFormChange('hearing_mode', event.target.value as HearingMode)}
                        className="input-field"
                      >
                        <option value="presencial">Presencial</option>
                        <option value="online">Online</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Notas Internas</label>
              <textarea
                value={formData.notes}
                onChange={(event) => handleFormChange('notes', event.target.value)}
                rows={4}
                className="input-field"
                placeholder="Observações, prazos ou próximos passos"
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
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {selectedProcess ? 'Salvar alterações' : 'Criar processo'}
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
              <p className="text-sm text-slate-600 mt-1">
                Consulte rapidamente os dados principais e o histórico de anotações.
              </p>
            </div>
            <button
              onClick={handleBackToList}
              className="text-slate-600 hover:text-slate-900 font-medium text-sm flex items-center gap-2"
            >
              ← Voltar para lista
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Cliente</label>
              <p className="text-base text-slate-900 mt-1 flex items-center gap-2">
                {client?.client_type === 'pessoa_juridica' ? (
                  <Building2 className="w-4 h-4 text-purple-500" />
                ) : (
                  <User className="w-4 h-4 text-blue-500" />
                )}
                {client?.full_name || 'Cliente removido'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Código do Processo</label>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-base text-slate-900 font-mono">{selectedProcessForView.process_code}</p>
                {selectedProcessForView.djen_synced === false || (selectedProcessForView.djen_synced && !selectedProcessForView.djen_has_data) ? (
                  <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full flex items-center gap-1">
                    ⏳ Aguardando DJEN
                  </span>
                ) : selectedProcessForView.djen_has_data ? (
                  <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full flex items-center gap-1">
                    ✓ Sincronizado
                  </span>
                ) : null}
              </div>
              {selectedProcessForView.djen_synced === false || (selectedProcessForView.djen_synced && !selectedProcessForView.djen_has_data) ? (
                <p className="text-xs text-yellow-700 mt-1">
                  💡 Este processo será sincronizado automaticamente com o DJEN nas próximas 24 horas
                </p>
              ) : null}
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
              {practiceAreaInfo?.description && (
                <p className="text-xs text-slate-500 mt-1">{practiceAreaInfo.description}</p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Advogado responsável</label>
              <p className="text-base text-slate-900 mt-1">
                {selectedProcessForView.responsible_lawyer || 'Não informado'}
              </p>
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

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Notas registradas</label>
              <p className="text-base text-slate-900 mt-1">
                {noteCount > 0 ? `${noteCount} anotação(ões)` : 'Nenhuma nota registrada ainda'}
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Histórico de notas</label>
              {noteThreads.length === 0 ? (
                <p className="text-sm text-slate-500 mt-2">Nenhuma nota registrada no momento.</p>
              ) : (
                <div className="mt-2 space-y-4">
                  {noteThreads.map((thread) => renderNote(thread))}
                </div>
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
          <p className="text-sm text-slate-600 mt-1">Registre atualizações, compromissos ou observações importantes.</p>
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
        {processModal}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Moderno com Gradiente */}
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-2xl overflow-hidden">
        {/* Padrão de fundo decorativo */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40"></div>
        
        {/* Efeito de brilho */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
        
        <div className="relative p-6 sm:p-8">
          {/* Título e Ações */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-lg">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-3xl font-bold text-white mb-1">Gestão de Processos</h3>
                <p className="text-sm text-slate-300">
                  Cadastre e acompanhe todos os processos jurídicos do escritório
                </p>
              </div>
            </div>

            <button
              onClick={() => handleOpenModal()}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold px-8 py-4 rounded-xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 hover:-translate-y-0.5"
            >
              <Plus className="w-5 h-5" />
              <span>Novo Processo</span>
            </button>
          </div>

          {/* Barra de Filtros e Busca */}
          <div className="bg-white/95 backdrop-blur-sm rounded-xl p-4 sm:p-5 shadow-xl border border-white/20">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
              {/* Busca */}
              <div className="sm:col-span-2 lg:col-span-5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                  🔍 Buscar Processo
                </label>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-amber-500 w-5 h-5 transition-colors" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-sm hover:shadow-md"
                    placeholder="Cliente, código do processo ou vara..."
                  />
                </div>
              </div>

              {/* Filtro de Status */}
              <div className="lg:col-span-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                  📊 Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as ProcessStatus | 'todos')}
                  className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-sm hover:shadow-md cursor-pointer"
                >
                  <option value="todos">📋 Todos os status</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.key} value={status.key}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Ações */}
              <div className="sm:col-span-2 lg:col-span-4 flex items-end gap-3">
                <button
                  onClick={() => setKanbanMode(!kanbanMode)}
                  className={`flex-1 inline-flex items-center justify-center gap-2 font-bold px-4 py-3.5 rounded-xl transition-all duration-300 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 ${
                    kanbanMode
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-2 border-slate-300 hover:border-slate-400'
                  }`}
                  title={kanbanMode ? 'Alternar para Modo Lista' : 'Alternar para Modo Kanban'}
                >
                  {kanbanMode ? <List className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
                  <span className="text-sm">{kanbanMode ? 'Lista' : 'Kanban'}</span>
                </button>

                <button
                  onClick={handleExportExcel}
                  disabled={exportingExcel}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 disabled:from-emerald-400 disabled:to-emerald-500 text-white font-bold px-4 py-3.5 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 disabled:cursor-not-allowed transform hover:-translate-y-0.5 disabled:transform-none"
                  title="Exportar para Excel"
                >
                  {exportingExcel ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
                  <span className="text-sm">{exportingExcel ? 'Gerando...' : 'Excel'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-16 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
          <p className="text-slate-600">Carregando processos...</p>
        </div>
      ) : filteredProcesses.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
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
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                              client?.client_type === 'pessoa_fisica'
                                ? 'bg-blue-100 text-blue-600'
                                : 'bg-purple-100 text-purple-600'
                            }`}>
                              {client?.client_type === 'pessoa_fisica' ? (
                                <User className="w-4 h-4" />
                              ) : (
                                <Building2 className="w-4 h-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {client?.full_name || 'Cliente removido'}
                              </p>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-slate-500 font-mono truncate">
                                  {process.process_code}
                                </p>
                                {process.djen_synced === false || (process.djen_synced && !process.djen_has_data) ? (
                                  <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded" title="Aguardando dados do DJEN">
                                    ⏳
                                  </span>
                                ) : process.djen_has_data ? (
                                  <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded" title="Sincronizado com DJEN">
                                    ✓
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        {process.court && (
                          <p className="text-xs text-slate-600 mb-2 line-clamp-2">{process.court}</p>
                        )}
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
                  {processesInColumn.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-8">Nenhum processo</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Mobile Cards */}
          <div className="block lg:hidden divide-y divide-gray-200">
            {filteredProcesses.map((process) => {
              const client = clientMap.get(process.client_id);
              return (
                <div key={process.id} className="p-3 sm:p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-3">
                    <div className={`flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10 rounded-full flex items-center justify-center ${
                      client?.client_type === 'pessoa_fisica'
                        ? 'bg-blue-100 text-blue-600'
                        : 'bg-purple-100 text-purple-600'
                    }`}>
                      {client?.client_type === 'pessoa_fisica' ? (
                        <User className="w-4 h-4 sm:w-5 sm:h-5" />
                      ) : (
                        <Building2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs sm:text-sm font-medium text-gray-900 mb-1 truncate">
                        {client?.full_name || 'Cliente removido'}
                      </div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <div className="text-[10px] sm:text-xs font-mono text-gray-700 break-all">{process.process_code}</div>
                        {process.djen_synced === false || (process.djen_synced && !process.djen_has_data) ? (
                          <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded" title="Aguardando dados do DJEN">
                            ⏳
                          </span>
                        ) : process.djen_has_data ? (
                          <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded" title="Dados sincronizados com DJEN">
                            ✓
                          </span>
                        ) : null}
                      </div>
                      {process.court && (
                        <div className="text-xs text-gray-500 mb-2">{process.court}</div>
                      )}
                      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          Área:
                          <span className="font-medium">
                            {PRACTICE_AREAS.find((area) => area.key === process.practice_area)?.label ?? process.practice_area}
                          </span>
                        </span>
                        {process.responsible_lawyer && (
                          <span className="inline-flex items-center gap-1">
                            Advogado:
                            <span className="font-medium">{process.responsible_lawyer}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>
                      {getStatusLabel(process.status)}
                    </span>
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
                    <button
                      onClick={() => handleDeleteProcess(process.id)}
                      className="px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
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
                    Nome do Cliente
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Código do Processo
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Distribuído
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
                {filteredProcesses.map((process) => {
                  const client = clientMap.get(process.client_id);
                  return (
                    <tr key={process.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                            client?.client_type === 'pessoa_fisica'
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-purple-100 text-purple-600'
                          }`}>
                            {client?.client_type === 'pessoa_fisica' ? (
                              <User className="w-5 h-5" />
                            ) : (
                              <Building2 className="w-5 h-5" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {client?.full_name || 'Cliente removido'}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                              <span className="inline-flex items-center gap-1">
                                Área:
                                <span className="font-medium">
                                  {PRACTICE_AREAS.find((area) => area.key === process.practice_area)?.label ?? process.practice_area}
                                </span>
                              </span>
                              {process.responsible_lawyer && (
                                <span className="inline-flex items-center gap-1">
                                  Advogado:
                                  <span className="font-medium">{process.responsible_lawyer}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-mono text-gray-900">{process.process_code}</div>
                          {process.djen_synced === false || (process.djen_synced && !process.djen_has_data) ? (
                            <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full" title="Aguardando dados do DJEN">
                              ⏳ DJEN
                            </span>
                          ) : process.djen_has_data ? (
                            <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full" title="Dados sincronizados com DJEN">
                              ✓ DJEN
                            </span>
                          ) : null}
                        </div>
                        {process.court && (
                          <div className="text-xs text-gray-500 mt-1">{process.court}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(process.distributed_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(process.status)}`}>
                          {getStatusLabel(process.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleViewProcess(process)}
                            className="text-blue-600 hover:text-blue-900 transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(process)}
                            className="text-amber-600 hover:text-amber-900 transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteProcess(process.id)}
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

      {processModal}
    </div>
  );
};

export default ProcessesModule;
