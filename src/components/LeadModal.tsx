import React from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, X } from 'lucide-react';
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

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
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

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
          <form onSubmit={onSubmit} className="p-8 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Nome completo <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => onChange('name', e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="Digite o nome do lead"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">E-mail</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => onChange('email', e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="email@exemplo.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Telefone</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => onChange('phone', e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Origem</label>
              <input
                type="text"
                value={formData.source}
                onChange={(e) => onChange('source', e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="Ex: Indicação, Site, Instagram"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Observações</label>
              <textarea
                value={formData.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all"
                rows={4}
                placeholder="Informações adicionais sobre o lead..."
              />
            </div>
          </form>
        </div>

        <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
          <div className="flex justify-end items-center gap-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              onClick={onSubmit}
              disabled={saving}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white border border-slate-700/70 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-slate-900 transition-colors disabled:opacity-60"
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
