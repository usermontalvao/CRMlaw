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
import { aiService } from '../services/ai.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportIntimations';
import { addSyncHistory } from '../utils/syncHistory';
import { djenSyncStatusService, type DjenSyncLog } from '../services/djenSyncStatus.service';
import type { DjenComunicacaoLocal, DjenConsultaParams } from '../types/djen.types';
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
const LAST_SYNC_STORAGE_KEY = 'intimations_last_sync_at';

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
  const [loading, setLoading] = useState(true);
  const [initialSnapshotLoaded, setInitialSnapshotLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('unread');
  const [tribunalFilter, setTribunalFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'30days' | '60days' | '90days' | 'all'>('30days');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [groupByProcess, setGroupByProcess] = useState(true);

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
  const [currentIntimationForAction, setCurrentIntimationForAction] = useState<DjenComunicacaoLocal | null>(null);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [savingAppointment, setSavingAppointment] = useState(false);

  // Seleção múltipla
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // IA Analysis
  const [aiAnalysis, setAiAnalysis] = useState<Map<string, IntimationAnalysis>>(new Map());
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [aiEnabled, setAiEnabled] = useState(false);

  // Estados de navegação e interface
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showClearMenu, setShowClearMenu] = useState(false);
  const [syncLogs, setSyncLogs] = useState<DjenSyncLog[]>([]);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [moduleSettings, setModuleSettings] = useState<ModuleSettings>({
    defaultGroupByProcess: true,
    defaultStatusFilter: 'unread',
    externalCronToken: 'djen-sync-2024',
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [globalDjenConfig, setGlobalDjenConfig] = useState<DjenConfig | null>(null);
  const [monitoredLawyers, setMonitoredLawyers] = useState<string[]>([]);
  const overviewSectionRef = useRef<HTMLDivElement | null>(null);
  const configSectionRef = useRef<HTMLDivElement | null>(null);
  const filterSectionRef = useRef<HTMLDivElement | null>(null);
  const listSectionRef = useRef<HTMLDivElement | null>(null);
  const autoSyncTriggeredRef = useRef(false);
  const [lastLocalSyncAt, setLastLocalSyncAt] = useState<Date | null>(null);

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

    const storedLastSync = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    if (storedLastSync) {
      const parsedDate = new Date(storedLastSync);
      if (!Number.isNaN(parsedDate.getTime())) {
        setLastLocalSyncAt(parsedDate);
      }
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

  // Verificar se IA está habilitada
  useEffect(() => {
    setAiEnabled(aiService.isEnabled());
  }, []);

  // Analisar intimação com IA (definido antes para evitar erro de referência)
  const handleAnalyzeWithAI = async (intimation: DjenComunicacaoLocal, silent: boolean = false) => {
    if (!aiService.isEnabled()) {
      if (!silent) {
        toast.warning('IA não configurada', 'Configure VITE_OPENAI_API_KEY no arquivo .env');
      }
      console.log('⚠️ IA não habilitada - verifique VITE_OPENAI_API_KEY');
      return;
    }

    console.log(`🤖 Iniciando análise de IA para intimação ${intimation.id.substring(0, 8)}...`);
    setAnalyzingIds(prev => new Set(prev).add(intimation.id));

    try {
      const analysis = await aiService.analyzeIntimation(
        intimation.texto,
        intimation.numero_processo,
        intimation.data_disponibilizacao,
        intimation.tipo_documento || undefined,
        intimation.tipo_comunicacao || undefined
      );

      console.log(`✅ Análise concluída - Urgência: ${analysis.urgency}, Prazo: ${analysis.deadline?.days || 'N/A'} dias`);

      // Atualizar estado local
      setAiAnalysis(prev => new Map(prev).set(intimation.id, analysis));
      
      // Salvar análise no banco de dados
      try {
        await intimationAnalysisService.saveAnalysis(
          intimation.id,
          analysis,
          currentUserProfile?.id
        );
        console.log(`💾 Análise salva no banco de dados para intimação ${intimation.id.substring(0, 8)}`);
      } catch (saveErr: any) {
        console.error(`❌ Erro ao salvar análise no banco para intimação ${intimation.id.substring(0, 8)}:`, saveErr);
        // Não bloqueia o fluxo se falhar ao salvar
      }

      // 🔔 Criar notificação para intimações urgentes com prazo curto
      if (analysis.urgency === 'alta' && analysis.deadline?.days && analysis.deadline.days <= 5) {
        try {
          await userNotificationService.createNotification({
            title: '⚠️ Intimação Urgente',
            message: `Prazo de ${analysis.deadline.days} dia(s) - Processo ${intimation.numero_processo}`,
            type: 'intimation_urgent',
            user_id: user?.id || '',
            intimation_id: intimation.id,
          });
          console.log(`🔔 Notificação criada para intimação urgente ${intimation.id.substring(0, 8)}`);
        } catch (notifErr: any) {
          console.error('Erro ao criar notificação:', notifErr);
          // Não bloqueia o fluxo
        }
      }
      
      if (!silent) {
        setExpandedIntimationIds(prev => new Set(prev).add(intimation.id));
        toast.success('Análise concluída', `Intimação analisada com urgência ${analysis.urgency}`);
      }
    } catch (err: any) {
      console.error(`❌ Erro ao analisar intimação ${intimation.id.substring(0, 8)} com IA:`, err);
      if (!silent) {
        toast.error('Erro ao analisar', err.message || 'Não foi possível analisar a intimação');
      }
    } finally {
      setAnalyzingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(intimation.id);
        return newSet;
      });
    }
  };

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

  // Analisar automaticamente intimações não lidas
  const autoAnalyzeNewIntimations = async (intimationsList: DjenComunicacaoLocal[]) => {
    console.log(`🔍 Verificando análise automática para ${intimationsList.length} intimações...`);
    console.log(`🤖 IA habilitada: ${aiService.isEnabled()}`);
    
    if (!aiService.isEnabled()) {
      console.log('⚠️ IA não habilitada - pulando análise automática');
      return;
    }

    const toAnalyze = intimationsList.filter(
      (intimation) => !intimation.lida && !aiAnalysis.has(intimation.id)
    );

    console.log(`📊 Intimações sem análise: ${toAnalyze.length} de ${intimationsList.length}`);

    if (toAnalyze.length === 0) {
      console.log('✅ Todas as intimações já foram analisadas');
      return;
    }

    console.log(`🤖 Iniciando análise automática de ${toAnalyze.length} intimação(ões)...`);

    // Analisar em lotes de 3 para não sobrecarregar
    const batch = toAnalyze.slice(0, 3);

    for (const intimation of batch) {
      console.log(`🔄 Analisando intimação ${intimation.id.substring(0, 8)}...`);
      await handleAnalyzeWithAI(intimation, true);
      // Delay menor para análise mais rápida
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`✅ Análise automática concluída: ${batch.length} intimação(ões) processadas`);
    
    // Se ainda há mais para analisar, agendar próximo lote
    if (toAnalyze.length > 3) {
      console.log(`⏳ Agendando análise de mais ${toAnalyze.length - 3} intimações em 10 segundos...`);
      setTimeout(() => {
        autoAnalyzeNewIntimations(toAnalyze.slice(3));
      }, 10000);
    }
  };

  // Recarregar apenas intimações (sem flash/reload)
  const reloadIntimations = useCallback(async (runAutoAnalysis: boolean = false) => {
    try {
      const intimationsData = await djenLocalService.listComunicacoes();
      setIntimations(intimationsData);

      // Carregar análises salvas do banco de dados
      if (intimationsData.length > 0) {
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

      // Analisar automaticamente intimações não lidas (se solicitado)
      if (runAutoAnalysis && intimationsData.length > 0) {
        setTimeout(() => autoAnalyzeNewIntimations(intimationsData), 1000);
      }
    } catch (err: any) {
      console.error('Erro ao recarregar intimações:', err);
      toast.error('Erro ao atualizar', 'Não foi possível recarregar as intimações');
    }
  }, []);

  const loadData = useCallback(async (runAutoAnalysis: boolean = false) => {
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

      // Analisar automaticamente intimações não lidas (se solicitado)
      if (runAutoAnalysis && intimationsData.length > 0) {
        setTimeout(() => autoAnalyzeNewIntimations(intimationsData), 1000);
      }
    } catch (err: any) {
      toast.error('Erro ao carregar dados', err.message);
    } finally {
      setLoading(false);
      setInitialSnapshotLoaded(true);
    }
  }, []);

  // Carregar dados
  useEffect(() => {
    loadData(true); // Sempre executar análise automática
    fetchSyncLogs();
  }, [loadData, fetchSyncLogs]);

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
              dataDisponibilizacaoInicio: djenService.getDataDiasAtras(30),
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

        // Recarregar apenas intimações (sem flash) e analisar automaticamente
        const totalSaved = savedFromAdvocate + savedFromProcesses;
        // BUG FIX: Sempre tentar analisar, não apenas quando há novas
        // Pode haver intimações antigas sem análise
        await reloadIntimations(true);

        const completedAt = new Date();
        localStorage.setItem(LAST_SYNC_STORAGE_KEY, completedAt.toISOString());
        setLastLocalSyncAt(completedAt);

        if (mode === 'manual') {
          if (totalSaved > 0) {
            toast.success(
              'Sincronização concluída',
              `${totalSaved} nova(s) intimação(ões) importada(s). ${aiEnabled ? '🤖 IA analisando...' : ''}`,
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
    [processes, clients, currentUserProfile, aiEnabled, reloadIntimations, fetchSyncLogs, toast]
  );

  const getLastSyncDate = useCallback((): Date | null => {
    if (lastLocalSyncAt) {
      return lastLocalSyncAt;
    }

    const lastLogWithDate = syncLogs.find(log => log.run_finished_at || log.run_started_at);
    if (lastLogWithDate) {
      const value = lastLogWithDate.run_finished_at || lastLogWithDate.run_started_at;
      if (value) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date;
        }
      }
    }

    return null;
  }, [lastLocalSyncAt, syncLogs]);

  // Sincronização automática SEMPRE ao abrir a página
  useEffect(() => {
    if (autoSyncTriggeredRef.current) return;
    if (loading) return; // Aguardar dados carregarem
    if (!currentUserProfile) return; // Aguardar perfil carregar

    autoSyncTriggeredRef.current = true;
    console.log('🔄 Sincronizando intimações automaticamente...');
    
    performSync('auto').finally(() => {
      autoSyncTriggeredRef.current = false;
    });
  }, [loading, currentUserProfile, performSync]);

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

    // Filtro de status
    if (statusFilter === 'unread') {
      filtered = filtered.filter((i) => !i.lida);
    } else if (statusFilter === 'read') {
      filtered = filtered.filter((i) => i.lida);
    }

    // Filtro de tribunal
    if (tribunalFilter !== 'all') {
      filtered = filtered.filter((i) => i.sigla_tribunal === tribunalFilter);
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

    // Busca
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.numero_processo?.toLowerCase().includes(term) ||
          i.numero_processo_mascara?.toLowerCase().includes(term) ||
          i.texto?.toLowerCase().includes(term) ||
          i.nome_orgao?.toLowerCase().includes(term)
      );
    }

    return filtered;
  }, [intimations, statusFilter, tribunalFilter, dateFilter, customDateStart, customDateEnd, searchTerm]);

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

    const groups = new Map<string, DjenComunicacaoLocal[]>();
    filteredIntimations.forEach((intimation) => {
      const processKey = intimation.numero_processo_mascara || intimation.numero_processo || 'Sem número';
      if (!groups.has(processKey)) {
        groups.set(processKey, []);
      }
      groups.get(processKey)!.push(intimation);
    });

    return groups;
  }, [groupByProcess, filteredIntimations]);

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

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Conteúdo</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedIntimation.texto}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    handleCreateDeadline(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                >
                  <Clock className="w-4 h-4" />
                  Novo Prazo
                </button>
                <button
                  onClick={() => {
                    handleCreateAppointment(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                >
                  <CalendarIcon className="w-4 h-4" />
                  Adicionar Compromisso
                </button>
                {!selectedIntimation.lida && (
                  <button
                    onClick={() => {
                      handleMarkAsRead(selectedIntimation.id);
                      setSelectedIntimation(null);
                    }}
                    className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Marcar como Lida
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    handleOpenLinkModal(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center justify-center gap-2 border-2 border-purple-600 text-purple-600 hover:bg-purple-50 font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                >
                  <Link2 className="w-4 h-4" />
                  Vincular
                </button>
                {selectedIntimation.link && (
                  <a
                    href={selectedIntimation.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-medium px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg transition text-xs sm:text-sm w-full sm:w-auto"
                  >
                    <ExternalLink className="w-4 h-4" />
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
      {loading && (
        <div className="flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Atualizando dados em segundo plano...
        </div>
      )}
      {/* Header minimalista */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-lg sm:text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600" />
              Intimações DJEN
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Monitoramento contínuo das comunicações judiciais sincronizadas pelo cron do Supabase.
            </p>
            <div className="mt-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Sincronização automática:</span> ativa a cada 6h.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <button
                onClick={fetchSyncLogs}
                className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 px-3 py-1 rounded-lg font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar status
              </button>
              {syncStatusLoading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Atualizando histórico...
                </span>
              ) : syncLogs.length > 0 && lastCronRun?.status ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ${getStatusBadgeClass(lastCronRun.status)}`}>
                  Status atual: {lastCronRun.status}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50 w-full sm:w-auto"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sincronizar agora
                </>
              )}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowClearMenu(prev => !prev)}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50 w-full sm:w-auto"
              >
                <Trash2 className="w-4 h-4" />
                Gerenciar histórico
              </button>
              {showClearMenu && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-lg shadow-lg border border-gray-200 z-50 text-sm text-slate-700">
                  <button
                    onClick={handleDeleteSelected}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 disabled:text-slate-400"
                  >
                    <CheckCircle className="w-4 h-4" /> Remover selecionadas
                  </button>
                  <button
                    onClick={handleDeleteRead}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <EyeOff className="w-4 h-4" /> Remover lidas
                  </button>
                  <button
                    onClick={handleClearAllIntimations}
                    disabled={clearingAll || intimations.length === 0}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-red-600 disabled:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" /> Remover tudo
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={filteredIntimations.length === 0}
                className="inline-flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50 w-full sm:w-auto"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                  <div className="py-1 text-sm text-gray-700">
                    <button
                      onClick={handleExportCSV}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> CSV
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> Excel
                    </button>
                    <button
                      onClick={handleExportPDF}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" /> PDF
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="inline-flex items-center justify-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium px-3 py-1.5 rounded-lg transition w-full sm:w-auto"
              >
                <UserCog className="w-4 h-4" />
                Configurações
              </button>

              {showSettingsMenu && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-2">Configurações do Módulo</h3>
                    <p className="text-xs text-slate-500">Gerencie preferências de visualização.</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-slate-700">Visualização padrão</label>
                      <div className="mt-2">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-600">
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
                          Agrupar por processo automaticamente
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">Filtro padrão</label>
                      <select
                        value={moduleSettings.defaultStatusFilter}
                        onChange={(e) => {
                          const value = e.target.value as 'all' | 'unread' | 'read';
                          setModuleSettings((prev) => ({
                            ...prev,
                            defaultStatusFilter: value,
                          }));
                          setStatusFilter(value);
                        }}
                        className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                      >
                        <option value="all">Todas</option>
                        <option value="unread">Não lidas</option>
                        <option value="read">Lidas</option>
                      </select>
                      <p className="text-xs text-slate-500 mt-1">Define o filtro aplicado ao abrir o módulo.</p>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cards compactos de indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
              Não lidas
            </span>
            <Bell className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{unreadCount}</p>
          <p className="text-[11px] text-slate-500">pendentes de leitura</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
              Total
            </span>
            <FileText className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{intimations.length}</p>
          <p className="text-[11px] text-slate-500">intimações salvas</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
              Novas (7d)
            </span>
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{newWeekCount}</p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            +{newTodayCount} hoje
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
              Processos
            </span>
            <Link2 className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{linkedProcessesCount}</p>
          <p className="text-[11px] text-slate-500">processos vinculados</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
              Cobertura IA
            </span>
            <Sparkles className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{aiCoverage}%</p>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500" style={{ width: `${aiCoverage}%` }} />
          </div>
        </div>
      </div>

      {/* Resumo de urgência */}
      {aiUrgencyStats.unreadAnalyzed > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-red-200 rounded-lg p-3 sm:p-4">
            <p className="text-[11px] uppercase font-semibold text-red-600">Urgência alta</p>
            <p className="text-xl font-bold text-red-700 mt-1">{aiUrgencyStats.alta}</p>
            <p className="text-[11px] text-slate-500">não lidas analisadas</p>
          </div>
          <div className="bg-white border border-amber-200 rounded-lg p-3 sm:p-4">
            <p className="text-[11px] uppercase font-semibold text-amber-600">Urgência média</p>
            <p className="text-xl font-bold text-amber-700 mt-1">{aiUrgencyStats.media}</p>
            <p className="text-[11px] text-slate-500">não lidas analisadas</p>
          </div>
          <div className="bg-white border border-emerald-200 rounded-lg p-3 sm:p-4">
            <p className="text-[11px] uppercase font-semibold text-emerald-600">Urgência baixa</p>
            <p className="text-xl font-bold text-emerald-700 mt-1">{aiUrgencyStats.baixa}</p>
            <p className="text-[11px] text-slate-500">não lidas analisadas</p>
          </div>
        </div>
      )}


      {/* Filtros e Busca */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-6">
        <div className="flex flex-col lg:flex-row gap-3 sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por processo, conteúdo ou órgão..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm min-w-[160px]"
          >
            <option value="all">Todas ({intimations.length})</option>
            <option value="unread">Não Lidas ({unreadCount})</option>
            <option value="read">Lidas ({readCount})</option>
          </select>

          <select
            value={tribunalFilter}
            onChange={(e) => setTribunalFilter(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm min-w-[160px]"
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
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm min-w-[160px]"
          >
            <option value="30days">Últimos 30 dias</option>
            <option value="60days">Últimos 60 dias</option>
            <option value="90days">Últimos 90 dias</option>
            <option value="all">Todas as datas</option>
          </select>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg transition text-sm font-medium ${
              showFilters
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                : 'border border-gray-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            {showFilters ? 'Ocultar Filtros' : 'Filtros Avançados'}
          </button>

          <button
            onClick={() => {
              setSelectionMode(!selectionMode);
              if (selectionMode) setSelectedIds(new Set());
            }}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg transition text-sm font-medium ${
              selectionMode
                ? 'bg-purple-100 text-purple-700 border border-purple-300'
                : 'border border-gray-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {selectionMode ? 'Cancelar Seleção' : 'Selecionar Múltiplas'}
          </button>

          <button
            onClick={() => setGroupByProcess(!groupByProcess)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg transition text-sm font-medium ${
              groupByProcess
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'border border-gray-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {groupByProcess ? 'Desagrupar Processos' : 'Agrupar por Processo'}
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
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
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-sm text-slate-600">
              <strong>{selectedIds.size}</strong> intimação(ões) selecionada(s)
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleMarkSelectedAsRead}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-lg transition text-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Marcar como Lidas
              </button>
              <button
                onClick={handleDeleteSelected}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Remover selecionadas
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lista de Intimações */}
      <div className="space-y-3">
        {filteredIntimations.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-12 text-center">
            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h4 className="text-lg font-semibold text-slate-900 mb-2">Nenhuma intimação encontrada</h4>
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
            <div key={processNum} className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                <div>
                  <h4 className="text-lg font-bold text-slate-900">Processo: {processNum}</h4>
                  <p className="text-sm text-slate-600">
                    {group.length} intimação(ões) • {group.filter((i) => !i.lida).length} não lida(s)
                  </p>
                  {group[0].client_id && (
                    <p className="text-sm text-blue-600 mt-1">
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
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition text-sm"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Marcar Todas como Lidas
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
                        : 'border-amber-200 hover:border-amber-300 bg-amber-50/30'
                    }`}
                  >
                    {/* Header clicável para expandir */}
                    <div
                      className="p-4 cursor-pointer"
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-600 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {intimation.sigla_tribunal}
                            </span>
                            {intimation.tipo_comunicacao && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                {intimation.tipo_comunicacao}
                              </span>
                            )}
                            <span className="text-xs text-slate-500">
                              {formatDate(intimation.data_disponibilizacao)}
                            </span>
                            {!intimation.lida && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                NÃO LIDA
                              </span>
                            )}
                          </div>
                          <p className={`text-sm text-slate-700 ${!isExpanded ? 'line-clamp-2' : ''}`}>
                            {intimation.texto}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {aiEnabled && !aiAnalysis.has(intimation.id) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAnalyzeWithAI(intimation);
                              }}
                              disabled={analyzingIds.has(intimation.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded hover:bg-purple-50 transition disabled:opacity-50"
                            >
                              {analyzingIds.has(intimation.id) ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          {!intimation.lida && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(intimation.id);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 transition"
                            >
                              <CheckCircle className="w-3 h-3" />
                              Marcar
                            </button>
                          )}
                          {intimation.link && (
                            <a
                              href={intimation.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded hover:bg-purple-50 transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Diário
                            </a>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIntimation(intimation);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded hover:bg-blue-50 transition"
                          >
                            <Eye className="w-3 h-3" />
                            Detalhes
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Conteúdo Expandido - Visualização Agrupada */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-200">
                        {aiAnalysis.has(intimation.id) && (
                          <div className="mt-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Sparkles className="w-4 h-4 text-purple-600" />
                              <h6 className="text-xs font-bold text-purple-900">Análise IA</h6>
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
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-slate-700">Urgência:</span>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${urgencyColors[analysis.urgency]}`}>
                                      {analysis.urgency.toUpperCase()}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-700"><strong>Resumo:</strong> {analysis.summary}</p>
                                  {analysis.deadline && (
                                    <div className="bg-white/70 border border-amber-200 rounded p-2 text-xs">
                                      <p><strong>{analysis.deadline.days} dias úteis</strong> - {analysis.deadline.description}</p>
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
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          // Visualização normal (lista)
          filteredIntimations.map((intimation) => {
            const isExpanded = expandedIntimationIds.has(intimation.id);
            return (
            <div
              key={intimation.id}
              className={`bg-white border rounded-xl p-5 transition ${
                intimation.lida
                  ? 'border-slate-200 hover:border-slate-300'
                  : 'border-amber-200 hover:border-amber-300 bg-amber-50/30'
              } ${selectionMode && selectedIds.has(intimation.id) ? 'ring-2 ring-purple-500' : ''}`}
            >
              <div className="flex items-start gap-4">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(intimation.id)}
                    onChange={() => toggleSelection(intimation.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 w-5 h-5 text-purple-600 border-slate-300 rounded focus:ring-purple-500"
                  />
                )}

                <button
                  onClick={() => toggleExpanded(intimation.id)}
                  className="flex-shrink-0 mt-1 p-1 hover:bg-slate-100 rounded transition"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-slate-600" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-600" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {intimation.sigla_tribunal}
                    </span>
                    {intimation.tipo_comunicacao && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {intimation.tipo_comunicacao}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {formatDate(intimation.data_disponibilizacao)}
                    </span>
                    {!intimation.lida && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                        NÃO LIDA
                      </span>
                    )}
                    {aiAnalysis.has(intimation.id) && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 border border-violet-200">
                        <Sparkles className="w-3 h-3" />
                        Analisado por IA
                      </span>
                    )}
                  </div>

                  <h4 className="font-semibold text-slate-900 mb-2">
                    Processo: {intimation.numero_processo_mascara || intimation.numero_processo}
                  </h4>

                  {/* Polos das Partes */}
                  <div className="mb-3 space-y-1">
                    {intimation.polo_ativo && (
                      <p className="text-sm">
                        <span className="font-semibold text-emerald-700">Polo Ativo:</span>{' '}
                        <span className="text-slate-700">{intimation.polo_ativo}</span>
                      </p>
                    )}
                    {intimation.polo_passivo && (
                      <p className="text-sm">
                        <span className="font-semibold text-red-700">Polo Passivo:</span>{' '}
                        <span className="text-slate-700">{intimation.polo_passivo}</span>
                      </p>
                    )}
                  </div>

                  {intimation.client_id && (
                    <p className="text-sm text-slate-600 mb-1">
                      <strong>Cliente:</strong> {getClientName(intimation.client_id)}
                    </p>
                  )}

                  {intimation.process_id && (
                    <p className="text-sm text-slate-600 mb-2">
                      <strong>Processo:</strong> {getProcessCode(intimation.process_id)}
                    </p>
                  )}

                  {!isExpanded && (
                    <p className="text-sm text-slate-700 line-clamp-2">{intimation.texto}</p>
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

                                {/* Botões de Ação Rápida */}
                                <div className="pt-3 border-t border-purple-200">
                                  <h6 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1">
                                    ⚡ Ações Rápidas:
                                  </h6>
                                  <div className="flex flex-wrap gap-2">
                                    {analysis.deadline && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCreateDeadline(intimation);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                        Criar Prazo ({analysis.deadline.days}d)
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCreateAppointment(intimation);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition"
                                    >
                                      <CalendarIcon className="w-3.5 h-3.5" />
                                      Agendar Compromisso
                                    </button>
                                    {!intimation.lida && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleMarkAsRead(intimation.id);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
                                      >
                                        <CheckCircle className="w-3.5 h-3.5" />
                                        Marcar como Lida
                                      </button>
                                    )}
                                    {!intimation.client_id && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenLinkModal(intimation);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition"
                                      >
                                        <Link2 className="w-3.5 h-3.5" />
                                        Vincular Cliente
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </>
                            );
                          })()}
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

                {!selectionMode && (
                  <div className="flex flex-col gap-2">
                    {aiEnabled && !aiAnalysis.has(intimation.id) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAnalyzeWithAI(intimation);
                        }}
                        disabled={analyzingIds.has(intimation.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {analyzingIds.has(intimation.id) ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Analisando...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Analisar IA
                          </>
                        )}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateDeadline(intimation);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Novo Prazo
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCreateAppointment(intimation);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition"
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      Compromisso
                    </button>
                    {!intimation.lida && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkAsRead(intimation.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        Marcar Lida
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenLinkModal(intimation);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Vincular
                    </button>
                    {intimation.link && (
                      <a
                        href={intimation.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ver Diário
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">Vincular Intimação</h3>
              <button
                onClick={() => setLinkModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Cliente</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                <label className="block text-sm font-medium text-slate-700 mb-2">Processo</label>
                <select
                  value={selectedProcessId}
                  onChange={(e) => setSelectedProcessId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Nenhum processo</option>
                  {processes.map((process) => (
                    <option key={process.id} value={process.id}>
                      {process.process_code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSaveLinks}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium px-5 py-2.5 rounded-lg transition"
                >
                  Salvar Vínculos
                </button>
                <button
                  onClick={() => setLinkModalOpen(false)}
                  className="flex-1 border border-gray-300 text-slate-700 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg transition"
                >
                  Cancelar
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Criar Novo Prazo</h3>
              <p className="text-sm text-slate-600">A partir da intimação selecionada</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Informações da Intimação */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Título */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
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

          {/* Botões */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-medium px-5 py-2.5 rounded-lg transition inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  Criar Prazo
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-slate-700 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg transition"
            >
              Cancelar
            </button>
          </div>
        </form>
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <CalendarIcon className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Adicionar Compromisso</h3>
              <p className="text-sm text-slate-600">A partir da intimação selecionada</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Informações da Intimação */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Título */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Título do Compromisso *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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

          {/* Botões */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium px-5 py-2.5 rounded-lg transition inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <CalendarIcon className="w-4 h-4" />
                  Criar Compromisso
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-slate-700 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg transition"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default IntimationsModule;
