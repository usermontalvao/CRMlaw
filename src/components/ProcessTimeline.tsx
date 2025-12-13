import React, { useState, useEffect } from 'react';
import {
  Clock,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Scale,
  Gavel,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  RefreshCw,
  Calendar,
  AlertCircle,
  Zap,
  Target,
  TrendingUp,
  Flag,
  X,
  Filter,
  Search,
  Bell,
  Eye,
  CalendarPlus,
  Timer,
  ClipboardList,
  ExternalLink,
  Users,
} from 'lucide-react';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';

interface ProcessTimelineProps {
  processCode: string;
  processId?: string;
  clientName?: string;
  onClose: () => void;
  onStatusUpdated?: (newStatus: string) => void;
  onAddDeadline?: (event: TimelineEvent) => void;
  onAddAppointment?: (event: TimelineEvent) => void;
  onAddToCalendar?: (event: TimelineEvent) => void;
}

// Estágios do processo com detecção inteligente
const PROCESS_STAGES = [
  { key: 'distribuicao', label: 'Distribuição', icon: Target },
  { key: 'citacao', label: 'Citação', icon: MessageSquare },
  { key: 'conciliacao', label: 'Conciliação', icon: Users },
  { key: 'contestacao', label: 'Contestação', icon: FileText },
  { key: 'instrucao', label: 'Instrução', icon: Scale },
  { key: 'sentenca', label: 'Sentença', icon: Gavel },
  { key: 'recurso', label: 'Recurso', icon: TrendingUp },
  { key: 'transito', label: 'Trânsito', icon: CheckCircle2 },
  { key: 'execucao', label: 'Execução', icon: Flag },
];

const EVENT_TYPES = [
  { key: 'todos', label: 'Todos' },
  { key: 'intimacao', label: 'Intimações' },
  { key: 'citacao', label: 'Citações' },
  { key: 'despacho', label: 'Despachos' },
  { key: 'sentenca', label: 'Sentenças' },
  { key: 'decisao', label: 'Decisões' },
  { key: 'recurso', label: 'Recursos' },
];

const GRAU_RECURSAL = [
  { key: 'todos', label: 'Todos os Graus' },
  { key: '1º Grau', label: '1º Grau' },
  { key: '2º Grau', label: '2º Grau' },
  { key: 'TRT', label: 'TRT' },
  { key: 'TST', label: 'TST' },
  { key: 'STJ', label: 'STJ' },
  { key: 'STF', label: 'STF' },
  { key: 'Turma Recursal', label: 'Turma Recursal' },
];

const getEventTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    intimacao: 'Intimação',
    citacao: 'Citação',
    despacho: 'Despacho',
    sentenca: 'Sentença',
    decisao: 'Decisão',
    recurso: 'Recurso',
    outro: 'Outro',
  };
  return labels[type] || type;
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    nao_protocolado: 'Não Protocolado',
    aguardando_confeccao: 'Aguardando Confecção',
    distribuido: 'Distribuído',
    andamento: 'Em Andamento',
    sentenca: 'Sentença',
    cumprimento: 'Cumprimento',
    arquivado: 'Arquivado',
  };
  return labels[status] || status;
};

const getEventIcon = (type: TimelineEvent['type']) => {
  switch (type) {
    case 'intimacao': return Bell;
    case 'citacao': return MessageSquare;
    case 'despacho': return FileText;
    case 'sentenca': return Gavel;
    case 'decisao': return Scale;
    case 'recurso': return TrendingUp;
    default: return Clock;
  }
};

const getEventColor = (type: TimelineEvent['type']) => {
  switch (type) {
    case 'intimacao': return 'blue';
    case 'citacao': return 'purple';
    case 'despacho': return 'slate';
    case 'sentenca': return 'emerald';
    case 'decisao': return 'amber';
    default: return 'slate';
  }
};

const getUrgencyColor = (urgency?: string) => {
  switch (urgency) {
    case 'critica': return 'bg-red-500';
    case 'alta': return 'bg-orange-500';
    case 'media': return 'bg-amber-500';
    default: return 'bg-slate-400';
  }
};

