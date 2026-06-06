import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Scale, Briefcase, FileText, Calendar, ChevronRight } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, formatRelative } from '../components/PortalUI';
import { statusMeta, TONE_CLASSES, requirementMeta, BENEFIT_TYPE_LABELS } from '../lib/domain';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ProcessItem {
  id: string; process_code: string; status: string;
  practice_area?: string | null; court?: string | null;
  last_movement?: { nome?: string; data_hora?: string; data?: string } | null;
  pending_deadlines?: number; hearing_scheduled?: boolean; hearing_date?: string | null;
  next_appointment?: { start_at: string; title: string; event_type: string; event_mode?: string | null } | null;
}

interface RequirementItem {
  id: string; protocol?: string | null; beneficiary: string; benefit_type: string;
  status: string; entry_date?: string | null; exigency_due_date?: string | null;
  pericia_medica_at?: string | null; pericia_social_at?: string | null;
  updated_at: string; archived?: boolean;
}

type CaseKind  = 'process' | 'requirement';
type FilterTab = 'all' | 'processos' | 'requerimentos';

// ── Componente principal ───────────────────────────────────────────────────────

export const PortalCasos: React.FC = () => {
  const { session }   = useClientAuth();
  const { navigate }  = usePortalRouter();
  const [processes,     setProcesses]     = useState<ProcessItem[]>([]);
  const [requirements,  setRequirements]  = useState<RequirementItem[]>([]);
  const [processesLoading, setProcessesLoading] = useState(true);
  const [requirementsLoading, setRequirementsLoading] = useState(true);
  const [search,        setSearch]        = useState('');
  const [tab,           setTab]           = useState<FilterTab>('all');

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;

    setProcessesLoading(true);
    setRequirementsLoading(true);

    clientPortalService.listProcesses(session.user.id)
      .then((procs) => {
        if (!mounted) return;
        setProcesses(procs as ProcessItem[]);
      })
      .finally(() => {
        if (mounted) setProcessesLoading(false);
      });

    clientPortalService.listRequirements(session.user.id)
      .then((reqs) => {
        if (!mounted) return;
        setRequirements(reqs as RequirementItem[]);
      })
      .finally(() => {
        if (mounted) setRequirementsLoading(false);
      });

    return () => { mounted = false; };
  }, [session?.user?.id]);

  const counts = useMemo(() => ({
    processos:     processes.filter(p => p.status !== 'arquivado').length,
    requerimentos: requirements.length,
    total:         processes.length + requirements.length,
  }), [processes, requirements]);

  const loading =
    tab === 'processos' ? processesLoading :
    tab === 'requerimentos' ? requirementsLoading :
    processesLoading || requirementsLoading;

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();

    const procs = processes
      .filter(p => {
        if (tab === 'requerimentos') return false;
        if (!q) return true;
        const meta = statusMeta(p.status);
        return p.process_code?.toLowerCase().includes(q) || p.practice_area?.toLowerCase().includes(q) || p.court?.toLowerCase().includes(q) || meta.label.toLowerCase().includes(q);
      })
      .map(p => ({ kind: 'process' as CaseKind, id: p.id, sortKey: p.last_movement?.data_hora || p.last_movement?.data || '', item: p }));

    const reqs = requirements
      .filter(r => {
        if (tab === 'processos') return false;
        if (!q) return true;
        const label = BENEFIT_TYPE_LABELS[r.benefit_type] || r.benefit_type;
        const meta  = requirementMeta(r.status);
        return r.protocol?.toLowerCase().includes(q) || r.beneficiary?.toLowerCase().includes(q) || label.toLowerCase().includes(q) || meta.label.toLowerCase().includes(q);
      })
      .map(r => ({ kind: 'requirement' as CaseKind, id: r.id, sortKey: r.updated_at, item: r }));

    return [
      ...reqs.filter(r => requirementMeta((r.item as RequirementItem).status).urgent),
      ...procs,
      ...reqs.filter(r => !requirementMeta((r.item as RequirementItem).status).urgent),
    ];
  }, [processes, requirements, search, tab]);

  const TABS: { id: FilterTab; label: string; count: number }[] = [
    { id: 'all',           label: 'Todos',        count: counts.total         },
    { id: 'processos',     label: 'Processos',    count: counts.processos     },
    { id: 'requerimentos', label: 'INSS',         count: counts.requerimentos },
  ];

  return (
    <div className="flex flex-col gap-4">

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por número, tipo ou situação…"
          className="h-12 w-full rounded-2xl bg-slate-100 pl-11 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-orange-400/30"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                on ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 shadow-[0_1px_4px_rgba(15,23,42,0.08)] hover:text-slate-800'
              }`}
            >
              {t.label}
              <span className={`min-w-[18px] rounded-full px-1.5 text-[11px] font-bold tabular-nums ${on ? 'bg-white/20 text-white' : 'text-slate-400'}`}>
                {t.id === 'all' && (processesLoading || requirementsLoading) ? '?' : t.id === 'processos' && processesLoading ? '?' : t.id === 'requerimentos' && requirementsLoading ? '?' : t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Lista ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] bg-white px-6 py-10 text-center shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
          <div className="relative mb-4 flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-4 border-orange-100" />
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-orange-500 border-r-orange-300" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-50 to-white shadow-[0_10px_30px_rgba(249,115,22,0.16)]">
              <Scale className="h-6 w-6 text-orange-500" />
            </div>
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">Aguarde</p>
            <p className="mt-1 text-sm text-slate-500">Estamos buscando seus casos</p>
          </div>
        </div>
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
              ? <ProcessCard key={`proc-${id}`} process={item as ProcessItem}         onClick={() => navigate('casos', `proc:${id}`)} />
              : <RequirementCard key={`req-${id}`} req={item as RequirementItem}       onClick={() => navigate('casos', `req:${id}`)} />
          )}
        </ul>
      )}
    </div>
  );
};

// ── ProcessCard ────────────────────────────────────────────────────────────────

const ProcessCard: React.FC<{ process: ProcessItem; onClick: () => void }> = ({ process: p, onClick }) => {
  const meta       = statusMeta(p.status);
  const tone       = TONE_CLASSES[meta.tone];
  const lastMov    = p.last_movement?.nome;
  const lastMovDate = p.last_movement?.data_hora || p.last_movement?.data;
  const subtitle   = [p.practice_area, p.court].filter(Boolean).join(' · ');

  const appt = p.next_appointment;
  const apptLabel = appt
    ? appt.event_type === 'hearing' ? 'Audiência'
    : appt.event_type === 'pericia' ? 'Perícia'
    : appt.event_type === 'meeting' ? 'Reunião'
    : 'Compromisso'
    : null;

  return (
    <li>
      <button onClick={onClick} className="group w-full text-left active:scale-[0.99] transition">
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.07)] transition group-hover:shadow-[0_4px_16px_rgba(15,23,42,0.10)]">
          {/* Card body */}
          <div className="flex">
            {/* Barra de status colorida */}
            <div className={`w-1 shrink-0 ${tone.dot}`} />

            <div className="flex-1 px-4 py-3.5">
              {/* Linha de cima: tipo + status */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <Briefcase className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Processo Judicial</p>
                    <p className="font-mono text-[15px] font-bold tabular-nums text-slate-900">{p.process_code}</p>
                  </div>
                </div>
                <span className={`mt-0.5 shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold ${tone.text}`}>
                  {meta.label}
                </span>
              </div>

              {/* Subtítulo */}
              {subtitle && <p className="mt-1.5 pl-[52px] text-xs capitalize text-slate-400">{subtitle}</p>}

              {/* Última movimentação */}
              {lastMov && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                  <p className="flex-1 truncate text-xs text-slate-600">{lastMov}</p>
                  <p className="shrink-0 text-[10px] tabular-nums text-slate-400">{formatRelative(lastMovDate)}</p>
                </div>
              )}
            </div>

            <div className="flex items-center pr-3.5">
              <ChevronRight className="h-4 w-4 text-slate-200 transition group-hover:text-slate-400" />
            </div>
          </div>

          {/* Rodapé de compromisso */}
          {appt && apptLabel && (
            <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50 px-5 py-2.5">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p className="text-xs font-semibold text-amber-700">
                {apptLabel} · {new Date(appt.start_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </p>
            </div>
          )}
        </div>
      </button>
    </li>
  );
};

// ── RequirementCard ────────────────────────────────────────────────────────────

const RequirementCard: React.FC<{ req: RequirementItem; onClick: () => void }> = ({ req: r, onClick }) => {
  const meta         = requirementMeta(r.status);
  const tone         = TONE_CLASSES[meta.tone];
  const benefitLabel = BENEFIT_TYPE_LABELS[r.benefit_type] || r.benefit_type;
  const nextDate     = r.exigency_due_date || r.pericia_medica_at || r.pericia_social_at;
  const isArchived   = r.archived === true;

  const nextLabel = r.exigency_due_date ? 'Prazo exigência'
    : r.pericia_medica_at ? 'Perícia médica'
    : r.pericia_social_at ? 'Perícia social'
    : null;

  return (
    <li>
      <button onClick={onClick} className="group w-full text-left active:scale-[0.99] transition">
        <div className={`overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.07)] transition group-hover:shadow-[0_4px_16px_rgba(15,23,42,0.10)] ${isArchived ? 'opacity-70' : ''}`}>
          <div className="flex">
            <div className={`w-1 shrink-0 ${isArchived ? 'bg-slate-300' : meta.urgent ? 'bg-amber-500' : tone.dot}`} />

            <div className="flex-1 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <FileText className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Requerimento INSS</p>
                    <p className={`text-[15px] font-bold ${isArchived ? 'text-slate-500' : 'text-slate-900'}`}>{benefitLabel}</p>
                    {r.protocol && <p className="font-mono text-[11px] tabular-nums text-slate-400">{r.protocol}</p>}
                  </div>
                </div>
                <span className={`mt-0.5 shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold ${isArchived ? 'text-slate-400' : tone.text}`}>
                  {isArchived ? 'Encerrado' : meta.label}
                </span>
              </div>

              {!isArchived && nextDate && nextLabel && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                  <p className={`text-xs font-semibold ${tone.text}`}>{nextLabel}:</p>
                  <p className="text-xs tabular-nums text-slate-600">
                    {new Date(nextDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center pr-3.5">
              <ChevronRight className="h-4 w-4 text-slate-200 transition group-hover:text-slate-400" />
            </div>
          </div>
        </div>
      </button>
    </li>
  );
};

export default PortalCasos;
