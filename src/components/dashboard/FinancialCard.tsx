import React from 'react';
import { Wallet, ChevronRight } from 'lucide-react';

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

const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export const FinancialCard: React.FC<FinancialCardProps> = ({ stats, onNavigate }) => {
  if (!stats) return null;

  return (
    <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-4 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-white" />
          <h2 className="text-sm font-bold text-white">Financeiro</h2>
        </div>
        <button
          onClick={onNavigate}
          className="text-white/80 hover:text-white text-xs font-medium flex items-center gap-1"
        >
          Ver mais <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white/10 rounded-lg p-3">
          <p className="text-[10px] text-white/60 mb-1">Honorários</p>
          <p className="text-lg font-bold text-white">
            {formatCurrency(stats.monthly_fees_received)}
          </p>
        </div>
        <div className="bg-white/10 rounded-lg p-3">
          <p className="text-[10px] text-white/60 mb-1">Recebidos</p>
          <p className="text-lg font-bold text-emerald-300">
            {stats.paid_installments}{' '}
            <span className="text-xs font-normal text-white/50">parc.</span>
          </p>
        </div>
        <div className="bg-white/10 rounded-lg p-3">
          <p className="text-[10px] text-white/60 mb-1">Pendentes</p>
          <p className="text-lg font-bold text-amber-300">
            {formatCurrency(stats.monthly_fees_pending)}
          </p>
        </div>
        <div className="bg-white/10 rounded-lg p-3">
          <p className="text-[10px] text-white/60 mb-1">Vencidos</p>
          <p className="text-lg font-bold text-red-300">
            {formatCurrency(stats.total_overdue)}
          </p>
        </div>
      </div>
    </div>
  );
};

export default FinancialCard;
