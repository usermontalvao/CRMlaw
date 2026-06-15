/**
 * RequirementFormModal — criar/editar Requerimento, fiel ao RequirementsModule
 * (mesmo Modal/ModalBody, field-layout, criptografia de senha INSS). Autocontido
 * para reuso no WhatsApp 360 sem mexer no módulo original.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Modal, ModalBody } from './ui';
import { useFormLayout } from '../hooks/useFormLayout';
import { useAuth } from '../contexts/AuthContext';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { profileService, type Profile } from '../services/profile.service';
import type { Requirement, RequirementStatus, BenefitType } from '../types/requirement.types';

const STATUS_OPTIONS: { key: RequirementStatus; label: string }[] = [
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção' },
  { key: 'em_analise', label: 'Em Análise' },
  { key: 'em_exigencia', label: 'Em Exigência' },
  { key: 'aguardando_pericia', label: 'Aguardando Perícia' },
  { key: 'deferido', label: 'Deferido' },
  { key: 'indeferido', label: 'Indeferido' },
  { key: 'ajuizado', label: 'Ajuizado' },
];

const BENEFIT_TYPES: { key: BenefitType; label: string }[] = [
  { key: 'bpc_loas', label: 'BPC LOAS - Deficiente' },
  { key: 'bpc_loas_deficiencia', label: 'BPC LOAS - Deficiência' },
  { key: 'bpc_loas_idoso', label: 'BPC LOAS - Idoso' },
  { key: 'aposentadoria_tempo', label: 'Aposentadoria por Tempo de Contribuição' },
  { key: 'aposentadoria_idade', label: 'Aposentadoria por Idade' },
  { key: 'aposentadoria_invalidez', label: 'Aposentadoria por Invalidez' },
  { key: 'auxilio_acidente', label: 'Auxílio Acidente' },
  { key: 'auxilio_doenca', label: 'Auxílio Doença' },
  { key: 'pensao_morte', label: 'Pensão por Morte' },
  { key: 'salario_maternidade', label: 'Salário Maternidade' },
  { key: 'outro', label: 'Outro' },
];

const emptyForm = {
  protocol: '',
  beneficiary: '',
  cpf: '',
  benefit_type: '' as BenefitType | '',
  status: 'aguardando_confeccao' as RequirementStatus,
  entry_date: '',
  exigency_due_date: '',
  phone: '',
  inss_password: '',
  observations: '',
  notes: '',
  client_id: '',
};

const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));
const toUtcMidnightIso = (dateOnly: string) => {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString();
};
const formatCPF = (raw: string) => {
  const d = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (d.length !== 11) return raw;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

interface RequirementFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialClientId?: string;
  initialClientName?: string;
  requirementId?: string;
}

export const RequirementFormModal: React.FC<RequirementFormModalProps> = ({
  open, onClose, onSaved, initialClientId, initialClientName, requirementId,
}) => {
  const { user } = useAuth();
  const fl = useFormLayout('requirements');
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });

  const inputClass = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const selectClass = 'w-full px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all cursor-pointer';
  const textareaClass = 'w-full px-4 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-[#e7e5df] dark:border-zinc-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all resize-none min-h-[80px]';
  const labelClass = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  useEffect(() => {
    profileService.getMyProfile().then(setMyProfile).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (requirementId) {
      setLoadingEdit(true);
      requirementService.getRequirementById(requirementId).then(r => {
        if (!r) return;
        setEditing(r);
        setFormData({
          protocol: r.protocol || '',
          beneficiary: r.beneficiary || '',
          cpf: r.cpf || '',
          benefit_type: r.benefit_type || '',
          status: r.status,
          entry_date: r.entry_date ? String(r.entry_date).slice(0, 10) : '',
          exigency_due_date: r.exigency_due_date ? String(r.exigency_due_date).slice(0, 10) : '',
          phone: r.phone || '',
          inss_password: '',
          observations: r.observations || '',
          notes: '',
          client_id: r.client_id || '',
        });
      }).finally(() => setLoadingEdit(false));
    } else {
      setEditing(null);
      const base = { ...emptyForm, client_id: initialClientId || '', beneficiary: initialClientName || '' };
      setFormData(base);
      // Prefill CPF/telefone do cliente vinculado
      if (initialClientId) {
        clientService.getClientById(initialClientId).then(c => {
          if (!c) return;
          setFormData(prev => ({
            ...prev,
            beneficiary: prev.beneficiary || c.full_name || '',
            cpf: c.cpf_cnpj ? formatCPF(c.cpf_cnpj) : prev.cpf,
            phone: prev.phone || c.phone || c.mobile || '',
          }));
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requirementId, initialClientId]);

  const handleFormChange = (field: keyof typeof formData, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const resolveAuthorInfo = useCallback(() => {
    const fallback = (user?.user_metadata?.name as string) || user?.email || 'Equipe do escritório';
    return { name: myProfile?.name || fallback, id: myProfile?.id || myProfile?.user_id || user?.id || null, avatar: myProfile?.avatar_url || undefined };
  }, [myProfile, user]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedProtocol = formData.protocol.trim();
    const requiresProtocol = formData.status !== 'aguardando_confeccao';
    if (requiresProtocol && !trimmedProtocol) { setError('Informe o protocolo do INSS.'); return; }
    if (!formData.beneficiary.trim()) { setError('Informe o nome do beneficiário.'); return; }
    if (!formData.cpf.trim()) { setError('Informe o CPF do beneficiário.'); return; }
    if (!formData.benefit_type) { setError('Selecione o tipo de benefício.'); return; }

    try {
      setSaving(true);
      setError(null);
      const rawPassword = formData.inss_password?.trim() || null;
      let inssPasswordEnc: string | null = null;
      let inssPasswordPlain: string | null = null;
      if (rawPassword) {
        inssPasswordEnc = await requirementService.encryptInssPassword(rawPassword);
        if (!inssPasswordEnc) inssPasswordPlain = rawPassword;
      }
      const payloadBase: Record<string, any> = {
        protocol: trimmedProtocol || null,
        beneficiary: formData.beneficiary.trim(),
        cpf: formData.cpf.trim(),
        benefit_type: formData.benefit_type as BenefitType,
        status: formData.status,
        entry_date: formData.entry_date ? toUtcMidnightIso(formData.entry_date) : null,
        exigency_due_date: formData.status === 'em_exigencia' && formData.exigency_due_date ? toUtcMidnightIso(formData.exigency_due_date) : null,
        phone: formData.phone?.trim() || null,
        ...(rawPassword !== null ? { inss_password: inssPasswordPlain, inss_password_enc: inssPasswordEnc } : {}),
        observations: formData.observations?.trim() || null,
        client_id: formData.client_id?.trim() || initialClientId || null,
      };
      const trimmedNote = formData.notes.trim();

      if (editing) {
        const updatePayload: Record<string, any> = { ...payloadBase };
        if (trimmedNote) {
          const a = resolveAuthorInfo();
          let existing: any[] = [];
          try { const p = JSON.parse(editing.notes || '[]'); if (Array.isArray(p)) existing = p; } catch { /* texto livre antigo */ }
          updatePayload.notes = JSON.stringify([...existing, { id: generateId(), text: trimmedNote, created_at: new Date().toISOString(), author: a.name, author_name: a.name, author_id: a.id, author_avatar: a.avatar }]);
        }
        await requirementService.updateRequirement(editing.id, updatePayload);
      } else {
        const createPayload: Record<string, any> = { ...payloadBase };
        if (trimmedNote) {
          const a = resolveAuthorInfo();
          createPayload.notes = JSON.stringify([{ id: generateId(), text: trimmedNote, created_at: new Date().toISOString(), author: a.name, author_name: a.name, author_id: a.id, author_avatar: a.avatar }]);
        }
        await requirementService.createRequirement(createPayload as any);
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o requerimento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={editing ? 'Editar Requerimento' : 'Novo Requerimento'}
      eyebrow={editing ? 'Editar' : 'Novo'}
      size="2xl"
      zIndex={70}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400 dark:text-zinc-500">* Campos obrigatórios</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={onClose} disabled={saving} className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition disabled:opacity-50">Cancelar</button>
            <button type="submit" form="wa-requirement-form" disabled={saving} className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        {loadingEdit ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…</div>
        ) : (
        <form id="wa-requirement-form" onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* Identificação */}
          <div className="grid grid-cols-12 gap-4">
            <label className="flex flex-col col-span-12 sm:col-span-3">
              <span className={labelClass}>Protocolo INSS *</span>
              <input value={formData.protocol} onChange={(e) => handleFormChange('protocol', e.target.value)} className={inputClass} placeholder="NB / Protocolo" required />
            </label>
            <label className="flex flex-col col-span-12 sm:col-span-6">
              <span className={labelClass}>Beneficiário *</span>
              <input value={formData.beneficiary} onChange={(e) => handleFormChange('beneficiary', e.target.value)} className={inputClass} placeholder="Nome do beneficiário" required />
            </label>
            <label className="flex flex-col col-span-12 sm:col-span-3">
              <span className={labelClass}>CPF *</span>
              <input value={formData.cpf} onChange={(e) => handleFormChange('cpf', e.target.value)} className={inputClass} placeholder="000.000.000-00" maxLength={14} required />
            </label>
          </div>

          {/* Benefício e Status */}
          <div className="grid grid-cols-12 gap-4">
            {!fl.isHidden('benefit_type') && (
              <label className="flex flex-col col-span-12 sm:col-span-5">
                <span className={labelClass}>{fl.fieldLabel('benefit_type', 'Tipo de Benefício')}</span>
                <select value={formData.benefit_type} onChange={(e) => handleFormChange('benefit_type', e.target.value)} className={selectClass} required={fl.isRequired('benefit_type')}>
                  <option value="" disabled>Selecione...</option>
                  {BENEFIT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </label>
            )}
            {!fl.isHidden('status') && (
              <label className="flex flex-col col-span-12 sm:col-span-4">
                <span className={labelClass}>{fl.fieldLabel('status', 'Status')}</span>
                <select value={formData.status} onChange={(e) => handleFormChange('status', e.target.value)} className={selectClass} required={fl.isRequired('status')}>
                  {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col col-span-12 sm:col-span-3">
              <span className={labelClass}>Data de Entrada</span>
              <input type="date" value={formData.entry_date} onChange={(e) => handleFormChange('entry_date', e.target.value)} className={inputClass} />
            </label>
            {formData.status === 'em_exigencia' && (
              <label className="flex flex-col col-span-12 sm:col-span-3">
                <span className={labelClass}>Prazo da Exigência</span>
                <input type="date" value={formData.exigency_due_date} onChange={(e) => handleFormChange('exigency_due_date', e.target.value)} className={inputClass} min={new Date().toISOString().split('T')[0]} />
              </label>
            )}
          </div>

          {/* Contato e Acesso */}
          <div className="grid grid-cols-12 gap-4">
            <label className="flex flex-col col-span-12 sm:col-span-6">
              <span className={labelClass}>Telefone</span>
              <input value={formData.phone} onChange={(e) => handleFormChange('phone', e.target.value)} className={inputClass} placeholder="(00) 00000-0000" maxLength={15} />
            </label>
            <label className="flex flex-col col-span-12 sm:col-span-6">
              <span className={labelClass}>Senha do INSS</span>
              <input type="text" value={formData.inss_password} onChange={(e) => handleFormChange('inss_password', e.target.value)} className={inputClass}
                placeholder={(editing as any)?.inss_password_enc ? 'Senha já configurada — deixe vazio para manter' : 'Senha de acesso'} />
            </label>
          </div>

          {/* Notas */}
          {!fl.isHidden('notes') && (
            <div className="grid grid-cols-12 gap-4">
              <label className="flex flex-col col-span-12 sm:col-span-6">
                <span className={labelClass}>{fl.fieldLabel('notes', 'Observações')}</span>
                <textarea value={formData.observations} onChange={(e) => handleFormChange('observations', e.target.value)} className={textareaClass} placeholder="Observações sobre o requerimento..." required={fl.isRequired('notes')} />
              </label>
              <label className="flex flex-col col-span-12 sm:col-span-6">
                <span className={labelClass}>Notas Internas</span>
                <textarea value={formData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} className={textareaClass} placeholder="Notas internas do escritório..." />
              </label>
            </div>
          )}
        </form>
        )}
      </ModalBody>
    </Modal>
  );
};

export default RequirementFormModal;
