import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Search,
  RefreshCw,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle,
  X,
  ExternalLink,
  Filter,
  Link2,
  Clock,
  Plus,
  Calendar as CalendarIcon,
  UserCircle,
  UserCog,
  Settings,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  Sparkles,
  Lightbulb,
  AlertTriangle,
  Download,
  Info,
  FileCog,
  Unlink,
  Layers,
  Banknote,
  ShieldAlert,
  Gavel,
  RotateCcw,
} from 'lucide-react';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { DeadlineFormModal } from './DeadlineFormModal';
import { ProcessQuickViewModal } from './ProcessQuickViewModal';
import { clientService } from '../services/client.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { Modal, ModalBody, IntimationsSkeleton } from './ui';
import { useMinLoading } from '../hooks/useMinLoading';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { profileService } from '../services/profile.service';
import { matchesNormalizedSearch } from '../utils/search';
import { formatDate as formatDateValue, formatDateLong, formatDateTime as formatDateTimeValue } from '../utils/formatters';
import { settingsService, type DjenConfig, DEADLINE_MODULE_DEFAULTS } from '../services/settings.service';
import { userNotificationService } from '../services/userNotification.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { aiService } from '../services/ai.service';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportIntimations';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { supabase } from '../config/supabase';
import { useSelectionState } from '../hooks/useSelectionState';
import type { DjenComunicacaoLocal, DjenConsultaParams, UpdateDjenComunicacaoDTO } from '../types/djen.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { CreateDeadlineDTO, DeadlineType, DeadlinePriority, DeadlineStatus } from '../types/deadline.types';
import type { CreateCalendarEventDTO, CalendarEventType } from '../types/calendar.types';
import type { Profile } from '../services/profile.service';
import type { IntimationAnalysis } from '../types/ai.types';
import { addMinutesToWallTime } from '../utils/officeTime';
import { detectIntimationOutcome, type IntimationOutcomeKind } from '../utils/intimationOutcome';
import { dataInternaDoPrazo, prioridadePorUrgencia } from '../utils/intimationDeadline';
import { LAYER } from '../styles/layers';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';

interface ModuleSettings {
  defaultGroupByProcess: boolean;
  defaultStatusFilter: 'all' | 'unread' | 'read';
  externalCronToken: string;
}

const MODULE_SETTINGS_STORAGE_KEY = 'intimations_module_settings';

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const subDays = (date: Date, amount: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() - amount);
  return result;
};

// Converte HTML com entidades (ex: &aacute;, &nbsp;) em texto legível
const htmlToText = (html: string): string => {
  if (!html) return '';
  try {
    const withBreaks = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<\/div>/gi, '\n')
      .replace(/<div[^>]*>/gi, '');
    const el = document.createElement('div');
    el.innerHTML = withBreaks;
    return (el.textContent || (el as any).innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return html;
  }
};

// Intimação de processo sigiloso: o DJEN não traz o inteiro teor (só "Processo
// sigiloso — consulte os autos"), então precisa de destaque para não passar batido.
const isSigilosoIntimacao = (i: { texto?: string | null }): boolean =>
  (i.texto || '').toLowerCase().includes('sigiloso');

// Extrai nomes das partes do texto da intimação
const extractPartesFromTexto = (texto: string): { nome: string; polo: string }[] => {
  const partes: { nome: string; polo: string }[] = [];
  
  // Padrões comuns no texto das intimações
  const patterns = [
    { regex: /Requerente:\s*([^\.;,\n]+)/gi, polo: 'Requerente' },
    { regex: /Requerido:\s*([^\.;,\n]+)/gi, polo: 'Requerido' },
    { regex: /Autor:\s*([^\.;,\n]+)/gi, polo: 'Autor' },
    { regex: /Réu:\s*([^\.;,\n]+)/gi, polo: 'Réu' },
    { regex: /Reclamante:\s*([^\.;,\n]+)/gi, polo: 'Reclamante' },
    { regex: /Reclamado:\s*([^\.;,\n]+)/gi, polo: 'Reclamado' },
    { regex: /Exequente:\s*([^\.;,\n]+)/gi, polo: 'Exequente' },
    { regex: /Executado:\s*([^\.;,\n]+)/gi, polo: 'Executado' },
    { regex: /Impetrante:\s*([^\.;,\n]+)/gi, polo: 'Impetrante' },
    { regex: /Impetrado:\s*([^\.;,\n]+)/gi, polo: 'Impetrado' },
    { regex: /Agravante:\s*([^\.;,\n]+)/gi, polo: 'Agravante' },
    { regex: /Agravado:\s*([^\.;,\n]+)/gi, polo: 'Agravado' },
    { regex: /Apelante:\s*([^\.;,\n]+)/gi, polo: 'Apelante' },
    { regex: /Apelado:\s*([^\.;,\n]+)/gi, polo: 'Apelado' },
  ];

  for (const { regex, polo } of patterns) {
    let match;
    while ((match = regex.exec(texto)) !== null) {
      const nome = match[1].trim();
      if (nome && nome.length > 2 && nome.length < 200) {
        partes.push({ nome, polo });
      }
    }
  }

  return partes;
};

interface IntimationsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

