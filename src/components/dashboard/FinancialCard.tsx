import React from 'react';
import { Wallet, ChevronRight, TrendingUp, AlertTriangle, PiggyBank } from 'lucide-react';

interface FinancialStats {
  monthly_fees_received: number;
  paid_installments: number;
  monthly_fees_pending: number;
  pending_installments: number;
  total_overdue: number;
  overdue_installments: number;
}

interface FinancialCardProps {
  stats: FinancialStats | null;
  onNavigate: () => void;
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export const FinancialCard: React.FC<FinancialCardProps> = ({ stats, onNavigate }) => {
  if (!stats) return null;

  const cards = [
    {
      label: 'Recebido neste mês',
      value: formatCurrency(stats.monthly_fees_received),
      helper: 'Honorários liquidados',
      icon: TrendingUp,
      accent: 'bg-emerald-50 text-emerald-700',
      chip: 'text-emerald-600 bg-emerald-100'
    },
    {
      label: 'Ainda a receber',
      value: formatCurrency(stats.monthly_fees_pending),
      helper: 'Parcelas do mês',
      icon: PiggyBank,
      accent: 'bg-amber-50 text-amber-700',
      chip: 'text-amber-600 bg-amber-100'
    },
    {
      label: 'Em atraso',
      value: formatCurrency(stats.total_overdue),
      helper: `${stats.overdue_installments} parcelas`,
      icon: AlertTriangle,
      accent: 'bg-rose-50 text-rose-700',
      chip: 'text-rose-600 bg-rose-100'
    }
  ];

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-50 via-transparent to-blue-50" />
      <div className="pointer-events-none absolute inset-0 animate-cash-flow bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.07),_transparent_55%)]" />
      <div className="relative p-5 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Resumo</p>
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                Saúde Financeira
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                  <span className="animate-pulse rounded-full bg-emerald-400 w-2 h-2" />
                  ativo
                </span>
              </h2>
            </div>
          </div>
          <button
            onClick={onNavigate}
            className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            Abrir módulo <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map(({ label, value, helper, icon: Icon, accent, chip }) => (
            <div key={label} className="rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${chip}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {helper}
                </div>
              </div>
              <p className="text-2xl font-semibold text-slate-900">{value}</p>
              <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${accent}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current/60" />
                {label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700">
            <span className="text-slate-500">Recebidas</span>
            <strong className="text-slate-900">{stats.paid_installments}</strong>
            <span className="text-slate-400">parc.</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700">
            <span>Pendentes</span>
            <strong>{stats.pending_installments}</strong>
            <span className="text-amber-500/70">parc.</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 text-rose-700">
            <span>Vencidas</span>
            <strong>{stats.overdue_installments}</strong>
            <span className="text-rose-500/70">parc.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancialCard;
