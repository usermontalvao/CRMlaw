import React, { useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Clock, ChevronDown, ChevronUp,
  Calendar, Receipt, Wallet, HandCoins,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, StatusBadge, formatDate } from '../components/PortalUI';
import { agreementView, installmentFee, formatBRL, type AgreementLike } from '../lib/domain';
import { openReceipt, paymentMethodLabel } from '../../lib/receipt';

interface Installment {
  id: string;
  installment_number?: number;
  due_date?: string;
  value: number;
  status: string;
  payment_date?: string;
  payment_method?: string;
  paid_value?: number;
}
interface Agreement extends AgreementLike {
  id: string; title?: string; description?: string; status?: string; created_at?: string;
  installments_count?: number;
  installments?: Installment[];
  next_installment?: Installment | null;
}

type Tab = 'contratos' | 'recibos';

function instStatus(inst: Installment): { key: string; label: string } {
  const s = (inst.status || '').toLowerCase();
  if (s === 'pago') return { key: 'pago', label: 'Pago' };
  if (s === 'cancelado') return { key: 'cancelado', label: 'Cancelado' };
  if ((s === 'pendente' || s === 'vencido') && inst.due_date && new Date(inst.due_date) < new Date()) {
    return { key: 'vencido', label: 'Vencido' };
  }
  return { key: 'pendente', label: 'A vencer' };
}