const getUrgencyLabel = (urgency?: string) => {
  switch (urgency) {
    case 'critica': return 'Crítica';
    case 'alta': return 'Alta';
    case 'media': return 'Média';
    default: return 'Baixa';
  }
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return 'Data não informada';
  
  try {
    // Tentar diferentes formatos de data
    let date: Date;
    
    // Formato ISO: 2025-12-10T00:00:00
    if (dateStr.includes('T')) {
      date = new Date(dateStr);
    }
    // Formato: 2025-12-10
    else if (dateStr.includes('-') && dateStr.length >= 10) {
      const parts = dateStr.split('-');
      date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    // Formato: 10/12/2025
    else if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts[2].length === 4) {
        date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      }
    }
    else {
      date = new Date(dateStr);
    }

    // Verificar se a data é válida
    if (isNaN(date.getTime())) {
      return dateStr || 'Data não informada';
    }

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr || 'Data não informada';
  }
};

const detectCurrentStage = (events: TimelineEvent[]): number => {
  // Estágios: 0=Distribuição, 1=Citação, 2=Conciliação, 3=Contestação, 4=Instrução, 5=Sentença, 6=Recurso, 7=Trânsito, 8=Execução
  const eventTypes = events.map(e => e.type);
  const titles = events.map(e => e.title.toLowerCase());
  const descriptions = events.map(e => (e.description || '').toLowerCase());
  
  // Prioridade: verificar tipos de eventos primeiro
  if (eventTypes.includes('recurso')) return 6;
  if (eventTypes.includes('sentenca')) return 5;
  if (eventTypes.includes('citacao')) return 1;
  
  // Fallback: verificar títulos com padrões mais específicos
  const hasRecurso = titles.some(t => 
    t.includes('recurso interposto') || 
    t.includes('apelação') || 
    t.includes('agravo de instrumento') ||
    t.includes('embargos de declaração') ||
    t.includes('recurso especial') ||
    t.includes('recurso extraordinário')
  );
  if (hasRecurso) return 6;
  
  const hasSentenca = titles.some(t => 
    t.includes('sentença proferida') || 
    t.includes('sentença homologatória') ||
    t.includes('julgamento procedente') ||
    t.includes('julgamento improcedente')
  );
  if (hasSentenca) return 5;
  
  // Detectar audiência de instrução (estágio 4)
  const hasAudienciaInstrucao = titles.some(t => 
    t.includes('audiência de instrução') ||
    t.includes('audiência instrutória')
  );
  if (hasAudienciaInstrucao) return 4;
  
  // Detectar contestação (estágio 3)
  const hasContestacao = titles.some(t => 
    t.includes('contestação') || 
    t.includes('defesa apresentada')
  );
  if (hasContestacao) return 3;
  
  // Detectar audiência de conciliação (estágio 2)
  const hasConciliacao = titles.some(t => 
    t.includes('audiência de conciliação') ||
    t.includes('audiência designada') ||
    t.includes('conciliação virtual') ||
    t.includes('conciliação designada')
  ) || descriptions.some(d =>
    d.includes('audiência de conciliação') ||
    d.includes('conciliação virtual')
  );
  if (hasConciliacao) return 2;
  
  // Detectar citação (estágio 1)
  const hasCitacao = titles.some(t => 
    t.includes('citação') || 
    t.includes('citado')
  );
  if (hasCitacao) return 1;
  
  // Se tem intimação com audiência designada, provavelmente é conciliação
  const hasIntimacaoAudiencia = eventTypes.includes('intimacao') && 
    (titles.some(t => t.includes('audiência')) || descriptions.some(d => d.includes('audiência')));
  if (hasIntimacaoAudiencia) return 2;
  
  // Se tem despacho, provavelmente está em instrução
  if (eventTypes.includes('despacho')) return 4;
  
  // Se tem intimação genérica, provavelmente está em instrução
  if (eventTypes.includes('intimacao')) return 4;
  
  return 0; // Distribuição
};

