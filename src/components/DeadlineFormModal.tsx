import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Calendar, Check, Clock, Layers, Loader2 } from 'lucide-react';
import { Modal, ModalBody } from './ui';
import { ClientSearchSelect } from './ClientSearchSelect';
import { deadlineService } from '../services/deadline.service';
import { userNotificationService } from '../services/userNotification.service';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Deadline, DeadlinePriority, DeadlineStatus, DeadlineType } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Profile } from '../services/profile.service';
import type { Client } from '../types/client.types';
import { useFormLayout } from '../hooks/useFormLayout';

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoPrazo = 'processual' | 'material';

type DeadlineFormData = {
  title: string;
  description: string;
  due_date: string;
  status: DeadlineStatus;
  priority: DeadlinePriority;
  type: DeadlineType;
  process_id: string;
  requirement_id: string;
  client_id: string;
  responsible_id: string;
  notify_days_before: string;
};

export interface DeadlineFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Pass to edit an existing deadline */
  selectedDeadline?: Deadline | null;
  /** Pre-fill fields (e.g. when opening from IntimationsModule) */
  initialData?: Partial<DeadlineFormData>;
  /** 'intimation' shows a banner with context info at the top of the form */
  source?: 'manual' | 'intimation';
  intimationId?: string;
  intimationContext?: {
    process_number?: string;
    client_name?: string;
    type?: string;
    /** If set, shows a warning with the final deadline date from AI analysis */
    analysis_due_date?: string;
  };
  members: Profile[];
  processes: Process[];
  clients: Client[];
  requirements?: Requirement[];
  /** Active status options from settings; if omitted falls back to hardcoded defaults */
  statusOptions?: { key: DeadlineStatus; label: string }[];
  /** Active priority options from settings; if omitted falls back to hardcoded defaults */
  priorityOptions?: { key: DeadlinePriority; label: string }[];
  /** Active type options from settings; if omitted falls back to hardcoded defaults */
  typeOptions?: { key: DeadlineType; label: string }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { key: DeadlineStatus; label: string }[] = [
  { key: 'pendente', label: 'Pendente' },
  { key: 'cumprido', label: 'Cumprido' },
  { key: 'vencido', label: 'Vencido' },
  { key: 'cancelado', label: 'Cancelado' },
];

const PRIORITY_OPTIONS: { key: DeadlinePriority; label: string }[] = [
  { key: 'urgente', label: 'Urgente' },
  { key: 'alta', label: 'Alta' },
  { key: 'media', label: 'Média' },
  { key: 'baixa', label: 'Baixa' },
];

const TYPE_OPTIONS: { key: DeadlineType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'processo', label: 'Processo', icon: Layers },
  { key: 'requerimento', label: 'Requerimento', icon: Briefcase },
  { key: 'geral', label: 'Geral', icon: Calendar },
];

const emptyForm: DeadlineFormData = {
  title: '',
  description: '',
  due_date: '',
  status: 'pendente',
  priority: 'media',
  type: 'processo',
  process_id: '',
  requirement_id: '',
  client_id: '',
  responsible_id: '',
  notify_days_before: '2',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcularDataVencimento(dataPublicacao: string, diasPrazo: number, tipo: TipoPrazo): string {
  const data = new Date(dataPublicacao + 'T12:00:00');
  data.setDate(data.getDate() + 1);
  let diasContados = 0;
  while (diasContados < diasPrazo) {
    const diaSemana = data.getDay();
    const isFinalSemana = diaSemana === 0 || diaSemana === 6;
    if (tipo === 'processual') { if (!isFinalSemana) diasContados++; }
    else diasContados++;
    if (diasContados < diasPrazo) data.setDate(data.getDate() + 1);
  }
  if (tipo === 'processual') {
    while (data.getDay() === 0 || data.getDay() === 6) data.setDate(data.getDate() + 1);
  }
  return data.toISOString().split('T')[0];
}

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  if (value.includes('T')) return value.split('T')[0];
  return value;
}

function getMemberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getMemberHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = (h << 5) - h + name.charCodeAt(i); h |= 0; }
  return Math.abs(h) % 360;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const DeadlineFormModal: React.FC<DeadlineFormModalProps> = ({
  open,
  onClose,
  onSaved,
  selectedDeadline,
  initialData,
  source,
  intimationId,
  intimationContext,
  members,
  processes,
  requirements = [],
  statusOptions: statusOptionsProp,
  priorityOptions: priorityOptionsProp,
  typeOptions: typeOptionsProp,
}) => {
  const { user } = useAuth();

  const [formData, setFormData] = useState<DeadlineFormData>(emptyForm);
  const [dataPublicacao, setDataPublicacao] = useState('');
  const [diasPrazo, setDiasPrazo] = useState('');
  const [tipoPrazoCalculadora, setTipoPrazoCalculadora] = useState<TipoPrazo>('processual');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fl = useFormLayout('deadlines');

  // Member lookup: profile.id → user_id (for notifications)
  const memberMap = useMemo(() => {
    const m = new Map<string, Profile>();
    members.forEach(p => m.set(p.id, p));
    return m;
  }, [members]);

  // Reset / populate form when modal opens
  useEffect(() => {
    if (!open) return;
    setError(null);

    const activeStatuses  = statusOptionsProp   ?? STATUS_OPTIONS;
    const activePriorities = priorityOptionsProp ?? PRIORITY_OPTIONS;
    const activeTypes      = typeOptionsProp     ?? TYPE_OPTIONS;
    const clampStatus   = (v: string) => activeStatuses.some(s => s.key === v)   ? v as DeadlineStatus   : (activeStatuses[0]?.key   ?? 'pendente') as DeadlineStatus;
    const clampPriority = (v: string) => activePriorities.some(p => p.key === v) ? v as DeadlinePriority : (activePriorities[0]?.key ?? 'media')    as DeadlinePriority;
    const clampType     = (v: string) => activeTypes.some(t => t.key === v)      ? v as DeadlineType     : (activeTypes[0]?.key      ?? 'processo')  as DeadlineType;

    if (selectedDeadline) {
      setFormData({
        title: selectedDeadline.title || '',
        description: selectedDeadline.description || '',
        due_date: toDateInputValue(selectedDeadline.due_date),
        status:   clampStatus(selectedDeadline.status   || 'pendente'),
        priority: clampPriority(selectedDeadline.priority || 'media'),
        type:     clampType(selectedDeadline.type       || 'processo'),
        process_id: selectedDeadline.process_id || '',
        requirement_id: selectedDeadline.requirement_id || '',
        client_id: selectedDeadline.client_id || '',
        responsible_id: selectedDeadline.responsible_id || '',
        notify_days_before: selectedDeadline.notify_days_before != null ? String(selectedDeadline.notify_days_before) : '2',
      });
      setDataPublicacao(selectedDeadline.publication_date ? toDateInputValue(selectedDeadline.publication_date) : '');
      setDiasPrazo(selectedDeadline.deadline_days != null ? String(selectedDeadline.deadline_days) : '');
      setTipoPrazoCalculadora((selectedDeadline.counting_type as TipoPrazo) || 'processual');
    } else {
      const base = { ...emptyForm, ...initialData };
      setFormData({
        ...base,
        status:   clampStatus(base.status),
        priority: clampPriority(base.priority),
        type:     clampType(base.type),
      });
      setDataPublicacao('');
      setDiasPrazo('');
      setTipoPrazoCalculadora('processual');
    }
  }, [open, selectedDeadline, initialData, statusOptionsProp, priorityOptionsProp, typeOptionsProp]);

  const handleChange = (field: keyof DeadlineFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Filtered processes/requirements by client
  const filteredProcesses = useMemo(() => {
    return formData.client_id ? processes.filter(p => p.client_id === formData.client_id) : processes;
  }, [processes, formData.client_id]);

  const filteredRequirements = useMemo(() => {
    return formData.client_id ? requirements.filter(r => r.client_id === formData.client_id) : requirements;
  }, [requirements, formData.client_id]);

  const handleSubmit = async () => {
    if (!formData.title.trim()) { setError('Informe o título do prazo.'); return; }
    if (!formData.due_date) { setError('Informe a data de vencimento.'); return; }
    if (!formData.responsible_id) { setError('Selecione o responsÃ¡vel pelo prazo.'); return; }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: formData.title.trim(),
        description: formData.description?.trim() || null,
        due_date: new Date(formData.due_date).toISOString(),
        status: formData.status,
        priority: formData.priority,
        type: formData.type,
        process_id: formData.process_id || null,
        requirement_id: formData.requirement_id || null,
        client_id: formData.client_id || null,
        responsible_id: formData.responsible_id,
        notify_days_before: formData.notify_days_before ? parseInt(formData.notify_days_before, 10) : 2,
        publication_date: dataPublicacao || null,
        deadline_days: diasPrazo ? parseInt(diasPrazo, 10) : null,
        counting_type: tipoPrazoCalculadora || null,
        // Vínculo intimação → prazo (guardião de prazos). Só na criação: em
        // edição, preserva o vínculo existente no banco.
        ...(!selectedDeadline && intimationId ? { intimation_id: intimationId, origin: 'intimation' } : {}),
      };

      if (selectedDeadline) {
        const responsibleChanged = payload.responsible_id && payload.responsible_id !== selectedDeadline.responsible_id;
        await deadlineService.updateDeadline(selectedDeadline.id, payload);
        if (responsibleChanged && user?.id) {
          const newRespProfile = memberMap.get(payload.responsible_id!);
          const newRespAuthId = newRespProfile?.user_id;
          if (newRespAuthId && newRespAuthId !== user.id) {
            const assignerName = memberMap.get(members.find(m => m.user_id === user.id)?.id || '')?.name || 'Alguém';
            const daysUntilDue = Math.ceil((new Date(payload.due_date).getTime() - Date.now()) / 86400000);
            const isUrgent = daysUntilDue <= 3 || payload.priority === 'urgente' || payload.priority === 'alta';
            const typeLabel = TYPE_OPTIONS.find(t => t.key === payload.type)?.label || 'Prazo';
            const prioLabel = PRIORITY_OPTIONS.find(p => p.key === payload.priority)?.label || '';
            const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;
            try {
              await userNotificationService.createNotification({
                title: isUrgent ? `⚠️ Prazo ${typeLabel} — ${prioLabel}` : `📅 Prazo ${typeLabel} Atribuído`,
                message: `${assignerName} atribuiu um prazo a você\n"${payload.title}" • ${daysLabel}`,
                type: 'deadline_assigned',
                user_id: newRespAuthId,
                deadline_id: selectedDeadline.id,
                metadata: { priority: payload.priority, type: payload.type, days_until_due: daysUntilDue },
              });
            } catch { /* non-fatal */ }
            supabase.functions.invoke('notify-deadline-assigned', {
              body: { deadline_id: selectedDeadline.id, assigned_by_id: user.id },
            }).catch(() => {});
          }
        }
      } else {
        const newDeadline = await deadlineService.createDeadline(payload as any);
        if (user?.id && newDeadline && payload.responsible_id) {
          const respProfile = memberMap.get(payload.responsible_id);
          const respAuthId = respProfile?.user_id;
          if (respAuthId && respAuthId !== user.id) {
            const assignerName = memberMap.get(members.find(m => m.user_id === user.id)?.id || '')?.name || 'Alguém';
            const daysUntilDue = Math.ceil((new Date(payload.due_date).getTime() - Date.now()) / 86400000);
            const isUrgent = daysUntilDue <= 3 || payload.priority === 'urgente' || payload.priority === 'alta';
            const typeLabel = TYPE_OPTIONS.find(t => t.key === payload.type)?.label || 'Prazo';
            const prioLabel = PRIORITY_OPTIONS.find(p => p.key === payload.priority)?.label || '';
            const daysLabel = daysUntilDue <= 0 ? 'Vencido!' : daysUntilDue === 1 ? 'Vence amanhã' : `Vence em ${daysUntilDue} dia(s)`;
            try {
              await userNotificationService.createNotification({
                title: isUrgent ? `⚠️ Prazo ${typeLabel} — ${prioLabel}` : `📅 Prazo ${typeLabel} Atribuído`,
                message: `${assignerName} atribuiu um prazo a você\n"${payload.title}" • ${daysLabel}`,
                type: 'deadline_assigned',
                user_id: respAuthId,
                deadline_id: newDeadline.id,
                metadata: { priority: payload.priority, type: payload.type, days_until_due: daysUntilDue },
              });
            } catch { /* non-fatal */ }
            supabase.functions.invoke('notify-deadline-assigned', {
              body: { deadline_id: newDeadline.id, assigned_by_id: user.id },
            }).catch(() => {});
          }
        }
      }

      onSaved();
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o prazo.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const inputStyle = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const textareaStyle = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[96px] px-3 py-2 text-[13px] leading-5 placeholder:text-slate-400 transition resize-none';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={selectedDeadline ? 'Editar Prazo' : 'Novo Prazo'}
      subtitle={`Preencha os dados abaixo para ${selectedDeadline ? 'atualizar o' : 'cadastrar um novo'} prazo`}
      icon={<Clock className="w-5 h-5" />}
      size="2xl"
      zIndex={80}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400"><span className="text-red-400">*</span> campos obrigatórios</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={handleClose} disabled={saving} className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {selectedDeadline ? 'Salvar Alterações' : 'Criar Prazo'}
            </button>
          </div>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <div className="flex flex-col gap-5">


        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}

        {/* Identificação */}
        <section>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Identificação</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="col-span-12 lg:col-span-5">
              <label className={labelStyle}>{fl.fieldLabel('title', 'Título do Prazo')} <span className="text-red-400">*</span></label>
              <input
                value={formData.title}
                onChange={e => handleChange('title', e.target.value)}
                className={inputStyle}
                placeholder="Ex: Contestação Processo 00123..."
                required
              />
            </div>
            {!fl.isHidden('type') && (
            <div className="col-span-1 lg:col-span-2">
              <label className={labelStyle}>{fl.fieldLabel('type', 'Tipo')}</label>
              <select
                value={formData.type}
                onChange={e => {
                  const t = e.target.value as DeadlineType;
                  handleChange('type', t);
                  if (t !== 'processo') handleChange('process_id', '');
                  if (t !== 'requerimento') handleChange('requirement_id', '');
                }}
                className={inputStyle}
              >
                {(typeOptionsProp ?? TYPE_OPTIONS).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            )}
            <div className="col-span-12 lg:col-span-5">
              <ClientSearchSelect
                value={formData.client_id}
                onChange={clientId => {
                  handleChange('client_id', clientId);
                  if (!clientId) handleChange('process_id', '');
                }}
                label="Cliente"
                placeholder="Buscar cliente..."
                required
                allowCreate={true}
              />
            </div>
          </div>
        </section>

        {/* Calculadora de Prazo */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Calculadora de Prazo</p>
            <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md border border-orange-100">DJEN</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelStyle}>Contagem</label>
              <select
                value={tipoPrazoCalculadora}
                onChange={e => {
                  const v = e.target.value as TipoPrazo;
                  setTipoPrazoCalculadora(v);
                  if (dataPublicacao && diasPrazo) {
                    const dias = Number(diasPrazo);
                    if (!Number.isNaN(dias) && dias > 0) handleChange('due_date', calcularDataVencimento(dataPublicacao, dias, v));
                  }
                }}
                className={inputStyle}
              >
                <option value="processual">Dias úteis</option>
                <option value="material">Dias corridos</option>
              </select>
            </div>
            {!fl.isHidden('pub_date') && (
            <div>
              <label className={labelStyle}>{fl.fieldLabel('pub_date', 'Data publicação')}</label>
              <input
                type="date" value={dataPublicacao}
                onChange={e => {
                  setDataPublicacao(e.target.value);
                  if (e.target.value && diasPrazo) handleChange('due_date', calcularDataVencimento(e.target.value, parseInt(diasPrazo), tipoPrazoCalculadora));
                }}
                className={inputStyle}
              />
            </div>
            )}
            {!fl.isHidden('days') && (
            <div>
              <label className={labelStyle}>{fl.fieldLabel('days', 'Nº de dias')}</label>
              <div className="flex flex-wrap items-center gap-1">
                <input
                  type="number" min={1} value={diasPrazo} placeholder="0"
                  onChange={e => {
                    setDiasPrazo(e.target.value);
                    const dias = Number(e.target.value);
                    if (dataPublicacao && !Number.isNaN(dias) && dias > 0) handleChange('due_date', calcularDataVencimento(dataPublicacao, dias, tipoPrazoCalculadora));
                  }}
                  className="w-14 h-[34px] px-2 rounded text-[13px] text-center bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 transition"
                />
                {[5, 10, 15].map(d => (
                  <button key={d} type="button"
                    onClick={() => { setDiasPrazo(String(d)); if (dataPublicacao) handleChange('due_date', calcularDataVencimento(dataPublicacao, d, tipoPrazoCalculadora)); }}
                    className={`h-[34px] px-2.5 text-[13px] rounded font-semibold transition ${diasPrazo === String(d) ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >{d}</button>
                ))}
              </div>
            </div>
            )}
            <div>
              <label className={labelStyle}>Vencimento <span className="text-red-400">*</span></label>
              <input
                type="date" value={formData.due_date} required
                onChange={e => {
                  const d = new Date(e.target.value + 'T12:00:00');
                  if (d.getDay() === 0 || d.getDay() === 6) { alert('⚠️ Não é permitido cadastrar prazos em finais de semana.'); return; }
                  setDataPublicacao(''); setDiasPrazo('');
                  handleChange('due_date', e.target.value);
                }}
                className={inputStyle}
              />
            </div>
          </div>
          {source === 'intimation' && intimationContext?.analysis_due_date && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-900 font-semibold">
                ⚠️ Prazo Final: {new Date(intimationContext.analysis_due_date).toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">✓ Data pré-preenchida com 1 dia de margem</p>
            </div>
          )}
        </section>

        {/* Configurações */}
        <section>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Configurações</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {!fl.isHidden('priority') && (
            <div>
              <label className={labelStyle}>{fl.fieldLabel('priority', 'Prioridade')}</label>
              <select value={formData.priority} onChange={e => handleChange('priority', e.target.value as DeadlinePriority)} className={inputStyle} required={fl.isRequired('priority')}>
                {(priorityOptionsProp ?? PRIORITY_OPTIONS).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            )}
            <div>
              <label className={labelStyle}>Status</label>
              <select value={formData.status} onChange={e => handleChange('status', e.target.value as DeadlineStatus)} className={inputStyle}>
                {(statusOptionsProp ?? STATUS_OPTIONS).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            {!fl.isHidden('process') && (
            <div>
              <label className={labelStyle}>{fl.fieldLabel('process', formData.type === 'requerimento' ? 'Requerimento' : 'Processo')}</label>
              {formData.type === 'processo' ? (
                <select value={formData.process_id} onChange={e => handleChange('process_id', e.target.value)} disabled={!formData.client_id} className={`${inputStyle} disabled:opacity-40 disabled:bg-slate-50`} required={fl.isRequired('process')}>
                  <option value="">{formData.client_id ? 'Selecione...' : 'Escolha o cliente primeiro'}</option>
                  {filteredProcesses.map(p => <option key={p.id} value={p.id}>{p.process_code}</option>)}
                </select>
              ) : formData.type === 'requerimento' ? (
                <select value={formData.requirement_id} onChange={e => handleChange('requirement_id', e.target.value)} disabled={!formData.client_id} className={`${inputStyle} disabled:opacity-40 disabled:bg-slate-50`}>
                  <option value="">{formData.client_id ? 'Selecione...' : 'Escolha o cliente primeiro'}</option>
                  {filteredRequirements.map(r => <option key={r.id} value={r.id}>{r.protocol}{r.beneficiary ? ` — ${r.beneficiary}` : ''}</option>)}
                </select>
              ) : (
                <select disabled className={`${inputStyle} opacity-40 bg-slate-50`}><option>—</option></select>
              )}
            </div>
            )}
            <div>
              <label className={labelStyle}>Notificar (dias antes)</label>
              <input type="number" min={0} max={30} value={formData.notify_days_before} onChange={e => handleChange('notify_days_before', e.target.value)} className={inputStyle} placeholder="2" />
            </div>
          </div>
        </section>

        {/* Observações + Responsável lado a lado */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
          {!fl.isHidden('notes') && (
          <div>
            <label className={labelStyle}>{fl.fieldLabel('notes', 'Observações')}</label>
            <textarea
              value={formData.description}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Detalhes adicionais sobre o prazo..."
              rows={4}
              className={textareaStyle}
              required={fl.isRequired('notes')}
            />
          </div>
          )}
          {!fl.isHidden('responsible') && (
          <div>
            <div className="flex items-baseline gap-2 mb-2">
              <label className={labelStyle}>Responsável <span className="text-red-400">*</span></label>
              {formData.responsible_id
                ? <span className="text-xs text-orange-600 font-semibold truncate">{members.find(m => m.id === formData.responsible_id)?.name || ''}</span>
                : <span className="text-xs text-slate-400">Selecione um advogado</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {[...members].filter(m => (m as any).is_active !== false).sort((a, b) => {
                const rank = (m: Profile) => {
                  const r = (m.role || '').toLowerCase();
                  if (r.includes('admin')) return 0;
                  if (r.includes('advogad')) return 1;
                  return 2;
                };
                return rank(a) - rank(b);
              }).map(member => {
                const isSelected = formData.responsible_id === member.id;
                const hue = getMemberHue(member.name || '');
                const initials = getMemberInitials(member.name || '');
                return (
                  <button
                    key={member.id}
                    type="button"
                    title={member.name}
                    onClick={() => handleChange('responsible_id', member.id)}
                    className="relative group transition-transform hover:z-10 hover:scale-110"
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all ${isSelected ? 'ring-2 ring-offset-2 ring-orange-500 scale-110' : 'ring-1 ring-white'}`}
                      style={{ background: `hsl(${hue},55%,52%)`, color: '#fff' }}
                    >
                      {member.avatar_url
                        ? <img src={member.avatar_url} alt={member.name || ''} className="w-full h-full object-cover rounded-full" />
                        : initials}
                    </div>
                    {isSelected && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full flex items-center justify-center">
                        <Check className="w-2 h-2 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
              {members.length === 0 && (
                <p className="text-xs text-slate-400 py-2">Nenhum membro disponível.</p>
              )}
            </div>
          </div>
          )}
        </div>

        </div>
      </ModalBody>
    </Modal>
  );
};
