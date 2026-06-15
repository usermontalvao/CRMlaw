import { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, User } from 'lucide-react';
import { financialService } from '../services/financial.service';
import type { Agreement } from '../types/financial.types';
import { formatCurrency, formatDate } from '../utils/formatters';

interface FinancialModalProps {
  agreementId: string;
  onClose: () => void;
}

export function FinancialModal({ agreementId, onClose }: FinancialModalProps) {
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAgreement() {
      try {
        const data = await financialService.getAgreement(agreementId);
        setAgreement(data);
      } catch (error) {
        console.error('Erro ao carregar acordo:', error);
      } finally {
        setLoading(false);
      }
    }
    loadAgreement();
  }, [agreementId]);

  // formatCurrency e formatDate importadas de utils/formatters (configuráveis globalmente)

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center px-3 py-0 aero-backdrop sm:items-center sm:px-4 sm:py-4">
        <div className="aero-modal w-full max-w-md rounded-t-[24px] p-6 sm:rounded-2xl">
          <p className="text-center text-slate-700 dark:text-slate-300">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!agreement) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center px-3 py-0 aero-backdrop sm:items-center sm:px-4 sm:py-4">
        <div className="aero-modal w-full max-w-md rounded-t-[24px] p-6 sm:rounded-2xl">
          <p className="text-center text-slate-700 dark:text-slate-300">Acordo não encontrado</p>
          <button
            onClick={onClose}
            className="mt-4 w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-0 py-0 aero-backdrop sm:items-center sm:px-4 sm:py-4">
      <div className="aero-modal flex h-[100dvh] max-h-[100dvh] w-[calc(100vw-12px)] flex-col overflow-hidden rounded-t-[28px] sm:h-auto sm:w-full sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 aero-modal-inner flex items-start justify-between gap-3 border-b border-white/30 px-4 py-4 dark:border-white/10 sm:px-6">
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Detalhes do Acordo</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 sm:p-6">
          {/* Descrição */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">DESCRIÇÃO</label>
            <p className="text-slate-900 font-medium">{agreement.description || '-'}</p>
          </div>

          {/* Cliente */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">CLIENTE</label>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />
              <span className="text-slate-900 font-medium">
                {agreement.client_id || '-'}
              </span>
            </div>
          </div>

          {/* Valores */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">VALOR TOTAL</label>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-600" />
                <span className="text-slate-900 font-bold text-lg">
                  {formatCurrency(agreement.total_value)}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">VALOR DA PARCELA</label>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-600" />
                <span className="text-slate-900 font-bold text-lg">
                  {formatCurrency(agreement.installment_value)}
                </span>
              </div>
            </div>
          </div>

          {/* Parcelas */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">PARCELAS</label>
            <p className="text-slate-900 font-medium">
              {agreement.installments_count}x
            </p>
          </div>

          {/* Data do Acordo */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">DATA DO ACORDO</label>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span className="text-slate-900 font-medium">
                {formatDate(agreement.agreement_date)}
              </span>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">STATUS</label>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
              agreement.status === 'ativo' ? 'bg-green-100 text-green-800' :
              agreement.status === 'concluido' ? 'bg-slate-100 text-slate-700' :
              agreement.status === 'cancelado' ? 'bg-red-100 text-red-800' :
              'bg-slate-100 text-slate-800'
            }`}>
              {agreement.status || '-'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#f8f7f5] border-t border-[#e7e5df] px-4 py-4 sm:px-6">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
