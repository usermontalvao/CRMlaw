import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search, X, FileText, Users, Gavel, Loader2, ChevronRight, ArrowRight,
  ClipboardList, Calendar, CheckSquare, AlarmClock,
} from 'lucide-react';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { djenLocalService } from '../services/djenLocal.service';
import { requirementService } from '../services/requirement.service';
import { calendarService } from '../services/calendar.service';
import { taskService } from '../services/task.service';
import { deadlineService } from '../services/deadline.service';
import { matchesNormalizedSearch } from '../utils/search';
import type { Client } from '../types/client.types';

// ─── Result types ────────────────────────────────────────────────────────────

type ResultType =
  | 'cliente'
  | 'processo'
  | 'processo-via-cliente'
  | 'intimacao'
  | 'requerimento'
  | 'prazo'
  | 'agenda'
  | 'tarefa';

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  navModule: string;
  /** Params passed directly to navigateTo — no extra wrapping */
  navParams?: Record<string, string>;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  /** navigateTo(module, params) — params stored as JSON in moduleParams[module] */
  onNavigate: (module: string, params?: Record<string, string>) => void;
}

// ─── Visual config per type ───────────────────────────────────────────────────

const TYPE_CONFIG: Record<ResultType, {
  label: string;
  icon: React.ElementType;
  color: string;
  border: string;
  group: string;
}> = {
  cliente:               { label: 'Cliente',       icon: Users,         color: 'text-slate-600 bg-slate-100',   border: 'border-slate-200',  group: 'Clientes'      },
  processo:              { label: 'Processo',      icon: FileText,      color: 'text-amber-600 bg-amber-50',    border: 'border-amber-200',  group: 'Processos'     },
  'processo-via-cliente':{ label: 'Processo',      icon: FileText,      color: 'text-amber-600 bg-amber-50',    border: 'border-amber-200',  group: 'Processos'     },
  intimacao:             { label: 'Intimação',     icon: Gavel,         color: 'text-orange-600 bg-orange-50',  border: 'border-orange-200', group: 'Intimações'    },
  requerimento:          { label: 'Requerimento',  icon: ClipboardList, color: 'text-purple-600 bg-purple-50',  border: 'border-purple-200', group: 'Requerimentos' },
  prazo:                 { label: 'Prazo',         icon: AlarmClock,    color: 'text-red-600 bg-red-50',        border: 'border-red-200',    group: 'Prazos'        },
  agenda:                { label: 'Agenda',        icon: Calendar,      color: 'text-teal-600 bg-teal-50',      border: 'border-teal-200',   group: 'Agenda'        },
  tarefa:                { label: 'Tarefa',        icon: CheckSquare,   color: 'text-sky-600 bg-sky-50',        border: 'border-sky-200',    group: 'Tarefas'       },
};

