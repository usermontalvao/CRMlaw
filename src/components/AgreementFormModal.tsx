/**
 * AgreementFormModal — modal "Novo Lançamento" do Financeiro, extraído do
 * FinancialModule para ser reutilizado tanto lá quanto no WhatsApp 360.
 *
 * Mantém comportamento idêntico ao original: cria o acordo/lançamento e agenda
 * os compromissos de recebimento das parcelas (exige responsável da agenda).
 * Quando `lockClient` é true, o cliente vem pré-vinculado (uso a partir da conversa).
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, ChevronDown, CheckCircle, PlusCircle } from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { settingsService, FINANCIAL_MODULE_DEFAULTS, type FinancialModuleConfig } from '../services/settings.service';
import { financialService } from '../services/financial.service';
import { clientService } from '../services/client.service';
import { calendarService } from '../services/calendar.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { profileService, type Profile } from '../services/profile.service';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Agreement } from '../types/financial.types';
import type { Client } from '../types/client.types';
import { ClientSearchSelect } from './ClientSearchSelect';
import { Modal, ModalBody } from './ui';
import { formatCurrency } from '../utils/formatters';

interface AgreementFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Cliente pré-vinculado (ex.: a partir de uma conversa do WhatsApp). */
  initialClientId?: string;
  initialClientName?: string;
  initialProcessId?: string;
  /** Quando true, trava o cliente (não mostra o seletor). */
  lockClient?: boolean;
}

const practiceLabelMap: Record<string, string> = {
  trabalhista: 'Trabalhista',
  familia: 'Família',
  consumidor: 'Consumidor',
  previdenciario: 'Previdenciário',
  civel: 'Cível',
};
const benefitLabelMap: Record<string, string> = {
  bpc_loas: 'BPC/LOAS',
  bpc_loas_deficiencia: 'BPC – Deficiência',
  bpc_loas_idoso: 'BPC – Idoso',
  aposentadoria_tempo: 'Aposen. Tempo',
  aposentadoria_idade: 'Aposen. Idade',
  aposentadoria_invalidez: 'Aposen. Invalidez',
  auxilio_acidente: 'Auxílio Acidente',
  auxilio_doenca: 'Auxílio Doença',
  pensao_morte: 'Pensão por Morte',
  salario_maternidade: 'Sal. Maternidade',
  outro: 'Outro',
};

