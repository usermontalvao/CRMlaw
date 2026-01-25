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
    <div className="rounded-2xl border border-slate-200/60 bg-white overflow-hidden h-fit">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Financeiro</h3>
            <p className="text-xs text-slate-500">Resumo do mês</p>
          </div>
        </div>
        <button
          onClick={onNavigate}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
        >
          Ver
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Stats - Compacto */}
      <div className="p-4 space-y-3">
        {/* Recebido */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-sm text-slate-600">Recebido</span>
          </div>
          <span className="text-sm font-semibold text-emerald-600">
            {isPlaceholder ? '—' : formatCurrency(safeStats.monthly_fees_received)}
          </span>
        </div>

        {/* A Receber */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-slate-600">A receber</span>
          </div>
          <span className="text-sm font-semibold text-amber-600">
            {isPlaceholder ? '—' : formatCurrency(safeStats.monthly_fees_pending)}
          </span>
        </div>

        {/* Em Atraso */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm text-slate-600">Em atraso</span>
          </div>
          <span className="text-sm font-semibold text-red-600">
            {isPlaceholder ? '—' : formatCurrency(safeStats.total_overdue)}
          </span>
        </div>

        {/* Contadores em linha */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            <strong className="text-slate-700">{isPlaceholder ? '—' : safeStats.paid_installments}</strong> recebidas
          </span>
          <span className="text-amber-600">
            <strong>{isPlaceholder ? '—' : safeStats.pending_installments}</strong> pendentes
          </span>
          <span className="text-red-600">
            <strong>{isPlaceholder ? '—' : safeStats.overdue_installments}</strong> vencidas
          </span>
        </div>
      </div>
    </div>
  );
};

export default FinancialCard;
