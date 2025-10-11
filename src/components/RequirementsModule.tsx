import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Loader2,
  Edit2,
  Trash2,
  Search,
  Eye,
  X,
  MessageSquare,
  Reply,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';
import { deadlineService } from '../services/deadline.service';
import type { Requirement, RequirementStatus, BenefitType } from '../types/requirement.types';
import type { Profile } from '../services/profile.service';
import type { Client } from '../types/client.types';
import type { DeadlinePriority } from '../types/deadline.types';

const STATUS_OPTIONS: {
  key: RequirementStatus;
  label: string;
  badge: string;
  color: string;
  animation?: string;
  animationStyle?: React.CSSProperties;
  icon?: 'spinner';
}[] = [
  {
    key: 'aguardando_confeccao',
    label: 'Aguardando Confecção',
    badge: 'bg-blue-500 text-white',
    color: 'blue',
    animation: 'animate-pulse ring-2 ring-blue-300/60 shadow shadow-blue-200/60',
    animationStyle: { animationDuration: '2.2s' },
  },
  {
    key: 'em_analise',
    label: 'Em Análise',
    badge: 'bg-slate-400 text-white',
    color: 'slate',
    animation: 'animate-pulse ring-2 ring-blue-300/60 shadow-md shadow-blue-200/40',
    animationStyle: { animationDuration: '1.6s' },
    icon: 'spinner',
  },
  {
    key: 'em_exigencia',
    label: 'Em Exigência',
    badge: 'bg-yellow-500 text-white',
    color: 'yellow',
    animation: 'animate-pulse ring-2 ring-yellow-300/50 shadow shadow-yellow-200/60',
    animationStyle: { animationDuration: '2s' },
  },
  {
    key: 'aguardando_pericia',
    label: 'Aguardando Perícia',
    badge: 'bg-cyan-500 text-white',
    color: 'cyan',
    animation: 'animate-pulse ring-2 ring-cyan-300/60 shadow shadow-cyan-200/60',
    animationStyle: { animationDuration: '2.4s' },
  },
  {
    key: 'deferido',
    label: 'Deferidos',
    badge: 'bg-green-600 text-white',
    color: 'green',
    animation: 'animate-pulse ring-2 ring-green-300/60 shadow shadow-green-200/50',
    animationStyle: { animationDuration: '2.8s' },
  },
  {
    key: 'indeferido',
    label: 'Indeferidos',
    badge: 'bg-red-600 text-white',
    color: 'red',
    animation: 'animate-pulse ring-2 ring-red-300/60 shadow shadow-red-200/60',
    animationStyle: { animationDuration: '2.2s' },
  },
  {
    key: 'ajuizado',
    label: 'Ajuizados',
    badge: 'bg-blue-900 text-white',
    color: 'blue',
    animation: 'animate-pulse ring-2 ring-blue-800/50 shadow shadow-blue-800/40',
    animationStyle: { animationDuration: '2.6s' },
  },
];

const STATUS_PRIORITY: Record<RequirementStatus, number> = {
  aguardando_confeccao: 0,
  em_analise: 1,
  em_exigencia: 2,
  aguardando_pericia: 3,
  indeferido: 4,
  deferido: 5,
  ajuizado: 6,
};

