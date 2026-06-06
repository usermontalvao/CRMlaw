import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  MessageCircle,
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
import { usePortalConfig } from '../contexts/PortalConfigContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';

interface FinancialSummary {
  total: number; paid: number; pending: number; overdue: number;
  net?: number; received?: number;
}

interface DashboardData {
  processesTotal: number; processesActive: number; requirementsTotal: number;
  casesTotal: number; signaturesPending: number; deadlinesPending: number;
  deadlinesOverdue: number; documentsCount: number; financial: FinancialSummary;
  nextEvent: Record<string, unknown> | null; nextDeadline: Record<string, unknown> | null;
  nextInstallment: Record<string, unknown> | null; recentMovements: Array<Record<string, unknown>>;
}

export const PortalDashboard: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const { isEnabled } = usePortalConfig();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    setLoading(true);
    clientPortalService.getDashboardSummary(session.user.id)
      .then(r => { if (mounted) setData(r as DashboardData); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session?.user?.id]);

  const firstName      = session?.client?.nome?.split(' ')[0] || 'Cliente';
  const hour           = new Date().getHours();
  const greeting       = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const hasPendingSig  = !loading && (data?.signaturesPending ?? 0) > 0;
  const hasOverdueFin  = !loading && (data?.financial?.overdue ?? 0) > 0;
  const pendingTotal   = (data?.signaturesPending ?? 0) + (data?.deadlinesOverdue ?? 0);
  const showFinancial  = !loading && !!data?.financial && ((data.financial.total > 0) || ((data.financial.net ?? 0) > 0));

  const shortcuts = [
    { id: 'documentos', icon: FolderOpen, label: 'Docs'      },
    { id: 'agenda',     icon: Calendar,   label: 'Agenda'    },
    { id: 'financeiro', icon: PiggyBank,  label: 'Financeiro'},
    { id: 'perfil',     icon: FileText,   label: 'Perfil'    },
  ].filter(({ id }) => id === 'perfil' || isEnabled(id as never));

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-2.5rem)] lg:overflow-hidden">

      {/* ─── HERO MOBILE ────────────────────────────────────────────────────── */}
      <div
        className="-mx-3 sm:-mx-5 lg:hidden"
        style={{ marginTop: 'calc(-1 * (env(safe-area-inset-top) + 4.75rem))' }}
      >
        <div
          className="relative overflow-hidden bg-slate-900 px-5 pb-14 text-white"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 5.25rem)' }}
        >
          {/* Círculos decorativos */}
          <div className="pointer-events-none absolute -right-14 -top-14 h-80 w-80 rounded-full bg-white/[0.04]" />
          <div className="pointer-events-none absolute right-8  top-8  h-52 w-52 rounded-full bg-white/[0.03]" />
          <div className="pointer-events-none absolute bottom-3 left-[42%] h-16 w-16 rounded-full bg-white/[0.04]" />

          {/* Conteúdo */}
          <div className="relative flex items-end justify-between">
            <div>
              <p className="text-[13px] font-medium text-slate-400">{greeting}</p>
              <p className="mt-0.5 text-[18px] font-bold text-white/80 leading-none">{firstName}</p>
              <div className="mt-4">
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-14 w-16 animate-pulse rounded-2xl bg-white/10" />
                    <div className="h-3 w-28 animate-pulse rounded bg-white/10" />
                  </div>
                ) : (
                  <button
                    onClick={() => navigate('casos')}
                    className="text-left transition active:opacity-70"
                    aria-label="Ver casos ativos"
                  >
                    <p className="text-[58px] font-extrabold leading-none tabular-nums tracking-tight">
                      {data?.processesActive ?? 0}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-400">
                      caso{(data?.processesActive ?? 0) !== 1 ? 's' : ''} ativo{(data?.processesActive ?? 0) !== 1 ? 's' : ''}
                      {pendingTotal > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">
                          {pendingTotal} pendência{pendingTotal !== 1 ? 's' : ''}
                        </span>
                      )}
                    </p>
                  </button>
                )}
              </div>
            </div>
            <div className="mb-2 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/[0.07]">
              <Briefcase className="h-8 w-8 text-white/50" strokeWidth={1.5} />
            </div>
          </div>

          {/* Ações rápidas */}
          <div className="relative mt-6 flex items-center gap-2.5">
            <button
              onClick={() => navigate('casos')}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 text-[13px] font-semibold text-white transition active:bg-white/15"
            >
              <Briefcase className="h-4 w-4" strokeWidth={1.75} />
              Meus casos
            </button>
            <button
              onClick={() => navigate('assinar')}
              className="relative flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-3 text-[13px] font-semibold text-slate-900 shadow-lg transition active:bg-slate-100"
            >
              <PenTool className="h-4 w-4" strokeWidth={1.75} />
              Assinar
              {hasPendingSig && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-slate-900">
                  {data!.signaturesPending}
                </span>
              )}
            </button>
            {isEnabled('mensagens' as never) && (
              <button
                onClick={() => navigate('mensagens')}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition active:bg-white/15"
                aria-label="Mensagens"
              >
                <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── CONTEÚDO (flutua sobre o rodapé do hero) ─────────────────────── */}
      <div className="-mt-8 flex flex-col gap-3 lg:mt-0 lg:contents">

        {/* Atalhos rápidos — grade 4 colunas, só mobile */}
        {shortcuts.length > 0 && (
          <div className="grid grid-cols-4 gap-2 rounded-[28px] bg-white px-3 py-4 shadow-[0_8px_32px_rgba(15,23,42,0.09)] lg:hidden">
            {shortcuts.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => navigate(id as never)}
                className="flex flex-col items-center gap-2 rounded-2xl py-2 transition active:bg-slate-50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <span className="text-[11px] font-semibold leading-none text-slate-500">{label}</span>
              </button>
            ))}
          </div>
        )}

        <SecurityBanner compact />

        {/* Alertas */}
        {(hasPendingSig || hasOverdueFin) && (
          <div className="flex flex-col gap-2">
            {hasPendingSig && (
              <button onClick={() => navigate('assinar')}
                className="group flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left shadow-[0_2px_10px_rgba(15,23,42,0.07)] transition active:opacity-90">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                  <PenTool className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    <span className="tabular-nums">{data!.signaturesPending}</span> doc{data!.signaturesPending !== 1 ? 's' : ''} aguardando assinatura
                  </p>
                  <p className="text-xs text-slate-400">Toque para assinar</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-200 transition group-hover:text-orange-400" />
              </button>
            )}
            {hasOverdueFin && (
              <button onClick={() => navigate('financeiro')}
                className="group flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left shadow-[0_2px_10px_rgba(15,23,42,0.07)] transition active:opacity-90">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    Parcela{data!.financial.overdue > 1 ? 's' : ''} em atraso — {formatCurrency(data!.financial.overdue)}
                  </p>
                  <p className="text-xs text-slate-400">Ver financeiro</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-200 transition group-hover:text-rose-400" />
              </button>
            )}
          </div>
        )}

        {/* Desktop: cabeçalho com mini-cards */}
        <header className="hidden grid-cols-[minmax(0,1fr)_250px] gap-3 lg:grid">
          <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-600">{greeting}</p>
            <h1 className="mt-1.5 text-[26px] font-extrabold tracking-tight text-slate-900 sm:text-[30px]">{firstName}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">Acompanhe casos, documentos, agenda e mensagens.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => navigate('casos')} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">Ver meus casos</button>
              <button onClick={() => navigate('mensagens')} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-orange-200 hover:text-orange-600">Mensagens</button>
            </div>
          </div>
          <div className="grid gap-3">
            <HeroMiniCard label="Casos ativos" value={loading ? '—' : String(data?.processesActive ?? 0)} helper={loading ? 'carregando' : `${data?.casesTotal ?? 0} no total`} />
            <HeroMiniCard label="Pendências"   value={loading ? '—' : String(pendingTotal)} helper={loading ? 'carregando' : `${data?.signaturesPending ?? 0} assinaturas · ${data?.deadlinesOverdue ?? 0} prazos`} accent={pendingTotal > 0} />
          </div>
        </header>

        {/* Stats — desktop */}
        <div className="hidden grid-cols-4 gap-3 lg:grid">
          {loading ? (<><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>) : (
            <>
              <StatCell icon={Briefcase} label="Casos"       value={data?.casesTotal ?? 0}            sub={`${data?.processesActive ?? 0} em andamento`}                                            onClick={() => navigate('casos')}      />
              <StatCell icon={PenTool}   label="Assinaturas" value={data?.signaturesPending ?? 0}      sub={(data?.signaturesPending ?? 0) > 0 ? 'pendentes' : 'em dia'}  urgent={(data?.signaturesPending ?? 0) > 0} onClick={() => navigate('assinar')}    />
              <StatCell icon={Clock}     label="Prazos"      value={data?.deadlinesPending ?? 0}       sub={(data?.deadlinesOverdue ?? 0) > 0 ? `${data?.deadlinesOverdue} vencidos` : 'em aberto'}  urgent={(data?.deadlinesOverdue ?? 0) > 0} onClick={() => navigate('agenda')}     />
              <StatCell icon={FileText}  label="Documentos"  value={data?.documentsCount ?? 0}         sub="disponíveis"                                                                              onClick={() => navigate('documentos')} />
            </>
          )}
        </div>

        {/* Financeiro */}
        {showFinancial && (
          <FinancialOverview financial={data!.financial} nextInstallment={data!.nextInstallment} onClick={() => navigate('financeiro')} compact />
        )}

        {/* Compromissos + Movimentações */}
        <div className="grid min-h-0 grid-cols-1 gap-3 lg:flex-1 lg:grid-cols-2">
          <section className="flex min-h-[160px] flex-col rounded-[22px] bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,0.06)] lg:min-h-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-slate-900">Próximos compromissos</h2>
              <button onClick={() => navigate('agenda')} className="text-xs font-semibold text-orange-500">Ver agenda</button>
            </div>
            <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {loading ? <SkeletonCard /> : (
                <>
                  <UpcomingItem type="event"    data={data?.nextEvent}    emptyText="Sem compromissos agendados" onClick={() => navigate('agenda')} />
                  <UpcomingItem type="deadline" data={data?.nextDeadline} emptyText="Sem prazos pendentes"       onClick={() => navigate('agenda')} />
                </>
              )}
            </div>
          </section>

          <section className="flex min-h-[160px] flex-col rounded-[22px] bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,0.06)] lg:min-h-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-bold text-slate-900">Últimas movimentações</h2>
              <button onClick={() => navigate('casos')} className="text-xs font-semibold text-orange-500">Ver tudo</button>
            </div>
            <div className="flex flex-col gap-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {loading ? <SkeletonCard /> : !data?.recentMovements?.length ? (
                <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-slate-200" />
                  <p className="mt-2 text-sm text-slate-400">Sem movimentações recentes</p>
                </div>
              ) : data.recentMovements.map((m, i) => <MovementRow key={i} movement={m} />)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