const GROUP_ORDER: ResultType[] = [
  'cliente', 'processo', 'processo-via-cliente', 'requerimento', 'prazo', 'intimacao', 'agenda', 'tarefa',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalizeStr = (s: string) =>
  (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();

const BENEFIT_LABELS: Record<string, string> = {
  bpc_loas: 'BPC LOAS',
  bpc_loas_deficiencia: 'BPC LOAS - Deficiência',
  bpc_loas_idoso: 'BPC LOAS - Idoso',
  aposentadoria_tempo: 'Aposent. Tempo Contribuição',
  aposentadoria_idade: 'Aposent. por Idade',
  aposentadoria_invalidez: 'Aposent. por Invalidez',
  auxilio_acidente: 'Auxílio Acidente',
  auxilio_doenca: 'Auxílio Doença',
  pensao_morte: 'Pensão por Morte',
  salario_maternidade: 'Salário Maternidade',
  outro: 'Outro',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

// ─── Component ───────────────────────────────────────────────────────────────

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  // ── Search ──────────────────────────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const q2 = q.trim();
      const nq = normalizeStr(q2);

      // Parallel fetch all data
      const now = new Date().toISOString();
      const [processes, clients, intimacoes, requirements, events, tasks, deadlines] = await Promise.all([
        processService.listProcesses(),
        clientService.listClients(),
        djenLocalService.listComunicacoes({}),
        requirementService.listRequirements().catch(() => []),
        // Agenda: only future/today events
        calendarService.listEvents().catch(() => [] as Awaited<ReturnType<typeof calendarService.listEvents>>),
        taskService.listTasks().catch(() => []),
        deadlineService.listDeadlines().catch(() => []),
      ]);

      const clientById = new Map<string, Client>(clients.map(c => [c.id, c]));

      // ── Clientes ──────────────────────────────────────────────────────────
      const clientResults: SearchResult[] = clients
        .filter(c => matchesNormalizedSearch(q2, [c.full_name ?? '', c.cpf_cnpj ?? '', c.email ?? '', c.phone ?? '']))
        .slice(0, 5)
        .map(c => ({
          id: c.id,
          type: 'cliente',
          title: c.full_name ?? 'Cliente',
          subtitle: [c.cpf_cnpj, c.email].filter(Boolean).join(' · ') || undefined,
          meta: c.phone || undefined,
          navModule: 'clientes',
          // Direct params — navigateTo('clientes', { mode: 'details', entityId: id })
          navParams: { mode: 'details', entityId: c.id },
        }));

      const matchedClientIds = new Set(clientResults.map(r => r.id));

      // ── Processos ─────────────────────────────────────────────────────────
      const processResults: SearchResult[] = processes
        .filter(p => matchesNormalizedSearch(q2, [p.process_code ?? '', p.court ?? '', p.responsible_lawyer ?? '']))
        .slice(0, 5)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          return {
            id: p.id,
            type: 'processo' as const,
            title: p.process_code ?? 'Processo',
            subtitle: [p.court, client?.full_name].filter(Boolean).join(' · ') || undefined,
            meta: p.status,
            navModule: 'processos',
            navParams: { searchQuery: p.process_code ?? '' },
          };
        });

      // ── Processos via cliente ─────────────────────────────────────────────
      const processViaClientResults: SearchResult[] = processes
        .filter(p => {
          if (!p.client_id) return false;
          const client = clientById.get(p.client_id);
          if (!client) return false;
          return !matchedClientIds.has(p.client_id) &&
            matchesNormalizedSearch(q2, [client.full_name ?? '']);
        })
        .slice(0, 4)
        .map(p => {
          const client = clientById.get(p.client_id ?? '');
          return {
            id: p.id,
            type: 'processo-via-cliente' as const,
            title: p.process_code ?? 'Processo',
            subtitle: `Cliente: ${client?.full_name ?? ''}${p.court ? ' · ' + p.court : ''}`,
            meta: p.status,
            navModule: 'processos',
            navParams: { searchQuery: p.process_code ?? '' },
          };
        });

      // ── Intimações ────────────────────────────────────────────────────────
      const intimacaoResults: SearchResult[] = intimacoes
        .filter(i => {
          const fields = [
            i.numero_processo ?? '', i.polo_ativo ?? '', i.polo_passivo ?? '',
            i.tipo_documento ?? '', i.nome_classe ?? '',
            (i.texto ?? '').slice(0, 400),
          ].map(normalizeStr);
          return fields.some(f => f.includes(nq));
        })
        .slice(0, 5)
        .map(i => ({
          id: i.id,
          type: 'intimacao' as const,
          title: i.numero_processo ?? 'Intimação',
          subtitle: [i.polo_ativo, i.polo_passivo].filter(Boolean).join(' × ') ||
                    i.tipo_documento || undefined,
          meta: fmtDate(i.data_disponibilizacao),
          navModule: 'intimacoes',
          navParams: undefined,
        }));

      // ── Requerimentos ─────────────────────────────────────────────────────
      const reqResults: SearchResult[] = requirements
        .filter(r => {
          const fields = [
            r.beneficiary ?? '', r.cpf ?? '', r.protocol ?? '',
            BENEFIT_LABELS[r.benefit_type] ?? '',
          ].map(normalizeStr);
          return fields.some(f => f.includes(nq));
        })
        .slice(0, 4)
        .map(r => ({
          id: r.id,
          type: 'requerimento' as const,
          title: r.beneficiary ?? 'Requerimento',
          subtitle: [BENEFIT_LABELS[r.benefit_type], r.protocol].filter(Boolean).join(' · ') || undefined,
          meta: r.cpf || undefined,
          navModule: 'requerimentos',
          navParams: { entityId: r.id },
        }));

      // ── Agenda (somente eventos futuros / hoje) ───────────────────────────
      const agendaResults: SearchResult[] = events
        .filter(e => {
          // Somente compromissos não passados (start_at >= hoje)
          if (e.start_at < now.slice(0, 10)) return false;
          const fields = [
            e.title ?? '', e.description ?? '', e.client_name ?? '',
            EVENT_TYPE_LABELS[e.event_type] ?? '',
          ].map(normalizeStr);
          return fields.some(f => f.includes(nq));
        })
        .slice(0, 4)
        .map(e => ({
          id: e.id,
          type: 'agenda' as const,
          title: e.title ?? 'Compromisso',
          subtitle: [EVENT_TYPE_LABELS[e.event_type], e.client_name].filter(Boolean).join(' · ') || undefined,
          meta: fmtDate(e.start_at),
          navModule: 'agenda',
          navParams: { mode: 'event', entityId: e.id },
        }));

      // ── Prazos (pendentes/vencidos, não cumpridos/cancelados) ─────────────
      const PRIORITY_LABEL: Record<string, string> = {
        urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa',
      };
      const prazoResults: SearchResult[] = deadlines
        .filter(d => {
          if (d.status === 'cumprido' || d.status === 'cancelado') return false;
          const fields = [d.title ?? '', d.description ?? ''].map(normalizeStr);
          const client = clientById.get(d.client_id ?? '');
          if (client) fields.push(normalizeStr(client.full_name ?? ''));
          return fields.some(f => f.includes(nq));
        })
        .slice(0, 4)
        .map(d => {
          const client = clientById.get(d.client_id ?? '');
          const isOverdue = d.due_date < now.slice(0, 10) && d.status === 'pendente';
          return {
            id: d.id,
            type: 'prazo' as const,
            title: d.title,
            subtitle: client?.full_name || undefined,
            meta: `${fmtDate(d.due_date)}${isOverdue ? ' ⚠' : ''}`,
            navModule: 'prazos',
            navParams: { entityId: d.id },
          };
        });

      // ── Tarefas ───────────────────────────────────────────────────────────
      const tarefaResults: SearchResult[] = tasks
        .filter(t => {
          const fields = [t.title ?? '', t.description ?? ''].map(normalizeStr);
          return fields.some(f => f.includes(nq));
        })
        .slice(0, 4)
        .map(t => {
          const client = clientById.get(t.client_id ?? '');
          return {
            id: t.id,
            type: 'tarefa' as const,
            title: t.title ?? 'Tarefa',
            subtitle: client?.full_name || undefined,
            meta: t.due_date ? fmtDate(t.due_date) : undefined,
            navModule: 'tarefas',
            navParams: undefined,
          };
        });

      // ── Merge + dedup ─────────────────────────────────────────────────────
      const merged = [
        ...clientResults,
        ...processResults,
        ...processViaClientResults,
        ...reqResults,
        ...prazoResults,
        ...intimacaoResults,
        ...agendaResults,
        ...tarefaResults,
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
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[selected]) handleSelect(results[selected]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selected]);

  const handleSelect = (result: SearchResult) => {
    onNavigate(result.navModule, result.navParams);
    onClose();
  };

  if (!open) return null;

  // Group results for display
  const grouped = GROUP_ORDER
    .map(type => ({
      type,
      cfg: TYPE_CONFIG[type],
      items: results.filter(r => r.type === type),
    }))
    .filter(g => g.items.length > 0);

  // Flat list for keyboard selection (preserving group order)
  const flatResults = grouped.flatMap(g => g.items);
  // Map from result id+type to flat index
  const flatIdx = new Map(flatResults.map((r, i) => [`${r.type}:${r.id}`, i]));

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[82vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Input ── */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
          <Search className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nome, processo, CPF, beneficiário, compromisso, tarefa..."
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 bg-transparent outline-none"
          />
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 rounded border border-slate-200">Esc</kbd>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-0.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Results ── */}
        {results.length > 0 ? (
          <div className="overflow-y-auto flex-1 py-2">
            {grouped.map(({ type, cfg, items }) => (
              <div key={type}>
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                  <cfg.icon className={`w-3 h-3 ${cfg.color.split(' ')[0]}`} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{cfg.group}</span>
                  <span className="text-[10px] font-semibold text-slate-300 tabular-nums">({items.length})</span>
                </div>
                {/* Items */}
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
                        <div className="text-sm font-semibold text-slate-900 truncate">{r.title}</div>
                        {r.subtitle && <div className="text-xs text-slate-400 truncate mt-0.5">{r.subtitle}</div>}
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
        ) : query.trim().length >= 2 && !loading ? (
          <div className="py-12 text-center text-sm text-slate-400 flex-1">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
            Nenhum resultado para <strong>"{query}"</strong>
          </div>
        ) : query.trim().length === 0 ? (
          <div className="px-6 py-6 flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4 text-center">O que você pode buscar</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-slate-600">
              {[
                { icon: Users,         label: 'Clientes',       desc: 'nome, CPF, e-mail, telefone' },
                { icon: FileText,      label: 'Processos',      desc: 'número, comarca, advogado' },
                { icon: Gavel,         label: 'Intimações',     desc: 'polo, número, tipo de doc' },
                { icon: ClipboardList, label: 'Requerimentos',  desc: 'beneficiário, CPF, protocolo' },
                { icon: AlarmClock,    label: 'Prazos',         desc: 'título, cliente (pendentes)' },
                { icon: Calendar,      label: 'Agenda',         desc: 'futuros: audiências, reuniões' },
                { icon: CheckSquare,   label: 'Tarefas',        desc: 'título, descrição' },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Icon className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-700">{label}</div>
                    <div className="text-slate-400 leading-tight mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Footer ── */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 text-[10px] text-slate-400 flex-shrink-0">
          <span><kbd className="bg-slate-100 px-1.5 rounded">↑↓</kbd> navegar</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Enter</kbd> abrir</span>
          <span><kbd className="bg-slate-100 px-1.5 rounded">Esc</kbd> fechar</span>
          {results.length > 0 && (
            <span className="text-slate-300">{flatResults.length} resultado{flatResults.length !== 1 ? 's' : ''}</span>
          )}
          <span className="ml-auto font-mono opacity-50">⌘K · Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
