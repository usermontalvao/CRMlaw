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
  const isPlaceholder = !stats;
  const safeStats: FinancialStats = stats || {
    monthly_fees_received: 0,
    paid_installments: 0,
    monthly_fees_pending: 0,
    pending_installments: 0,
    total_overdue: 0,
    overdue_installments: 0,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-white">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Saúde Financeira</h3>
            <div className="flex items-center gap-1 text-[10px] text-emerald-600">
              <span className="animate-pulse rounded-full bg-emerald-400 w-1.5 h-1.5" />
              {isPlaceholder ? 'indisponível' : 'ativo'}
            </div>
          </div>
        </div>
        <button
          onClick={onNavigate}
          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
        >
          Abrir
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stats Grid - Compacto */}
      <div className="p-3 space-y-2">
        {/* Recebido */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 border border-emerald-100">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-slate-700">Recebido</span>
          </div>
          <span className="text-sm font-bold text-emerald-700">
            {isPlaceholder ? '—' : formatCurrency(safeStats.monthly_fees_received)}
          </span>
        </div>

        {/* A Receber */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50 border border-amber-100">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-slate-700">A receber</span>
          </div>
          <span className="text-sm font-bold text-amber-700">
            {isPlaceholder ? '—' : formatCurrency(safeStats.monthly_fees_pending)}
          </span>
        </div>

        {/* Em Atraso */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-rose-50 border border-rose-100">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span className="text-xs font-medium text-slate-700">Em atraso</span>
          </div>
          <span className="text-sm font-bold text-rose-700">
            {isPlaceholder ? '—' : formatCurrency(safeStats.total_overdue)}
          </span>
        </div>
      </div>

      {/* Footer - Contadores */}
      <div className="px-3 pb-3 flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-slate-600">
          <span>Recebidas</span>
          <strong className="text-slate-900">{isPlaceholder ? '—' : safeStats.paid_installments}</strong>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700">
          <span>Pendentes</span>
          <strong>{isPlaceholder ? '—' : safeStats.pending_installments}</strong>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-rose-50 text-rose-700">
          <span>Vencidas</span>
          <strong>{isPlaceholder ? '—' : safeStats.overdue_installments}</strong>
        </div>
      </div>
    </div>
  );
};

export default FinancialCard;