// Função para limpar tags HTML do conteúdo
const cleanHtmlContent = (content: string): string => {
  if (!content) return '';
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const ProcessTimeline: React.FC<ProcessTimelineProps> = ({ 
  processCode, 
  processId, 
  clientName, 
  onClose, 
  onStatusUpdated,
  onAddDeadline,
  onAddAppointment,
  onAddToCalendar,
}) => {
  const [statusUpdated, setStatusUpdated] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [currentStage, setCurrentStage] = useState(0);
  const [filterType, setFilterType] = useState('todos');
  const [filterGrau, setFilterGrau] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);

  // Buscar e analisar automaticamente
  const fetchAndAnalyze = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Buscar e analisar automaticamente com IA
      setAnalyzing(true);
      const data = await processTimelineService.fetchAndAnalyzeTimeline(
        processCode,
        (current, total) => setAnalyzeProgress({ current, total })
      );
      setEvents(data);
      setCurrentStage(detectCurrentStage(data));

      // Atualizar status do processo automaticamente se tiver processId
      if (processId && data.length > 0) {
        const newStatus = await processTimelineService.autoUpdateProcessStatus(processId, data);
        if (newStatus) {
          setStatusUpdated(newStatus);
          onStatusUpdated?.(newStatus);
        }
      }
    } catch (err: any) {
      // Se falhar a análise, tentar apenas buscar
      try {
        const data = await processTimelineService.fetchProcessTimeline(processCode);
        setEvents(data);
        setCurrentStage(detectCurrentStage(data));

        // Tentar atualizar status mesmo sem análise IA
        if (processId && data.length > 0) {
          const newStatus = await processTimelineService.autoUpdateProcessStatus(processId, data);
          if (newStatus) {
            setStatusUpdated(newStatus);
            onStatusUpdated?.(newStatus);
          }
        }
      } catch (innerErr: any) {
        setError(innerErr.message || 'Erro ao carregar timeline');
      }
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const refreshTimeline = async () => {
    setLoading(true);
    setAnalyzing(true);
    try {
      const data = await processTimelineService.fetchAndAnalyzeTimeline(
        processCode,
        (current, total) => setAnalyzeProgress({ current, total })
      );
      setEvents(data);
      setCurrentStage(detectCurrentStage(data));
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchAndAnalyze();
  }, [processCode]);

  const toggleExpand = (id: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filtrar eventos
  const filteredEvents = events.filter(event => {
    const matchesType = filterType === 'todos' || event.type === filterType;
    const matchesGrau = filterGrau === 'todos' || event.grauRecursal === filterGrau;
    const matchesSearch = !searchTerm || 
      event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      event.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesGrau && matchesSearch;
  });

  // Contadores
  const urgentCount = events.filter(e => e.aiAnalysis?.urgency === 'critica' || e.aiAnalysis?.urgency === 'alta').length;
  const actionCount = events.filter(e => e.aiAnalysis?.actionRequired).length;

  // Resumo por tipo de movimentação
  const eventTypeCounts = {
    intimacao: events.filter(e => e.type === 'intimacao').length,
    decisao: events.filter(e => e.type === 'decisao').length,
    despacho: events.filter(e => e.type === 'despacho').length,
    sentenca: events.filter(e => e.type === 'sentenca').length,
    citacao: events.filter(e => e.type === 'citacao').length,
    recurso: events.filter(e => e.type === 'recurso').length,
    outro: events.filter(e => e.type === 'outro').length,
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden w-[92vw] max-w-6xl max-h-[90vh] min-h-[500px] flex flex-col">
      {/* Barra laranja do topo */}
      <div className="h-1 w-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500" />
      
      {/* Header compacto */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Clock className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Linha do Tempo</h2>
            <p className="text-xs text-slate-500 truncate max-w-[400px]">{clientName} • <span className="font-mono">{processCode}</span></p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Estágios - Linha completa abaixo do header */}
      <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Estágio do Processo</p>
          <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-orange-100 text-orange-700">{currentStage + 1}/{PROCESS_STAGES.length} • {PROCESS_STAGES[currentStage]?.label}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          {PROCESS_STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const isActive = index <= currentStage;
            const isCurrent = index === currentStage;
            return (
              <div key={stage.key} className="flex-1 flex flex-col items-center" title={stage.label}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  isCurrent 
                    ? 'bg-orange-500 text-white ring-2 ring-orange-300 shadow-lg shadow-orange-500/30' 
                    : isActive 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-white dark:bg-zinc-700 text-slate-400 border border-slate-200 dark:border-zinc-600'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`mt-1.5 text-[10px] font-semibold text-center ${
                  isCurrent ? 'text-orange-600' : isActive ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Layout em 2 colunas */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Coluna Esquerda - Resumo e Filtros */}
        <div className="w-full md:w-[260px] flex-shrink-0 md:border-r border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 overflow-y-auto p-3 space-y-3">

          {/* Status Updated */}
          {statusUpdated && (
            <div className="px-2 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <p className="text-xs text-emerald-700">Status: <strong>{getStatusLabel(statusUpdated)}</strong></p>
            </div>
          )}

          {/* Filtros compactos */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg border border-slate-200 dark:border-zinc-700 p-3">
            <p className="text-xs font-semibold text-slate-700 dark:text-white mb-2">Filtros</p>
            
            <div className="flex flex-wrap gap-1 mb-2">
              {eventTypeCounts.intimacao > 0 && (
                <button onClick={() => setFilterType(filterType === 'intimacao' ? 'todos' : 'intimacao')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition ${filterType === 'intimacao' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
                  <Bell className="w-3 h-3" /> {eventTypeCounts.intimacao}
                </button>
              )}
              {eventTypeCounts.decisao > 0 && (
                <button onClick={() => setFilterType(filterType === 'decisao' ? 'todos' : 'decisao')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition ${filterType === 'decisao' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                  <Scale className="w-3 h-3" /> {eventTypeCounts.decisao}
                </button>
              )}
              {eventTypeCounts.despacho > 0 && (
                <button onClick={() => setFilterType(filterType === 'despacho' ? 'todos' : 'despacho')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition ${filterType === 'despacho' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                  <FileText className="w-3 h-3" /> {eventTypeCounts.despacho}
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar..."
                  className="w-full pl-7 pr-2 py-1.5 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-orange-500" />
              </div>
              <select value={filterGrau} onChange={(e) => setFilterGrau(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-md text-xs">
                {GRAU_RECURSAL.map((grau) => (<option key={grau.key} value={grau.key}>{grau.label}</option>))}
              </select>
            </div>

            <div className="mt-2 flex items-center gap-1">
              <span className="flex-1 text-center py-1 rounded bg-slate-100 text-xs text-slate-600"><strong>{events.length}</strong> mov.</span>
              {urgentCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-xs text-red-700">
                  <AlertTriangle className="w-3 h-3" />
                  {urgentCount}
                </span>
              )}
            </div>

            <button
              onClick={refreshTimeline}
              disabled={loading}
              className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold transition disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {analyzing ? `${analyzeProgress.current}/${analyzeProgress.total}` : 'Atualizar'}
            </button>
          </div>

          {/* Resumos - Colapsável */}
          <button
            onClick={() => setShowSummaryDetails(!showSummaryDetails)}
            className="w-full flex items-center justify-between px-2 py-1.5 bg-white dark:bg-zinc-800 rounded-lg border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 transition text-[10px] font-medium text-slate-600"
          >
            {showSummaryDetails ? 'Ocultar detalhes' : 'Ver detalhes'}
            {showSummaryDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

            {showSummaryDetails && (
            <div className="space-y-2 mt-2">
              {/* Resumo de Decisões */}
              {eventTypeCounts.decisao > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Scale className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">Decisões ({eventTypeCounts.decisao})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'decisao').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                        <span className="text-amber-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-amber-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Resumo de Sentenças */}
              {eventTypeCounts.sentenca > 0 && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Gavel className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Sentenças ({eventTypeCounts.sentenca})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'sentenca').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-1.5">
                        <span className="text-emerald-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-emerald-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Resumo de Intimações */}
              {eventTypeCounts.intimacao > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Bell className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-800 dark:text-blue-200">Intimações ({eventTypeCounts.intimacao})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'intimacao').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                        <span className="text-blue-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-blue-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                    {eventTypeCounts.intimacao > 3 && (
                      <li className="text-[10px] text-blue-500 italic pl-3">
                        + {eventTypeCounts.intimacao - 3} mais intimações...
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Resumo de Despachos */}
              {eventTypeCounts.despacho > 0 && (
                <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <FileText className="w-4 h-4 text-slate-600" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Despachos ({eventTypeCounts.despacho})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'despacho').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-1.5">
                        <span className="text-slate-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-slate-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                    {eventTypeCounts.despacho > 3 && (
                      <li className="text-[10px] text-slate-500 italic pl-3">
                        + {eventTypeCounts.despacho - 3} mais despachos...
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Resumo de Recursos */}
              {eventTypeCounts.recurso > 0 && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <TrendingUp className="w-4 h-4 text-orange-600" />
                    <span className="text-xs font-semibold text-orange-800 dark:text-orange-200">Recursos ({eventTypeCounts.recurso})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'recurso').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-orange-700 dark:text-orange-300 flex items-start gap-1.5">
                        <span className="text-orange-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-orange-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Resumo de Citações */}
              {eventTypeCounts.citacao > 0 && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <MessageSquare className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-semibold text-purple-800 dark:text-purple-200">Citações ({eventTypeCounts.citacao})</span>
                  </div>
                  <ul className="space-y-1">
                    {events.filter(e => e.type === 'citacao').slice(0, 3).map((e, i) => (
                      <li key={i} className="text-xs text-purple-700 dark:text-purple-300 flex items-start gap-1.5">
                        <span className="text-purple-400 mt-0.5">•</span>
                        <span className="line-clamp-1">
                          {e.aiAnalysis?.summary || e.title}
                        </span>
                        <span className="text-purple-500 text-[10px] flex-shrink-0">({formatDate(e.date)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            )}
        </div>

        {/* Coluna Direita - Lista de Movimentações */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 dark:bg-zinc-950">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-orange-500 animate-spin mb-4" />
            <p className="text-slate-600 font-medium">
              {analyzing ? 'Analisando movimentações com IA...' : 'Carregando movimentações...'}
            </p>
            {analyzing && analyzeProgress.total > 0 && (
              <p className="text-slate-400 text-sm mt-1">
                {analyzeProgress.current} de {analyzeProgress.total}
              </p>
            )}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="w-10 h-10 text-amber-500 mb-4" />
            <p className="text-slate-600 font-medium">{error}</p>
            <button
              onClick={fetchAndAnalyze}
              className="mt-4 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition"
            >
              Tentar novamente
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Clock className="w-10 h-10 text-slate-300 mb-4" />
            <p className="text-slate-500">Nenhuma movimentação encontrada</p>
            <p className="text-slate-400 text-sm mt-1">O processo pode não ter publicações no DJEN</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Filter className="w-10 h-10 text-slate-300 mb-4" />
            <p className="text-slate-500">Nenhum resultado para o filtro</p>
            <button
              onClick={() => { setFilterType('todos'); setFilterGrau('todos'); setSearchTerm(''); }}
              className="mt-3 text-orange-600 hover:text-orange-700 text-sm font-medium"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-orange-400 via-slate-300 to-transparent" />

            {/* Events */}
            <div className="space-y-3">
              {filteredEvents.map((event, index) => {
                const Icon = getEventIcon(event.type);
                const color = getEventColor(event.type);
                const isExpanded = expandedEvents.has(event.id);
                const hasAI = !!event.aiAnalysis;
                const isLatest = index === 0; // Primeiro evento é o mais recente

                const getBgColor = () => {
                  if (isLatest) return 'bg-gradient-to-r from-orange-50 to-amber-50 border-orange-300 ring-2 ring-orange-200';
                  if (hasAI && event.aiAnalysis?.urgency === 'critica') return 'bg-red-50 border-red-200';
                  if (hasAI && event.aiAnalysis?.urgency === 'alta') return 'bg-orange-50 border-orange-200';
                  if (event.type === 'sentenca') return 'bg-emerald-50 border-emerald-200';
                  return 'bg-white border-slate-200';
                };

                const getDotColor = () => {
                  if (isLatest) return 'bg-orange-500 ring-4 ring-orange-200 animate-pulse';
                  if (hasAI && event.aiAnalysis?.urgency === 'critica') return 'bg-red-500';
                  if (hasAI && event.aiAnalysis?.urgency === 'alta') return 'bg-orange-500';
                  if (event.type === 'intimacao') return 'bg-blue-500';
                  if (event.type === 'citacao') return 'bg-purple-500';
                  if (event.type === 'sentenca') return 'bg-emerald-500';
                  if (event.type === 'decisao') return 'bg-amber-500';
                  return 'bg-slate-400';
                };

                return (
                  <div key={event.id} className="relative pl-14">
                    {/* "Estamos aqui" indicator for latest event */}
                    {isLatest && (
                      <div className="absolute left-0 top-3 z-10">
                        <span className="inline-flex items-center gap-1 bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-lg">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                          ATUAL
                        </span>
                      </div>
                    )}

                    {/* Timeline dot */}
                    <div
                      className={`absolute left-4 w-5 h-5 rounded-full border-2 border-white shadow flex items-center justify-center ${getDotColor()}`}
                      style={{ top: '1.25rem' }}
                    >
                      <Icon className="w-2.5 h-2.5 text-white" />
                    </div>

                    {/* Event card */}
                    <div className={`rounded-xl border transition-all hover:shadow-lg ${getBgColor()}`}>
                      {/* Card header */}
                      <div
                        className="p-4 cursor-pointer"
                        onClick={() => toggleExpand(event.id)}
                      >
                        {/* Top row: badges + date */}
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase bg-slate-800 text-white">
                              {getEventTypeLabel(event.type)}
                            </span>
                            {event.grauRecursal && (
                              <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-100 text-indigo-700">
                                {event.grauRecursal}
                              </span>
                            )}
                            {hasAI && (
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${getUrgencyColor(event.aiAnalysis?.urgency)} text-white`}>
                                <Sparkles className="w-3 h-3" />
                                {getUrgencyLabel(event.aiAnalysis?.urgency)}
                              </span>
                            )}
                            {hasAI && event.aiAnalysis?.actionRequired && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-red-600 text-white">
                                <AlertTriangle className="w-3 h-3" />
                                Ação
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium flex-shrink-0">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDate(event.date)}
                          </div>
                        </div>

                        {/* Title + Órgão row */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {event.orgao && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 truncate">
                                {event.orgao}
                              </p>
                            )}
                            <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-2">
                              {event.title === 'Notificação' || event.title === 'Intimação' || event.title === 'Despacho' 
                                ? (event.description?.substring(0, 80)?.replace(/<[^>]*>/g, '')?.trim() + '...' || event.title)
                                : event.title}
                            </h3>
                          </div>
                          <button className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition flex-shrink-0">
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                        </div>
                        {/* AI Summary */}
                        {hasAI && event.aiAnalysis?.summary && (
                          <div className="mt-3 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-100 dark:border-purple-800">
                            <p className="text-sm text-purple-900 dark:text-purple-100 flex items-start gap-2">
                              <Sparkles className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                              <span>{event.aiAnalysis.summary}</span>
                            </p>
                          </div>
                        )}

                        {/* AI Key Points (collapsed) */}
                        {hasAI && event.aiAnalysis?.keyPoints && event.aiAnalysis.keyPoints.length > 0 && !isExpanded && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {event.aiAnalysis.keyPoints.slice(0, 3).map((point, i) => (
                              <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-300 text-xs font-medium">
                                • {point}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-slate-100 dark:border-zinc-800">
                          {hasAI && event.aiAnalysis?.keyPoints && event.aiAnalysis.keyPoints.length > 0 && (
                            <div className="mt-4">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pontos Importantes</p>
                              <ul className="space-y-2">
                                {event.aiAnalysis.keyPoints.map((point, i) => (
                                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    {point}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="mt-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Conteúdo Completo</p>
                            <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 max-h-64 overflow-y-auto border border-slate-200 dark:border-zinc-700">
                              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                                {cleanHtmlContent(event.description) || 'Conteúdo não disponível'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Ações Rápidas - Fixas no rodapé do card */}
                      <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border-t border-slate-200 dark:border-zinc-700 rounded-b-xl">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddDeadline?.(event);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-semibold transition"
                          >
                            <Timer className="w-3.5 h-3.5" />
                            Prazo
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddAppointment?.(event);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-semibold transition"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            Compromisso
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToCalendar?.(event);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-semibold transition"
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                            Calendário
                          </button>
                          {event.rawData?.link && (
                            <a
                              href={event.rawData.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              DJEN
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Footer */}
      {events.length > 0 && (
        <div className="px-6 py-4 bg-white dark:bg-zinc-900 border-t border-slate-200 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Dados do DJEN • Última publicação: {formatDate(events[0]?.date || '')}
            </p>
            <p className="text-xs text-slate-400">
              {filteredEvents.length} de {events.length} exibidas
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessTimeline;
