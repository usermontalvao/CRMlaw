import { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, User } from 'lucide-react';
import { financialService } from '../services/financial.service';
import type { Agreement } from '../types/financial.types';

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value || 0);
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
          <p className="text-center text-slate-600">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!agreement) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
          <p className="text-center text-slate-600">Acordo não encontrado</p>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900">Detalhes do Acordo</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
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
          <div className="grid grid-cols-2 gap-4">
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
                <DollarSign className="w-4 h-4 text-blue-600" />
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
              agreement.status === 'concluido' ? 'bg-blue-100 text-blue-800' :
              agreement.status === 'cancelado' ? 'bg-red-100 text-red-800' :
              'bg-slate-100 text-slate-800'
            }`}>
              {agreement.status || '-'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4">
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
