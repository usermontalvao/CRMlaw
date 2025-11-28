import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Brain,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Flag,
  Gavel,
  Globe,
  Hash,
  History,
  Info,
  Layers,
  LineChart,
  Loader2,
  MapPin,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Pause,
  PieChart,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Share2,
  Sparkles,
  Square,
  Star,
  Target,
  Timer,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
  Zap,
  List,
  FileDown,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { processMonitorService } from '../services/processMonitor.service';
import { profileService } from '../services/profile.service';
import { clientService } from '../services/client.service';
import type {
  MonitoredProcess,
  ProcessDiscoveryResult,
  ProcessStats,
  SyncProgress,
  ProcessPhase,
  ProcessHealthStatus,
} from '../types/processMonitor.types';
import type { Client } from '../types/client.types';

const HEALTH_STATUS_CONFIG: Record<
  ProcessHealthStatus,
  {
    label: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
    icon: typeof Activity;
    priority: number;
  }
> = {
  archived: {
    label: 'Arquivado',
    textColor: 'text-slate-500',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
    icon: Archive,
    priority: 0,
  },
  healthy: {
    label: 'Normal',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    icon: CheckCircle2,
    priority: 1,
  },
  attention: {
    label: 'Atenção',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: AlertTriangle,
    priority: 2,
  },
  critical: {
    label: 'Urgente',
    textColor: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: Zap,
    priority: 3,
  },
  suspended: {
    label: 'Suspenso',
    textColor: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    icon: Pause,
    priority: 1,
  },
};

const PHASE_CONFIG: Record<ProcessPhase, { label: string; order: number; icon: typeof Activity }> = {
  distribuicao: { label: 'Distribuição', order: 1, icon: FileText },
  citacao: { label: 'Citação', order: 2, icon: Users },
  contestacao: { label: 'Contestação', order: 3, icon: FileText },
  instrucao: { label: 'Instrução', order: 4, icon: BookOpen },
  sentenca: { label: 'Sentença', order: 5, icon: Gavel },
  recurso: { label: 'Recurso', order: 6, icon: TrendingUp },
  transito_julgado: { label: 'Trânsito em Julgado', order: 7, icon: CheckCircle2 },
  cumprimento: { label: 'Cumprimento', order: 8, icon: Target },
  arquivamento: { label: 'Arquivamento', order: 9, icon: Archive },
};

const COURT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  TRT: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  TST: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  TRF: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  TJMT: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  STF: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  STJ: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
};

const getCourtColor = (court: string) => {
  for (const [key, value] of Object.entries(COURT_COLORS)) {
    if (court.toUpperCase().includes(key)) return value;
  }
  return { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };
};

const formatProcessNumber = (num: string): string => {
  const clean = num.replace(/\D/g, '');
  if (clean.length === 20) {
    return `${clean.slice(0, 7)}-${clean.slice(7, 9)}.${clean.slice(9, 13)}.${clean.slice(13, 14)}.${clean.slice(14, 16)}.${clean.slice(16, 20)}`;
  }
  return num;
};

// Tipos para insights da IA
interface AIInsight {
  processId: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  nextAction: string;
  deadline?: string;
  prediction?: string;
}

