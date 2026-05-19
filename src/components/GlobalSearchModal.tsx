import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Search, X, FileText, Users, Loader2, ChevronRight, ArrowRight,
  ClipboardList, Calendar, CheckSquare, AlarmClock, DollarSign, FolderOpen,
  Clock, Zap, Gavel, PenTool, Sparkles, CornerDownLeft, LayoutGrid,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { requirementService } from '../services/requirement.service';
import { calendarService } from '../services/calendar.service';
import { taskService } from '../services/task.service';
import { deadlineService } from '../services/deadline.service';
import { financialService } from '../services/financial.service';
import { cloudService } from '../services/cloud.service';
import { signatureService } from '../services/signature.service';
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
  signatures: Awaited<ReturnType<typeof signatureService.listRequests>>;
}

let _cache: { data: SearchData; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getSearchData(force = false): Promise<SearchData> {
  if (!force && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL) {
    return _cache.data;
  }
  const [processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures] =
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
      signatureService.listRequests().catch(() => [] as Awaited<ReturnType<typeof signatureService.listRequests>>),
    ]);
  const data: SearchData = { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures };
  _cache = { data, fetchedAt: Date.now() };
  return data;
}

// Invalidar cache ao abrir (pre-warm na abertura)
export function invalidateSearchCache() { _cache = null; }

// ─── Types ────────────────────────────────────────────────────────────────────

type ResultType =
  | 'cliente' | 'processo' | 'processo-via-cliente' | 'intimacao'
  | 'requerimento' | 'prazo' | 'agenda' | 'tarefa' | 'financeiro' | 'cloud' | 'assinatura';

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
  assinatura:            { label: 'Assinatura',   icon: PenTool,       color: 'text-violet-600 bg-violet-50',   border: 'border-violet-200',  group: 'Assinaturas'   },
};