const DEADLINE_PRIORITY_OPTIONS: { value: DeadlinePriority; label: string }[] = [
  { value: 'urgente', label: 'Urgente' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const BENEFIT_TYPES: { key: BenefitType; label: string }[] = [
  { key: 'bpc_loas', label: 'BPC/LOAS' },
  { key: 'aposentadoria_tempo', label: 'Aposentadoria por Tempo de Contribuição' },
  { key: 'aposentadoria_idade', label: 'Aposentadoria por Idade' },
  { key: 'aposentadoria_invalidez', label: 'Aposentadoria por Invalidez' },
  { key: 'auxilio_acidente', label: 'Auxílio Acidente' },
  { key: 'auxilio_doenca', label: 'Auxílio Doença' },
  { key: 'pensao_morte', label: 'Pensão por Morte' },
  { key: 'salario_maternidade', label: 'Salário Maternidade' },
  { key: 'outro', label: 'Outro' },
];

type RequirementNote = {
  id: string;
  text: string;
  created_at: string;
  author?: string;
  author_id?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
  parent_id?: string | null;
  replies?: RequirementNote[];
};

type RequirementFormData = {
  protocol: string;
  beneficiary: string;
  cpf: string;
  benefit_type: BenefitType | '';
  status: RequirementStatus;
  entry_date: string;
  phone: string;
  inss_password: string;
  observations: string;
  notes: string;
  exigency_due_date: string;
  client_id: string;
};

type ExigencyModalState = {
  requirementId: string;
  defaultTitle: string;
  beneficiaryName: string;
  benefitTypeLabel: string;
};

type PericiaModalState = {
  requirementId: string;
  beneficiaryName: string;
  benefitTypeLabel: string;
};

const emptyForm: RequirementFormData = {
  protocol: '',
  beneficiary: '',
  cpf: '',
  benefit_type: '',
  status: 'aguardando_confeccao' as RequirementStatus,
  entry_date: '',
  exigency_due_date: '',
  phone: '',
  inss_password: '',
  observations: '',
  notes: '',
  client_id: '',
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Não informado';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const formatDateTime = (value: string) => {
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

const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const parseNotes = (value?: string | null): RequirementNote[] => {
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

const serializeNotes = (notes: RequirementNote[]): string =>
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

const buildNoteThreads = (notes: RequirementNote[]): RequirementNote[] => {
  const items = notes
    .slice()
    .map((note) => ({ ...note, replies: [] }))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const map = new Map<string, RequirementNote>();
  items.forEach((note) => {
    map.set(note.id, note);
  });

  const roots: RequirementNote[] = [];
  map.forEach((note) => {
    if (note.parent_id && map.has(note.parent_id)) {
      map.get(note.parent_id)!.replies!.push(note);
    } else {
      roots.push(note);
    }
  });

  const sortRecursive = (threads: RequirementNote[]) => {
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
  if (value.includes('T')) return value.split('T')[0];
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  return value;
};

const formatCPF = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`;
  if (cleaned.length <= 9) return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6)}`;
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9, 11)}`;
};

const formatPhone = (value: string) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 7) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2)}`;
  if (cleaned.length <= 11) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7, 11)}`;
};

interface RequirementsModuleProps {
  forceCreate?: boolean;
  entityId?: string;
  onParamConsumed?: () => void;
}

const RequirementsModule: React.FC<RequirementsModuleProps> = ({ forceCreate, entityId, onParamConsumed }) => {
  const { user } = useAuth();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<RequirementFormData>(emptyForm);
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null);
  const [filterProtocol, setFilterProtocol] = useState('');
  const [filterBeneficiary, setFilterBeneficiary] = useState('');
  const [filterCPF, setFilterCPF] = useState('');
  const [filterBenefitType, setFilterBenefitType] = useState<BenefitType | ''>('');
  const [activeStatusTab, setActiveStatusTab] = useState<RequirementStatus | 'todos'>('todos');
  const [viewMode, setViewMode] = useState<'list' | 'details'>('list');
  const [selectedRequirementForView, setSelectedRequirementForView] = useState<Requirement | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [addingReply, setAddingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [beneficiarySearchTerm, setBeneficiarySearchTerm] = useState('');
  const [showBeneficiarySuggestions, setShowBeneficiarySuggestions] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [schedulePromptId, setSchedulePromptId] = useState<string | null>(null);
  const [exigencyModal, setExigencyModal] = useState<ExigencyModalState | null>(null);
  const [periciaModal, setPericiaModal] = useState<PericiaModalState | null>(null);
  const [exigencyForm, setExigencyForm] = useState({
    title: '',
    due_date: '',
    priority: 'alta' as DeadlinePriority,
    notify_days_before: '3',
  });
  const exigencySubmittingRef = useRef(false);

  const memberMap = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const openExigencyModal = (requirement?: Requirement | null) => {
    if (!requirement) return;
    const beneficiaryName = requirement.beneficiary ?? 'Beneficiário';

    setExigencyForm({
      title: `Atender exigência - ${beneficiaryName}`,
      due_date: '',
      priority: 'alta',
      notify_days_before: '3',
    });

    setExigencyModal({
      requirementId: requirement.id,
      defaultTitle: `Atender exigência - ${beneficiaryName}`,
      beneficiaryName,
      benefitTypeLabel: getBenefitTypeLabel(requirement.benefit_type),
    });
  };

  const openPericiaModal = (requirement?: Requirement | null) => {
    if (!requirement) return;
    setPericiaModal({
      requirementId: requirement.id,
      beneficiaryName: requirement.beneficiary ?? 'Beneficiário',
      benefitTypeLabel: getBenefitTypeLabel(requirement.benefit_type),
    });
  };

  const detailNotes = useMemo(() => {
    if (!selectedRequirementForView) return [] as RequirementNote[];
    return parseNotes(selectedRequirementForView.notes);
  }, [selectedRequirementForView]);

  const filteredRequirements = useMemo(() => {
    let filtered = requirements;

    if (activeStatusTab !== 'todos') {
      filtered = filtered.filter((req) => req.status === activeStatusTab);
    }

    if (filterProtocol.trim()) {
      const term = filterProtocol.trim().toLowerCase();
      filtered = filtered.filter((req) => (req.protocol ?? '').toLowerCase().includes(term));
    }

    if (filterBeneficiary.trim()) {
      const term = filterBeneficiary.trim().toLowerCase();
      filtered = filtered.filter((req) => req.beneficiary.toLowerCase().includes(term));
    }

    if (filterCPF.trim()) {
      const term = filterCPF.replace(/\D/g, '');
      filtered = filtered.filter((req) => req.cpf.replace(/\D/g, '').includes(term));
    }

    if (filterBenefitType) {
      filtered = filtered.filter((req) => req.benefit_type === filterBenefitType);
    }

    return filtered
      .slice()
      .sort((a, b) => {
        const priorityA = STATUS_PRIORITY[a.status] ?? 99;
        const priorityB = STATUS_PRIORITY[b.status] ?? 99;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [requirements, activeStatusTab, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredRequirements.length / pageSize));

  const paginatedRequirements = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRequirements.slice(start, start + pageSize);
  }, [filteredRequirements, currentPage]);

  const statusCounts = useMemo(() => {
    const counts: Record<RequirementStatus | 'todos', number> = {
      todos: requirements.length,
      aguardando_confeccao: 0,
      em_analise: 0,
      em_exigencia: 0,
      aguardando_pericia: 0,
      deferido: 0,
      indeferido: 0,
      ajuizado: 0,
    };

    requirements.forEach((req) => {
      counts[req.status]++;
    });

    return counts;
  }, [requirements]);

  useEffect(() => {
    const fetchRequirements = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await requirementService.listRequirements();
        setRequirements(data);
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar os requerimentos.');
      } finally {
        setLoading(false);
      }
    };

    fetchRequirements();
  }, []);

  useEffect(() => {
    if (forceCreate && !isModalOpen) {
      setSelectedRequirement(null);
      setFormData(emptyForm);
      setIsModalOpen(true);
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isModalOpen, onParamConsumed]);

  useEffect(() => {
    if (entityId && requirements.length > 0) {
      const requirement = requirements.find(r => r.id === entityId);
      if (requirement) {
        setSelectedRequirementForView(requirement);
        setViewMode('details');
        if (onParamConsumed) {
          onParamConsumed();
        }
      }
    }
  }, [entityId, requirements, onParamConsumed]);

  useEffect(() => {
    let active = true;
    setClientsLoading(true);

    const handler = setTimeout(async () => {
      try {
        const term = beneficiarySearchTerm.trim();
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
  }, [beneficiarySearchTerm]);

  useEffect(() => {
    const sanitized = formData.cpf.replace(/\D/g, '');
    if (sanitized.length !== 11) return;

    let active = true;

    (async () => {
      try {
        const data = await clientService.listClients({ search: sanitized });
        if (!active) return;
        const match = data.find((client) => (client.cpf_cnpj || '').replace(/\D/g, '') === sanitized);
        if (!match) return;

        const formattedCpf = match.cpf_cnpj ? formatCPF(match.cpf_cnpj) : formData.cpf;
        if (match.full_name && formData.beneficiary !== match.full_name) {
          handleFormChange('beneficiary', match.full_name);
          setBeneficiarySearchTerm(match.full_name);
        }
        if (match.cpf_cnpj && formData.cpf !== formattedCpf) {
          handleFormChange('cpf', formattedCpf);
        }
        const phoneValue = match.mobile || match.phone || '';
        if (phoneValue) {
          handleFormChange('phone', phoneValue);
        }
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      active = false;
    };
  }, [formData.cpf]);

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
      const data = await requirementService.listRequirements();
      setRequirements(data);
      if (selectedRequirementForView) {
        const updated = data.find((item) => item.id === selectedRequirementForView.id);
        if (updated) {
          setSelectedRequirementForView(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar a lista de requerimentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeStatusTab, filterProtocol, filterBeneficiary, filterCPF, filterBenefitType]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleOpenModal = (requirement?: Requirement) => {
    if (requirement) {
      setSelectedRequirement(requirement);
      setFormData({
        protocol: requirement.protocol ?? '',
        beneficiary: requirement.beneficiary,
        cpf: requirement.cpf,
        benefit_type: requirement.benefit_type,
        status: requirement.status,
        entry_date: toDateInputValue(requirement.entry_date),
        exigency_due_date: toDateInputValue(requirement.exigency_due_date),
        phone: requirement.phone || '',
        inss_password: requirement.inss_password || '',
        observations: requirement.observations || '',
        notes: '',
        client_id: requirement.client_id || '',
      });
      setBeneficiarySearchTerm(requirement.beneficiary);
    } else {
      setSelectedRequirement(null);
      setFormData(emptyForm);
      setBeneficiarySearchTerm('');
    }

    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (saving) return;
    setIsModalOpen(false);
    setSelectedRequirement(null);
    setFormData(emptyForm);
    setBeneficiarySearchTerm('');
    setShowBeneficiarySuggestions(false);
  };

  useEffect(() => {
    if (formData.status !== 'em_exigencia') {
      setFormData((prev) => {
        if (!prev.exigency_due_date) return prev;
        return { ...prev, exigency_due_date: '' };
      });
    }
  }, [formData.status]);

  const handleFormChange = (field: keyof typeof formData, value: string) => {
    if (field === 'cpf') {
      setFormData((prev) => ({ ...prev, [field]: formatCPF(value) }));
    } else if (field === 'phone') {
      setFormData((prev) => ({ ...prev, [field]: formatPhone(value) }));
    } else if (field === 'status') {
      const statusValue = value as RequirementStatus;
      setFormData((prev) => ({ ...prev, status: statusValue }));

      if (selectedRequirement) {
        if (statusValue === 'em_exigencia') {
          const requirement = requirements.find((req) => req.id === selectedRequirement.id) || selectedRequirement;
          openExigencyModal(requirement);
        }
        if (statusValue === 'aguardando_pericia') {
          const requirement = requirements.find((req) => req.id === selectedRequirement.id) || selectedRequirement;
          openPericiaModal(requirement);
        }
      }
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedProtocol = formData.protocol.trim();
    const requiresProtocol = formData.status !== 'aguardando_confeccao';

    if (requiresProtocol && !trimmedProtocol) {
      setError('Informe o protocolo do INSS.');
      return;
    }

    if (!formData.beneficiary.trim()) {
      setError('Informe o nome do beneficiário.');
      return;
    }

    if (!formData.cpf.trim()) {
      setError('Informe o CPF do beneficiário.');
      return;
    }

    if (!formData.benefit_type) {
      setError('Selecione o tipo de benefício.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payloadBase = {
        protocol: requiresProtocol ? trimmedProtocol : null,
        beneficiary: formData.beneficiary.trim(),
        cpf: formData.cpf.trim(),
        benefit_type: formData.benefit_type as BenefitType,
        status: formData.status,
        entry_date: formData.entry_date ? new Date(formData.entry_date).toISOString() : null,
        exigency_due_date:
          formData.status === 'em_exigencia' && formData.exigency_due_date
            ? new Date(formData.exigency_due_date).toISOString()
            : null,
        phone: formData.phone?.trim() || null,
        inss_password: formData.inss_password?.trim() || null,
        observations: formData.observations?.trim() || null,
        client_id: formData.client_id?.trim() || null,
      };

      const trimmedNote = formData.notes.trim();

      const editingRequirement = selectedRequirement;
      let updatedRequirement: Requirement | null = null;

      if (editingRequirement) {
        const updatePayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const existingNotes = parseNotes(editingRequirement.notes);
          const newNote: RequirementNote = {
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

        await requirementService.updateRequirement(editingRequirement.id, updatePayload);
        updatedRequirement = await requirementService.getRequirementById(editingRequirement.id);
        if (updatedRequirement) {
          setRequirements((prev) => prev.map((item) => (item.id === updatedRequirement!.id ? updatedRequirement! : item)));
          setSelectedRequirement(updatedRequirement);
          if (selectedRequirementForView?.id === updatedRequirement.id) {
            setSelectedRequirementForView(updatedRequirement);
          }
        } else {
          await handleReload();
        }
      } else {
        const createPayload: Record<string, any> = { ...payloadBase };

        if (trimmedNote) {
          const authorInfo = await resolveAuthorInfo();
          const newNote: RequirementNote = {
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

        await requirementService.createRequirement(createPayload as any);
        await handleReload();
      }
      setIsModalOpen(false);
      if (!updatedRequirement) {
        setSelectedRequirement(null);
      }
      setFormData(emptyForm);
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o requerimento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRequirement = async (id: string) => {
    if (!confirm('Deseja realmente remover este requerimento? Essa ação é irreversível.')) return;

    try {
      await requirementService.deleteRequirement(id);
      await handleReload();
      setRequirements((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || 'Não foi possível remover o requerimento.');
    }
  };

  const handleViewRequirement = (requirement: Requirement) => {
    setSelectedRequirementForView(requirement);
    setViewMode('details');
    setNoteDraft('');
    setNoteError(null);
  };

  const handleBackToList = () => {
    setSelectedRequirementForView(null);
    setViewMode('list');
    setNoteDraft('');
    setNoteError(null);
  };

  const getStatusConfig = (status: RequirementStatus) => STATUS_OPTIONS.find((s) => s.key === status);

  const getStatusBadge = (status: RequirementStatus) => {
    const statusConfig = getStatusConfig(status);
    return statusConfig
      ? `${statusConfig.badge} ${statusConfig.animation ?? ''}`
      : 'bg-slate-100 text-slate-600';
  };

  const getStatusLabel = (status: RequirementStatus) => {
    const statusConfig = getStatusConfig(status);
    return statusConfig ? statusConfig.label : status;
  };

  const getBenefitTypeLabel = (type: BenefitType) => {
    const typeConfig = BENEFIT_TYPES.find((item) => item.key === type);
    return typeConfig ? typeConfig.label : type;
  };

  const getNoteAuthorDisplay = (note: RequirementNote) => {
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
    if (!selectedRequirementForView) return;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError('Escreva uma nota antes de salvar.');
      return;
    }

    try {
      setAddingNote(true);
      setNoteError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const newNote: RequirementNote = {
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
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }

      setNoteDraft('');
    } catch (err: any) {
      setNoteError(err.message || 'Não foi possível adicionar a nota.');
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddReply = async () => {
    if (!selectedRequirementForView || !replyingTo) return;
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      setReplyError('Escreva uma resposta antes de enviar.');
      return;
    }

    try {
      setAddingReply(true);
      setReplyError(null);

      const authorInfo = await resolveAuthorInfo();
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const newReply: RequirementNote = {
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
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
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
    if (!selectedRequirementForView) return;
    if (!confirm('Tem certeza que deseja excluir esta nota? Esta ação não pode ser desfeita.')) return;

    try {
      const existingNotes = parseNotes(selectedRequirementForView.notes);
      const updatedNotes = existingNotes.filter((note) => note.id !== noteId);
      const serialized = serializeNotes(updatedNotes);
      await requirementService.updateRequirement(selectedRequirementForView.id, { notes: serialized });

      const refreshed = await requirementService.getRequirementById(selectedRequirementForView.id);
      if (refreshed) {
        setSelectedRequirementForView(refreshed);
        setRequirements((prev) => prev.map((item) => (item.id === refreshed.id ? refreshed : item)));
      }
    } catch (err: any) {
      console.error('Erro ao excluir nota:', err);
      alert('Não foi possível excluir a nota.');
    }
  };

  const handleStatusChange = async (requirementId: string, newStatus: RequirementStatus) => {
    try {
      setStatusUpdatingId(requirementId);
      const requirement = requirements.find((req) => req.id === requirementId) || null;
      await requirementService.updateStatus(requirementId, newStatus);
      setRequirements((prev) =>
        prev.map((req) => (req.id === requirementId ? { ...req, status: newStatus } : req)),
      );
      await handleReload();

      if (newStatus === 'em_exigencia') {
        openExigencyModal(requirement);
      }

      if (newStatus === 'aguardando_pericia') {
        openPericiaModal(requirement);
        setSchedulePromptId(requirementId);
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível atualizar o status.');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const clearSchedulePrompt = () => setSchedulePromptId(null);

  const handleCloseExigencyModal = () => {
    if (exigencySubmittingRef.current) return;
    setExigencyModal(null);
    setExigencyForm({
      title: '',
      due_date: '',
      priority: 'alta',
      notify_days_before: '3',
    });
  };

  const handleClosePericiaModal = () => {
    setPericiaModal(null);
  };

  const handleExigencyFormChange = (field: keyof typeof exigencyForm, value: string) => {
    setExigencyForm((prev) => ({ ...prev, [field]: value }));
  };

  const toUtcMidnightIso = (dateOnly: string) => {
    const date = new Date(`${dateOnly}T00:00:00`);
    const utcTime = date.getTime() - date.getTimezoneOffset() * 60000;
    return new Date(utcTime).toISOString();
  };

  const handleCreateExigencyDeadline = async () => {
    if (!exigencyModal) return;
    const title = exigencyForm.title.trim();
    if (!title) {
      alert('Informe o título do prazo.');
      return;
    }
    if (!exigencyForm.due_date) {
      alert('Informe a data de vencimento.');
      return;
    }

    try {
      exigencySubmittingRef.current = true;
      const requirement = requirements.find((req) => req.id === exigencyModal.requirementId) || null;
      if (!requirement) {
        alert('Requerimento não encontrado.');
        return;
      }

      const dueDateIso = toUtcMidnightIso(exigencyForm.due_date);

      const payload = {
        title,
        description: `Atender exigência do requerimento ${requirement.protocol ?? 'sem protocolo'}.`,
        due_date: dueDateIso,
        status: 'pendente' as const,
        priority: exigencyForm.priority as DeadlinePriority,
        type: 'requerimento' as const,
        requirement_id: requirement.id,
        client_id: requirement.client_id ?? null,
        process_id: null,
        responsible_id: null,
        notify_days_before: parseInt(exigencyForm.notify_days_before || '3', 10) || 3,
      };

      await deadlineService.createDeadline(payload);

      await requirementService.updateRequirement(requirement.id, {
        exigency_due_date: dueDateIso,
      });

      setRequirements((prev) =>
        prev.map((req) =>
          req.id === requirement.id
            ? {
                ...req,
                exigency_due_date: dueDateIso,
              }
            : req,
        ),
      );

      setSelectedRequirement((prev) =>
        prev && prev.id === requirement.id ? { ...prev, exigency_due_date: dueDateIso } : prev,
      );

      setSelectedRequirementForView((prev) =>
        prev && prev.id === requirement.id ? { ...prev, exigency_due_date: dueDateIso } : prev,
      );

      await handleReload();
      alert('Prazo criado e enviado para o módulo de prazos.');
      handleCloseExigencyModal();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Não foi possível criar o prazo de exigência.');
    } finally {
      exigencySubmittingRef.current = false;
    }
  };

  const handleWhatsApp = (phone?: string | null) => {
    if (!phone) {
      alert('Telefone não informado para este requerimento.');
      return;
    }
    const cleaned = phone.replace(/\D/g, '');
    window.open(`https://wa.me/55${cleaned}`, '_blank');
  };

  const handleExportExcel = async () => {
    if (!requirements.length) {
      alert('Não há requerimentos disponíveis para exportar.');
      return;
    }

    try {
      setExportingExcel(true);

      const excelData = requirements.map((req) => ({
        'Protocolo': req.protocol,
        'Beneficiário': req.beneficiary,
        'CPF': req.cpf,
        'Tipo de Benefício': getBenefitTypeLabel(req.benefit_type),
        'Status': getStatusLabel(req.status),
        'Data de Entrada': formatDate(req.entry_date),
        'Telefone': req.phone || '',
        'Senha INSS': req.inss_password || '',
        'Observações': req.observations || '',
        'Criado em': req.created_at ? new Date(req.created_at).toLocaleDateString('pt-BR') : '',
        'Atualizado em': req.updated_at ? new Date(req.updated_at).toLocaleDateString('pt-BR') : '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 20 }, // Protocolo
        { wch: 30 }, // Beneficiário
        { wch: 15 }, // CPF
        { wch: 35 }, // Tipo de Benefício
        { wch: 20 }, // Status
        { wch: 15 }, // Data de Entrada
        { wch: 18 }, // Telefone
        { wch: 15 }, // Senha INSS
        { wch: 40 }, // Observações
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, 'Requerimentos');

      const now = new Date();
      const dateSlug = now.toISOString().split('T')[0];
      const filename = `requerimentos_${dateSlug}.xlsx`;

      XLSX.writeFile(wb, filename);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Não foi possível exportar os dados para Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  const renderNote = (note: RequirementNote, depth: number = 0) => {
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

  const noteThreads = useMemo(() => {
    if (!selectedRequirementForView) return [];
    return buildNoteThreads(parseNotes(selectedRequirementForView.notes));
  }, [selectedRequirementForView]);

  const requirementModal = isModalOpen && (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {selectedRequirement ? 'Editar Requerimento' : 'Novo Requerimento'}
            </h3>
            <p className="text-sm text-slate-600">Cadastre os dados do requerimento administrativo.</p>
          </div>
          <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Protocolo do INSS *</label>
              <input
                value={formData.protocol}
                onChange={(event) => handleFormChange('protocol', event.target.value)}
                className="input-field"
                placeholder="Ex: 123456789"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Beneficiário *</label>
              <div className="relative">
                <input
                  value={beneficiarySearchTerm}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBeneficiarySearchTerm(value);
                    handleFormChange('beneficiary', value);
                    if (!value) {
                      handleFormChange('cpf', '');
                      handleFormChange('phone', '');
                    }
                  }}
                  onFocus={() => setShowBeneficiarySuggestions(true)}
                  onBlur={() => setTimeout(() => setShowBeneficiarySuggestions(false), 150)}
                  className="input-field"
                  placeholder="Digite para buscar clientes"
                  required
                />
                {clientsLoading && (
                  <Loader2 className="w-4 h-4 text-blue-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
                )}
                {showBeneficiarySuggestions && (
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
                          className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 transition"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            handleFormChange('beneficiary', client.full_name);
                            handleFormChange('client_id', client.id);
                            setBeneficiarySearchTerm(client.full_name);
                            if (client.cpf_cnpj) {
                              handleFormChange('cpf', formatCPF(client.cpf_cnpj));
                            }
                            const phoneValue = client.mobile || client.phone || '';
                            if (phoneValue) {
                              handleFormChange('phone', phoneValue);
                            }
                            setShowBeneficiarySuggestions(false);
                          }}
                        >
                          <div className="font-semibold text-slate-800">{client.full_name}</div>
                          <div className="text-xs text-slate-500">
                            {client.cpf_cnpj ? formatCPF(client.cpf_cnpj) : 'CPF não informado'} • {client.email || 'Sem e-mail'}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">CPF *</label>
              <input
                value={formData.cpf}
                onChange={(event) => handleFormChange('cpf', event.target.value)}
                className="input-field"
                placeholder="000.000.000-00"
                maxLength={14}
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Tipo de Benefício</label>
              <select
                value={formData.benefit_type}
                onChange={(event) => handleFormChange('benefit_type', event.target.value as BenefitType | '')}
                className="input-field"
              >
                <option value="" disabled>
                  Selecione o tipo de benefício
                </option>
                {BENEFIT_TYPES.map((type) => (
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
                onChange={(event) => handleFormChange('status', event.target.value as RequirementStatus)}
                className="input-field"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            {formData.status === 'em_exigencia' && (
              <div>
                <label className="text-sm font-medium text-slate-700">Prazo da Exigência</label>
                <input
                  type="date"
                  value={formData.exigency_due_date}
                  onChange={(event) => handleFormChange('exigency_due_date', event.target.value)}
                  className="input-field"
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-slate-700">Data de Entrada</label>
              <input
                type="date"
                value={formData.entry_date}
                onChange={(event) => handleFormChange('entry_date', event.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Telefone</label>
              <input
                value={formData.phone}
                onChange={(event) => handleFormChange('phone', event.target.value)}
                className="input-field"
                placeholder="(00) 00000-0000"
                maxLength={15}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">Senha do INSS</label>
              <input
                type="text"
                value={formData.inss_password}
                onChange={(event) => handleFormChange('inss_password', event.target.value)}
                className="input-field"
                placeholder="Senha de acesso ao INSS"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Observações</label>
            <textarea
              value={formData.observations}
              onChange={(event) => handleFormChange('observations', event.target.value)}
              rows={3}
              className="input-field"
              placeholder="Informações adicionais sobre o requerimento"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Notas Internas</label>
            <textarea
              value={formData.notes}
              onChange={(event) => handleFormChange('notes', event.target.value)}
              rows={3}
              className="input-field"
              placeholder="Anotações internas sobre o requerimento"
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
              {selectedRequirement ? 'Salvar alterações' : 'Criar requerimento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const exigencyDeadlineModal = exigencyModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Registrar prazo para exigência</h3>
            {exigencyModal.beneficiaryName && (
              <p className="text-sm text-slate-600 mt-1">
                Beneficiário: <span className="font-medium">{exigencyModal.beneficiaryName}</span>
              </p>
            )}
            {exigencyModal.benefitTypeLabel && (
              <p className="text-xs text-slate-500">Benefício: {exigencyModal.benefitTypeLabel}</p>
            )}
          </div>
          <button onClick={handleCloseExigencyModal} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Título *</label>
            <input
              value={exigencyForm.title}
              onChange={(event) => handleExigencyFormChange('title', event.target.value)}
              className="input-field"
              placeholder="Ex: Entregar documentos solicitados pelo INSS"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Data de vencimento *</label>
              <input
                type="date"
                value={exigencyForm.due_date}
                onChange={(event) => handleExigencyFormChange('due_date', event.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Prioridade</label>
              <select
                value={exigencyForm.priority}
                onChange={(event) => handleExigencyFormChange('priority', event.target.value)}
                className="input-field"
              >
                {DEADLINE_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">Notificar quantos dias antes?</label>
            <input
              type="number"
              min={0}
              value={exigencyForm.notify_days_before}
              onChange={(event) => handleExigencyFormChange('notify_days_before', event.target.value)}
              className="input-field"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={handleCloseExigencyModal}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreateExigencyDeadline}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-60"
            disabled={exigencySubmittingRef.current}
          >
            {exigencySubmittingRef.current && <Loader2 className="w-4 h-4 animate-spin" />}
            Registrar prazo
          </button>
        </div>
      </div>
    </div>
  );

  const periciaSchedulingModal = periciaModal && (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Agendar perícia</h3>
            {periciaModal.beneficiaryName && (
              <p className="text-sm text-slate-600 mt-1">
                Beneficiário: <span className="font-medium">{periciaModal.beneficiaryName}</span>
              </p>
            )}
            {periciaModal.benefitTypeLabel && (
              <p className="text-xs text-slate-500">Benefício: {periciaModal.benefitTypeLabel}</p>
            )}
          </div>
          <button onClick={handleClosePericiaModal} className="text-slate-400 hover:text-slate-600" title="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600">
            Estamos preparando a agenda de perícias. Por enquanto, registre manualmente o agendamento e acompanhe pelo módulo de prazos ou pelas notas deste requerimento.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end">
          <button
            onClick={handleClosePericiaModal}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 transition"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );

  if (viewMode === 'details' && selectedRequirementForView) {
    const noteCount = detailNotes.length;
    const detailStatusConfig = getStatusConfig(selectedRequirementForView.status);

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Detalhes do Requerimento</h3>
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
              <label className="text-xs font-semibold text-slate-500 uppercase">Protocolo</label>
              <p className="text-base text-slate-900 mt-1 font-mono">{selectedRequirementForView.protocol}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Beneficiário</label>
              <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.beneficiary}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">CPF</label>
              <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.cpf}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Tipo de Benefício</label>
              <p className="text-base text-slate-900 mt-1">{getBenefitTypeLabel(selectedRequirementForView.benefit_type)}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
              <p className="mt-1">
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(selectedRequirementForView.status)}`}
                  style={detailStatusConfig?.animationStyle}
                >
                  {getStatusLabel(selectedRequirementForView.status)}
                  {detailStatusConfig?.icon === 'spinner' && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                </span>
              </p>
            </div>

            {selectedRequirementForView.status === 'em_exigencia' && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Prazo da Exigência</label>
                <p className="text-base text-slate-900 mt-1">
                  {selectedRequirementForView.exigency_due_date
                    ? formatDate(selectedRequirementForView.exigency_due_date)
                    : 'Prazo não definido'}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Data de Entrada</label>
              <p className="text-base text-slate-900 mt-1">{formatDate(selectedRequirementForView.entry_date)}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Telefone</label>
              <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.phone || 'Não informado'}</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Senha do INSS</label>
              <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.inss_password || 'Não informado'}</p>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Observações</label>
              <p className="text-base text-slate-900 mt-1">{selectedRequirementForView.observations || 'Nenhuma observação'}</p>
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
              onClick={() => handleOpenModal(selectedRequirementForView)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Edit2 className="w-4 h-4" />
              Editar Requerimento
            </button>
            <button
              onClick={() => handleWhatsApp(selectedRequirementForView.phone)}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
            >
              <MessageSquare className="w-4 h-4" />
              WhatsApp
            </button>
            <button
              onClick={() => {
                handleDeleteRequirement(selectedRequirementForView.id);
                handleBackToList();
              }}
              className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2.5 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Excluir Requerimento
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h4 className="text-base font-semibold text-slate-900">Adicionar nota</h4>
          <p className="text-sm text-slate-600 mt-1">Registre atualizações ou observações importantes.</p>
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
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition disabled:opacity-60"
              >
                {addingNote && <Loader2 className="w-4 h-4 animate-spin" />}
                {addingNote ? 'Salvando nota...' : 'Adicionar nota'}
              </button>
            </div>
          </div>
        </div>
        {requirementModal}
        {exigencyDeadlineModal}
        {periciaSchedulingModal}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {schedulePromptId && (
        <div className="bg-cyan-50 border border-cyan-200 text-cyan-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>
              Requerimento aguardando perícia. Em breve iremos abrir o compromisso automaticamente na agenda.
            </span>
          </div>
          <button onClick={clearSchedulePrompt} className="text-cyan-700 hover:text-cyan-900 text-xs font-semibold uppercase">
            Fechar
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Sistema de Requerimentos</h3>
            <p className="text-sm text-slate-600 mt-1">Gerencie requerimentos administrativos do INSS</p>
          </div>

          <div className="flex gap-3">
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
              Novo Requerimento
            </button>
          </div>
        </div>

        {/* Abas de Status */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveStatusTab('todos')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeStatusTab === 'todos'
                ? 'bg-blue-600 text-white animate-pulse'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
            style={activeStatusTab === 'todos' ? { animationDuration: '2.4s' } : undefined}
          >
            Todos ({statusCounts.todos})
          </button>
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status.key}
              onClick={() => setActiveStatusTab(status.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeStatusTab === status.key
                  ? `${status.badge} ${status.animation ?? ''}`
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              style={activeStatusTab === status.key ? status.animationStyle : undefined}
            >
              <span className="inline-flex items-center gap-2">
                {status.label}
                {status.icon === 'spinner' && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
                ({statusCounts[status.key]})
              </span>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={filterProtocol}
              onChange={(event) => setFilterProtocol(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Buscar por protocolo..."
            />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={filterBeneficiary}
              onChange={(event) => setFilterBeneficiary(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Buscar por beneficiário..."
            />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={filterCPF}
              onChange={(event) => setFilterCPF(event.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Buscar por CPF..."
            />
          </div>

          <select
            value={filterBenefitType}
            onChange={(event) => setFilterBenefitType(event.target.value as BenefitType | '')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="">Todos os tipos</option>
            {BENEFIT_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-16 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando requerimentos...</p>
        </div>
      ) : filteredRequirements.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-slate-600">Nenhum requerimento encontrado.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Protocolo
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Beneficiário
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    CPF
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Tipo de Benefício
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Data de Entrada
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedRequirements.map((requirement) => {
                  const isUpdating = statusUpdatingId === requirement.id;
                  const statusConfig = getStatusConfig(requirement.status);
                  return (
                    <tr key={requirement.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-mono text-gray-900">{requirement.protocol}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{requirement.beneficiary}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{requirement.cpf}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{getBenefitTypeLabel(requirement.benefit_type)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <select
                            value={requirement.status}
                            onChange={(e) => handleStatusChange(requirement.id, e.target.value as RequirementStatus)}
                            disabled={isUpdating}
                            className={`text-xs font-semibold px-3 py-1 rounded-full border-0 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition ${
                              statusConfig?.badge ?? 'bg-slate-200 text-slate-700'
                            } ${statusConfig?.animation ?? ''}`}
                            style={statusConfig?.animationStyle}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          {(requirement.status === 'em_analise' || isUpdating) && (
                            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                          )}
                        </div>
                        {requirement.status === 'em_exigencia' && (
                          <p className="text-amber-600 text-xs font-medium mt-2">
                            Prazo: {requirement.exigency_due_date ? formatDate(requirement.exigency_due_date) : 'não definido'}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(requirement.entry_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleWhatsApp(requirement.phone)}
                            className="text-green-600 hover:text-green-900 transition-colors"
                            title="WhatsApp"
                          >
                            <MessageSquare className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleViewRequirement(requirement)}
                            className="text-cyan-600 hover:text-cyan-900 transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleOpenModal(requirement)}
                            className="text-blue-600 hover:text-blue-900 transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteRequirement(requirement.id)}
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

      {filteredRequirements.length > pageSize && (
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

      {requirementModal}
      {exigencyDeadlineModal}
      {periciaSchedulingModal}

    </div>
  );
}

export default RequirementsModule;
