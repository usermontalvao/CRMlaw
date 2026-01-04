import React, { useState, useEffect } from 'react';
import {
  Clock,
  FileText,
  Bell,
  Scale,
  Gavel,
  MessageSquare,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Building2,
} from 'lucide-react';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';

interface ProcessTimelineInlineProps {
  processCode: string;
  processId?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFullTimeline?: () => void;
}

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

const getEventColors = (type: TimelineEvent['type']) => {
  switch (type) {
    case 'intimacao':
      return {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        ring: 'ring-blue-200/60',
      };
    case 'citacao':
      return {
        bg: 'bg-purple-100',
        text: 'text-purple-700',
        ring: 'ring-purple-200/60',
      };
    case 'despacho':
      return {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        ring: 'ring-slate-200/60',
      };
    case 'sentenca':
      return {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        ring: 'ring-emerald-200/60',
      };
    case 'decisao':
      return {
        bg: 'bg-amber-100',
        text: 'text-amber-800',
        ring: 'ring-amber-200/60',
      };
    case 'recurso':
      return {
        bg: 'bg-orange-100',
        text: 'text-orange-800',
        ring: 'ring-orange-200/60',
      };
    default:
      return {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        ring: 'ring-slate-200/60',
      };
  }
};

const getUrgencyBadge = (urgency?: string) => {
  switch (urgency) {
    case 'critica': return 'bg-red-100 text-red-700 border-red-200';
    case 'alta': return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'media': return 'bg-amber-100 text-amber-700 border-amber-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const getOrgaoLabel = (event: TimelineEvent) => {
  const orgao = (event.orgao || '').trim();
  const grau = (event.grauRecursal || '').trim();
  if (!orgao && !grau) return null;
  if (orgao && grau) return `${orgao} • ${grau}`;
  return orgao || grau;
};

export const ProcessTimelineInline: React.FC<ProcessTimelineInlineProps> = ({
  processCode,
  processId,
  isExpanded,
  onToggle,
  onOpenFullTimeline,
}) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isExpanded && !hasLoaded && processCode) {
      loadTimeline();
    }
  }, [isExpanded, processCode, hasLoaded]);

  const loadTimeline = async (forceRefresh: boolean = false) => {
    try {
      setLoading(true);
      setError(null);

      // Tentar cache primeiro
      const cached = processTimelineService.getCachedTimeline(processCode);
      if (cached && cached.length > 0 && !forceRefresh) {
        setEvents(cached.slice(0, 6)); // Mostrar apenas os mais recentes
        setHasLoaded(true);
        setLoading(false);
        return;
      }

      // Buscar do banco/API
      if (processId) {
        const data = await processTimelineService.fetchTimelineFromDatabase(processId, processCode);
        if (data.length > 0) {
          setEvents(data.slice(0, 6));
          setHasLoaded(true);
          setLoading(false);
          return;
        }
      }

      // Fallback para DJEN direto
      const data = await processTimelineService.fetchProcessTimeline(processCode);
      setEvents(data.slice(0, 6));
      setHasLoaded(true);
    } catch (err: any) {
      setError('Erro ao carregar timeline');
      console.error('Erro timeline inline:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleEvent = (id: string) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!isExpanded) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 mt-2 bg-gradient-to-r from-orange-50 to-amber-50 hover:from-orange-100 hover:to-amber-100 border border-orange-200 rounded-xl text-xs font-semibold text-orange-700 transition-all"
      >
        <Clock className="w-3.5 h-3.5" />
        Ver Linha do Tempo
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-orange-100 pt-3" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-sm">
            <Clock className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-bold text-slate-800">Linha do Tempo</div>
            <div className="text-[10px] text-slate-500 font-mono truncate max-w-[180px]">{processCode}</div>
          </div>
          {events.length > 0 && (
            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-medium rounded">
              {events.length} mov.
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadTimeline(true)}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:bg-white/60 rounded-lg transition disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onOpenFullTimeline && events.length > 0 && (
            <button
              onClick={onOpenFullTimeline}
              className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg transition"
              title="Ver timeline completa"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
          <span className="ml-2 text-xs text-slate-500">Carregando...</span>
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-4 px-3 bg-red-50 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <span className="text-xs text-red-600">{error}</span>
        </div>
      ) : events.length === 0 ? (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <FileText className="w-4 h-4 mr-2" />
          <span className="text-xs">Nenhuma movimentação encontrada</span>
        </div>
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {events.map((event, index) => {
            const Icon = getEventIcon(event.type);
            const colors = getEventColors(event.type);
            const isLast = index === events.length - 1;
            const orgaoLabel = getOrgaoLabel(event);
            const isOpen = expandedEventIds.has(event.id);
            const description = (event.aiAnalysis?.summary || event.title || '').trim();
            const extra = (event.description || '').trim();
            const showExtraToggle = extra.length > 0;

            return (
              <div key={event.id} className="relative flex gap-3 group">
                {/* Timeline line */}
                {!isLast && (
                  <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-200" />
                )}

                {/* Icon */}
                <div
                  className={`relative z-10 flex-shrink-0 w-7 h-7 rounded-2xl flex items-center justify-center ${colors.bg} ${colors.text} ring-2 ring-white ${colors.ring} shadow-sm`}
                >
                  <Icon className="w-3 h-3" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleEvent(event.id)}
                        className="w-full text-left rounded-lg hover:bg-white/60 transition px-2 py-1 -mx-2"
                        title={showExtraToggle ? (isOpen ? 'Recolher detalhes' : 'Expandir detalhes') : undefined}
                      >
                        <p className={`text-xs font-semibold text-slate-800 ${isOpen ? '' : 'line-clamp-2'}`}>
                          {description}
                        </p>
                        {orgaoLabel && (
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                            <Building2 className="w-3 h-3" />
                            <span className="truncate">{orgaoLabel}</span>
                          </div>
                        )}
                        <div className="flex items-center flex-wrap gap-2 mt-1">
                          <span className="text-[10px] text-slate-500">
                            {formatDateTime(event.date)}
                          </span>
                          {event.aiAnalysis?.urgency && event.aiAnalysis.urgency !== 'baixa' && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${getUrgencyBadge(event.aiAnalysis.urgency)}`}>
                              {event.aiAnalysis.urgency === 'critica' && <AlertTriangle className="w-2.5 h-2.5" />}
                              {event.aiAnalysis.urgency.charAt(0).toUpperCase() + event.aiAnalysis.urgency.slice(1)}
                            </span>
                          )}
                          {event.aiAnalysis?.actionRequired && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                              <Sparkles className="w-2.5 h-2.5" />
                              Ação
                            </span>
                          )}
                          {showExtraToggle && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white text-slate-600 border border-slate-200">
                              {isOpen ? 'Recolher' : 'Detalhes'}
                              {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </span>
                          )}
                        </div>
                        {isOpen && extra && (
                          <div className="mt-2 text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                            {extra}
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Ver mais */}
          {onOpenFullTimeline && (
            <button
              onClick={onOpenFullTimeline}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Ver timeline completa com IA
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProcessTimelineInline;
