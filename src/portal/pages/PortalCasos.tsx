/**
 * PortalCasos — Lista unificada de Processos Judiciais + Requerimentos INSS.
 *
 * Substitui a antiga "PortalProcesses" com uma visão integrada dos dois tipos
 * de caso que um cliente pode ter com o escritório.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Scale, Briefcase, FileText } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, formatRelative } from '../components/PortalUI';
import { statusMeta, TONE_CLASSES, requirementMeta, BENEFIT_TYPE_LABELS } from '../lib/domain';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface ProcessItem {
  id: string;
  process_code: string;
  status: string;
  practice_area?: string | null;
  court?: string | null;
  last_movement?: { nome?: string; data_hora?: string; data?: string } | null;
  pending_deadlines?: number;
  hearing_scheduled?: boolean;
  hearing_date?: string | null;
  next_appointment?: { start_at: string; title: string; event_type: string; event_mode?: string | null } | null;
}

interface RequirementItem {
  id: string;
  protocol?: string | null;
  beneficiary: string;
  benefit_type: string;
  status: string;
  entry_date?: string | null;
  exigency_due_date?: string | null;
  pericia_medica_at?: string | null;
  pericia_social_at?: string | null;
  updated_at: string;
  archived?: boolean;
}

type CaseKind = 'process' | 'requirement';
type FilterTab = 'all' | 'processos' | 'requerimentos';

// ── Componente principal ─────────────────────────────────────────────────────

export const PortalCasos: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [requirements, setRequirements] = useState<RequirementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      clientPortalService.listProcesses(session.user.id),
      clientPortalService.listRequirements(session.user.id),
    ]).then(([procs, reqs]) => {
      if (!mounted) return;
      setProcesses(procs as ProcessItem[]);
      setRequirements(reqs as RequirementItem[]);
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id]);

  const counts = useMemo(() => ({
    processos:     processes.filter(p => p.status !== 'arquivado').length,
    requerimentos: requirements.length,
    total:         processes.length + requirements.length,
  }), [processes, requirements]);

  // Lista unificada filtrada
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();

    const procs: { kind: CaseKind; id: string; sortKey: string; item: ProcessItem }[] =
      processes
        .filter(p => {
          if (tab === 'requerimentos') return false;
          if (!q) return true;
          const meta = statusMeta(p.status);
          return (
            p.process_code?.toLowerCase().includes(q) ||
            p.practice_area?.toLowerCase().includes(q) ||
            p.court?.toLowerCase().includes(q) ||
            meta.label.toLowerCase().includes(q)
          );
        })
        .map(p => ({ kind: 'process' as CaseKind, id: p.id, sortKey: p.last_movement?.data_hora || p.last_movement?.data || '', item: p }));

    const reqs: { kind: CaseKind; id: string; sortKey: string; item: RequirementItem }[] =
      requirements
        .filter(r => {
          if (tab === 'processos') return false;
          if (!q) return true;
          const label = BENEFIT_TYPE_LABELS[r.benefit_type] || r.benefit_type;
          const meta = requirementMeta(r.status);
          return (
            r.protocol?.toLowerCase().includes(q) ||
            r.beneficiary?.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q) ||
            meta.label.toLowerCase().includes(q)
          );
        })
        .map(r => ({ kind: 'requirement' as CaseKind, id: r.id, sortKey: r.updated_at, item: r }));

    // Reqs urgentes primeiro, depois por data
    return [
      ...reqs.filter(r => {
        const m = requirementMeta((r.item as RequirementItem).status);
        return m.urgent;
      }),
      ...procs,
      ...reqs.filter(r => {
        const m = requirementMeta((r.item as RequirementItem).status);
        return !m.urgent;
      }),
    ];
  }, [processes, requirements, search, tab]);

  const TABS: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all',           label: 'Todos',             count: counts.total },
    { id: 'processos',     label: 'Processos',          count: counts.processos },
    { id: 'requerimentos', label: 'Requerimentos INSS', count: counts.requerimentos },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Meus casos</h1>
        <p className="mt-1 text-sm text-slate-500">
          <span className="tabular-nums">{counts.processos}</span> processo{counts.processos !== 1 ? 's' : ''} judiciais
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="tabular-nums">{counts.requerimentos}</span> requerimento{counts.requerimentos !== 1 ? 's' : ''} INSS
        </p>
      </header>

      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por número, tipo ou situação"
          className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
                on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.label}
              <span className={`tabular-nums text-[11px] font-semibold ${on ? 'text-white/60' : 'text-slate-400'}`}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={search ? 'Nenhum caso encontrado' : 'Nenhum caso'}
          description={search ? 'Tente outros termos de busca.' : 'Quando o escritório vincular casos ao seu CPF, eles aparecerão aqui.'}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map(({ kind, id, item }) =>
            kind === 'process'
              ? <ProcessRow key={`proc-${id}`} process={item as ProcessItem} onClick={() => navigate('casos', `proc:${id}`)} />
              : <RequirementRow key={`req-${id}`} req={item as RequirementItem} onClick={() => navigate('casos', `req:${id}`)} />
          )}
        </ul>
      )}
    </div>
  );
};

// ── ProcessRow ────────────────────────────────────────────────────────────────

const ProcessRow: React.FC<{ process: ProcessItem; onClick: () => void }> = ({ process: p, onClick }) => {
  const meta = statusMeta(p.status);
  const tone = TONE_CLASSES[meta.tone];
  const lastMov = p.last_movement?.nome;
  const lastMovDate = p.last_movement?.data_hora || p.last_movement?.data;
  const overdue = p.pending_deadlines ?? 0;
  const subtitle = [p.practice_area, p.court].filter(Boolean).join(' · ');

  return (
    <li>
      <button onClick={onClick}
        className="group w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5">
        {/* Tipo + código + status */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Briefcase className="h-4 w-4 text-slate-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Processo Judicial</span>
            </div>
            <p className="truncate font-mono text-[13px] font-semibold tabular-nums text-slate-900">{p.process_code}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className={`text-xs font-medium ${tone.text}`}>{meta.label}</span>
          </div>
        </div>

        {subtitle && <p className="mt-0.5 truncate pl-11 text-xs capitalize text-slate-400">{subtitle}</p>}

        {/* Última atualização */}
        {lastMov && (
          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-[13px] text-slate-600">
            <span className="min-w-0 flex-1 truncate">{lastMov}</span>
            <span className="shrink-0 tabular-nums text-xs text-slate-400">{formatRelative(lastMovDate)}</span>
          </div>
        )}

        {/* Alertas */}
        {(overdue > 0 || p.next_appointment) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-11 text-xs">
            {p.next_appointment && (() => {
              const d = new Date(p.next_appointment.start_at);
              const hasTime = p.next_appointment.start_at.includes('T');
              const time = hasTime ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
              const typeLabel = p.next_appointment.event_type === 'hearing' ? 'Audiência'
                : p.next_appointment.event_type === 'pericia' ? 'Perícia'
                : p.next_appointment.event_type === 'meeting' ? 'Reunião'
                : 'Compromisso';
              const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
              return (
                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {typeLabel} {dateStr}{time ? ` · ${time}` : ''}
                </span>
              );
            })()}
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

// ── RequirementRow ────────────────────────────────────────────────────────────

const RequirementRow: React.FC<{ req: RequirementItem; onClick: () => void }> = ({ req: r, onClick }) => {
  const meta = requirementMeta(r.status);
  const tone = TONE_CLASSES[meta.tone];
  const benefitLabel = BENEFIT_TYPE_LABELS[r.benefit_type] || r.benefit_type;
  const nextDate = r.exigency_due_date || r.pericia_medica_at || r.pericia_social_at;
  const isArchived = r.archived === true;

  return (
    <li>
      <button onClick={onClick}
        className={`group w-full rounded-xl border bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5 ${
          isArchived
            ? 'border-slate-200 opacity-75'
            : meta.urgent
            ? 'border-l-[3px] border-l-amber-500 border-slate-200'
            : 'border-slate-200'
        }`}>
        {/* Tipo + benefício + status */}
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isArchived ? 'bg-slate-100' : 'bg-slate-100'}`}>
            <FileText className={`h-4 w-4 ${isArchived ? 'text-slate-400' : 'text-slate-500'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Requerimento INSS</span>
            <p className={`truncate text-[13px] font-semibold ${isArchived ? 'text-slate-500' : 'text-slate-900'}`}>{benefitLabel}</p>
            {r.protocol && <p className="font-mono text-[11px] tabular-nums text-slate-400">{r.protocol}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isArchived ? (
              <span className="text-xs font-medium text-slate-400">Encerrado</span>
            ) : (
              <>
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                <span className={`text-xs font-medium ${tone.text}`}>{meta.label}</span>
              </>
            )}
          </div>
        </div>

        {/* Data relevante — só em ativos */}
        {!isArchived && nextDate && (
          <div className="mt-2.5 flex items-center gap-1.5 pl-11 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            <span className={`font-medium ${tone.text}`}>
              {r.exigency_due_date ? 'Prazo exigência' : r.pericia_medica_at ? 'Perícia médica' : 'Perícia social'}:
            </span>
            <span className="tabular-nums text-slate-600">
              {new Date(nextDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
          </div>
        )}
      </button>
    </li>
  );
};

export default PortalCasos;
