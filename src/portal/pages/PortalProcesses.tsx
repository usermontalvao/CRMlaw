import React, { useEffect, useMemo, useState } from 'react';
import { Search, Scale, X, ChevronRight } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, formatDate, formatRelative } from '../components/PortalUI';
import { statusMeta, TONE_CLASSES } from '../lib/domain';

interface ProcessItem {
  id: string;
  process_code: string;
  status: string;
  practice_area?: string | null;
  court?: string | null;
  distributed_at?: string | null;
  hearing_scheduled?: boolean | null;
  hearing_date?: string | null;
  responsible_lawyer?: string | null;
  updated_at?: string | null;
  movements_count?: number;
  last_movement?: { nome?: string; data_hora?: string; data?: string } | null;
  pending_deadlines?: number;
}

type Filter = 'andamento' | 'arquivado' | 'all';

export const PortalProcesses: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('andamento');

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    setLoading(true);
    clientPortalService.listProcesses(session.user.id)
      .then((data) => mounted && setProcesses(data as ProcessItem[]))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id]);

  const counts = useMemo(() => ({
    all:        processes.length,
    andamento:  processes.filter((p) => p.status !== 'arquivado').length,
    arquivado:  processes.filter((p) => p.status === 'arquivado').length,
  }), [processes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return processes.filter((p) => {
      if (filter === 'andamento' && p.status === 'arquivado') return false;
      if (filter === 'arquivado' && p.status !== 'arquivado') return false;
      if (!q) return true;
      const m = statusMeta(p.status);
      return (
        p.process_code?.toLowerCase().includes(q) ||
        p.court?.toLowerCase().includes(q) ||
        p.practice_area?.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q)
      );
    });
  }, [processes, search, filter]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Meus processos</h1>
        <p className="mt-1 text-sm text-slate-500">
          <span className="tabular-nums">{counts.andamento}</span> em andamento
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="tabular-nums">{counts.arquivado}</span> encerrado{counts.arquivado === 1 ? '' : 's'}
        </p>
      </header>

      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número, área ou situação"
          className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros — segmentado sóbrio (preto/branco; laranja fica reservado) */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {([
          { id: 'andamento' as Filter, label: 'Em andamento', count: counts.andamento },
          { id: 'arquivado' as Filter, label: 'Encerrados',   count: counts.arquivado },
          { id: 'all' as Filter,       label: 'Todos',        count: counts.all },
        ]).map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
                on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
              <span className={`tabular-nums text-[11px] font-semibold ${on ? 'text-white/60' : 'text-slate-400'}`}>{f.count}</span>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={search ? 'Nenhum processo encontrado' : 'Nenhum processo'}
          description={search ? 'Tente outros termos de busca.' : 'Quando o escritório vincular processos ao seu CPF, eles aparecerão aqui.'}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((p) => <ProcessRow key={p.id} process={p} onClick={() => navigate('processos', p.id)} />)}
        </ul>
      )}
    </div>
  );
};

const ProcessRow: React.FC<{ process: ProcessItem; onClick: () => void }> = ({ process: p, onClick }) => {
  const meta = statusMeta(p.status);
  const tone = TONE_CLASSES[meta.tone];
  const hasHearing = p.hearing_scheduled && p.hearing_date;
  const lastMov = p.last_movement?.nome;
  const lastMovDate = p.last_movement?.data_hora || p.last_movement?.data;
  const overdue = p.pending_deadlines ?? 0;
  const subtitle = [p.practice_area, p.court].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        onClick={onClick}
        className="group w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5"
      >
        {/* Linha 1: número + status */}
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold tabular-nums text-slate-900">{p.process_code}</p>
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className={`text-xs font-medium ${tone.text}`}>{meta.label}</span>
          </span>
        </div>

        {subtitle && <p className="mt-0.5 truncate text-xs capitalize text-slate-400">{subtitle}</p>}

        {/* Última atualização */}
        {lastMov && (
          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-[13px] text-slate-600">
            <span className="min-w-0 flex-1 truncate">{lastMov}</span>
            <span className="shrink-0 tabular-nums text-xs text-slate-400">{formatRelative(lastMovDate)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
          </div>
        )}

        {/* Alertas discretos (texto + ponto, sem pílula gritante) */}
        {(hasHearing || overdue > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {hasHearing && (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Audiência {formatDate(p.hearing_date)}
              </span>
            )}
            {overdue > 0 && (
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span className="tabular-nums">{overdue}</span> prazo{overdue > 1 ? 's' : ''} em aberto
              </span>
            )}
          </div>
        )}
      </button>
    </li>
  );
};

export default PortalProcesses;
