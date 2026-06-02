import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  PenTool,
  Calendar,
  PiggyBank,
  Clock,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { PortalNotificationBell } from '../components/PortalNotificationBell';
import { clientPortalService } from '../services/clientPortal.service';
import { SecurityBanner } from '../components/SecurityBanner';
import {
  formatCurrency,
  formatDateLong,
  formatRelative,
  SkeletonCard,
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
  requirementsTotal: number;
  casesTotal: number;
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
    <div className="flex flex-col gap-5">

      {/* ── SAUDAÇÃO ── */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{greeting}</p>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">{firstName}</h1>
        </div>
        <PortalNotificationBell />
      </header>

      {/* ── BANNER DE SEGURANÇA (anti-golpe) ── */}
      <SecurityBanner />

      {/* ── ALERTAS URGENTES — barra lateral esquerda escopada ── */}
      {(hasPendingSig || hasOverdueFinancial) && (
        <div className="flex flex-col gap-2">
          {hasPendingSig && (
            <button
              onClick={() => navigate('assinar')}
              className="group flex w-full items-center gap-3.5 rounded-xl border border-l-[3px] border-orange-200 border-l-orange-500 bg-white px-4 py-3.5 text-left transition hover:shadow-sm"
            >
              <PenTool className="h-4 w-4 shrink-0 text-orange-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  <span className="tabular-nums">{data!.signaturesPending}</span> documento{data!.signaturesPending !== 1 ? 's' : ''} aguardando assinatura
                </p>
                <p className="text-xs text-slate-500">Toque para assinar</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-500" />
            </button>
          )}
          {hasOverdueFinancial && (
            <button
              onClick={() => navigate('financeiro')}
              className="group flex w-full items-center gap-3.5 rounded-xl border border-l-[3px] border-rose-200 border-l-rose-500 bg-white px-4 py-3.5 text-left transition hover:shadow-sm"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  Parcela{data!.financial.overdue > 1 ? 's' : ''} em atraso — {formatCurrency(data!.financial.overdue)}
                </p>
                <p className="text-xs text-slate-500">Ver financeiro</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-rose-500" />
            </button>
          )}
        </div>
      )}

      {/* ── STAT GRID — linha divisória, sem card encaixotado ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-slate-200 py-4 sm:grid-cols-4">
        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <StatCell icon={Briefcase} label="Casos" value={data?.casesTotal ?? data?.processesTotal ?? 0} sub={`${data?.processesActive ?? 0} em andamento`} onClick={() => navigate('casos')} />
            <StatCell icon={PenTool}   label="Assinaturas" value={data?.signaturesPending ?? 0} sub={(data?.signaturesPending ?? 0) > 0 ? 'pendentes' : 'em dia'} urgent={(data?.signaturesPending ?? 0) > 0} onClick={() => navigate('assinar')} />
            <StatCell icon={Clock}     label="Prazos" value={data?.deadlinesPending ?? 0} sub={(data?.deadlinesOverdue ?? 0) > 0 ? `${data?.deadlinesOverdue} vencidos` : 'em aberto'} urgent={(data?.deadlinesOverdue ?? 0) > 0} onClick={() => navigate('agenda')} />
            <StatCell icon={FileText}  label="Documentos" value={data?.documentsCount ?? 0} sub="disponíveis" onClick={() => navigate('documentos')} />
          </>
        )}
      </div>

      {/* ── FINANCEIRO ── */}
      {!loading && data?.financial && ((data.financial.total > 0) || ((data.financial.net ?? 0) > 0)) && (
        <FinancialOverview financial={data.financial} nextInstallment={data.nextInstallment} onClick={() => navigate('financeiro')} />
      )}

      {/* ── COMPROMISSOS + MOVIMENTAÇÕES ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Próximos compromissos</h2>
            <button onClick={() => navigate('agenda')} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver agenda</button>
          </div>
          <div className="flex flex-col gap-2">
            {loading ? <SkeletonCard /> : (
              <>
                <UpcomingItem type="event" data={data?.nextEvent} emptyText="Sem compromissos agendados" onClick={() => navigate('agenda')} />
                <UpcomingItem type="deadline" data={data?.nextDeadline} emptyText="Sem prazos pendentes" onClick={() => navigate('agenda')} />
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Últimas movimentações</h2>
            <button onClick={() => navigate('casos')} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver tudo</button>
          </div>
          <div className="flex flex-col gap-1.5">
            {loading ? <SkeletonCard /> : !data?.recentMovements?.length ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Sem movimentações recentes</p>
              </div>
            ) : (
              data.recentMovements.map((m, idx) => <MovementRow key={idx} movement={m} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

// ── Stat Cell (sem card, linha divisória no grid) ────────────────────────────

const StatCell: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub?: string;
  urgent?: boolean;
  onClick?: () => void;
}> = ({ icon: Icon, label, value, sub, urgent, onClick }) => (
  <button onClick={onClick} className="group flex flex-col gap-1 text-left">
    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-3xl font-semibold tabular-nums tracking-tight ${urgent ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Icon className="h-3 w-3 shrink-0 text-slate-400" />{sub}</p>}
  </button>
);

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
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-slate-900">{hasReceivable ? 'Seus acordos' : 'Resumo financeiro'}</h2>
        <button onClick={onClick} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver detalhes</button>
      </div>

      {hasReceivable ? (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Você recebe</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700">{formatCurrency(financial.net ?? 0)}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, recvPct)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-500">
            <span>{formatCurrency(financial.received ?? 0)} já recebido</span>
            <span className="tabular-nums">{recvPct}%</span>
          </div>
          {nextDue && (
            <p className="mt-2 text-xs text-slate-500">
              Próximo: <span className="font-semibold tabular-nums text-slate-700">{formatCurrency(Number(nextValue))}</span> em {formatDateLong(nextDue)}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <FinancialMini label="Honorários" value={financial.total} color="text-slate-900" />
            <FinancialMini label="Quitado"    value={financial.paid}    color="text-emerald-600" />
            <FinancialMini label="A pagar"    value={financial.pending} color="text-amber-700" />
            <FinancialMini label="Em atraso"  value={financial.overdue} color="text-rose-600" />
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Progresso</span>
              <span className="font-semibold tabular-nums text-slate-700">{paidPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, paidPct)}%` }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const FinancialMini: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div>
    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>{formatCurrency(value)}</p>
  </div>
);

// ── Upcoming Item ─────────────────────────────────────────────────────────────

const UPCOMING_META = {
  event:       { icon: Calendar,  label: 'Compromisso' },
  deadline:    { icon: Clock,     label: 'Prazo' },
  installment: { icon: PiggyBank, label: 'Parcela' },
} as const;

const UpcomingItem: React.FC<{
  type: keyof typeof UPCOMING_META;
  data: Record<string, unknown> | null | undefined;
  emptyText: string;
  onClick: () => void;
}> = ({ type, data, emptyText, onClick }) => {
  const meta = UPCOMING_META[type];
  const Icon = meta.icon;

  if (!data) return (
    <div className="flex items-center gap-3 py-2 opacity-50">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <p className="text-xs text-slate-400">{emptyText}</p>
    </div>
  );

  const title = (data.title as string) || (data.agreement_title as string) || (type === 'installment' ? `Parcela ${data.installment_number ?? ''}` : 'Item');
  const dateField = (data.start_at || data.due_date || data.date) as string | undefined;

  if (dateField && new Date(dateField) < new Date()) return null;

  return (
    <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:border-slate-300">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{meta.label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{title}</p>
        {dateField && (
          <p className="truncate text-xs tabular-nums text-slate-500">
            {formatDateLong(dateField)}
            {type === 'installment' && data.value ? ` · ${formatCurrency(Number(data.value))}` : ''}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>
  );
};

// ── Movement Row ──────────────────────────────────────────────────────────────

const MovementRow: React.FC<{ movement: Record<string, unknown> }> = ({ movement }) => {
  const name = (movement.nome as string) || 'Movimentação';
  const date = (movement.data_hora as string) || (movement.data as string) || (movement.created_at as string) || null;
  const code = movement.process_code as string | undefined;

  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-slate-100 last:border-0">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium text-slate-900">{name}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
          {code && <span className="font-mono tabular-nums">{code}</span>}
          {code && <span>·</span>}
          <span className="tabular-nums">{formatRelative(date)}</span>
        </div>
      </div>
    </div>
  );
};

export default PortalDashboard;
