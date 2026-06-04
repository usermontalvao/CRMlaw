import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Layers,
} from 'lucide-react';
import { matchesNormalizedSearch } from '../utils/search';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';
import { processService } from '../services/process.service';
import type { ProcessStatus } from '../types/process.types';
import { events as globalEvents, SYSTEM_EVENTS } from '../utils/events';
import { fetchDatajudMovimentos, categorizarMovimento, getTribunalNome, type DatajudComplemento } from '../services/datajud.service';
import { supabase } from '../config/supabase';

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

// Mapeamento de estágio detectado → ProcessStatus (usado para sincronizar badge do detalhe)
const STAGE_KEY_TO_STATUS: Record<string, ProcessStatus> = {
  distribuicao: 'distribuido',
  citacao: 'citacao',
  conciliacao: 'conciliacao',
  contestacao: 'contestacao',
  instrucao: 'instrucao',
  sentenca: 'sentenca',
  recurso: 'recurso',
  transito: 'andamento',
  execucao: 'cumprimento',
};

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
  { key: 'prazo', label: 'Prazos' },
  { key: 'compromisso', label: 'Compromissos' },
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
    prazo: 'Prazo',
    compromisso: 'Compromisso',
  };
  return labels[type] || type;
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    nao_protocolado: 'Não Protocolado',
    aguardando_confeccao: 'Aguardando Confecção',
    distribuido: 'Distribuído',
    citacao: 'Citação',
    conciliacao: 'Conciliação',
    contestacao: 'Contestação',
    instrucao: 'Instrução',
    andamento: 'Em Andamento',
    sentenca: 'Sentença',
    recurso: 'Recurso',
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
    case 'prazo': return Timer;
    case 'compromisso': return CalendarPlus;
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
    case 'prazo': return 'orange';
    case 'compromisso': return 'teal';
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
  const graus = events.map(e => e.grauRecursal || '');

  // Fase recursal: grau recursal indica instância superior (Turma Recursal = JE 2ª inst, TRT/TST = trabalhista, STJ/STF)
  const GRAUS_RECURSO = ['Turma Recursal', 'STJ', 'STF', 'TST', 'TRT'];
  const hasGrauRecurso = graus.some(g => GRAUS_RECURSO.includes(g));
  if (hasGrauRecurso || eventTypes.includes('recurso')) return 6;

  // Fase de EXECUÇÃO / CUMPRIMENTO (estágio 8) — vem DEPOIS da sentença na
  // cronologia, então é verificada antes do retorno de "sentença". Detecta
  // quando a parte vira Exequente e há intimação para executar/receber o crédito.
  // (Inclui intimação de "interesse processual" + "demonstrativo do débito",
  // típica de pós-trânsito em julgado, mesmo sem ordem de bloqueio.)
  const execText = [...titles, ...descriptions].join(' ');
  const hasExecucao =
    execText.includes('exequente') ||
    execText.includes('cumprimento de sentença') ||
    execText.includes('cumprimento de sentenca') ||
    execText.includes('fase de cumprimento') ||
    execText.includes('liquidação de sentença') ||
    execText.includes('liquidacao de sentenca') ||
    execText.includes('interesse processual') ||
    (execText.includes('demonstrativo') && (execText.includes('débito') || execText.includes('debito'))) ||
    (execText.includes('execução') && !hasGrauRecurso) ||
    (execText.includes('execucao') && !hasGrauRecurso);
  if (hasExecucao) return 8;

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
    t.trim() === 'sentença' ||
    t.trim() === 'sentença/acórdão' ||
    t.includes('sentença proferida') ||
    t.includes('sentença homologatória') ||
    t.includes('julgamento procedente') ||
    t.includes('julgamento improcedente') ||
    t.includes('julgo procedente') ||
    t.includes('julgo improcedente') ||
    t.includes('julgo parcialmente procedente') ||
    t.includes('homologando o projeto de sentença')
  ) || descriptions.some(d =>
    d.includes('foi proferida sentença') ||
    d.includes('proferiu sentença') ||
    d.includes('sentença proferida') ||
    d.includes('homologando o projeto de sentença') ||
    d.includes('condenando o réu a pagar') ||
    d.includes('julgo procedente') ||
    d.includes('julgo improcedente') ||
    d.includes('julgo parcialmente') ||
    d.includes('julgamento de mérito') ||
    d.includes('dispositivo da sentença')
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
  
  // Verificar despachos com ordens de bloqueio (fase de execução)
  const hasDespachoBloqueio = titles.some(t => 
    t.includes('bloqueio') && 
    (t.includes('contas') || t.includes('aplicações') || t.includes('bens'))
  ) || descriptions.some(d => 
    d.includes('bloqueio') && 
    (d.includes('contas') || d.includes('aplicações') || d.includes('bens'))
  );
  if (hasDespachoBloqueio) return 8; // Fase de execução
  
  // Se tem despacho regular, provavelmente está em instrução
  if (eventTypes.includes('despacho')) return 4;
  
  // Verificar intimações específicas com bloqueio
  const hasIntimacaoBloqueio = eventTypes.includes('intimacao') && (
    titles.some(t => t.includes('bloqueio')) || 
    descriptions.some(d => d.includes('bloqueio'))
  );
  if (hasIntimacaoBloqueio) return 8; // Fase de execução
  
  // Se tem intimação genérica, provavelmente está em instrução
  if (eventTypes.includes('intimacao')) return 4;
  
  return 0; // Distribuição
};