export const PortalFinancial: React.FC = () => {
  const { session } = useClientAuth();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>('contratos');

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    setLoading(true);
    clientPortalService.listFinancial(session.user.id)
      .then((data) => {
        if (mounted) {
          const list = data as Agreement[];
          setAgreements(list);
          if (list.length === 1) setExpanded({ [list[0].id]: true });
        }
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session]);

  const summary = useMemo(() => {
    // RECEBER: acordos onde o cliente tem líquido a receber
    let net = 0, received = 0, toReceive = 0;
    // PAGAR: honorários que o cliente efetivamente paga (contratos fixos / acordo sem líquido)
    let payFee = 0, payPaid = 0, payOpen = 0, payOverdue = 0;
    agreements.forEach((a) => {
      const v = agreementView(a);
      const isReceive = v.isAcordo && v.net > 0;
      if (isReceive) {
        net += v.net; received += v.clientReceived; toReceive += v.clientToReceive;
      } else {
        payFee += v.fee; payPaid += v.feePaid;
        payOpen += v.feePending + v.feeOverdue; payOverdue += v.feeOverdue;
      }
    });
    const recvPct = net > 0 ? Math.min(100, Math.round((received / net) * 100)) : 0;
    const payPct  = payFee > 0 ? Math.min(100, Math.round((payPaid / payFee) * 100)) : 0;
    return {
      hasReceivable: net > 0, hasPayable: payFee > 0,
      net, received, toReceive, recvPct,
      payFee, payPaid, payOpen, payOverdue, payPct,
    };
  }, [agreements]);

  const paidInstallments = useMemo(() => {
    const list: (Installment & { agreement: Agreement })[] = [];
    agreements.forEach((a) => (a.installments || []).forEach((inst) => {
      if ((inst.status || '').toLowerCase() === 'pago') list.push({ ...inst, agreement: a });
    }));
    return list.sort((a, b) => new Date(b.payment_date || 0).getTime() - new Date(a.payment_date || 0).getTime());
  }, [agreements]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Financeiro</h1>
        <p className="mt-0.5 text-sm text-slate-500">Honorários, contratos e recibos</p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : agreements.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sem contratos" description="Você ainda não possui contratos financeiros cadastrados." />
      ) : (
        <>
          {/* RECEBER (acordos) */}
          {summary.hasReceivable && (
            <>
              <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 p-5 text-white shadow-sm">
                <div className="flex items-center gap-2 text-emerald-50">
                  <HandCoins className="h-4 w-4" />
                  <p className="text-xs font-semibold uppercase tracking-wide">Você recebe</p>
                </div>
                <p className="mt-1 text-3xl font-bold">{formatBRL(summary.net)}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white transition-all" style={{ width: `${summary.recvPct}%` }} />
                </div>
                <div className="mt-3 flex justify-between text-xs">
                  <span className="font-semibold">{formatBRL(summary.received)} já recebido</span>
                  <span className="text-emerald-50">{formatBRL(summary.toReceive)} a receber</span>
                </div>
              </div>
              {/* tranquilizador só faz sentido quando NÃO há honorários a pagar à parte */}
              {!summary.hasPayable && (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <span className="mt-0.5 text-base">✅</span>
                  <p className="text-xs leading-relaxed text-emerald-900">
                    <strong>Você não paga nada à parte.</strong> Os honorários do escritório já estão descontados do valor que você recebe — tudo de forma transparente.
                  </p>
                </div>
              )}
            </>
          )}

          {/* PAGAR (honorários contratados pelo cliente) */}
          {summary.hasPayable && (
            <>
              <div className="overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
                <div className="flex items-center gap-2 text-slate-400">
                  <Wallet className="h-4 w-4" />
                  <p className="text-xs font-semibold uppercase tracking-wide">Honorários contratados</p>
                </div>
                <p className="mt-1 text-3xl font-bold">{formatBRL(summary.payFee)}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all" style={{ width: `${summary.payPct}%` }} />
                </div>
                <div className="mt-3 flex justify-between text-xs">
                  <span className="font-semibold text-emerald-400">{formatBRL(summary.payPaid)} quitado</span>
                  <span className={summary.payOverdue > 0 ? 'font-semibold text-rose-400' : 'text-slate-400'}>
                    {formatBRL(summary.payOpen)} {summary.payOverdue > 0 ? 'em atraso' : 'a pagar'}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="mt-0.5 text-base">⚖️</span>
                <p className="text-xs leading-relaxed text-slate-600">
                  {summary.hasReceivable
                    ? <>Além do valor a receber acima, este é o <strong>honorário contratado</strong> à parte. Veja o detalhamento nos contratos abaixo.</>
                    : <>Estes são os <strong>honorários advocatícios</strong> contratados com o escritório. Veja o detalhamento de cada parcela abaixo.</>}
                </p>
              </div>
            </>
          )}

          {/* Tabs */}
          <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
            {([
              { id: 'contratos' as Tab, label: 'Contratos', count: agreements.length },
              { id: 'recibos' as Tab, label: 'Recibos', count: paidInstallments.length },
            ]).map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 active:bg-white/50'}`}>
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.id ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-500'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          {tab === 'contratos' && (
            <div className="flex flex-col gap-3">
              {agreements.map((a) => (
                <ContractCard key={a.id} agreement={a} open={!!expanded[a.id]} onToggle={() => setExpanded((p) => ({ ...p, [a.id]: !p[a.id] }))} />
              ))}
            </div>
          )}

          {tab === 'recibos' && (
            <div className="flex flex-col gap-3">
              {paidInstallments.length === 0 ? (
                <EmptyState icon={Receipt} title="Nenhum pagamento registrado" description="Quando uma parcela for paga, o recibo dela aparecerá aqui." />
              ) : (
                paidInstallments.map((inst) => <ReceiptCard key={inst.id} inst={inst} />)
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Contract card ───────────────────────────────────────────────────────────

const ContractCard: React.FC<{ agreement: Agreement; open: boolean; onToggle: () => void }> = ({ agreement: a, open, onToggle }) => {
  const v = agreementView(a);
  const installments = (a.installments || []).slice().sort((x, y) => (x.installment_number || 0) - (y.installment_number || 0));
  const next = a.next_installment;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button onClick={onToggle} className="flex w-full items-start gap-3.5 p-4 text-left transition hover:bg-slate-50 sm:p-5">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${v.isAcordo ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-gradient-to-br from-orange-500 to-amber-500'}`}>
          {v.isAcordo ? <HandCoins className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="line-clamp-1 text-sm font-bold text-slate-900">{a.title || 'Contrato'}</h2>
              <p className="text-[11px] font-medium text-slate-400">{v.isAcordo ? 'Acordo judicial' : 'Honorários contratados'}</p>
            </div>
            {a.status && <StatusBadge status={a.status} />}
          </div>

          {v.isAcordo ? (
            <>
              {/* Destaque: o que o cliente recebe */}
              {v.net > 0 && (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Você recebe</p>
                  <p className="text-lg font-bold text-emerald-700">{formatBRL(v.net)}</p>
                </div>
              )}
              {/* Contexto secundário */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip label="Valor do acordo" value={formatBRL(v.total)} tone="slate" />
                <Chip label={`Honorários ${v.percentage}%`} value={formatBRL(v.fee)} tone="orange" />
              </div>
              {/* Progresso do recebimento do cliente */}
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
                  <span>Você já recebeu</span><span className="font-bold text-emerald-700">{v.clientProgress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${v.clientProgress}%` }} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip label="Honorários" value={formatBRL(v.fee)} tone="orange" />
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
                  <span>Honorários quitados</span><span className="font-bold text-slate-700">{v.feeProgress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${v.feeProgress}%` }} />
                </div>
              </div>
            </>
          )}
        </div>
        <span className="shrink-0 text-slate-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>

      {!open && next && (
        <div className="border-t border-slate-100 bg-amber-50/50 px-4 py-2.5">
          <p className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span className="font-semibold text-amber-800">Próxima parcela:</span>
            <span className="text-slate-700">{formatBRL(next.value)} · venc. {formatDate(next.due_date)}</span>
          </p>
        </div>
      )}

      {open && installments.length > 0 && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {v.isAcordo ? 'Parcelas do acordo' : 'Parcelas dos honorários'}
          </p>
          {installments.map((inst) => {
            const st = instStatus(inst);
            const ring = st.key === 'pago' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : st.key === 'vencido' ? 'bg-rose-50 text-rose-700 ring-rose-200'
              : st.key === 'cancelado' ? 'bg-slate-100 text-slate-500 ring-slate-200'
              : 'bg-amber-50 text-amber-700 ring-amber-200';
            return (
              <div key={inst.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1 ${ring}`}>{inst.installment_number || '?'}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{formatBRL(inst.value)}</p>
                  <p className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{formatDate(inst.due_date)}</span>
                    {v.isAcordo && <span className="text-orange-600">honor. {formatBRL(installmentFee(inst.value, v.feeRatio))}</span>}
                  </p>
                </div>
                <StatusBadge status={st.key} label={st.label} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Chip: React.FC<{ label: string; value: string; tone: 'slate' | 'orange' | 'emerald' }> = ({ label, value, tone }) => {
  const cls = tone === 'orange' ? 'bg-orange-50 text-orange-700' : tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex flex-col rounded-lg px-2.5 py-1.5 ${cls}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-xs font-bold leading-tight">{value}</span>
    </span>
  );
};

// ── Receipt card ──────────────────────────────────────────────────────────────

const ReceiptCard: React.FC<{ inst: Installment & { agreement: Agreement } }> = ({ inst }) => {
  const { session } = useClientAuth();
  const clientName = session?.client?.nome || 'Cliente';
  const clientCpf = (() => {
    const d = String(session?.user?.cpf || '').replace(/\D/g, '');
    if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
    return undefined;
  })();
  const v = agreementView(inst.agreement);
  const honorarios = installmentFee(inst.paid_value ?? inst.value, v.feeRatio);

  const handleReceipt = () => {
    const a = inst.agreement;
    const num = inst.installment_number;
    openReceipt({
      clientName,
      clientCpf,
      amount: honorarios,
      description: num
        ? `Honorários advocatícios referente à parcela ${num}/${a.installments_count ?? '?'} do acordo "${a.title}".`
        : `Honorários advocatícios referente ao acordo "${a.title}".`,
      serviceDescription: a.description || undefined,
      paymentMethod: paymentMethodLabel(inst.payment_method),
      paymentDateDisplay: inst.payment_date
        ? new Date(inst.payment_date + 'T12:00:00').toLocaleDateString('pt-BR')
        : new Date().toLocaleDateString('pt-BR'),
      agreementTitle: a.title || 'Contrato',
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
      <div className="h-1 w-full bg-emerald-500" />
      <div className="flex items-center gap-3.5 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"><Receipt className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-xs font-semibold text-slate-500">{inst.agreement.title || 'Contrato'}</p>
          <p className="mt-0.5 text-base font-bold text-slate-900">{formatBRL(honorarios)}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
            {inst.payment_date && <span className="font-semibold text-emerald-700">Pago em {formatDate(inst.payment_date)}</span>}
            {inst.installment_number && <span>Parcela #{inst.installment_number}</span>}
          </div>
        </div>
        <button
          onClick={handleReceipt}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-600 active:scale-95">
          <Receipt className="h-3.5 w-3.5" /> Recibo
        </button>
      </div>
    </div>
  );
};

export default PortalFinancial;
