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
} from 'lucide-react';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { clientService } from '../services/client.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { profileService } from '../services/profile.service';
import { settingsService, type DjenConfig } from '../services/settings.service';
import { userNotificationService } from '../services/userNotification.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { aiService } from '../services/ai.service';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportIntimations';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import { supabase } from '../config/supabase';
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // IA Analysis
  const [aiAnalysis, setAiAnalysis] = useState<Map<string, IntimationAnalysis>>(new Map());

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
      const logs = await djenSyncStatusService.listRecent(5);
      setSyncLogs(logs);
    } catch (error) {
      console.error('Erro ao carregar histórico do cron DJEN:', error);
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

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
      setSelectedIds(new Set());
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
      const normalizedName = client.full_name.trim().toUpperCase();
      clientNameMap.set(normalizedName, client.id);
    });
    console.log(`👥 Mapa de clientes criado com ${clientNameMap.size} nomes`);

    // Criar mapa de números de processos (normalizado) -> process_id
    const processNumberMap = new Map<string, string>();
    if (processesData) {
      processesData.forEach(process => {
        const normalizedNumber = process.process_code.trim().toUpperCase();
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
        : extractPartesFromTexto(intimation.texto || '').map(p => p.nome);
      
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
    if (syncLogs.length === 0) return null;
    const lastLog = syncLogs[0];
    const value = lastLog.run_finished_at || lastLog.run_started_at || lastLog.created_at;
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    return null;
  }, [syncLogs]);

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
      setSelectedIds(new Set());
      setSelectionMode(false);
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
    
    setSelectedIds(new Set());
    setSelectionMode(false);
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
          const clientMatch = clientName?.toLowerCase().includes(term);

          return (
            numeroProcessoLower?.includes(term) ||
            numeroProcessoMascaraLower?.includes(term) ||
            processCodeLower?.includes(term) ||
            i.texto?.toLowerCase().includes(term) ||
            i.nome_orgao?.toLowerCase().includes(term) ||
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
      return new Date(dateStr).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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

  const lastCronRun = syncLogs[0] || null;
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
      return 'bg-emerald-100 text-emerald-700';
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

  // Visualização de detalhes
  if (selectedIntimation) {
    const client = getClientName(selectedIntimation.client_id);
    const process = getProcessCode(selectedIntimation.process_id);

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">Detalhes da Intimação</h3>
              <p className="text-sm text-slate-600 mt-1">
                {selectedIntimation.sigla_tribunal} • {formatDate(selectedIntimation.data_disponibilizacao)}
              </p>
            </div>
            <button
              onClick={() => setSelectedIntimation(null)}
              className="text-slate-600 hover:text-slate-900 transition"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">
                  Processo
                </label>
                <p className="text-base text-slate-900 font-mono">
                  {selectedIntimation.numero_processo_mascara || selectedIntimation.numero_processo}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Status</label>
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${
                    selectedIntimation.lida
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {selectedIntimation.lida ? (
                    <>
                      <Eye className="w-4 h-4" /> Lida
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-4 h-4" /> Não Lida
                    </>
                  )}
                </span>
              </div>
            </div>

            {selectedIntimation.tipo_comunicacao && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">
                  Tipo de Comunicação
                </label>
                <p className="text-base text-slate-900">{selectedIntimation.tipo_comunicacao}</p>
              </div>
            )}

            {(client || process) && (
              <div className="grid md:grid-cols-2 gap-6">
                {client && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">
                      Cliente Vinculado
                    </label>
                    <p className="text-base text-slate-900">{client}</p>
                  </div>
                )}
                {process && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">
                      Processo Vinculado
                    </label>
                    <p className="text-base text-slate-900 font-mono">{process}</p>
                  </div>
                )}
              </div>
            )}

            {/* Partes (destinatários ou extraídas do texto) */}
            {(() => {
              const partes = selectedIntimation.djen_destinatarios && selectedIntimation.djen_destinatarios.length > 0
                ? selectedIntimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
                : extractPartesFromTexto(selectedIntimation.texto || '');
              
              return partes.length > 0 ? (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Partes</label>
                  <div className="flex flex-wrap gap-2">
                    {partes.map((parte, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 text-slate-700 rounded-lg text-sm border border-slate-200">
                        <span className="font-medium">{parte.nome}</span>
                        {parte.polo && <span className="text-slate-500 text-xs">({parte.polo})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Conteúdo</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedIntimation.texto}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    handleCreateDeadline(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                >
                  <Clock className="w-4 h-4 text-amber-600" />
                  Novo Prazo
                </button>
                <button
                  onClick={() => {
                    handleCreateAppointment(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                >
                  <CalendarIcon className="w-4 h-4 text-indigo-600" />
                  Adicionar Compromisso
                </button>
                <button
                  onClick={() => {
                    handleOpenPrescriptionModal(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                >
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  Prescrição
                </button>
                {!selectedIntimation.lida && (
                  <button
                    onClick={() => {
                      handleMarkAsRead(selectedIntimation.id);
                      setSelectedIntimation(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    Marcar como Lida
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    handleOpenLinkModal(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                >
                  <Link2 className="w-4 h-4 text-blue-600" />
                  Vincular
                </button>
                {selectedIntimation.link && (
                  <a
                    href={selectedIntimation.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-xs border border-slate-200 flex-1 sm:flex-none min-w-[160px]"
                  >
                    <ExternalLink className="w-4 h-4 text-purple-600" />
                    Ver Diário
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loading && hasCompletedInitialLoad && (
        <div className="flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Atualizando dados em segundo plano...
        </div>
      )}
      {/* Barra única: Header + Filtros + Ações */}
      <div className="bg-white border border-slate-100 rounded-lg p-2">
        {/* Linha 1: Título, indicadores e sincronizar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 flex-1 min-w-0">
            <Bell className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-slate-800 text-sm">Intimações</span>
            <span className="hidden sm:inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Online
            </span>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">{intimations.length} total</span>
            <span className="font-medium text-amber-600">{unreadCount} não lidas</span>
            {aiUrgencyStats.alta > 0 && (
              <span className="font-medium text-red-600">{aiUrgencyStats.alta} Alta</span>
            )}
            {aiUrgencyStats.baixa > 0 && (
              <span className="font-medium text-emerald-600">{aiUrgencyStats.baixa} Baixa</span>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-2.5 py-1 rounded-md transition disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>
        </div>

        {/* Linha 2: Busca, filtros e ações */}
        <div className="flex flex-col gap-1.5">
          <div className="relative w-full">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por cliente, OAB ou processo..."
              className="w-full pl-7 pr-2.5 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setStatusFilter('unread')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    statusFilter === 'unread'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Não lidas ({unreadCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('read')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    statusFilter === 'read'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Lidas ({readCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('linked')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    statusFilter === 'linked'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Vinculadas ({intimations.filter(isLinked).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('unlinked')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    statusFilter === 'unlinked'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Não Vinc ({intimations.filter(isUnlinked).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    statusFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Todas ({intimations.length})
                </button>
              </div>

              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setUrgencyFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    urgencyFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Todas
                </button>
                <button
                  type="button"
                  onClick={() => setUrgencyFilter('alta')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    urgencyFilter === 'alta'
                      ? 'bg-red-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Alta
                </button>
                <button
                  type="button"
                  onClick={() => setUrgencyFilter('media')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    urgencyFilter === 'media'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Média
                </button>
                <button
                  type="button"
                  onClick={() => setUrgencyFilter('baixa')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    urgencyFilter === 'baixa'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Baixa
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMobileControlsExpanded((prev) => {
                    const next = !prev;
                    if (!next) {
                      setShowClearMenu(false);
                      setShowExportMenu(false);
                      setShowSettingsMenu(false);
                    }
                    return next;
                  });
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition ${
                  mobileControlsExpanded
                    ? 'bg-slate-100 text-slate-800 border-slate-300'
                    : 'border-gray-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Mais filtros
                <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${mobileControlsExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileControlsExpanded(true);
                  setShowClearMenu((prev) => !prev);
                }}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-700 hover:bg-slate-50 text-xs px-2.5 py-1.5 rounded-md transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileControlsExpanded(true);
                  setShowExportMenu((prev) => !prev);
                }}
                disabled={filteredIntimations.length === 0}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-700 hover:bg-slate-50 text-xs px-2.5 py-1.5 rounded-md transition disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileControlsExpanded(true);
                  setShowSettingsMenu((prev) => !prev);
                }}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-700 hover:bg-slate-50 text-xs px-2.5 py-1.5 rounded-md transition"
              >
                <Settings className="w-3.5 h-3.5" />
                Config
              </button>
            </div>
          </div>

          <div
            className={
              mobileControlsExpanded
                ? 'grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2'
                : 'hidden'
            }
          >
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
            >
              <option value="all">Todas ({intimations.length})</option>
              <option value="unread">Não Lidas ({unreadCount})</option>
              <option value="read">Lidas ({readCount})</option>
              <option value="linked">Vinculadas ({intimations.filter(isLinked).length})</option>
              <option value="unlinked">Não Vinc ({intimations.filter(isUnlinked).length})</option>
            </select>

            <select
              value={tribunalFilter}
              onChange={(e) => setTribunalFilter(e.target.value)}
              className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
            >
              <option value="all">Todos os Tribunais</option>
              {availableTribunals.map((tribunal) => (
                <option key={tribunal} value={tribunal}>
                  {tribunal}
                </option>
              ))}
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
            >
              <option value="30days">Últimos 30 dias</option>
              <option value="60days">Últimos 60 dias</option>
              <option value="90days">Últimos 90 dias</option>
              <option value="all">Todas as datas</option>
            </select>

            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value as any)}
              className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
            >
              <option value="all">Todas urgências</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md transition text-xs w-full sm:w-auto ${
                showFilters
                  ? 'bg-slate-100 text-slate-700 border border-slate-300'
                  : 'border border-gray-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3 h-3" />
              <span className="sm:hidden">Filtros</span>
              <span className="hidden sm:inline">Filtros</span>
            </button>

            <div className="relative col-span-1 w-full sm:w-auto">
              <button
                onClick={() => setShowClearMenu((prev) => !prev)}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-600 hover:bg-slate-50 text-xs sm:text-sm px-2.5 py-1.5 rounded-lg transition disabled:opacity-50 w-full sm:w-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="sm:hidden">Limpar</span>
              </button>
              {showClearMenu && (
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-full sm:w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 text-sm text-slate-700">
                  <button
                    onClick={handleDeleteSelected}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 disabled:text-slate-400"
                  >
                    <CheckCircle className="w-4 h-4" /> Remover selecionadas
                  </button>
                  <button
                    onClick={handleDeleteRead}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <EyeOff className="w-4 h-4" /> Remover lidas
                  </button>
                  <button
                    onClick={handleMarkAllAsRead}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-600" /> Marcar todas como lidas
                  </button>
                  <button
                    onClick={handleClearAllIntimations}
                    disabled={clearingAll || intimations.length === 0}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 text-red-600 disabled:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" /> Remover tudo
                  </button>
                </div>
              )}
            </div>

            <div className="relative col-span-1 w-full sm:w-auto">
              <button
                onClick={() => setShowExportMenu((prev) => !prev)}
                disabled={filteredIntimations.length === 0}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-600 hover:bg-slate-50 text-xs sm:text-sm px-2.5 py-1.5 rounded-lg transition disabled:opacity-50 w-full sm:w-auto"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="sm:hidden">Exportar</span>
              </button>
              {showExportMenu && (
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-full sm:w-44 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="py-1 text-sm text-gray-700">
                    <button
                      onClick={handleExportCSV}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> CSV
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> Excel
                    </button>
                    <button
                      onClick={handleExportPDF}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> PDF
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative col-span-2 sm:col-span-1 w-full sm:w-auto">
              <button
                onClick={() => setShowSettingsMenu((prev) => !prev)}
                className="inline-flex items-center justify-center gap-1.5 border border-gray-200 text-slate-600 hover:bg-slate-50 text-xs sm:text-sm px-2.5 py-1.5 rounded-lg transition w-full sm:w-auto"
              >
                <UserCog className="w-3.5 h-3.5" />
                <span className="sm:hidden">Configurações</span>
              </button>
              {showSettingsMenu && (
                <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-full sm:w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-900">Configurações</h3>
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={moduleSettings.defaultGroupByProcess}
                        onChange={(e) => {
                          setModuleSettings((prev) => ({
                            ...prev,
                            defaultGroupByProcess: e.target.checked,
                          }));
                          setGroupByProcess(e.target.checked);
                        }}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Agrupar por processo
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectionMode}
                        onChange={(e) => {
                          setSelectionMode(e.target.checked);
                          if (!e.target.checked) setSelectedIds(new Set());
                        }}
                        className="rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                      />
                      Selecionar múltiplas
                    </label>
                    <div className="pt-2 border-t border-gray-100">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Filtro padrão</label>
                      <select
                        value={moduleSettings.defaultStatusFilter}
                        onChange={(e) => {
                          const value = e.target.value as 'all' | 'unread' | 'read';
                          setModuleSettings((prev) => ({
                            ...prev,
                            defaultStatusFilter: value,
                          }));
                        }}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                      >
                        <option value="all">Todas</option>
                        <option value="unread">Não lidas</option>
                        <option value="read">Lidas</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {showFilters && (
          <div className={`${mobileControlsExpanded ? 'block' : 'hidden'} sm:block mt-4 pt-4 border-t border-gray-200`}>
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Filtro por Data Personalizado</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data Início</label>
                <input
                  type="date"
                  value={customDateStart}
                  onChange={(e) => setCustomDateStart(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data Fim</label>
                <input
                  type="date"
                  value={customDateEnd}
                  onChange={(e) => setCustomDateEnd(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
            {(customDateStart || customDateEnd) && (
              <button
                onClick={() => {
                  setCustomDateStart('');
                  setCustomDateEnd('');
                }}
                className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Limpar filtro personalizado
              </button>
            )}
          </div>
        )}

        {selectionMode && selectedIds.size > 0 && (
          <div className="mt-4 p-3 sm:p-4 border border-slate-200 bg-slate-50 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-sm text-slate-700">
              <strong className="text-slate-900">{selectedIds.size}</strong> selecionada(s)
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleMarkSelectedAsRead}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-sm border border-slate-200"
              >
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                Marcar como lidas
              </button>
              <button
                onClick={handleBatchLink}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-sm border border-slate-200"
              >
                <Link2 className="w-4 h-4 text-blue-600" />
                Vincular em lote
              </button>
              <button
                onClick={handleExportSelected}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-sm border border-slate-200"
              >
                <Download className="w-4 h-4 text-purple-600" />
                Exportar selecionadas
              </button>
              <button
                onClick={handleDeleteSelected}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-2 rounded-lg transition text-sm border border-slate-200"
              >
                <Trash2 className="w-4 h-4 text-red-600" />
                Remover
              </button>
              <button
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectionMode(false);
                }}
                className="inline-flex items-center gap-2 bg-transparent hover:bg-white text-slate-600 font-semibold px-3 py-2 rounded-lg transition text-sm border border-transparent"
              >
                <X className="w-4 h-4" />
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista de Intimações */}
      <div className="space-y-3">
        {filteredIntimations.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 sm:p-12 text-center">
            <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-slate-300 mx-auto mb-4" />
            <h4 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">Nenhuma intimação encontrada</h4>
            <p className="text-slate-600">
              {statusFilter === 'unread'
                ? 'Não há intimações não lidas no momento'
                : statusFilter === 'read'
                ? 'Não há intimações lidas'
                : 'Clique em "Sincronizar" para buscar novas intimações'}
            </p>
          </div>
        ) : groupByProcess && groupedByProcess ? (
          // Visualização agrupada por processo
          Array.from(groupedByProcess.entries()).map(([processNum, group]) => (
            <div key={processNum} className="bg-white border border-gray-200 rounded-xl p-3 sm:p-5 space-y-2 sm:space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 sm:pb-3 border-b border-gray-200">
                <div className="min-w-0">
                  <h4 className="text-sm sm:text-lg font-bold text-slate-900 truncate">Processo: {processNum}</h4>
                  <p className="text-xs sm:text-sm text-slate-600">
                    {group.length} intimação(ões) • {group.filter((i) => !i.lida).length} não lida(s)
                  </p>
                  {group[0].client_id && (
                    <p className="text-xs sm:text-sm text-blue-600 mt-1 truncate">
                      <strong>Cliente:</strong> {getClientName(group[0].client_id)}
                    </p>
                  )}
                </div>
                {group.filter((i) => !i.lida).length > 0 && (
                  <button
                    onClick={async () => {
                      for (const intimation of group.filter((i) => !i.lida)) {
                        await handleMarkAsRead(intimation.id);
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                  >
                    <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Marcar Todas</span>
                    <span className="sm:hidden">Marcar Lidas</span>
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {group.map((intimation) => {
                  const isExpanded = expandedIntimationIds.has(intimation.id);
                  return (
                  <div
                    key={intimation.id}
                    className={`border rounded-lg overflow-hidden transition ${
                      intimation.lida
                        ? 'border-slate-200 hover:border-slate-300 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white border-l-4 border-l-amber-400'
                    }`}
                  >
                    {/* Header clicável para expandir */}
                    <div
                      className="p-2.5 sm:p-4 cursor-pointer"
                      onClick={() => {
                        const newExpanded = new Set(expandedIntimationIds);
                        if (isExpanded) {
                          newExpanded.delete(intimation.id);
                        } else {
                          newExpanded.add(intimation.id);
                        }
                        setExpandedIntimationIds(newExpanded);
                      }}
                    >
                      <div className="flex items-start gap-2 sm:gap-3">
                        <div className="flex items-center flex-shrink-0">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Mobile: Layout compacto */}
                          <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2 flex-wrap">
                            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-100 text-blue-800">
                              {intimation.sigla_tribunal}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500">
                              {formatDate(intimation.data_disponibilizacao)}
                            </span>
                            {/* Indicador de vinculação */}
                            {isLinked(intimation) ? (
                              <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
                                Vinc
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setLinkingIntimation(intimation);
                                  setLinkModalOpen(true);
                                }}
                                className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 transition-colors cursor-pointer"
                                title="Vincular a cliente/processo"
                              >
                                <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
                                Sem Vínc
                              </button>
                            )}
                            {!intimation.lida && (
                              <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-amber-100 text-amber-700">
                                NÃO LIDA
                              </span>
                            )}
                            {intimation.tipo_comunicacao && (
                              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                {intimation.tipo_comunicacao}
                              </span>
                            )}
                          </div>
                          {/* Partes (destinatários ou extraídas do texto) */}
                          {(() => {
                            const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
                              ? intimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
                              : extractPartesFromTexto(intimation.texto || '');
                            
                            return partes.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                                <span className="font-medium text-slate-500">Partes:</span>
                                {partes.map((parte, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 text-slate-700 rounded text-[11px] border border-slate-200">
                                    {parte.nome}
                                    {parte.polo && <span className="text-slate-500">({parte.polo})</span>}
                                  </span>
                                ))}
                              </div>
                            ) : null;
                          })()}
                          {/* Texto da intimação - compacto em mobile */}
                          <p className={`text-xs sm:text-sm text-slate-700 ${!isExpanded ? 'line-clamp-1 sm:line-clamp-2' : ''}`}>
                            {intimation.texto}
                          </p>

                          {/* Botões de ação (desktop) - abaixo do texto para largura total */}
                          {!selectionMode && (
                            <div className="hidden sm:flex items-center justify-end gap-2 mt-2">
                              {!intimation.lida && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMarkAsRead(intimation.id);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                                >
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                  Marcar
                                </button>
                              )}
                              {intimation.link && (
                                <a
                                  href={intimation.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-purple-600" />
                                  Diário
                                </a>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIntimation(intimation);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                              >
                                <Eye className="w-3.5 h-3.5 text-blue-600" />
                                Detalhes
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Conteúdo Expandido - Visualização Agrupada */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-200">
                        {aiAnalysis.has(intimation.id) && (
                          <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <Sparkles className="w-4 h-4 text-slate-700 flex-shrink-0" />
                                <h6 className="text-xs font-bold text-slate-900 truncate">Análise IA</h6>
                              </div>
                              {(() => {
                                const analysis = aiAnalysis.get(intimation.id)!;
                                const urgencyColors = {
                                  'critica': 'bg-red-50 text-red-700 border-red-200',
                                  'alta': 'bg-orange-50 text-orange-700 border-orange-200',
                                  'media': 'bg-amber-50 text-amber-700 border-amber-200',
                                  'baixa': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                };
                                return (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${urgencyColors[analysis.urgency]}`}>
                                    {analysis.urgency.toUpperCase()}
                                  </span>
                                );
                              })()}
                            </div>
                            {(() => {
                              const analysis = aiAnalysis.get(intimation.id)!;
                              return (
                                <>
                                  <p className="text-xs text-slate-700 line-clamp-3"><strong>Resumo:</strong> {analysis.summary}</p>
                                  {analysis.deadline && (
                                    <div className="bg-white border border-slate-200 rounded-lg p-2 text-xs">
                                      <p className="font-semibold text-slate-900">{analysis.deadline.days} dias úteis</p>
                                      <p className="text-slate-700">{analysis.deadline.description}</p>
                                      {analysis.deadline.dueDate && (
                                        <p className="text-slate-600 mt-1">Vencimento: {new Date(analysis.deadline.dueDate).toLocaleDateString('pt-BR')}</p>
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                        
                        {/* Botões de Ação - Visualização Agrupada */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentIntimationForAction(intimation);
                              setDeadlineModalOpen(true);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                          >
                            <Clock className="w-4 h-4 text-amber-600" />
                            Novo Prazo
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentIntimationForAction(intimation);
                              setAppointmentModalOpen(true);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                          >
                            <CalendarIcon className="w-4 h-4 text-indigo-600" />
                            Compromisso
                          </button>
                          {!intimation.lida && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(intimation.id);
                              }}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                            >
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              Marcar Lida
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLinkingIntimation(intimation);
                              setSelectedClientId(intimation.client_id || '');
                              setSelectedProcessId(intimation.process_id || '');
                              setLinkModalOpen(true);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                          >
                            <Link2 className="w-4 h-4 text-blue-600" />
                            Vincular
                          </button>
                          {intimation.link && (
                            <a
                              href={intimation.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                            >
                              <ExternalLink className="w-4 h-4 text-purple-600" />
                              Ver Diário
                            </a>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIntimation(intimation);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition flex-1 sm:flex-none min-w-[140px]"
                          >
                            <Eye className="w-4 h-4" />
                            Detalhes
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
          // Visualização normal (lista) - Compacta em mobile
          filteredIntimations.map((intimation) => {
            const isExpanded = expandedIntimationIds.has(intimation.id);
            return (
            <div
              key={intimation.id}
              className={`bg-white border rounded-xl p-3 sm:p-5 transition ${
                intimation.lida
                  ? 'border-slate-200 hover:border-slate-300'
                  : 'border-slate-200 hover:border-slate-300 border-l-4 border-l-amber-400'
              } ${selectionMode && selectedIds.has(intimation.id) ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="flex items-start gap-2 sm:gap-4">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(intimation.id)}
                    onChange={() => toggleSelection(intimation.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-4 h-4 sm:w-5 sm:h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                )}

                <button
                  onClick={() => toggleExpanded(intimation.id)}
                  className="flex-shrink-0 mt-0.5 sm:mt-1 p-0.5 sm:p-1 hover:bg-slate-100 rounded transition"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                  ) : (
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  {/* Mobile: Layout compacto | Desktop: Layout completo */}
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-3 flex-wrap">
                    <span className="inline-flex items-center px-1.5 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-100 text-blue-800">
                      {intimation.sigla_tribunal}
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-500">
                      {formatDate(intimation.data_disponibilizacao)}
                    </span>
                    {/* Indicador de vinculação */}
                    {isLinked(intimation) ? (
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
                        Vinc
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          setLinkingIntimation(intimation);
                          setLinkModalOpen(true);
                        }}
                        className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 transition-colors cursor-pointer"
                        title="Vincular a cliente/processo"
                      >
                        <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
                        Sem Vínc
                      </button>
                    )}
                    {!intimation.lida && (
                      <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-amber-100 text-amber-700">
                        NÃO LIDA
                      </span>
                    )}
                    {intimation.tipo_comunicacao && (
                      <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        {intimation.tipo_comunicacao}
                      </span>
                    )}
                    {aiAnalysis.has(intimation.id) && (
                      <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                        <Sparkles className="w-3 h-3 text-violet-600" />
                        Analisado
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm sm:text-base font-semibold text-slate-900 mb-1 sm:mb-2 truncate sm:whitespace-normal">
                    Processo: {intimation.numero_processo_mascara || intimation.numero_processo}
                  </h4>

                  {/* Polos das Partes - Ocultos em mobile quando não expandido */}
                  <div className={`mb-2 sm:mb-3 space-y-1 ${!isExpanded ? 'hidden sm:block' : ''}`}>
                    {intimation.polo_ativo && (
                      <p className="text-xs sm:text-sm truncate sm:whitespace-normal">
                        <span className="font-semibold text-emerald-700">Polo Ativo:</span>{' '}
                        <span className="text-slate-700">{intimation.polo_ativo}</span>
                      </p>
                    )}
                    {intimation.polo_passivo && (
                      <p className="text-xs sm:text-sm truncate sm:whitespace-normal">
                        <span className="font-semibold text-red-700">Polo Passivo:</span>{' '}
                        <span className="text-slate-700">{intimation.polo_passivo}</span>
                      </p>
                    )}
                  </div>

                  {/* Partes (destinatários ou extraídas do texto) */}
                  {(() => {
                    const partes = intimation.djen_destinatarios && intimation.djen_destinatarios.length > 0
                      ? intimation.djen_destinatarios.map(d => ({ nome: d.nome, polo: d.polo || '' }))
                      : extractPartesFromTexto(intimation.texto || '');
                    
                    return partes.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 mb-2">
                        <span className="font-medium text-slate-500">Partes:</span>
                        {partes.map((parte, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px]">
                            {parte.nome}
                            {parte.polo && <span className="text-blue-500">({parte.polo})</span>}
                          </span>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {intimation.client_id && (
                    <p className={`text-xs sm:text-sm text-slate-600 mb-1 truncate sm:whitespace-normal ${!isExpanded ? 'hidden sm:block' : ''}`}>
                      <strong>Cliente:</strong> {getClientName(intimation.client_id)}
                    </p>
                  )}

                  {intimation.process_id && (
                    <p className={`text-xs sm:text-sm text-slate-600 mb-2 truncate sm:whitespace-normal ${!isExpanded ? 'hidden sm:block' : ''}`}>
                      <strong>Processo:</strong> {getProcessCode(intimation.process_id)}
                    </p>
                  )}

                  {!isExpanded && (
                    <p className="text-xs sm:text-sm text-slate-700 line-clamp-1 sm:line-clamp-2">{intimation.texto}</p>
                  )}

                  {/* Conteúdo Expandido */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                      {/* Análise de IA */}
                      {aiAnalysis.has(intimation.id) && (
                        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 space-y-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            <h5 className="text-sm font-bold text-purple-900">Análise com IA</h5>
                          </div>
                          
                          {(() => {
                            const analysis = aiAnalysis.get(intimation.id)!;
                            const urgencyColors = {
                              'critica': 'bg-red-100 text-red-800 border-red-300',
                              'alta': 'bg-orange-100 text-orange-800 border-orange-300',
                              'media': 'bg-yellow-100 text-yellow-800 border-yellow-300',
                              'baixa': 'bg-green-100 text-green-800 border-green-300',
                            };
                            
                            return (
                              <>
                                {/* Urgência */}
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4" />
                                  <span className="text-xs font-medium text-slate-700">Urgência:</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${urgencyColors[analysis.urgency]}`}>
                                    {analysis.urgency.toUpperCase()}
                                  </span>
                                </div>

                                {/* Resumo */}
                                <div>
                                  <h6 className="text-xs font-semibold text-slate-900 mb-1">📋 Resumo:</h6>
                                  <p className="text-sm text-slate-700">{analysis.summary}</p>
                                </div>

                                {/* Prazo */}
                                {analysis.deadline && (
                                  <div className="bg-white/70 border border-amber-200 rounded p-3 space-y-2">
                                    <h6 className="text-xs font-semibold text-amber-900 mb-1 flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5" />
                                      Prazo Detectado:
                                    </h6>
                                    <p className="text-sm text-slate-700">
                                      <strong>{analysis.deadline.days} dias úteis</strong> - {analysis.deadline.description}
                                    </p>
                                    {analysis.deadline.dueDate && (
                                      <>
                                        <p className="text-xs text-slate-600">
                                          📰 Publicado em: {new Date(intimation.data_disponibilizacao).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                                        </p>
                                        <p className="text-xs text-slate-700 font-medium">
                                          📅 Vencimento estimado: {new Date(analysis.deadline.dueDate).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                        </p>
                                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                          ⚠️ Cálculo a partir da data de publicação, considerando apenas dias úteis (seg-sex). Feriados não estão inclusos - confira o calendário oficial!
                                        </p>
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* Ações Sugeridas */}
                                {analysis.suggestedActions && analysis.suggestedActions.length > 0 && (
                                  <div>
                                    <h6 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1">
                                      <Lightbulb className="w-3.5 h-3.5 text-yellow-600" />
                                      Ações Sugeridas:
                                    </h6>
                                    <ul className="space-y-1">
                                      {analysis.suggestedActions.map((action, idx) => (
                                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                                          <span className="text-purple-600 font-bold">•</span>
                                          <span>{action}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Pontos-chave */}
                                {analysis.keyPoints && analysis.keyPoints.length > 0 && (
                                  <div>
                                    <h6 className="text-xs font-semibold text-slate-900 mb-2">🎯 Pontos-chave:</h6>
                                    <ul className="space-y-1">
                                      {analysis.keyPoints.map((point, idx) => (
                                        <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                                          <span className="text-blue-600 font-bold">→</span>
                                          <span>{point}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Ações (Mobile/Expandido) */}
                      {!selectionMode && (
                        <div className="grid grid-cols-2 sm:hidden gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCreateDeadline(intimation);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                          >
                            <Clock className="w-4 h-4 text-amber-600" />
                            Novo Prazo
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCreateAppointment(intimation);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                          >
                            <CalendarIcon className="w-4 h-4 text-indigo-600" />
                            Compromisso
                          </button>

                          {!intimation.lida && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(intimation.id);
                              }}
                              className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                            >
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              Marcar Lida
                            </button>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenLinkModal(intimation);
                            }}
                            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                          >
                            <Link2 className="w-4 h-4 text-blue-600" />
                            Vincular
                          </button>

                          {intimation.link && (
                            <a
                              href={intimation.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
                            >
                              <ExternalLink className="w-4 h-4 text-purple-600" />
                              Ver Diário
                            </a>
                          )}
                        </div>
                      )}

                      <div>
                        <h5 className="text-sm font-semibold text-slate-900 mb-2">Conteúdo da Intimação:</h5>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{intimation.texto}</p>
                      </div>

                      {intimation.nome_orgao && (
                        <div>
                          <h5 className="text-sm font-semibold text-slate-900">Órgão:</h5>
                          <p className="text-sm text-slate-700">{intimation.nome_orgao}</p>
                        </div>
                      )}

                      {intimation.link && (
                        <div>
                          <a
                            href={intimation.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Ver no Diário Oficial
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Botões de ação - Ocultos em mobile quando não expandido */}
                {!selectionMode && (
                  <div className={`hidden sm:flex flex-col gap-1.5 sm:gap-2 ${isExpanded ? 'sm:hidden' : ''}`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateDeadline(intimation);
                      }}
                      className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-amber-600 hover:text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition"
                    >
                      <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Prazo</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateAppointment(intimation);
                      }}
                      className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition"
                    >
                      <CalendarIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Agenda</span>
                    </button>
                    {!intimation.lida && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsRead(intimation.id);
                        }}
                        className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition"
                      >
                        <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span className="hidden sm:inline">Lida</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenLinkModal(intimation);
                      }}
                      className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition"
                    >
                      <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Vincular</span>
                    </button>
                    {intimation.link && (
                      <a
                        href={intimation.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
                      >
                        <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span className="hidden sm:inline">Diário</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

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
  const [responsibleSearchTerm, setResponsibleSearchTerm] = useState('');
  const [showResponsibleSuggestions, setShowResponsibleSuggestions] = useState(false);

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

      const payload: CreateDeadlineDTO = {
        title: formData.title.trim(),
        description: formData.description || null,
        due_date: formData.due_date,
        type: formData.type,
        priority: formData.priority,
        status: 'pendente',
        client_id: formData.client_id || null,
        process_id: formData.process_id || null,
        responsible_id: formData.responsible_id || null,
      };

      const createdDeadline = await deadlineService.createDeadline(payload);
      
      // Notificar responsável se foi atribuído
      if (formData.responsible_id) {
        try {
          await userNotificationService.notifyDeadlineAssigned({
            userId: formData.responsible_id,
            deadlineId: createdDeadline.id,
            deadlineTitle: formData.title,
          });
        } catch (notifError) {
          console.error('Erro ao criar notificação:', notifError);
          // Não bloqueia a criação do prazo se notificação falhar
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
      <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
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
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Responsável *
            </label>
            <div className="relative">
              <input
                type="text"
                value={responsibleSearchTerm}
                onChange={(e) => {
                  setResponsibleSearchTerm(e.target.value);
                  if (!e.target.value.trim()) {
                    setFormData({ ...formData, responsible_id: '' });
                  }
                }}
                onFocus={() => setShowResponsibleSuggestions(true)}
                onBlur={() => setTimeout(() => setShowResponsibleSuggestions(false), 200)}
                placeholder="Digite para buscar responsável..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              {showResponsibleSuggestions && responsibleSearchTerm && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {members
                    .filter((member) =>
                      member.name.toLowerCase().includes(responsibleSearchTerm.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFormData({ ...formData, responsible_id: member.id });
                          setResponsibleSearchTerm(member.name);
                          setShowResponsibleSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-amber-50 transition"
                      >
                        <div className="font-semibold text-slate-900">{member.name}</div>
                        <div className="text-xs text-slate-500">{member.email}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {formData.responsible_id && (
              <p className="text-xs text-emerald-600 mt-1">✓ Responsável selecionado</p>
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
  const [responsibleSearchTerm, setResponsibleSearchTerm] = useState('');
  const [showResponsibleSuggestions, setShowResponsibleSuggestions] = useState(false);

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
      };

      const createdAppointment = await calendarService.createEvent(payload);
      
      // Notificar responsável se foi atribuído
      if (formData.responsible_id) {
        try {
          await userNotificationService.notifyAppointmentAssigned({
            userId: formData.responsible_id,
            appointmentId: createdAppointment.id,
            appointmentTitle: formData.title,
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
      <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
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
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Responsável *
            </label>
            <div className="relative">
              <input
                type="text"
                value={responsibleSearchTerm}
                onChange={(e) => {
                  setResponsibleSearchTerm(e.target.value);
                  if (!e.target.value.trim()) {
                    setFormData({ ...formData, responsible_id: '' });
                  }
                }}
                onFocus={() => setShowResponsibleSuggestions(true)}
                onBlur={() => setTimeout(() => setShowResponsibleSuggestions(false), 200)}
                placeholder="Digite para buscar responsável..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {showResponsibleSuggestions && responsibleSearchTerm && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {members
                    .filter((member) =>
                      member.name.toLowerCase().includes(responsibleSearchTerm.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFormData({ ...formData, responsible_id: member.id });
                          setResponsibleSearchTerm(member.name);
                          setShowResponsibleSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 transition"
                      >
                        <div className="font-semibold text-slate-900">{member.name}</div>
                        <div className="text-xs text-slate-500">{member.email}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {formData.responsible_id && (
              <p className="text-xs text-emerald-600 mt-1">✓ Responsável selecionado</p>
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
