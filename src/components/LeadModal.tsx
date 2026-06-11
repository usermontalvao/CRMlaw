import React from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, X } from 'lucide-react';
import type { CreateLeadDTO } from '../types/lead.types';
import { useFormLayout } from '../hooks/useFormLayout';

interface LeadModalProps {
  isOpen: boolean;
  saving?: boolean;
  formData: CreateLeadDTO;
  sources?: string[];
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onChange: <K extends keyof CreateLeadDTO>(field: K, value: CreateLeadDTO[K]) => void;
}

export const LeadModal: React.FC<LeadModalProps> = ({
  isOpen,
  saving = false,
  formData,
  sources,
  onClose,
  onSubmit,
  onChange,
}) => {
  const fl = useFormLayout('leads');

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center px-0 py-0 sm:items-center sm:px-6 sm:py-4">
      <div
        className="aero-backdrop absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="aero-modal relative flex h-[100dvh] max-h-[100dvh] w-[calc(100vw-12px)] flex-col overflow-hidden rounded-t-[28px] sm:h-auto sm:w-full sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="h-1.5 w-full bg-orange-500 flex-shrink-0" />
        <div className="aero-modal-inner flex items-start justify-between gap-4 border-b border-white/30 px-4 py-4 dark:border-white/10 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              Formulário
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Novo Lead</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <form onSubmit={onSubmit} className="space-y-4 p-4 sm:p-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                {fl.fieldLabel('name', 'Nome completo')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-[#e7e5df] rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="Digite o nome do lead"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {!fl.isHidden('email') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{fl.fieldLabel('email', 'E-mail')}</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => onChange('email', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-[#e7e5df] rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    placeholder="email@exemplo.com"
                    required={fl.isRequired('email')}
                  />
                </div>
              )}
              {!fl.isHidden('phone') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{fl.fieldLabel('phone', 'Telefone')}</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => onChange('phone', e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-[#e7e5df] rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    placeholder="(00) 00000-0000"
                    required={fl.isRequired('phone')}
                  />
                </div>
              )}
            </div>

            {!fl.isHidden('source') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{fl.fieldLabel('source', 'Origem')}</label>
                <input
                  type="text"
                  list="lead-modal-sources"
                  value={formData.source}
                  onChange={(e) => onChange('source', e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-[#e7e5df] rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="Ex: Indicação, Site, Instagram"
                  required={fl.isRequired('source')}
                />
                {sources && sources.length > 0 && (
                  <datalist id="lead-modal-sources">
                    {sources.map(s => <option key={s} value={s} />)}
                  </datalist>
                )}
              </div>
            )}

            {!fl.isHidden('notes') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{fl.fieldLabel('notes', 'Observações')}</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => onChange('notes', e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-[#e7e5df] rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all"
                  rows={4}
                  placeholder="Informações adicionais sobre o lead..."
                  required={fl.isRequired('notes')}
                />
              </div>
            )}
          </form>
        </div>

        <div className="aero-modal-inner border-t border-white/30 px-4 py-3 dark:border-white/10 sm:px-6 flex-shrink-0">
          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-slate-200 px-6 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="submit"
              onClick={onSubmit}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-600/60 bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:ring-offset-1 focus:ring-offset-white disabled:cursor-not-allowed disabled:border-orange-300/60 disabled:from-orange-300 disabled:to-orange-300 disabled:shadow-none dark:focus:ring-offset-slate-900 sm:w-auto"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Criar Lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default LeadModal;
