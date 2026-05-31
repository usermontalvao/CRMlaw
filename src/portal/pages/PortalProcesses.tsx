import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase, Search, Scale, Calendar, Clock, ChevronRight, Gavel, AlertCircle, X,
} from 'lucide-react';
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Meus Processos</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {counts.andamento} em andamento · {counts.arquivado} encerrados
        </p>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número, área ou situação..."
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {([
          { id: 'andamento' as Filter, label: 'Em andamento', count: counts.andamento },
          { id: 'arquivado' as Filter, label: 'Encerrados',   count: counts.arquivado },
          { id: 'all' as Filter,       label: 'Todos',        count: counts.all },
        ]).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold ring-1 transition ${
              filter === f.id ? 'bg-orange-500 text-white ring-orange-500 shadow-sm' : 'bg-white text-slate-600 ring-slate-200 active:bg-slate-100'
            }`}
          >
            {f.label}
            <span className={`min-w-[18px] rounded-full px-1.5 text-[10px] font-bold ${filter === f.id ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{f.count}</span>
          </button>
        ))}
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
        <div className="flex flex-col gap-3">
          {filtered.map((p) => <ProcessCard key={p.id} process={p} onClick={() => navigate('processos', p.id)} />)}
        </div>
      )}
    </div>
  );
};

const ProcessCard: React.FC<{ process: ProcessItem; onClick: () => void }> = ({ process: p, onClick }) => {
  const meta = statusMeta(p.status);
  const tone = TONE_CLASSES[meta.tone];
  const hasHearing = p.hearing_scheduled && p.hearing_date;
  const lastMov = p.last_movement?.nome;
  const lastMovDate = p.last_movement?.data_hora || p.last_movement?.data;
  const overdue = p.pending_deadlines ?? 0;

  return (
    <button
      onClick={onClick}
      className="group flex w-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] hover:border-orange-200 hover:shadow-md sm:p-5"
    >
      {/* Topo: ícone + código/área · badge de status */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 ring-1 ring-orange-100">
          <Briefcase className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px] font-bold text-slate-900">{p.process_code}</p>
          {p.practice_area && <p className="text-xs capitalize text-slate-400">{p.practice_area}</p>}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {meta.label}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-500" />
      </div>

      {/* Explicação curta */}
      <p className="text-[13px] leading-relaxed text-slate-600">{meta.explain}</p>

      {/* Última atualização */}
      {lastMov && (
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
          <span className="truncate">{lastMov}</span>
          <span className="ml-auto shrink-0 text-slate-400">{formatRelative(lastMovDate)}</span>
        </div>
      )}

      {/* Alertas (audiência / prazos) */}
      {(hasHearing || overdue > 0) && (
        <div className="flex flex-wrap gap-2">
          {hasHearing && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              <Calendar className="h-3 w-3" /> Audiência {formatDate(p.hearing_date)}
            </span>
          )}
          {overdue > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">
              <Clock className="h-3 w-3" /> {overdue} prazo{overdue > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </button>
  );
};

export default PortalProcesses;