// Intimações removidas da exibição (ainda carregadas para extrair partes dos processos)
const GROUP_ORDER: ResultType[] = [
  'cliente', 'processo', 'processo-via-cliente', 'requerimento', 'prazo',
  'agenda', 'tarefa', 'financeiro', 'cloud', 'assinatura',
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
      <mark className="bg-amber-100 text-amber-800 rounded px-0.5 not-italic font-semibold">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const MAX_RECENT = 6;

// Chave por usuário — histórico isolado por conta
function recentKey(userId?: string) {
  return userId ? `globalSearch_recent_${userId}` : 'globalSearch_recent_anon';
}
function loadRecent(userId?: string): string[] {
  try { return JSON.parse(localStorage.getItem(recentKey(userId)) || '[]'); } catch { return []; }
}
function saveRecent(userId: string | undefined, q: string) {
  const key = recentKey(userId);
  const prev = loadRecent(userId).filter(r => r !== q);
  localStorage.setItem(key, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
}

// Mapa ResultType → chave do módulo (para checar permissão)
// Os nomes devem bater com a coluna `module` da tabela role_permissions
const TYPE_MODULE: Record<string, string> = {
  cliente:              'clientes',
  processo:             'processos',
  'processo-via-cliente': 'processos',
  intimacao:            'intimacoes',
  requerimento:         'requerimentos',
  prazo:                'prazos',
  agenda:               'agenda',
  tarefa:               'tarefas',
  financeiro:           'financeiro',
  cloud:                'documentos',
  assinatura:           'assinaturas',
};

// ─── Component ────────────────────────────────────────────────────────────────

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const { user } = useAuth();
  const { canView, isAdmin, loading: permissionsLoading } = usePermissions();

  // Verifica permissão: admins veem tudo; outros respeitam canView().
  // Se as permissões ainda estão carregando, libera tudo (será re-filtrado ao carregar).
  const canSeeModule = useCallback((moduleKey: string) => {
    if (isAdmin) return true;
    if (permissionsLoading) return true;
    return canView(moduleKey);
  }, [isAdmin, canView, permissionsLoading]);

  const userId = user?.id;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [priming, setPriming] = useState(false);
  const [selected, setSelected] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<ResultType | 'all'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset filtro ao mudar a query
  useEffect(() => { setActiveFilter('all'); setSelected(0); }, [query]);

  // Reset + pre-warm cache on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setActiveFilter('all');
      setRecentSearches(loadRecent(userId));
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

      const { processes, clients, intimacoes, requirements, events, tasks, deadlines, agreements, rootFolders, signatures } =
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
          navParams: { entityId: p.id }, // abre o modal diretamente
        }));

      // ── Processos via cliente ─────────────────────────────────────────────
      // Sem filtro de matchedClientIds — se o cliente bate na busca, TODOS os
      // seus processos devem aparecer (inclusive quando o card do cliente já aparece)
      const processViaClientResults: SearchResult[] = processes
        .filter(p => {
          if (!p.client_id) return false;
          const client = clientById.get(p.client_id);
          return client && topScore([client.full_name ?? ''], q2) > 0;
        })
        .slice(0, 6)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          const parties = partiesByProcessId.get(p.id);
          const clientScore = topScore([client?.full_name ?? ''], q2);
          return {
            id: p.id, type: 'processo-via-cliente' as const,
            title: p.process_code ?? 'Processo',
            subtitle: parties?.polo_ativo
              ? [parties.polo_ativo, parties.polo_passivo].filter(Boolean).join(' × ')
              : `${client?.full_name ?? ''}${p.court ? ' · ' + p.court : ''}`,
            meta: p.status,
            score: Math.max(3, clientScore - 2), // herda score do cliente, levemente menor
            navModule: 'processos',
            navParams: { entityId: p.id }, // abre o modal diretamente
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

      // ── Assinaturas ───────────────────────────────────────────────────────
      const STATUS_LABELS: Record<string, string> = {
        pending: 'Pendente', signed: 'Assinado', expired: 'Expirado', cancelled: 'Cancelado',
      };
      const assinaturaResults: SearchResult[] = signatures
        .map(r => {
          const client = r.client_id ? clientById.get(r.client_id) : undefined;
          return {
            r, client,
            s: topScore([r.document_name ?? '', r.client_name ?? '', client?.full_name ?? ''], q2),
          };
        })
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ r, client, s }) => ({
          id: r.id, type: 'assinatura' as const,
          title: r.document_name ?? 'Documento',
          subtitle: (client?.full_name ?? r.client_name) || undefined,
          meta: STATUS_LABELS[r.status] ?? r.status,
          score: s,
          navModule: 'assinaturas',
          navParams: { mode: 'details', requestId: r.id },
        }));

      // ── Merge + dedup ─────────────────────────────────────────────────────
      const merged = [
        ...clientResults, ...processResults, ...processViaClientResults,
        ...reqResults, ...prazoResults,
        ...agendaResults, ...tarefaResults, ...financeiroResults, ...cloudResults,
        ...assinaturaResults,
      ];
      const seen = new Set<string>();
      const deduped = merged.filter(r => {
        const key = `${r.type}:${r.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Armazena resultados brutos — o filtro de permissão é aplicado no render
      // via useMemo para reagir automaticamente quando as permissões terminam de carregar
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
      if (e.key === 'Tab') {
        e.preventDefault();
        if (filters.length > 1) {
          const idx = filters.findIndex(f => f.key === activeFilter);
          const next = e.shiftKey
            ? (idx - 1 + filters.length) % filters.length
            : (idx + 1) % filters.length;
          setActiveFilter(filters[next].key);
          setSelected(0);
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flatResults.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && flatResults[selected]) handleSelect(flatResults[selected]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selected, activeFilter]);

  const handleSelect = (result: SearchResult) => {
    if (query.trim().length >= 2) saveRecent(userId, query.trim());
    setRecentSearches(loadRecent(userId));
    onNavigate(result.navModule, result.navParams);
    onClose();
  };

  // Filtro de permissão aplicado no render — reage automaticamente quando
  // permissionsLoading muda de true→false sem precisar rebuscar
  const permitted = useMemo(
    () => results.filter(r => canSeeModule(TYPE_MODULE[r.type] ?? r.navModule)),
    [results, canSeeModule],
  );

  if (!open) return null;

  // Cor do ícone por tipo
  const TYPE_ICON_COLOR: Record<ResultType, string> = {
    cliente:                'text-slate-500 bg-slate-100',
    processo:               'text-amber-600 bg-amber-50',
    'processo-via-cliente': 'text-amber-600 bg-amber-50',
    intimacao:              'text-orange-600 bg-orange-50',
    requerimento:           'text-purple-600 bg-purple-50',
    prazo:                  'text-red-500 bg-red-50',
    agenda:                 'text-teal-600 bg-teal-50',
    tarefa:                 'text-sky-600 bg-sky-50',
    financeiro:             'text-emerald-600 bg-emerald-50',
    cloud:                  'text-indigo-600 bg-indigo-50',
    assinatura:             'text-violet-600 bg-violet-50',
  };

  // Contagem por tipo (respeitando dedupe de processo-via-cliente no grupo processo)
  const allGroups = GROUP_ORDER
    .map(type => ({ type, cfg: TYPE_CONFIG[type], items: permitted.filter(r => r.type === type) }))
    .filter(g => g.items.length > 0);

  // Chips de filtro: "Tudo" + tipos presentes (agrupa processo + processo-via-cliente)
  const filterDefs: { key: ResultType | 'all'; label: string; icon: React.ElementType }[] = [
    { key: 'all', label: 'Tudo', icon: Sparkles },
    ...allGroups
      .filter(g => g.type !== 'processo-via-cliente')
      .map(g => ({ key: g.type, label: g.cfg.group, icon: g.cfg.icon })),
  ];
  const countFor = (k: ResultType | 'all') =>
    k === 'all'
      ? permitted.length
      : k === 'processo'
      ? permitted.filter(r => r.type === 'processo' || r.type === 'processo-via-cliente').length
      : permitted.filter(r => r.type === k).length;
  const filters = filterDefs.map(f => ({ ...f, count: countFor(f.key) }));

  // Grupos visíveis conforme filtro ativo
  const grouped = allGroups.filter(g => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'processo') return g.type === 'processo' || g.type === 'processo-via-cliente';
    return g.type === activeFilter;
  });

  const flatResults = grouped.flatMap(g => g.items);
  const flatIdx = new Map(flatResults.map((r, i) => [`${r.type}:${r.id}`, i]));
  const safeSelected = Math.min(selected, Math.max(0, flatResults.length - 1));
  const previewItem = flatResults[safeSelected];

  const isEmpty = query.trim().length === 0;
  const noResults = query.trim().length >= 2 && !loading && permitted.length === 0;

  const previewCfg = previewItem ? TYPE_CONFIG[previewItem.type] : null;
  const showResults = !isEmpty && results.length > 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <style>{`
        @keyframes gsOverlayIn { from { opacity:0 } to { opacity:1 } }
        @keyframes gsModalIn {
          from { opacity:0; transform:translateY(-20px) scale(.95) }
          to   { opacity:1; transform:translateY(0)    scale(1)   }
        }
        @keyframes gsGlow { 0%,100% { opacity:.5 } 50% { opacity:1 } }
        .gs-overlay { animation: gsOverlayIn .22s ease-out }
        .gs-modal   { animation: gsModalIn .30s cubic-bezier(.16,1,.3,1) }
        .gs-chips   { scrollbar-width:none; -ms-overflow-style:none }
        .gs-chips::-webkit-scrollbar { display:none }

        /* ── Glass module cards ── */
        .gs-card {
          background: rgba(255,255,255,0.60);
          border: 1px solid rgba(255,255,255,0.80);
          backdrop-filter: blur(12px) saturate(160%);
          -webkit-backdrop-filter: blur(12px) saturate(160%);
          box-shadow:
            0 2px 10px -2px rgba(15,23,42,0.08),
            inset 0 1.5px 0 rgba(255,255,255,1),
            inset 1px 0 rgba(255,255,255,0.7);
          transition: all .18s cubic-bezier(.16,1,.3,1);
        }
        .gs-card:hover {
          background: rgba(254,243,199,0.72);
          border-color: rgba(251,191,36,0.55);
          transform: translateY(-1px) scale(1.015);
          box-shadow:
            0 8px 24px -4px rgba(245,158,11,0.22),
            inset 0 1.5px 0 rgba(255,255,255,1),
            inset 1px 0 rgba(255,255,255,0.7);
        }

        /* ── Glass filter chips ── */
        .gs-chip-btn {
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          transition: all .13s ease;
        }
        .gs-chip-btn.gs-active {
          background: rgb(245,158,11) !important;
          border-color: rgba(251,191,36,0.6) !important;
          color: white !important;
          box-shadow:
            0 2px 14px -2px rgba(245,158,11,0.5),
            inset 0 1.5px 0 rgba(255,255,255,0.35);
        }

        /* ── Result rows ── */
        .gs-result { transition: background .08s ease; }
        .gs-result:hover { background: rgba(255,255,255,0.72) !important; }
        .gs-result.gs-sel  { background: rgba(254,243,199,0.55) !important; }

        /* ── Recent search pills ── */
        .gs-recent-pill {
          background: rgba(255,255,255,0.62);
          border: 1px solid rgba(255,255,255,0.80);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 1px 4px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,1);
          transition: all .14s ease;
        }
        .gs-recent-pill:hover {
          background: rgba(254,243,199,0.80);
          border-color: rgba(251,191,36,0.5);
          color: rgb(120,53,15);
          box-shadow: 0 3px 10px -2px rgba(245,158,11,0.18), inset 0 1px 0 rgba(255,255,255,1);
        }

        /* ── Kbd glass keys ── */
        .gs-kbd {
          background: rgba(255,255,255,0.70);
          border: 1px solid rgba(203,213,225,0.60);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          box-shadow:
            0 1px 3px rgba(15,23,42,0.07),
            inset 0 1.5px 0 rgba(255,255,255,1),
            inset 0 -1px 0 rgba(15,23,42,0.06);
        }
      `}</style>

      {/* ── Overlay: cor apenas, SEM backdrop-filter ──
           O backdrop-filter fica no modal para que ele froste o conteúdo real da página */}
      <div
        className="gs-overlay absolute inset-0"
        style={{ background: 'rgba(10,18,38,0.42)' }}
      />

      {/* Ambient amber glow atrás do modal */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: 'calc(8vh - 60px)', left: '50%', transform: 'translateX(-50%)',
          width: 800, height: 300,
          background: 'radial-gradient(ellipse, rgba(245,158,11,0.16) 0%, transparent 68%)',
          animation: 'gsGlow 3.5s ease-in-out infinite',
          filter: 'blur(40px)',
        }}
      />

      {/* ════════════════════════════════════════════════
          MODAL — painel de vidro Aero
          Shell quase transparente, frost real sobre a página
          ════════════════════════════════════════════════ */}
      <div
        className="gs-modal relative w-full max-w-3xl mx-4 rounded-[20px] flex flex-col max-h-[82vh]"
        style={{
          /* Vidro: pouco branco + blur forte = frosted glass real */
          background: 'rgba(255,255,255,0.14)',
          backdropFilter: 'blur(64px) saturate(200%) brightness(115%)',
          WebkitBackdropFilter: 'blur(64px) saturate(200%) brightness(115%)',

          /* Borda de vidro: branca e fina */
          border: '1px solid rgba(255,255,255,0.42)',

          /* Sombras: profundidade + highlights de vidro inset */
          boxShadow: [
            /* ── Highlights inset — ASSINATURA do Aero ── */
            'inset 0 2px 0 rgba(255,255,255,0.95)',   /* topo brilhante */
            'inset 1.5px 0 rgba(255,255,255,0.60)',   /* esquerda brilhante */
            'inset -1px 0 rgba(255,255,255,0.30)',    /* direita sutil */
            'inset 0 -1px 0 rgba(255,255,255,0.20)',  /* baixo sutil */
            /* ── Borda externa escura ── */
            '0 0 0 1px rgba(0,0,0,0.18)',
            /* ── Sombra profunda ── */
            '0 40px 120px -16px rgba(0,0,0,0.65)',
            '0 16px 48px -8px rgba(0,0,0,0.32)',
            /* ── Glow âmbar ── */
            '0 0 80px -20px rgba(245,158,11,0.22)',
          ].join(', '),

          /* Clip sem overflow:hidden para não interferir no backdrop-filter */
          clipPath: 'inset(0 round 20px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Reflexo de vidro — camada de luz diagonal ──
             Imita a reflexão característica do Aero sobre o vidro */}
        <div
          className="absolute inset-0 pointer-events-none rounded-[20px]"
          style={{ zIndex: 30 }}
        >
          {/* Brilho diagonal topo-esquerdo */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(148deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.18) 28%, transparent 52%)',
            borderRadius: 'inherit',
          }} />
          {/* Linha de reflexo na borda superior */}
          <div style={{
            position: 'absolute', top: 2, left: 12, right: 12, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9) 20%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.9) 80%, transparent)',
            borderRadius: 2,
          }} />
          {/* Glint no canto superior direito */}
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 120, height: 80,
            background: 'radial-gradient(ellipse at top right, rgba(255,255,255,0.22) 0%, transparent 70%)',
          }} />
        </div>

        {/* ── Faixa âmbar: luz refratada no topo do vidro ── */}
        <div className="flex-shrink-0" style={{
          height: 3,
          background: 'linear-gradient(90deg, transparent 0%, rgba(253,230,138,0.5) 10%, rgba(251,191,36,0.92) 32%, rgba(245,158,11,1) 50%, rgba(251,191,36,0.92) 68%, rgba(253,230,138,0.5) 90%, transparent 100%)',
          boxShadow: '0 0 12px 1px rgba(245,158,11,0.4)',
        }} />

        {/* ── Input — painel mais opaco para conforto de digitação ── */}
        <div
          className="flex items-center gap-3 px-5 py-3.5 flex-shrink-0"
          style={{
            background: 'rgba(255,255,255,0.86)',
            borderBottom: '1px solid rgba(255,255,255,0.50)',
          }}
        >
          <div className="relative flex-shrink-0">
            {loading
              ? <Loader2 className="w-[19px] h-[19px] text-amber-500 animate-spin" />
              : <Search className="w-[19px] h-[19px] text-amber-500" />
            }
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar clientes, processos, prazos, documentos…"
            className="flex-1 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent outline-none font-normal"
          />
          <div className="flex items-center gap-2">
            {priming && !loading && (
              <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium">
                <Zap className="w-3 h-3" /> indexando…
              </span>
            )}
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
                style={{ background: 'rgba(241,245,249,0.8)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="hidden sm:inline-flex px-2 py-1 text-[10px] font-semibold text-slate-500 rounded-md transition-colors"
              style={{
                background: 'rgba(255,255,255,0.80)',
                border: '1px solid rgba(203,213,225,0.65)',
                boxShadow: '0 1px 3px rgba(15,23,42,0.07), inset 0 1.5px 0 rgba(255,255,255,1)',
              }}
            >
              ESC
            </button>
          </div>
        </div>

        {/* ── Chips de filtro — vidro semitransparente ── */}
        {showResults && filters.length > 1 && (
          <div
            className="gs-chips flex items-center gap-1.5 px-5 py-2 overflow-x-auto flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.55)',
              borderBottom: '1px solid rgba(255,255,255,0.48)',
            }}
          >
            {filters.map(f => {
              const active = f.key === activeFilter;
              const FIcon = f.icon;
              return (
                <button
                  key={f.key}
                  onClick={() => { setActiveFilter(f.key); setSelected(0); }}
                  className={`gs-chip-btn${active ? ' gs-active' : ''} group inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap`}
                  style={!active ? {
                    background: 'rgba(255,255,255,0.72)',
                    border: '1px solid rgba(203,213,225,0.55)',
                    color: 'rgb(100,116,139)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,1)',
                  } : {}}
                >
                  <FIcon className={`w-3 h-3 ${active ? 'text-white' : 'text-slate-400 group-hover:text-amber-500'}`} />
                  {f.label}
                  <span
                    className={`tabular-nums text-[10px] px-1 rounded-full ${active ? 'bg-white/25 text-white' : 'text-slate-400'}`}
                    style={!active ? { background: 'rgba(203,213,225,0.45)' } : {}}
                  >
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Body ── */}
        <div
          className="flex flex-1 min-h-0"
          style={{ borderTop: (!showResults || filters.length <= 1) ? '1px solid rgba(255,255,255,0.45)' : undefined }}
        >
          {/* Coluna esquerda */}
          <div
            className={`flex-1 min-w-0 overflow-y-auto ${showResults && previewItem ? 'sm:border-r' : ''}`}
            style={{
              background: 'rgba(255,255,255,0.82)',
              borderColor: 'rgba(255,255,255,0.50)',
            }}
          >
            {showResults ? (
              <div className="py-1.5">
                {grouped.map(({ type, cfg, items }) => (
                  <div key={type}>
                    {/* Header do grupo */}
                    <div className="flex items-center gap-2 px-5 pt-3 pb-1">
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{cfg.group}</span>
                      <span className="text-[9px] text-slate-300 tabular-nums">{items.length}</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(203,213,225,0.50)' }} />
                    </div>

                    {items.map(r => {
                      const fi = flatIdx.get(`${r.type}:${r.id}`) ?? -1;
                      const isSelected = fi === safeSelected;
                      const Icon = cfg.icon;
                      const iconCls = TYPE_ICON_COLOR[r.type];
                      return (
                        <button
                          key={`${r.type}-${r.id}`}
                          onClick={() => handleSelect(r)}
                          onMouseEnter={() => setSelected(fi)}
                          className={`gs-result${isSelected ? ' gs-sel' : ''} relative w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-left`}
                        >
                          {/* Barra âmbar de seleção */}
                          {isSelected && (
                            <div
                              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full"
                              style={{ background: 'linear-gradient(180deg, #fbbf24, #f59e0b)' }}
                            />
                          )}

                          {/* Ícone */}
                          <span
                            className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${iconCls} ${isSelected ? 'scale-105' : ''} transition-transform`}
                            style={{
                              boxShadow: isSelected
                                ? '0 3px 10px -2px rgba(245,158,11,0.25), inset 0 1.5px 0 rgba(255,255,255,0.85)'
                                : 'inset 0 1.5px 0 rgba(255,255,255,0.85)',
                            }}
                          >
                            <Icon className="w-[18px] h-[18px]" />
                          </span>

                          {/* Texto */}
                          <div className="flex-1 min-w-0">
                            <div className={`text-[13px] font-medium truncate ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                              <Highlight text={r.title} query={query} />
                            </div>
                            {r.subtitle && (
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                <Highlight text={r.subtitle} query={query} />
                              </div>
                            )}
                          </div>

                          {/* Meta + chevron */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {r.meta && (
                              <span
                                className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-md font-medium ${isSelected ? 'bg-amber-100 text-amber-700' : 'text-slate-500'}`}
                                style={!isSelected ? { background: 'rgba(203,213,225,0.40)' } : {}}
                              >
                                {r.meta}
                              </span>
                            )}
                            <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-amber-500' : 'text-slate-300'}`} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

            ) : noResults ? (
              <div className="py-16 flex flex-col items-center justify-center gap-3 h-full">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: 'rgba(255,255,255,0.75)',
                    border: '1px solid rgba(255,255,255,0.88)',
                    boxShadow: '0 4px 16px -4px rgba(15,23,42,0.10), inset 0 2px 0 rgba(255,255,255,1)',
                  }}
                >
                  <Search className="w-5 h-5 text-slate-300" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-slate-400">Nenhum resultado para</p>
                  <p className="text-sm font-semibold text-slate-600 mt-0.5">"{query}"</p>
                  <p className="text-[11px] text-slate-400 mt-2">Tente outro nome, número ou CPF</p>
                </div>
              </div>

            ) : isEmpty ? (
              <div className="py-1">
                {/* Recentes */}
                {recentSearches.length > 0 && (
                  <div className="px-5 pt-4 pb-1">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" /> Recentes
                      </span>
                      <button
                        onClick={() => { localStorage.removeItem(recentKey(userId)); setRecentSearches([]); }}
                        className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        Limpar
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {recentSearches.map(r => (
                        <button
                          key={r}
                          onClick={() => setQuery(r)}
                          className="gs-recent-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-slate-500"
                        >
                          <Search className="w-3 h-3 opacity-50" />
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Acesso rápido */}
                <div className="px-5 pt-3 pb-4">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-2.5 flex items-center gap-1.5">
                    <LayoutGrid className="w-3 h-3" /> Acesso rápido
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {([
                      { icon: Users,         label: 'Clientes',      desc: 'nome, CPF, e-mail',          module: 'clientes',      color: 'text-slate-500 bg-slate-100'    },
                      { icon: FileText,      label: 'Processos',     desc: 'número, comarca, partes',     module: 'processos',     color: 'text-amber-600 bg-amber-50'     },
                      { icon: ClipboardList, label: 'Requerimentos', desc: 'beneficiário, protocolo',     module: 'requerimentos', color: 'text-purple-600 bg-purple-50'   },
                      { icon: AlarmClock,    label: 'Prazos',        desc: 'título, cliente',             module: 'prazos',        color: 'text-red-500 bg-red-50'         },
                      { icon: Calendar,      label: 'Agenda',        desc: 'audiências, reuniões',        module: 'agenda',        color: 'text-teal-600 bg-teal-50'       },
                      { icon: CheckSquare,   label: 'Tarefas',       desc: 'título, descrição',           module: 'tarefas',       color: 'text-sky-600 bg-sky-50'         },
                      { icon: DollarSign,    label: 'Financeiro',    desc: 'acordo, cliente',             module: 'financeiro',    color: 'text-emerald-600 bg-emerald-50' },
                      { icon: FolderOpen,    label: 'Cloud',         desc: 'pasta, cliente',              module: 'cloud',         color: 'text-indigo-600 bg-indigo-50'   },
                      { icon: PenTool,       label: 'Assinaturas',   desc: 'documento, cliente',          module: 'assinaturas',   color: 'text-violet-600 bg-violet-50'   },
                    ] as { icon: React.ElementType; label: string; desc: string; module: string; color: string }[])
                      .filter(item => canSeeModule(item.module))
                      .map(({ icon: Icon, label, desc, color, module }) => (
                        <button
                          key={label}
                          onClick={() => { onNavigate(module, undefined); onClose(); }}
                          className="gs-card flex items-center gap-2.5 p-3 rounded-xl text-left group"
                        >
                          <span
                            className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${color} group-hover:scale-110 transition-transform`}
                            style={{ boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.85)' }}
                          >
                            <Icon className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-slate-600 group-hover:text-amber-800 leading-none mb-0.5 truncate transition-colors">{label}</div>
                            <div className="text-[10px] text-slate-400 leading-tight truncate">{desc}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* ── Preview pane — painel de vidro mais profundo ── */}
          {showResults && previewItem && previewCfg && (
            <div
              className="hidden sm:flex w-[260px] flex-shrink-0 flex-col p-5"
              style={{
                background: 'rgba(240,246,255,0.88)',
                borderLeft: '1px solid rgba(255,255,255,0.65)',
              }}
            >
              {/* Ícone grande */}
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${TYPE_ICON_COLOR[previewItem.type]}`}
                style={{
                  boxShadow: '0 6px 20px -6px rgba(15,23,42,0.14), inset 0 2px 0 rgba(255,255,255,1)',
                }}
              >
                <previewCfg.icon className="w-7 h-7" />
              </div>

              {/* Badge tipo */}
              <span
                className="inline-flex self-start items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2"
                style={{
                  background: 'rgba(255,255,255,0.82)',
                  border: '1px solid rgba(255,255,255,0.90)',
                  boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,1), 0 1px 4px rgba(15,23,42,0.07)',
                }}
              >
                {previewCfg.label}
              </span>

              {/* Título */}
              <h3 className="text-[15px] font-semibold text-slate-900 leading-snug mb-1 break-words">
                {previewItem.title}
              </h3>

              {previewItem.subtitle && (
                <p className="text-[12px] text-slate-500 leading-relaxed break-words">
                  {previewItem.subtitle}
                </p>
              )}

              {/* Meta chip */}
              {previewItem.meta && (
                <div
                  className="mt-3 inline-flex self-start items-center gap-1.5 text-[11px] font-medium text-slate-600 px-2 py-1 rounded-lg"
                  style={{
                    background: 'rgba(255,255,255,0.82)',
                    border: '1px solid rgba(255,255,255,0.85)',
                    boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,1)',
                  }}
                >
                  {previewItem.meta}
                </div>
              )}

              {/* Botão Abrir */}
              <div className="mt-auto pt-4">
                <button
                  onClick={() => handleSelect(previewItem)}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-[12px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(145deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%)',
                    boxShadow: '0 6px 22px -4px rgba(245,158,11,0.6), inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.12)',
                  }}
                >
                  Abrir
                  <CornerDownLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer — vidro fosco ── */}
        <div
          className="px-5 py-2.5 flex items-center gap-3 text-[10px] text-slate-400 flex-shrink-0"
          style={{
            background: 'rgba(248,250,253,0.88)',
            borderTop: '1px solid rgba(255,255,255,0.65)',
          }}
        >
          <span className="flex items-center gap-1">
            <kbd className="gs-kbd px-1.5 py-0.5 rounded text-slate-500 text-[10px]">↑↓</kbd>
            navegar
          </span>
          {showResults && filters.length > 1 && (
            <span className="flex items-center gap-1">
              <kbd className="gs-kbd px-1.5 py-0.5 rounded text-slate-500 text-[10px]">Tab</kbd>
              filtrar
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="gs-kbd px-1.5 py-0.5 rounded text-slate-500 text-[10px]">↵</kbd>
            abrir
          </span>
          {flatResults.length > 0 && (
            <span className="text-slate-400 tabular-nums font-medium">
              {flatResults.length} resultado{flatResults.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-slate-300 text-[9px]">
            <Sparkles className="w-3 h-3 text-amber-400" /> ⌘K · Ctrl+K
          </span>
        </div>
      </div>
    </div>
  );
};