const formatLocalISODate = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseCurrencyToNumber = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const cleaned = trimmed.replace(/\s+/g, '');
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized = cleaned;
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    if (decimalSeparator === '.') normalized = cleaned.replace(/,/g, '');
    else normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma !== -1) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals === 1 || decimals === 2) normalized = cleaned;
    else normalized = cleaned.replace(/\./g, '');
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrencyInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const number = Number(digits) / 100;
  return number.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const AgreementFormModal: React.FC<AgreementFormModalProps> = ({
  open,
  onClose,
  onSaved,
  initialClientId,
  initialClientName,
  initialProcessId,
  lockClient,
}) => {
  const toast = useToastContext();

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const [members, setMembers] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [financialDefaults, setFinancialDefaults] = useState<FinancialModuleConfig>(FINANCIAL_MODULE_DEFAULTS);
  const [calendarResponsibleId, setCalendarResponsibleId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [clientProcesses, setClientProcesses] = useState<Process[]>([]);
  const [clientRequirements, setClientRequirements] = useState<Requirement[]>([]);
  const [loadingLinkedEntities, setLoadingLinkedEntities] = useState(false);

  const [formData, setFormData] = useState({
    clientId: '',
    processId: '',
    title: '',
    description: '',
    agreementDate: today,
    totalValue: '',
    feeType: 'percentage' as 'percentage' | 'fixed',
    feePercentage: String(FINANCIAL_MODULE_DEFAULTS.default_fee_percentage),
    feeFixedValue: '',
    paymentType: FINANCIAL_MODULE_DEFAULTS.default_payment_type as 'installments' | 'upfront',
    installmentsCount: String(FINANCIAL_MODULE_DEFAULTS.default_installments_count),
    firstDueDate: today,
    notes: '',
    customInstallments: [] as { dueDate: string; value: string }[],
  });

  // Carrega membros, clientes e defaults uma vez.
  useEffect(() => {
    profileService.listMembers().then(setMembers).catch(() => {});
    clientService.listClients().then(setClients).catch(() => {});
    settingsService.getFinancialModuleConfig().then(cfg => setFinancialDefaults(cfg)).catch(() => {});
  }, []);

  const loadLinkedEntities = useCallback(async (clientId: string) => {
    if (!clientId) { setClientProcesses([]); setClientRequirements([]); return; }
    setLoadingLinkedEntities(true);
    try {
      const [procs, reqs] = await Promise.all([
        processService.listProcesses({ client_id: clientId }),
        requirementService.listRequirements({ client_id: clientId }),
      ]);
      setClientProcesses(procs);
      setClientRequirements(reqs);
    } catch {
      setClientProcesses([]);
      setClientRequirements([]);
    } finally {
      setLoadingLinkedEntities(false);
    }
  }, []);

  // Ao abrir, reinicia o formulário (com cliente pré-vinculado quando houver).
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setFormLoading(false);
    setCalendarResponsibleId('');
    setFormData({
      clientId: initialClientId || '',
      processId: initialProcessId || '',
      title: '',
      description: '',
      agreementDate: today,
      totalValue: '',
      feeType: 'percentage',
      feePercentage: String(financialDefaults.default_fee_percentage),
      feeFixedValue: '',
      paymentType: financialDefaults.default_payment_type,
      installmentsCount: String(financialDefaults.default_installments_count),
      firstDueDate: today,
      notes: '',
      customInstallments: [],
    });
    if (initialClientId) loadLinkedEntities(initialClientId);
    else { setClientProcesses([]); setClientRequirements([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClientId, initialProcessId]);

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.full_name || (client as any)?.name || initialClientName || 'Cliente';
  };

  const CURRENCY_FIELDS = useMemo(() => new Set(['totalValue', 'feeFixedValue']), []);

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => {
      if (field === 'clientId') {
        loadLinkedEntities(value);
        return { ...prev, clientId: value, processId: '' };
      }
      if (field === 'paymentType') {
        return {
          ...prev,
          paymentType: value as 'installments' | 'upfront',
          installmentsCount: value === 'upfront' ? '1' : prev.installmentsCount || '12',
          customInstallments: value === 'upfront' ? [] : prev.customInstallments,
        };
      }
      if (field === 'feeType') {
        return {
          ...prev,
          feeType: value as 'percentage' | 'fixed',
          feePercentage: value === 'percentage' ? (prev.feePercentage || '40') : '',
          feeFixedValue: value === 'fixed' ? (prev.feeFixedValue || '') : '',
        };
      }
      if (CURRENCY_FIELDS.has(field as string)) {
        return { ...prev, [field]: formatCurrencyInput(value) };
      }
      return { ...prev, [field]: value };
    });
  };

  const validateForm = () => {
    if (!formData.clientId) return 'Selecione um cliente';
    if (!formData.title.trim()) return 'Informe o título do acordo';
    if (!calendarResponsibleId) return 'Selecione o responsável pelos compromissos da agenda';
    if (!formData.totalValue || parseCurrencyToNumber(formData.totalValue) <= 0) return 'Informe um valor total válido';
    if (formData.feeType === 'percentage') {
      if (!formData.feePercentage || Number(formData.feePercentage) <= 0) return 'Informe o percentual de honorários';
    } else {
      if (!formData.feeFixedValue || parseCurrencyToNumber(formData.feeFixedValue) <= 0) return 'Informe o valor fixo de honorários';
    }
    if (formData.paymentType === 'upfront' && !formData.firstDueDate) return 'Informe a data do pagamento';
    if (formData.paymentType === 'installments' && !formData.firstDueDate && !formData.customInstallments.length) return 'Informe a data da primeira parcela';
    if (formData.paymentType === 'installments') {
      if (!formData.installmentsCount || Number(formData.installmentsCount) < 2) return 'Informe a quantidade de parcelas (mínimo 2)';
      if (formData.customInstallments.length) {
        if (formData.customInstallments.length !== Number(formData.installmentsCount)) return 'Número de parcelas personalizadas diferente da quantidade informada';
        const invalid = formData.customInstallments.find((item) => !item.dueDate || !item.value || parseCurrencyToNumber(item.value) <= 0);
        if (invalid) return 'Preencha todas as datas e valores das parcelas personalizadas';
      }
    }
    return null;
  };

  const buildScheduleFromForm = () => {
    if (!formData.firstDueDate) return [] as { number: number; dueDate: string; value: number }[];
    if (formData.paymentType === 'upfront') {
      return [{ number: 1, dueDate: formData.firstDueDate, value: parseCurrencyToNumber(formData.totalValue) }];
    }
    if (formData.customInstallments.length) {
      return formData.customInstallments.map((item, index) => ({
        number: index + 1,
        dueDate: item.dueDate || formData.firstDueDate,
        value: parseCurrencyToNumber(item.value),
      }));
    }
    const schedule: { number: number; dueDate: string; value: number }[] = [];
    const total = parseCurrencyToNumber(formData.totalValue);
    const count = Number(formData.installmentsCount || '0') || 1;
    const baseDate = new Date(formData.firstDueDate);
    const installmentValue = count > 0 ? total / count : total;
    for (let i = 0; i < count; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      schedule.push({ number: i + 1, dueDate: formatLocalISODate(dueDate), value: Number(installmentValue.toFixed(2)) });
    }
    return schedule;
  };

  const createCalendarEventsForInstallments = async (
    agreement: Agreement,
    schedule: { number: number; dueDate: string; value: number }[],
    responsibleUserId?: string | null,
  ) => {
    if (!schedule.length) return;
    const clientName = getClientName(agreement.client_id);
    try {
      await Promise.all(
        schedule.map((item) =>
          calendarService.createEvent({
            title: `Recebimento ${clientName} - Parcela ${item.number}`,
            description: `Acordo: ${agreement.title}\nParcela ${item.number}/${schedule.length}\nValor: ${formatCurrency(isNaN(item.value) ? 0 : item.value)}\n[agreement_id:${agreement.id}] [installment:${item.number}]`,
            event_type: 'payment',
            start_at: `${item.dueDate}T00:00:00`,
            notify_minutes_before: 60,
            client_id: agreement.client_id,
            process_id: agreement.process_id ?? undefined,
            user_id: responsibleUserId || null,
          } as any),
        ),
      );
    } catch {
      toast.error('Calendário', 'Não foi possível agendar os recebimentos');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateForm();
    if (error) { setFormError(error); return; }
    try {
      setFormLoading(true);
      setFormError(null);
      const isReqCreate = formData.processId ? clientRequirements.some(r => r.id === formData.processId) : false;
      const createdAgreement = await financialService.createAgreement({
        client_id: formData.clientId,
        process_id: !isReqCreate && formData.processId ? formData.processId : undefined,
        requirement_id: isReqCreate && formData.processId ? formData.processId : undefined,
        title: formData.title.trim(),
        description: formData.description?.trim() || undefined,
        agreement_date: formData.agreementDate,
        total_value: parseCurrencyToNumber(formData.totalValue),
        fee_type: formData.feeType,
        fee_percentage: formData.feeType === 'percentage' ? Number(formData.feePercentage) : undefined,
        fee_fixed_value: formData.feeType === 'fixed' ? parseCurrencyToNumber(formData.feeFixedValue) : undefined,
        payment_type: formData.paymentType,
        installments_count: formData.paymentType === 'upfront' ? 1 : Number(formData.installmentsCount),
        first_due_date: formData.firstDueDate || (formData.customInstallments[0]?.dueDate ?? today),
        custom_installments: formData.customInstallments.length
          ? formData.customInstallments.map((item) => ({ due_date: item.dueDate, value: parseCurrencyToNumber(item.value) }))
          : undefined,
        notes: formData.notes?.trim() || undefined,
      });
      const schedule = buildScheduleFromForm();
      if (schedule.length) {
        await createCalendarEventsForInstallments(createdAgreement, schedule, calendarResponsibleId || null);
      }
      toast.success('Acordo criado', 'Os dados foram registrados com sucesso');
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast.error('Erro ao criar acordo', err.message);
      setFormLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo Lançamento"
      eyebrow="Financeiro"
      size="2xl"
      zIndex={70}
      footer={
        <div className="w-full">
          {(() => {
            const total = parseCurrencyToNumber(formData.totalValue);
            if (total <= 0) return null;
            const feeVal = formData.feeType === 'percentage'
              ? total * (Number(formData.feePercentage || '0') / 100)
              : parseCurrencyToNumber(formData.feeFixedValue);
            const count = formData.paymentType === 'upfront' ? 1 : Math.max(Number(formData.installmentsCount || '1'), 1);
            const perInst = total / count;
            const dueDateStr = formData.firstDueDate
              ? new Date(formData.firstDueDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
              : '—';
            return (
              <div className="bg-amber-50 dark:bg-zinc-900 border border-amber-200 dark:border-zinc-700 rounded mb-2 px-3 py-1.5 flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Resumo
                </span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Valor <strong className="text-slate-900 dark:text-white tabular-nums font-semibold ml-0.5">{formatCurrency(total)}</strong></span>
                <span className="text-slate-300 dark:text-slate-600 select-none">·</span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Honorários <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums font-semibold ml-0.5">{formatCurrency(feeVal)}</strong></span>
                <span className="text-slate-300 dark:text-slate-600 select-none">·</span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {count === 1 ? 'À vista' : `${count}× de`} <strong className="text-slate-900 dark:text-white tabular-nums font-semibold ml-0.5">{formatCurrency(perInst)}</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-600 select-none">·</span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">{count === 1 ? 'Vence' : '1ª parcela'} <strong className="text-slate-900 dark:text-white font-semibold ml-0.5">{dueDateStr}</strong></span>
              </div>
            );
          })()}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 italic hidden sm:block">
              Campos com <span className="text-red-500 font-bold not-italic">*</span> são obrigatórios
            </p>
            <div className="flex items-center gap-3 ml-auto">
              <button type="button" onClick={onClose} disabled={formLoading}
                className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition">
                Cancelar
              </button>
              <button type="submit" form="wa-new-agreement-form" disabled={formLoading}
                className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-semibold flex items-center gap-2 rounded transition disabled:opacity-50 active:scale-[0.98]">
                {formLoading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>) : (<><PlusCircle className="w-4 h-4" /> Criar Lançamento</>)}
              </button>
            </div>
          </div>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <form id="wa-new-agreement-form" onSubmit={handleSubmit} className="flex flex-col gap-5 pb-1" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">{formError}</div>
          )}

          {/* ── Identificação ── */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">IDENTIFICAÇÃO</span>
            </div>
            <div className="grid grid-cols-12 gap-x-3 gap-y-3">
              <div className="col-span-5">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Cliente <span className="text-red-500">*</span></label>
                {lockClient ? (
                  <div className="w-full rounded border border-slate-200 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-800 h-[34px] px-3 flex items-center text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate">
                    {initialClientName || getClientName(formData.clientId)}
                  </div>
                ) : (
                  <ClientSearchSelect
                    value={formData.clientId}
                    onChange={(clientId) => handleChange('clientId', clientId)}
                    label=""
                    placeholder="Selecione o cliente"
                    required
                    allowCreate={true}
                  />
                )}
              </div>
              <div className="col-span-4">
                <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Processo / Requerimento <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.processId}
                    onChange={(e) => handleChange('processId', e.target.value)}
                    disabled={!formData.clientId || loadingLinkedEntities}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] appearance-none disabled:opacity-50 disabled:cursor-not-allowed pr-10 transition"
                  >
                    <option value="">
                      {!formData.clientId ? 'Selecione um cliente primeiro' : loadingLinkedEntities ? 'Carregando…' : clientProcesses.length === 0 && clientRequirements.length === 0 ? 'Nenhum processo/requerimento' : '— Sem vínculo —'}
                    </option>
                    {clientProcesses.length > 0 && (
                      <optgroup label="Processos">
                        {clientProcesses.map(p => (
                          <option key={p.id} value={p.id}>{p.process_code || '—'} · {practiceLabelMap[p.practice_area] ?? p.practice_area}</option>
                        ))}
                      </optgroup>
                    )}
                    {clientRequirements.length > 0 && (
                      <optgroup label="Requerimentos">
                        {clientRequirements.map(r => (
                          <option key={r.id} value={r.id}>{r.protocol ? `Prot. ${r.protocol}` : 'Sem protocolo'} · {benefitLabelMap[r.benefit_type] ?? r.benefit_type}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    {loadingLinkedEntities ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>
              </div>
              <div className="col-span-3">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Data do lançamento</label>
                <input type="date" value={formData.agreementDate} onChange={(e) => handleChange('agreementDate', e.target.value)}
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition" />
              </div>
              <div className="col-span-9">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Título do lançamento <span className="text-red-500">*</span></label>
                <input type="text" placeholder="Ex: Ação Trabalhista — Cálculo de Verbas" value={formData.title} onChange={(e) => handleChange('title', e.target.value)}
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] placeholder:text-slate-400 px-3 text-[13px] transition" required />
              </div>
              {members.length > 0 && (
                <div className="col-span-3">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Responsável <span className="text-red-500">*</span></label>
                  <div className="flex -space-x-2 items-center h-[34px]">
                    {[...members]
                      .sort((a, b) => {
                        const order = (m: typeof a) => { const r = (m.role || '').toLowerCase(); return r.includes('admin') ? 0 : r.includes('advog') ? 1 : 2; };
                        return order(a) - order(b);
                      })
                      .map((m) => {
                        const isSelected = calendarResponsibleId === (m.user_id || m.id);
                        return (
                          <button key={m.id} type="button" onClick={() => setCalendarResponsibleId(isSelected ? '' : (m.user_id || m.id))} title={m.name || m.email || ''}
                            className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${isSelected ? 'ring-2 ring-offset-1 ring-amber-500 z-10' : 'hover:z-10'}`}>
                            {m.avatar_url ? (
                              <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover border-2 border-white dark:border-zinc-900" alt={m.name || ''} />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-amber-100 border-2 border-white dark:border-zinc-900 flex items-center justify-center text-sm font-semibold text-amber-700">
                                {(m.name || m.email || '?')[0].toUpperCase()}
                              </div>
                            )}
                            {isSelected && (
                              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center border border-white">
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg>
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                  {calendarResponsibleId && (
                    <p className="text-xs text-amber-600 mt-1 truncate">{members.find(m => (m.user_id || m.id) === calendarResponsibleId)?.name || 'Selecionado'}</p>
                  )}
                </div>
              )}
              <div className="col-span-12">
                <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">Objeto / Descrição <span className="font-normal">(opcional)</span></label>
                <textarea placeholder="Descreva o objeto do serviço, ex: Revisão de benefício previdenciário — auxílio-doença." value={formData.description} onChange={(e) => handleChange('description', e.target.value)} rows={3}
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition" />
              </div>
            </div>
          </div>

          {/* ── Financeiro ── */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">FINANCEIRO</span>
            </div>
            <div className="grid grid-cols-12 gap-x-3 gap-y-3 items-end">
              <div className="col-span-3">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Valor total <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-slate-500 pointer-events-none select-none">R$</span>
                  <input type="text" inputMode="decimal" placeholder="0,00" value={formData.totalValue} onChange={(e) => handleChange('totalValue', e.target.value)}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] placeholder:text-slate-400 pl-10 pr-3 text-[13px] font-semibold tabular-nums transition" required />
                </div>
              </div>
              <div className="col-span-4">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Tipo de honorário</label>
                <div className="flex p-0.5 bg-slate-100 dark:bg-zinc-800 rounded border border-slate-200 dark:border-zinc-600 h-[34px] items-center">
                  <button type="button" onClick={() => handleChange('feeType', 'percentage')}
                    className={`flex-1 rounded px-2 py-0.5 text-[12px] font-medium transition ${formData.feeType === 'percentage' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>Percentual</button>
                  <button type="button" onClick={() => handleChange('feeType', 'fixed')}
                    className={`flex-1 rounded px-2 py-0.5 text-[12px] font-medium transition ${formData.feeType === 'fixed' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>Valor fixo</button>
                </div>
              </div>
              {formData.feeType === 'percentage' ? (
                <>
                  <div className="col-span-2">
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">% <span className="text-red-500">*</span></label>
                    <input type="number" min="1" max="100" step="0.5" placeholder="0" value={formData.feePercentage} onChange={(e) => handleChange('feePercentage', e.target.value)}
                      className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] placeholder:text-slate-400 px-3 text-[13px] appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition" required />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">Honorários calc.</label>
                    <div className="h-[34px] flex items-center">
                      {formData.totalValue && formData.feePercentage ? (
                        <span className="inline-flex items-center gap-1.5 text-base font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          <CheckCircle className="w-4 h-4 shrink-0" />
                          {formatCurrency(parseCurrencyToNumber(formData.totalValue) * (Number(formData.feePercentage || '0') / 100))}
                        </span>
                      ) : (<span className="text-lg font-bold text-slate-400 dark:text-slate-500">—</span>)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="col-span-2">
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Valor fixo <span className="text-red-500">*</span></label>
                    <div className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 focus-within:ring-1 focus-within:ring-orange-400/40 focus-within:border-orange-400 transition">
                      <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium select-none">R$</span>
                      <input type="text" inputMode="decimal" placeholder="0,00" value={formData.feeFixedValue} onChange={(e) => handleChange('feeFixedValue', e.target.value)}
                        className="flex-1 bg-transparent outline-none border-none text-slate-900 dark:text-white text-sm font-medium tabular-nums placeholder:text-slate-400" required />
                    </div>
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">Honorários calc.</label>
                    <div className="h-[34px] flex items-center">
                      {formData.feeFixedValue ? (
                        <span className="inline-flex items-center gap-1.5 text-base font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          <CheckCircle className="w-4 h-4 shrink-0" />
                          {formatCurrency(parseCurrencyToNumber(formData.feeFixedValue))}
                        </span>
                      ) : (<span className="text-lg font-bold text-slate-400 dark:text-slate-500">—</span>)}
                    </div>
                  </div>
                </>
              )}
              <div className="col-span-4">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Forma de pagamento</label>
                <div className="flex p-0.5 bg-slate-100 dark:bg-zinc-800 rounded border border-slate-200 dark:border-zinc-600 h-[34px] items-center">
                  <button type="button" onClick={() => handleChange('paymentType', 'upfront')}
                    className={`flex-1 rounded px-2 py-0.5 text-[12px] font-medium transition ${formData.paymentType === 'upfront' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>À vista</button>
                  <button type="button" onClick={() => handleChange('paymentType', 'installments')}
                    className={`flex-1 rounded px-2 py-0.5 text-[12px] font-medium transition ${formData.paymentType === 'installments' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>Parcelado</button>
                </div>
              </div>
              <div className="col-span-3">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Primeiro vencimento</label>
                <input type="date" value={formData.firstDueDate} onChange={(e) => handleChange('firstDueDate', e.target.value)}
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition"
                  required={formData.paymentType === 'upfront' || !formData.customInstallments.length} />
              </div>
              {formData.paymentType === 'installments' && (
                <>
                  <div className="col-span-3">
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Nº de parcelas</label>
                    <input type="number" min="2" max="120" placeholder="2" value={formData.installmentsCount} onChange={(e) => handleChange('installmentsCount', e.target.value)}
                      className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] placeholder:text-slate-400 px-3 text-[13px] transition" required />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">Valor / parcela</label>
                    <div className="h-[34px] flex flex-col justify-center gap-0.5">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                        {formData.totalValue && formData.installmentsCount ? formatCurrency(parseCurrencyToNumber(formData.totalValue) / Number(formData.installmentsCount)) : '—'}
                      </span>
                      <button type="button"
                        onClick={() => setFormData((prev) => ({
                          ...prev,
                          customInstallments: prev.customInstallments.length ? [] : Array.from({ length: Number(prev.installmentsCount || '0') }, (_, index) => ({
                            dueDate: prev.firstDueDate ? (() => { const d = new Date(prev.firstDueDate + 'T12:00:00'); d.setMonth(d.getMonth() + index); return d.toISOString().split('T')[0]; })() : '',
                            value: prev.totalValue && prev.installmentsCount ? (parseCurrencyToNumber(prev.totalValue) / Number(prev.installmentsCount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                          })),
                        }))}
                        className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline text-left leading-none">
                        {formData.customInstallments.length ? 'Remover personalizadas' : 'Personalizar'}
                      </button>
                    </div>
                  </div>
                </>
              )}
              {formData.customInstallments.length > 0 && (
                <div className="col-span-12 border border-neutral-200 dark:border-zinc-700 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-50 dark:bg-zinc-800 border-b border-neutral-200 dark:border-zinc-700">
                      <tr>
                        <th className="py-2 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">#</th>
                        <th className="py-2 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Vencimento</th>
                        <th className="py-2 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-neutral-400">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 dark:divide-zinc-700">
                      {formData.customInstallments.map((item, index) => (
                        <tr key={index} className="hover:bg-neutral-50 dark:hover:bg-zinc-800/50 transition">
                          <td className="py-2 px-4 text-neutral-500 dark:text-neutral-400 font-medium">{index + 1}</td>
                          <td className="py-2 px-4">
                            <input type="date" value={item.dueDate}
                              onChange={(e) => { const value = e.target.value; setFormData((prev) => ({ ...prev, customInstallments: prev.customInstallments.map((ci, ciIndex) => ciIndex === index ? { ...ci, dueDate: value } : ci) })); }}
                              className="border border-slate-300 dark:border-zinc-600 rounded px-2 py-1 bg-white dark:bg-zinc-800 text-neutral-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 text-[13px]" />
                          </td>
                          <td className="py-2 px-4">
                            <input type="text" placeholder="R$ 0,00" value={item.value}
                              onChange={(e) => { const formatted = formatCurrencyInput(e.target.value); setFormData((prev) => ({ ...prev, customInstallments: prev.customInstallments.map((ci, ciIndex) => ciIndex === index ? { ...ci, value: formatted } : ci) })); }}
                              className="w-full border border-slate-300 dark:border-zinc-600 rounded px-3 py-1 bg-white dark:bg-zinc-800 text-neutral-800 dark:text-white text-[13px] focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 tabular-nums placeholder:text-slate-400" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bg-neutral-50 dark:bg-zinc-800 py-2 px-4 text-sm text-neutral-600 dark:text-neutral-300 flex justify-between items-center border-t border-neutral-100 dark:border-zinc-700">
                    <span className="font-medium">
                      Total: <span className="font-bold text-neutral-800 dark:text-white tabular-nums">{formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0) ? formatCurrency(formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0)) : '—'}</span>
                    </span>
                    <button type="button"
                      onClick={() => setFormData((prev) => ({
                        ...prev,
                        customInstallments: prev.customInstallments.map((item, index) => ({
                          dueDate: prev.firstDueDate ? (() => { const d = new Date(prev.firstDueDate + 'T12:00:00'); d.setMonth(d.getMonth() + index); return d.toISOString().split('T')[0]; })() : item.dueDate,
                          value: prev.totalValue && prev.installmentsCount ? (parseCurrencyToNumber(prev.totalValue) / Number(prev.installmentsCount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : item.value,
                        })),
                      }))}
                      className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">Recalcular</button>
                  </div>
                </div>
              )}
              <div className="col-span-12">
                <label className="block text-[13px] font-medium text-slate-500 dark:text-slate-400 mb-1">Notas internas <span className="font-normal">(opcional)</span></label>
                <textarea placeholder="Observações internas sobre este lançamento…" value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2}
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition" />
              </div>
            </div>
          </div>

        </form>
      </ModalBody>
    </Modal>
  );
};

export default AgreementFormModal;
