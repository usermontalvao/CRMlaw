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
} from 'lucide-react';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { clientService } from '../services/client.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { profileService } from '../services/profile.service';
import { matchesNormalizedSearch } from '../utils/search';
import { formatDate as formatDateValue, formatDateTime as formatDateTimeValue } from '../utils/formatters';
import { settingsService, type DjenConfig } from '../services/settings.service';
import { userNotificationService } from '../services/userNotification.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { aiService } from '../services/ai.service';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportIntimations';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { supabase } from '../config/supabase';
import { useSelectionState } from '../hooks/useSelectionState';
import type { DjenComunicacaoLocal, DjenConsultaParams, UpdateDjenComunicacaoDTO } from '../types/djen.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { CreateDeadlineDTO, DeadlineType, DeadlinePriority } from '../types/deadline.types';
import type { CreateCalendarEventDTO, CalendarEventType } from '../types/calendar.types';
import type { Profile } from '../services/profile.service';
import type { IntimationAnalysis } from '../types/ai.types';

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
  const { user } = useAuth();
  
  // Estados principais
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialSnapshotLoaded, setInitialSnapshotLoaded] = useState(false);
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

    const confirmed = window.confirm(`Remover ${ids.length} intimação(ões) selecionada(s)? Esta ação é irreversível.`);
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
    const confirmed = window.confirm('Remover todas as intimações marcadas como lidas? Esta ação é irreversível.');
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

    // Criar mapa de números de processos (normalizado) -> process_id
    const processNumberMap = new Map<string, string>();
    if (processesData) {
      processesData.forEach(process => {
        const normalizedNumber = (process.process_code || '').trim().toUpperCase();
        processNumberMap.set(normalizedNumber, process.id);
      });
      console.log(`⚖️ Mapa de processos criado com ${processNumberMap.size} números`);
    }

    let linkedCount = 0;
    
    for (const intimation of intimationsData) {
      // Pular se já tem cliente ou processo vinculado
      if (intimation.client_id && intimation.process_id) {
        continue;
      }
      
      // Buscar partes: primeiro dos destinatários, depois do texto
      const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
        ? intimation.djen_destinatarios.map(d => d.nome)
        : extractPartesFromTexto(htmlToText(intimation.texto || '')).map(p => p.nome);
      
      console.log(`📋 Intimação ${intimation.id.substring(0, 8)}: ${partes.length} partes encontradas`, partes.slice(0, 2));
      
      // Verificar se alguma parte corresponde a um cliente
      for (const parteNome of partes) {
        const normalizedParte = parteNome.trim().toUpperCase();
        const matchedClientId = clientNameMap.get(normalizedParte);
        
        if (matchedClientId && !intimation.client_id) {
          try {
            await djenLocalService.vincularCliente(intimation.id, matchedClientId);
            linkedCount++;
            console.log(`🔗 Vinculação automática: "${parteNome}" -> cliente ${matchedClientId.substring(0, 8)}`);
            break; // Vincula apenas ao primeiro match
          } catch (err) {
            console.error(`Erro ao vincular automaticamente:`, err);
          }
        }
      }

      // Verificar se o número do processo corresponde a algum processo cadastrado
      if (intimation.numero_processo && !intimation.process_id) {
        const normalizedProcessNumber = intimation.numero_processo.trim().toUpperCase();
        const matchedProcessId = processNumberMap.get(normalizedProcessNumber);
        
        if (matchedProcessId) {
          try {
            await djenLocalService.vincularProcesso(intimation.id, matchedProcessId);
            linkedCount++;
            console.log(`🔗 Vinculação automática: processo "${intimation.numero_processo}" -> ${matchedProcessId.substring(0, 8)}`);
          } catch (err) {
            console.error(`Erro ao vincular processo automaticamente:`, err);
          }
        }
      }
    }
    
    if (linkedCount > 0) {
      console.log(`✅ ${linkedCount} intimação(ões) vinculada(s) automaticamente`);
    } else {
      console.log(`ℹ️ Nenhuma intimação vinculada automaticamente`);
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
      toast.error('IA não configurada', 'Configure VITE_OPENAI_API_KEY para usar esta função.');
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

  // Marcar como lida
  const handleMarkAsRead = async (id: string) => {
    try {
      await djenLocalService.marcarComoLida(id);
      
      // Atualizar estado local sem recarregar tudo
      setIntimations(prev => prev.map(int => 
        int.id === id ? { ...int, lida: true, lida_em: new Date().toISOString() } : int
      ));
      
      // 🔔 Marcar notificação correspondente como lida
      if (user?.id) {
        try {
          await userNotificationService.markAsReadByIntimationId(id, user.id);
        } catch {}
      }
      
      toast.success('Marcado como lida');
    } catch (err: any) {
      toast.error('Erro ao marcar', err.message);
    }
  };

  const handleClearAllIntimations = async () => {
    if (clearingAll) return;

    const confirmed = window.confirm(
      'Tem certeza que deseja remover todas as intimações sincronizadas? Esta ação não pode ser desfeita.'
    );

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
    try {
      const unreadIds = intimations.filter(int => !int.lida).map(int => int.id);
      if (unreadIds.length === 0) {
        toast.info('Info', 'Nenhuma intimação não lida encontrada');
        return;
      }
      for (const id of unreadIds) {
        await djenLocalService.marcarComoLida(id);
      }
      await reloadIntimations();
      toast.success('Sucesso', `${unreadIds.length} intimações marcadas como lidas`);
    } catch (err: any) {
      toast.error('Erro', err.message);
    }
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

    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await handleMarkAsRead(id);
    }
    
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
    setSelectedProcessId(intimation.process_id || '');
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

  // Contadores
  const unreadCount = intimations.filter((i) => !i.lida).length;
  const readCount = intimations.filter((i) => i.lida).length;

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
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      target: overviewSectionRef,
    },
    {
      key: 'settings',
      label: 'Configurações',
      description: 'Token externo e preferências',
      icon: <FileCog className="w-4 h-4" />,
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      target: configSectionRef,
    },
    {
      key: 'filters',
      label: 'Filtros & Agrupamento',
      description: 'Controle de visualização e busca',
      icon: <Filter className="w-4 h-4" />,
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      target: filterSectionRef,
    },
    {
      key: 'list',
      label: 'Lista de Intimações',
      description: 'Gerencie comunicações e ações',
      icon: <FileText className="w-4 h-4" />,
      bg: 'bg-purple-50',
      text: 'text-purple-700',
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
      const processKey = processCode || intimation.numero_processo_mascara || intimation.numero_processo || 'Sem número';
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

  const formatDate = (dateStr: string) => {
    try {
      return formatDateValue(dateStr);
    } catch {
      return dateStr;
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
    if (!status) return 'bg-slate-100 text-slate-600';
    const normalized = status.toLowerCase();
    if (['success', 'completed', 'ok'].some((tag) => normalized.includes(tag))) {
      return 'bg-zinc-100 text-zinc-700 border border-zinc-300';
    }
    if (['error', 'failed'].some((tag) => normalized.includes(tag))) {
      return 'bg-red-100 text-red-700';
    }
    if (['running', 'processing'].some((tag) => normalized.includes(tag))) {
      return 'bg-amber-100 text-amber-700';
    }
    return 'bg-slate-100 text-slate-600';
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

  if (!initialSnapshotLoaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando intimações...</p>
        </div>
      </div>
    );
  }

  // ── helpers de urgência ──────────────────────────────────────────────
  // Detecta resultado do julgamento a partir do resumo da IA
  const detectOutcome = (summary?: string): { label: string; cls: string } | null => {
    if (!summary) return null;
    const s = summary.toUpperCase();
    if (/PROCEDENTE/.test(s) && !/IMPROCEDENTE/.test(s)) {
      return { label: 'PROCEDENTE', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' };
    }
    if (/IMPROCEDENTE/.test(s)) {
      return { label: 'IMPROCEDENTE', cls: 'bg-red-50 text-red-700 border-red-300' };
    }
    if (/PARCIALMENTE PROCEDENTE/.test(s)) {
      return { label: 'PARCIAL', cls: 'bg-amber-50 text-amber-700 border-amber-300' };
    }
    if (/TUTELA\s+(DE URGÊNCIA|CONCEDIDA|DEFERIDA)|LIMINAR\s+(CONCEDIDA|DEFERIDA)/.test(s)) {
      return { label: 'TUTELA CONCEDIDA', cls: 'bg-violet-50 text-violet-700 border-violet-300' };
    }
    if (/TUTELA\s+(NEGADA|INDEFERIDA)|LIMINAR\s+(NEGADA|INDEFERIDA)/.test(s)) {
      return { label: 'TUTELA NEGADA', cls: 'bg-red-50 text-red-700 border-red-300' };
    }
    if (/CONDENADO|CONDENA[ÇC][ÃA]O/.test(s)) {
      return { label: 'CONDENAÇÃO', cls: 'bg-red-50 text-red-700 border-red-300' };
    }
    return null;
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
    prazo:      { icon: Clock,         cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',       badge: 'Prazo',       onClick: (i) => handleCreateDeadline(i) },
    audiencia:  { icon: CalendarIcon,  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',   badge: 'Audiência',   onClick: (i) => handleCreateAppointment(i) },
    pagamento:  { icon: Banknote,      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', badge: 'Pagamento',  onClick: (_i) => onNavigateToModule?.('financeiro') },
    vinculo:    { icon: Link2,         cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',            badge: 'Vínculo',     onClick: (i) => handleOpenLinkModal(i) },
    prescricao: { icon: ShieldAlert,   cls: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',   badge: 'Prescrição',  onClick: (i) => handleOpenPrescriptionModal(i) },
    info:       { icon: Lightbulb,     cls: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100',       badge: '',            onClick: (_i) => {} },
  };

  const urgencyConfig = {
    critica: { border: 'border-l-red-500',    dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-300',          label: 'Crítica' },
    alta:    { border: 'border-l-orange-400', dot: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 border-orange-300', label: 'Alta' },
    media:   { border: 'border-l-zinc-300',   dot: 'bg-zinc-400',   badge: 'bg-zinc-100 text-zinc-600 border-zinc-300',      label: 'Média' },
    baixa:   { border: 'border-l-zinc-200',   dot: 'bg-zinc-300',   badge: 'bg-zinc-50 text-zinc-400 border-zinc-200',       label: 'Baixa' },
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

  const highlightText = (rawText: string, importantPassages?: string[]): React.ReactNode => {
    if (!rawText) return null;
    const text = htmlToText(rawText);
    type MatchEntry = { start: number; end: number; cls: string };
    const allMatches: MatchEntry[] = [];

    // 1. AI-identified important passages — amber background highlight
    if (importantPassages && importantPassages.length > 0) {
      for (const passage of importantPassages) {
        const found = findPassageInText(text, passage);
        if (found) {
          allMatches.push({ ...found, cls: 'bg-amber-100 text-zinc-900 rounded px-0.5' });
        }
      }
    }

    // 2. Structural markers always: R$ values and dates
    const structuralPatterns: { regex: RegExp; cls: string }[] = [
      { regex: /R\$\s?[\d.,]+/g,           cls: 'font-semibold text-zinc-900' },
      { regex: /\b\d{2}\/\d{2}\/\d{4}\b/g, cls: 'font-semibold text-zinc-700' },
    ];
    for (const { regex, cls } of structuralPatterns) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        allMatches.push({ start: m.index, end: m.index + m[0].length, cls });
      }
    }

    if (allMatches.length === 0) return text;
    allMatches.sort((a, b) => a.start - b.start);
    const filtered: MatchEntry[] = [];
    let lastEnd = 0;
    for (const entry of allMatches) {
      if (entry.start >= lastEnd) { filtered.push(entry); lastEnd = entry.end; }
    }
    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const entry of filtered) {
      if (entry.start > pos) nodes.push(text.slice(pos, entry.start));
      nodes.push(<mark key={entry.start} className={entry.cls}>{text.slice(entry.start, entry.end)}</mark>);
      pos = entry.end;
    }
    if (pos < text.length) nodes.push(text.slice(pos));
    return <>{nodes}</>;
  };

  // Visualização de detalhes
  if (selectedIntimation) {
    const client = getClientName(selectedIntimation.client_id);
    const process = getProcessCode(selectedIntimation.process_id);
    const detailAnalysis = aiAnalysis.get(selectedIntimation.id);
    const detailUrgency = detailAnalysis?.urgency as keyof typeof urgencyConfig | undefined;
    const detailUrgCfg = detailUrgency ? urgencyConfig[detailUrgency] : null;

    const decodedTexto = htmlToText(selectedIntimation.texto || '');
    const partes = selectedIntimation.djen_destinatarios && selectedIntimation.djen_destinatarios.length > 0
      ? selectedIntimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
      : extractPartesFromTexto(decodedTexto);

    return (
      <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-slate-200/80 shadow-lg bg-white">

        {/* ── Header ── */}
        <div className="bg-slate-900 px-5 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setSelectedIntimation(null)}
              className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition text-xs font-medium"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              Voltar à lista
            </button>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-white/10 text-white">
                {selectedIntimation.sigla_tribunal}
              </span>
              {!selectedIntimation.lida && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-400/20 text-amber-300">
                  <EyeOff className="w-3 h-3" /> Não lida
                </span>
              )}
              {detailUrgCfg && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${detailUrgCfg.badge}`}>
                  {urgencyConfig[detailUrgency!].label}
                </span>
              )}
              <button onClick={() => setSelectedIntimation(null)} className="ml-1 p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-lg font-bold text-white font-mono leading-tight">
            {selectedIntimation.numero_processo_mascara || selectedIntimation.numero_processo}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1">
            <span className="text-xs text-slate-400">{formatDate(selectedIntimation.data_disponibilizacao)}</span>
            {selectedIntimation.nome_orgao && <span className="text-xs text-slate-500">{selectedIntimation.nome_orgao}</span>}
            {selectedIntimation.tipo_comunicacao && (
              <span className="text-xs text-amber-400/80 font-medium">{selectedIntimation.tipo_comunicacao}</span>
            )}
            {selectedIntimation.nome_classe && (
              <span className="text-xs text-slate-500">{selectedIntimation.nome_classe}</span>
            )}
          </div>
        </div>

        {/* ── Metadata compacta ── */}
        {(client || process || partes.length > 0) && (
          <div className="flex-shrink-0 border-b border-slate-100 bg-slate-50/60 px-5 py-3 flex flex-wrap gap-4">
            {client && (
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Cliente</p>
                <p className="text-xs font-semibold text-slate-800 truncate max-w-[160px]">{client}</p>
              </div>
            )}
            {process && (
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Processo</p>
                <p className="text-xs font-mono font-semibold text-slate-800 truncate max-w-[160px]">{process}</p>
              </div>
            )}
            {partes.length > 0 && (
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Partes</p>
                <div className="flex flex-wrap gap-1">
                  {partes.slice(0, 3).map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] text-slate-700">
                      <span className="font-medium">{p.nome}</span>
                      {p.polo && <span className="text-slate-400 text-[10px]">({p.polo})</span>}
                    </span>
                  ))}
                  {partes.length > 3 && <span className="text-[11px] text-slate-400">+{partes.length - 3}</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── IA Analysis (se disponível) ── */}
        {detailAnalysis && (
          <div className="flex-shrink-0 border-b border-slate-100">
            <div className={`mx-4 my-3 rounded-xl p-3.5 border ${detailUrgCfg?.badge ?? 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  <p className="text-xs font-semibold text-slate-800 leading-snug">{detailAnalysis.summary}</p>
                </div>
                {detailAnalysis.deadline && (
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-slate-900">{detailAnalysis.deadline.days}d úteis</p>
                    {detailAnalysis.deadline.dueDate && (
                      <p className="text-[10px] text-slate-600">{new Date(detailAnalysis.deadline.dueDate).toLocaleDateString('pt-BR')}</p>
                    )}
                  </div>
                )}
              </div>
              {detailAnalysis.deadline?.description && (
                <p className="text-[11px] text-slate-600 mt-1.5 ml-5">{detailAnalysis.deadline.description}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Conteúdo do documento ── */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <div className="w-1 h-4 rounded-full bg-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Conteúdo da Intimação</span>
            </div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-[1.8] font-[system-ui] selection:bg-amber-100">
              {highlightText(selectedIntimation.texto || '', detailAnalysis?.importantPassages)}
            </div>
          </div>
        </div>

        {/* ── Ações ── */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {!selectedIntimation.lida && (
              <button onClick={() => { handleMarkAsRead(selectedIntimation.id); setSelectedIntimation(null); }}
                className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3.5 py-2 rounded-lg transition text-xs shadow-sm shadow-emerald-200">
                <CheckCircle className="w-3.5 h-3.5" /> Marcar lida
              </button>
            )}
            <button onClick={() => { handleCreateDeadline(selectedIntimation); setSelectedIntimation(null); }}
              className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3.5 py-2 rounded-lg transition text-xs shadow-sm shadow-amber-200">
              <Clock className="w-3.5 h-3.5" /> Novo Prazo
            </button>
            <button onClick={() => { handleCreateAppointment(selectedIntimation); setSelectedIntimation(null); }}
              className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg transition text-xs border border-slate-200">
              <CalendarIcon className="w-3.5 h-3.5 text-indigo-500" /> Compromisso
            </button>
            <button onClick={() => { handleOpenPrescriptionModal(selectedIntimation); setSelectedIntimation(null); }}
              className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg transition text-xs border border-slate-200">
              <AlertTriangle className="w-3.5 h-3.5 text-orange-500" /> Prescrição
            </button>
            <button onClick={() => { handleOpenLinkModal(selectedIntimation); setSelectedIntimation(null); }}
              className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg transition text-xs border border-slate-200">
              <Link2 className="w-3.5 h-3.5 text-blue-500" /> Vincular
            </button>
            {selectedIntimation.link && (
              <a href={selectedIntimation.link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg transition text-xs border border-slate-200">
                <ExternalLink className="w-3.5 h-3.5 text-purple-500" /> Ver Diário
              </a>
            )}
          </div>
        </div>

      </div>
    );
  }

  return (
    <div className="space-y-0">

      {/* ═══════════════════════════════════════════
          PREMIUM CARD WRAPPER
      ═══════════════════════════════════════════ */}
      {/* glass card wrapper */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">

        {/* amber accent top line */}
        <div className="h-0.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-sm shadow-amber-200 flex-shrink-0">
              <Gavel className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Diário de Justiça Eletrônico</h2>
              <p className="text-[11px] text-slate-400 leading-tight">Comunicações processuais do DJEN</p>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-full ml-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-medium text-slate-500">
                {unreadCount > 0 ? `${unreadCount} não lidas` : 'Em dia'}
              </span>
              {aiUrgencyStats.alta > 0 && (
                <span className="text-[11px] font-semibold text-red-500 ml-1">· {aiUrgencyStats.alta} urgentes</span>
              )}
            </div>
          </div>
          <div className="flex-1" />
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar processo, parte..."
              className="w-56 bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 focus:bg-white transition" />
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-sm shadow-amber-200 transition disabled:opacity-50 flex-shrink-0">
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>
        </div>

        {/* Mobile search */}
        <div className="sm:hidden px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar processo, parte..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 transition" />
          </div>
        </div>

        {/* ── FILTER / TABS BAR ── */}
        <div className="px-4 sm:px-5 py-2.5 border-b border-slate-100 flex items-center justify-between gap-3">
          {/* Pill tabs */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto flex-shrink-0">
            {([
              { key: 'unread'   as const, label: 'Não lidas',   count: unreadCount },
              { key: 'linked'   as const, label: 'Vinculadas',  count: intimations.filter(isLinked).length },
              { key: 'unlinked' as const, label: 'Sem vínculo', count: intimations.filter(isUnlinked).length },
              { key: 'read'     as const, label: 'Lidas',       count: readCount },
              { key: 'all'      as const, label: 'Todas',       count: intimations.length },
            ]).map((tab) => (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                <span className={`text-[10px] tabular-nums font-bold px-1.5 py-0.5 rounded-full ${
                  statusFilter === tab.key
                    ? tab.key === 'unread' && tab.count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    : 'text-slate-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Right: compact action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">

              {/* Filtros dropdown */}
              <div className="relative">
                <button
                  onClick={() => { setMobileControlsExpanded(!mobileControlsExpanded); setShowClearMenu(false); setShowExportMenu(false); setShowSettingsMenu(false); }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                    mobileControlsExpanded || tribunalFilter !== 'all' || dateFilter !== '30days' || urgencyFilter !== 'all' || groupByProcess || showFilters || selectionMode
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white/70 text-slate-500 border-slate-200 hover:bg-white hover:border-slate-300'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Filtros</span>
                  {(tribunalFilter !== 'all' || dateFilter !== '30days' || urgencyFilter !== 'all' || groupByProcess) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  )}
                </button>

                {mobileControlsExpanded && (
                  <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl shadow-2xl border border-zinc-200 z-50 p-4 space-y-3">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Filtros avançados</p>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Tribunal</label>
                        <select value={tribunalFilter} onChange={(e) => setTribunalFilter(e.target.value)}
                          className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-xs text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-500 bg-white">
                          <option value="all">Todos</option>
                          {availableTribunals.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Período</label>
                        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as any)}
                          className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-xs text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-500 bg-white">
                          <option value="30days">30 dias</option>
                          <option value="60days">60 dias</option>
                          <option value="90days">90 dias</option>
                          <option value="all">Todos</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Urgência IA</label>
                      <div className="flex gap-1 flex-wrap">
                        {([
                          { key: 'all'   as const, label: 'Todas' },
                          { key: 'alta'  as const, label: 'Alta' },
                          { key: 'media' as const, label: 'Média' },
                          { key: 'baixa' as const, label: 'Baixa' },
                        ]).map(c => (
                          <button key={c.key} onClick={() => setUrgencyFilter(c.key)}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition ${
                              urgencyFilter === c.key ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-400'
                            }`}>{c.label}</button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-2 border-t border-zinc-100">
                      <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                        <input type="checkbox" checked={groupByProcess} onChange={(e) => setGroupByProcess(e.target.checked)}
                          className="rounded border-zinc-300" />
                        <Layers className="w-3.5 h-3.5 text-zinc-500" />
                        Agrupar por processo
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                        <input type="checkbox" checked={selectionMode}
                          onChange={(e) => { setSelectionMode(e.target.checked); if (!e.target.checked) clearSelectedIds(); }}
                          className="rounded border-zinc-300" />
                        Modo seleção múltipla
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                        <input type="checkbox" checked={showFilters} onChange={(e) => setShowFilters(e.target.checked)}
                          className="rounded border-zinc-300" />
                        Filtrar por data personalizada
                      </label>
                    </div>

                    {showFilters && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
                        <div>
                          <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">De</label>
                          <input type="date" value={customDateStart} onChange={(e) => setCustomDateStart(e.target.value)}
                            className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Até</label>
                          <input type="date" value={customDateEnd} onChange={(e) => setCustomDateEnd(e.target.value)}
                            className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500" />
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
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition disabled:opacity-40" title="Limpar">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {showClearMenu && (
                  <div className="absolute right-0 mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-zinc-200 z-50 py-1 text-sm text-zinc-700">
                    <button onClick={handleDeleteSelected} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-zinc-500" /> Remover selecionadas
                    </button>
                    <button onClick={handleDeleteRead} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2">
                      <EyeOff className="w-4 h-4 text-zinc-500" /> Remover lidas
                    </button>
                    <button onClick={handleMarkAllAsRead} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-zinc-500" /> Marcar todas lidas
                    </button>
                    <div className="border-t border-zinc-100 my-1" />
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
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition disabled:opacity-40" title="Exportar">
                  <Download className="w-3.5 h-3.5" />
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 mt-1.5 w-36 bg-white rounded-xl shadow-xl border border-zinc-200 z-50 py-1 text-sm text-zinc-700">
                    <button onClick={handleExportCSV} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2"><FileText className="w-4 h-4" /> CSV</button>
                    <button onClick={handleExportExcel} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2"><FileText className="w-4 h-4" /> Excel</button>
                    <button onClick={handleExportPDF} className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-center gap-2"><FileText className="w-4 h-4" /> PDF</button>
                  </div>
                )}
              </div>

              {/* Config */}
              <div className="relative">
                <button onClick={() => { setShowSettingsMenu(!showSettingsMenu); setShowClearMenu(false); setShowExportMenu(false); setMobileControlsExpanded(false); }}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:border-slate-300 bg-white/70 transition" title="Configurações">
                  <Settings className="w-3.5 h-3.5" />
                </button>
                {showSettingsMenu && (
                  <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-zinc-200 z-50 p-4 space-y-3">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Configurações</p>
                    <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                      <input type="checkbox" checked={moduleSettings.defaultGroupByProcess}
                        onChange={(e) => { setModuleSettings((prev) => ({ ...prev, defaultGroupByProcess: e.target.checked })); setGroupByProcess(e.target.checked); }}
                        className="rounded border-zinc-300" />
                      Agrupar por processo (padrão)
                    </label>
                    <div className="pt-2 border-t border-zinc-100">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Filtro padrão</label>
                      <select value={moduleSettings.defaultStatusFilter}
                        onChange={(e) => { const v = e.target.value as 'all' | 'unread' | 'read'; setModuleSettings((prev) => ({ ...prev, defaultStatusFilter: v })); }}
                        className="w-full px-2 py-1.5 border border-zinc-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500 bg-white">
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
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-700 bg-indigo-50 border-b border-indigo-100 px-4 sm:px-5 py-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Atualizando em segundo plano...
          </div>
        )}

        {/* ── SELECTION TOOLBAR ── */}
        {selectionMode && selectedIds.size > 0 && (
          <div className="bg-indigo-50 border-b border-indigo-100 px-4 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-indigo-700">
              <strong className="text-indigo-900">{selectedIds.size}</strong> selecionada(s)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleMarkSelectedAsRead}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold rounded-lg transition border border-zinc-300">
                <CheckCircle className="w-3.5 h-3.5 text-zinc-500" /> Marcar lidas
              </button>
              <button onClick={handleBatchLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold rounded-lg transition border border-zinc-300">
                <Link2 className="w-3.5 h-3.5 text-zinc-500" /> Vincular
              </button>
              <button onClick={handleExportSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold rounded-lg transition border border-zinc-300">
                <Download className="w-3.5 h-3.5 text-zinc-500" /> Exportar
              </button>
              <button onClick={handleDeleteSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 text-xs font-semibold rounded-lg transition border border-red-200">
                <Trash2 className="w-3.5 h-3.5" /> Remover
              </button>
              <button onClick={disableSelectionMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-zinc-200 text-zinc-500 text-xs font-semibold rounded-lg transition">
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── LIST AREA ── */}
        <div className="bg-slate-50/60 p-4 sm:p-5 space-y-2.5">
          {filteredIntimations.length === 0 ? (

            /* Empty state */
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 text-slate-300" />
              </div>
              <h4 className="text-base font-semibold text-slate-900 mb-1">Nenhuma intimação encontrada</h4>
              <p className="text-sm text-slate-500">
                {statusFilter === 'unread'
                  ? 'Não há intimações não lidas no momento'
                  : statusFilter === 'read'
                  ? 'Não há intimações lidas'
                  : 'Clique em "Sincronizar" para buscar novas intimações'}
              </p>
            </div>

          ) : groupByProcess && groupedByProcess ? (

            /* ── GROUPED VIEW ── */
            Array.from(groupedByProcess.entries()).map(([processNum, group]) => (
              <div key={processNum} className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">

                {/* Group header */}
                <div className="bg-zinc-50 border-b border-zinc-200 px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-zinc-900 font-mono font-bold text-sm truncate">{processNum}</p>
                      {group[0].client_id && (
                        <p className="text-zinc-500 text-xs truncate">{getClientName(group[0].client_id)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {group.filter((i) => !i.lida).length > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                        {group.filter((i) => !i.lida).length} não lida{group.filter((i) => !i.lida).length !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-zinc-400 text-xs hidden sm:inline">{group.length} total</span>
                    {group.filter((i) => !i.lida).length > 0 && (
                      <button
                        onClick={async () => {
                          for (const int of group.filter((i) => !i.lida)) {
                            await handleMarkAsRead(int.id);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-zinc-50 text-zinc-600 border border-zinc-300 rounded-lg text-xs font-medium transition"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Marcar todas
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
                    return (
                      <div
                        key={intimation.id}
                        className={`border-l-4 transition ${urgCfg ? urgCfg.border : 'border-l-transparent'} ${
                          selectionMode && selectedIds.has(intimation.id) ? 'bg-zinc-50' : 'bg-white'
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
                                className="mt-1 w-4 h-4 text-blue-600 border-slate-300 rounded flex-shrink-0"
                              />
                            )}
                            <div className="flex-shrink-0 mt-1.5">
                              {!intimation.lida && urgCfg && (
                                <span className={`block w-2 h-2 rounded-full ${urgCfg.dot}`} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-100 text-zinc-600">
                                  {intimation.sigla_tribunal}
                                </span>
                                <span className="text-xs text-slate-400">{formatDate(intimation.data_disponibilizacao)}</span>
                                {!intimation.lida && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                                    NÃO LIDA
                                  </span>
                                )}
                                {isLinked(intimation) ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-100 text-zinc-700 border border-zinc-300">
                                    <Link2 className="w-3 h-3" /> Vinculada
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-transparent text-zinc-400 border border-zinc-200">
                                    Sem vínculo
                                  </span>
                                )}
                                {analysis && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                                    <Sparkles className="w-2.5 h-2.5" />
                                    {urgencyConfig[analysis.urgency].label}
                                  </span>
                                )}
                                {intimation.tipo_comunicacao && (
                                  <span className="hidden sm:inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600">
                                    {intimation.tipo_comunicacao}
                                  </span>
                                )}
                              </div>
                              {!isExpanded && (
                                <div className="mt-1 space-y-1.5">
                                  {(() => {
                                    const outcome = detectOutcome(analysis?.summary);
                                    return outcome ? (
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${outcome.cls}`}>
                                        {outcome.label}
                                      </span>
                                    ) : null;
                                  })()}
                                  <p className="text-sm text-slate-500 line-clamp-2">
                                    {analysis?.summary ?? htmlToText(intimation.texto || '').slice(0, 160)}
                                  </p>
                                </div>
                              )}
                              {!isExpanded && analysis?.deadline && (
                                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[11px] font-semibold">
                                    <Clock className="w-3 h-3" /> {analysis.deadline.days} dias úteis
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition">
                                    + Criar prazo
                                  </button>
                                </div>
                              )}
                              {!isExpanded && !analysis && !analyzingIds.has(intimation.id) && aiService.isEnabled() && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                  className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition">
                                  <Sparkles className="w-3 h-3" /> Analisar com IA
                                </button>
                              )}
                              {!isExpanded && analyzingIds.has(intimation.id) && (
                                <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Analisando...
                                </span>
                              )}
                            </div>
                            <div className="flex-shrink-0">
                              {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                            </div>
                          </div>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-slate-100 space-y-3">
                            {!analysis && (
                              <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
                                  <div>
                                    <p className="text-sm font-semibold text-violet-900">Sem análise de IA</p>
                                    <p className="text-xs text-violet-600">A IA pode resumir, detectar prazos e sugerir ações.</p>
                                  </div>
                                </div>
                                {aiService.isEnabled() ? (
                                  analyzingIds.has(intimation.id) ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...
                                    </span>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition flex-shrink-0">
                                      <Sparkles className="w-3.5 h-3.5" /> Analisar agora
                                    </button>
                                  )
                                ) : (
                                  <span className="text-xs text-violet-500">Configure a chave OpenAI</span>
                                )}
                              </div>
                            )}
                            {analysis && (
                              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-violet-600" />
                                    <span className="text-sm font-bold text-slate-900">Análise IA</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    {(() => {
                                      const outcome = detectOutcome(analysis.summary);
                                      return outcome ? (
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${outcome.cls}`}>{outcome.label}</span>
                                      ) : null;
                                    })()}
                                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                                      {urgencyConfig[analysis.urgency].label}
                                    </span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                      title="Re-analisar"
                                      disabled={analyzingIds.has(intimation.id)}
                                      className="p-1 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition disabled:opacity-50">
                                      {analyzingIds.has(intimation.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                </div>
                                <p className="text-sm text-slate-700"><strong>Resumo:</strong> {analysis.summary}</p>
                                {analysis.deadline && (
                                  <div className="bg-white border border-amber-200 rounded-lg p-3 text-xs space-y-1">
                                    <p className="font-semibold text-amber-800 flex items-center gap-1.5">
                                      <Clock className="w-3.5 h-3.5" /> Prazo detectado
                                    </p>
                                    <p className="text-slate-700"><strong>{analysis.deadline.days} dias úteis</strong> — {analysis.deadline.description}</p>
                                    {analysis.deadline.dueDate && (
                                      <p className="text-slate-700 font-medium">Vencimento: {new Date(analysis.deadline.dueDate).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                    )}
                                  </div>
                                )}
                                {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                      <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Ações sugeridas pela IA:
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
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${cfg.cls}`}
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
                              <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">{highlightText(intimation.texto || '', analysis?.importantPassages)}</p>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap gap-2">
                              {!intimation.lida && (
                                <button onClick={(e) => { e.stopPropagation(); handleMarkAsRead(intimation.id); }}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Marcar lida
                                </button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                                <Clock className="w-3.5 h-3.5 text-amber-600" /> Prazo
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleCreateAppointment(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                                <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" /> Compromisso
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setLinkingIntimation(intimation); setSelectedClientId(intimation.client_id || ''); setSelectedProcessId(intimation.process_id || ''); setLinkModalOpen(true); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                                <Link2 className="w-3.5 h-3.5 text-blue-600" /> Vincular
                              </button>
                              {intimation.link && (
                                <a href={intimation.link} target="_blank" rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                                  <ExternalLink className="w-3.5 h-3.5 text-purple-600" /> Ver Diário
                                </a>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); setSelectedIntimation(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition">
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

            /* ── LIST VIEW ── */
            filteredIntimations.map((intimation) => {
              const isExpanded = expandedIntimationIds.has(intimation.id);
              const analysis = aiAnalysis.get(intimation.id);
              const urg = analysis?.urgency ?? (intimation.lida ? null : 'media');
              const urgCfg = urg ? urgencyConfig[urg as keyof typeof urgencyConfig] : null;
              return (
                <div
                  key={intimation.id}
                  className={`group bg-white border border-slate-200 rounded-xl overflow-hidden transition-all hover:shadow-md hover:border-slate-300 ${
                    !intimation.lida
                      ? `border-l-4 ${urgCfg ? urgCfg.border : 'border-l-amber-400'}`
                      : 'border-l-4 border-l-transparent'
                  } ${selectionMode && selectedIds.has(intimation.id) ? 'ring-2 ring-amber-400 border-amber-200' : ''}`}
                >
                  {/* Card main row */}
                  <div
                    className="px-5 py-4 cursor-pointer"
                    onClick={() => toggleExpanded(intimation.id)}
                  >
                    <div className="flex items-start gap-3">
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(intimation.id)}
                          onChange={() => toggleSelectedId(intimation.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 w-4 h-4 accent-amber-500 border-slate-300 rounded flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">

                        {/* Top row: tribunal + type + right: date + urgency + chevron */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {!intimation.lida && (
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${urgCfg ? urgCfg.dot : 'bg-amber-400'}`} />
                            )}
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 flex-shrink-0">
                              {intimation.sigla_tribunal}
                            </span>
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
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                                <Sparkles className="w-2.5 h-2.5" />
                                {urgencyConfig[analysis.urgency].label}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400 tabular-nums">{formatDate(intimation.data_disponibilizacao)}</span>
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-slate-300" />
                              : <ChevronRight className="w-4 h-4 text-slate-300" />}
                          </div>
                        </div>

                        {/* Process number */}
                        <p className={`font-mono text-sm font-bold truncate mb-1.5 ${!intimation.lida ? 'text-slate-900' : 'text-slate-500'}`}>
                          {intimation.numero_processo_mascara || intimation.numero_processo}
                        </p>

                        {/* Parties inline */}
                        {(() => {
                          const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
                            ? intimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
                            : extractPartesFromTexto(htmlToText(intimation.texto || ''));
                          return partes.length > 0 ? (
                            <p className="text-xs text-slate-500 mb-1.5 truncate">
                              {partes.slice(0, 2).map((p, i) => (
                                <span key={i}>{i > 0 && <span className="mx-1 text-slate-300">·</span>}<span className="font-medium text-slate-700">{p.nome}</span>{p.polo && <span className="text-slate-400"> ({p.polo})</span>}</span>
                              ))}
                              {partes.length > 2 && <span className="text-slate-400 ml-1">+{partes.length - 2}</span>}
                            </p>
                          ) : null;
                        })()}

                        {/* Client / process link */}
                        {(intimation.client_id || intimation.process_id) && (
                          <div className="flex items-center gap-3 mb-2">
                            {intimation.client_id && (
                              <span className="text-xs text-slate-500 truncate max-w-[200px]">
                                <span className="font-medium text-slate-700">{getClientName(intimation.client_id)}</span>
                              </span>
                            )}
                            {intimation.process_id && (
                              <span className="text-xs font-mono text-slate-400 truncate">{getProcessCode(intimation.process_id)}</span>
                            )}
                          </div>
                        )}

                        {/* Polo ativo/passivo */}
                        {(intimation.polo_ativo || intimation.polo_passivo) && (
                          <div className="flex flex-wrap gap-3 mb-2">
                            {intimation.polo_ativo && (
                              <span className="text-xs"><span className="font-semibold text-emerald-700">Ativo:</span> <span className="text-slate-600">{intimation.polo_ativo}</span></span>
                            )}
                            {intimation.polo_passivo && (
                              <span className="text-xs"><span className="font-semibold text-red-600">Passivo:</span> <span className="text-slate-600">{intimation.polo_passivo}</span></span>
                            )}
                          </div>
                        )}

                        {/* Preview + outcome + deadline — when collapsed */}
                        {!isExpanded && (
                          <div className="space-y-2">
                            {(() => {
                              const outcome = detectOutcome(analysis?.summary);
                              return outcome ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${outcome.cls}`}>
                                  {outcome.label}
                                </span>
                              ) : null;
                            })()}
                            <p className={`text-sm line-clamp-2 leading-relaxed ${!intimation.lida ? 'text-slate-600' : 'text-slate-400'}`}>
                              {analysis?.summary ?? htmlToText(intimation.texto || '').slice(0, 200)}
                            </p>
                            {analysis?.deadline && (
                              <div className="flex items-center gap-2 pt-0.5">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[11px] font-semibold">
                                  <Clock className="w-3 h-3" /> {analysis.deadline.days} dias úteis
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition shadow-sm shadow-amber-200">
                                  + Criar prazo
                                </button>
                              </div>
                            )}
                            {!analysis && !analyzingIds.has(intimation.id) && aiService.isEnabled() && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition">
                                <Sparkles className="w-3 h-3" /> Analisar com IA
                              </button>
                            )}
                            {analyzingIds.has(intimation.id) && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
                                <Loader2 className="w-3 h-3 animate-spin" /> Analisando...
                              </span>
                            )}
                          </div>
                        )}

                        {/* Hover quick-actions */}
                        {!isExpanded && !selectionMode && (
                          <div className="flex items-center gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!intimation.lida && (
                              <button onClick={(e) => { e.stopPropagation(); handleMarkAsRead(intimation.id); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition">
                                <CheckCircle className="w-3 h-3" /> Marcar lida
                              </button>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition">
                              <Clock className="w-3 h-3" /> Prazo
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleOpenLinkModal(intimation); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition">
                              <Link2 className="w-3 h-3" /> Vincular
                            </button>
                            {intimation.link && (
                              <a href={intimation.link} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition">
                                <ExternalLink className="w-3 h-3" /> Diário
                              </a>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setSelectedIntimation(intimation); }}
                              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition shadow-sm">
                              <Eye className="w-3 h-3" /> Ver detalhes
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 sm:px-5 py-4 space-y-4">
                      {/* AI analysis panel */}
                      {!analysis && (
                        <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-violet-900">Sem análise de IA</p>
                              <p className="text-xs text-violet-600">A IA pode resumir, detectar prazos e sugerir ações.</p>
                            </div>
                          </div>
                          {aiService.isEnabled() ? (
                            analyzingIds.has(intimation.id) ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analisando...
                              </span>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition flex-shrink-0">
                                <Sparkles className="w-3.5 h-3.5" /> Analisar agora
                              </button>
                            )
                          ) : (
                            <span className="text-xs text-violet-500">Configure a chave OpenAI</span>
                          )}
                        </div>
                      )}
                      {analysis && (
                        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-violet-600" />
                              <span className="text-sm font-bold text-slate-900">Análise com IA</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const outcome = detectOutcome(analysis.summary);
                                return outcome ? (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${outcome.cls}`}>{outcome.label}</span>
                                ) : null;
                              })()}
                              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${urgencyConfig[analysis.urgency].badge}`}>
                                {urgencyConfig[analysis.urgency].label}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAnalyzeSingle(intimation); }}
                                title="Re-analisar com IA"
                                disabled={analyzingIds.has(intimation.id)}
                                className="p-1 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded transition disabled:opacity-50">
                                {analyzingIds.has(intimation.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700"><strong>Resumo:</strong> {analysis.summary}</p>
                          {analysis.deadline && (
                            <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-1 text-xs">
                              <p className="font-semibold text-amber-800 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Prazo detectado
                              </p>
                              <p className="text-slate-700"><strong>{analysis.deadline.days} dias úteis</strong> — {analysis.deadline.description}</p>
                              {analysis.deadline.dueDate && (
                                <>
                                  <p className="text-slate-500">Publicado: {new Date(intimation.data_disponibilizacao).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                                  <p className="text-slate-700 font-medium">Vencimento: {new Date(analysis.deadline.dueDate).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                  <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                    ⚠️ Cálculo sem feriados — confira o calendário oficial!
                                  </p>
                                </>
                              )}
                            </div>
                          )}
                          {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                                <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Ações sugeridas pela IA:
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
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${cfg.cls}`}
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
                                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs">
                                    <span className="text-blue-400">→</span> {kp}
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
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Marcar lida
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleCreateDeadline(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                          <Clock className="w-3.5 h-3.5 text-amber-600" /> Novo Prazo
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleCreateAppointment(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                          <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" /> Compromisso
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleOpenLinkModal(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                          <Link2 className="w-3.5 h-3.5 text-blue-600" /> Vincular
                        </button>
                        {intimation.link && (
                          <a href={intimation.link} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition">
                            <ExternalLink className="w-3.5 h-3.5 text-purple-600" /> Ver Diário
                          </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); setSelectedIntimation(intimation); }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition">
                          <Eye className="w-3.5 h-3.5" /> Detalhes completos
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {/* end list area */}
      </div>
      {/* end premium card */}

      {/* Modal de Vínculo */}
      {linkModalOpen && linkingIntimation && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setLinkModalOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Vínculo</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Vincular Intimação</h2>
              </div>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6 space-y-4">
              <div>
                <label className="block text-sm text-zinc-600 dark:text-zinc-300 mb-1">Cliente</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full h-11 px-3 py-2 rounded-lg text-sm leading-normal bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                >
                  <option value="">Nenhum cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-zinc-600 dark:text-zinc-300 mb-1">Processo</label>
                <select
                  value={selectedProcessId}
                  onChange={(e) => setSelectedProcessId(e.target.value)}
                  className="w-full h-11 px-3 py-2 rounded-lg text-sm leading-normal bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                >
                  <option value="">Nenhum processo</option>
                  {processes.map((process) => (
                    <option key={process.id} value={process.id}>
                      {process.process_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setLinkModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveLinks}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
                >
                  Salvar Vínculos
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação de Prazo */}
      {deadlineModalOpen && currentIntimationForAction && (
        <DeadlineCreationModal
          intimation={currentIntimationForAction}
          analysis={aiAnalysis.get(currentIntimationForAction.id)}
          clients={clients}
          processes={processes}
          members={members}
          onClose={() => {
            setDeadlineModalOpen(false);
            setCurrentIntimationForAction(null);
          }}
          onSuccess={() => {
            setDeadlineModalOpen(false);
            setCurrentIntimationForAction(null);
            toast.success('Prazo criado', 'Prazo cadastrado com sucesso');
          }}
        />
      )}

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

      {/* Modal de Prescrição */}
      {prescriptionModalOpen && currentIntimationForAction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              setPrescriptionModalOpen(false);
              setCurrentIntimationForAction(null);
            }}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Prescrição</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Execução Sobrestada</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPrescriptionModalOpen(false);
                  setCurrentIntimationForAction(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800">
                  <strong>Processo:</strong> {currentIntimationForAction.numero_processo_mascara || currentIntimationForAction.numero_processo}
                </p>
                <p className="text-xs text-amber-700 mt-1">
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
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Data em que o processo foi sobrestado por risco de prescrição.
                </p>
              </div>

              {/* Projeção de datas */}
              {prescriptionBaseDate && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-2">Projeção de Datas</p>
                  <div className="space-y-1">
                    <p className="text-xs text-amber-700">
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
                        return addMonths(new Date(prescriptionBaseDate), 24).toLocaleDateString('pt-BR');
                      })()}
                    </p>
                    <p className="text-xs text-amber-700">
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
                        return addMonths(new Date(prescriptionBaseDate), 18).toLocaleDateString('pt-BR');
                      })()} (6 meses antes)
                    </p>
                  </div>
                </div>
              )}

              {prescriptionError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">{prescriptionError}</p>
                </div>
              )}

              {prescriptionSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-sm text-emerald-800">{prescriptionSuccess}</p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPrescriptionModalOpen(false);
                    setCurrentIntimationForAction(null);
                  }}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreatePrescriptionEvent}
                  disabled={savingPrescription}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
                >
                  {savingPrescription && <Loader2 className="w-4 h-4 animate-spin" />}
                  Criar na Agenda
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

  // Determinar prioridade baseada na urgência da IA
  const getPriorityFromUrgency = (urgency?: string): DeadlinePriority => {
    if (!urgency) return 'alta';
    if (urgency === 'critica' || urgency === 'alta') return 'alta';
    if (urgency === 'media') return 'media';
    return 'baixa';
  };

  // Calcular data de vencimento: 1 dia ANTES do prazo detectado
  const getDeadlineDate = (analysis?: IntimationAnalysis): string => {
    if (!analysis?.deadline?.dueDate) return '';
    const dueDate = new Date(analysis.deadline.dueDate);
    dueDate.setDate(dueDate.getDate() - 1); // 1 dia antes
    return dueDate.toISOString().split('T')[0];
  };

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

  const inputStyle = 'w-full h-11 px-3 py-2 rounded-lg text-sm leading-normal bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors';
  const labelStyle = 'block text-sm text-zinc-600 dark:text-zinc-300 mb-1';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-3xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Novo Prazo</p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Criar Prazo</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6">
        {/* Informações da Intimação */}
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Intimação Vinculada</h4>
          <p className="text-sm text-blue-800">
            <strong>Processo:</strong> {intimation.numero_processo_mascara || intimation.numero_processo}
          </p>
          {client && (
            <p className="text-sm text-blue-800">
              <strong>Cliente:</strong> {client.full_name}
            </p>
          )}
          <p className="text-sm text-blue-800">
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
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
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              min={new Date().toISOString().split('T')[0]}
              required
            />
            {analysis?.deadline?.dueDate && (
              <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-900 font-semibold">
                  ⚠️ Prazo Final: {new Date(analysis.deadline.dueDate).toLocaleDateString('pt-BR', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
                <p className="text-xs text-amber-700 mt-1">
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
                  {formData.responsible_id === (m.user_id || m.id) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {formData.responsible_id && (
              <p className="text-xs text-amber-600 mt-2">
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
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
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
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              >
                <option value="urgente">Urgente</option>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </form>
        </div>

        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="deadline-form"
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar Prazo
            </button>
          </div>
        </div>
      </div>
    </div>
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

      const payload: CreateCalendarEventDTO = {
        title: formData.title,
        description: formData.description || null,
        event_type: formData.type,
        status: 'pendente',
        start_at: startAt,
        client_id: formData.client_id || null,
        process_id: intimation.process_id || null,
        user_id: formData.responsible_id || null,
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

  const inputStyle = 'w-full h-11 px-3 py-2 rounded-lg text-sm leading-normal bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors';
  const labelStyle = 'block text-sm text-zinc-600 dark:text-zinc-300 mb-1';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-3xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Novo Compromisso</p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Adicionar Compromisso</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6">
        {/* Informações da Intimação */}
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-6">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Intimação Vinculada</h4>
          <p className="text-sm text-blue-800">
            <strong>Processo:</strong> {intimation.numero_processo_mascara || intimation.numero_processo}
          </p>
          {client && (
            <p className="text-sm text-blue-800">
              <strong>Cliente:</strong> {client.full_name}
            </p>
          )}
          <p className="text-sm text-blue-800">
            <strong>Tipo:</strong> {intimation.tipo_comunicacao || 'Intimação'}
          </p>
        </div>

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
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Descrição
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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

          {/* Data e Hora */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Data *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                min={new Date().toISOString().split('T')[0]}
                required
              />
              {analysis?.deadline?.dueDate && (
                <p className="text-xs text-indigo-600 mt-1">
                  ℹ️ Data exata da audiência/prazo
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Hora * (Horário de Cuiabá GMT-4)
              </label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
              {analysis?.deadline && (
                <p className="text-xs text-indigo-600 mt-1">
                  ℹ️ Horário padrão: 14:00 (audiências)
                </p>
              )}
            </div>
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
                  {formData.responsible_id === (m.user_id || m.id) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6l3 3 5-5"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
            {formData.responsible_id && (
              <p className="text-xs text-amber-600 mt-2">
                ✓ {members.find(m => (m.user_id || m.id) === formData.responsible_id)?.name || 'Responsável selecionado'}
              </p>
            )}
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Tipo de Compromisso
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as CalendarEventType })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="meeting">Reunião</option>
              <option value="hearing">Audiência</option>
              <option value="deadline">Prazo</option>
              <option value="requirement">Diligência</option>
              <option value="payment">Pagamento</option>
              <option value="pericia">Perícia</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </form>
        </div>

        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="appointment-form"
              disabled={saving}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar Compromisso
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntimationsModule;