// ── Sub-componentes ──────────────────────────────────────────────────────────

const HeroMiniCard: React.FC<{ label: string; value: string; helper: string; accent?: boolean }> = ({ label, value, helper, accent }) => (
  <div className={`rounded-[20px] border bg-white px-4 py-3.5 shadow-sm ${accent ? 'border-orange-200' : 'border-slate-200'}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
    <p className={`mt-2 text-[28px] font-extrabold tracking-tight ${accent ? 'text-orange-500' : 'text-slate-900'}`}>{value}</p>
    <p className="mt-1 text-[11px] text-slate-400">{helper}</p>
  </div>
);

const StatCell: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: number; sub?: string; urgent?: boolean; onClick?: () => void }> = ({ icon: Icon, label, value, sub, urgent, onClick }) => (
  <button onClick={onClick} className="group flex min-h-[120px] flex-col gap-2 rounded-[20px] bg-white p-4 text-left shadow-sm transition active:opacity-90 hover:shadow-md">
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${urgent ? 'bg-rose-50 text-rose-500' : 'bg-slate-100 text-slate-400'}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className={`text-[34px] font-extrabold tracking-tight tabular-nums leading-none ${urgent ? 'text-rose-500' : 'text-slate-900'}`}>{value}</p>
    {sub && <p className="mt-auto text-[12px] text-slate-400">{sub}</p>}
  </button>
);

const FinancialOverview: React.FC<{ financial: FinancialSummary; nextInstallment: Record<string, unknown> | null; onClick: () => void; compact?: boolean }> = ({ financial, nextInstallment, onClick, compact = false }) => {
  const hasReceivable = (financial.net ?? 0) > 0;
  const recvPct = (financial.net ?? 0) > 0 ? Math.round(((financial.received ?? 0) / (financial.net ?? 1)) * 100) : 0;
  const paidPct = financial.total > 0 ? Math.round((financial.paid / financial.total) * 100) : 0;
  const nextDue   = nextInstallment?.due_date as string | undefined;
  const nextValue = nextInstallment?.value as number | undefined;
  return (
    <section className={`rounded-[22px] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.06)] ${compact ? 'p-4' : 'p-5'}`}>
      <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
        <h2 className="text-[13px] font-bold text-slate-900">{hasReceivable ? 'Seus acordos' : 'Resumo financeiro'}</h2>
        <button onClick={onClick} className="text-xs font-semibold text-orange-500">Ver detalhes</button>
      </div>
      {hasReceivable ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Você recebe</p>
          <p className={`font-bold tabular-nums text-emerald-600 ${compact ? 'mt-1 text-[28px]' : 'mt-1 text-3xl'}`}>{formatCurrency(financial.net ?? 0)}</p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, recvPct)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-400">
            <span>{formatCurrency(financial.received ?? 0)} já recebido</span>
            <span className="font-semibold text-slate-600 tabular-nums">{recvPct}%</span>
          </div>
          {nextDue && <p className="mt-2 text-xs text-slate-400">Próximo: <span className="font-semibold text-slate-700 tabular-nums">{formatCurrency(Number(nextValue))}</span> em {formatDateLong(nextDue)}</p>}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
            {[['Honorários', financial.total, 'text-slate-900'], ['Quitado', financial.paid, 'text-emerald-600'], ['A pagar', financial.pending, 'text-amber-700'], ['Em atraso', financial.overdue, 'text-rose-600']].map(([l, v, c]) => (
              <div key={l as string}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{l}</p>
                <p className={`mt-0.5 text-[15px] font-semibold tabular-nums ${c}`}>{formatCurrency(v as number)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Progresso</span>
              <span className="font-bold text-slate-700 tabular-nums">{paidPct}%</span>
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

const UPCOMING_META = {
  event:       { icon: Calendar,  label: 'Compromisso' },
  deadline:    { icon: Clock,     label: 'Prazo'       },
  installment: { icon: PiggyBank, label: 'Parcela'     },
} as const;

const UpcomingItem: React.FC<{ type: keyof typeof UPCOMING_META; data: Record<string, unknown> | null | undefined; emptyText: string; onClick: () => void }> = ({ type, data, emptyText, onClick }) => {
  const { icon: Icon, label } = UPCOMING_META[type];
  if (!data) return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-slate-300" />
      <p className="text-xs text-slate-400">{emptyText}</p>
    </div>
  );
  const title     = (data.title as string) || (data.agreement_title as string) || (type === 'installment' ? `Parcela ${data.installment_number ?? ''}` : 'Item');
  const dateField = (data.start_at || data.due_date || data.date) as string | undefined;
  if (dateField && new Date(dateField) < new Date()) return null;
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-3 rounded-[16px] bg-slate-50 px-3 py-2.5 text-left transition active:opacity-90 hover:bg-slate-100">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
        {dateField && <p className="truncate text-xs text-slate-400 tabular-nums">{formatDateLong(dateField)}{type === 'installment' && data.value ? ` · ${formatCurrency(Number(data.value))}` : ''}</p>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-200 transition group-hover:text-slate-400" />
    </button>
  );
};

const MovementRow: React.FC<{ movement: Record<string, unknown> }> = ({ movement }) => {
  const name = (movement.nome as string) || 'Movimentação';
  const date = (movement.data_hora || movement.data || movement.created_at) as string | null;
  const code = movement.process_code as string | undefined;
  return (
    <div className="flex items-start gap-3 rounded-[14px] px-2 py-2.5 transition hover:bg-slate-50">
      <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
          {code && <><span className="font-mono tabular-nums">{code}</span><span>·</span></>}
          <span className="tabular-nums">{formatRelative(date)}</span>
        </div>
      </div>
    </div>
  );
};

export default PortalDashboard;