const mapStageToStatus = (stage: number): ProcessStatus => {
  switch (stage) {
    case 1:
      return 'citacao';
    case 2:
      return 'conciliacao';
    case 3:
      return 'contestacao';
    case 4:
      return 'instrucao';
    case 5:
      return 'sentenca';
    case 6:
      return 'recurso';
    case 7:
      return 'cumprimento';
    case 8:
      return 'cumprimento';
    case 0:
    default:
      return 'distribuido';
  }
};

/** Delega extração de comarca ao serviço (fonte única de verdade). */
const extractComarcaFromEvents = (events: TimelineEvent[]): string | null => {
  const text = events.map(e => `${e.title} ${e.description || ''}`).join(' ');
  return processTimelineService.extractComarcaFromText(text);
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
  const [djenEvents, setDjenEvents]   = useState<TimelineEvent[]>([]);
  const [djEvents,   setDjEvents]     = useState<TimelineEvent[]>([]);
  const [extraEvents, setExtraEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading]         = useState(true);
  const [analyzing, setAnalyzing]     = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [error, setError]             = useState<string | null>(null);
  const [datajudCachedAt, setDatajudCachedAt] = useState<Date | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [currentStage, setCurrentStage]     = useState(0);
  const [filterType,  setFilterType]  = useState('todos');
  const [filterGrau,  setFilterGrau]  = useState('todos');
  const [searchTerm,  setSearchTerm]  = useState('');
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  const [groupByPhase, setGroupByPhase] = useState(false);

  // ── Informações do processo extraídas do DJEN ────────────────────────────
  interface ProcessInfo {
    orgao: string | null;
    tribunal: string | null;
    classe: string | null;
    poloAtivo: string[];
    poloPassivo: string[];
    advogados: { nome: string; oab: string }[];
  }
  const [processInfo, setProcessInfo] = useState<ProcessInfo | null>(null);

  // ── Extrai informações do processo das comunicações DJEN ─────────────────
  // Fonte: nomeOrgao, siglaTribunal, nomeClasse, destinatarios — tudo do DJEN
  // NÃO depende do DataJud (que tem lag)
  const extractProcessInfoFromEvents = (evts: TimelineEvent[]): ProcessInfo => {
    // Usa o evento mais recente com rawData como referência de orgão/tribunal/classe
    const ref = evts.find(e => e.rawData?.nomeOrgao) ?? evts[0];
    const orgao  = ref?.rawData?.nomeOrgao || ref?.orgao || null;
    const tribunal = ref?.rawData?.siglaTribunal || null;
    const classe = (ref?.rawData as any)?.nomeClasse || null;

    // Agrega partes de TODOS os eventos (DJEN pode distribuir em várias publicações)
    const poloAtivoSet  = new Set<string>();
    const poloPassivoSet = new Set<string>();
    const advSet = new Map<string, { nome: string; oab: string }>();

    for (const ev of evts) {
      const dests = ev.rawData?.destinatarios ?? [];
      for (const d of dests) {
        const polo = (d.polo ?? '').toLowerCase();
        if (polo.includes('ativo') || polo.includes('autor') || polo.includes('requerente')) {
          if (d.nome) poloAtivoSet.add(d.nome.trim());
        } else if (polo.includes('passivo') || polo.includes('réu') || polo.includes('reo') || polo.includes('requerido')) {
          if (d.nome) poloPassivoSet.add(d.nome.trim());
        } else if (d.nome) {
          // polo desconhecido: tenta heurística pelo clientName
          if (clientName && d.nome.toLowerCase().includes(clientName.split(' ')[0].toLowerCase())) {
            poloAtivoSet.add(d.nome.trim());
          } else {
            poloPassivoSet.add(d.nome.trim());
          }
        }
      }
      const advs = ev.rawData?.destinatarioadvogados ?? [];
      for (const da of advs) {
        const a = da.advogado;
        if (a?.nome) {
          const key = a.numero_oab ? `${a.numero_oab}/${a.uf_oab}` : a.nome;
          advSet.set(key, { nome: a.nome, oab: key });
        }
      }
    }

    return {
      orgao,
      tribunal,
      classe,
      poloAtivo:  Array.from(poloAtivoSet),
      poloPassivo: Array.from(poloPassivoSet),
      advogados:  Array.from(advSet.values()),
    };
  };

  // ── Normaliza qualquer formato de data para YYYY-MM-DD ───────────────────
  // DJEN API retorna DD/MM/YYYY; DataJud retorna ISO "YYYY-MM-DDT..."
  const toDayKey = (d: string): string => {
    if (!d) return '';
    if (d.includes('T')) return d.slice(0, 10);                    // ISO com tempo
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);     // YYYY-MM-DD
    if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {                         // DD/MM/YYYY (DJEN)
      const [dd, mm, yyyy] = d.split('/');
      return `${yyyy}-${mm}-${dd}`;
    }
    return d;
  };

  const safeTime = (d: string): number => {
    const iso = toDayKey(d);
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  };

  const events = useMemo(() => {
    // DataJud: enriquece eventos DJEN que coincidem na data (mesmo dia), ou adiciona os que não têm par
    const result = djenEvents.map(e => ({ ...e })); // cópia para não mutar estado
    const usedDjenIdx = new Set<number>(); // rastreia slots DJEN já consumidos
    const usedDj = new Set<string>();

    for (const dj of djEvents) {
      const djDay = toDayKey(dj.date);
      // Procura evento DJEN no mesmo dia que ainda não foi consumido
      const idx = result.findIndex((e, i) =>
        toDayKey(e.date) === djDay && !usedDjenIdx.has(i)
      );
      if (idx !== -1) {
        usedDj.add(dj.id);
        usedDjenIdx.add(idx);
        // Enriquece o evento DJEN: título DataJud é mais específico
        const existing = result[idx];
        if (['Notificação','Intimação','Despacho','Outro'].includes(existing.title) || !existing.title) {
          existing.title = dj.title;
        }
        existing.source = 'datajud';
        // Mantém descrição DJEN mas adiciona orgão DataJud se útil
        if (dj.orgao && !existing.description?.includes(dj.orgao)) {
          existing.description = [existing.description, dj.orgao].filter(Boolean).join('\n\n');
        }
      }
    }

    // Adiciona DataJud sem par DJEN
    const extras = djEvents.filter(dj => !usedDj.has(dj.id));

    return [...result, ...extras, ...extraEvents].sort((a, b) => safeTime(b.date) - safeTime(a.date));
  }, [djenEvents, djEvents, extraEvents]);

  // Buscar e analisar automaticamente
  // PRIORIZA banco local (djen_comunicacoes_local) com IA já pronta pelo cron
  // Fallback para DJEN direto se não houver dados no banco
  const fetchAndAnalyze = async () => {
    try {
      setLoading(true);
      setError(null);
      
      let data: TimelineEvent[] = [];
      
      // Se tem processId, buscar do banco local (com IA já pronta pelo cron)
      if (processId) {
        console.log('📦 Buscando timeline do banco local...');
        data = await processTimelineService.fetchTimelineFromDatabase(processId, processCode);
        
        // Se veio do banco e tem eventos com IA, não precisa analisar novamente
        const hasAiAnalysis = data.some(e => e.aiAnalysis);
        if (data.length > 0 && hasAiAnalysis) {
          console.log(`✅ ${data.length} eventos carregados do banco (${data.filter(e => e.aiAnalysis).length} com IA)`);
        } else if (data.length > 0) {
          // Tem dados mas sem IA, analisar em background
          console.log('🤖 Dados do banco sem IA, analisando...');
          setAnalyzing(true);
          data = await processTimelineService.fetchAndAnalyzeTimeline(
            processCode,
            (current, total) => setAnalyzeProgress({ current, total })
          );
        }
      } else {
        // Sem processId, buscar do DJEN e analisar
        setAnalyzing(true);
        data = await processTimelineService.fetchAndAnalyzeTimeline(
          processCode,
          (current, total) => setAnalyzeProgress({ current, total })
        );
      }
      
      // Buscar movimentações DataJud e fundir (em paralelo, silencioso)
      setDjenEvents(data);
      if (data.length > 0) setProcessInfo(extractProcessInfoFromEvents(data));
      const stage = detectCurrentStage(data);
      setCurrentStage(stage);

      // Sempre notifica o pai com o estágio visual detectado (independente do autoUpdate)
      const detectedStatus = STAGE_KEY_TO_STATUS[PROCESS_STAGES[stage]?.key];
      if (detectedStatus) onStatusUpdated?.(detectedStatus);

      if (processId && data.length > 0) {
        const currentProcess = await processService.getProcessById(processId);
        if (currentProcess) {
          // FONTE ÚNICA: grava no banco o MESMO status que alimenta o stepper e o
          // badge (detectCurrentStage → detectedStatus). Antes recalculava via
          // detectSuggestedStatus, que podia divergir do estágio visual.
          if (detectedStatus && currentProcess.status !== detectedStatus) {
            await processService.updateStatus(processId, detectedStatus);
            setStatusUpdated(detectedStatus);
            globalEvents.emit(SYSTEM_EVENTS.PROCESS_UPDATED, { processId, status: detectedStatus });
          }
          if (!currentProcess.court) {
            const comarca = extractComarcaFromEvents(data);
            if (comarca) await processService.updateProcess(processId, { court: comarca });
          }
        }
      }
    } catch (err: any) {
      try {
        const data = await processTimelineService.fetchProcessTimeline(processCode);
        setDjenEvents(data);
        if (data.length > 0) setProcessInfo(extractProcessInfoFromEvents(data));
        const stage = detectCurrentStage(data);
        setCurrentStage(stage);
        const detectedStatus = STAGE_KEY_TO_STATUS[PROCESS_STAGES[stage]?.key];
        if (detectedStatus) onStatusUpdated?.(detectedStatus);
        if (processId && data.length > 0) {
          const currentProcess = await processService.getProcessById(processId);
          if (currentProcess) {
            // FONTE ÚNICA: grava o mesmo detectedStatus do stepper/badge.
            if (detectedStatus && currentProcess.status !== detectedStatus) {
              await processService.updateStatus(processId, detectedStatus);
              setStatusUpdated(detectedStatus);
              globalEvents.emit(SYSTEM_EVENTS.PROCESS_UPDATED, { processId, status: detectedStatus });
            }
            if (!currentProcess.court) {
              const comarca = extractComarcaFromEvents(data);
              if (comarca) await processService.updateProcess(processId, { court: comarca });
            }
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
      setDjenEvents(data);
      if (data.length > 0) setProcessInfo(extractProcessInfoFromEvents(data));
      const stage = detectCurrentStage(data);
      setCurrentStage(stage);
      const detectedStatus = STAGE_KEY_TO_STATUS[PROCESS_STAGES[stage]?.key];
      if (detectedStatus) {
        onStatusUpdated?.(detectedStatus);
        if (processId) {
          // Persiste a fonte única ao atualizar manualmente, mantendo banco = stepper = badge.
          const cur = await processService.getProcessById(processId);
          if (cur && cur.status !== detectedStatus) {
            await processService.updateStatus(processId, detectedStatus);
          }
          globalEvents.emit(SYSTEM_EVENTS.PROCESS_UPDATED, { processId, status: detectedStatus });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar');
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  // ── Busca DataJud separadamente (não bloqueia carregamento DJe) ───────────
  const isInternalKey = (s: string) => /^[a-z][a-z0-9_]*$/.test(s) && s.includes('_');

  const buildDjTitle = (nome: string, complementos: DatajudComplemento[] | undefined): string => {
    if (!complementos?.length) return nome;
    const best = complementos.find(c => c.nome && c.nome !== nome && !isInternalKey(c.nome) && isNaN(Number(c.nome)));
    if (best) return best.nome;
    return nome;
  };

  const CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 horas — alinhado ao cron

  const fetchDatajud = async () => {
    try {
      // ── Tenta usar cache do banco primeiro (populado pelo cron a cada 48h) ──
      let djResult: Awaited<ReturnType<typeof fetchDatajudMovimentos>> | null = null;

      if (processId) {
        const proc = await processService.getProcessById(processId);
        if (proc?.datajud_cache && proc.datajud_synced_at) {
          const age = Date.now() - new Date(proc.datajud_synced_at).getTime();
          if (age < CACHE_MAX_AGE_MS) {
            // Cache fresco — usa dados locais sem chamar a API.
            // O sync pode armazenar o objeto DatajudProcesso direto (campo `tribunal` nativo)
            // ou encapsulado em { processo, tribunal }. Suportamos os dois formatos.
            const raw = proc.datajud_cache as any;
            const processoObj = raw?.movimentos ? raw : raw?.processo ?? raw;
            const tribunalStr = raw?.tribunal ?? processoObj?.tribunal ?? null;
            djResult = { processo: processoObj, tribunal: tribunalStr };
            setDatajudCachedAt(new Date(proc.datajud_synced_at));
          }
        }
      }

      // Cache ausente/expirado — busca ao vivo
      if (!djResult) {
        djResult = await fetchDatajudMovimentos(processCode);
        setDatajudCachedAt(null); // ao vivo = sem badge de cache
      }

      if (!djResult.processo?.movimentos?.length) return;
      const catMap: Record<string, TimelineEvent['type']> = {
        sentenca: 'sentenca', decisao: 'decisao', despacho: 'despacho',
        citacao: 'citacao', recurso: 'recurso', audiencia: 'outro',
        arquivamento: 'outro', outro: 'outro',
      };
      const tribunalNome = djResult.tribunal ? getTribunalNome(djResult.tribunal) : 'DataJud';
      const converted: TimelineEvent[] = djResult.processo!.movimentos.map((mov, i) => {
        const title = buildDjTitle(mov.nome, mov.complementosTabelados);
        const descParts: string[] = [];
        if (mov.orgaoJulgador?.nomeOrgao) descParts.push(mov.orgaoJulgador.nomeOrgao);
        mov.complementosTabelados?.forEach(c => {
          if (!c.nome || isInternalKey(c.nome) || c.nome === title) return;
          descParts.push(c.nome);
        });
        return {
          id: `datajud-${i}-${mov.codigo}`,
          date: mov.dataHora,
          type: catMap[categorizarMovimento(mov.codigo, mov.nome)] ?? 'outro',
          title,
          description: descParts.join(' · '),
          orgao: mov.orgaoJulgador?.nomeOrgao || tribunalNome,
          grauRecursal: djResult.processo!.grau || undefined,
          source: 'datajud' as const,
        };
      });
      setDjEvents(converted);

      // Auto-captura data de distribuição (dataAjuizamento) se o processo não tiver
      if (processId && djResult.processo.dataAjuizamento) {
        try {
          const proc = await processService.getProcessById(processId);
          if (proc && !proc.distributed_at) {
            await processService.updateProcess(processId, {
              distributed_at: new Date(djResult.processo.dataAjuizamento).toISOString(),
            });
          }
        } catch { /* silencioso */ }
      }
    } catch { /* best-effort */ }
  };

  useEffect(() => {
    fetchAndAnalyze();
  }, [processCode]);

  useEffect(() => {
    fetchDatajud();
  }, [processCode]);

  useEffect(() => {
    if (!processId) return;
    let mounted = true;
    const fetch = async () => {
      const extra: TimelineEvent[] = [];

      // Prazos
      const { data: dls } = await supabase
        .from('deadlines')
        .select('id, title, description, due_date, status, priority')
        .eq('process_id', processId)
        .order('due_date', { ascending: true });

      for (const d of dls || []) {
        const today = new Date(); today.setHours(0,0,0,0);
        const due = new Date(d.due_date);
        const isVencido = d.status === 'pendente' && due < today;
        extra.push({
          id: `prazo-${d.id}`,
          date: d.due_date,
          type: 'prazo',
          title: d.title,
          description: d.description || '',
          orgao: '',
          source: 'prazo',
          prazoStatus: isVencido ? 'vencido' : (d.status as 'pendente' | 'cumprido'),
          prazoData: { priority: d.priority, status: d.status },
        });
      }

      // Compromissos (calendar_events)
      const { data: evts } = await supabase
        .from('calendar_events')
        .select('id, title, description, event_type, event_mode, start_at, status')
        .eq('process_id', processId)
        .order('start_at', { ascending: true });

      const APT_LABELS: Record<string, string> = {
        hearing: 'Audiência', pericia: 'Perícia', meeting: 'Reunião',
        deadline: 'Prazo', payment: 'Recebimento', requirement: 'Exigência',
      };
      for (const e of evts || []) {
        extra.push({
          id: `compromisso-${e.id}`,
          date: e.start_at,
          type: 'compromisso',
          title: `${APT_LABELS[e.event_type] || e.event_type}${e.title ? ` — ${e.title}` : ''}`,
          description: e.description || '',
          orgao: '',
          source: 'compromisso',
          prazoData: { event_type: e.event_type, event_mode: e.event_mode, status: e.status },
        });
      }

      if (mounted) setExtraEvents(extra);
    };
    fetch();
    return () => { mounted = false; };
  }, [processId]);

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
    const matchesSearch = !searchTerm || matchesNormalizedSearch(searchTerm, [event.title, event.description || '']);
    return matchesType && matchesGrau && matchesSearch;
  });

  // #7 — Agrupamento por fase
  const EVENT_PHASE_MAP: Record<string, string> = {
    citacao: 'Citação', despacho: 'Despacho / Instrução', decisao: 'Decisões',
    intimacao: 'Intimações', sentenca: 'Sentença', recurso: 'Recursos', outro: 'Outros',
  };
  const groupedEvents = groupByPhase
    ? filteredEvents.reduce<Record<string, TimelineEvent[]>>((acc, ev) => {
        const phase = EVENT_PHASE_MAP[ev.type] ?? 'Outros';
        if (!acc[phase]) acc[phase] = [];
        acc[phase].push(ev);
        return acc;
      }, {})
    : null;

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
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden w-[92vw] max-w-5xl max-h-[90vh] min-h-[520px] flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#f97316] flex items-center justify-center">
            <Clock className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Andamento processual</div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">Linha do Tempo</h2>
            <p className="text-[11px] text-slate-500 truncate max-w-[420px]">{clientName} <span className="text-slate-300">·</span> <span className="font-mono tabular-nums">{processCode}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshTimeline}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 transition disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {analyzing ? `${analyzeProgress.current}/${analyzeProgress.total}` : 'Atualizar'}
          </button>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Estágios — stepper enterprise com conectores */}
      <div className="px-6 py-5 bg-slate-50/70 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Estágio do Processo</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#f97316] text-white">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {currentStage + 1}/{PROCESS_STAGES.length} · {PROCESS_STAGES[currentStage]?.label}
          </span>
        </div>
        <div className="flex items-start">
          {PROCESS_STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const isDone = index < currentStage;
            const isCurrent = index === currentStage;
            const isLast = index === PROCESS_STAGES.length - 1;
            return (
              <div key={stage.key} className="flex-1 flex flex-col items-center relative" title={stage.label}>
                {/* Connector */}
                {!isLast && (
                  <div className={`absolute top-[18px] left-1/2 w-full h-0.5 ${index < currentStage ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-zinc-700'}`} />
                )}
                <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                  isCurrent
                    ? 'bg-[#f97316] text-white ring-4 ring-[#f97316]/15'
                    : isDone
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white dark:bg-zinc-800 text-slate-300 border border-slate-200 dark:border-zinc-600'
                }`}>
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <span className={`mt-2 text-[10px] font-semibold text-center leading-tight ${
                  isCurrent ? 'text-[#f97316] dark:text-white' : isDone ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Layout em 2 colunas */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] overflow-hidden">
        {/* Coluna Esquerda - Resumo e Filtros */}
        <div className="border-b md:border-b-0 md:border-r border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto p-4 space-y-4">

          {/* Status Updated */}
          {statusUpdated && (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-emerald-700">Status atualizado: <strong>{getStatusLabel(statusUpdated)}</strong></p>
            </div>
          )}

          {/* Filtros compactos */}
          <div className="bg-slate-50/70 dark:bg-zinc-800/50 rounded-2xl border border-slate-200 dark:border-zinc-700 p-4">
            <p className="text-xs font-semibold text-slate-700 dark:text-white mb-3">Filtros</p>
            
            <div className="flex flex-wrap gap-1.5 mb-3">
              {eventTypeCounts.intimacao > 0 && (
                <button onClick={() => setFilterType(filterType === 'intimacao' ? 'todos' : 'intimacao')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition border ${filterType === 'intimacao' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white/60 dark:bg-zinc-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-white dark:hover:bg-zinc-900/60'}`}>
                  <Bell className="w-3 h-3" /> {eventTypeCounts.intimacao}
                </button>
              )}
              {eventTypeCounts.decisao > 0 && (
                <button onClick={() => setFilterType(filterType === 'decisao' ? 'todos' : 'decisao')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition border ${filterType === 'decisao' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white/60 dark:bg-zinc-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-white dark:hover:bg-zinc-900/60'}`}>
                  <Scale className="w-3 h-3" /> {eventTypeCounts.decisao}
                </button>
              )}
              {eventTypeCounts.despacho > 0 && (
                <button onClick={() => setFilterType(filterType === 'despacho' ? 'todos' : 'despacho')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition border ${filterType === 'despacho' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white/60 dark:bg-zinc-900/40 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900/60'}`}>
                  <FileText className="w-3 h-3" /> {eventTypeCounts.despacho}
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar..."
                  className="w-full pl-7 pr-2 py-2 bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#f97316]/20 focus:border-[#f97316]/40" />
              </div>
              <select value={filterGrau} onChange={(e) => setFilterGrau(e.target.value)}
                className="w-full px-2 py-2 bg-white/70 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-700 rounded-xl text-xs">
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

            {/* Badge DataJud — quando usando cache do cron */}
            {djEvents.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium leading-tight">
                  DataJud ·{' '}
                  {datajudCachedAt
                    ? (() => {
                        const diffMs = Date.now() - datajudCachedAt.getTime();
                        const diffH = Math.floor(diffMs / 3600000);
                        const diffM = Math.floor((diffMs % 3600000) / 60000);
                        return diffH > 0 ? `${diffH}h atrás` : diffM > 0 ? `${diffM}min atrás` : 'agora';
                      })()
                    : 'ao vivo'}
                </span>
              </div>
            )}

          </div>

          {/* ── Dados do Processo (DJEN) ─────────────────────────────── */}
          {processInfo && (processInfo.orgao || processInfo.poloAtivo.length > 0 || processInfo.poloPassivo.length > 0) && (
            <div className="bg-slate-50/70 dark:bg-zinc-800/50 rounded-2xl border border-slate-200 dark:border-zinc-700 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-white flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-[#f97316]" />
                Dados do Processo
                <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-800">DJEN</span>
              </p>

              {/* Órgão Julgador */}
              {processInfo.orgao && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Órgão Julgador</p>
                  <p className="text-xs text-slate-700 dark:text-slate-200 leading-snug">{processInfo.orgao}</p>
                </div>
              )}

              {/* Tribunal + Classe */}
              {(processInfo.tribunal || processInfo.classe) && (
                <div className="flex gap-3 flex-wrap">
                  {processInfo.tribunal && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Tribunal</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-700 text-xs font-bold text-slate-700 dark:text-slate-200">{processInfo.tribunal}</span>
                    </div>
                  )}
                  {processInfo.classe && (
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Classe</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug truncate" title={processInfo.classe}>{processInfo.classe}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Polo Ativo */}
              {processInfo.poloAtivo.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Polo Ativo
                  </p>
                  <ul className="space-y-0.5">
                    {processInfo.poloAtivo.map((nome, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-200 truncate" title={nome}>{nome}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Polo Passivo */}
              {processInfo.poloPassivo.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    Polo Passivo
                  </p>
                  <ul className="space-y-0.5">
                    {processInfo.poloPassivo.map((nome, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-200 truncate" title={nome}>{nome}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Advogados */}
              {processInfo.advogados.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Advogados
                  </p>
                  <ul className="space-y-0.5">
                    {processInfo.advogados.map((a, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                        {a.nome}
                        {a.oab && <span className="ml-1 text-[10px] text-slate-400">({a.oab})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* #7 — Toggle agrupamento por fase */}
          <button
            onClick={() => setGroupByPhase(g => !g)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition ${
              groupByPhase
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white dark:bg-zinc-800 text-slate-600 border-slate-200 dark:border-zinc-700 hover:bg-slate-50'
            }`}
          >
            <span>Agrupar por tipo</span>
            <Layers className="w-3 h-3" />
          </button>

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
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50 dark:bg-zinc-950">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-[#f97316] animate-spin mb-4" />
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
              className="mt-4 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold transition"
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
              className="mt-3 text-[#f97316] hover:underline text-sm font-semibold"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line — oculta no modo agrupado */}
            {!groupByPhase && (
              <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-[#f97316]/30 via-slate-200 to-transparent" />
            )}

            {/* #7 — Modo agrupado por tipo */}
            {groupByPhase && groupedEvents ? (
              <div className="space-y-6">
                {Object.entries(groupedEvents).map(([phase, phaseEvents]) => (
                  <div key={phase}>
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <Layers className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{phase}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold">{phaseEvents.length}</span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>
                    <div className="space-y-2">
                      {phaseEvents.map((event) => {
                        const isExpanded = expandedEvents.has(event.id);
                        const hasAI = !!event.aiAnalysis;
                        return (
                          <div key={event.id} className={`group rounded-xl border shadow-sm transition-all ${
                            hasAI && event.aiAnalysis?.urgency === 'critica' ? 'bg-red-50/60 border-red-200' :
                            hasAI && event.aiAnalysis?.urgency === 'alta' ? 'bg-amber-50/60 border-amber-200' :
                            event.type === 'sentenca' ? 'bg-emerald-50/50 border-emerald-200' : 'bg-white border-slate-200'
                          } ${isExpanded ? 'shadow-md' : 'hover:shadow-md'}`}>
                            <div className="px-4 py-3 cursor-pointer" onClick={() => toggleExpand(event.id)}>
                              <div className="flex items-center justify-between gap-3 mb-1">
                                <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                                  <span>{formatDate(event.date)}</span>
                                  {event.grauRecursal && <><span className="text-slate-300">·</span><span>{event.grauRecursal}</span></>}
                                  {event.source === 'datajud' && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-200 uppercase tracking-wide">CNJ</span>
                                  )}
                                  {event.aiAnalysis?.actionRequired && <span className="text-red-500">•</span>}
                                </div>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                              </div>
                              <h3 className="text-sm font-medium text-slate-800 leading-relaxed">
                                {event.title === 'Notificação' || event.title === 'Intimação' || event.title === 'Despacho'
                                  ? (event.description?.substring(0, 120)?.replace(/<[^>]*>/g, '')?.trim() + '...' || event.title)
                                  : event.title}
                              </h3>
                              {hasAI && event.aiAnalysis?.summary && !isExpanded && (
                                <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{event.aiAnalysis.summary}</p>
                              )}
                            </div>
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-slate-100">
                                {hasAI && event.aiAnalysis?.summary && <p className="text-sm text-slate-600 mt-3 mb-3">{event.aiAnalysis.summary}</p>}
                                <div className="bg-slate-50 rounded-xl p-3 max-h-40 overflow-y-auto">
                                  <p className="text-xs text-slate-500 whitespace-pre-wrap">{cleanHtmlContent(event.description) || 'Conteúdo não disponível'}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            /* Modo cronológico (padrão) */
            <div className="space-y-3">
              {filteredEvents.map((event, index) => {
                const Icon = getEventIcon(event.type);
                const color = getEventColor(event.type);
                const isExpanded = expandedEvents.has(event.id);
                const hasAI = !!event.aiAnalysis;
                const isLatest = index === 0; // Primeiro evento é o mais recente

                const getBgColor = () => {
                  if (event.type === 'prazo') {
                    if (event.prazoStatus === 'vencido') return 'bg-red-50/60 border-red-200';
                    if (event.prazoStatus === 'pendente') return 'bg-amber-50/60 border-amber-200';
                    return 'bg-emerald-50/50 border-emerald-200';
                  }
                  if (event.type === 'compromisso') return 'bg-teal-50/50 border-teal-200';
                  if (isLatest) return 'bg-white border-[#f97316]/30 ring-1 ring-[#f97316]/15 shadow-sm';
                  if (hasAI && event.aiAnalysis?.urgency === 'critica') return 'bg-red-50/60 border-red-200';
                  if (hasAI && event.aiAnalysis?.urgency === 'alta') return 'bg-amber-50/60 border-amber-200';
                  if (event.type === 'sentenca') return 'bg-emerald-50/50 border-emerald-200';
                  return 'bg-white border-slate-200';
                };

                const getDotColor = () => {
                  if (event.type === 'prazo') {
                    if (event.prazoStatus === 'vencido') return 'bg-red-500';
                    if (event.prazoStatus === 'pendente') return 'bg-amber-500';
                    return 'bg-emerald-500';
                  }
                  if (event.type === 'compromisso') return 'bg-teal-500';
                  if (isLatest) return 'bg-[#f97316] ring-4 ring-[#f97316]/15';
                  if (hasAI && event.aiAnalysis?.urgency === 'critica') return 'bg-red-500';
                  if (hasAI && event.aiAnalysis?.urgency === 'alta') return 'bg-amber-500';
                  if (event.type === 'intimacao') return 'bg-blue-500';
                  if (event.type === 'citacao') return 'bg-purple-500';
                  if (event.type === 'sentenca') return 'bg-emerald-500';
                  if (event.type === 'decisao') return 'bg-amber-500';
                  return 'bg-slate-400';
                };

                // ── Card compacto para Prazo / Compromisso ──────────────────
                if (event.type === 'prazo' || event.type === 'compromisso') {
                  const isPrazo = event.type === 'prazo';
                  const statusLabel = event.prazoStatus === 'vencido' ? 'Vencido'
                    : event.prazoStatus === 'cumprido' ? 'Cumprido' : 'Pendente';
                  const statusCls = event.prazoStatus === 'vencido'
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : event.prazoStatus === 'cumprido'
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                    : 'bg-amber-100 text-amber-700 border-amber-200';
                  const modeLabel = event.prazoData?.event_mode === 'online' ? 'Online'
                    : event.prazoData?.event_mode === 'presencial' ? 'Presencial' : null;

                  return (
                    <div key={event.id} className="relative pl-10">
                      <div className={`absolute left-0 w-2.5 h-2.5 rounded-full ${getDotColor()}`} style={{ top: '1.05rem' }} />
                      <div className={`rounded-2xl border px-4 py-3 ${getBgColor()}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap mb-1">
                              <span>{formatDate(event.date)}</span>
                              <span className="text-slate-300">·</span>
                              <span className="font-medium">{getEventTypeLabel(event.type)}</span>
                              {modeLabel && <span className="text-slate-400">· {modeLabel}</span>}
                            </div>
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{event.title}</p>
                            {event.description && (
                              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{event.description}</p>
                            )}
                          </div>
                          {isPrazo && (
                            <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCls}`}>
                              {statusLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={event.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div
                      className={`absolute left-0 w-2.5 h-2.5 rounded-full ${getDotColor()}`}
                      style={{ top: '1.05rem' }}
                    />

                    {/* Event card */}
                    <div className={`group rounded-2xl border shadow-sm transition-all ${getBgColor()} ${isExpanded ? 'shadow-md' : 'hover:shadow-md'}`}>
                      {/* Card header */}
                      <div
                        className="px-4 py-3 cursor-pointer"
                        onClick={() => toggleExpand(event.id)}
                      >
                        {/* Date + Type */}
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                            <span>{formatDate(event.date)}</span>
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="font-medium">{getEventTypeLabel(event.type)}</span>
                            {event.grauRecursal && (
                              <span className="text-slate-400 dark:text-slate-500">· {event.grauRecursal}</span>
                            )}
                            {event.source === 'datajud' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 border border-blue-200 uppercase tracking-wide">
                                CNJ
                              </span>
                            )}
                            {event.aiAnalysis?.actionRequired && (
                              <span className="text-red-500">•</span>
                            )}
                          </div>
                          <div className="text-slate-400">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>

                        {/* Title */}
                        <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                          {event.title === 'Notificação' || event.title === 'Intimação' || event.title === 'Despacho'
                            ? (event.description?.substring(0, 120)?.replace(/<[^>]*>/g, '')?.trim() + '...' || event.title)
                            : event.title}
                        </h3>

                        {/* Órgão julgador (DJEN) */}
                        {event.orgao && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate" title={event.orgao}>
                            {event.orgao}
                          </p>
                        )}

                        {/* AI Summary - only when collapsed */}
                        {hasAI && event.aiAnalysis?.summary && !isExpanded && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 line-clamp-2">
                            {event.aiAnalysis.summary}
                          </p>
                        )}
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-slate-100 dark:border-zinc-800">
                          {/* AI Summary */}
                          {hasAI && event.aiAnalysis?.summary && (
                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-4 mb-4">
                              {event.aiAnalysis.summary}
                            </p>
                          )}

                          {/* Key Points */}
                          {hasAI && event.aiAnalysis?.keyPoints && event.aiAnalysis.keyPoints.length > 0 && (
                            <ul className="space-y-1 mb-4">
                              {event.aiAnalysis.keyPoints.map((point, i) => (
                                <li key={i} className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2">
                                  <span className="text-emerald-500 mt-0.5">✓</span>
                                  {point}
                                </li>
                              ))}
                            </ul>
                          )}

                          {/* Full content */}
                          <div className="bg-slate-50 dark:bg-zinc-800/50 rounded-xl p-3 max-h-48 overflow-y-auto mb-4">
                            <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap">
                              {cleanHtmlContent(event.description) || 'Conteúdo não disponível'}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-4 text-[11px]">
                            <button
                              onClick={(e) => { e.stopPropagation(); onAddDeadline?.(event); }}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                              + Prazo
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onAddAppointment?.(event); }}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                              + Compromisso
                            </button>
                            {event.rawData?.link && (
                              <a
                                href={event.rawData.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-blue-500 hover:text-blue-600 ml-auto"
                              >
                                DJEN →
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
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
