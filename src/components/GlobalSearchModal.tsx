import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search, X, FileText, Users, Loader2, ChevronRight, ArrowRight,
  ClipboardList, Calendar, CheckSquare, AlarmClock, DollarSign, FolderOpen,
  Clock, Zap, Gavel,
} from 'lucide-react';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { requirementService } from '../services/requirement.service';
import { calendarService } from '../services/calendar.service';
import { taskService } from '../services/task.service';
import { deadlineService } from '../services/deadline.service';
import { financialService } from '../services/financial.service';
import { cloudService } from '../services/cloud.service';
import { matchesNormalizedSearch } from '../utils/search';
import type { Client } from '../types/client.types';

// ─── Module-level cache ───────────────────────────────────────────────────────

interface SearchData {
  processes: Awaited<ReturnType<typeof processService.listProcesses>>;
  clients: Client[];
  intimacoes: Awaited<ReturnType<typeof djenLocalService.listComunicacoes>>;
  requirements: Awaited<ReturnType<typeof requirementService.listRequirements>>;
  events: Awaited<ReturnType<typeof calendarService.listEvents>>;
  tasks: Awaited<ReturnType<typeof taskService.listTasks>>;
  deadlines: Awaited<ReturnType<typeof deadlineService.listDeadlines>>;
  agreements: Awaited<ReturnType<typeof financialService.listAgreements>>;
  rootFolders: Awaited<ReturnType<typeof cloudService.listFolders>>;
}

let _cache: { data: SearchData; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getSearchData(force = false): Promise<SearchData> {
  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL) {
    return _cache.data;
  }
  const [processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders] =
    await Promise.all([
      processService.listProcesses(),
      clientService.listClients(),
      djenLocalService.listComunicacoes({}),
      requirementService.listRequirements().catch(() => []),
      calendarService.listEvents().catch(() => [] as Awaited<ReturnType<typeof calendarService.listEvents>>),
      taskService.listTasks().catch(() => []),
      deadlineService.listDeadlines().catch(() => []),
      financialService.listAgreements().catch(() => []),
      cloudService.listFolders(null, false).catch(() => [] as Awaited<ReturnType<typeof cloudService.listFolders>>),
    ]);
  const data: SearchData = { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders };
  _cache = { data, fetchedAt: Date.now() };
  return data;
}

// Invalidar cache ao abrir (pre-warm na abertura)
export function invalidateSearchCache() { _cache = null; }

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultType =
  | 'cliente' | 'processo' | 'processo-via-cliente' | 'intimacao'
  | 'requerimento' | 'prazo' | 'agenda' | 'tarefa' | 'financeiro' | 'cloud';

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  score: number; // Higher = more relevant
  navModule: string;
  navParams?: Record<string, string>;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (module: string, params?: Record<string, string>) => void;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ResultType, {
  label: string; icon: React.ElementType; color: string; border: string; group: string;
}> = {
  cliente:               { label: 'Cliente',      icon: Users,         color: 'text-slate-600 bg-slate-100',    border: 'border-slate-200',   group: 'Clientes'      },
  processo:              { label: 'Processo',     icon: FileText,      color: 'text-amber-600 bg-amber-50',     border: 'border-amber-200',   group: 'Processos'     },
  'processo-via-cliente':{ label: 'Processo',     icon: FileText,      color: 'text-amber-600 bg-amber-50',     border: 'border-amber-200',   group: 'Processos'     },
  intimacao:             { label: 'Intimação',    icon: Gavel,         color: 'text-orange-600 bg-orange-50',   border: 'border-orange-200',  group: 'Intimações'    },
  requerimento:          { label: 'Requerimento', icon: ClipboardList, color: 'text-purple-600 bg-purple-50',   border: 'border-purple-200',  group: 'Requerimentos' },
  prazo:                 { label: 'Prazo',        icon: AlarmClock,    color: 'text-red-600 bg-red-50',         border: 'border-red-200',     group: 'Prazos'        },
  agenda:                { label: 'Agenda',       icon: Calendar,      color: 'text-teal-600 bg-teal-50',       border: 'border-teal-200',    group: 'Agenda'        },
  tarefa:                { label: 'Tarefa',       icon: CheckSquare,   color: 'text-sky-600 bg-sky-50',         border: 'border-sky-200',     group: 'Tarefas'       },
  financeiro:            { label: 'Financeiro',   icon: DollarSign,    color: 'text-emerald-600 bg-emerald-50', border: 'border-emerald-200', group: 'Financeiro'    },
  cloud:                 { label: 'Pasta',        icon: FolderOpen,    color: 'text-indigo-600 bg-indigo-50',   border: 'border-indigo-200',  group: 'Cloud'         },
};

