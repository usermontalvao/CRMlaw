import React from 'react';
import { Wallet, ChevronRight, TrendingUp, AlertTriangle, PiggyBank, Eye, EyeOff } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';

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
  hideValues?: boolean;
  onToggleReveal?: () => void;
}

const MASKED = 'R$ •••••';

export const FinancialCard: React.FC<FinancialCardProps> = ({ stats, onNavigate, hideValues = true, onToggleReveal }) => {
  const isPlaceholder = !stats;
  const safeStats: FinancialStats = stats || {
    monthly_fees_received: 0,
    paid_installments: 0,
    monthly_fees_pending: 0,
    pending_installments: 0,
    total_overdue: 0,
    overdue_installments: 0,
  };

  const fmtMoney = (v: number) => isPlaceholder ? '—' : hideValues ? MASKED : formatCurrency(v);

  return (
    <div className="rounded-2xl border border-[#e7e5df]/60 bg-[#f8f7f5] overflow-hidden h-fit">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Financeiro</h3>
            <p className="text-xs text-slate-500">Resumo do mês</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onToggleReveal && (
            <button
              onClick={onToggleReveal}
              title={hideValues ? 'Ver valores (6h)' : 'Ocultar valores'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              {hideValues ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onNavigate}
            className="text-sm font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1"
          >
            Ver
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span className="text-sm text-slate-600">Recebido</span>
          </div>
          <span className="text-sm font-semibold text-emerald-600">{fmtMoney(safeStats.monthly_fees_received)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-slate-600">A receber</span>
          </div>
          <span className="text-sm font-semibold text-amber-600">{fmtMoney(safeStats.monthly_fees_pending)}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm text-slate-600">Em atraso</span>
          </div>
          <span className="text-sm font-semibold text-red-600">{fmtMoney(safeStats.total_overdue)}</span>
        </div>

        {/* Contadores — sempre visíveis (não são valores monetários) */}
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
