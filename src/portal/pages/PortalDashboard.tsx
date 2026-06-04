import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  PenTool,
  PiggyBank,
} from 'lucide-react';
import { SecurityBanner } from '../components/SecurityBanner';
import {
  formatCurrency,
  formatDateLong,
  formatRelative,
  SkeletonCard,
} from '../components/PortalUI';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';

interface FinancialSummary {
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  net?: number;
  received?: number;
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
      .then((result) => {
        if (mounted) setData(result as DashboardData);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const firstName = session?.client?.nome?.split(' ')[0] || 'Cliente';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const hasPendingSig = !loading && (data?.signaturesPending ?? 0) > 0;
  const hasOverdueFinancial = !loading && (data?.financial?.overdue ?? 0) > 0;
  const pendingTotal = (data?.signaturesPending ?? 0) + (data?.deadlinesOverdue ?? 0);
  const showFinancial = !loading && !!data?.financial && ((data.financial.total > 0) || ((data.financial.net ?? 0) > 0));

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-2.5rem)] lg:overflow-hidden lg:gap-3">
      <header className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)] lg:px-5 lg:py-4">
          <div className="max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-600">{greeting}</p>
            <h1 className="mt-1.5 text-[26px] font-extrabold tracking-tight text-slate-900 sm:text-[30px]">{firstName}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Acompanhe casos, documentos, agenda e mensagens com uma visão simples do que precisa da sua atenção.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => navigate('casos')}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Ver meus casos
            </button>
            <button
              onClick={() => navigate('mensagens')}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-orange-200 hover:text-orange-700"
            >
              Falar com o escritório
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <HeroMiniCard
            label="Casos ativos"
            value={loading ? '—' : String(data?.processesActive ?? 0)}
            helper={loading ? 'carregando' : `${data?.casesTotal ?? data?.processesTotal ?? 0} no total`}
          />
          <HeroMiniCard
            label="Pendências"
            value={loading ? '—' : String(pendingTotal)}
            helper={loading ? 'carregando' : `${data?.signaturesPending ?? 0} assinaturas e ${data?.deadlinesOverdue ?? 0} prazos vencidos`}
            accent={pendingTotal > 0}
          />
        </div>
      </header>

      <SecurityBanner compact />

      {(hasPendingSig || hasOverdueFinancial) && (
        <div className="flex flex-col gap-2">
          {hasPendingSig && (
            <button
              onClick={() => navigate('assinar')}
              className="group flex w-full items-center gap-3 rounded-[18px] border border-orange-200 bg-white px-4 py-3 text-left shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition hover:border-orange-300"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                <PenTool className="h-4 w-4" />
              </span>
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
              className="group flex w-full items-center gap-3 rounded-[18px] border border-rose-200 bg-white px-4 py-3 text-left shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition hover:border-rose-300"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </span>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCell icon={Briefcase} label="Casos" value={data?.casesTotal ?? data?.processesTotal ?? 0} sub={`${data?.processesActive ?? 0} em andamento`} onClick={() => navigate('casos')} />
            <StatCell icon={PenTool} label="Assinaturas" value={data?.signaturesPending ?? 0} sub={(data?.signaturesPending ?? 0) > 0 ? 'pendentes' : 'em dia'} urgent={(data?.signaturesPending ?? 0) > 0} onClick={() => navigate('assinar')} />
            <StatCell icon={Clock} label="Prazos" value={data?.deadlinesPending ?? 0} sub={(data?.deadlinesOverdue ?? 0) > 0 ? `${data?.deadlinesOverdue} vencidos` : 'em aberto'} urgent={(data?.deadlinesOverdue ?? 0) > 0} onClick={() => navigate('agenda')} />
            <StatCell icon={FileText} label="Documentos" value={data?.documentsCount ?? 0} sub="disponíveis" onClick={() => navigate('documentos')} />
          </>
        )}
      </div>

      {showFinancial && (
        <FinancialOverview financial={data!.financial} nextInstallment={data!.nextInstallment} onClick={() => navigate('financeiro')} compact />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex min-h-[200px] flex-col rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] lg:min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Próximos compromissos</h2>
            <button onClick={() => navigate('agenda')} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver agenda</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {loading ? (
              <SkeletonCard />
            ) : (
              <>
                <UpcomingItem type="event" data={data?.nextEvent} emptyText="Sem compromissos agendados" onClick={() => navigate('agenda')} />
                <UpcomingItem type="deadline" data={data?.nextDeadline} emptyText="Sem prazos pendentes" onClick={() => navigate('agenda')} />
              </>
            )}
          </div>
        </section>

        <section className="flex min-h-[200px] flex-col rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] lg:min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-slate-900">Últimas movimentações</h2>
            <button onClick={() => navigate('casos')} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver tudo</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {loading ? (
              <SkeletonCard />
            ) : !data?.recentMovements?.length ? (
              <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Sem movimentações recentes</p>
              </div>
            ) : (
              data.recentMovements.map((movement, idx) => <MovementRow key={idx} movement={movement} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const HeroMiniCard: React.FC<{
  label: string;
  value: string;
  helper: string;
  accent?: boolean;
}> = ({ label, value, helper, accent }) => (
  <div className={`rounded-[20px] border bg-white px-4 py-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${accent ? 'border-orange-200' : 'border-slate-200'}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
    <p className={`mt-2 text-[28px] font-extrabold tracking-tight ${accent ? 'text-orange-600' : 'text-slate-900'}`}>{value}</p>
    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{helper}</p>
  </div>
);

const StatCell: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub?: string;
  urgent?: boolean;
  onClick?: () => void;
}> = ({ icon: Icon, label, value, sub, urgent, onClick }) => (
  <button onClick={onClick} className="group flex min-h-[132px] flex-col gap-2 rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-[0_14px_28px_rgba(15,23,42,0.07)] lg:min-h-[122px]">
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${urgent ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className={`text-[34px] font-extrabold tracking-tight tabular-nums ${urgent ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className="mt-auto text-[13px] leading-relaxed text-slate-500">{sub}</p>}
  </button>
);

const FinancialOverview: React.FC<{
  financial: FinancialSummary;
  nextInstallment: Record<string, unknown> | null;
  onClick: () => void;
  compact?: boolean;
}> = ({ financial, nextInstallment, onClick, compact = false }) => {
  const hasReceivable = (financial.net ?? 0) > 0;
  const recvPct = (financial.net ?? 0) > 0 ? Math.round(((financial.received ?? 0) / (financial.net ?? 1)) * 100) : 0;
  const paidPct = financial.total > 0 ? Math.round((financial.paid / financial.total) * 100) : 0;
  const nextDue = nextInstallment?.due_date as string | undefined;
  const nextValue = nextInstallment?.value as number | undefined;

  return (
    <section className={`rounded-[22px] border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.04)] ${compact ? 'p-4' : 'p-5'}`}>
      <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
        <h2 className="text-[13px] font-semibold text-slate-900">{hasReceivable ? 'Seus acordos' : 'Resumo financeiro'}</h2>
        <button onClick={onClick} className="text-xs font-medium text-orange-600 hover:text-orange-700">Ver detalhes</button>
      </div>

      {hasReceivable ? (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Você recebe</p>
          <p className={`font-semibold tracking-tight tabular-nums text-emerald-700 ${compact ? 'mt-1 text-[28px]' : 'mt-1 text-3xl'}`}>{formatCurrency(financial.net ?? 0)}</p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, recvPct)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-500">
            <span>{formatCurrency(financial.received ?? 0)} já recebido</span>
            <span className="tabular-nums">{recvPct}%</span>
          </div>
          {nextDue && (
            <p className="mt-2 text-xs text-slate-500">
              Próximo: <span className="font-semibold text-slate-700 tabular-nums">{formatCurrency(Number(nextValue))}</span> em {formatDateLong(nextDue)}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
            <FinancialMini label="Honorários" value={financial.total} color="text-slate-900" />
            <FinancialMini label="Quitado" value={financial.paid} color="text-emerald-600" />
            <FinancialMini label="A pagar" value={financial.pending} color="text-amber-700" />
            <FinancialMini label="Em atraso" value={financial.overdue} color="text-rose-600" />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Progresso</span>
              <span className="font-semibold text-slate-700 tabular-nums">{paidPct}%</span>
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
    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`mt-0.5 text-[15px] font-semibold tabular-nums ${color}`}>{formatCurrency(value)}</p>
  </div>
);

const UPCOMING_META = {
  event: { icon: Calendar, label: 'Compromisso' },
  deadline: { icon: Clock, label: 'Prazo' },
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

  if (!data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5">
        <Icon className="h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs text-slate-500">{emptyText}</p>
      </div>
    );
  }

  const title = (data.title as string) || (data.agreement_title as string) || (type === 'installment' ? `Parcela ${data.installment_number ?? ''}` : 'Item');
  const dateField = (data.start_at || data.due_date || data.date) as string | undefined;
  if (dateField && new Date(dateField) < new Date()) return null;

  return (
    <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-orange-200 hover:bg-white">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{meta.label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{title}</p>
        {dateField && (
          <p className="truncate text-xs text-slate-500 tabular-nums">
            {formatDateLong(dateField)}
            {type === 'installment' && data.value ? ` · ${formatCurrency(Number(data.value))}` : ''}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>
  );
};

const MovementRow: React.FC<{ movement: Record<string, unknown> }> = ({ movement }) => {
  const name = (movement.nome as string) || 'Movimentação';
  const date = (movement.data_hora as string) || (movement.data as string) || (movement.created_at as string) || null;
  const code = movement.process_code as string | undefined;

  return (
    <div className="flex items-start gap-3 rounded-[16px] px-2 py-2 transition hover:bg-slate-50">
      <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900">{name}</p>
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
