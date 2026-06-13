import React from 'react';
import { Plus, Loader2 } from 'lucide-react';
import type { CreateLeadDTO } from '../types/lead.types';
import { useFormLayout } from '../hooks/useFormLayout';
import { Modal, ModalBody } from './ui';

interface LeadModalProps {
  isOpen: boolean;
  saving?: boolean;
  formData: CreateLeadDTO;
  sources?: string[];
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onChange: <K extends keyof CreateLeadDTO>(field: K, value: CreateLeadDTO[K]) => void;
}

const INPUT = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
const TEXTAREA = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition';
const LABEL = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

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

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Novo Lead"
      eyebrow="Leads"
      size="md"
      zIndex={70}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            onClick={onSubmit}
            disabled={saving}
            className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition focus:outline-none focus:ring-1 focus:ring-orange-400/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? 'Salvando...' : 'Criar Lead'}
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-3"
          style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
        >
          <div>
            <label className={LABEL}>
              {fl.fieldLabel('name', 'Nome')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onChange('name', e.target.value)}
              className={INPUT}
              placeholder="Digite o nome do lead"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
            {!fl.isHidden('email') && (
              <div>
                <label className={LABEL}>{fl.fieldLabel('email', 'E-mail')}</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => onChange('email', e.target.value)}
                  className={INPUT}
                  placeholder="email@exemplo.com"
                  required={fl.isRequired('email')}
                />
              </div>
            )}
            {!fl.isHidden('phone') && (
              <div>
                <label className={LABEL}>{fl.fieldLabel('phone', 'Telefone')}</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => onChange('phone', e.target.value)}
                  className={INPUT}
                  placeholder="(00) 00000-0000"
                  required={fl.isRequired('phone')}
                />
              </div>
            )}
          </div>

          {!fl.isHidden('source') && (
            <div>
              <label className={LABEL}>{fl.fieldLabel('source', 'Origem')}</label>
              <input
                type="text"
                list="lead-modal-sources"
                value={formData.source}
                onChange={(e) => onChange('source', e.target.value)}
                className={INPUT}
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
              <label className={LABEL}>{fl.fieldLabel('notes', 'Observações')}</label>
              <textarea
                value={formData.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                className={TEXTAREA}
                rows={3}
                placeholder="Informações adicionais sobre o lead..."
                required={fl.isRequired('notes')}
              />
            </div>
          )}
        </form>
      </ModalBody>
    </Modal>
  );
};

export default LeadModal;
