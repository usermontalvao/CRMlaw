import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  PenTool,
  Calendar,
  PiggyBank,
  AlertCircle,
  Clock,
  TrendingUp,
  FileText,
  ArrowRight,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { SecurityBanner } from '../components/SecurityBanner';
import {
  formatCurrency,
  formatDateLong,
  formatRelative,
  SkeletonCard,
  StatusBadge,
} from '../components/PortalUI';

interface FinancialSummary {
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  net?: number;       // líquido que o cliente recebe (acordos)
  received?: number;  // já recebido pelo cliente
}

interface DashboardData {
  processesTotal: number;
  processesActive: number;
  signaturesPending: number;
  deadlinesPending: number;
  deadlinesOverdue: number;
  documentsCount: number;
  financial: FinancialSummary;
  nextEvent: Record<string, unknown> | null;
  nextDeadline: Record<string, unknown> | null;
  nextInstallment: Record<string, unknown> | null;
  recentMovements: Array<Record<string, unknown>>;
}

export const PortalDashboard: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    setLoading(true);
    clientPortalService
      .getDashboardSummary(session.user.id)
      .then((d) => mounted && setData(d as DashboardData))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [session?.user?.id]);

  const firstName = session?.client?.nome?.split(' ')[0] || 'Cliente';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const hasPendingSig = !loading && (data?.signaturesPending ?? 0) > 0;
  const hasOverdueFinancial = !loading && (data?.financial?.overdue ?? 0) > 0;

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* ── HERO compacto ── */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 px-5 py-5 text-white sm:px-6 sm:py-6">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-orange-500/10 blur-2xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-400">{greeting},</p>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{firstName}</h1>
          </div>
          <div className="flex gap-2">
            {[
              { icon: Briefcase, route: 'processos' as const, tip: 'Processos'   },
              { icon: PenTool,   route: 'assinar'   as const, tip: 'Assinaturas' },
              { icon: Calendar,  route: 'agenda'    as const, tip: 'Agenda'      },
            ].map(({ icon: Icon, route: r, tip }) => (
              <button
                key={r}
                onClick={() => navigate(r)}
                aria-label={tip}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition active:scale-95 hover:bg-white/20"
              >
                <Icon className="h-4 w-4 text-orange-400" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── BANNER DE SEGURANÇA (anti-golpe) ── */}
      <SecurityBanner />

      {/* ── ALERTAS URGENTES ── */}
      {(hasPendingSig || hasOverdueFinancial) && (
        <div className="space-y-2.5">
          {hasPendingSig && (
            <button
              onClick={() => navigate('assinar')}
              className="group flex w-full items-center gap-4 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4 text-left transition hover:border-orange-300 hover:shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm">
                <PenTool className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-orange-900">
                  {data!.signaturesPending} documento{data!.signaturesPending !== 1 ? 's' : ''} aguardando sua assinatura
                </p>
                <p className="text-xs text-orange-700">Clique para assinar agora</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-orange-400 transition group-hover:translate-x-0.5" />
            </button>
          )}
          {hasOverdueFinancial && (
            <button
              onClick={() => navigate('financeiro')}
              className="group flex w-full items-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-left transition hover:border-rose-300 hover:shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-rose-900">
                  Parcela{data!.financial.overdue > 1 ? 's' : ''} em atraso — {formatCurrency(data!.financial.overdue)}
                </p>
                <p className="text-xs text-rose-700">Ver detalhes financeiros</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-rose-400 transition group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      )}

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCard
              icon={Briefcase}
              label="Processos"
              value={data?.processesTotal ?? 0}
              hint={`${data?.processesActive ?? 0} em andamento`}
              color="slate"
              onClick={() => navigate('processos')}
            />
            <StatCard
              icon={PenTool}
              label="Assinaturas"
              value={data?.signaturesPending ?? 0}
              hint={data?.signaturesPending ? 'pendentes' : 'em dia'}
              color={(data?.signaturesPending ?? 0) > 0 ? 'orange' : 'emerald'}
              onClick={() => navigate('assinar')}
            />
            <StatCard
              icon={Clock}
              label="Prazos"
              value={data?.deadlinesPending ?? 0}
              hint={(data?.deadlinesOverdue ?? 0) > 0 ? `${data?.deadlinesOverdue} vencidos` : 'pendentes'}
              color={(data?.deadlinesOverdue ?? 0) > 0 ? 'rose' : 'amber'}
              onClick={() => navigate('agenda')}
            />
            <StatCard
              icon={FileText}
              label="Documentos"
              value={data?.documentsCount ?? 0}
              hint="disponíveis"
              color="slate"
              onClick={() => navigate('documentos')}
            />
          </>
        )}
      </div>

      {/* ── FINANCEIRO ── */}
      {!loading && data?.financial && (
        <FinancialOverview
          financial={data.financial}
          nextInstallment={data.nextInstallment}
          onClick={() => navigate('financeiro')}
        />
      )}

      {/* ── COMPROMISSOS + MOVIMENTAÇÕES ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50">
                <Activity className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Próximos compromissos</h2>
            </div>
            <button onClick={() => navigate('agenda')} className="text-xs font-semibold text-orange-600 hover:text-orange-700">
              Ver agenda
            </button>
          </div>
          <div className="space-y-2.5">
            {loading ? <SkeletonCard /> : (
              <>
                <UpcomingItem type="event" data={data?.nextEvent} emptyText="Sem compromissos agendados" onClick={() => navigate('agenda')} />
                <UpcomingItem type="deadline" data={data?.nextDeadline} emptyText="Sem prazos pendentes" onClick={() => navigate('agenda')} />
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50">
                <TrendingUp className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Últimas movimentações</h2>
            </div>
            <button onClick={() => navigate('processos')} className="text-xs font-semibold text-orange-600 hover:text-orange-700">
              Ver tudo
            </button>
          </div>
          <div className="space-y-2.5">
            {loading ? <SkeletonCard /> : !data?.recentMovements?.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Sem movimentações recentes</p>
              </div>
            ) : (
              data.recentMovements.map((m, idx) => <MovementRow key={idx} movement={m} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Stat Card ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
  color: 'slate' | 'orange' | 'amber' | 'rose' | 'emerald';
  onClick?: () => void;
}

const COLOR_CLASSES: Record<StatCardProps['color'], { icon: string; arrow: string; border: string }> = {
  slate:   { icon: 'bg-slate-100 text-slate-600',   arrow: 'group-hover:text-slate-500',   border: 'hover:border-slate-300' },
  orange:  { icon: 'bg-orange-50 text-orange-600',  arrow: 'group-hover:text-orange-500',  border: 'hover:border-orange-200' },
  amber:   { icon: 'bg-amber-50 text-amber-600',    arrow: 'group-hover:text-amber-500',   border: 'hover:border-amber-200' },
  rose:    { icon: 'bg-rose-50 text-rose-600',      arrow: 'group-hover:text-rose-500',    border: 'hover:border-rose-200' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600',arrow: 'group-hover:text-emerald-500', border: 'hover:border-emerald-200' },
};

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, hint, color, onClick }) => {
  const c = COLOR_CLASSES[color];
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${c.border}`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.icon}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <ArrowRight className={`absolute right-4 top-4 h-3.5 w-3.5 text-slate-200 transition group-hover:translate-x-0.5 ${c.arrow}`} />
    </button>
  );
};

// ── Financial Overview ─────────────────────────────────────────────────────────

const FinancialOverview: React.FC<{
  financial: FinancialSummary;
  nextInstallment: Record<string, unknown> | null;
  onClick: () => void;
}> = ({ financial, nextInstallment, onClick }) => {
  const hasReceivable = (financial.net ?? 0) > 0;
  const recvPct = (financial.net ?? 0) > 0 ? Math.round(((financial.received ?? 0) / (financial.net ?? 1)) * 100) : 0;
  const paidPct = financial.total > 0 ? Math.round((financial.paid / financial.total) * 100) : 0;
  const nextDue = nextInstallment?.due_date as string | undefined;
  const nextValue = nextInstallment?.value as number | undefined;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
            <PiggyBank className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <h2 className="text-sm font-bold text-slate-900">{hasReceivable ? 'Seus acordos' : 'Resumo financeiro'}</h2>
        </div>
        <button onClick={onClick} className="text-xs font-semibold text-orange-600 hover:text-orange-700">
          Ver detalhes
        </button>
      </div>

      {hasReceivable ? (
        <>
          {/* Positivo: o que o cliente recebe */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 p-4 ring-1 ring-emerald-100">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Você recebe</p>
            <p className="text-2xl font-bold text-emerald-700">{formatCurrency(financial.net ?? 0)}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, recvPct)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px]">
              <span className="font-semibold text-emerald-700">{formatCurrency(financial.received ?? 0)} recebido</span>
              <span className="text-slate-500">honorários já descontados</span>
            </div>
          </div>
          {nextDue && (
            <p className="mt-3 text-xs text-slate-500">
              Próximo recebimento: <span className="font-semibold text-slate-700">{formatCurrency(Number(nextValue))}</span> em {formatDateLong(nextDue)}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FinancialMini label="Honorários" value={financial.total} color="text-slate-900" />
            <FinancialMini label="Quitado" value={financial.paid} color="text-emerald-600" />
            <FinancialMini label="A pagar" value={financial.pending} color="text-amber-600" />
            <FinancialMini label="Em atraso" value={financial.overdue} color="text-rose-600" />
          </div>
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600">Progresso de pagamento</span>
              <span className="font-bold text-slate-900">{paidPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${Math.min(100, paidPct)}%` }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const FinancialMini: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="rounded-xl bg-slate-50 p-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={`mt-1 text-base font-bold sm:text-lg ${color}`}>{formatCurrency(value)}</p>
  </div>
);

// ── Upcoming Item ──────────────────────────────────────────────────────────────

const UPCOMING_META = {
  event:       { icon: Calendar,  color: 'bg-blue-50 text-blue-600',    label: 'Compromisso' },
  deadline:    { icon: Clock,     color: 'bg-amber-50 text-amber-600',   label: 'Prazo' },
  installment: { icon: PiggyBank, color: 'bg-emerald-50 text-emerald-600', label: 'Parcela' },
} as const;

const UpcomingItem: React.FC<{
  type: keyof typeof UPCOMING_META;
  data: Record<string, unknown> | null | undefined;
  emptyText: string;
  onClick: () => void;
}> = ({ type, data, emptyText, onClick }) => {
  const meta = UPCOMING_META[type];
  const Icon = meta.icon;

  if (!data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 opacity-50">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.color}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{meta.label}</p>
          <p className="text-xs text-slate-400">{emptyText}</p>
        </div>
      </div>
    );
  }

  const title = (data.title as string) || (data.agreement_title as string) || (type === 'installment' ? `Parcela ${data.installment_number ?? ''}` : 'Item');
  const dateField = (data.start_at || data.due_date || data.date) as string | undefined;

  // Não mostrar compromissos/prazos passados no dashboard
  if (dateField && new Date(dateField) < new Date()) return null;

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-orange-200 hover:bg-orange-50/30"
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{meta.label}</p>
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        {dateField && (
          <p className="truncate text-xs text-slate-500">
            {formatDateLong(dateField)}
            {type === 'installment' && data.value ? ` · ${formatCurrency(Number(data.value))}` : ''}
          </p>
        )}
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-500" />
    </button>
  );
};

// ── Movement Row ───────────────────────────────────────────────────────────────

const MovementRow: React.FC<{ movement: Record<string, unknown> }> = ({ movement }) => {
  const name = (movement.nome as string) || 'Movimentação';
  const date = (movement.data_hora as string) || (movement.data as string) || (movement.created_at as string) || null;
  const code = movement.process_code as string | undefined;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-slate-900">{name}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          {code && (
            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
              {code}
            </span>
          )}
          <span>{formatRelative(date)}</span>
        </div>
      </div>
    </div>
  );
};

export default PortalDashboard;