export default function ProcessMonitorModule() {
  const [processes, setProcesses] = useState<MonitoredProcess[]>([]);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<ProcessDiscoveryResult[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [lawyerName, setLawyerName] = useState('');
  const [selectedDiscoveries, setSelectedDiscoveries] = useState<Set<string>>(new Set());
  const [isRegisteringBatch, setIsRegisteringBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [discoveryPeriod, setDiscoveryPeriod] = useState<number>(365);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<ProcessHealthStatus | 'all'>('all');
  const [filterPhase, setFilterPhase] = useState<ProcessPhase | 'all'>('all');
  const [filterCourt, setFilterCourt] = useState<string>('all');
  const [expandedTimeline, setExpandedTimeline] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'recent' | 'movements' | 'days' | 'priority'>('priority');
  const [removingProcessId, setRemovingProcessId] = useState<string | null>(null);
  const [removingAll, setRemovingAll] = useState(false);
  const [analyzingProcessId, setAnalyzingProcessId] = useState<string | null>(null);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  
  // Novos estados avançados
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'kanban'>('list');
  const [selectedProcesses, setSelectedProcesses] = useState<Set<string>>(new Set());
  const [showInsightsPanel, setShowInsightsPanel] = useState(false);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [favoriteProcesses, setFavoriteProcesses] = useState<Set<string>>(new Set());
  const [showExportModal, setShowExportModal] = useState(false);
  const [syncingProcessId, setSyncingProcessId] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  
  // Estados para vinculação de cliente
  const [showLinkClientModal, setShowLinkClientModal] = useState(false);
  const [linkingProcess, setLinkingProcess] = useState<MonitoredProcess | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedClientPole, setSelectedClientPole] = useState<'ativo' | 'passivo'>('ativo');
  const [showCreateClientModal, setShowCreateClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  
  // Filtro especial (clicável nos cards)
  const [specialFilter, setSpecialFilter] = useState<
    'all' | 'unlinked' | 'stale' | 'critical' | 'recent' | 'linked' | 'author' | 'defendant'
  >('all');
  
  // Paginação para performance
  const [visibleCount, setVisibleCount] = useState(20);
  const [showTimeline, setShowTimeline] = useState(false);

  // Estado para indicador de atualização em segundo plano
  const [backgroundSync, setBackgroundSync] = useState<{
    active: boolean;
    message: string;
    count?: number;
  }>({ active: false, message: '' });

  const loadData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      else setBackgroundSync({ active: true, message: 'Atualizando processos...', count: undefined });
      
      const [processesData, statsData] = await Promise.all([
        processMonitorService.listMonitoredProcesses(),
        processMonitorService.getStats(),
      ]);
      setProcesses(processesData);
      setStats(statsData);
      setInitialLoaded(true);
      
      if (!showLoading) {
        setBackgroundSync({ active: true, message: `${processesData.length} processos carregados`, count: processesData.length });
        setTimeout(() => setBackgroundSync({ active: false, message: '' }), 3000);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados');
      setBackgroundSync({ active: false, message: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProfile = async () => {
    try {
      const profile = await profileService.getMyProfile();
      if (profile?.lawyer_full_name) setLawyerName(profile.lawyer_full_name);
      else if (profile?.name) setLawyerName(profile.name);
    } catch (err) {
      console.error('Erro ao carregar perfil:', err);
    }
  };

  // Função para descobrir e registrar novos processos automaticamente
  const autoDiscoverAndSync = useCallback(async (advogadoNome: string) => {
    if (!advogadoNome.trim()) return;
    
    try {
      setBackgroundSync({ active: true, message: '🔍 Buscando novos processos...', count: undefined });
      
      // Descobrir processos dos últimos 30 dias
      const results = await processMonitorService.discoverProcesses(
        advogadoNome,
        30, // Últimos 30 dias
        (progress) => {
          setBackgroundSync({ 
            active: true, 
            message: progress.message || 'Buscando...', 
            count: undefined 
          });
        }
      );
      
      // Filtrar apenas novos (não registrados)
      const newProcesses = results.filter(r => !r.already_registered);
      
      if (newProcesses.length > 0) {
        setBackgroundSync({ active: true, message: `📥 Registrando ${newProcesses.length} novo(s) processo(s)...`, count: newProcesses.length });
        
        // Registrar novos processos automaticamente
        for (let i = 0; i < newProcesses.length; i++) {
          const discovery = newProcesses[i];
          try {
            await processMonitorService.registerProcess(discovery);
            setBackgroundSync({ 
              active: true, 
              message: `📥 Registrando ${i + 1}/${newProcesses.length}...`, 
              count: newProcesses.length - i - 1 
            });
          } catch (err) {
            console.error(`Erro ao registrar ${discovery.process_number}:`, err);
          }
          // Pequeno delay para não sobrecarregar
          if (i < newProcesses.length - 1) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
        
        // Recarregar dados
        await loadData(false);
        setBackgroundSync({ active: true, message: `✅ ${newProcesses.length} processo(s) adicionado(s)!`, count: undefined });
      } else {
        setBackgroundSync({ active: true, message: '✅ Nenhum processo novo encontrado', count: undefined });
      }
      
      setTimeout(() => setBackgroundSync({ active: false, message: '' }), 3000);
    } catch (err) {
      console.error('Erro na descoberta automática:', err);
      setBackgroundSync({ active: false, message: '' });
    }
  }, [loadData]);

  // Função para sincronizar movimentações de todos os processos
  const syncAllMovements = useCallback(async () => {
    if (!processes.length) return;
    
    setBackgroundSync({ active: true, message: '🔄 Atualizando movimentações...', count: processes.length });
    
    let updated = 0;
    const toSync = processes.slice(0, 50); // Limitar a 50 por vez para não sobrecarregar
    
    for (let i = 0; i < toSync.length; i++) {
      const process = toSync[i];
      try {
        await processMonitorService.syncProcessMovements(process.id);
        updated++;
        setBackgroundSync({ 
          active: true, 
          message: `🔄 Atualizando ${i + 1}/${toSync.length}...`, 
          count: toSync.length - i - 1 
        });
      } catch (err) {
        console.error(`Erro ao sincronizar ${process.process_number}:`, err);
      }
      // Delay entre requisições
      if (i < toSync.length - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    await loadData(false);
    setBackgroundSync({ active: true, message: `✅ ${updated} processo(s) atualizado(s)!`, count: undefined });
    setTimeout(() => setBackgroundSync({ active: false, message: '' }), 3000);
  }, [processes, loadData]);

  useEffect(() => {
    let isMounted = true;

    // Carrega dados iniciais e inicia sincronização automática
    const init = async () => {
      // Carregar perfil primeiro
      const profile = await profileService.getMyProfile();
      let nome = '';
      if (profile?.lawyer_full_name) {
        nome = profile.lawyer_full_name;
        setLawyerName(nome);
      } else if (profile?.name) {
        nome = profile.name;
        setLawyerName(nome);
      }
      
      if (isMounted) {
        // Carregar dados existentes
        await loadData(true);
        
        // Após carregar, iniciar descoberta automática em segundo plano
        if (nome && isMounted) {
          setTimeout(async () => {
            if (isMounted) {
              await autoDiscoverAndSync(nome);
              
              // Após descobrir, sincronizar movimentações
              setTimeout(async () => {
                if (isMounted && processes.length > 0) {
                  await syncAllMovements();
                }
              }, 5000);
            }
          }, 2000);
        }
      }
    };

    init();

    // Refresh automático a cada 10 minutos
    const interval = setInterval(() => {
      if (isMounted) {
        loadData(false);
      }
    }, 10 * 60 * 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleDiscoverProcesses = async () => {
    if (!lawyerName.trim()) {
      setError('Informe o nome do advogado');
      return;
    }
    try {
      setError(null);
      setSelectedDiscoveries(new Set());
      const results = await processMonitorService.discoverProcesses(
        lawyerName,
        discoveryPeriod,
        setSyncProgress
      );
      setDiscoveryResults(results);
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar processos');
    }
  };

  const toggleDiscoverySelection = (processNumber: string) => {
    setSelectedDiscoveries((prev) => {
      const next = new Set(prev);
      if (next.has(processNumber)) next.delete(processNumber);
      else next.add(processNumber);
      return next;
    });
  };

  const selectAllNew = () => {
    const newProcesses = discoveryResults
      .filter((d) => !d.already_registered)
      .map((d) => d.process_number);
    setSelectedDiscoveries(new Set(newProcesses));
  };

  const deselectAll = () => setSelectedDiscoveries(new Set());

  const handleRegisterProcess = async (discovery: ProcessDiscoveryResult) => {
    try {
      setSyncProgress({
        status: 'saving',
        message: `Registrando ${formatProcessNumber(discovery.process_number)}...`,
        current: 0,
        total: 1,
        found: 0,
        new: 0,
      });
      await processMonitorService.registerProcess(discovery);
      setDiscoveryResults((prev) =>
        prev.map((d) =>
          d.process_number === discovery.process_number ? { ...d, already_registered: true } : d
        )
      );
      setSelectedDiscoveries((prev) => {
        const next = new Set(prev);
        next.delete(discovery.process_number);
        return next;
      });
      await loadData();
      setSyncProgress({
        status: 'complete',
        message: 'Processo registrado!',
        current: 1,
        total: 1,
        found: 1,
        new: 1,
      });
      setTimeout(() => setSyncProgress(null), 2000);
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar');
      setSyncProgress(null);
    }
  };

  const handleRegisterSelected = async () => {
    const toRegister = discoveryResults.filter(
      (d) => selectedDiscoveries.has(d.process_number) && !d.already_registered
    );
    if (toRegister.length === 0) return;
    setIsRegisteringBatch(true);
    setBatchProgress({ current: 0, total: toRegister.length });
    for (let i = 0; i < toRegister.length; i++) {
      const discovery = toRegister[i];
      setBatchProgress({ current: i + 1, total: toRegister.length });
      try {
        await processMonitorService.registerProcess(discovery);
        setDiscoveryResults((prev) =>
          prev.map((d) =>
            d.process_number === discovery.process_number ? { ...d, already_registered: true } : d
          )
        );
      } catch (err) {
        console.error(`Erro ao registrar ${discovery.process_number}:`, err);
      }
      if (i < toRegister.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    setSelectedDiscoveries(new Set());
    setIsRegisteringBatch(false);
    await loadData();
  };

  const handleSyncProcess = async (processId: string) => {
    try {
      await processMonitorService.syncProcessMovements(processId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao sincronizar');
    }
  };

  const handleRemoveProcess = async (processId: string) => {
    if (!window.confirm('Deseja remover este processo do monitoramento?')) return;
    try {
      setRemovingProcessId(processId);
      await processMonitorService.removeProcess(processId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao remover processo');
    } finally {
      setRemovingProcessId(null);
    }
  };

  const handleRemoveAll = async () => {
    if (!processes.length) return;
    if (!window.confirm(`Esta ação removerá TODOS os ${processes.length} processos monitorados. Deseja continuar?`))
      return;
    try {
      setRemovingAll(true);
      await Promise.all(processes.map((p) => processMonitorService.removeProcess(p.id)));
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao remover todos os processos');
    } finally {
      setRemovingAll(false);
    }
  };

  const autoAnalyzedRef = useRef(new Set<string>());
  const autoResyncedRef = useRef(new Set<string>());
  const autoMaintainingRef = useRef(false);

  const uniqueCourts = useMemo(
    () => Array.from(new Set(processes.map((p) => p.court))).sort(),
    [processes]
  );

  const analyzeProcessWithGroq = async (process: MonitoredProcess): Promise<ProcessHealthStatus> => {
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey) return 'healthy';

    const recentMovements = process.movements?.slice(0, 5) || [];
    const movementsText = recentMovements
      .map(m => `${m.date}: ${m.title} - ${m.description?.substring(0, 100)}`)
      .join('\n');

    const prompt = `Analise este processo judicial brasileiro e classifique seu status atual.

Processo: ${process.process_number}
Classe: ${process.class_name || 'Não informada'}
Tribunal: ${process.court}

Últimas movimentações:
${movementsText || 'Sem movimentações registradas'}

Classifique como:
- "arquivado" = processo encerrado, baixado, transitado em julgado, arquivado
- "normal" = processo em andamento regular, sem pendências urgentes
- "atencao" = há prazo correndo ou audiência próxima
- "urgente" = situação crítica como revelia, multa, preclusão

Responda APENAS com uma palavra: arquivado, normal, atencao ou urgente`;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 10,
        }),
      });

      const data = await response.json();
      const status = data.choices?.[0]?.message?.content?.trim().toLowerCase();

      if (status?.includes('arquivado')) return 'archived';
      if (status?.includes('urgente')) return 'critical';
      if (status?.includes('atencao') || status?.includes('atenção')) return 'attention';
      return 'healthy';
    } catch (err) {
      console.error('Erro Groq:', err);
      return 'healthy';
    }
  };

  const handleAnalyzeWithAI = async (processId: string) => {
    const process = processes.find(p => p.id === processId);
    if (!process) return;

    try {
      setAnalyzingProcessId(processId);
      const healthStatus = await analyzeProcessWithGroq(process);
      await processMonitorService.updateProcessStatus(processId, healthStatus);
      
      // Atualizar localmente sem recarregar tudo
      setProcesses(prev => prev.map(p => 
        p.id === processId ? { ...p, health_status: healthStatus } : p
      ));
    } catch (err) {
      console.error('Erro ao analisar com IA:', err);
    } finally {
      setAnalyzingProcessId(null);
    }
  };

  const handleAnalyzeAllWithAI = async () => {
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey || processes.length === 0) return;

    setAnalyzingAll(true);
    
    for (let i = 0; i < processes.length; i++) {
      const process = processes[i];
      try {
        const healthStatus = await analyzeProcessWithGroq(process);
        await processMonitorService.updateProcessStatus(process.id, healthStatus);
        
        // Atualizar localmente
        setProcesses(prev => prev.map(p => 
          p.id === process.id ? { ...p, health_status: healthStatus } : p
        ));
        
        // Delay para não sobrecarregar API
        if (i < processes.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        console.error(`Erro ao analisar processo ${process.process_number}:`, err);
      }
    }
    
    setAnalyzingAll(false);
    await loadData(); // Recarregar stats
  };

  const autoMaintainProcesses = useCallback(async () => {
    if (!processes.length || autoMaintainingRef.current) return;
    autoMaintainingRef.current = true;

    try {
      let didSomething = false;

      const processesMissingParties = processes
        .filter((p) => (!p.parties || p.parties.length === 0) && !autoResyncedRef.current.has(p.id))
        .slice(0, 2);

      if (processesMissingParties.length) {
        setAutoStatus('Sincronizando nomes das partes automaticamente...');
        for (const proc of processesMissingParties) {
          await processMonitorService.resyncProcessParties(proc.id);
          autoResyncedRef.current.add(proc.id);
        }
        didSomething = true;
        await loadData();
      }

      const groqKey = import.meta.env.VITE_GROQ_API_KEY;
      if (groqKey) {
        const toAnalyze = processes
          .filter((p) => !autoAnalyzedRef.current.has(p.id))
          .slice(0, 3);

        if (toAnalyze.length) {
          setAutoStatus('Executando análise inteligente dos processos...');
          for (const proc of toAnalyze) {
            const healthStatus = await analyzeProcessWithGroq(proc);
            autoAnalyzedRef.current.add(proc.id);
            await processMonitorService.updateProcessStatus(proc.id, healthStatus);
          }
          didSomething = true;
          await loadData();
        }
      }

      if (didSomething) {
        setAutoStatus('Automação concluída');
        setTimeout(() => setAutoStatus(null), 2500);
      } else {
        setAutoStatus(null);
      }
    } catch (err) {
      console.error('Erro na automação do monitoramento', err);
      setAutoStatus('Erro ao executar automação. Verifique os logs.');
      setTimeout(() => setAutoStatus(null), 4000);
    } finally {
      autoMaintainingRef.current = false;
    }
  }, [processes, loadData]);

  // DESABILITADO: Auto-manutenção causa lentidão no carregamento
  // Executar apenas quando o usuário clicar em "Classificar"
  // useEffect(() => {
  //   if (!processes.length) return;
  //   autoMaintainProcesses();
  // }, [processes, autoMaintainProcesses]);

  // Gerar insights avançados com IA
  const generateAIInsights = async () => {
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey || processes.length === 0) return;

    setLoadingInsights(true);
    const insights: AIInsight[] = [];

    // Analisar processos críticos e com atenção
    const priorityProcesses = processes.filter(p => 
      p.health_status === 'critical' || p.health_status === 'attention'
    ).slice(0, 5);

    for (const process of priorityProcesses) {
      try {
        const recentMovements = process.movements?.slice(0, 5) || [];
        const movementsText = recentMovements
          .map(m => `${m.date}: ${m.title} - ${m.description?.substring(0, 100)}`)
          .join('\n');

        const prompt = `Analise este processo judicial e forneça insights estratégicos:

Processo: ${process.process_number}
Classe: ${process.class_name || 'Não informada'}
Tribunal: ${process.court}
Status atual: ${process.health_status}

Últimas movimentações:
${movementsText || 'Sem movimentações'}

Responda em JSON com este formato exato:
{
  "summary": "resumo de 1 linha do estado atual",
  "riskLevel": "low" ou "medium" ou "high",
  "nextAction": "próxima ação recomendada",
  "deadline": "prazo estimado se houver",
  "prediction": "previsão do desfecho"
}`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 300,
          }),
        });

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            insights.push({
              processId: process.id,
              summary: parsed.summary || 'Análise indisponível',
              riskLevel: parsed.riskLevel || 'medium',
              nextAction: parsed.nextAction || 'Verificar movimentações',
              deadline: parsed.deadline,
              prediction: parsed.prediction,
            });
          }
        } catch {
          insights.push({
            processId: process.id,
            summary: 'Processo requer atenção',
            riskLevel: 'medium',
            nextAction: 'Verificar movimentações recentes',
          });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error('Erro ao gerar insight:', err);
      }
    }

    setAiInsights(insights);
    setLoadingInsights(false);
    setShowInsightsPanel(true);
  };

  // Toggle favorito
  const toggleFavorite = (processId: string) => {
    setFavoriteProcesses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(processId)) {
        newSet.delete(processId);
      } else {
        newSet.add(processId);
      }
      return newSet;
    });
  };

  // Toggle seleção
  const toggleSelection = (processId: string) => {
    setSelectedProcesses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(processId)) {
        newSet.delete(processId);
      } else {
        newSet.add(processId);
      }
      return newSet;
    });
  };

  // Selecionar todos
  const selectAll = () => {
    if (selectedProcesses.size === filteredProcesses.length) {
      setSelectedProcesses(new Set());
    } else {
      setSelectedProcesses(new Set(filteredProcesses.map(p => p.id)));
    }
  };

  // Exportar para CSV
  const exportToCSV = () => {
    const headers = ['Número', 'Classe', 'Tribunal', 'Status', 'Última Movimentação', 'Total Movimentações', 'Partes'];
    const rows = filteredProcesses.map(p => [
      p.process_number,
      p.class_name || '',
      p.court || '',
      HEALTH_STATUS_CONFIG[p.health_status]?.label || '',
      p.last_movement_date ? new Date(p.last_movement_date).toLocaleDateString('pt-BR') : '',
      p.total_movements || 0,
      p.parties?.map(party => `${party.pole === 'ativo' ? 'A:' : 'R:'} ${party.name}`).join('; ') || ''
    ]);

    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `processos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Copiar número do processo
  const copyProcessNumber = (num: string) => {
    navigator.clipboard.writeText(num);
  };

  // Re-sincronizar partes de todos os processos
  const handleResyncAllParties = async () => {
    if (processes.length === 0) return;
    
    setSyncingProcessId('all');
    try {
      await processMonitorService.resyncAllParties((current, total) => {
        console.log(`Sincronizando partes: ${current}/${total}`);
      });
      await loadData();
      setLastSyncTime(new Date());
    } catch (err) {
      console.error('Erro ao sincronizar partes:', err);
      setError('Erro ao sincronizar partes dos processos');
    } finally {
      setSyncingProcessId(null);
    }
  };

  // Carregar clientes para vinculação
  const loadClients = async () => {
    try {
      const clientsData = await clientService.listClients();
      setClients(clientsData);
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
    }
  };

  // Abrir modal de vinculação de cliente
  const openLinkClientModal = (process: MonitoredProcess) => {
    setLinkingProcess(process);
    setClientSearchTerm('');
    setSelectedClientPole(process.our_client_pole || 'ativo');
    loadClients();
    setShowLinkClientModal(true);
  };

  // Vincular processo a cliente
  const handleLinkClient = async (clientId: string, clientName: string) => {
    if (!linkingProcess) return;
    
    try {
      await processMonitorService.linkProcessToClient(
        linkingProcess.id,
        clientId,
        clientName,
        selectedClientPole
      );
      await loadData();
      setShowLinkClientModal(false);
      setLinkingProcess(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao vincular cliente');
    }
  };

  // Desvincular cliente do processo
  const handleUnlinkClient = async (processId: string) => {
    if (!window.confirm('Deseja remover o vínculo com o cliente?')) return;
    
    try {
      await processMonitorService.unlinkProcessFromClient(processId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao desvincular cliente');
    }
  };

  // Validar se é um nome de pessoa/empresa válido usando IA
  const validateNameWithAI = async (name: string): Promise<{ isValid: boolean; cleanedName?: string; reason?: string }> => {
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey) {
      // Fallback: validação simples sem IA
      const invalidPatterns = [
        /^[0-9\-\.\/]+$/, // Apenas números
        /processo|procedimento|recurso|ação|cível|criminal|trabalhista/i,
        /^(autor|réu|requerente|requerido|apelante|apelado|reclamante|reclamado)$/i,
        /portador|causalidade|acide|rdito/i, // Textos truncados
        /^.{0,3}$/, // Muito curto
      ];
      const isValid = !invalidPatterns.some(p => p.test(name.trim()));
      return { isValid, cleanedName: name.trim() };
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `Você analisa se um texto é um nome válido de pessoa física ou jurídica brasileira.
Responda APENAS com JSON: {"isValid": true/false, "cleanedName": "nome limpo se válido", "reason": "motivo se inválido"}

Regras:
- Nome válido: Nome de pessoa (ex: "João Silva", "Maria Santos") ou empresa (ex: "ABC Ltda", "XYZ S.A.")
- Nome inválido: Textos truncados, descrições de processos, tipos de ação, termos jurídicos genéricos
- Se for nome válido mas com erros, corrija em cleanedName`
            },
            { role: 'user', content: `Analise: "${name}"` }
          ],
          temperature: 0.1,
          max_tokens: 150,
        }),
      });

      if (!response.ok) throw new Error('Erro na API');
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { isValid: false, reason: 'Não foi possível validar' };
    } catch (err) {
      console.error('Erro ao validar nome:', err);
      // Fallback
      return { isValid: name.trim().length > 3, cleanedName: name.trim() };
    }
  };

  // Criar novo cliente a partir da parte do processo
  const handleCreateClientFromParty = async (partyName: string) => {
    // Validar nome antes de abrir modal
    const validation = await validateNameWithAI(partyName);
    
    if (!validation.isValid) {
      setError(`"${partyName}" não parece ser um nome de cliente válido. ${validation.reason || 'Por favor, digite um nome correto.'}`);
      return;
    }
    
    setNewClientName(validation.cleanedName || partyName);
    setShowCreateClientModal(true);
  };
  
  // Criar cliente efetivamente
  const handleConfirmCreateClient = async () => {
    if (!newClientName.trim()) {
      setError('Nome do cliente é obrigatório');
      return;
    }
    
    // Validar novamente
    const validation = await validateNameWithAI(newClientName);
    if (!validation.isValid) {
      setError(`"${newClientName}" não é um nome válido. ${validation.reason || ''}`);
      return;
    }
    
    try {
      const isCompany = newClientName.includes('Ltda') || newClientName.includes('S.A.') || newClientName.includes('ME') || newClientName.includes('EIRELI') || newClientName.includes('S/A');
      const newClient = await clientService.createClient({
        full_name: validation.cleanedName || newClientName.trim(),
        client_type: isCompany ? 'pessoa_juridica' : 'pessoa_fisica',
        status: 'ativo',
      });
      
      // Se tiver processo sendo vinculado, vincular automaticamente
      if (linkingProcess) {
        await handleLinkClient(newClient.id, newClient.full_name);
      }
      
      setShowCreateClientModal(false);
      setNewClientName('');
      await loadClients();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar cliente');
    }
  };

  // Filtrar clientes pela busca
  const filteredClients = useMemo(() => {
    if (!clientSearchTerm.trim()) return clients;
    const term = clientSearchTerm.toLowerCase();
    return clients.filter(c => 
      c.full_name.toLowerCase().includes(term) ||
      c.cpf_cnpj?.includes(term) ||
      c.email?.toLowerCase().includes(term)
    );
  }, [clients, clientSearchTerm]);

  // Métricas calculadas avançadas
  const metrics = useMemo(() => {
    if (!processes.length) return null;
    
    const withMovements = processes.filter(p => p.movements && p.movements.length > 0);
    const avgMovements = withMovements.length 
      ? Math.round(withMovements.reduce((acc, p) => acc + (p.total_movements || 0), 0) / withMovements.length)
      : 0;
    
    // Processos vinculados a clientes
    const linkedToClient = processes.filter(p => p.linked_client_id).length;
    
    // Processos sem vínculo
    const unlinked = processes.filter(p => !p.linked_client_id && p.health_status !== 'archived').length;
    
    // Processos onde somos autor vs réu
    const asAuthor = processes.filter(p => p.our_client_pole === 'ativo').length;
    const asDefendant = processes.filter(p => p.our_client_pole === 'passivo').length;
    
    const recentActivity = processes.filter(p => {
      if (!p.last_movement_date) return false;
      const daysDiff = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff <= 7;
    }).length;

    const staleProcesses = processes.filter(p => {
      if (!p.last_movement_date) return true;
      const daysDiff = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff > 30;
    }).length;

    const byTribunal = processes.reduce((acc, p) => {
      const court = p.court || 'Não informado';
      acc[court] = (acc[court] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return { 
      avgMovements, 
      recentActivity, 
      staleProcesses, 
      byTribunal,
      linkedToClient,
      unlinked,
      asAuthor,
      asDefendant
    };
  }, [processes]);

  // Insights automáticos
  const autoInsights = useMemo(() => {
    if (!processes.length) return [];
    
    const insights: { type: 'warning' | 'info' | 'success' | 'danger'; message: string; count?: number }[] = [];
    
    // Processos sem vínculo com cliente
    const unlinkedActive = processes.filter(p => !p.linked_client_id && p.health_status !== 'archived');
    if (unlinkedActive.length > 0) {
      insights.push({
        type: 'warning',
        message: `${unlinkedActive.length} processo(s) ativo(s) sem cliente vinculado`,
        count: unlinkedActive.length
      });
    }
    
    // Processos parados há mais de 30 dias
    const stale = processes.filter(p => {
      if (p.health_status === 'archived') return false;
      if (!p.last_movement_date) return true;
      const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
      return days > 30;
    });
    if (stale.length > 0) {
      insights.push({
        type: 'info',
        message: `${stale.length} processo(s) sem movimentação há mais de 30 dias`,
        count: stale.length
      });
    }
    
    // Processos críticos
    const critical = processes.filter(p => p.health_status === 'critical');
    if (critical.length > 0) {
      insights.push({
        type: 'danger',
        message: `${critical.length} processo(s) em situação crítica requerem ação imediata`,
        count: critical.length
      });
    }
    
    // Movimentações recentes
    const recent = processes.filter(p => {
      if (!p.last_movement_date) return false;
      const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
      return days <= 3;
    });
    if (recent.length > 0) {
      insights.push({
        type: 'success',
        message: `${recent.length} processo(s) com movimentação nos últimos 3 dias`,
        count: recent.length
      });
    }
    
    return insights;
  }, [processes]);

  const filteredProcesses = useMemo(() => {
    let result = processes.filter((p) => {
      // Filtro especial (dos cards clicáveis)
      if (specialFilter !== 'all') {
        switch (specialFilter) {
          case 'unlinked':
            if (p.linked_client_id || p.health_status === 'archived') return false;
            break;
          case 'stale':
            if (p.health_status === 'archived') return false;
            if (p.last_movement_date) {
              const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
              if (days <= 30) return false;
            }
            break;
          case 'critical':
            if (p.health_status !== 'critical') return false;
            break;
          case 'recent':
            if (!p.last_movement_date) return false;
            const daysDiff = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
            if (daysDiff > 3) return false;
            break;
          case 'linked':
            if (!p.linked_client_id) return false;
            break;
          case 'author':
            if (p.our_client_pole !== 'ativo') return false;
            break;
          case 'defendant':
            if (p.our_client_pole !== 'passivo') return false;
            break;
        }
      }
      
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const match =
          p.process_number.includes(term) ||
          p.process_number_formatted?.toLowerCase().includes(term) ||
          p.court?.toLowerCase().includes(term) ||
          p.class_name?.toLowerCase().includes(term) ||
          p.parties?.some((party) => party.name.toLowerCase().includes(term));
        if (!match) return false;
      }
      if (filterStatus !== 'all' && p.health_status !== filterStatus) return false;
      if (filterPhase !== 'all' && p.current_phase !== filterPhase) return false;
      if (filterCourt !== 'all' && p.court !== filterCourt) return false;
      return true;
    });
    switch (sortBy) {
      case 'priority':
        result.sort((a, b) => {
          const priorityA = HEALTH_STATUS_CONFIG[a.health_status]?.priority || 0;
          const priorityB = HEALTH_STATUS_CONFIG[b.health_status]?.priority || 0;
          return priorityB - priorityA;
        });
        break;
      case 'recent':
        result.sort((a, b) => (b.last_movement_date || '').localeCompare(a.last_movement_date || ''));
        break;
      case 'movements':
        result.sort((a, b) => (b.total_movements || 0) - (a.total_movements || 0));
        break;
      case 'days':
        result.sort((a, b) => (b.days_without_movement || 0) - (a.days_without_movement || 0));
        break;
    }
    return result;
  }, [processes, searchTerm, filterStatus, filterPhase, filterCourt, sortBy, specialFilter]);

  // Mostra loading apenas na primeira carga (antes de ter dados)
  if (loading && !initialLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Carregando processos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Avançado */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg">
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Monitor Inteligente
                <span className="px-2 py-0.5 bg-purple-500/30 text-purple-300 text-xs font-medium rounded-full">
                  IA Powered
                </span>
              </h1>
              <p className="text-slate-400 text-sm mt-0.5 flex items-center gap-2">
                {processes.length} processos monitorados • Última sync: {lastSyncTime ? lastSyncTime.toLocaleTimeString('pt-BR') : 'Nunca'}
                {backgroundSync.active && (
                  <span className="flex items-center gap-1.5 text-blue-400 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {backgroundSync.message}
                  </span>
                )}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Modo de visualização */}
            <div className="flex bg-slate-700/50 rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`p-2 rounded-md transition-all ${viewMode === 'cards' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`p-2 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => setShowDiscovery(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Descobrir
            </button>

            {/* Botão de Sincronização Completa */}
            <button
              onClick={async () => {
                if (lawyerName) {
                  await autoDiscoverAndSync(lawyerName);
                  setTimeout(() => syncAllMovements(), 2000);
                }
              }}
              disabled={backgroundSync.active}
              className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all disabled:opacity-50"
              title="Buscar novos processos e atualizar todos os andamentos"
            >
              {backgroundSync.active ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Sync Tudo
            </button>
            
            {processes.length > 0 && (
              <>
                <button
                  onClick={generateAIInsights}
                  disabled={loadingInsights}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all disabled:opacity-50"
                >
                  {loadingInsights ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                  Insights IA
                </button>
                
                <button
                  onClick={handleAnalyzeAllWithAI}
                  disabled={analyzingAll}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all disabled:opacity-50"
                >
                  {analyzingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Classificar
                </button>

                <button
                  onClick={handleResyncAllParties}
                  disabled={syncingProcessId === 'all'}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all disabled:opacity-50"
                  title="Buscar nomes das partes de todos os processos"
                >
                  {syncingProcessId === 'all' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Users className="w-4 h-4" />
                  )}
                  Sync Partes
                </button>

                <button
                  onClick={handleRemoveAll}
                  disabled={removingAll}
                  className="px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 rounded-lg font-medium flex items-center gap-2 text-sm transition-all disabled:opacity-50"
                  title="Apagar todos os processos monitorados"
                >
                  {removingAll ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Apagar Tudo
                </button>

                <button
                  onClick={exportToCSV}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium flex items-center gap-2 text-sm transition-all"
                >
                  <FileDown className="w-4 h-4" />
                  Exportar
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mini Stats no Header - Clicáveis */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-6">
            <button 
              onClick={() => { setSpecialFilter('all'); setFilterStatus('all'); }}
              className={`bg-white/10 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-white/20 ${specialFilter === 'all' && filterStatus === 'all' ? 'ring-2 ring-white/50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Total</span>
                <Gavel className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </button>
            <button 
              onClick={() => { setSpecialFilter('all'); setFilterStatus('healthy'); }}
              className={`bg-emerald-500/20 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-emerald-500/30 ${filterStatus === 'healthy' ? 'ring-2 ring-emerald-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-emerald-300 text-xs">Normal</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.healthy}</p>
            </button>
            <button 
              onClick={() => { setSpecialFilter('all'); setFilterStatus('attention'); }}
              className={`bg-amber-500/20 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-amber-500/30 ${filterStatus === 'attention' ? 'ring-2 ring-amber-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-amber-300 text-xs">Atenção</span>
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-amber-400 mt-1">{stats.attention}</p>
            </button>
            <button 
              onClick={() => { setSpecialFilter('critical'); setFilterStatus('all'); }}
              className={`bg-red-500/20 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-red-500/30 ${specialFilter === 'critical' || filterStatus === 'critical' ? 'ring-2 ring-red-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-red-300 text-xs">Urgente</span>
                <Zap className="w-4 h-4 text-red-400" />
              </div>
              <p className="text-2xl font-bold text-red-400 mt-1">{stats.critical}</p>
            </button>
            <button 
              onClick={() => { setSpecialFilter('all'); setFilterStatus('archived'); }}
              className={`bg-slate-500/20 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-slate-500/30 ${filterStatus === 'archived' ? 'ring-2 ring-slate-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Arquivados</span>
                <Archive className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-400 mt-1">{stats.archived}</p>
            </button>
            <button 
              onClick={() => { setSpecialFilter('recent'); setFilterStatus('all'); }}
              className={`bg-blue-500/20 backdrop-blur rounded-xl p-3 text-left transition-all hover:bg-blue-500/30 ${specialFilter === 'recent' ? 'ring-2 ring-blue-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-blue-300 text-xs">Mov. 7 dias</span>
                <TrendingUp className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-2xl font-bold text-blue-400 mt-1">{metrics?.recentActivity || 0}</p>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <span className="text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto p-1 text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Auto Insights - Alertas Inteligentes (Clicáveis) */}
      {autoInsights.length > 0 && (
        <div className="space-y-2">
          {/* Indicador de filtro ativo */}
          {specialFilter !== 'all' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-100 border border-blue-300 rounded-lg">
              <Info className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-800">
                Filtro ativo: <strong>{
                  specialFilter === 'unlinked' ? 'Sem cliente vinculado' :
                  specialFilter === 'stale' ? 'Sem movimentação (+30 dias)' :
                  specialFilter === 'critical' ? 'Situação crítica' :
                  specialFilter === 'recent' ? 'Movimentação recente' :
                  specialFilter === 'linked' ? 'Vinculados a cliente' :
                  specialFilter === 'author' ? 'Cliente como autor' :
                  specialFilter === 'defendant' ? 'Cliente como réu' : ''
                }</strong>
              </span>
              <button 
                onClick={() => setSpecialFilter('all')}
                className="ml-auto text-blue-600 hover:text-blue-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {autoInsights.map((insight, idx) => {
              // Determinar qual filtro aplicar ao clicar
              const getFilterForInsight = () => {
                if (insight.message.includes('sem cliente vinculado')) return 'unlinked';
                if (insight.message.includes('sem movimentação')) return 'stale';
                if (insight.message.includes('crítica')) return 'critical';
                if (insight.message.includes('últimos 3 dias')) return 'recent';
                return 'all';
              };
              const targetFilter = getFilterForInsight();
              const isActive = specialFilter === targetFilter;
              
              return (
                <button 
                  key={idx}
                  onClick={() => setSpecialFilter(isActive ? 'all' : targetFilter as any)}
                  className={`rounded-xl p-4 border text-left transition-all ${
                    insight.type === 'danger' ? `bg-red-50 border-red-200 hover:bg-red-100 ${isActive ? 'ring-2 ring-red-400' : ''}` :
                    insight.type === 'warning' ? `bg-amber-50 border-amber-200 hover:bg-amber-100 ${isActive ? 'ring-2 ring-amber-400' : ''}` :
                    insight.type === 'success' ? `bg-emerald-50 border-emerald-200 hover:bg-emerald-100 ${isActive ? 'ring-2 ring-emerald-400' : ''}` :
                    `bg-blue-50 border-blue-200 hover:bg-blue-100 ${isActive ? 'ring-2 ring-blue-400' : ''}`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      insight.type === 'danger' ? 'bg-red-100' :
                      insight.type === 'warning' ? 'bg-amber-100' :
                      insight.type === 'success' ? 'bg-emerald-100' :
                      'bg-blue-100'
                    }`}>
                      {insight.type === 'danger' ? <AlertCircle className="w-5 h-5 text-red-600" /> :
                       insight.type === 'warning' ? <AlertTriangle className="w-5 h-5 text-amber-600" /> :
                       insight.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> :
                       <Info className="w-5 h-5 text-blue-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        insight.type === 'danger' ? 'text-red-800' :
                        insight.type === 'warning' ? 'text-amber-800' :
                        insight.type === 'success' ? 'text-emerald-800' :
                        'text-blue-800'
                      }`}>
                        {insight.message}
                      </p>
                      <p className="text-xs mt-1 opacity-70">Clique para filtrar</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Métricas de Clientes Vinculados (Clicáveis) */}
      {metrics && processes.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-indigo-900">Integração com Clientes</h3>
            <span className="text-xs text-indigo-600 ml-auto">Clique para filtrar</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button 
              onClick={() => setSpecialFilter(specialFilter === 'linked' ? 'all' : 'linked')}
              className={`text-center p-3 rounded-lg transition-all hover:bg-indigo-100 ${specialFilter === 'linked' ? 'bg-indigo-100 ring-2 ring-indigo-400' : ''}`}
            >
              <p className="text-2xl font-bold text-indigo-600">{metrics.linkedToClient}</p>
              <p className="text-xs text-indigo-700">Vinculados</p>
            </button>
            <button 
              onClick={() => setSpecialFilter(specialFilter === 'unlinked' ? 'all' : 'unlinked')}
              className={`text-center p-3 rounded-lg transition-all hover:bg-amber-100 ${specialFilter === 'unlinked' ? 'bg-amber-100 ring-2 ring-amber-400' : ''}`}
            >
              <p className="text-2xl font-bold text-amber-600">{metrics.unlinked}</p>
              <p className="text-xs text-amber-700">Sem Vínculo</p>
            </button>
            <button 
              onClick={() => setSpecialFilter(specialFilter === 'author' ? 'all' : 'author')}
              className={`text-center p-3 rounded-lg transition-all hover:bg-blue-100 ${specialFilter === 'author' ? 'bg-blue-100 ring-2 ring-blue-400' : ''}`}
            >
              <p className="text-2xl font-bold text-blue-600">{metrics.asAuthor}</p>
              <p className="text-xs text-blue-700">Como Autor</p>
            </button>
            <button 
              onClick={() => setSpecialFilter(specialFilter === 'defendant' ? 'all' : 'defendant')}
              className={`text-center p-3 rounded-lg transition-all hover:bg-orange-100 ${specialFilter === 'defendant' ? 'bg-orange-100 ring-2 ring-orange-400' : ''}`}
            >
              <p className="text-2xl font-bold text-orange-600">{metrics.asDefendant}</p>
              <p className="text-xs text-orange-700">Como Réu</p>
            </button>
          </div>
        </div>
      )}

      {/* Painel de Insights IA */}
      {showInsightsPanel && aiInsights.length > 0 && (
        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-purple-900">Insights da IA</h3>
              <span className="px-2 py-0.5 bg-purple-200 text-purple-700 text-xs rounded-full">
                {aiInsights.length} processos analisados
              </span>
            </div>
            <button onClick={() => setShowInsightsPanel(false)} className="p-1 text-purple-400 hover:text-purple-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {aiInsights.map((insight) => {
              const process = processes.find(p => p.id === insight.processId);
              return (
                <div key={insight.processId} className="bg-white rounded-xl p-4 shadow-sm border border-purple-100">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-mono text-xs text-slate-600">
                      {process ? formatProcessNumber(process.process_number) : 'N/A'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      insight.riskLevel === 'high' ? 'bg-red-100 text-red-700' :
                      insight.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {insight.riskLevel === 'high' ? 'Alto Risco' : insight.riskLevel === 'medium' ? 'Médio Risco' : 'Baixo Risco'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mb-3">{insight.summary}</p>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-start gap-2">
                      <ArrowRight className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                      <span className="text-slate-600"><strong>Ação:</strong> {insight.nextAction}</span>
                    </div>
                    {insight.deadline && (
                      <div className="flex items-start gap-2">
                        <Clock className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span className="text-slate-600"><strong>Prazo:</strong> {insight.deadline}</span>
                      </div>
                    )}
                    {insight.prediction && (
                      <div className="flex items-start gap-2">
                        <Target className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" />
                        <span className="text-slate-600"><strong>Previsão:</strong> {insight.prediction}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Métricas Avançadas */}
      {metrics && processes.length > 0 && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <BarChart3 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Média de Movimentações</p>
                <p className="text-2xl font-bold text-slate-900">{metrics.avgMovements}</p>
              </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
                style={{ width: `${Math.min(metrics.avgMovements * 5, 100)}%` }}
              />
            </div>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Processos Parados (+30d)</p>
                <p className="text-2xl font-bold text-amber-600">{metrics.staleProcesses}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {Math.round((metrics.staleProcesses / processes.length) * 100)}% do total precisam de atenção
            </p>
          </div>
          
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Building2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600">Tribunais</p>
                <p className="text-2xl font-bold text-slate-900">{Object.keys(metrics.byTribunal).length}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(metrics.byTribunal).slice(0, 3).map(([court, count]) => (
                <span key={court} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                  {court}: {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar processo..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
          >
            <option value="priority">Prioridade</option>
            <option value="recent">Mais Recente</option>
            <option value="movements">Mais Movimentações</option>
            <option value="days">Sem Movimento</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as ProcessHealthStatus | 'all')}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
          >
            <option value="all">Todos Status</option>
            {Object.entries(HEALTH_STATUS_CONFIG)
              .sort((a, b) => b[1].priority - a[1].priority)
              .map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
          </select>
          {uniqueCourts.length > 0 && (
            <select
              value={filterCourt}
              onChange={(e) => setFilterCourt(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
            >
              <option value="all">Todos Tribunais</option>
              {uniqueCourts.map((court) => (
                <option key={court} value={court}>
                  {court}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => loadData()}
            className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-all ${
              showTimeline ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <LineChart className="w-4 h-4" />
            Timeline
          </button>
        </div>
      </div>

      {/* Timeline Gráfica */}
      {showTimeline && processes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <LineChart className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Timeline de Movimentações</h3>
                <p className="text-xs text-slate-500">Últimos 30 dias de atividade</p>
              </div>
            </div>
          </div>
          
          {/* Gráfico de barras por dia */}
          <div className="mb-6">
            <div className="flex items-end gap-1 h-32">
              {(() => {
                // Calcular movimentações por dia nos últimos 30 dias
                const today = new Date();
                const days: { date: Date; count: number; processes: string[] }[] = [];
                
                for (let i = 29; i >= 0; i--) {
                  const date = new Date(today);
                  date.setDate(date.getDate() - i);
                  date.setHours(0, 0, 0, 0);
                  
                  const dayProcesses: string[] = [];
                  let count = 0;
                  
                  processes.forEach(p => {
                    if (p.last_movement_date) {
                      const movDate = new Date(p.last_movement_date);
                      movDate.setHours(0, 0, 0, 0);
                      if (movDate.getTime() === date.getTime()) {
                        count++;
                        dayProcesses.push(p.process_number);
                      }
                    }
                  });
                  
                  days.push({ date, count, processes: dayProcesses });
                }
                
                const maxCount = Math.max(...days.map(d => d.count), 1);
                
                return days.map((day, idx) => {
                  const height = day.count > 0 ? Math.max((day.count / maxCount) * 100, 8) : 4;
                  const isToday = idx === 29;
                  const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                  
                  return (
                    <div 
                      key={idx} 
                      className="flex-1 flex flex-col items-center group relative"
                    >
                      <div 
                        className={`w-full rounded-t transition-all cursor-pointer ${
                          day.count > 0 
                            ? isToday 
                              ? 'bg-indigo-500 hover:bg-indigo-600' 
                              : 'bg-blue-400 hover:bg-blue-500'
                            : isWeekend 
                              ? 'bg-slate-100' 
                              : 'bg-slate-200'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                      {/* Tooltip */}
                      {day.count > 0 && (
                        <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                          <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap">
                            <p className="font-semibold">{day.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</p>
                            <p>{day.count} movimentação{day.count > 1 ? 'ões' : ''}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            {/* Labels dos dias */}
            <div className="flex gap-1 mt-2">
              {[...Array(30)].map((_, idx) => {
                const date = new Date();
                date.setDate(date.getDate() - (29 - idx));
                const showLabel = idx === 0 || idx === 14 || idx === 29;
                return (
                  <div key={idx} className="flex-1 text-center">
                    {showLabel && (
                      <span className="text-[10px] text-slate-400">
                        {date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Resumo da Timeline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-600">
                {processes.filter(p => {
                  if (!p.last_movement_date) return false;
                  const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
                  return days <= 7;
                }).length}
              </p>
              <p className="text-xs text-slate-500">Última semana</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                {processes.filter(p => {
                  if (!p.last_movement_date) return false;
                  const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
                  return days <= 30;
                }).length}
              </p>
              <p className="text-xs text-slate-500">Último mês</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">
                {processes.filter(p => {
                  if (!p.last_movement_date) return true;
                  const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
                  return days > 30 && days <= 90;
                }).length}
              </p>
              <p className="text-xs text-slate-500">30-90 dias</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">
                {processes.filter(p => {
                  if (!p.last_movement_date) return true;
                  const days = Math.floor((Date.now() - new Date(p.last_movement_date).getTime()) / (1000 * 60 * 60 * 24));
                  return days > 90;
                }).length}
              </p>
              <p className="text-xs text-slate-500">+90 dias</p>
            </div>
          </div>
        </div>
      )}

      {/* Barra de ações em lote */}
      {selectedProcesses.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-blue-600" />
            <span className="font-medium text-blue-900">
              {selectedProcesses.size} processo{selectedProcesses.size > 1 ? 's' : ''} selecionado{selectedProcesses.size > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                selectedProcesses.forEach(id => handleAnalyzeWithAI(id));
              }}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" />
              Analisar Selecionados
            </button>
            <button
              onClick={() => {
                if (confirm(`Remover ${selectedProcesses.size} processos?`)) {
                  selectedProcesses.forEach(id => handleRemoveProcess(id));
                  setSelectedProcesses(new Set());
                }
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Remover
            </button>
            <button
              onClick={() => setSelectedProcesses(new Set())}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-300"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Process list - MODO LISTA */}
      {filteredProcesses.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Gavel className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">
            {processes.length === 0 ? 'Nenhum processo monitorado' : 'Nenhum processo encontrado'}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
            {processes.length === 0
              ? 'Comece descobrindo seus processos automaticamente pelo nome do advogado no DJEN.'
              : 'Tente ajustar os filtros de busca.'}
          </p>
          {processes.length === 0 && (
            <button
              onClick={() => setShowDiscovery(true)}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-indigo-700 inline-flex items-center gap-2 shadow-lg shadow-blue-500/25 transition-all"
            >
              <Sparkles className="w-5 h-5" />
              Descobrir Processos
            </button>
          )}
        </div>
      ) : viewMode === 'kanban' ? (
        /* MODO KANBAN */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(['critical', 'attention', 'healthy', 'archived'] as ProcessHealthStatus[]).map(status => {
            const config = HEALTH_STATUS_CONFIG[status];
            const StatusIcon = config.icon;
            const statusProcesses = filteredProcesses.filter(p => p.health_status === status);
            
            return (
              <div key={status} className={`rounded-xl border-2 ${config.borderColor} bg-white overflow-hidden`}>
                <div className={`px-4 py-3 ${config.bgColor} border-b ${config.borderColor}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusIcon className={`w-4 h-4 ${config.textColor}`} />
                      <span className={`font-semibold text-sm ${config.textColor}`}>{config.label}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${config.bgColor} ${config.textColor}`}>
                      {statusProcesses.length}
                    </span>
                  </div>
                </div>
                <div className="p-2 space-y-2 max-h-[500px] overflow-y-auto">
                  {statusProcesses.map(process => (
                    <div 
                      key={process.id}
                      onClick={() => setExpandedTimeline(expandedTimeline === process.id ? null : process.id)}
                      className="p-3 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer transition-all border border-transparent hover:border-slate-200"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-mono text-xs font-semibold text-slate-700">
                          {formatProcessNumber(process.process_number).slice(0, 15)}...
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(process.id); }}
                          className="p-1 hover:bg-white rounded"
                        >
                          {favoriteProcesses.has(process.id) ? (
                            <BookmarkCheck className="w-3.5 h-3.5 text-amber-500" />
                          ) : (
                            <Bookmark className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-2 mb-2">{process.class_name}</p>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{process.court}</span>
                        <span>{process.total_movements || 0} mov.</span>
                      </div>
                    </div>
                  ))}
                  {statusProcesses.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">Nenhum processo</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === 'cards' ? (
        /* MODO CARDS - Com paginação */
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProcesses.slice(0, visibleCount).map(process => {
            const statusConfig = HEALTH_STATUS_CONFIG[process.health_status];
            const StatusIcon = statusConfig.icon;
            const courtColor = getCourtColor(process.court);
            const isFavorite = favoriteProcesses.has(process.id);
            const isSelected = selectedProcesses.has(process.id);
            
            return (
              <div 
                key={process.id}
                className={`bg-white rounded-xl border-2 transition-all hover:shadow-lg ${
                  isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${statusConfig.bgColor} ${statusConfig.textColor}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {statusConfig.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleFavorite(process.id)}
                        className={`p-1.5 rounded-lg transition-colors ${isFavorite ? 'text-amber-500 bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                      >
                        {isFavorite ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => toggleSelection(process.id)}
                        className={`p-1.5 rounded-lg transition-colors ${isSelected ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-slate-800">
                        {formatProcessNumber(process.process_number)}
                      </span>
                      <button
                        onClick={() => copyProcessNumber(process.process_number)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded"
                        title="Copiar número"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 line-clamp-2">{process.class_name}</p>
                  </div>

                  <div className="space-y-1.5 mb-3">
                    {process.parties?.filter(p => p.pole === 'ativo').slice(0, 1).map((party, i) => (
                      <div key={`a-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">A</span>
                        <span className="text-slate-600 truncate">{party.name}</span>
                      </div>
                    ))}
                    {process.parties?.filter(p => p.pole === 'passivo').slice(0, 1).map((party, i) => (
                      <div key={`p-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-semibold">R</span>
                        <span className="text-slate-600 truncate">{party.name}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${courtColor.bg} ${courtColor.text}`}>
                      {process.court}
                    </span>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <History className="w-3.5 h-3.5" />
                        {process.total_movements || 0}
                      </span>
                      <span>
                        {process.last_movement_date 
                          ? new Date(process.last_movement_date).toLocaleDateString('pt-BR')
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => setExpandedTimeline(expandedTimeline === process.id ? null : process.id)}
                    className="text-xs text-slate-600 hover:text-blue-600 flex items-center gap-1"
                  >
                    <History className="w-3.5 h-3.5" />
                    Timeline
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleAnalyzeWithAI(process.id)}
                      disabled={analyzingProcessId === process.id}
                      className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors disabled:opacity-50"
                    >
                      {analyzingProcessId === process.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleSyncProcess(process.id)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRemoveProcess(process.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {/* Botão carregar mais */}
          {filteredProcesses.length > visibleCount && (
            <div className="text-center">
              <button
                onClick={() => setVisibleCount(prev => prev + 20)}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-all"
              >
                Carregar mais ({filteredProcesses.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </div>
      ) : (
        /* MODO LISTA (TABELA) */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <button
                      onClick={selectAll}
                      className={`p-1 rounded transition-colors ${selectedProcesses.size === filteredProcesses.length ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      {selectedProcesses.size === filteredProcesses.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Processo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Partes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Tribunal</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Mov.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Última</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProcesses.slice(0, visibleCount).map((process) => {
                  const statusConfig = HEALTH_STATUS_CONFIG[process.health_status];
                  const StatusIcon = statusConfig.icon;
                  const courtColor = getCourtColor(process.court);
                  const isAnalyzing = analyzingProcessId === process.id;
                  const isExpanded = expandedTimeline === process.id;
                  const isSelected = selectedProcesses.has(process.id);
                  const isFavorite = favoriteProcesses.has(process.id);

                  return (
                    <React.Fragment key={process.id}>
                      <tr 
                        className={`hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-blue-50/50' : ''} ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => toggleSelection(process.id)}
                              className={`p-1 rounded transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                              {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => toggleFavorite(process.id)}
                              className={`p-1 rounded transition-colors ${isFavorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'}`}
                            >
                              {isFavorite ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${statusConfig.bgColor} ${statusConfig.textColor} ${statusConfig.borderColor} border`}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {statusConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div>
                              <div className="font-mono text-xs font-semibold text-slate-800 flex items-center gap-1">
                                {formatProcessNumber(process.process_number)}
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyProcessNumber(process.process_number); }}
                                  className="p-0.5 text-slate-400 hover:text-slate-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                                {process.class_name}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5 max-w-xs">
                            {process.parties?.filter(p => p.pole === 'ativo').slice(0, 1).map((party, i) => (
                              <div key={`a-${i}`} className="flex items-center gap-1.5 text-xs">
                                <span className="font-semibold text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-[10px]">
                                  A
                                </span>
                                <span className="text-slate-600 truncate" title={party.name}>
                                  {party.name}
                                </span>
                              </div>
                            ))}
                            {process.parties?.filter(p => p.pole === 'passivo').slice(0, 1).map((party, i) => (
                              <div key={`p-${i}`} className="flex items-center gap-1.5 text-xs">
                                <span className="font-semibold text-orange-600 bg-orange-50 px-1 py-0.5 rounded text-[10px]">
                                  R
                                </span>
                                <span className="text-slate-600 truncate" title={party.name}>
                                  {party.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${courtColor.bg} ${courtColor.text}`}
                          >
                            {process.court}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-medium text-slate-700">
                            {process.total_movements || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-600">
                            {process.last_movement_date
                              ? new Date(process.last_movement_date).toLocaleDateString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: '2-digit',
                                })
                              : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {/* Indicador de cliente vinculado */}
                            {process.linked_client_id ? (
                              <div className="flex items-center gap-1 mr-2">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  process.our_client_pole === 'ativo' 
                                    ? 'bg-blue-100 text-blue-700' 
                                    : 'bg-orange-100 text-orange-700'
                                }`}>
                                  <User className="w-3 h-3" />
                                  {process.linked_client_name?.split(' ')[0] || 'Cliente'}
                                </span>
                                <button
                                  onClick={() => handleUnlinkClient(process.id)}
                                  className="p-0.5 text-slate-400 hover:text-red-500 rounded"
                                  title="Desvincular cliente"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => openLinkClientModal(process)}
                                className="p-1.5 text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                title="Vincular cliente"
                              >
                                <User className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setExpandedTimeline(isExpanded ? null : process.id)}
                              className={`p-1.5 rounded transition-colors ${isExpanded ? 'text-blue-600 bg-blue-50' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                              title="Ver timeline"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleAnalyzeWithAI(process.id)}
                              disabled={isAnalyzing}
                              className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors disabled:opacity-50"
                              title="Analisar com IA"
                            >
                              {isAnalyzing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => handleSyncProcess(process.id)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Sincronizar"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleRemoveProcess(process.id)}
                              disabled={removingProcessId === process.id}
                              className={`p-1.5 rounded transition-colors ${
                                removingProcessId === process.id
                                  ? 'text-red-400'
                                  : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title="Remover"
                            >
                              {removingProcessId === process.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      
                      {/* Timeline expandida */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="px-4 py-4 bg-slate-50">
                            <div className="max-h-64 overflow-y-auto">
                              <h4 className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                <History className="w-4 h-4" />
                                Linha do Tempo ({process.movements?.length || 0} movimentações)
                              </h4>
                              {process.movements && process.movements.length > 0 ? (
                                <div className="space-y-2">
                                  {process.movements.slice(0, 10).map((mov, idx) => (
                                    <div key={mov.id || idx} className="flex gap-3 text-xs">
                                      <div className="flex flex-col items-center">
                                        <div className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-blue-500' : 'bg-slate-300'}`} />
                                        {idx < Math.min(process.movements!.length - 1, 9) && (
                                          <div className="w-0.5 h-full bg-slate-200 mt-1" />
                                        )}
                                      </div>
                                      <div className="flex-1 pb-3">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="font-medium text-slate-800">
                                            {new Date(mov.date).toLocaleDateString('pt-BR')}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                            mov.type === 'sentenca' ? 'bg-purple-100 text-purple-700' :
                                            mov.type === 'decisao' ? 'bg-blue-100 text-blue-700' :
                                            mov.type === 'intimacao' ? 'bg-amber-100 text-amber-700' :
                                            mov.type === 'audiencia' ? 'bg-green-100 text-green-700' :
                                            'bg-slate-100 text-slate-600'
                                          }`}>
                                            {mov.title}
                                          </span>
                                        </div>
                                        <p className="text-slate-600 line-clamp-2">
                                          {mov.description || 'Sem descrição'}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                  {(process.movements?.length || 0) > 10 && (
                                    <p className="text-xs text-slate-500 text-center py-2">
                                      + {process.movements!.length - 10} movimentações anteriores
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500 text-center py-4">
                                  Nenhuma movimentação registrada
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Botão carregar mais */}
          {filteredProcesses.length > visibleCount && (
            <div className="text-center p-4 border-t border-slate-100">
              <button
                onClick={() => setVisibleCount(prev => prev + 20)}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-all"
              >
                Carregar mais ({filteredProcesses.length - visibleCount} restantes)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Contador de resultados */}
      {filteredProcesses.length > 0 && (
        <div className="text-center text-sm text-slate-500">
          Exibindo {Math.min(visibleCount, filteredProcesses.length)} de {filteredProcesses.length} processos
          {specialFilter !== 'all' && ' (filtrado)'}
        </div>
      )}

      {/* Discovery Modal */}
      {showDiscovery && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
              <div>
                <h2 className="text-xl font-bold text-slate-800">Descobrir Processos no DJEN</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Busque automaticamente processos pelo nome do advogado
                </p>
              </div>
              <button
                onClick={() => {
                  setShowDiscovery(false);
                  setDiscoveryResults([]);
                  setSyncProgress(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Search Form */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Nome do Advogado *
                    </label>
                    <input
                      type="text"
                      value={lawyerName}
                      onChange={(e) => setLawyerName(e.target.value)}
                      placeholder="Ex: João da Silva"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Período (dias)
                    </label>
                    <select
                      value={discoveryPeriod}
                      onChange={(e) => setDiscoveryPeriod(Number(e.target.value))}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg"
                    >
                      <option value={30}>Últimos 30 dias</option>
                      <option value={90}>Últimos 90 dias</option>
                      <option value={180}>Últimos 6 meses</option>
                      <option value={365}>Último ano</option>
                      <option value={730}>Últimos 2 anos</option>
                      <option value={1095}>Últimos 3 anos</option>
                      <option value={1825}>Últimos 5 anos</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleDiscoverProcesses}
                  disabled={!lawyerName.trim() || syncProgress?.status === 'searching'}
                  className="mt-4 w-full px-5 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {syncProgress?.status === 'searching' ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Buscando...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      Buscar Processos
                    </>
                  )}
                </button>
              </div>

              {/* Progress */}
              {syncProgress && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    <span className="text-sm font-medium text-blue-900">{syncProgress.message}</span>
                  </div>
                  {syncProgress.total > 0 && (
                    <div className="w-full bg-blue-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Batch Registration Progress */}
              {isRegisteringBatch && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                    <span className="text-sm font-medium text-green-900">
                      Registrando processo {batchProgress.current} de {batchProgress.total}...
                    </span>
                  </div>
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Results */}
              {discoveryResults.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-800">
                      {discoveryResults.length} processo(s) encontrado(s)
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllNew}
                        className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1"
                      >
                        <CheckSquare className="w-4 h-4" />
                        Selecionar Novos
                      </button>
                      <button
                        onClick={deselectAll}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1"
                      >
                        <Square className="w-4 h-4" />
                        Limpar
                      </button>
                      {selectedDiscoveries.size > 0 && (
                        <button
                          onClick={handleRegisterSelected}
                          disabled={isRegisteringBatch}
                          className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1 disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4" />
                          Registrar {selectedDiscoveries.size} Selecionado(s)
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {discoveryResults.map((discovery) => {
                      const isSelected = selectedDiscoveries.has(discovery.process_number);
                      const isRegistered = discovery.already_registered;

                      return (
                        <div
                          key={discovery.process_number}
                          className={`border rounded-xl p-4 transition-all ${
                            isRegistered
                              ? 'bg-slate-50 border-slate-200'
                              : isSelected
                              ? 'bg-blue-50 border-blue-300'
                              : 'bg-white border-slate-200 hover:border-blue-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {!isRegistered && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDiscoverySelection(discovery.process_number)}
                                className="mt-1 w-4 h-4 text-blue-600 rounded"
                              />
                            )}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${
                                    getCourtColor(discovery.court).bg
                                  } ${getCourtColor(discovery.court).text} ${
                                    getCourtColor(discovery.court).border
                                  }`}
                                >
                                  <Building2 className="w-3 h-3" />
                                  {discovery.court}
                                </span>
                                {isRegistered && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Já Monitorado
                                  </span>
                                )}
                              </div>
                              <h4 className="font-mono text-sm font-bold text-slate-800 mb-1">
                                {formatProcessNumber(discovery.process_number)}
                              </h4>
                              <p className="text-sm text-slate-600 mb-2">{discovery.class_name}</p>
                              <div className="space-y-1">
                                {discovery.parties.polo_ativo.slice(0, 2).map((name, i) => (
                                  <div key={`a-${i}`} className="flex items-center gap-2 text-xs">
                                    <span className="font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                      A
                                    </span>
                                    <span className="text-slate-600">{name}</span>
                                  </div>
                                ))}
                                {discovery.parties.polo_passivo.slice(0, 2).map((name, i) => (
                                  <div key={`p-${i}`} className="flex items-center gap-2 text-xs">
                                    <span className="font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                                      R
                                    </span>
                                    <span className="text-slate-600">{name}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                  <History className="w-3.5 h-3.5" />
                                  {discovery.movements_count} mov.
                                </span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  Última: {new Date(discovery.last_movement_date).toLocaleDateString('pt-BR')}
                                </span>
                              </div>
                            </div>
                            {!isRegistered && (
                              <button
                                onClick={() => handleRegisterProcess(discovery)}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-1"
                              >
                                <Plus className="w-4 h-4" />
                                Registrar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Vinculação de Cliente */}
      {showLinkClientModal && linkingProcess && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Vincular Cliente ao Processo</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {formatProcessNumber(linkingProcess.process_number)}
                  </p>
                </div>
                <button
                  onClick={() => { setShowLinkClientModal(false); setLinkingProcess(null); }}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Partes do Processo */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Partes do Processo</h3>
                <div className="space-y-2">
                  {linkingProcess.parties?.filter(p => p.pole === 'ativo').map((party, i) => (
                    <div key={`a-${i}`} className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded">AUTOR</span>
                        <span className="text-sm text-slate-700">{party.name}</span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedClientPole('ativo');
                          setClientSearchTerm(party.name);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Buscar Cliente
                      </button>
                    </div>
                  ))}
                  {linkingProcess.parties?.filter(p => p.pole === 'passivo').map((party, i) => (
                    <div key={`p-${i}`} className="flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-semibold rounded">RÉU</span>
                        <span className="text-sm text-slate-700">{party.name}</span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedClientPole('passivo');
                          setClientSearchTerm(party.name);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Buscar Cliente
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Seleção de Polo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nosso cliente é:
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedClientPole('ativo')}
                    className={`flex-1 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                      selectedClientPole === 'ativo'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <ArrowUpRight className="w-5 h-5" />
                      Autor (Polo Ativo)
                    </div>
                  </button>
                  <button
                    onClick={() => setSelectedClientPole('passivo')}
                    className={`flex-1 py-3 px-4 rounded-xl border-2 font-medium transition-all ${
                      selectedClientPole === 'passivo'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <ArrowDownRight className="w-5 h-5" />
                      Réu (Polo Passivo)
                    </div>
                  </button>
                </div>
              </div>

              {/* Busca de Cliente */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Buscar Cliente Existente
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={clientSearchTerm}
                    onChange={(e) => setClientSearchTerm(e.target.value)}
                    placeholder="Digite o nome, CPF/CNPJ ou email..."
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Lista de Clientes */}
              <div className="space-y-2 max-h-[250px] overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">
                      {clientSearchTerm ? 'Nenhum cliente encontrado' : 'Digite para buscar clientes'}
                    </p>
                    {clientSearchTerm && (
                      <button
                        onClick={() => handleCreateClientFromParty(clientSearchTerm)}
                        className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 inline-flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Cadastrar Novo Cliente
                      </button>
                    )}
                  </div>
                ) : (
                  filteredClients.map((client) => (
                    <div
                      key={client.id}
                      onClick={() => handleLinkClient(client.id, client.full_name)}
                      className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold">
                          {client.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{client.full_name}</p>
                          <p className="text-xs text-slate-500">
                            {client.cpf_cnpj || client.email || 'Sem documento'}
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </div>
                  ))
                )}
              </div>

              {/* Opção de criar novo cliente */}
              {filteredClients.length > 0 && (
                <div className="pt-4 border-t border-slate-200">
                  <button
                    onClick={() => handleCreateClientFromParty(clientSearchTerm || '')}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-green-400 hover:text-green-600 hover:bg-green-50 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Cadastrar Novo Cliente
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criar Novo Cliente */}
      {showCreateClientModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Plus className="w-6 h-6 text-green-600" />
                  Cadastrar Novo Cliente
                </h2>
                <button
                  onClick={() => {
                    setShowCreateClientModal(false);
                    setNewClientName('');
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nome do cliente..."
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  autoFocus
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-700">
                  <strong>Dica:</strong> O cliente será criado com os dados básicos. 
                  Você pode completar as informações depois no módulo de Clientes.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowCreateClientModal(false);
                    setNewClientName('');
                  }}
                  className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmCreateClient}
                  disabled={!newClientName.trim()}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Criar Cliente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
