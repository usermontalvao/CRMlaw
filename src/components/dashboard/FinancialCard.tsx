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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export const FinancialCard: React.FC<FinancialCardProps> = ({ stats, onNavigate }) => {
  if (!stats) return null;

  const cards = [
    {
      label: 'Recebido neste mês',
      value: formatCurrency(stats.monthly_fees_received),
      helper: 'Recebido neste mês',
      badge: 'Honorários liquidados',
      icon: TrendingUp,
      accent: 'bg-emerald-500 text-white',
      chip: 'text-white bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-sm',
      dot: 'bg-emerald-400'
    },
    {
      label: 'Ainda a receber',
      value: formatCurrency(stats.monthly_fees_pending),
      helper: 'Ainda a receber',
      badge: 'Parcelas do mês',
      icon: PiggyBank,
      accent: 'bg-amber-500 text-white',
      chip: 'text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-sm',
      dot: 'bg-amber-400'
    },
    {
      label: 'Em atraso',
      value: formatCurrency(stats.total_overdue),
      helper: 'Em atraso',
      badge: `${stats.overdue_installments} parcela${stats.overdue_installments !== 1 ? 's' : ''}`,
      icon: AlertTriangle,
      accent: 'bg-rose-500 text-white',
      chip: 'text-white bg-gradient-to-r from-rose-500 to-red-600 shadow-sm',
      dot: 'bg-rose-400'
    }
  ];

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-50 via-transparent to-blue-50" />
      <div className="pointer-events-none absolute inset-0 animate-cash-flow bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.07),_transparent_55%)]" />
      <div className="relative p-4 sm:p-5 flex flex-col gap-4 sm:gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-wide text-slate-500">Resumo</p>
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 flex items-center gap-2">
                Saúde Financeira
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                  <span className="animate-pulse rounded-full bg-emerald-400 w-2 h-2" />
                  ativo
                </span>
              </h2>
            </div>
          </div>
          <button
            onClick={onNavigate}
            className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <span className="hidden sm:inline">Abrir módulo</span>
            <span className="sm:hidden">Ver</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {cards.map(({ label, value, helper, badge, icon: Icon, accent, chip, dot }) => (
            <div key={label} className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white/80 p-3 sm:p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide truncate">{label}</p>
                <div className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-semibold flex-shrink-0 ${chip}`}>
                  <Icon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  <span className="hidden xs:inline">{badge}</span>
                </div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{value}</p>
              <div className="mt-1.5 sm:mt-2 inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium text-slate-500">
                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${dot}`} />
                {helper}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-xs">
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-slate-100 text-slate-700">
            <span className="text-slate-500">Recebidas</span>
            <strong className="text-slate-900">{stats.paid_installments}</strong>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-amber-50 text-amber-700">
            <span>Pendentes</span>
            <strong>{stats.pending_installments}</strong>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-rose-50 text-rose-700">
            <span>Vencidas</span>
            <strong>{stats.overdue_installments}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinancialCard;
