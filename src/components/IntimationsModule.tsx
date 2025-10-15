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
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  Sparkles,
  Lightbulb,
  AlertTriangle,
} from 'lucide-react';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { deadlineService } from '../services/deadline.service';
import { calendarService } from '../services/calendar.service';
import { profileService } from '../services/profile.service';
import { userNotificationService } from '../services/userNotification.service';
import { aiService } from '../services/ai.service';
import { intimationAnalysisService } from '../services/intimationAnalysis.service';
import { useToastContext } from '../contexts/ToastContext';
import type { DjenComunicacaoLocal, DjenConsultaParams } from '../types/djen.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { CreateDeadlineDTO, DeadlineType, DeadlinePriority } from '../types/deadline.types';
import type { CreateCalendarEventDTO, CalendarEventType } from '../types/calendar.types';
import type { Profile } from '../services/profile.service';
import type { IntimationAnalysis } from '../types/ai.types';

const AUTO_SYNC_INTERVAL = 2 * 60 * 60 * 1000; // 2 horas em ms

interface IntimationsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

const IntimationsModule: React.FC<IntimationsModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  
  // Estados principais
  const [intimations, setIntimations] = useState<DjenComunicacaoLocal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<string | null>(null);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('unread');
  const [dateFilter, setDateFilter] = useState<'30days' | '60days' | '90days' | 'all'>('30days');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [groupByProcess, setGroupByProcess] = useState(false);

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
      return;
    }

    setAnalyzingIds(prev => new Set(prev).add(intimation.id));

    try {
      const analysis = await aiService.analyzeIntimation(
        intimation.texto,
        intimation.numero_processo,
        intimation.data_disponibilizacao,
        intimation.tipo_documento || undefined,
        intimation.tipo_comunicacao || undefined
      );

      // Atualizar estado local
      setAiAnalysis(prev => new Map(prev).set(intimation.id, analysis));
      
      // Salvar análise no banco de dados
      try {
        await intimationAnalysisService.saveAnalysis(
          intimation.id,
          analysis,
          currentUserProfile?.id
        );
        console.log('✅ Análise salva no banco de dados');
      } catch (saveErr: any) {
        console.error('Erro ao salvar análise no banco:', saveErr);
        // Não bloqueia o fluxo se falhar ao salvar
      }
      
      if (!silent) {
        setExpandedIntimationIds(prev => new Set(prev).add(intimation.id));
        toast.success('Análise concluída', `Intimação analisada com urgência ${analysis.urgency}`);
      }
    } catch (err: any) {
      console.error('Erro ao analisar com IA:', err);
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

  // Analisar automaticamente intimações não lidas
  const autoAnalyzeNewIntimations = async (intimationsList: DjenComunicacaoLocal[]) => {
    if (!aiService.isEnabled()) return;

    const toAnalyze = intimationsList.filter(
      (intimation) => !intimation.lida && !aiAnalysis.has(intimation.id)
    );

    if (toAnalyze.length === 0) return;

    console.log(`🤖 Analisando automaticamente ${toAnalyze.length} intimação(ões) com IA...`);

    const batch = toAnalyze.slice(0, 5);

    for (const intimation of batch) {
      await handleAnalyzeWithAI(intimation, true);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Análise automática concluída: ${batch.length} intimação(ões)`);
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
          const savedAnalyses = await intimationAnalysisService.getAnalysesByIntimationIds(intimationIds);
          
          // Converter para o formato usado pela aplicação
          const analysisMap = new Map<string, IntimationAnalysis>();
          savedAnalyses.forEach((dbAnalysis, intimationId) => {
            analysisMap.set(intimationId, intimationAnalysisService.convertToIntimationAnalysis(dbAnalysis));
          });
          
          setAiAnalysis(analysisMap);
          console.log(`✅ ${analysisMap.size} análise(s) recarregada(s)`);
        } catch (err: any) {
          console.error('Erro ao carregar análises salvas:', err);
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
      const [intimationsData, clientsData, processesData, membersData, userProfile] = await Promise.all([
        djenLocalService.listComunicacoes(),
        clientService.listClients(),
        processService.listProcesses(),
        profileService.listMembers(),
        profileService.getMyProfile(),
      ]);
      setIntimations(intimationsData);
      setClients(clientsData);
      setProcesses(processesData);
      setMembers(membersData);
      setCurrentUserProfile(userProfile);

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
    }
  }, []);

  // Carregar dados
  useEffect(() => {
    loadData();
  }, [loadData]);

  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  const performSync = useCallback(
    async (mode: 'manual' | 'auto') => {
      if (syncingRef.current) {
        return;
      }

      syncingRef.current = true;
      setSyncing(true);

      try {
        // Obtém nome do advogado do perfil
        const lawyerName = currentUserProfile?.lawyer_full_name || currentUserProfile?.name || '';
        
        if (!lawyerName) {
          throw new Error('Nome do advogado não definido. Configure seu perfil.');
        }
        
        const params: DjenConsultaParams = {
          nomeAdvogado: lawyerName,
          dataDisponibilizacaoInicio: djenService.getDataHoje(),
          dataDisponibilizacaoFim: djenService.getDataHoje(),
          meio: 'D',
          itensPorPagina: 100,
          pagina: 1,
        };

        let savedFromAdvocate = 0;
        let savedFromProcesses = 0;

        const response = await djenService.consultarTodasComunicacoes(params);

        if (response.items && response.items.length > 0) {
          const result = await djenLocalService.saveComunicacoes(response.items, {
            clients,
            processes,
          });
          savedFromAdvocate = result.saved;
        }

        const processNumbers = Array.from(
          new Set(
            processes
              .map((process) => process.process_code?.trim())
              .filter((code): code is string => Boolean(code)),
          ),
        );

        if (processNumbers.length > 0) {
          const processResponse = await djenService.consultarPorProcessos(processNumbers, {
            dataDisponibilizacaoInicio: djenService.getDataDiasAtras(30),
            dataDisponibilizacaoFim: djenService.getDataHoje(),
            meio: 'D',
            itensPorPagina: 100,
            pagina: 1,
          });

          if (processResponse.items && processResponse.items.length > 0) {
            const result = await djenLocalService.saveComunicacoes(processResponse.items, {
              clients,
              processes,
            });
            savedFromProcesses = result.saved;
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
        await reloadIntimations(totalSaved > 0); // Analisar apenas se houver novas intimações

        if (mode === 'manual') {
          if (totalSaved > 0) {
            toast.success(
              'Sincronização concluída',
              `${totalSaved} nova(s) intimação(ões) importada(s). ${aiEnabled ? '🤖 IA analisando...' : ''}`,
            );
          } else {
            toast.info('Sincronização concluída', 'Nenhuma intimação nova encontrada');
          }
        } else {
          setLastAutoSyncAt(new Date().toISOString());
        }
      } catch (err: any) {
        if (mode === 'manual') {
          toast.error('Erro ao sincronizar', err.message);
        } else {
          console.error('Erro na sincronização automática:', err);
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [processes, currentUserProfile, loadData]
  );

  const handleSync = useCallback(async () => {
    await performSync('manual');
  }, [performSync]);

  const autoSyncInitializedRef = useRef(false);
  useEffect(() => {
    if (loading) {
      return;
    }

    const runAutoSync = async () => {
      if (syncingRef.current) {
        return;
      }
      try {
        await performSync('auto');
      } catch (err) {
        console.error('Falha ao executar sincronização automática:', err);
      }
    };

    if (!autoSyncInitializedRef.current) {
      autoSyncInitializedRef.current = true;
      runAutoSync();
    }

    const intervalId = window.setInterval(runAutoSync, AUTO_SYNC_INTERVAL);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading, processes.length, performSync]);

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
  }, [intimations, statusFilter, dateFilter, customDateStart, customDateEnd, searchTerm]);

  // Contadores
  const unreadCount = intimations.filter((i) => !i.lida).length;
  const readCount = intimations.filter((i) => i.lida).length;

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

  if (loading) {
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
                  className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium px-5 py-2.5 rounded-lg transition"
                >
                  <Clock className="w-4 h-4" />
                  Novo Prazo
                </button>
                <button
                  onClick={() => {
                    handleCreateAppointment(selectedIntimation);
                    setSelectedIntimation(null);
                  }}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition"
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
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg transition"
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
                  className="inline-flex items-center gap-2 border-2 border-purple-600 text-purple-600 hover:bg-purple-50 font-medium px-5 py-2.5 rounded-lg transition"
                >
                  <Link2 className="w-4 h-4" />
                  Vincular
                </button>
                {selectedIntimation.link && (
                  <a
                    href={selectedIntimation.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-medium px-5 py-2.5 rounded-lg transition"
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
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
              <Bell className="w-7 h-7 text-amber-600" />
              Intimações DJEN
            </h3>
            <div className="mt-2">
              <p className="text-sm text-slate-600">
                Sincronizamos com o DJEN procurando pelos processos cadastrados e pelo nome:
              </p>
              {currentUserProfile && (
                <div>
                  <p className="text-sm font-semibold text-indigo-600 mt-1">
                    {currentUserProfile.lawyer_full_name || currentUserProfile.name}
                  </p>
                  {!currentUserProfile.lawyer_full_name && (
                    <p className="text-xs text-amber-600 mt-1">
                      💡 Configure "Nome Completo para DJEN" no seu perfil para maior precisão na busca
                    </p>
                  )}
                </div>
              )}
              {!currentUserProfile && (
                <p className="text-xs text-amber-600 mt-1">
                  ⚠️ Configure o nome do advogado no seu perfil
                </p>
              )}
            </div>
            <div className="flex gap-4 mt-3">
              <span className="text-sm">
                <strong className="text-amber-600">{unreadCount}</strong> não lidas
              </span>
              <span className="text-sm">
                <strong className="text-slate-600">{readCount}</strong> lidas
              </span>
              <span className="text-sm">
                <strong className="text-blue-600">{intimations.length}</strong> total
              </span>
            </div>
            {lastAutoSyncAt && (
              <p className="text-xs text-slate-500 mt-2">
                Última sincronização automática: {formatDateTime(lastAutoSyncAt)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 justify-end">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition disabled:opacity-50"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sincronizar
                </>
              )}
            </button>

            <button
              onClick={handleClearAllIntimations}
              disabled={clearingAll || syncing || intimations.length === 0}
              className="inline-flex items-center gap-2 border border-red-200 text-red-600 hover:bg-red-50 font-medium px-5 py-2.5 rounded-lg transition disabled:opacity-50"
            >
              {clearingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Removendo...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Limpar histórico
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4">
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
          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-slate-600">
              <strong>{selectedIds.size}</strong> intimação(ões) selecionada(s)
            </span>
            <button
              onClick={handleMarkSelectedAsRead}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-lg transition text-sm"
            >
              <CheckCircle className="w-4 h-4" />
              Marcar como Lidas
            </button>
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
  clients: Client[];
  processes: Process[];
  members: Profile[];
  onClose: () => void;
  onSuccess: () => void;
}

const DeadlineCreationModal: React.FC<DeadlineCreationModalProps> = ({
  intimation,
  clients,
  processes,
  members,
  onClose,
  onSuccess,
}) => {
  const process = processes.find((p) => p.id === intimation.process_id);
  const client = clients.find((c) => c.id === intimation.client_id);

  const [formData, setFormData] = useState({
    title: `Prazo ${intimation.tipo_comunicacao || 'Intimação'} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`,
    description: intimation.texto || '',
    due_date: '',
    type: 'processo' as DeadlineType,
    priority: 'alta' as DeadlinePriority,
    client_id: intimation.client_id || '',
    process_id: intimation.process_id || '',
    responsible_id: '',
  });

  const [clientSearchTerm, setClientSearchTerm] = useState(
    client ? client.full_name : ''
  );
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
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
          </div>

          {/* Cliente */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Cliente {intimation.client_id && '(vinculado automaticamente)'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={clientSearchTerm}
                onChange={(e) => {
                  setClientSearchTerm(e.target.value);
                  if (!e.target.value.trim()) {
                    setFormData({ ...formData, client_id: '' });
                  }
                }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
                placeholder="Digite para buscar cliente..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              />
              {showClientSuggestions && clientSearchTerm && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {clients
                    .filter((c) =>
                      c.full_name.toLowerCase().includes(clientSearchTerm.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFormData({ ...formData, client_id: c.id });
                          setClientSearchTerm(c.full_name);
                          setShowClientSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-amber-50 transition"
                      >
                        <div className="font-semibold text-slate-900">{c.full_name}</div>
                        <div className="text-xs text-slate-500">{c.cpf_cnpj || 'CPF não informado'}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {formData.client_id && (
              <p className="text-xs text-emerald-600 mt-1">✓ Cliente selecionado</p>
            )}
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
  clients: Client[];
  processes: Process[];
  members: Profile[];
  onClose: () => void;
  onSuccess: () => void;
}

const AppointmentCreationModal: React.FC<AppointmentCreationModalProps> = ({
  intimation,
  clients,
  processes,
  members,
  onClose,
  onSuccess,
}) => {
  const process = processes.find((p) => p.id === intimation.process_id);
  const client = clients.find((c) => c.id === intimation.client_id);

  const [formData, setFormData] = useState({
    title: `Compromisso ${intimation.tipo_comunicacao || 'Intimação'} - Processo ${intimation.numero_processo_mascara || intimation.numero_processo}`,
    description: intimation.texto || '',
    date: '',
    time: '',
    type: 'meeting' as CalendarEventType,
    client_id: intimation.client_id || '',
    responsible_id: '',
  });

  const [clientSearchTerm, setClientSearchTerm] = useState(
    client ? client.full_name : ''
  );
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
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
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Cliente {intimation.client_id && '(vinculado automaticamente)'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={clientSearchTerm}
                onChange={(e) => {
                  setClientSearchTerm(e.target.value);
                  if (!e.target.value.trim()) {
                    setFormData({ ...formData, client_id: '' });
                  }
                }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
                placeholder="Digite para buscar cliente..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {showClientSuggestions && clientSearchTerm && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {clients
                    .filter((c) =>
                      c.full_name.toLowerCase().includes(clientSearchTerm.toLowerCase())
                    )
                    .slice(0, 5)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setFormData({ ...formData, client_id: c.id });
                          setClientSearchTerm(c.full_name);
                          setShowClientSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 transition"
                      >
                        <div className="font-semibold text-slate-900">{c.full_name}</div>
                        <div className="text-xs text-slate-500">{c.cpf_cnpj || 'CPF não informado'}</div>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {formData.client_id && (
              <p className="text-xs text-emerald-600 mt-1">✓ Cliente selecionado</p>
            )}
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
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Hora *
              </label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
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
                className="w-full px-4 py-2.5border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