// Intimações removidas da exibição (ainda carregadas para extrair partes dos processos)
const GROUP_ORDER: ResultType[] = [
  'cliente', 'processo', 'processo-via-cliente', 'requerimento', 'prazo',
  'agenda', 'tarefa', 'financeiro', 'cloud',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nrm = (s: string) =>
  (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();

const BENEFIT_LABELS: Record<string, string> = {
  bpc_loas: 'BPC LOAS', bpc_loas_deficiencia: 'BPC LOAS Deficiência', bpc_loas_idoso: 'BPC LOAS Idoso',
  aposentadoria_tempo: 'Aposent. Tempo', aposentadoria_idade: 'Aposent. Idade',
  aposentadoria_invalidez: 'Aposent. Invalidez', auxilio_acidente: 'Auxílio Acidente',
  auxilio_doenca: 'Auxílio Doença', pensao_morte: 'Pensão por Morte',
  salario_maternidade: 'Salário Maternidade', outro: 'Outro',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

/** Score: 10 = exact word match, 5 = starts-with, 2 = contains */
function score(haystack: string, needle: string): number {
  const h = nrm(haystack), n = nrm(needle);
  if (!h || !n) return 0;
  if (h === n) return 20;
  const words = h.split(/\s+/);
  if (words.some(w => w === n)) return 10;
  if (words.some(w => w.startsWith(n))) return 5;
  if (h.includes(n)) return 2;
  return 0;
}

function topScore(fields: string[], needle: string): number {
  return Math.max(0, ...fields.map(f => score(f, needle)));
}

/** Highlight: wraps the matching substring in <mark> */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const nText = nrm(text);
  const nQuery = nrm(query);
  const idx = nText.indexOf(nQuery);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-amber-900 rounded px-0.5 not-italic">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const RECENT_KEY = 'globalSearch_recent';
const MAX_RECENT = 6;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(q: string) {
  const prev = loadRecent().filter(r => r !== q);
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [priming, setPriming] = useState(false);
  const [selected, setSelected] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset + pre-warm cache on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setRecentSearches(loadRecent());
      setTimeout(() => inputRef.current?.focus(), 60);
      // Pre-warm cache in background if stale
      if (!_cache || Date.now() - _cache.fetchedAt >= CACHE_TTL) {
        setPriming(true);
        getSearchData().then(() => setPriming(false)).catch(() => setPriming(false));
      }
    }
  }, [open]);

  // ── Search ──────────────────────────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const q2 = q.trim();
      const nq = nrm(q2);
      const today = new Date().toISOString().slice(0, 10);

      const { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders } =
        await getSearchData();

      const clientById = new Map<string, Client>(clients.map(c => [c.id, c]));

      // Partes por process_id (a partir das intimações já carregadas)
      const partiesByProcessId = new Map<string, { polo_ativo: string | null; polo_passivo: string | null }>();
      for (const i of intimacoes) {
        if (i.process_id && !partiesByProcessId.has(i.process_id) && (i.polo_ativo || i.polo_passivo)) {
          partiesByProcessId.set(i.process_id, { polo_ativo: i.polo_ativo, polo_passivo: i.polo_passivo });
        }
      }

      // ── Clientes ──────────────────────────────────────────────────────────
      const clientResults: SearchResult[] = clients
        .map(c => ({
          s: topScore([c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '', c.phone ?? ''], q2),
          c,
        }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(({ c, s }) => ({
          id: c.id, type: 'cliente' as const,
          title: c.full_name ?? 'Cliente',
          subtitle: [c.cpf_cnpj, c.email].filter(Boolean).join(' · ') || undefined,
          meta: c.phone || undefined,
          score: s + 10, // clientes têm prioridade base
          navModule: 'clientes',
          navParams: { mode: 'details', entityId: c.id },
        }));

      const matchedClientIds = new Set(clientResults.map(r => r.id));

      // Helper: subtitle do processo priorizando partes
      const buildProcessSubtitle = (pid: string, clientName?: string | null, court?: string | null) => {
        const p = partiesByProcessId.get(pid);
        if (p?.polo_ativo || p?.polo_passivo) {
          const partsStr = [p.polo_ativo, p.polo_passivo].filter(Boolean).join(' × ');
          return court ? `${partsStr} · ${court}` : partsStr;
        }
        return [clientName, court].filter(Boolean).join(' · ') || undefined;
      };

      // ── Processos (só número e comarca — advogado removido para evitar
      //    retornar TODOS os casos do usuário logado ao buscar seu próprio nome)
      const processResults: SearchResult[] = processes
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const sc = topScore([p.process_code ?? '', p.court ?? ''], q2);
          return { p, client, s: sc };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 5)
        .map(({ p, client, s }) => ({
          id: p.id, type: 'processo' as const,
          title: p.process_code ?? 'Processo',
          subtitle: buildProcessSubtitle(p.id, client?.full_name, p.court),
          meta: p.status,
          score: s,
          navModule: 'processos',
          navParams: { searchQuery: p.process_code ?? '' },
        }));

      // ── Processos via cliente ─────────────────────────────────────────────
      const processViaClientResults: SearchResult[] = processes
        .filter(p => {
          if (!p.client_id || matchedClientIds.has(p.client_id)) return false;
          const client = clientById.get(p.client_id);
          return client && topScore([client.full_name ?? ''], q2) > 0;
        })
        .slice(0, 4)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const parties = partiesByProcessId.get(p.id);
          return {
            id: p.id, type: 'processo-via-cliente' as const,
            title: p.process_code ?? 'Processo',
            subtitle: parties?.polo_ativo
              ? [parties.polo_ativo, parties.polo_passivo].filter(Boolean).join(' × ')
              : `${client?.full_name ?? ''}${p.court ? ' · ' + p.court : ''}`,
            meta: p.status,
            score: 3,
            navModule: 'processos',
            navParams: { searchQuery: p.process_code ?? '' },
          };
        });

      // Intimações são carregadas apenas para construir o mapa de partes —
      // não são exibidas como resultado de busca (removidas a pedido do usuário).

      // ── Requerimentos ─────────────────────────────────────────────────────
      const reqResults: SearchResult[] = requirements
        .map(r => ({
          r,
          s: topScore([r.beneficiary ?? '', r.cpf ?? '', r.protocol ?? '', BENEFIT_LABELS[r.benefit_type] ?? ''], q2),
        }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ r, s }) => ({
          id: r.id, type: 'requerimento' as const,
          title: r.beneficiary ?? 'Requerimento',
          subtitle: [BENEFIT_LABELS[r.benefit_type], r.protocol].filter(Boolean).join(' · ') || undefined,
          meta: r.cpf || undefined,
          score: s,
          navModule: 'requerimentos',
          navParams: { entityId: r.id },
        }));

      // ── Prazos ────────────────────────────────────────────────────────────
      const prazoResults: SearchResult[] = deadlines
        .filter(d => d.status !== 'cumprido' && d.status !== 'cancelado')
        .map(d => {
          const client = clientById.get(d.client_id ?? '');
          return {
            d,
            client,
            s: topScore([d.title ?? '', d.description ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ d, client, s }) => {
          const isOverdue = d.due_date < today && d.status === 'pendente';
          return {
            id: d.id, type: 'prazo' as const,
            title: d.title,
            subtitle: client?.full_name || undefined,
            meta: `${fmtDate(d.due_date)}${isOverdue ? ' ⚠' : ''}`,
            score: s,
            navModule: 'prazos',
            navParams: { entityId: d.id },
          };
        });

      // ── Agenda (apenas futuros) ───────────────────────────────────────────
      const agendaResults: SearchResult[] = events
        .filter(e => e.start_at.slice(0, 10) >= today)
        .map(e => ({
          e,
          s: topScore([e.title ?? '', e.description ?? '', e.client_name ?? '', EVENT_TYPE_LABELS[e.event_type] ?? ''], q2),
        }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        // Dedup: same title+date+client → keep first
        .filter((x, i, arr) => {
          const key = `${nrm(x.e.title ?? '')}|${x.e.start_at.slice(0, 10)}|${x.e.client_name ?? ''}`;
          return arr.findIndex(y => `${nrm(y.e.title ?? '')}|${y.e.start_at.slice(0, 10)}|${y.e.client_name ?? ''}` === key) === i;
        })
        .slice(0, 4)
        .map(({ e, s }) => ({
          id: e.id, type: 'agenda' as const,
          title: e.title ?? 'Compromisso',
          subtitle: [EVENT_TYPE_LABELS[e.event_type], e.client_name].filter(Boolean).join(' · ') || undefined,
          meta: fmtDate(e.start_at),
          score: s,
          navModule: 'agenda',
          navParams: { mode: 'event', entityId: e.id },
        }));

      // ── Tarefas ───────────────────────────────────────────────────────────
      const tarefaResults: SearchResult[] = tasks
        .map(t => {
          const client = clientById.get(t.client_id ?? '');
          return {
            t, client,
            s: topScore([t.title ?? '', t.description ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ t, client, s }) => ({
          id: t.id, type: 'tarefa' as const,
          title: t.title ?? 'Tarefa',
          subtitle: client?.full_name || undefined,
          meta: t.due_date ? fmtDate(t.due_date) : undefined,
          score: s,
          navModule: 'tarefas',
          navParams: undefined,
        }));

      // ── Financeiro ────────────────────────────────────────────────────────
      const financeiroResults: SearchResult[] = agreements
        .map(a => {
          const client = clientById.get(a.client_id ?? '');
          return {
            a, client,
            s: topScore([a.title ?? '', client?.full_name ?? '', client?.cpf_cnpj ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ a, client, s }) => ({
          id: a.id, type: 'financeiro' as const,
          title: a.title,
          subtitle: client?.full_name || undefined,
          meta: `R$ ${a.total_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          score: s,
          navModule: 'financeiro',
          navParams: { entityId: a.id },
        }));

      // ── Cloud ─────────────────────────────────────────────────────────────
      const cloudResults: SearchResult[] = rootFolders
        .map(f => {
          const client = f.client_id ? clientById.get(f.client_id) : undefined;
          return {
            f, client,
            s: topScore([f.name ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ f, client, s }) => ({
          id: f.id, type: 'cloud' as const,
          title: f.name,
          subtitle: client?.full_name || undefined,
          meta: undefined,
          score: s,
          navModule: 'cloud',
          navParams: { folderId: f.id },
        }));

      // ── Merge + dedup ─────────────────────────────────────────────────────
      const merged = [
        ...clientResults, ...processResults, ...processViaClientResults,
        ...reqResults, ...prazoResults,
        ...agendaResults, ...tarefaResults, ...financeiroResults, ...cloudResults,
      ];
      const seen = new Set<string>();
      const deduped = merged.filter(r => {
        const key = `${r.type}:${r.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setResults(deduped);
      setSelected(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatResults.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && flatResults[selected]) handleSelect(flatResults[selected]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selected]);

  const handleSelect = (result: SearchResult) => {
    if (query.trim().length >= 2) saveRecent(query.trim());
    setRecentSearches(loadRecent());
    onNavigate(result.navModule, result.navParams);
    onClose();
  };

  if (!open) return null;

  // Group
  const grouped = GROUP_ORDER
    .map(type => ({
      type,
      cfg: TYPE_CONFIG[type],
      items: results.filter(r => r.type === type),
    }))
    .filter(g => g.items.length > 0);

  const flatResults = grouped.flatMap(g => g.items);
  const flatIdx = new Map(flatResults.map((r, i) => [`${r.type}:${r.id}`, i]));

  const isEmpty = query.trim().length === 0;
  const noResults = query.trim().length >= 2 && !loading && results.length === 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[82vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Input ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
          {loading ? <Loader2 className="w-4.5 h-4.5 text-amber-500 animate-spin flex-shrink-0" /> : <Search className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nome, processo, beneficiário, compromisso, pasta..."
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 bg-transparent outline-none"
          />
          <div className="flex items-center gap-2">
            {priming && !loading && (
              <span className="flex items-center gap-1 text-[10px] text-slate-300">
                <Zap className="w-3 h-3" /> aquecendo...
              </span>
            )}
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-300 hover:text-slate-500 p-0.5 transition">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 rounded border border-slate-200">Esc</kbd>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        {!isEmpty && results.length > 0 ? (
          <div className="overflow-y-auto flex-1 py-2">
            {grouped.map(({ type, cfg, items }) => (
              <div key={type}>
                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                  <cfg.icon className={`w-3 h-3 ${cfg.color.split(' ')[0]}`} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{cfg.group}</span>
                  <span className="text-[10px] text-slate-300 tabular-nums">({items.length})</span>
                </div>
                {items.map(r => {
                  const fi = flatIdx.get(`${r.type}:${r.id}`) ?? -1;
                  const isSelected = fi === selected;
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => handleSelect(r)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isSelected ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center border ${cfg.color} ${cfg.border}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          <Highlight text={r.title} query={query} />
                        </div>
                        {r.subtitle && (
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            <Highlight text={r.subtitle} query={query} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.meta && <span className="text-[10px] text-slate-400 tabular-nums">{r.meta}</span>}
                        {isSelected
                          ? <ArrowRight className="w-3.5 h-3.5 text-amber-500" />
                          : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : noResults ? (
          <div className="py-12 text-center text-sm text-slate-400 flex-1">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            Nenhum resultado para <strong>"{query}"</strong>
          </div>
        ) : isEmpty ? (
          <div className="flex-1 overflow-y-auto">
            {/* Buscas recentes */}
            {recentSearches.length > 0 && (
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> Buscas recentes
                  </span>
                  <button
                    onClick={() => { localStorage.removeItem(RECENT_KEY); setRecentSearches([]); }}
                    className="text-[10px] text-slate-300 hover:text-slate-500 transition"
                  >
                    Limpar
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recentSearches.map(r => (
                    <button
                      key={r}
                      onClick={() => setQuery(r)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-xs text-slate-600 transition border border-transparent hover:border-amber-200"
                    >
                      <Search className="w-3 h-3 opacity-50" />
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* O que você pode buscar */}
            <div className="px-4 pt-3 pb-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">O que você pode buscar</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                {[
                  { icon: Users,         label: 'Clientes',      desc: 'nome, CPF, e-mail' },
                  { icon: FileText,      label: 'Processos',     desc: 'número, comarca, partes' },
                  { icon: ClipboardList, label: 'Requerimentos', desc: 'beneficiário, CPF, protocolo' },
                  { icon: AlarmClock,    label: 'Prazos',        desc: 'título, cliente (pendentes)' },
                  { icon: Calendar,      label: 'Agenda',        desc: 'audiências, reuniões (futuros)' },
                  { icon: CheckSquare,   label: 'Tarefas',       desc: 'título, descrição' },
                  { icon: DollarSign,    label: 'Financeiro',    desc: 'título do acordo, cliente' },
                  { icon: FolderOpen,    label: 'Cloud',         desc: 'nome da pasta, cliente' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <Icon className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-700 leading-none mb-0.5">{label}</div>
                      <div className="text-slate-400 leading-tight">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Footer ── */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-400 flex-shrink-0 bg-white">
          <span><kbd className="bg-slate-100 px-1.5 rounded">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Enter</kbd> abrir</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Esc</kbd> fechar</span>
          {flatResults.length > 0 && (
            <span className="text-slate-300">{flatResults.length} resultado{flatResults.length !== 1 ? 's' : ''}</span>
          )}
          <span className="ml-auto font-mono opacity-50">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
