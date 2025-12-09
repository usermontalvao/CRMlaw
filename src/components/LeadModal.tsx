import React from 'react';
import { Plus, Loader2, UserPlus, X } from 'lucide-react';
import type { CreateLeadDTO } from '../types/lead.types';

interface LeadModalProps {
  isOpen: boolean;
  saving?: boolean;
  formData: CreateLeadDTO;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onChange: <K extends keyof CreateLeadDTO>(field: K, value: CreateLeadDTO[K]) => void;
}

export const LeadModal: React.FC<LeadModalProps> = ({
  isOpen,
  saving = false,
  formData,
  onClose,
  onSubmit,
  onChange,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 z-50">
      <div className="w-full max-w-lg rounded-xl shadow-2xl bg-white dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-slate-700">
        {/* Faixa superior */}
        <div className="h-2 w-full bg-orange-500" />

        {/* Header compacto */}
        <div className="p-6 relative bg-transparent border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-orange-50 dark:bg-orange-900/40 border border-orange-100 dark:border-orange-900/60">
              <UserPlus className="w-6 h-6 text-orange-700 dark:text-orange-300" />
            </div>
            <h1 className="text-sm font-bold tracking-wider uppercase text-slate-500 dark:text-slate-200">Novo Lead</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute top-4 right-4 flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <div className="px-6 pb-6 space-y-5 bg-white dark:bg-slate-800">
            <div>
              <label className="block text-sm font-medium text-slate-500 dark:text-slate-200 mb-1.5">
                Nome completo <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-50 placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                placeholder="Digite o nome do lead"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-200 mb-1.5">E-mail</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => onChange('email', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-50 placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  placeholder="email@exemplo.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-500 dark:text-slate-200 mb-1.5">Telefone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => onChange('phone', e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-50 placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 dark:text-slate-200 mb-1.5">Origem</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => onChange('source', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-50 placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                placeholder="Ex: Indicação, Site, Instagram"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 dark:text-slate-200 mb-1.5">Observações</label>
              <textarea
                value={formData.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border-0 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-50 placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:ring-2 focus:ring-orange-500 focus:outline-none resize-none"
                rows={4}
                placeholder="Informações adicionais sobre o lead..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end items-center gap-4 px-6 py-4 bg-gray-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-slate-600 text-slate-800 dark:text-slate-50 hover:bg-gray-300 dark:hover:bg-slate-500 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white border border-orange-400/70 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-slate-800 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Criar Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LeadModal;