const IntimationsModule: React.FC<IntimationsModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const { confirmDelete } = useDeleteConfirm();
  const { user } = useAuth();
  const { navigateTo } = useNavigation();
  
  // Estados principais
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [quickViewProcessId, setQuickViewProcessId] = useState<string | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialSnapshotLoaded, setInitialSnapshotLoaded] = useState(false);
  const showInitialSkeleton = useMinLoading(!initialSnapshotLoaded);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read' | 'linked' | 'unlinked'>('unread');
  const [tribunalFilter, setTribunalFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'30days' | '60days' | '90days' | 'all'>('30days');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'alta' | 'media' | 'baixa'>('all');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [groupByProcess, setGroupByProcess] = useState(true);
  const [mobileControlsExpanded, setMobileControlsExpanded] = useState(false);

  // Detalhes e ações
  const [selectedIntimation, setSelectedIntimation] = useState<DjenComunicacaoLocal | null>(null);
  const [expandedIntimationIds, setExpandedIntimationIds] = useState<Set<string>>(new Set());
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkingIntimation, setLinkingIntimation] = useState<DjenComunicacaoLocal | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [selectedProcessName, setSelectedProcessName] = useState('');
  const [processSearchTerm, setProcessSearchTerm] = useState('');
  const [processDropdownOpen, setProcessDropdownOpen] = useState(false);
  const [creatingProcess, setCreatingProcess] = useState(false);
  const [newProcessCode, setNewProcessCode] = useState('');
  const [newProcessArea, setNewProcessArea] = useState<'civel' | 'trabalhista' | 'consumidor' | 'previdenciario' | 'familia'>('civel');
  const [newProcessSaving, setNewProcessSaving] = useState(false);
  const processSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (processSearchRef.current && !processSearchRef.current.contains(e.target as Node)) {
        setProcessDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Modais de criação
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false);
  const [currentIntimationForAction, setCurrentIntimationForAction] = useState<DjenComunicacaoLocal | null>(null);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [savingPrescription, setSavingPrescription] = useState(false);
  const [prescriptionBaseDate, setPrescriptionBaseDate] = useState('');
  const [prescriptionError, setPrescriptionError] = useState<string | null>(null);
  const [prescriptionSuccess, setPrescriptionSuccess] = useState<string | null>(null);

  // Seleção múltipla
  const {
    selectionMode,
    selectedIds,
    setSelectionMode,
    toggleSelectedId,
    clearSelectedIds,
    disableSelectionMode,
  } = useSelectionState<string>();

  // IA Analysis
  const [aiAnalysis, setAiAnalysis] = useState<Map<string, IntimationAnalysis>>(new Map());
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  // Estados de navegação e interface
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showClearMenu, setShowClearMenu] = useState(false);
  const [syncLogs, setSyncLogs] = useState<DjenSyncLog[]>([]);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [moduleSettings, setModuleSettings] = useState<ModuleSettings>({
    defaultGroupByProcess: true,
    defaultStatusFilter: 'unread',
    externalCronToken: 'run-djen-sync',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [globalDjenConfig, setGlobalDjenConfig] = useState<DjenConfig | null>(null);
  const [deadlineStatusOptions, setDeadlineStatusOptions] = useState<{ key: DeadlineStatus; label: string }[]>(
    DEADLINE_MODULE_DEFAULTS.statuses.map(s => ({ key: s.key as DeadlineStatus, label: s.label }))
  );
  const [deadlinePriorityOptions, setDeadlinePriorityOptions] = useState<{ key: DeadlinePriority; label: string }[]>(
    DEADLINE_MODULE_DEFAULTS.priorities.map(p => ({ key: p.key as DeadlinePriority, label: p.label }))
  );
  const [deadlineTypeOptions, setDeadlineTypeOptions] = useState<{ key: DeadlineType; label: string }[]>(
    DEADLINE_MODULE_DEFAULTS.types.map(t => ({ key: t.key as DeadlineType, label: t.label }))
  );
  const [monitoredLawyers, setMonitoredLawyers] = useState<string[]>([]);
  const lastRealtimeReloadAtRef = useRef<number>(0);
  const realtimeInsertCountRef = useRef<number>(0);
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const overviewSectionRef = useRef<HTMLDivElement | null>(null);
  const configSectionRef = useRef<HTMLDivElement | null>(null);
  const filterSectionRef = useRef<HTMLDivElement | null>(null);
  const listSectionRef = useRef<HTMLDivElement | null>(null);
  const autoSyncTriggeredRef = useRef(false);

  // Helpers
  const normalizeProcessNumber = (value: string) => value ? value.replace(/\D/g, '') : '';
  const isLinked = (int: DjenComunicacaoLocal) => int.process_id || int.client_id;
  const isUnlinked = (int: DjenComunicacaoLocal) => !int.process_id && !int.client_id;

  // Carregar configurações salvas
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MODULE_SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ModuleSettings;
        setModuleSettings(parsed);
        setGroupByProcess(parsed.defaultGroupByProcess);
        setStatusFilter(parsed.defaultStatusFilter);
      }
    } catch (error) {
      console.error('Erro ao carregar configurações do módulo:', error);
    } finally {
      setSettingsLoaded(true);
    }
  }, [monitoredLawyers]);

  // Persistir configurações ao alterar
  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(MODULE_SETTINGS_STORAGE_KEY, JSON.stringify(moduleSettings));
  }, [moduleSettings, settingsLoaded]);

  const fetchSyncLogs = useCallback(async () => {
    try {
      setSyncStatusLoading(true);
      const logs = await djenSyncStatusService.listRecent(30);
      setSyncLogs(logs);
    } catch (error) {
      console.error('Erro ao carregar histórico do cron DJEN:', error);
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  const djenRunSyncCronLog = useMemo(() => {
    return (
      syncLogs.find(
        (log) => log.source === 'cron_supabase' || log.trigger_type === 'pg_cron' || log.trigger_type === 'run_djen_sync',
      ) ?? null
    );
  }, [syncLogs]);

  // Pré-carregar snapshot local para evitar tela em branco
  useEffect(() => {
    let cancelled = false;

    const preloadLocalSnapshot = async () => {
      try {
        const localIntimations = await djenLocalService.listComunicacoes();
        if (!cancelled && localIntimations.length > 0) {
          setIntimations(localIntimations);
        }
      } catch (err) {
        console.error('Erro ao carregar snapshot inicial de intimações:', err);
      } finally {
        if (!cancelled) {
          setInitialSnapshotLoaded(true);
        }
      }
    };

    preloadLocalSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);


  const handleDeleteSelected = async () => {
    setShowClearMenu(false);
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      toast.info('Nenhuma seleção', 'Escolha as intimações que deseja remover');
      return;
    }

    const confirmed = await confirmDelete({
      title: 'Remover intimações',
      message: `Remover ${ids.length} intimação(ões) selecionada(s)? Esta ação é irreversível.`,
      confirmLabel: 'Remover',
      permission: { module: 'intimacoes', action: 'delete' },
    });
    if (!confirmed) return;

    try {
      const deleted = await djenLocalService.deleteByIds(ids);
      setIntimations(prev => prev.filter(int => !ids.includes(int.id)));
      clearSelectedIds();
      toast.success('Intimações removidas', `${deleted} registro(s) excluído(s) com sucesso.`);
    } catch (err: any) {
      toast.error('Erro ao remover', err.message);
    }
  };

  const handleDeleteRead = async () => {
    setShowClearMenu(false);
    const confirmed = await confirmDelete({
      title: 'Remover intimações lidas',
      message: 'Remover todas as intimações marcadas como lidas? Esta ação é irreversível.',
      confirmLabel: 'Remover',
      permission: { module: 'intimacoes', action: 'delete' },
    });
    if (!confirmed) return;

    try {
      const deleted = await djenLocalService.deleteRead();
      if (deleted > 0) {
        await reloadIntimations();
        toast.success('Intimações removidas', `${deleted} intimação(ões) lidas foram excluídas.`);
      } else {
        toast.info('Nada a remover', 'Nenhuma intimação lida encontrada.');
      }
    } catch (err: any) {
      toast.error('Erro ao remover', err.message);
    }
  };

  // Vinculação automática: se nome da parte = nome do cliente, vincula automaticamente
  const autoLinkIntimations = useCallback(async (intimationsData: DjenComunicacaoLocal[], clientsData: Client[], processesData?: Process[]) => {
    console.log(`🔗 Iniciando vinculação automática: ${intimationsData.length} intimações, ${clientsData.length} clientes, ${processesData?.length || 0} processos`);
    
    if (!clientsData.length && !processesData?.length) {
      console.log(`❌ Sem dados para vinculação: clientes=${clientsData.length}, processos=${processesData?.length || 0}`);
      return 0;
    }
    
    // Criar mapa de nomes de clientes (normalizado) -> client_id
    const clientNameMap = new Map<string, string>();
    clientsData.forEach(client => {
      const normalizedName = (client.full_name || '').trim().toUpperCase();
      clientNameMap.set(normalizedName, client.id);
    });
    console.log(`👥 Mapa de clientes criado com ${clientNameMap.size} nomes`);

    // Criar mapa de números de processos -> process_id
    // Indexa por formato original E por dígitos apenas, para cobrir variações de formatação
    // entre o que o DJEN retorna e o que está cadastrado no CRM.
    const processNumberMap = new Map<string, string>();
    const toDigits = (v: string) => v.replace(/\D/g, '');
    if (processesData) {
      processesData.forEach(process => {
        const original = (process.process_code || '').trim().toUpperCase();
        const digits = toDigits(original);
        if (original) processNumberMap.set(original, process.id);
        if (digits && digits !== original) processNumberMap.set(digits, process.id);
      });
      console.log(`⚖️ Mapa de processos criado com ${processNumberMap.size} entradas`);
    }

    let linkedCount = 0;
    // Resumo no fim, em vez de uma linha por intimação: eram ~840 linhas por
    // passagem, e o StrictMode roda o efeito duas vezes em desenvolvimento. O
    // console ficava com 1.700 linhas de varredura afogando qualquer outra
    // coisa — inclusive os avisos de Realtime, que é onde se olha quando a tela
    // não atualiza. O que interessa aqui é quantas não tinham parte nenhuma
    // para casar, não o número de partes de cada uma.
    let semPartes = 0;

    for (const intimation of intimationsData) {
      // Pular se já tem cliente ou processo vinculado
      if (intimation.client_id && intimation.process_id) {
        continue;
      }
      
      // Buscar partes: primeiro dos destinatários, depois do texto
      const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
        ? intimation.djen_destinatarios.map(d => d.nome)
        : extractPartesFromTexto(htmlToText(intimation.texto || '')).map(p => p.nome);
      
      if (partes.length === 0) semPartes++;

      // Verificar se alguma parte corresponde a um cliente
      for (const parteNome of partes) {
        const normalizedParte = parteNome.trim().toUpperCase();
        const matchedClientId = clientNameMap.get(normalizedParte);
        
        if (matchedClientId && !intimation.client_id) {
          try {
            await djenLocalService.vincularCliente(intimation.id, matchedClientId);
            linkedCount++;
            // Sem o nome da parte: identifica pelo par de ids, que basta para
            // rastrear a vinculação sem publicar nome de cliente no console.
            console.log(
              `🔗 Vinculação automática: intimação ${intimation.id.substring(0, 8)} -> cliente ${matchedClientId.substring(0, 8)}`,
            );
            break; // Vincula apenas ao primeiro match
          } catch (err) {
            console.error(`Erro ao vincular automaticamente:`, err);
          }
        }
      }

      // Verificar se o número do processo corresponde a algum processo cadastrado.
      // Tenta primeiro o formato original, depois só dígitos, depois o numero_processo_mascara.
      if (!intimation.process_id) {
        const candidates = [
          intimation.numero_processo,
          intimation.numero_processo_mascara,
        ].filter(Boolean) as string[];

        let matchedProcessId: string | undefined;
        let matchedBy = '';

        for (const candidate of candidates) {
          const original = candidate.trim().toUpperCase();
          const digits = toDigits(original);
          matchedProcessId = processNumberMap.get(original) ?? processNumberMap.get(digits);
          if (matchedProcessId) { matchedBy = candidate; break; }
        }

        if (matchedProcessId) {
          try {
            await djenLocalService.vincularProcesso(intimation.id, matchedProcessId);
            linkedCount++;
            console.log(`🔗 Vinculação automática: processo "${matchedBy}" -> ${matchedProcessId.substring(0, 8)}`);
          } catch (err) {
            console.error(`Erro ao vincular processo automaticamente:`, err);
          }
        }
      }
    }
    
    if (linkedCount > 0) {
      console.log(`✅ ${linkedCount} intimação(ões) vinculada(s) automaticamente`);
    } else {
      // `semPartes` é o diagnóstico útil quando nada casa: distingue "não achou
      // parte para comparar" de "achou parte e nenhuma bateu com cliente".
      console.log(
        `ℹ️ Nenhuma intimação vinculada automaticamente (${semPartes} de ${intimationsData.length} sem parte identificável)`,
      );
    }
    
    return linkedCount;
  }, []);

// ...
  // Recarregar apenas intimações (sem flash/reload)
  const reloadIntimations = useCallback(async () => {
    try {
      const intimationsData = await djenLocalService.listComunicacoes();
      
      // Vinculação automática
      if (clients.length > 0) {
        const linked = await autoLinkIntimations(intimationsData, clients);
        if (linked && linked > 0) {
          // Recarregar para pegar os vínculos atualizados
          const updatedData = await djenLocalService.listComunicacoes();
          setIntimations(updatedData);
        } else {
          setIntimations(intimationsData);
        }
      } else {
        setIntimations(intimationsData);
      }

      // Carregar análises salvas do banco de dados
      const currentIntimations = intimationsData;
      if (currentIntimations.length > 0) {
        try {
          const intimationIds = intimationsData.map(int => int.id);
          console.log(`🔍 Buscando análises para ${intimationIds.length} intimação(ões)...`);
          const savedAnalyses = await intimationAnalysisService.getAnalysesByIntimationIds(intimationIds);
          
          // Converter para o formato usado pela aplicação
          const analysisMap = new Map<string, IntimationAnalysis>();
          savedAnalyses.forEach((dbAnalysis, intimationId) => {
            analysisMap.set(intimationId, intimationAnalysisService.convertToIntimationAnalysis(dbAnalysis));
          });
          
          setAiAnalysis(analysisMap);
          console.log(`✅ ${analysisMap.size} análise(s) recarregada(s) do banco de dados`);
          console.log(`📊 Intimações sem análise: ${intimationIds.length - analysisMap.size}`);
        } catch (err: any) {
          console.error('❌ Erro ao carregar análises salvas:', err);
        }
      }

    } catch (err: any) {
      console.error('Erro ao recarregar intimações:', err);
      toast.error('Erro ao atualizar', 'Não foi possível recarregar as intimações');
    }
  }, [clients, autoLinkIntimations]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [intimationsData, clientsData, processesData, membersData, userProfile, djenSettings] = await Promise.all([
        djenLocalService.listComunicacoes(),
        clientService.listClients(),
        processService.listProcesses(),
        profileService.listMembers(),
        profileService.getMyProfile(),
        settingsService.getDjenConfig(),
      ]);
      setIntimations(intimationsData);
      setClients(clientsData);
      setProcesses(processesData);
      setMembers(membersData);
      setCurrentUserProfile(userProfile);
      setGlobalDjenConfig(djenSettings);

      settingsService.getDeadlineModuleConfig().then(cfg => {
        if (cfg.statuses.length > 0)
          setDeadlineStatusOptions(cfg.statuses.filter(s => s.active !== false).map(s => ({ key: s.key as DeadlineStatus, label: s.label })));
        if (cfg.priorities.length > 0)
          setDeadlinePriorityOptions(cfg.priorities.filter(p => p.active !== false).map(p => ({ key: p.key as DeadlinePriority, label: p.label })));
        if (cfg.types.length > 0)
          setDeadlineTypeOptions(cfg.types.filter(t => t.active !== false).map(t => ({ key: t.key as DeadlineType, label: t.label })));
      }).catch(() => {});

      // Vinculação automática após carregar os dados
      if ((clientsData.length > 0 || processesData.length > 0) && intimationsData.length > 0) {
        console.log(`🔗 Iniciando vinculação automática no carregamento...`);
        const linked = await autoLinkIntimations(intimationsData, clientsData, processesData);
        if (linked && linked > 0) {
          console.log(`✅ ${linked} intimação(ões) vinculada(s) automaticamente`);
          // Recarregar para pegar os vínculos atualizados
          const updatedData = await djenLocalService.listComunicacoes();
          setIntimations(updatedData);
        }
      }
      
      // Integrar nomes dos advogados dos perfis com lawyers_to_monitor
      const lawyerNamesFromProfiles = membersData
        .filter((m: any) => m.lawyer_full_name?.trim())
        .map((m: any) => m.lawyer_full_name.trim());
      
      // Mesclar nomes do banco com nomes dos perfis (sem duplicatas)
      const mergedLawyers = Array.from(new Set([
        ...(djenSettings.lawyers_to_monitor || []),
        ...lawyerNamesFromProfiles,
      ]));
      
      setMonitoredLawyers(mergedLawyers);

      // Carregar análises salvas do banco de dados
      if (intimationsData.length > 0) {
        try {
          const intimationIds = intimationsData.map(int => int.id);
          const savedAnalyses = await intimationAnalysisService.getAnalysesByIntimationIds(intimationIds);
          
          // Converter para o formato usado pela aplicação
          const analysisMap = new Map<string, IntimationAnalysis>();
          savedAnalyses.forEach((dbAnalysis, intimationId) => {
            analysisMap.set(intimationId, intimationAnalysisService.convertToIntimationAnalysis(dbAnalysis));
          });
          
          setAiAnalysis(analysisMap);
          console.log(`✅ ${analysisMap.size} análise(s) carregada(s) do banco de dados`);
        } catch (err: any) {
          console.error('Erro ao carregar análises salvas:', err);
          // Não bloqueia o carregamento se falhar
        }
      }

    } catch (err: any) {
      toast.error('Erro ao carregar dados', err.message);
    } finally {
      setLoading(false);
      setInitialSnapshotLoaded(true);
      setHasCompletedInitialLoad(true);
    }
  }, []);

  // Carregar dados (sem análise automática - agora feita pelo cron)
  useEffect(() => {
    loadData();
    fetchSyncLogs();
  }, [loadData, fetchSyncLogs]);

  // Realtime: notificar e atualizar a lista quando chegar nova intimação
  useEffect(() => {
    const channel = supabase
      .channel('djen-comunicacoes-inserts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'djen_comunicacoes',
        },
        async () => {
          // Agrupar inserts em lote (cron costuma inserir várias intimações)
          realtimeInsertCountRef.current += 1;

          if (realtimeFlushTimerRef.current) {
            window.clearTimeout(realtimeFlushTimerRef.current);
          }

          realtimeFlushTimerRef.current = window.setTimeout(async () => {
            try {
              const now = Date.now();
              // proteção contra loops (ex.: múltiplos lotes muito próximos)
              if (now - lastRealtimeReloadAtRef.current < 500) return;
              lastRealtimeReloadAtRef.current = now;

              const count = realtimeInsertCountRef.current;
              realtimeInsertCountRef.current = 0;
              realtimeFlushTimerRef.current = null;

              // Recarrega e dispara análise automática de IA
              await reloadIntimations();

              toast.info(
                'Novas intimações',
                `${count} nova(s) intimação(ões) recebida(s) e a lista foi atualizada.`,
              );
            } catch (err: any) {
              console.error('Erro ao atualizar lista após realtime:', err);
            }
          }, 1500);
        },
      )
      .subscribe();

    return () => {
      if (realtimeFlushTimerRef.current) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      realtimeInsertCountRef.current = 0;
      supabase.removeChannel(channel);
    };
  }, [reloadIntimations, toast]);

  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  const performSync = useCallback(
    async (mode: 'manual' | 'auto') => {
      if (syncingRef.current) {
        console.log('⚠️ Sync já em andamento, ignorando...');
        return;
      }

      console.log(`🚀 Iniciando performSync (${mode})...`);
      syncingRef.current = true;
      setSyncing(true);

      try {
        let savedFromAdvocate = 0;
        let savedFromProcesses = 0;

        const lawyerNames = Array.from(
          new Set(
            [
              ...(monitoredLawyers || []).map((name) => name.trim()).filter(Boolean),
              currentUserProfile?.lawyer_full_name?.trim(),
            ].filter(Boolean) as string[],
          ),
        );

        if (lawyerNames.length === 0) {
          console.log('ℹ️ Nenhum advogado monitorado definido. Configure nas Configurações → DJEN.');
        }

        for (const lawyerName of lawyerNames) {
          console.log(`🔍 Buscando intimações para: ${lawyerName}`);
          const params: DjenConsultaParams = {
            nomeAdvogado: lawyerName,
            dataDisponibilizacaoInicio: djenService.getDataDiasAtras(7),
            dataDisponibilizacaoFim: djenService.getDataHoje(),
            meio: 'D',
            itensPorPagina: 100,
            pagina: 1,
          };

          try {
            const response = await djenService.consultarTodasComunicacoes(params);
            console.log(`📥 Resposta DJEN (${lawyerName}): ${response.items?.length || 0} itens`);

            if (response.items && response.items.length > 0) {
              const result = await djenLocalService.saveComunicacoes(response.items, {
                clients,
                processes,
              });
              savedFromAdvocate += result.saved;
            }
          } catch (djenErr: any) {
            console.error(`❌ Erro ao consultar DJEN para ${lawyerName}:`, djenErr);
          }
        }

        const processNumbers = Array.from(
          new Set(
            processes
              .map((process) => process.process_code?.trim())
              .filter((code): code is string => Boolean(code)),
          ),
        );

        console.log(`📋 Processos para buscar: ${processNumbers.length}`);
        
        if (processNumbers.length > 0) {
          try {
            const processResponse = await djenService.consultarPorProcessos(processNumbers, {
              dataDisponibilizacaoInicio: djenService.getDataDiasAtras(7),
              dataDisponibilizacaoFim: djenService.getDataHoje(),
              meio: 'D',
              itensPorPagina: 100,
              pagina: 1,
            });
            console.log(`📥 Resposta DJEN (processos): ${processResponse.items?.length || 0} itens`);

            if (processResponse.items && processResponse.items.length > 0) {
              const result = await djenLocalService.saveComunicacoes(processResponse.items, {
                clients,
                processes,
              });
              savedFromProcesses = result.saved;
              console.log(`💾 Salvos dos processos: ${savedFromProcesses}`);
            }
          } catch (procErr: any) {
            console.error('❌ Erro ao consultar DJEN por processos:', procErr);
          }
        }

        // Reparar registros com numero_processo nulo
        try {
          await djenLocalService.repairNullNumeroProcesso();
        } catch (repairErr: any) {
          console.error('Erro ao reparar numero_processo nulo:', repairErr);
        }

        // Limpar intimações antigas (mais de 30 dias)
        try {
          const cleanResult = await djenLocalService.cleanOldIntimations(30);
          if (cleanResult.deleted > 0 && mode === 'manual') {
            console.log(`🗑️ ${cleanResult.deleted} intimação(ões) antiga(s) removida(s)`);
          }
        } catch (cleanErr: any) {
          console.error('Erro ao limpar intimações antigas:', cleanErr);
          // Não bloqueia o fluxo se falhar
        }

        // Recarregar apenas intimações (sem flash)
        const totalSaved = savedFromAdvocate + savedFromProcesses;
        await reloadIntimations();

        if (mode === 'manual') {
          if (totalSaved > 0) {
            toast.success(
              'Sincronização concluída',
              `${totalSaved} nova(s) intimação(ões) importada(s).`,
            );
          } else {
            toast.info('Sincronização concluída', 'Nenhuma intimação nova encontrada');
          }
        }
        fetchSyncLogs();
      } catch (err: any) {
        console.error('❌ Erro no sync:', err);
        if (mode === 'manual') {
          toast.error('Erro ao sincronizar', err.message);
        }
      } finally {
        console.log('✅ Sync finalizado');
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [processes, clients, currentUserProfile, reloadIntimations, fetchSyncLogs, toast]
  );

  const getLastSyncDate = useCallback((): Date | null => {
    if (!djenRunSyncCronLog) return null;
    const lastLog = djenRunSyncCronLog;
    const value = lastLog.run_finished_at || lastLog.run_started_at || lastLog.created_at;
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    return null;
  }, [djenRunSyncCronLog]);

  // Sincronização automática é feita pelo cron do Supabase (2x/dia)

  const lastSyncLabel = useMemo(() => {
    const date = getLastSyncDate();
    if (!date) return 'Nunca sincronizado';

    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [getLastSyncDate]);

  const handleSync = useCallback(async () => {
    await performSync('manual');
  }, [performSync]);

  // Analisar uma única intimação com IA (disparado manualmente)
  const handleAnalyzeSingle = useCallback(async (intimation: DjenComunicacaoLocal) => {
    if (!aiService.isEnabled()) {
      toast.error('IA não configurada', 'O serviço de IA está indisponível no momento.');
      return;
    }
    if (analyzingIds.has(intimation.id)) return;
    setAnalyzingIds(prev => new Set(prev).add(intimation.id));
    try {
      const result = await aiService.analyzeIntimation(
        intimation.texto || '',
        intimation.numero_processo || '',
        intimation.data_disponibilizacao || new Date().toISOString(),
        intimation.tipo_documento || undefined,
        intimation.tipo_comunicacao || undefined,
      );
      await intimationAnalysisService.saveAnalysis(intimation.id, result, user?.id);
      setAiAnalysis(prev => {
        const next = new Map(prev);
        next.set(intimation.id, result);
        return next;
      });
      toast.success('Análise concluída', 'A IA analisou a intimação com sucesso.');
    } catch (err: any) {
      toast.error('Erro na análise', err.message || 'Falha ao analisar com IA.');
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(intimation.id);
        return next;
      });
    }
  }, [analyzingIds, user, toast]);

  // Handlers de exportação
  const handleExportCSV = () => {
    exportToCSV(filteredIntimations, aiAnalysis);
    toast.success('Exportado', 'Relatório CSV baixado com sucesso');
    setShowExportMenu(false);
  };

  const handleExportExcel = () => {
    exportToExcel(filteredIntimations, aiAnalysis);
    toast.success('Exportado', 'Relatório Excel baixado com sucesso');
    setShowExportMenu(false);
  };

  const handleExportPDF = () => {
    exportToPDF(filteredIntimations, aiAnalysis);
    setShowExportMenu(false);
  };

  // Sincronização automática movida para cron no Supabase


  // Desfaz a leitura: volta as intimações para não lidas e reabre no sino
  // apenas as notificações que a própria marcação tinha fechado.
  const undoMarkAsRead = async (ids: string[], notificationIds: string[]) => {
    try {
      if (ids.length === 1) {
        await djenLocalService.desmarcarComoLida(ids[0]);
      } else {
        await djenLocalService.desmarcarComoLidas(ids);
      }

      const alvo = new Set(ids);
      setIntimations(prev => prev.map(int =>
        alvo.has(int.id) ? { ...int, lida: false, lida_em: null } : int
      ));

      if (notificationIds.length > 0) {
        try {
          await userNotificationService.markAsUnreadByIds(notificationIds);
        } catch {}
      }

      events.emit(SYSTEM_EVENTS.DASHBOARD_REFRESH);
      toast.success(
        'Marcação desfeita',
        ids.length === 1
          ? 'A intimação voltou para não lida'
          : `${ids.length} intimações voltaram para não lidas`,
      );
    } catch (err: any) {
      toast.error('Erro ao desfazer', err.message);
    }
  };

  // Caminho único de "marcar como lida": um toast só, com a opção de desfazer.
  const markAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;

    try {
      if (ids.length === 1) {
        await djenLocalService.marcarComoLida(ids[0]);
      } else {
        // Passa os IDs explicitamente para evitar UPDATE cego na tabela (sem escopo de office)
        await djenLocalService.marcarTodasComoLidas(ids);
      }

      // Atualizar estado local sem recarregar tudo
      const lidaEm = new Date().toISOString();
      const alvo = new Set(ids);
      setIntimations(prev => prev.map(int =>
        alvo.has(int.id) ? { ...int, lida: true, lida_em: lidaEm } : int
      ));

      // 🔔 Marcar notificações correspondentes como lidas
      let notificationIds: string[] = [];
      if (user?.id) {
        try {
          notificationIds = await userNotificationService.markAsReadByIntimationIds(ids, user.id);
        } catch {}
      }

      events.emit(SYSTEM_EVENTS.DASHBOARD_REFRESH);

      const toastId = toast.toast(
        'success',
        ids.length === 1 ? 'Marcado como lida' : `${ids.length} intimações marcadas como lidas`,
        {
          // Janela maior que o padrão: o "desfazer" só serve se ainda estiver
          // na tela quando o usuário percebe que marcou errado.
          duration: 15000,
          action: {
            label: 'Desfazer',
            icon: <RotateCcw className="h-3.5 w-3.5" />,
            onClick: () => {
              toast.dismiss(toastId);
              void undoMarkAsRead(ids, notificationIds);
            },
          },
        },
      );
    } catch (err: any) {
      toast.error('Erro ao marcar', err.message);
    }
  };

  const handleMarkAsRead = (id: string) => markAsRead([id]);

  const handleClearAllIntimations = async () => {
    if (clearingAll) return;

    const confirmed = await confirmDelete({
      title: 'Remover todas as intimações',
      message: 'Tem certeza que deseja remover todas as intimações sincronizadas? Esta ação não pode ser desfeita.',
      confirmLabel: 'Remover todas',
      permission: { module: 'intimacoes', action: 'delete' },
    });

    if (!confirmed) {
      return;
    }

    try {
      setClearingAll(true);
      await djenLocalService.clearAll();
      await reloadIntimations();
      toast.success('Intimações removidas', 'Faça uma nova sincronização quando desejar');
    } catch (err: any) {
      toast.error('Erro ao remover', err.message);
    } finally {
      setClearingAll(false);
      setShowClearMenu(false);
    }
  };

  // Marcar todas como lidas
  const handleMarkAllAsRead = async () => {
    const unreadIds = intimations.filter(int => !int.lida).map(int => int.id);
    if (unreadIds.length === 0) {
      toast.info('Info', 'Nenhuma intimação não lida encontrada');
      return;
    }
    await markAsRead(unreadIds);
  };

  // Vincular em lote
  const handleBatchLink = async () => {
    if (!selectedProcessId && !selectedClientId) {
      toast.error('Erro', 'Selecione um processo ou cliente para vincular');
      return;
    }
    try {
      let updated = 0;
      for (const id of Array.from(selectedIds)) {
        const payload: UpdateDjenComunicacaoDTO = {};
        if (selectedProcessId) payload.process_id = selectedProcessId;
        if (selectedClientId) payload.client_id = selectedClientId;
        await djenLocalService.updateComunicacao(id, payload);
        updated++;
      }
      await reloadIntimations();
      disableSelectionMode();
      toast.success('Sucesso', `${updated} intimações vinculadas`);
    } catch (err: any) {
      toast.error('Erro', err.message);
    }
  };

  // Marcar selecionadas como lidas
  const handleMarkSelectedAsRead = async () => {
    if (selectedIds.size === 0) return;

    await markAsRead(Array.from(selectedIds));
    disableSelectionMode();
  };

  // Exportar selecionadas
  const handleExportSelected = () => {
    const selected = intimations.filter(int => selectedIds.has(int.id));
    if (selected.length === 0) {
      toast.error('Erro', 'Nenhuma intimação selecionada');
      return;
    }
    exportToCSV(selected, aiAnalysis);
    toast.success('Exportado', `${selected.length} intimações exportadas`);
    setShowExportMenu(false);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIntimationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Abrir modal de vínculo
  const handleOpenLinkModal = (intimation: DjenComunicacaoLocal) => {
    setLinkingIntimation(intimation);
    setSelectedClientId(intimation.client_id || '');
    const existingProcess = intimation.process_id ? processes.find(p => p.id === intimation.process_id) : null;
    setSelectedProcessId(intimation.process_id || '');
    setSelectedProcessName(existingProcess?.process_code || '');
    setProcessSearchTerm('');
    setProcessDropdownOpen(false);
    setCreatingProcess(false);
    setNewProcessCode(intimation.numero_processo_mascara || intimation.numero_processo || '');
    setNewProcessArea('civel');
    setLinkModalOpen(true);
  };

  // Salvar vínculos
  const handleSaveLinks = async () => {
    if (!linkingIntimation) return;

    try {
      if (selectedClientId) {
        await djenLocalService.vincularCliente(linkingIntimation.id, selectedClientId);
      }
      if (selectedProcessId) {
        await djenLocalService.vincularProcesso(linkingIntimation.id, selectedProcessId);
      }

      await reloadIntimations();
      setLinkModalOpen(false);
      toast.success('Vínculos salvos');
    } catch (err: any) {
      toast.error('Erro ao salvar', err.message);
    }
  };

  // Criar processo novo e vincular à intimação sem sair do módulo
  const handleCreateAndLinkProcess = async () => {
    if (!linkingIntimation || !selectedClientId || !newProcessCode.trim()) return;
    setNewProcessSaving(true);
    try {
      const created = await processService.createProcess({
        client_id: selectedClientId,
        process_code: newProcessCode.trim(),
        practice_area: newProcessArea,
        status: 'distribuido',
        distributed_at: linkingIntimation.data_disponibilizacao?.split('T')[0] || null,
        court: linkingIntimation.nome_orgao || null,
        djen_synced: true,
        djen_has_data: true,
      });
      await djenLocalService.vincularCliente(linkingIntimation.id, selectedClientId);
      await djenLocalService.vincularProcesso(linkingIntimation.id, created.id);
      const [updatedProcesses] = await Promise.all([
        processService.listProcesses(),
        reloadIntimations(),
      ]);
      setProcesses(updatedProcesses);
      setLinkModalOpen(false);
      toast.success('Processo criado', 'Processo criado e intimação vinculada com sucesso');
    } catch (err: any) {
      toast.error('Erro ao criar processo', err.message);
    } finally {
      setNewProcessSaving(false);
    }
  };

  // Filtrar intimações
  const filteredIntimations = useMemo(() => {
    let filtered = intimations;
    const normalizeDigits = (value: string) => value.replace(/\D/g, '');
    const processCodeById = new Map<string, string>();
    processes.forEach((p) => {
      if (p.id && p.process_code) {
        processCodeById.set(p.id, p.process_code);
      }
    });

    // Filtro de status
    if (statusFilter === 'unread') {
      filtered = filtered.filter((i) => !i.lida);
    } else if (statusFilter === 'read') {
      filtered = filtered.filter((i) => i.lida);
    } else if (statusFilter === 'linked') {
      filtered = filtered.filter(isLinked);
    } else if (statusFilter === 'unlinked') {
      filtered = filtered.filter(isUnlinked);
    }

    // Filtro de tribunal
    if (tribunalFilter !== 'all') {
      filtered = filtered.filter((i) => i.sigla_tribunal === tribunalFilter);
    }

    // Filtro de urgência
    if (urgencyFilter !== 'all') {
      filtered = filtered.filter((i) => {
        const analysis = aiAnalysis.get(i.id);
        return analysis && analysis.urgency === urgencyFilter;
      });
    }

    // Filtro de data
    if (dateFilter !== 'all') {
      const now = new Date();
      let daysAgo = 30;
      
      if (dateFilter === '60days') daysAgo = 60;
      else if (dateFilter === '90days') daysAgo = 90;
      
      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      
      filtered = filtered.filter((i) => {
        const intimationDate = new Date(i.data_disponibilizacao);
        return intimationDate >= cutoffDate;
      });
    }

    // Filtro de data customizado
    if (customDateStart) {
      const startDate = new Date(customDateStart);
      filtered = filtered.filter((i) => {
        const intimationDate = new Date(i.data_disponibilizacao);
        return intimationDate >= startDate;
      });
    }

    if (customDateEnd) {
      const endDate = new Date(customDateEnd);
      endDate.setHours(23, 59, 59, 999); // Fim do dia
      filtered = filtered.filter((i) => {
        const intimationDate = new Date(i.data_disponibilizacao);
        return intimationDate <= endDate;
      });
    }

    // Busca (melhorada para normalizar número do processo e incluir cliente)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const termDigits = normalizeDigits(term);
      filtered = filtered.filter(
        (i) => {
          const processId = (i as any).process_id as string | null | undefined;
          const processCode = processId ? processCodeById.get(processId) : undefined;
          const processCodeLower = processCode?.toLowerCase();
          const processCodeDigits = processCode ? normalizeDigits(processCode) : '';

          const numeroProcessoLower = i.numero_processo?.toLowerCase();
          const numeroProcessoMascaraLower = i.numero_processo_mascara?.toLowerCase();
          const numeroProcessoDigits = i.numero_processo ? normalizeDigits(i.numero_processo) : '';
          const numeroProcessoMascaraDigits = i.numero_processo_mascara ? normalizeDigits(i.numero_processo_mascara) : '';

          // Busca por nome do cliente
          const clientName = getClientName(i.client_id);
          const clientMatch = matchesNormalizedSearch(term, [clientName || '']);

          return (
            numeroProcessoLower?.includes(term) ||
            numeroProcessoMascaraLower?.includes(term) ||
            processCodeLower?.includes(term) ||
            matchesNormalizedSearch(term, [i.texto || '']) ||
            matchesNormalizedSearch(term, [i.nome_orgao || '']) ||
            clientMatch ||
            (Boolean(termDigits) && (numeroProcessoDigits.includes(termDigits) || numeroProcessoMascaraDigits.includes(termDigits) || processCodeDigits.includes(termDigits)))
          );
        }
      );
    }

    return filtered;
  }, [intimations, processes, statusFilter, tribunalFilter, dateFilter, customDateStart, customDateEnd, searchTerm, urgencyFilter, aiAnalysis, clients]);

  // Lista de tribunais únicos
  const availableTribunals = useMemo(() => {
    const tribunals = new Set<string>();
    intimations.forEach((i) => {
      if (i.sigla_tribunal) {
        tribunals.add(i.sigla_tribunal);
      }
    });
    return Array.from(tribunals).sort();
  }, [intimations]);

  // Base filtrada sem statusFilter — usada para contar as abas corretamente.
  // Garante que os contadores reflitam apenas o que o filtro ativo deixa passar,
  // evitando o bug onde a aba mostra "37" mas a lista está vazia.
  const baseFiltered = useMemo(() => {
    let f = intimations;
    if (tribunalFilter !== 'all') f = f.filter((i) => i.sigla_tribunal === tribunalFilter);
    if (urgencyFilter !== 'all') f = f.filter((i) => {
      const analysis = aiAnalysis.get(i.id);
      return analysis && analysis.urgency === urgencyFilter;
    });
    if (dateFilter !== 'all') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (dateFilter === '60days' ? 60 : dateFilter === '90days' ? 90 : 30));
      f = f.filter((i) => new Date(i.data_disponibilizacao) >= cutoff);
    }
    if (customDateStart) f = f.filter((i) => new Date(i.data_disponibilizacao) >= new Date(customDateStart));
    if (customDateEnd) {
      const end = new Date(customDateEnd);
      end.setHours(23, 59, 59, 999);
      f = f.filter((i) => new Date(i.data_disponibilizacao) <= end);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      f = f.filter((i) =>
        i.numero_processo?.toLowerCase().includes(term) ||
        i.numero_processo_mascara?.toLowerCase().includes(term) ||
        i.texto?.toLowerCase().includes(term)
      );
    }
    return f;
  }, [intimations, tribunalFilter, urgencyFilter, dateFilter, customDateStart, customDateEnd, searchTerm, aiAnalysis]);

  // Contadores das abas — derivados do baseFiltered para ficarem em sincronia com os filtros ativos
  const unreadCount = baseFiltered.filter((i) => !i.lida).length;
  const readCount = baseFiltered.filter((i) => i.lida).length;
  // Total de não lidas em todo o banco (sem filtro de data) — usado para o botão "marcar todas como lidas"
  const totalUnreadAllTime = intimations.filter((i) => !i.lida).length;

  const newTodayCount = useMemo(() => {
    const startOfDay = startOfToday();
    return intimations.filter((i) => {
      if (!i.data_disponibilizacao) return false;
      const date = new Date(i.data_disponibilizacao);
      return date >= startOfDay;
    }).length;
  }, [intimations]);

  const newWeekCount = useMemo(() => {
    const sevenDaysAgo = subDays(new Date(), 7);
    return intimations.filter((i) => {
      if (!i.data_disponibilizacao) return false;
      const date = new Date(i.data_disponibilizacao);
      return date >= sevenDaysAgo;
    }).length;
  }, [intimations]);

  const aiCoverage = useMemo(() => {
    if (intimations.length === 0) return 0;
    const totalAnalyzed = aiAnalysis.size;
    return Math.round((totalAnalyzed / intimations.length) * 100);
  }, [intimations.length, aiAnalysis]);

  const totalAnalyzedCount = useMemo(() => aiAnalysis.size, [aiAnalysis]);

  const externalCronUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/#/cron/djen?action=djen-sync&token=${moduleSettings.externalCronToken}`;
  }, [moduleSettings.externalCronToken]);

  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const quickNavItems = [
    {
      key: 'overview',
      label: 'Resumo Geral',
      description: 'Status do cron e indicadores',
      icon: <Sparkles className="w-4 h-4" />,
      bg: 'bg-[#f8f7f5]',
      text: 'text-[#031636]',
      target: overviewSectionRef,
    },
    {
      key: 'settings',
      label: 'Configurações',
      description: 'Token externo e preferências',
      icon: <FileCog className="w-4 h-4" />,
      bg: 'bg-[#f8f7f5]',
      text: 'text-[#031636]',
      target: configSectionRef,
    },
    {
      key: 'filters',
      label: 'Filtros & Agrupamento',
      description: 'Controle de visualização e busca',
      icon: <Filter className="w-4 h-4" />,
      bg: 'bg-[#f8f7f5]',
      text: 'text-[#031636]',
      target: filterSectionRef,
    },
    {
      key: 'list',
      label: 'Lista de Intimações',
      description: 'Gerencie comunicações e ações',
      icon: <FileText className="w-4 h-4" />,
      bg: 'bg-[#f8f7f5]',
      text: 'text-[#031636]',
      target: listSectionRef,
    },
  ];

  // Agrupamento por processo
  const groupedByProcess = useMemo(() => {
    if (!groupByProcess) return null;
    const processCodeById = new Map<string, string>();
    processes.forEach((p) => {
      if (p.id && p.process_code) {
        processCodeById.set(p.id, p.process_code);
      }
    });

    const groups = new Map<string, DjenComunicacaoLocal[]>();
    filteredIntimations.forEach((intimation) => {
      const processId = (intimation as any).process_id as string | null | undefined;
      const processCode = processId ? processCodeById.get(processId) : undefined;
      const isSigiloso = !intimation.numero_processo && !intimation.numero_processo_mascara
        && (intimation.texto || '').toLowerCase().includes('sigiloso');
      const processKey = processCode || intimation.numero_processo_mascara || intimation.numero_processo
        || (isSigiloso ? '🔒 Processo Sigiloso' : 'Sem número');
      if (!groups.has(processKey)) {
        groups.set(processKey, []);
      }
      groups.get(processKey)!.push(intimation);
    });

    return groups;
  }, [groupByProcess, filteredIntimations, processes]);

  // Helpers
  const getClientName = (clientId: string | null) => {
    if (!clientId) return null;
    return clients.find((c) => c.id === clientId)?.full_name || 'Cliente não encontrado';
  };

  const getProcessCode = (processId: string | null) => {
    if (!processId) return null;
    return processes.find((p) => p.id === processId)?.process_code || 'Processo não encontrado';
  };

  const getLinkedProcess = (intimation: DjenComunicacaoLocal): Process | undefined => {
    if (intimation.process_id) {
      const linkedProcess = processes.find((process) => process.id === intimation.process_id);
      if (linkedProcess) return linkedProcess;
    }

    const intimationNumber = (
      intimation.numero_processo_mascara || intimation.numero_processo || ''
    ).replace(/\D/g, '');
    if (!intimationNumber) return undefined;

    return processes.find(
      (process) => (process.process_code || '').replace(/\D/g, '') === intimationNumber,
    );
  };

  const openLinkedProcess = (
    event: React.MouseEvent,
    intimation: DjenComunicacaoLocal,
  ) => {
    event.stopPropagation();
    const linkedProcess = getLinkedProcess(intimation);
    if (!linkedProcess) return;

    setQuickViewProcessId(linkedProcess.id);
  };

  const formatDate = (dateStr: Date | string): string => {
    try {
      return formatDateValue(dateStr);
    } catch {
      return typeof dateStr === 'string' ? dateStr : dateStr.toISOString().slice(0, 10);
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return formatDateTimeValue(dateStr);
    } catch {
      return dateStr;
    }
  };

  const linkedProcessesCount = useMemo(() => {
    const set = new Set<string>();
    intimations.forEach((intimation) => {
      if (intimation.process_id) {
        set.add(intimation.process_id);
      }
    });
    return set.size;
  }, [intimations]);

  const aiUrgencyStats = useMemo(() => {
    const stats = { alta: 0, media: 0, baixa: 0, unreadAnalyzed: 0 };
    intimations.forEach((intimation) => {
      if (intimation.lida) return;
      const analysis = aiAnalysis.get(intimation.id);
      if (!analysis) return;
      stats.unreadAnalyzed++;
      if (analysis.urgency === 'alta') stats.alta++;
      else if (analysis.urgency === 'media') stats.media++;
      else if (analysis.urgency === 'baixa') stats.baixa++;
    });
    return stats;
  }, [intimations, aiAnalysis]);

  const lastCronRun = djenRunSyncCronLog;
  const lastRunDateValue = lastCronRun
    ? lastCronRun.run_finished_at || lastCronRun.run_started_at || lastCronRun.created_at || null
    : null;
  const lastRunDateObj = lastRunDateValue ? new Date(lastRunDateValue) : null;
  const nextCronRunDate = useMemo(() => {
    if (lastCronRun?.next_run_at) {
      return new Date(lastCronRun.next_run_at);
    }
    if (lastCronRun?.run_finished_at) {
      const nextDate = new Date(lastCronRun.run_finished_at);
      nextDate.setHours(nextDate.getHours() + 6);
      return nextDate;
    }
    return null;
  }, [lastCronRun]);

  const formatRelativeTime = (date?: Date | null) => {
    if (!date) return null;
    const diff = date.getTime() - Date.now();
    const hours = Math.round(diff / (1000 * 60 * 60));
    if (Math.abs(hours) >= 24) {
      return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (hours > 0) return `em ${hours}h`;
    if (hours === 0) return 'em instantes';
    return `há ${Math.abs(hours)}h`;
  };

  const lastRunRelative = formatRelativeTime(lastRunDateObj);
  const lastRunFormatted = lastRunDateObj
    ? lastRunDateObj.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const nextRunRelative = formatRelativeTime(nextCronRunDate);
  const nextRunFormatted = nextCronRunDate
    ? nextCronRunDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const getStatusBadgeClass = (status?: string | null) => {
    if (!status) return 'bg-white text-slate-600 border border-[#e7e5df]';
    const normalized = status.toLowerCase();
    if (['success', 'completed', 'ok'].some((tag) => normalized.includes(tag))) {
      return 'bg-white text-emerald-700 border border-emerald-300';
    }
    if (['error', 'failed'].some((tag) => normalized.includes(tag))) {
      return 'bg-white text-red-700 border border-red-300';
    }
    if (['running', 'processing', 'partial'].some((tag) => normalized.includes(tag))) {
      return 'bg-[#f8f7f5] text-slate-600 border border-[#e7e5df]';
    }
    return 'bg-white text-slate-600 border border-[#e7e5df]';
  };

  // Criar prazo a partir da intimação
  const handleCreateDeadline = (intimation: DjenComunicacaoLocal) => {
    setCurrentIntimationForAction(intimation);
    setDeadlineModalOpen(true);
  };

  // Criar compromisso a partir da intimação
  const handleCreateAppointment = (intimation: DjenComunicacaoLocal) => {
    setCurrentIntimationForAction(intimation);
    setAppointmentModalOpen(true);
  };

  // Abrir modal de prescrição
  const handleOpenPrescriptionModal = (intimation: DjenComunicacaoLocal) => {
    setCurrentIntimationForAction(intimation);
    setPrescriptionBaseDate('');
    setPrescriptionError(null);
    setPrescriptionSuccess(null);
    setPrescriptionModalOpen(true);
  };

  // Criar evento de prescrição na agenda
  const handleCreatePrescriptionEvent = async () => {
    if (!currentIntimationForAction) return;
    setPrescriptionError(null);
    setPrescriptionSuccess(null);

    const trimmed = prescriptionBaseDate.trim();
    if (!trimmed) {
      setPrescriptionError('Informe a data-base do sobrestamento.');
      return;
    }

    const base = new Date(trimmed);
    if (Number.isNaN(base.getTime())) {
      setPrescriptionError('Data-base inválida.');
      return;
    }

    try {
      setSavingPrescription(true);

      // Calcular datas: prescrição = base + 24 meses, alerta = base + 18 meses
      const addMonths = (date: Date, months: number) => {
        const d = new Date(date);
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + months);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
        return d;
      };

      const prescriptionDate = addMonths(base, 24);
      const alertDate = addMonths(base, 18);

      const formatDateBR = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      const formatLocalDateTime = (d: Date, hour: number, minute: number = 0) => {
        d.setHours(hour, minute, 0, 0);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
      };

      const processCode = currentIntimationForAction.numero_processo_mascara || currentIntimationForAction.numero_processo;
      const title = `Prescrição (Execução Sobrestada) • ${processCode}`;
      const description =
        `Data-base do sobrestamento: ${formatDateBR(base)}\n` +
        `Prescrição estimada: ${formatDateBR(prescriptionDate)}\n` +
        `Aviso (6 meses antes): ${formatDateBR(alertDate)}\n` +
        `Origem: Intimação DJEN`;

      await calendarService.createEvent({
        title,
        description,
        event_type: 'deadline',
        status: 'pendente',
        start_at: formatLocalDateTime(alertDate, 9, 0),
        notify_minutes_before: null,
        process_id: currentIntimationForAction.process_id || null,
        client_id: currentIntimationForAction.client_id || null,
      });

      setPrescriptionSuccess('Compromisso de prescrição criado na agenda com sucesso.');
      toast.success('Sucesso', 'Compromisso de prescrição criado na agenda.');
      setPrescriptionModalOpen(false);
      setCurrentIntimationForAction(null);
    } catch (err: any) {
      setPrescriptionError(err?.message || 'Não foi possível criar o compromisso.');
    } finally {
      setSavingPrescription(false);
    }
  };

  if (showInitialSkeleton) {
    return <IntimationsSkeleton rows={8} />;
  }

  // ── helpers de urgência ──────────────────────────────────────────────
  // Detecta resultado do julgamento a partir do resumo da IA.
  // A leitura mora em src/utils/intimationOutcome.ts (puro e testado); aqui só as cores.
  // Ganhou / perdeu / no meio. Sem preenchimento: o selo informa, não grita —
  // quem grita é a urgência, e só ela.
  const outcomeStyles: Record<IntimationOutcomeKind, string> = {
    procedente:       'bg-white text-emerald-700 border-emerald-300',
    improcedente:     'bg-white text-red-700 border-red-300',
    parcial:          'bg-white text-slate-700 border-[#d8d5cd]',
    tutela_concedida: 'bg-white text-emerald-700 border-emerald-300',
    tutela_negada:    'bg-white text-red-700 border-red-300',
    condenacao:       'bg-white text-red-700 border-red-300',
  };

  const detectOutcome = (summary?: string): { label: string; cls: string } | null => {
    const outcome = detectIntimationOutcome(summary);
    return outcome ? { label: outcome.label, cls: outcomeStyles[outcome.kind] } : null;
  };

  // ── Classificação de ações sugeridas pela IA ────────────────────────
  type ActionType = 'prazo' | 'audiencia' | 'pagamento' | 'vinculo' | 'prescricao' | 'info';

  const parseAction = (raw: string): { type: ActionType; label: string } => {
    // Estruturado: começa com [TAG]
    const tagMatch = raw.match(/^\[([^\]]+)\]\s*/i);
    if (tagMatch) {
      const tag = tagMatch[1].toUpperCase();
      const label = raw.slice(tagMatch[0].length).trim();
      if (tag === 'PRAZO') return { type: 'prazo', label };
      if (tag === 'AUDIÊNCIA' || tag === 'AUDIENCIA') return { type: 'audiencia', label };
      if (tag === 'PAGAMENTO') return { type: 'pagamento', label };
      if (tag === 'VÍNCULO' || tag === 'VINCULO') return { type: 'vinculo', label };
      if (tag === 'PRESCRIÇÃO' || tag === 'PRESCRICAO') return { type: 'prescricao', label };
      if (tag === 'INFO') return { type: 'info', label };
    }
    // Fallback: regex por palavras-chave (análises antigas sem tags)
    const txt = raw.toLowerCase();
    if (/audi[eê]ncia|audiencia|sess[aã]o.*instruc|julgamento.*oral/.test(txt)) return { type: 'audiencia', label: raw };
    if (/pagar|pagamento|custar?|custas|depositar|recolher|honor[aá]rio|indeniza[cç]/.test(txt)) return { type: 'pagamento', label: raw };
    if (/vincular|vincula[cç]/.test(txt)) return { type: 'vinculo', label: raw };
    if (/prescri[cç]|decad[eê]ncia/.test(txt)) return { type: 'prescricao', label: raw };
    if (/prazo|dias\s*[úu]teis|interpor|protocolar|contestar|embargar|contrarraz|recorrer/.test(txt)) return { type: 'prazo', label: raw };
    return { type: 'info', label: raw };
  };

  const actionTypeConfig: Record<ActionType, {
    icon: React.FC<any>;
    cls: string;
    badge: string;
    onClick: (intimation: DjenComunicacaoLocal) => void;
  }> = {
    prazo:      { icon: Clock,         cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]',       badge: 'Prazo',       onClick: (i) => handleCreateDeadline(i) },
    audiencia:  { icon: CalendarIcon,  cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]',   badge: 'Audiência',   onClick: (i) => handleCreateAppointment(i) },
    pagamento:  { icon: Banknote,      cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]', badge: 'Pagamento',  onClick: (_i) => onNavigateToModule?.('financeiro') },
    vinculo:    { icon: Link2,         cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]',            badge: 'Vínculo',     onClick: (i) => handleOpenLinkModal(i) },
    prescricao: { icon: ShieldAlert,   cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]',   badge: 'Prescrição',  onClick: (i) => handleOpenPrescriptionModal(i) },
    info:       { icon: Lightbulb,     cls: 'bg-white text-slate-700 border-[#e7e5df] hover:bg-[#f8f7f5]',       badge: '',            onClick: (_i) => {} },
  };

  // Uma cor só, em intensidades: vermelho responde "isto exige ação minha?".
  // Laranja e âmbar saíram daqui — eram cor sem pergunta, e competiam com o
  // âmbar dos botões e o âmbar do prazo.
  const urgencyConfig = {
    critica: { border: 'border-l-red-600',       dot: 'bg-red-600',    badge: 'bg-red-600 text-white border-red-600',        label: 'Crítica' },
    alta:    { border: 'border-l-red-300',       dot: 'bg-red-400',    badge: 'bg-white text-red-700 border-red-300',        label: 'Alta' },
    media:   { border: 'border-l-slate-200',     dot: 'bg-slate-400',  badge: 'bg-white text-slate-600 border-[#d8d5cd]',    label: 'Média' },
    baixa:   { border: 'border-l-transparent',   dot: 'bg-slate-300',  badge: 'bg-white text-slate-400 border-[#e7e5df]',    label: 'Baixa' },
  };

  // ── highlight text using AI passages + light structural markers ──────
  //
  // Strategy: legal texts from DJEN often have \r\n, double spaces, tabs.
  // The AI returns clean prose. We use two-pass matching:
  //   Pass 1 — direct indexOf (fast path, works when text is clean)
  //   Pass 2 — split passage into words, build regex with [\s]{0,25} between
  //             each word so whitespace differences don't break the match.
  const findPassageInText = (haystack: string, passage: string): { start: number; end: number } | null => {
    if (!passage || passage.trim().length < 10) return null;
    // Pass 1: direct
    const direct = haystack.toLowerCase().indexOf(passage.toLowerCase());
    if (direct !== -1) return { start: direct, end: direct + passage.length };
    // Pass 2: whitespace-flexible regex
    const words = passage.trim().split(/\s+/).filter(w => w.length >= 2);
    if (words.length < 3) return null;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // [\s]{0,25} allows up to 25 whitespace chars (spaces, \n, \r\n, tabs) between words
    const pattern = words.map(esc).join('[\\s]{0,25}');
    try {
      const rx = new RegExp(pattern, 'i');
      const m = rx.exec(haystack);
      if (m) return { start: m.index, end: m.index + m[0].length };
    } catch { /* ignore malformed pattern */ }
    return null;
  };

  const highlightText = (rawText: string, _importantPassages?: string[]): React.ReactNode => {
    if (!rawText) return null;
    return htmlToText(rawText);
  };

  return (
    <div>
      <div className="rounded-none overflow-hidden border border-[#e7e5df] bg-[#f8f7f5]">

        {/* Cabeçalho — cor da marca (#031636) para ação; o resto é neutro. */}
        <div className="px-5 py-4 border-b border-[#e7e5df] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 border border-[#e7e5df] bg-white flex items-center justify-center flex-shrink-0">
              <Gavel className="w-4 h-4 text-[#031636]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[#031636] leading-tight tracking-tight">Diário de Justiça Eletrônico</h2>
              <div className="flex items-center gap-3 mt-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#105ac0]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#105ac0]" />
                  {unreadCount} não lidas
                </span>
                {aiUrgencyStats.alta > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#ba1a1a]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a]" />
                    {aiUrgencyStats.alta} urgentes
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar processo, parte..."
                className="w-64 bg-white border border-slate-300 rounded-[2px] pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#105ac0] focus:border-[#105ac0] transition" />
            </div>
            <button onClick={handleSync} disabled={syncing}
              className="inline-flex items-center gap-2 bg-[#031636] hover:bg-[#0a2b5c] text-white text-[13px] font-medium px-4 py-2 rounded-[2px] transition disabled:opacity-50">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
            </button>
          </div>
        </div>

        {/* Mobile search */}
        <div className="sm:hidden px-4 py-2.5 border-b border-[#e7e5df]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar processo, parte..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-[2px] text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#105ac0] focus:border-[#105ac0] transition" />
          </div>
        </div>

        {/* ── TABS BAR underline + filtros à direita ── */}
        <div className="px-4 sm:px-5 border-b border-[#e7e5df] flex items-center justify-between gap-3 overflow-x-auto">
          {/* Underline tabs */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {([
              { key: 'unread'   as const, label: 'Não lidas',   count: unreadCount,                                  highlight: true },
              { key: 'linked'   as const, label: 'Vinculadas',  count: baseFiltered.filter(isLinked).length,       highlight: false },
              { key: 'unlinked' as const, label: 'Sem vínculo', count: baseFiltered.filter(isUnlinked).length,     highlight: false },
              { key: 'read'     as const, label: 'Lidas',       count: readCount,                                  highlight: false },
              { key: 'all'      as const, label: 'Todas',       count: baseFiltered.length,                        highlight: false },
            ]).map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                  className={`flex-shrink-0 inline-flex items-center gap-2 px-4 pb-3 pt-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? 'text-[#031636] border-[#031636]'
                      : 'text-slate-500 border-transparent hover:text-[#031636]'
                  }`}
                >
                  {tab.label}
                  <span className={`text-[10px] tabular-nums font-bold px-1.5 py-0.5 rounded-[2px] ${
                    active && tab.highlight && tab.count > 0
                      ? 'bg-[#031636] text-white'
                      : active
                        ? 'bg-white text-slate-600 border border-[#e7e5df]'
                        : 'text-slate-400'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right: compact action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0 pb-2.5">

              {/* Filtros dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setMobileControlsExpanded(!mobileControlsExpanded); setShowClearMenu(false); setShowExportMenu(false); setShowSettingsMenu(false); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-semibold border transition ${
                    mobileControlsExpanded || tribunalFilter !== 'all' || dateFilter !== '30days' || urgencyFilter !== 'all' || groupByProcess || showFilters || selectionMode
                      ? 'bg-[#031636] text-white border-[#031636]'
                      : 'bg-[#f8f7f5] text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Filtros</span>
                  {(tribunalFilter !== 'all' || dateFilter !== '30days' || urgencyFilter !== 'all' || groupByProcess) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                  )}
                </button>

                {mobileControlsExpanded && (
                  <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-none shadow-2xl border border-[#e7e5df] z-50 p-4 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Filtros avançados</p>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Tribunal</label>
                        <select value={tribunalFilter} onChange={(e) => setTribunalFilter(e.target.value)}
                          className="w-full px-2 py-1.5 border border-[#e7e5df] rounded-[2px] text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-[#f8f7f5]">
                          <option value="all">Todos</option>
                          {availableTribunals.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Período</label>
                        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as any)}
                          className="w-full px-2 py-1.5 border border-[#e7e5df] rounded-[2px] text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-[#f8f7f5]">
                          <option value="30days">30 dias</option>
                          <option value="60days">60 dias</option>
                          <option value="90days">90 dias</option>
                          <option value="all">Todos</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Urgência IA</label>
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { key: 'all'   as const, label: 'Todas' },
                          { key: 'alta'  as const, label: 'Alta' },
                          { key: 'media' as const, label: 'Média' },
                          { key: 'baixa' as const, label: 'Baixa' },
                        ]).map(c => (
                          <button key={c.key} onClick={() => setUrgencyFilter(c.key)}
                            className={`px-2.5 py-1 rounded-[2px] text-xs font-semibold border transition ${
                              urgencyFilter === c.key ? 'bg-[#031636] text-white border-[#031636]' : 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-slate-300'
                            }`}>{c.label}</button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={groupByProcess} onChange={(e) => setGroupByProcess(e.target.checked)}
                          className="rounded-[2px] border-slate-300 accent-[#031636]" />
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        Agrupar por processo
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={selectionMode}
                          onChange={(e) => { setSelectionMode(e.target.checked); if (!e.target.checked) clearSelectedIds(); }}
                          className="rounded-[2px] border-slate-300 accent-[#031636]" />
                        Modo seleção múltipla
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={showFilters} onChange={(e) => setShowFilters(e.target.checked)}
                          className="rounded-[2px] border-slate-300 accent-[#031636]" />
                        Filtrar por data personalizada
                      </label>
                    </div>

                    {showFilters && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">De</label>
                          <input type="date" value={customDateStart} onChange={(e) => setCustomDateStart(e.target.value)}
                            className="w-full px-2 py-1.5 border border-[#e7e5df] rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-slate-300" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Até</label>
                          <input type="date" value={customDateEnd} onChange={(e) => setCustomDateEnd(e.target.value)}
                            className="w-full px-2 py-1.5 border border-[#e7e5df] rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-slate-300" />
                        </div>
                      </div>
                    )}

                    {(tribunalFilter !== 'all' || dateFilter !== '30days' || urgencyFilter !== 'all' || customDateStart || customDateEnd) && (
                      <button
                        onClick={() => { setTribunalFilter('all'); setDateFilter('30days'); setUrgencyFilter('all'); setCustomDateStart(''); setCustomDateEnd(''); }}
                        className="text-xs text-red-500 hover:text-red-600 font-medium">
                        ✕ Limpar filtros
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Limpar */}
              <div className="relative">
                <button onClick={() => { setShowClearMenu(!showClearMenu); setShowExportMenu(false); setShowSettingsMenu(false); setMobileControlsExpanded(false); }}
                  disabled={syncing}
                  className="p-1.5 rounded-[2px] border border-[#e7e5df] text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition disabled:opacity-40" title="Limpar">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {showClearMenu && (
                  <div className="absolute right-0 mt-1.5 w-52 bg-white rounded-none shadow-xl border border-[#e7e5df] z-50 py-1 text-sm text-slate-700">
                    <button onClick={handleDeleteSelected} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-slate-400" /> Remover selecionadas
                    </button>
                    <button onClick={handleDeleteRead} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                      <EyeOff className="w-4 h-4 text-slate-400" /> Remover lidas
                    </button>
                    <button onClick={handleMarkAllAsRead} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-slate-400" /> Marcar todas lidas
                    </button>
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={handleClearAllIntimations} disabled={clearingAll || intimations.length === 0}
                      className="w-full text-left px-4 py-2.5 hover:bg-red-50 flex items-center gap-2 text-red-600 disabled:opacity-50">
                      <Trash2 className="w-4 h-4" /> Remover tudo
                    </button>
                  </div>
                )}
              </div>

              {/* Exportar */}
              <div className="relative">
                <button onClick={() => { setShowExportMenu(!showExportMenu); setShowClearMenu(false); setShowSettingsMenu(false); setMobileControlsExpanded(false); }}
                  disabled={filteredIntimations.length === 0}
                  className="p-1.5 rounded-[2px] border border-[#e7e5df] text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition disabled:opacity-40" title="Exportar">
                  <Download className="w-3.5 h-3.5" />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1.5 w-36 bg-white rounded-none shadow-xl border border-[#e7e5df] z-50 py-1 text-sm text-slate-700">
                    <button onClick={handleExportCSV} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> CSV</button>
                    <button onClick={handleExportExcel} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> Excel</button>
                    <button onClick={handleExportPDF} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> PDF</button>
                  </div>
                )}
              </div>

              {/* Config */}
              <div className="relative">
                <button onClick={() => { setShowSettingsMenu(!showSettingsMenu); setShowClearMenu(false); setShowExportMenu(false); setMobileControlsExpanded(false); }}
                  className="p-1.5 rounded-[2px] border border-[#e7e5df] text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition" title="Configurações">
                  <Settings className="w-3.5 h-3.5" />
                </button>
                {showSettingsMenu && (
                  <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-none shadow-xl border border-[#e7e5df] z-50 p-4 space-y-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configurações</p>
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={moduleSettings.defaultGroupByProcess}
                        onChange={(e) => { setModuleSettings((prev) => ({ ...prev, defaultGroupByProcess: e.target.checked })); setGroupByProcess(e.target.checked); }}
                        className="rounded-[2px] border-slate-300 accent-[#031636]" />
                      Agrupar por processo (padrão)
                    </label>
                    <div className="pt-2 border-t border-slate-100">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Filtro padrão</label>
                      <select value={moduleSettings.defaultStatusFilter}
                        onChange={(e) => { const v = e.target.value as 'all' | 'unread' | 'read'; setModuleSettings((prev) => ({ ...prev, defaultStatusFilter: v })); }}
                        className="w-full px-2 py-1.5 border border-[#e7e5df] rounded-[2px] text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 bg-[#f8f7f5]">
                        <option value="all">Todas</option>
                        <option value="unread">Não lidas</option>
                        <option value="read">Lidas</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
          </div>
        </div>


        {/* ── LOADING BANNER ── */}
        {loading && hasCompletedInitialLoad && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-[#f8f7f5] border-b border-[#e7e5df] px-4 sm:px-5 py-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Atualizando em segundo plano...
          </div>
        )}

        {/* ── SELECTION TOOLBAR ── */}
        {selectionMode && selectedIds.size > 0 && (
          <div className="bg-[#f8f7f5] border-b border-[#e7e5df] px-4 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-600">
              <strong className="text-[#031636]">{selectedIds.size}</strong> selecionada(s)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleMarkSelectedAsRead}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-[2px] transition border border-[#e7e5df]">
                <CheckCircle className="w-3.5 h-3.5 text-slate-400" /> Marcar lidas
              </button>
              <button onClick={handleBatchLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-[2px] transition border border-[#e7e5df]">
                <Link2 className="w-3.5 h-3.5 text-slate-400" /> Vincular
              </button>
              <button onClick={handleExportSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-[2px] transition border border-[#e7e5df]">
                <Download className="w-3.5 h-3.5 text-slate-400" /> Exportar
              </button>
              <button onClick={handleDeleteSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f7f5] hover:bg-red-50 text-red-600 text-xs font-semibold rounded-[2px] transition border border-red-200">
                <Trash2 className="w-3.5 h-3.5" /> Remover
              </button>
              <button onClick={disableSelectionMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-slate-200 text-slate-500 text-xs font-semibold rounded-[2px] transition">
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── LIST AREA ── */}
        <div className="bg-slate-50/40 p-4 sm:p-5 space-y-2.5">
          {filteredIntimations.length === 0 ? (

            /* Empty state */
            <div className="bg-[#f8f7f5] rounded-none shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-10 text-center">
              <div className="w-16 h-16 rounded-none bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-slate-300" />
              </div>
              <h4 className="text-base font-semibold text-slate-900 mb-1">Nenhuma intimação encontrada</h4>
              <p className="text-sm text-slate-500">
                {statusFilter === 'unread'
                  ? totalUnreadAllTime > 0
                    ? `Não há não lidas nos últimos ${dateFilter === '60days' ? '60' : dateFilter === '90days' ? '90' : '30'} dias, mas há ${totalUnreadAllTime} não lidas em períodos anteriores.`
                    : 'Não há intimações não lidas no momento'
                  : statusFilter === 'read'
                  ? 'Não há intimações lidas'
                  : 'Clique em "Sincronizar" para buscar novas intimações'}
              </p>
              {statusFilter === 'unread' && totalUnreadAllTime > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-[2px] bg-[#031636] hover:bg-[#0a2b5c] text-white text-sm font-medium transition"
                >
                  <CheckCircle className="w-4 h-4" />
                  Marcar todas as {totalUnreadAllTime} como lidas
                </button>
              )}
            </div>

          ) : groupByProcess && groupedByProcess ? (

            /* ── GROUPED VIEW ── */
            Array.from(groupedByProcess.entries()).map(([processNum, group]) => (
              <div key={processNum} className="bg-[#f8f7f5] rounded-none overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] hover:shadow-md transition-shadow">

                {/* Group header */}
                <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-[2px] bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div className="min-w-0">
                      {getLinkedProcess(group[0]) ? (
                        <button
                          type="button"
                          onClick={(event) => openLinkedProcess(event, group[0])}
                          className="block max-w-full truncate text-left text-slate-900 hover:text-[#105ac0] hover:underline underline-offset-2 font-mono font-bold text-sm leading-tight transition-colors cursor-pointer"
                          title="Abrir detalhes do processo"
                        >
                          {processNum}
                        </button>
                      ) : (
                        <p className="text-slate-900 font-mono font-bold text-sm truncate leading-tight">{processNum}</p>
                      )}
                      {group[0].client_id && (
                        <p className="text-slate-400 text-[11px] truncate leading-tight">{getClientName(group[0].client_id)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {group.filter((i) => !i.lida).length > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-[2px] text-[10px] font-bold bg-[#f8f7f5] text-slate-600 border border-[#e7e5df]">
                        {group.filter((i) => !i.lida).length} não lida{group.filter((i) => !i.lida).length !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-[11px] tabular-nums">{group.length}</span>
                    )}
                    {group.filter((i) => !i.lida).length > 0 && (
                      <button
                        onClick={() => {
                          void markAsRead(group.filter((i) => !i.lida).map((i) => i.id));
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-[2px] text-[11px] font-semibold transition"
                      >
                        <CheckCircle className="w-3 h-3" />
                        <span className="hidden sm:inline">Marcar todas</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Group items */}
                <div className="divide-y divide-slate-100">
                  {group.map((intimation) => {
                    const isExpanded = expandedIntimationIds.has(intimation.id);
                    const analysis = aiAnalysis.get(intimation.id);
                    const urg = analysis?.urgency ?? (intimation.lida ? null : 'media');
                    const urgCfg = urg ? urgencyConfig[urg as keyof typeof urgencyConfig] : null;
                    const sig = isSigilosoIntimacao(intimation);
                    return (
                      <div
                        key={intimation.id}
                        className={`border-l-4 transition ${sig ? 'border-l-red-500 bg-red-50/40' : urgCfg ? urgCfg.border : 'border-l-transparent'} ${
                          !sig && selectionMode && selectedIds.has(intimation.id) ? 'bg-zinc-50' : !sig ? 'bg-[#f8f7f5]' : ''
                        }`}
                      >
                        {/* Row header */}
                        <div
                          className="px-4 sm:px-5 py-3.5 cursor-pointer"
                          onClick={() => {
                            const next = new Set(expandedIntimationIds);
                            if (isExpanded) next.delete(intimation.id); else next.add(intimation.id);
                            setExpandedIntimationIds(next);
                          }}
                        >
                          <div className="flex items-start gap-3">
                            {selectionMode && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(intimation.id)}
                                onChange={() => toggleSelectedId(intimation.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 accent-[#031636] border-slate-300 rounded-[2px] flex-shrink-0"
                              />
                            )}
                            <div className="flex-shrink-0 mt-1.5">
                              {!intimation.lida && urgCfg && (
                                <span className={`block w-2 h-2 rounded-full ${urgCfg.dot}`} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              {/* Top row: tribunal + tipo + right: urgency + date + chevron */}
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-[2px] text-[10px] font-bold bg-slate-100 text-slate-600 flex-shrink-0">
                                    {intimation.sigla_tribunal}
                                  </span>
                                  {sig && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 flex-shrink-0">
                                      <ShieldAlert className="w-3 h-3" /> SIGILOSO · consultar autos
                                    </span>
                                  )}
                                  {intimation.tipo_comunicacao && (
                                    <span className="hidden sm:inline text-[11px] text-slate-400 truncate">{intimation.tipo_comunicacao}</span>
                                  )}
                                  {isLinked(intimation) && (
                                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                                      <Link2 className="w-3 h-3" /> Vinculada
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {analysis && (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                                      <Sparkles className="w-2.5 h-2.5" />
                                      {urgencyConfig[analysis.urgency].label}
                                    </span>
                                  )}
                                  <span className="text-[11px] text-slate-400 tabular-nums">{formatDate(intimation.data_disponibilizacao)}</span>
                                  {isExpanded
                                    ? <ChevronDown className="w-4 h-4 text-slate-400" />
                                    : <ChevronRight className="w-4 h-4 text-slate-300" />}
                                </div>
                              </div>

                              {/* Preview when collapsed */}
                              {!isExpanded && (
                                <div className="space-y-1.5">
                                  <p className={`text-sm line-clamp-2 leading-relaxed ${!intimation.lida ? 'text-slate-600' : 'text-slate-400'}`}>
                                    {analysis?.summary ?? htmlToText(intimation.texto || '').slice(0, 160)}
                                  </p>
                                  {analysis?.deadline && (
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#e7e5df] text-slate-600 rounded-[2px] text-[11px] font-semibold">
                                        <Clock className="w-3 h-3" /> {analysis.deadline.days} dias úteis
                                      </span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#031636] hover:bg-[#0a2b5c] text-white rounded-[2px] text-[11px] font-bold transition">
                                        + Criar prazo
                                      </button>
                                    </div>
                                  )}
                                  {!analysis && !analyzingIds.has(intimation.id) && aiService.isEnabled() && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#031636] bg-white hover:bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] transition">
                                      <Sparkles className="w-3 h-3" /> Analisar com IA
                                    </button>
                                  )}
                                  {analyzingIds.has(intimation.id) && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-slate-500 bg-slate-50 border border-[#e7e5df] rounded-[2px]">
                                      <Loader2 className="w-3 h-3 animate-spin" /> Analisando...
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Expanded: show collapse hint */}
                              {isExpanded && (
                                <p className="text-[11px] text-slate-400">Clique para recolher</p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-slate-100 space-y-3">
                            {!analysis && (
                              <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <Sparkles className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">Sem análise de IA</p>
                                    <p className="text-xs text-slate-500">A IA pode resumir, detectar prazos e sugerir ações.</p>
                                  </div>
                                </div>
                                {aiService.isEnabled() ? (
                                  analyzingIds.has(intimation.id) ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px]">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...
                                    </span>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#031636] hover:bg-[#0a2b5c] rounded-[2px] transition flex-shrink-0">
                                      <Sparkles className="w-3.5 h-3.5" /> Analisar agora
                                    </button>
                                  )
                                ) : (
                                  <span className="text-xs text-slate-500">Configure a chave OpenAI</span>
                                )}
                              </div>
                            )}
                            {analysis && (
                              <div className="bg-slate-50 border border-[#e7e5df] rounded-[2px] p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-slate-400" />
                                    <span className="text-sm font-semibold text-slate-800">Análise IA</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                      title="Re-analisar"
                                      disabled={analyzingIds.has(intimation.id)}
                                      className="p-1 text-slate-400 hover:text-[#031636] hover:bg-[#f8f7f5] rounded-[2px] transition disabled:opacity-50">
                                      {analyzingIds.has(intimation.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                </div>
                                <p className="text-sm text-slate-700"><strong>Resumo:</strong> {analysis.summary}</p>
                                {analysis.deadline && (
                                  <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-3 text-xs space-y-1">
                                    <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5" /> Prazo detectado
                                    </p>
                                    <p className="text-slate-700"><strong>{analysis.deadline.days} dias úteis</strong> — {analysis.deadline.description}</p>
                                    {analysis.deadline.dueDate && (
                                      <p className="text-slate-700 font-medium">Vencimento: {formatDateLong(analysis.deadline.dueDate)}</p>
                                    )}
                                  </div>
                                )}
                                {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                      <Lightbulb className="w-3.5 h-3.5 text-slate-400" /> Ações sugeridas pela IA:
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {analysis.suggestedActions.map((a, i) => {
                                        const { type, label } = parseAction(a);
                                        const cfg = actionTypeConfig[type];
                                        const Icon = cfg.icon;
                                        return (
                                          <button
                                            key={i}
                                            onClick={(e) => { e.stopPropagation(); cfg.onClick(intimation); }}
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-semibold border transition ${cfg.cls}`}
                                          >
                                            <Icon className="w-3 h-3 flex-shrink-0" />
                                            {label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Full text (highlighted) */}
                            <div>
                              <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Conteúdo da Intimação</h5>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{highlightText(intimation.texto || '', analysis?.importantPassages)}</p>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap gap-2">
                              {!intimation.lida && (
                                <button onClick={(e) => { e.stopPropagation(); handleMarkAsRead(intimation.id); }}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Marcar lida
                                </button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                                <Clock className="w-3.5 h-3.5 text-slate-400" /> Prazo
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleCreateAppointment(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                                <CalendarIcon className="w-3.5 h-3.5 text-slate-400" /> Compromisso
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setLinkingIntimation(intimation); setSelectedClientId(intimation.client_id || ''); setSelectedProcessId(intimation.process_id || ''); setLinkModalOpen(true); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                                <Link2 className="w-3.5 h-3.5 text-slate-400" /> Vincular
                              </button>
                              {intimation.link && (
                                <a href={intimation.link} target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" /> Ver diário
                                </a>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); setSelectedIntimation(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] transition">
                                <Eye className="w-3.5 h-3.5" /> Detalhes completos
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))

          ) : (

            /* ── LIST VIEW (inbox style) ── */
            <div className="rounded-none border border-[#e7e5df] overflow-hidden bg-[#f8f7f5] divide-y divide-slate-100">
            {filteredIntimations.map((intimation) => {
              const isExpanded = expandedIntimationIds.has(intimation.id);
              const analysis = aiAnalysis.get(intimation.id);
              const urg = analysis?.urgency ?? (intimation.lida ? null : 'media');
              const urgCfg = urg ? urgencyConfig[urg as keyof typeof urgencyConfig] : null;
              const sig = isSigilosoIntimacao(intimation);
              return (
                <div
                  key={intimation.id}
                  className={`group transition-colors ${sig ? 'border-l-4 border-red-500 bg-red-50/50 hover:bg-red-50' : `${
                    !intimation.lida ? 'bg-[#f8f7f5]' : 'bg-slate-50/30'
                  } ${
                    selectionMode && selectedIds.has(intimation.id)
                      ? 'bg-slate-100'
                      : 'hover:bg-slate-50'
                  }`}`}
                >
                  {/* Inbox row — single-line dense (Gmail-like) */}
                  <div
                    className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 cursor-pointer"
                    onClick={() => toggleExpanded(intimation.id)}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(intimation.id)}
                        onChange={() => toggleSelectedId(intimation.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 accent-[#031636] flex-shrink-0"
                      />
                    )}

                    {/* Unread dot (cor por urgência) */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      !intimation.lida ? (urgCfg?.dot ?? 'bg-slate-400') : 'bg-transparent'
                    }`} />

                    {/* Tribunal chip (largura fixa para alinhamento tabular) */}
                    <span className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold bg-slate-100 text-slate-600 flex-shrink-0 w-14">
                      {intimation.sigla_tribunal}
                    </span>

                    {/* Número do processo */}
                    {getLinkedProcess(intimation) ? (
                      <button
                        type="button"
                        onClick={(event) => openLinkedProcess(event, intimation)}
                        className={`font-mono text-[12px] sm:text-[13px] tabular-nums flex-shrink-0 truncate max-w-[140px] sm:max-w-[180px] hover:text-[#105ac0] hover:underline underline-offset-2 transition-colors ${
                          !intimation.lida ? 'font-bold text-[#031636]' : 'font-medium text-slate-500'
                        }`}
                        title="Abrir detalhes do processo"
                      >
                        {intimation.numero_processo_mascara || intimation.numero_processo}
                      </button>
                    ) : (
                      <span className={`font-mono text-[12px] sm:text-[13px] tabular-nums flex-shrink-0 truncate max-w-[140px] sm:max-w-[180px] ${
                        !intimation.lida ? 'font-bold text-[#031636]' : 'font-medium text-slate-500'
                      }`}>
                        {intimation.numero_processo_mascara || intimation.numero_processo || 'Sem número'}
                      </span>
                    )}

                    {/* Sigiloso — destaque de atenção (DJEN não traz o inteiro teor) */}
                    {sig && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 flex-shrink-0">
                        <ShieldAlert className="w-3 h-3" />
                        <span className="hidden sm:inline">SIGILOSO</span>
                      </span>
                    )}

                    {/* Vinculada ícone */}
                    {isLinked(intimation) && (
                      <Link2 className="hidden sm:block w-3 h-3 text-emerald-600 flex-shrink-0" />
                    )}

                    {/* Subject: partes — preview */}
                    <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                      {(() => {
                        const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
                          ? intimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
                          : extractPartesFromTexto(htmlToText(intimation.texto || ''));
                        const partesStr = partes.length > 0 ? partes.slice(0, 2).map(p => p.nome).join(' · ') : '';
                        const previewStr = analysis?.summary ?? htmlToText(intimation.texto || '').slice(0, 160);
                        return (
                          <>
                            {partesStr && (
                              <span className={`text-sm truncate flex-shrink min-w-0 ${
                                !intimation.lida ? 'font-semibold text-slate-900' : 'text-slate-600'
                              }`} style={{ maxWidth: '40%' }}>
                                {partesStr}
                              </span>
                            )}
                            <span className={`text-sm truncate min-w-0 flex-1 ${
                              !intimation.lida ? 'text-slate-700' : 'text-slate-400'
                            }`}>
                              {partesStr && <span className="text-slate-300 mx-0.5">—</span>}
                              {previewStr}
                            </span>
                          </>
                        );
                      })()}
                    </div>

                    {/* Right rail: outcome + urgência + prazo + data */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(() => {
                        const outcome = detectOutcome(analysis?.summary);
                        return outcome ? (
                          <span className={`hidden lg:inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold border ${outcome.cls}`}>
                            {outcome.label}
                          </span>
                        ) : null;
                      })()}
                      {analysis && (
                        <span className={`hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                          <Sparkles className="w-2.5 h-2.5" />
                          {urgencyConfig[analysis.urgency].label}
                        </span>
                      )}
                      {analysis?.deadline && (
                        <span className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] text-[10px] font-semibold text-slate-700 border border-[#e7e5df] bg-white">
                          <Clock className="w-2.5 h-2.5" /> {analysis.deadline.days}d
                        </span>
                      )}
                      <span className={`text-[11px] tabular-nums w-14 text-right ${
                        !intimation.lida ? 'font-semibold text-[#031636]' : 'text-slate-400'
                      }`}>
                        {formatDate(intimation.data_disponibilizacao)}
                      </span>
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                    </div>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 sm:px-5 py-4 space-y-4">
                      {/* AI analysis panel */}
                      {!analysis && (
                        <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <Sparkles className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-slate-800">Sem análise de IA</p>
                              <p className="text-xs text-slate-500">A IA pode resumir, detectar prazos e sugerir ações.</p>
                            </div>
                          </div>
                          {aiService.isEnabled() ? (
                            analyzingIds.has(intimation.id) ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px]">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...
                              </span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#031636] hover:bg-[#0a2b5c] rounded-[2px] transition flex-shrink-0">
                                <Sparkles className="w-3.5 h-3.5" /> Analisar agora
                              </button>
                            )
                          ) : (
                            <span className="text-xs text-slate-500">Configure a chave OpenAI</span>
                          )}
                        </div>
                      )}
                      {analysis && (
                        <div className="bg-slate-50 border border-[#e7e5df] rounded-[2px] p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-slate-400" />
                              <span className="text-sm font-semibold text-slate-800">Análise IA</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                title="Re-analisar com IA"
                                disabled={analyzingIds.has(intimation.id)}
                                className="p-1 text-slate-400 hover:text-[#031636] hover:bg-[#f8f7f5] rounded-[2px] transition disabled:opacity-50">
                                {analyzingIds.has(intimation.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700"><strong>Resumo:</strong> {analysis.summary}</p>
                          {analysis.deadline && (
                            <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-3 space-y-1 text-xs">
                              <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Prazo detectado
                              </p>
                              <p className="text-slate-700"><strong>{analysis.deadline.days} dias úteis</strong> — {analysis.deadline.description}</p>
                              {analysis.deadline.dueDate && (
                                <>
                                  <p className="text-slate-500">Disponibilizado: {formatDate(intimation.data_disponibilizacao)}</p>
                                  <p className="text-slate-700 font-medium">Vencimento: {formatDateLong(analysis.deadline.dueDate)}</p>
                                  <p className="text-slate-600 bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] px-2 py-1 mt-1">
                                    ⚠️ Cálculo sem feriados — confira o calendário oficial!
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                          {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                <Lightbulb className="w-3.5 h-3.5 text-slate-400" /> Ações sugeridas pela IA:
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {analysis.suggestedActions.map((a, i) => {
                                  const { type, label } = parseAction(a);
                                  const cfg = actionTypeConfig[type];
                                  const Icon = cfg.icon;
                                  return (
                                    <button
                                      key={i}
                                      onClick={(e) => { e.stopPropagation(); cfg.onClick(intimation); }}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs font-semibold border transition ${cfg.cls}`}
                                    >
                                      <Icon className="w-3 h-3 flex-shrink-0" />
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {analysis.keyPoints && analysis.keyPoints.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-700 mb-1.5">🎯 Pontos-chave:</p>
                              <div className="flex flex-wrap gap-1">
                                {analysis.keyPoints.map((kp, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-slate-50 text-slate-700 border border-[#e7e5df] rounded-[2px] text-xs">
                                    <span className="text-slate-400">→</span> {kp}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Full text (highlighted) */}
                      <div>
                        <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Conteúdo da Intimação</h5>
                        <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">{highlightText(intimation.texto || '', analysis?.importantPassages)}</p>
                      </div>

                      {intimation.nome_orgao && (
                        <div>
                          <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Órgão</h5>
                          <p className="text-sm text-slate-700">{intimation.nome_orgao}</p>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                        {!intimation.lida && (
                          <button onClick={(e) => { e.stopPropagation(); handleMarkAsRead(intimation.id); }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Marcar lida
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                          <Clock className="w-3.5 h-3.5 text-slate-600" /> Novo Prazo
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleCreateAppointment(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                          <CalendarIcon className="w-3.5 h-3.5 text-slate-400" /> Compromisso
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleOpenLinkModal(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                          <Link2 className="w-3.5 h-3.5 text-slate-400" /> Vincular
                        </button>
                        {intimation.link && (
                          <a href={intimation.link} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-[#f8f7f5] hover:bg-slate-50 border border-[#e7e5df] rounded-[2px] transition">
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" /> Ver diário
                          </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setSelectedIntimation(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-[#f8f7f5] border border-blue-200 rounded-[2px] transition">
                          <Eye className="w-3.5 h-3.5" /> Detalhes completos
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </div>
        {/* end list area */}
      </div>
      {/* end premium card */}

      {/* Modal de Vínculo */}
      <Modal
        accentBarClassName="bg-[#031636]"
        open={linkModalOpen && !!linkingIntimation}
        onClose={() => setLinkModalOpen(false)}
        title="Vincular Intimação"
        eyebrow="Vínculo"
        size="lg"
        zIndex={LAYER.MODAL}
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setLinkModalOpen(false)}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded-[2px] transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveLinks}
              className="px-4 py-2 bg-[#031636] hover:bg-[#0a2b5c] text-white text-sm font-medium rounded-[2px] flex items-center gap-2 transition"
            >
              Salvar Vínculos
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4" style={{ minHeight: '380px' }}>
              {/* Cliente — AJAX search */}
              <ClientSearchSelect
                value={selectedClientId}
                initialClientName={selectedClientId ? clients.find(c => c.id === selectedClientId)?.full_name : ''}
                onChange={(id) => {
                  setSelectedClientId(id);
                  // Limpa processo se não pertence ao novo cliente
                  if (selectedProcessId) {
                    const proc = processes.find(p => p.id === selectedProcessId);
                    if (proc?.client_id !== id) {
                      setSelectedProcessId('');
                      setSelectedProcessName('');
                      setProcessSearchTerm('');
                    }
                  }
                }}
                label="Cliente"
                allowCreate={true}
                placeholder="Buscar cliente..."
              />

              {/* Processo — busca filtrada pelo cliente */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">Processo</label>
                <div ref={processSearchRef} className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={selectedProcessId ? selectedProcessName : processSearchTerm}
                      onChange={(e) => {
                        setProcessSearchTerm(e.target.value);
                        setSelectedProcessId('');
                        setSelectedProcessName('');
                        setProcessDropdownOpen(true);
                            }}
                      onFocus={() => setProcessDropdownOpen(true)}
                      placeholder={selectedClientId ? 'Buscar processo do cliente...' : 'Selecione um cliente primeiro'}
                      disabled={!selectedClientId}
                      className="w-full h-[34px] pl-9 pr-9 rounded-[2px] text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] disabled:opacity-50 disabled:cursor-not-allowed transition"
                    />
                    {(selectedProcessId || processSearchTerm) && (
                      <button
                        onClick={() => { setSelectedProcessId(''); setSelectedProcessName(''); setProcessSearchTerm(''); setProcessDropdownOpen(false); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {processDropdownOpen && selectedClientId && !selectedProcessId && (() => {
                    const term = processSearchTerm.toLowerCase().replace(/\D/g, '');
                    const filtered = processes
                      .filter(p => p.client_id === selectedClientId)
                      .filter(p => {
                        if (!processSearchTerm) return true;
                        const code = p.process_code.toLowerCase();
                        const digits = p.process_code.replace(/\D/g, '');
                        return code.includes(processSearchTerm.toLowerCase()) || (term && digits.includes(term));
                      });
                    return (
                      <div className="absolute z-50 mt-1 w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-[2px] shadow-lg max-h-52 overflow-y-auto">
                        {filtered.length === 0 && !processSearchTerm && (
                          <p className="px-4 py-3 text-sm text-slate-400">Nenhum processo cadastrado para este cliente</p>
                        )}
                        {filtered.map(p => (
                          <button
                            key={p.id}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setSelectedProcessId(p.id); setSelectedProcessName(p.process_code); setProcessDropdownOpen(false); setProcessSearchTerm(''); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-zinc-900 dark:text-white hover:bg-[#f8f7f5] dark:hover:bg-zinc-700 font-mono transition-colors"
                          >
                            {p.process_code}
                          </button>
                        ))}
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const intimationCode = linkingIntimation?.numero_processo_mascara || linkingIntimation?.numero_processo || '';
                            setNewProcessCode(processSearchTerm || intimationCode);
                            setProcessDropdownOpen(false);
                            setCreatingProcess(true);
                          }}
                          className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-[#f8f7f5] dark:hover:bg-zinc-700 font-medium flex items-center gap-2 border-t border-zinc-100 dark:border-zinc-700 transition-colors"
                        >
                          <Plus className="w-4 h-4" /> Cadastrar novo processo
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Mini-form: Novo Processo */}
              {creatingProcess && selectedClientId && (
                <div className="rounded-none border border-[#e7e5df] bg-[#f8f7f5] dark:bg-zinc-800 dark:border-[#e7e5df] p-4 space-y-3 mt-1">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Novo Processo</p>

                  <div>
                    <label className="block text-xs text-zinc-600 dark:text-zinc-300 mb-1">Número do processo</label>
                    <input
                      type="text"
                      value={newProcessCode}
                      onChange={(e) => setNewProcessCode(e.target.value)}
                      placeholder="0000000-00.0000.0.00.0000"
                      className="w-full h-[34px] px-3 rounded-[2px] text-[13px] font-mono bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-zinc-600 dark:text-zinc-300 mb-1">Área de prática</label>
                    <select
                      value={newProcessArea}
                      onChange={(e) => setNewProcessArea(e.target.value as typeof newProcessArea)}
                      className="w-full h-[34px] px-3 rounded-[2px] text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] transition appearance-none"
                    >
                      <option value="civel">Cível</option>
                      <option value="trabalhista">Trabalhista</option>
                      <option value="consumidor">Consumidor</option>
                      <option value="previdenciario">Previdenciário</option>
                      <option value="familia">Família</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Vara / Órgão</label>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-[#f8f7f5] dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-[2px] px-3 py-2 truncate min-h-[34px]">
                        {linkingIntimation?.nome_orgao || '—'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">Data de distribuição</label>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-[#f8f7f5] dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-[2px] px-3 py-2 min-h-[34px]">
                        {linkingIntimation?.data_disponibilizacao ? formatDate(linkingIntimation.data_disponibilizacao) : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleCreateAndLinkProcess}
                      disabled={!newProcessCode.trim() || newProcessSaving}
                      className="flex-1 h-9 bg-[#031636] hover:bg-[#031636] disabled:opacity-50 text-white text-sm font-medium rounded-[2px] flex items-center justify-center gap-2 transition"
                    >
                      {newProcessSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {newProcessSaving ? 'Criando...' : 'Criar e Vincular'}
                    </button>
                    <button
                      onClick={() => setCreatingProcess(false)}
                      className="px-4 h-9 text-sm text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white border border-zinc-200 dark:border-zinc-700 rounded-[2px] transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
        </ModalBody>
      </Modal>

      <ProcessQuickViewModal
        processId={quickViewProcessId}
        onClose={() => setQuickViewProcessId(null)}
        onProcessUpdated={(updatedProcess) => {
          setProcesses((current) => current.map((item) => (
            item.id === updatedProcess.id ? { ...item, ...updatedProcess } : item
          )));
        }}
        onOpenModule={(processId) => {
          setQuickViewProcessId(null);
          const params = { mode: 'details', entityId: processId };
          if (onNavigateToModule) onNavigateToModule('processos', params);
          else navigateTo('processos', params);
        }}
      />

      {/* Modal de Criação de Prazo */}
      {currentIntimationForAction && (() => {
        const intimation = currentIntimationForAction;
        const analysis = aiAnalysis.get(intimation.id);
        const client = clients.find(c => c.id === intimation.client_id);

        const getPriorityFromUrgency = prioridadePorUrgencia;
        const getDeadlineDate = (): string => dataInternaDoPrazo(analysis?.deadline?.dueDate);

        const processNumber = intimation.numero_processo_mascara || intimation.numero_processo || '';

        return (
          <DeadlineFormModal
            open={deadlineModalOpen}
            onClose={() => { setDeadlineModalOpen(false); setCurrentIntimationForAction(null); }}
            onSaved={() => {
              setDeadlineModalOpen(false);
              setCurrentIntimationForAction(null);
              toast.success('Prazo criado', 'Prazo cadastrado com sucesso');
            }}
            source="intimation"
            intimationId={intimation.id}
            intimationContext={{
              process_number: processNumber,
              client_name: client?.full_name,
              type: intimation.tipo_comunicacao || 'Intimação',
              analysis_due_date: analysis?.deadline?.dueDate ?? undefined,
            }}
            initialData={{
              title: analysis?.deadline?.description
                ? `${analysis.deadline.description} - Processo ${processNumber}`
                : `Prazo ${intimation.tipo_comunicacao || 'Intimação'} - Processo ${processNumber}`,
              description: analysis?.summary || intimation.texto || '',
              due_date: getDeadlineDate(),
              type: 'processo',
              priority: getPriorityFromUrgency(analysis?.urgency),
              client_id: intimation.client_id || '',
              process_id: intimation.process_id || '',
            }}
            members={members}
            processes={processes}
            clients={clients}
            statusOptions={deadlineStatusOptions}
            priorityOptions={deadlinePriorityOptions}
            typeOptions={deadlineTypeOptions}
          />
        );
      })()}

      {/* Modal de Criação de Compromisso */}
      {appointmentModalOpen && currentIntimationForAction && (
        <AppointmentCreationModal
          intimation={currentIntimationForAction}
          analysis={aiAnalysis.get(currentIntimationForAction.id)}
          clients={clients}
          processes={processes}
          members={members}
          onClose={() => {
            setAppointmentModalOpen(false);
            setCurrentIntimationForAction(null);
          }}
          onSuccess={() => {
            setAppointmentModalOpen(false);
            setCurrentIntimationForAction(null);
            toast.success('Compromisso criado', 'Compromisso cadastrado com sucesso');
          }}
        />
      )}

      {/* Detalhes completos — modal, para não perder a lista, os filtros nem o scroll */}
      {selectedIntimation && (() => {
        const detalhe = selectedIntimation;
        const client = getClientName(detalhe.client_id);
        const process = getProcessCode(detalhe.process_id);
        const detailAnalysis = aiAnalysis.get(detalhe.id);
        const detailUrgency = detailAnalysis?.urgency as keyof typeof urgencyConfig | undefined;
        const detailUrgCfg = detailUrgency ? urgencyConfig[detailUrgency] : null;
        const outcome = detectOutcome(detailAnalysis?.summary);
        const decodedTexto = htmlToText(detalhe.texto || '');
        const partes = detalhe.djen_destinatarios && detalhe.djen_destinatarios.length > 0
          ? detalhe.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
          : extractPartesFromTexto(decodedTexto);
        const fechar = () => setSelectedIntimation(null);
        // Ação que abre outro modal precisa fechar este antes, senão os dois
        // disputam o foco e o scroll do body.
        const seguirPara = (acao: (i: DjenComunicacaoLocal) => void) => () => { fechar(); acao(detalhe); };

        return (
          <Modal
            accentBarClassName="bg-[#031636]"
            open
            onClose={fechar}
            size="xl"
            zIndex={LAYER.MODAL}
            eyebrow={detalhe.sigla_tribunal || 'Intimação'}
            title={detalhe.numero_processo_mascara || detalhe.numero_processo || 'Sem número'}
            icon={<Gavel className="w-4 h-4" fill="currentColor" />}
            iconContainerClassName="border border-[#e7e5df] bg-white text-[#031636]"
            subtitle={
              <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-xs text-slate-500">{formatDate(detalhe.data_disponibilizacao)}</span>
                {detalhe.nome_orgao && <span className="text-xs text-slate-500">{detalhe.nome_orgao}</span>}
                {detalhe.tipo_comunicacao && <span className="text-xs font-medium text-slate-600">{detalhe.tipo_comunicacao}</span>}
                {detalhe.nome_classe && <span className="text-xs text-slate-500">{detalhe.nome_classe}</span>}
              </div>
            }
            headerActions={
              <div className="hidden sm:flex items-center gap-1.5">
                {!detalhe.lida && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[11px] font-bold bg-[#f8f7f5] text-slate-600 border border-[#e7e5df]">
                    <EyeOff className="w-3 h-3" /> Não lida
                  </span>
                )}
                {outcome && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-[2px] text-[11px] font-bold border ${outcome.cls}`}>
                    {outcome.label}
                  </span>
                )}
                {detailUrgCfg && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-[2px] text-[11px] font-bold border ${detailUrgCfg.badge}`}>
                    {detailUrgCfg.label}
                  </span>
                )}
              </div>
            }
            footer={
              <div className="flex flex-wrap gap-2">
                {!detalhe.lida ? (
                  <button onClick={() => { handleMarkAsRead(detalhe.id); fechar(); }}
                    className="inline-flex items-center gap-1.5 bg-[#031636] hover:bg-[#0a2b5c] text-white font-medium px-3.5 py-2 rounded-[2px] transition text-xs">
                    <CheckCircle className="w-3.5 h-3.5" /> Marcar lida
                  </button>
                ) : (
                  // O "Desfazer" do toast some em 15s; aqui a volta continua
                  // disponível depois, para quem só percebe o engano ao abrir.
                  <button onClick={() => { void undoMarkAsRead([detalhe.id], []); fechar(); }}
                    className="inline-flex items-center gap-1.5 bg-white hover:bg-[#f8f7f5] text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                    <RotateCcw className="w-3.5 h-3.5 text-slate-400" /> Marcar não lida
                  </button>
                )}
                <button onClick={seguirPara(handleCreateDeadline)}
                  className="inline-flex items-center gap-1.5 bg-white hover:bg-[#f8f7f5] text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                  <Clock className="w-3.5 h-3.5 text-slate-400" /> Novo prazo
                </button>
                <button onClick={seguirPara(handleCreateAppointment)}
                  className="inline-flex items-center gap-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                  <CalendarIcon className="w-3.5 h-3.5 text-slate-400" /> Compromisso
                </button>
                <button onClick={seguirPara(handleOpenPrescriptionModal)}
                  className="inline-flex items-center gap-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-400" /> Prescrição
                </button>
                <button onClick={seguirPara(handleOpenLinkModal)}
                  className="inline-flex items-center gap-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                  <Link2 className="w-3.5 h-3.5 text-slate-400" /> Vincular
                </button>
                {detalhe.link && (
                  <a href={detalhe.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[#f8f7f5] hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-[2px] transition text-xs border border-[#e7e5df]">
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" /> Ver diário
                  </a>
                )}
              </div>
            }
          >
            {/* Uma margem esquerda só para as três faixas — antes eram px-5,
                mx-4 e px-6 empilhados, e as bordas não batiam. */}
            {(client || process || partes.length > 0) && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-b border-[#e7e5df] bg-[#f8f7f5] px-6 py-3.5">
                {client && (
                  <>
                    <dt className="text-[11px] text-slate-400">Cliente</dt>
                    <dd className="text-[13px] text-slate-800 truncate">{client}</dd>
                  </>
                )}
                {process && (
                  <>
                    <dt className="text-[11px] text-slate-400">Processo</dt>
                    <dd className="text-[13px] font-mono tabular-nums text-slate-800 truncate">{process}</dd>
                  </>
                )}
                {partes.length > 0 && (
                  <>
                    <dt className="text-[11px] text-slate-400">Partes</dt>
                    <dd className="text-[13px] text-slate-700">
                      {partes.slice(0, 4).map((parte, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-slate-300"> · </span>}
                          {parte.nome}
                          {parte.polo && <span className="text-slate-400"> ({parte.polo})</span>}
                        </span>
                      ))}
                      {partes.length > 4 && <span className="text-slate-400"> +{partes.length - 4}</span>}
                    </dd>
                  </>
                )}
              </dl>
            )}

            {/* O resumo NÃO herda mais as classes do selo de urgência: com a
                paleta nova, "Crítica" é vermelho sólido e virava um bloco
                vermelho com texto escuro em cima. A urgência entra como um
                filete na borda esquerda, que é onde ela informa sem gritar. */}
            {detailAnalysis && (
              <div className={`border-b border-[#e7e5df] border-l-2 ${detailUrgCfg?.border ?? 'border-l-transparent'} bg-white px-6 py-4`}>
                <div className="flex items-start justify-between gap-6">
                  <p className="text-[13px] text-slate-800 leading-relaxed flex-1 min-w-0">{detailAnalysis.summary}</p>
                  {detailAnalysis.deadline?.days != null && (
                    <div className="shrink-0 text-right border-l border-[#e7e5df] pl-4">
                      <p className="text-[18px] font-semibold text-[#031636] tabular-nums leading-none">{detailAnalysis.deadline.days}</p>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">dias úteis</p>
                      {detailAnalysis.deadline.dueDate && (
                        <p className="text-[11px] text-slate-600 tabular-nums mt-1.5">{formatDate(detailAnalysis.deadline.dueDate)}</p>
                      )}
                    </div>
                  )}
                </div>
                {detailAnalysis.deadline?.description && (
                  <p className="text-[12px] text-slate-500 mt-2">{detailAnalysis.deadline.description}</p>
                )}
              </div>
            )}

            <div className="px-6 py-5">
              <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">Conteúdo da intimação</p>
              <div className="text-[13px] text-slate-700 whitespace-pre-wrap leading-[1.75] selection:bg-slate-200">
                {highlightText(detalhe.texto || '', detailAnalysis?.importantPassages)}
              </div>
            </div>
          </Modal>
        );
      })()}

      <Modal
        accentBarClassName="bg-[#031636]"
        open={prescriptionModalOpen && !!currentIntimationForAction}
        onClose={() => { setPrescriptionModalOpen(false); setCurrentIntimationForAction(null); }}
        title="Execução Sobrestada"
        eyebrow="Prescrição"
        size="md"
        zIndex={LAYER.MODAL}
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setPrescriptionModalOpen(false); setCurrentIntimationForAction(null); }}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded-[2px] transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCreatePrescriptionEvent}
              disabled={savingPrescription}
              className="px-4 py-2 bg-[#031636] hover:bg-[#0a2b5c] text-white text-sm font-medium rounded-[2px] flex items-center gap-2 transition disabled:opacity-50"
            >
              {savingPrescription && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar na Agenda
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
              {currentIntimationForAction && <>
              <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-3">
                <p className="text-xs text-slate-800">
                  <strong>Processo:</strong> {currentIntimationForAction.numero_processo_mascara || currentIntimationForAction.numero_processo || 'Sem número'}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  O sistema criará um compromisso na agenda 6 meses antes da prescrição estimada (data-base + 18 meses).
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  Data-base do sobrestamento *
                </label>
                <input
                  type="date"
                  value={prescriptionBaseDate}
                  onChange={(e) => setPrescriptionBaseDate(e.target.value)}
                  className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Data em que o processo foi sobrestado por risco de prescrição.
                </p>
              </div>

              {/* Projeção de datas */}
              {prescriptionBaseDate && (
                <div className="bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px] p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Projeção de Datas</p>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-600">
                      <strong>Prescrição estimada:</strong> {(() => {
                        const addMonths = (date: Date, months: number) => {
                          const d = new Date(date);
                          const day = d.getDate();
                          d.setDate(1);
                          d.setMonth(d.getMonth() + months);
                          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                          d.setDate(Math.min(day, lastDay));
                          return d;
                        };
                        // T12:00 fixa o dia: 'YYYY-MM-DD' puro vira meia-noite UTC e, em
                        // Cuiabá (UTC-4), a exibição volta para o dia anterior.
                        return formatDate(addMonths(new Date(`${prescriptionBaseDate}T12:00:00`), 24));
                      })()}
                    </p>
                    <p className="text-xs text-slate-600">
                      <strong>Aviso na agenda:</strong> {(() => {
                        const addMonths = (date: Date, months: number) => {
                          const d = new Date(date);
                          const day = d.getDate();
                          d.setDate(1);
                          d.setMonth(d.getMonth() + months);
                          const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                          d.setDate(Math.min(day, lastDay));
                          return d;
                        };
                        // T12:00 fixa o dia: 'YYYY-MM-DD' puro vira meia-noite UTC e, em
                        // Cuiabá (UTC-4), a exibição volta para o dia anterior.
                        return formatDate(addMonths(new Date(`${prescriptionBaseDate}T12:00:00`), 18));
                      })()} (6 meses antes)
                    </p>
                  </div>
                </div>
              )}

              {prescriptionError && (
                <div className="bg-red-50 border border-red-200 rounded-[2px] p-3">
                  <p className="text-sm text-red-800">{prescriptionError}</p>
                </div>
              )}

              {prescriptionSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-[2px] p-3">
                  <p className="text-sm text-emerald-800">{prescriptionSuccess}</p>
                </div>
              )}
              </>}
        </ModalBody>
      </Modal>
    </div>
  );
};

// Modal de Criação de Prazo
interface DeadlineCreationModalProps {
  intimation: DjenComunicacaoLocal;
  analysis?: IntimationAnalysis;
  clients: Client[];
  processes: Process[];
  members: Profile[];
  onClose: () => void;
  onSuccess: () => void;
}

const DeadlineCreationModal: React.FC<DeadlineCreationModalProps> = ({
  intimation,
  analysis,
  clients,
  processes,
  members,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth();
  const process = processes.find((p) => p.id === intimation.process_id);
  const client = clients.find((c) => c.id === intimation.client_id);

  // Prioridade e margem interna vêm de utils/intimationDeadline.ts — antes eram
  // duas cópias que discordavam entre si sobre a urgência 'baixa'.
  const getPriorityFromUrgency = (urgency?: string): DeadlinePriority => prioridadePorUrgencia(urgency);

  const getDeadlineDate = (analysis?: IntimationAnalysis): string =>
    dataInternaDoPrazo(analysis?.deadline?.dueDate);

  const [formData, setFormData] = useState({
    title: analysis?.deadline?.description 
      ? `${analysis.deadline.description} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`
      : `Prazo ${intimation.tipo_comunicacao || 'Intimação'} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`,
    description: analysis?.summary || intimation.texto || '',
    due_date: getDeadlineDate(analysis),
    type: 'processo' as DeadlineType,
    priority: getPriorityFromUrgency(analysis?.urgency),
    client_id: intimation.client_id || '',
    process_id: intimation.process_id || '',
    responsible_id: '',
  });

  // Removido: clientSearchTerm e showClientSuggestions (agora usa ClientSearchSelect no modal de prazo)

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.due_date || !formData.responsible_id) {
      setError('Data de vencimento e responsável são obrigatórios');
      return;
    }

    if (saving) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // formData.responsible_id é m.user_id (auth UID) — precisa do profile.id para salvar no prazo
      const responsibleMember = members.find(m => (m.user_id || m.id) === formData.responsible_id);
      const profileId = responsibleMember?.id || null;
      const responsibleAuthId = responsibleMember?.user_id || null;
      if (!profileId) {
        throw new Error('Selecione um responsável válido para o prazo.');
      }

      const payload: CreateDeadlineDTO = {
        title: formData.title.trim(),
        description: formData.description || null,
        due_date: formData.due_date,
        type: formData.type,
        priority: formData.priority,
        status: 'pendente',
        client_id: formData.client_id || null,
        process_id: formData.process_id || null,
        responsible_id: profileId,
      };

      const createdDeadline = await deadlineService.createDeadline(payload);

      // Notificar responsável se foi atribuído e for diferente do criador
      if (responsibleAuthId && responsibleAuthId !== user?.id) {
        try {
          const deadlineTypeLabels: Record<string, string> = { geral: 'Geral', processo: 'Processo', requerimento: 'Requerimento' };
          const deadlineTypeLabel = deadlineTypeLabels[formData.type] || 'Prazo';
          const priorityLabels: Record<string, string> = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
          const priorityLabel = priorityLabels[formData.priority] || formData.priority;
          const isUrgent = formData.priority === 'urgente' || formData.priority === 'alta';
          const dueDate = new Date(formData.due_date + 'T00:00:00');
          const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
          const daysUntilDue = Math.ceil((dueDate.getTime() - todayD.getTime()) / 86400000);
          const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;
          const assignerName = members.find(m => m.user_id === user?.id)?.name || 'Alguém';

          await userNotificationService.createNotification({
            user_id: responsibleAuthId,
            type: 'deadline_assigned',
            title: isUrgent ? `⚠️ Prazo ${deadlineTypeLabel} — ${priorityLabel}` : `📅 Prazo ${deadlineTypeLabel} Atribuído`,
            message: `${assignerName} atribuiu um prazo a você\n"${formData.title.trim()}" • ${daysLabel}`,
            deadline_id: createdDeadline.id,
          });
        } catch (notifError) {
          console.error('Erro ao criar notificação:', notifError);
        }
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar prazo');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = 'w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  return (
    <Modal
      accentBarClassName="bg-[#031636]"
      open={true}
      onClose={onClose}
      title="Criar Prazo"
      eyebrow="Novo Prazo"
      size="lg"
      zIndex={LAYER.MODAL}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded-[2px] transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="deadline-form"
            disabled={saving}
            className="px-4 py-2 bg-[#031636] hover:bg-[#0a2b5c] text-white text-sm font-medium rounded-[2px] flex items-center gap-2 transition disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Criar Prazo
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        {/* Informações da Intimação */}
        <div className="bg-[#f8f7f5] dark:bg-zinc-800 border border-[#e7e5df] dark:border-[#e7e5df] rounded-[2px] p-4 mb-6">
          <h4 className="text-sm font-semibold text-[#031636] mb-2">Intimação Vinculada</h4>
          <p className="text-sm text-slate-600">
            <strong>Processo:</strong> {intimation.numero_processo_mascara || intimation.numero_processo || 'Sem número'}
          </p>
          {client && (
            <p className="text-sm text-slate-600">
              <strong>Cliente:</strong> {client.full_name}
            </p>
          )}
          <p className="text-sm text-slate-600">
            <strong>Tipo:</strong> {intimation.tipo_comunicacao || 'Intimação'}
          </p>
        </div>

        <form id="deadline-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Título */}
          <div>
            <label className={labelStyle}>
              Título do Prazo *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
              required
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Descrição
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
            />
          </div>

          {/* Data de Vencimento */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Data de Vencimento *
            </label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
              min={new Date().toISOString().split('T')[0]}
              required
            />
            {analysis?.deadline?.dueDate && (
              <div className="mt-2 p-2 bg-[#f8f7f5] border border-[#e7e5df] rounded-[2px]">
                <p className="text-xs text-[#031636] font-semibold">
                  ⚠️ Prazo Final: {formatDateLong(analysis.deadline.dueDate)}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  ✓ Data sugerida preenchida: 1 dia antes (margem de segurança)
                </p>
              </div>
            )}
          </div>

          {/* Cliente */}
          <div>
            <ClientSearchSelect
              value={formData.client_id}
              onChange={(clientId) => setFormData({ ...formData, client_id: clientId })}
              label={`Cliente ${intimation.client_id ? '(vinculado automaticamente)' : ''}`}
              placeholder="Buscar cliente..."
              allowCreate={true}
            />
          </div>

          {/* Responsável */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Responsável *
            </label>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, responsible_id: formData.responsible_id === (m.user_id || m.id) ? '' : (m.user_id || m.id) })}
                  className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${
                    formData.responsible_id === (m.user_id || m.id)
                      ? 'ring-2 ring-offset-2 ring-[#031636]'
                      : 'ring-1 ring-transparent hover:ring-slate-300'
                  }`}
                  title={m.name || m.email || ''}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#f8f7f5] flex items-center justify-center text-sm font-semibold text-slate-600">
                      {(m.name || m.email || '?')[0].toUpperCase()}
                    </div>
                  )}
                  {formData.responsible_id === (m.user_id || m.id) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#031636] rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {formData.responsible_id && (
              <p className="text-xs text-slate-600 mt-2">
                ✓ {members.find(m => (m.user_id || m.id) === formData.responsible_id)?.name || 'Responsável selecionado'}
              </p>
            )}
          </div>

          {/* Tipo e Prioridade */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Tipo
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as DeadlineType })}
                className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
              >
                <option value="processo">Processo</option>
                <option value="requerimento">Requerimento</option>
                <option value="geral">Geral</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Prioridade
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as DeadlinePriority })}
                className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
              >
                <option value="urgente">Urgente</option>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-[2px] p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </form>
      </ModalBody>
    </Modal>
  );
};

// Modal de Criação de Compromisso
interface AppointmentCreationModalProps {
  intimation: DjenComunicacaoLocal;
  analysis?: IntimationAnalysis;
  clients: Client[];
  processes: Process[];
  members: Profile[];
  onClose: () => void;
  onSuccess: () => void;
}

const AppointmentCreationModal: React.FC<AppointmentCreationModalProps> = ({
  intimation,
  analysis,
  clients,
  processes,
  members,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth();
  const process = processes.find((p) => p.id === intimation.process_id);
  const client = clients.find((c) => c.id === intimation.client_id);

  // Determinar tipo de compromisso baseado na análise
  const getEventTypeFromAnalysis = (analysis?: IntimationAnalysis): CalendarEventType => {
    if (!analysis) return 'meeting';
    // Se tem prazo, é uma audiência ou prazo processual
    if (analysis.deadline) return 'hearing';
    return 'meeting';
  };

  // Usar data EXATA da audiência (não 3 dias antes)
  const getAppointmentDate = (analysis?: IntimationAnalysis): string => {
    if (!analysis?.deadline?.dueDate) return '';
    // Retorna data exata do prazo para audiências
    return analysis.deadline.dueDate.split('T')[0];
  };

  // Horário padrão de Cuiabá (GMT-4) - 14:00 (horário comum de audiências)
  const getAppointmentTime = (analysis?: IntimationAnalysis): string => {
    // Se for audiência, usar horário padrão de 14:00 (horário de Cuiabá)
    if (analysis?.deadline) return '14:00';
    return '09:00';
  };

  const [formData, setFormData] = useState({
    title: analysis?.deadline?.description
      ? `${analysis.deadline.description} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`
      : `Compromisso ${intimation.tipo_comunicacao || 'Intimação'} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`,
    description: analysis?.summary || intimation.texto || '',
    date: getAppointmentDate(analysis),
    time: getAppointmentTime(analysis),
    type: getEventTypeFromAnalysis(analysis),
    client_id: intimation.client_id || '',
    responsible_id: '',
    event_mode: '' as '' | 'presencial' | 'online',
  });

  // Removido: clientSearchTerm e showClientSuggestions (agora usa ClientSearchSelect no modal de compromisso)

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.date || !formData.time || !formData.responsible_id) {
      setError('Data, hora e responsável são obrigatórios');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const startAt = `${formData.date}T${formData.time}:00`;
      const durationMin: Record<string, number> = {
        deadline: 60, hearing: 120, requirement: 60, payment: 30, meeting: 60, pericia: 180, personal: 60,
      };
      // Hora de parede: o serviço ancora start/end no fuso do escritório.
      const endAt = addMinutesToWallTime(startAt, durationMin[formData.type] ?? 60);

      const payload: CreateCalendarEventDTO = {
        title: formData.title,
        description: formData.description || null,
        event_type: formData.type,
        status: 'pendente',
        start_at: startAt,
        end_at: endAt,
        client_id: formData.client_id || null,
        process_id: intimation.process_id || null,
        user_id: formData.responsible_id || null,
        event_mode: (['hearing', 'meeting', 'pericia'] as CalendarEventType[]).includes(formData.type as CalendarEventType)
          ? (formData.event_mode || null)
          : null,
        // Vínculo intimação → compromisso (guardião de compromissos)
        djen_intimation_id: intimation.id,
      };

      const createdAppointment = await calendarService.createEvent(payload);

      // Notificar responsável se foi atribuído e for diferente do criador
      const responsibleAuthId = formData.responsible_id || null;
      if (responsibleAuthId && responsibleAuthId !== user?.id) {
        try {
          const EVENT_TYPE_LABELS: Record<string, string> = {
            hearing: 'Audiência', meeting: 'Reunião', payment: 'Pagamento',
            pericia: 'Perícia', personal: 'Pessoal', requirement: 'Requerimento', deadline: 'Prazo',
          };
          const typeEmojis: Record<string, string> = {
            hearing: '⚖️', meeting: '🤝', payment: '💰', pericia: '🔬',
            personal: '👤', requirement: '📋', deadline: '📅',
          };
          const typeLabel = EVENT_TYPE_LABELS[formData.type] || 'Compromisso';
          const typeEmoji = typeEmojis[formData.type] || '📅';
          const assignerName = members.find(m => m.user_id === user?.id)?.name || 'Alguém';
          const eventDate = new Date(`${formData.date}T${formData.time}:00`);
          const formattedDate = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            + ' ' + eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          await userNotificationService.createNotification({
            user_id: responsibleAuthId,
            type: 'appointment_assigned',
            title: `${typeEmoji} Nova ${typeLabel}`,
            message: `${assignerName} atribuiu uma ${typeLabel} a você\n"${formData.title}" • ${formattedDate}`,
            appointment_id: createdAppointment.id,
          });
        } catch (notifError) {
          console.error('Erro ao criar notificação:', notifError);
          // Não bloqueia a criação do compromisso se notificação falhar
        }
      }
      
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar compromisso');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = 'w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  return (
    <Modal
      accentBarClassName="bg-[#031636]"
      open={true}
      onClose={onClose}
      title="Adicionar Compromisso"
      eyebrow="Novo Compromisso"
      size="lg"
      zIndex={LAYER.MODAL}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded-[2px] transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="appointment-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-[2px] bg-[#031636] hover:bg-[#031636] px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Criar Compromisso
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <form id="appointment-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Título */}
          <div>
            <label className={labelStyle}>
              Título do Compromisso *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={inputStyle}
              required
            />
          </div>

          {/* Descrição */}
          <div>
            <label className={labelStyle}>Descrição</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full rounded-[2px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#031636]/40 focus:border-[#e7e5df] border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
            />
          </div>

          {/* Cliente */}
          <div>
            <ClientSearchSelect
              value={formData.client_id}
              onChange={(clientId) => setFormData({ ...formData, client_id: clientId })}
              label={`Cliente ${intimation.client_id ? '(vinculado automaticamente)' : ''}`}
              placeholder="Buscar cliente..."
              allowCreate={true}
            />
          </div>

          {/* Data | Hora | Modalidade */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelStyle}>Data *</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className={inputStyle}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </div>
            <div>
              <label className={labelStyle}>Hora * <span className="font-normal text-slate-400">(GMT-4)</span></label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className={inputStyle}
                required
              />
            </div>
            {(['hearing', 'meeting', 'pericia'] as CalendarEventType[]).includes(formData.type as CalendarEventType) && (
              <div>
                <label className={labelStyle}>Modalidade</label>
                <select
                  value={formData.event_mode}
                  onChange={(e) => setFormData({ ...formData, event_mode: e.target.value as '' | 'presencial' | 'online' })}
                  className={inputStyle}
                >
                  <option value="">Não definida</option>
                  <option value="presencial">Presencial</option>
                  <option value="online">Online</option>
                </select>
              </div>
            )}
          </div>

          {/* Tipo — chips */}
          <div>
            <label className={labelStyle}>Tipo de Compromisso</label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {([
                { value: 'meeting',     label: 'Reunião',    active: 'bg-[#031636] text-white border-[#031636]',       idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-slate-400 hover:text-[#031636]' },
                { value: 'hearing',     label: 'Audiência',  active: 'bg-red-500 text-white border-red-500',         idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-red-400 hover:text-red-600' },
                { value: 'deadline',    label: 'Prazo',      active: 'bg-[#031636] text-white border-[#031636]',       idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-slate-400 hover:text-[#031636]' },
                { value: 'requirement', label: 'Diligência', active: 'bg-[#031636] text-white border-[#e7e5df]',   idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-[#e7e5df] hover:text-slate-600' },
                { value: 'payment',     label: 'Pagamento',  active: 'bg-emerald-500 text-white border-emerald-500', idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-emerald-400 hover:text-emerald-600' },
                { value: 'pericia',     label: 'Perícia',    active: 'bg-[#031636] text-white border-[#031636]',   idle: 'bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-600 hover:border-slate-400 hover:text-[#031636]' },
              ] as const).map(({ value, label, active, idle }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormData({ ...formData, type: value, event_mode: '' })}
                  className={`py-1.5 rounded-[2px] text-xs font-semibold border transition-all text-center ${formData.type === value ? active : idle}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Responsável */}
          <div>
            <div className="flex items-baseline gap-2 mb-2">
              <label className={labelStyle}>Responsável *</label>
              {formData.responsible_id
                ? <span className="text-xs text-slate-600 font-semibold truncate">{members.find(m => (m.user_id || m.id) === formData.responsible_id)?.name || 'Selecionado'}</span>
                : <span className="text-xs text-slate-400">Selecione um advogado</span>
              }
            </div>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, responsible_id: formData.responsible_id === (m.user_id || m.id) ? '' : (m.user_id || m.id) })}
                  className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all hover:scale-110 ${
                    formData.responsible_id === (m.user_id || m.id)
                      ? 'ring-2 ring-offset-2 ring-[#031636] scale-110'
                      : 'ring-1 ring-white dark:ring-zinc-600 hover:ring-slate-300'
                  }`}
                  title={m.name || m.email || ''}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} className="w-10 h-10 rounded-full object-cover" alt={m.name || ''} />
                  ) : (
                    <div className="w-10 h-10 rounded-[2px] bg-[#f8f7f5] dark:bg-[#031636]/30 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-400">
                      {(m.name || m.email || '?')[0].toUpperCase()}
                    </div>
                  )}
                  {formData.responsible_id === (m.user_id || m.id) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#031636] rounded-full flex items-center justify-center">
                      <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-[2px] p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </form>
      </ModalBody>
    </Modal>
  );
};

export default IntimationsModule;
