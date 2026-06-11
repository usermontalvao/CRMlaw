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
    <div className="flex flex-col gap-4">
      {/* Header app-style */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
          <Wallet className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Financeiro</h1>
          <p className="text-[12px] text-slate-400">Acordos e recibos</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : agreements.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sem movimentações financeiras" description="Quando houver um acordo ou pagamento vinculado ao seu processo, ele aparecerá aqui." />
      ) : (
        <>
          {/* RECEBER (acordos) */}
          {summary.hasReceivable && (
            <section className="overflow-hidden rounded-2xl bg-[#f8f7f5] shadow-[0_2px_10px_rgba(15,23,42,0.07)]">
              <div className="flex">
                <div className="w-1 shrink-0 bg-emerald-500" />
                <div className="flex-1 px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Você recebe</p>
                  <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-emerald-600">{formatBRL(summary.net)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${summary.recvPct}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[12px] text-slate-500">
                    <span className="tabular-nums">{formatBRL(summary.received)} já recebido</span>
                    <span className="tabular-nums">{formatBRL(summary.toReceive)} a receber</span>
                  </div>
                  {!summary.hasPayable && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-[12px] text-slate-400">
                      A taxa do escritório já está descontada do valor acima — você não paga nada além disso.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* PAGAR (honorários contratados pelo cliente) */}
          {summary.hasPayable && (
            <section className="overflow-hidden rounded-2xl bg-[#f8f7f5] shadow-[0_2px_10px_rgba(15,23,42,0.07)]">
              <div className="flex">
                <div className={`w-1 shrink-0 ${summary.payOverdue > 0 ? 'bg-rose-500' : 'bg-orange-500'}`} />
                <div className="flex-1 px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor contratado</p>
                  <p className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-slate-900">{formatBRL(summary.payFee)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all ${summary.payOverdue > 0 ? 'bg-rose-500' : 'bg-orange-500'}`} style={{ width: `${summary.payPct}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[12px]">
                    <span className="tabular-nums text-emerald-600">{formatBRL(summary.payPaid)} quitado</span>
                    <span className={`tabular-nums ${summary.payOverdue > 0 ? 'font-bold text-rose-600' : 'text-slate-500'}`}>
                      {formatBRL(summary.payOpen)} {summary.payOverdue > 0 ? 'em atraso' : 'a pagar'}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Tabs pill-style */}
          <div className="flex gap-2">
            {([
              { id: 'contratos' as Tab, label: 'Contratos', count: agreements.length },
              { id: 'recibos'   as Tab, label: 'Recibos',   count: paidInstallments.length },
            ]).map((t) => {
              const on = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition ${
                    on ? 'bg-slate-900 text-white' : 'bg-[#f8f7f5] text-slate-500 shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
                  }`}>
                  {t.label}
                  <span className={`min-w-[18px] rounded-full px-1.5 text-[11px] font-bold tabular-nums ${on ? 'bg-[#f8f7f5]/20 text-white' : 'text-slate-400'}`}>
                    {t.count}
                  </span>
                </button>
              );
            })}
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

  const accentColor = v.isAcordo ? 'bg-emerald-500' : 'bg-orange-500';

  return (
    <div className="overflow-hidden rounded-2xl bg-[#f8f7f5] shadow-[0_2px_10px_rgba(15,23,42,0.07)]">
      <div className="flex">
        <div className={`w-1 shrink-0 ${accentColor}`} />
        <div className="flex-1">
          <button onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition active:bg-slate-50">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${v.isAcordo ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
              {v.isAcordo ? <HandCoins className="h-4.5 w-4.5" strokeWidth={1.75} /> : <Wallet className="h-4.5 w-4.5" strokeWidth={1.75} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {v.isAcordo ? 'Acordo judicial' : 'Contrato de serviços'}
                  </p>
                  <h2 className="mt-0.5 line-clamp-1 text-[15px] font-bold text-slate-900">{a.title || 'Contrato'}</h2>
                </div>
                {a.status && <StatusBadge status={a.status} />}
              </div>

              {v.isAcordo ? (
                <div className="mt-3">
                  {v.net > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Você recebe</p>
                      <p className="text-[22px] font-extrabold tabular-nums text-emerald-600">{formatBRL(v.net)}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
                    <span>Acordo: <span className="font-semibold tabular-nums text-slate-700">{formatBRL(v.total)}</span></span>
                    <span>Taxa ({v.percentage}%): <span className="font-semibold tabular-nums text-slate-700">{formatBRL(v.fee)}</span></span>
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${v.clientProgress}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                    <span>Você já recebeu</span><span className="tabular-nums font-semibold text-emerald-600">{v.clientProgress}%</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-[12px] text-slate-500">Valor: <span className="font-semibold tabular-nums text-slate-700">{formatBRL(v.fee)}</span></p>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${v.feeProgress}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                    <span>Quitado</span><span className="tabular-nums font-semibold text-slate-700">{v.feeProgress}%</span>
                  </div>
                </div>
              )}
            </div>
            <span className="mt-0.5 shrink-0 text-slate-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
          </button>

          {!open && next && (
            <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-700">
              <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span className="font-semibold">Próxima parcela:</span>
              <span className="tabular-nums">{formatBRL(next.value)} · venc. {formatDate(next.due_date)}</span>
            </div>
          )}

          {open && installments.length > 0 && (
            <div className="border-t border-slate-100">
              <p className="px-4 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {v.isAcordo ? 'Parcelas do acordo' : 'Parcelas do contrato'}
              </p>
              <div className="divide-y divide-slate-100">
                {installments.map((inst) => {
                  const st = instStatus(inst);
                  const dotColor = st.key === 'pago' ? 'bg-emerald-500' : st.key === 'vencido' ? 'bg-rose-500' : st.key === 'cancelado' ? 'bg-slate-300' : 'bg-amber-500';
                  return (
                    <div key={inst.id} className="flex items-center gap-3 px-4 py-3">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                      <span className="w-5 text-center text-[11px] font-bold tabular-nums text-slate-400">#{inst.installment_number || '?'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold tabular-nums text-slate-900">{formatBRL(inst.value)}</p>
                        <p className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-0.5"><Calendar className="h-3 w-3" />{formatDate(inst.due_date)}</span>
                          {v.isAcordo && <span className="tabular-nums text-orange-600">escritório: {formatBRL(installmentFee(inst.value, v.feeRatio))}</span>}
                        </p>
                      </div>
                      <span className={`text-[11px] font-bold ${st.key === 'pago' ? 'text-emerald-600' : st.key === 'vencido' ? 'text-rose-600' : 'text-slate-500'}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
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
        ? `Honorários advocatícios referente à parcela ${num}/${a.installments_count ?? '?'} de "${a.title}"`
        : `Honorários advocatícios referente a "${a.title}"`,
      serviceDescription: a.description || undefined,
      paymentMethod: paymentMethodLabel(inst.payment_method),
      paymentDateDisplay: inst.payment_date
        ? new Date(inst.payment_date + 'T12:00:00').toLocaleDateString('pt-BR')
        : new Date().toLocaleDateString('pt-BR'),
      agreementTitle: a.title || 'Contrato',
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-[#f8f7f5] shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
      <div className="flex">
        <div className="w-1 shrink-0 bg-emerald-500" />
        <div className="flex flex-1 items-center gap-3 px-4 py-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Receipt className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {inst.agreement.title || 'Contrato'}
              {inst.installment_number ? ` · Parcela #${inst.installment_number}` : ''}
            </p>
            <p className="mt-0.5 text-[16px] font-extrabold tabular-nums text-slate-900">{formatBRL(honorarios)}</p>
            {inst.payment_date && (
              <p className="text-[12px] font-semibold text-emerald-600">Pago em {formatDate(inst.payment_date)}</p>
            )}
          </div>
          <button
            onClick={handleReceipt}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-slate-100 px-3 py-2 text-[12px] font-semibold text-slate-700 transition active:bg-slate-200"
          >
            <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} /> Recibo
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortalFinancial;
