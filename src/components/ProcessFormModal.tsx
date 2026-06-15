/**
 * ProcessFormModal — modal de criar/editar Processo, fiel ao do ProcessesModule
 * (mesmo Modal/ModalBody, ClientSearchSelect, field-layout, busca DJEN/DataJud,
 * audiência → evento de agenda). Autocontido para reuso no WhatsApp 360 sem
 * mexer no ProcessesModule. Chama os serviços reais e notifica via onSaved.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Modal, ModalBody } from './ui';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useFormLayout } from '../hooks/useFormLayout';
import { useAuth } from '../contexts/AuthContext';
import { processService } from '../services/process.service';
import { calendarService } from '../services/calendar.service';
import { profileService, type Profile } from '../services/profile.service';
import { userNotificationService } from '../services/userNotification.service';
import { processDjenSyncService } from '../services/processDjenSync.service';
import { djenService } from '../services/djen.service';
import { fetchDatajudMovimentos } from '../services/datajud.service';
import type { Process, ProcessStatus, ProcessPracticeArea, HearingMode } from '../types/process.types';

const STATUS_OPTIONS: { key: ProcessStatus; label: string }[] = [
  { key: 'nao_protocolado', label: 'Não Protocolado' },
  { key: 'distribuido', label: 'Distribuído' },
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção' },
  { key: 'citacao', label: 'Citação' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'contestacao', label: 'Contestação' },
  { key: 'instrucao', label: 'Instrução' },
  { key: 'andamento', label: 'Em Andamento' },
  { key: 'sentenca', label: 'Sentença' },
  { key: 'recurso', label: 'Recurso' },
  { key: 'cumprimento', label: 'Cumprimento' },
  { key: 'arquivado', label: 'Arquivado' },
];

const PRACTICE_AREAS: { key: ProcessPracticeArea; label: string }[] = [
  { key: 'trabalhista', label: 'Trabalhista' },
  { key: 'familia', label: 'Família' },
  { key: 'consumidor', label: 'Consumidor' },
  { key: 'previdenciario', label: 'Previdenciário' },
  { key: 'civel', label: 'Cível' },
];

const emptyForm = {
  client_id: '',
  process_code: '',
  status: 'nao_protocolado' as ProcessStatus,
  distributed_at: '',
  practice_area: 'trabalhista' as ProcessPracticeArea,
  court: '',
  responsible_lawyer: '',
  responsible_lawyer_id: '',
  hearing_scheduled: 'nao' as 'sim' | 'nao',
  hearing_date: '',
  hearing_time: '',
  hearing_mode: 'presencial' as HearingMode,
  notes: '',
};

const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));

const mapClasseToArea = (nomeClasse?: string): ProcessPracticeArea | undefined => {
  if (!nomeClasse) return undefined;
  const c = nomeClasse.toLowerCase();
  if (c.includes('trabalh')) return 'trabalhista';
  if (c.includes('cível') || c.includes('civil')) return 'civel';
  if (c.includes('família') || c.includes('familia')) return 'familia';
  if (c.includes('previdenc')) return 'previdenciario';
  if (c.includes('consumidor')) return 'consumidor';
  return 'civel';
};

interface ProcessFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialClientId?: string;
  initialClientName?: string;
  /** Quando informado, abre em modo edição. */
  processId?: string;
  lockClient?: boolean;
}

export const ProcessFormModal: React.FC<ProcessFormModalProps> = ({
  open, onClose, onSaved, initialClientId, initialClientName, processId, lockClient,
}) => {
  const { user } = useAuth();
  const fl = useFormLayout('processes');

  const [members, setMembers] = useState<Profile[]>([]);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchingDjen, setSearchingDjen] = useState(false);
  const [djenData, setDjenData] = useState<any>(null);
  const [hearingResponsibleId, setHearingResponsibleId] = useState('');
  const [editingProcess, setEditingProcess] = useState<Process | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });

  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const inputStyle = 'w-full h-[34px] px-3 rounded text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 transition';
  const textareaStyle = 'w-full px-3 py-2 rounded text-[13px] bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 resize-none transition';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  useEffect(() => {
    profileService.listMembers().then(setMembers).catch(() => {});
    profileService.getMyProfile().then(setMyProfile).catch(() => {});
  }, []);

  // Reinicia / carrega ao abrir
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDjenData(null);
    setHearingResponsibleId('');
    if (processId) {
      setLoadingEdit(true);
      processService.getProcessById(processId).then(p => {
        if (!p) return;
        setEditingProcess(p);
        setFormData({
          client_id: p.client_id || initialClientId || '',
          process_code: p.process_code || '',
          status: p.status,
          distributed_at: p.distributed_at ? String(p.distributed_at).slice(0, 10) : '',
          practice_area: p.practice_area,
          court: p.court || '',
          responsible_lawyer: p.responsible_lawyer || '',
          responsible_lawyer_id: (p as any).responsible_lawyer_id || '',
          hearing_scheduled: p.hearing_scheduled ? 'sim' : 'nao',
          hearing_date: p.hearing_date ? String(p.hearing_date).slice(0, 10) : '',
          hearing_time: p.hearing_time ? String(p.hearing_time).slice(0, 5) : '',
          hearing_mode: (p.hearing_mode as HearingMode) || 'presencial',
          notes: '',
        });
      }).finally(() => setLoadingEdit(false));
    } else {
      setEditingProcess(null);
      setFormData({ ...emptyForm, client_id: initialClientId || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processId, initialClientId]);

  const handleFormChange = (field: keyof typeof formData, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const resolveAuthorInfo = useCallback(() => {
    const fallback = (user?.user_metadata?.name as string) || user?.email || 'Equipe do escritório';
    return {
      name: myProfile?.name || fallback,
      id: myProfile?.id || myProfile?.user_id || user?.id || null,
      avatar: myProfile?.avatar_url || undefined,
    };
  }, [myProfile, user]);

  const handleSearchDjen = async (overrideCode?: string) => {
    const codeToSearch = overrideCode ?? formData.process_code;
    const processNumber = codeToSearch.replace(/\D/g, '');
    if (processNumber.length < 20) { setError('Número do processo inválido. Deve ter 20 dígitos.'); return; }
    try {
      setSearchingDjen(true);
      setError(null);
      const yearMatch = codeToSearch.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;
      const djenParams: any = { numeroProcesso: processNumber, itensPorPagina: 100 };
      if (year) djenParams.dataDisponibilizacaoInicio = `${year}-01-01`;
      const [djenResult, djResult] = await Promise.allSettled([
        djenService.consultarComunicacoes(djenParams),
        fetchDatajudMovimentos(codeToSearch),
      ]);
      const djUpdates: { distributed_at?: string; court?: string } = {};
      if (djResult.status === 'fulfilled' && (djResult.value as any)?.processo) {
        const proc = (djResult.value as any).processo;
        if (proc.dataAjuizamento) djUpdates.distributed_at = proc.dataAjuizamento.slice(0, 10);
        if (proc.orgaoJulgador?.nome) djUpdates.court = proc.orgaoJulgador.nome;
      }
      if (djenResult.status === 'fulfilled' && (djenResult.value as any)?.items?.length > 0) {
        const firstItem = (djenResult.value as any).items[0];
        setDjenData(firstItem);
        setFormData(prev => ({
          ...prev,
          court: djUpdates.court || firstItem.nomeOrgao || prev.court,
          practice_area: mapClasseToArea(firstItem.nomeClasse) || prev.practice_area,
          ...(djUpdates.distributed_at && !prev.distributed_at ? { distributed_at: djUpdates.distributed_at } : {}),
        }));
      } else {
        if (Object.keys(djUpdates).length > 0) {
          setFormData(prev => ({
            ...prev,
            ...(djUpdates.court ? { court: djUpdates.court } : {}),
            ...(djUpdates.distributed_at && !prev.distributed_at ? { distributed_at: djUpdates.distributed_at } : {}),
          }));
        }
        setError('Nenhuma comunicação encontrada no DJEN para este processo.');
      }
    } catch {
      setError('Falha ao consultar o DJEN.');
    } finally {
      setSearchingDjen(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.client_id) { setError('Selecione um cliente.'); return; }
    const trimmedProcessCode = formData.process_code.trim();
    const requiresProcessCode = formData.status !== 'aguardando_confeccao';
    if (requiresProcessCode && !trimmedProcessCode) { setError('Informe o código do processo.'); return; }
    if (!editingProcess && formData.hearing_scheduled === 'sim' && !hearingResponsibleId) {
      setError('Selecione o responsável pela audiência.'); return;
    }
    if (formData.hearing_scheduled === 'sim' && formData.hearing_date) {
      const hd = new Date(formData.hearing_date); const t = new Date();
      hd.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
      if (hd < t) { setError('Data da audiência não pode ser anterior à data atual.'); return; }
    }

    try {
      setSaving(true);
      setError(null);
      const responsibleMember = formData.responsible_lawyer_id ? memberMap.get(formData.responsible_lawyer_id) : null;

      let distributedAtISO: string | null = null;
      let distributedAt = formData.distributed_at;
      if (!distributedAt && trimmedProcessCode) {
        const autoDate = processDjenSyncService.extractDistributedDate(trimmedProcessCode);
        if (autoDate) distributedAt = autoDate;
      }
      if (distributedAt) {
        const d = new Date(distributedAt);
        if (!Number.isNaN(d.getTime())) distributedAtISO = d.toISOString();
      }
      const hasDjenData = djenData && !djenData._noData;
      const payloadBase: Record<string, any> = {
        client_id: formData.client_id,
        process_code: requiresProcessCode ? trimmedProcessCode : null,
        status: formData.status,
        distributed_at: distributedAtISO,
        practice_area: formData.practice_area,
        court: formData.court?.trim() || null,
        responsible_lawyer: responsibleMember?.name || formData.responsible_lawyer?.trim() || null,
        responsible_lawyer_id: responsibleMember?.id || null,
        hearing_scheduled: formData.hearing_scheduled === 'sim',
        hearing_date: formData.hearing_scheduled === 'sim' && formData.hearing_date ? formData.hearing_date : null,
        hearing_time: formData.hearing_scheduled === 'sim' && formData.hearing_time ? formData.hearing_time : null,
        hearing_mode: formData.hearing_scheduled === 'sim' ? formData.hearing_mode : null,
        djen_synced: hasDjenData ? true : undefined,
        djen_has_data: hasDjenData ? true : undefined,
        djen_last_sync: hasDjenData ? new Date().toISOString() : undefined,
      };
      const trimmedNote = formData.notes.trim();

      if (editingProcess) {
        const updatePayload: Record<string, any> = { ...payloadBase };
        if (trimmedNote) {
          const a = resolveAuthorInfo();
          let existing: any[] = [];
          try { const p = JSON.parse(editingProcess.notes || '[]'); if (Array.isArray(p)) existing = p; } catch { /* texto livre antigo */ }
          updatePayload.notes = JSON.stringify([...existing, { id: generateId(), text: trimmedNote, created_at: new Date().toISOString(), author: a.name, author_name: a.name, author_id: a.id, author_avatar: a.avatar }]);
        }
        await processService.updateProcess(editingProcess.id, updatePayload);
        if (formData.hearing_scheduled === 'sim') {
          try {
            const hearingEvent = await calendarService.getEventByAutoKey(`hearing:${editingProcess.id}`);
            if (hearingEvent) {
              const up: Record<string, any> = { user_id: hearingResponsibleId || null };
              if (formData.hearing_date) up.start_at = `${formData.hearing_date}T${formData.hearing_time || '09:00'}:00-04:00`;
              await calendarService.updateEvent(hearingEvent.id, up);
            }
          } catch { /* sync agenda best-effort */ }
        }
      } else {
        const createPayload: Record<string, any> = { ...payloadBase };
        if (trimmedNote) {
          const a = resolveAuthorInfo();
          createPayload.notes = JSON.stringify([{ id: generateId(), text: trimmedNote, created_at: new Date().toISOString(), author: a.name, author_name: a.name, author_id: a.id, author_avatar: a.avatar }]);
        }
        const newProcess = await processService.createProcess(createPayload as any);
        if (user?.id && newProcess) {
          try {
            await userNotificationService.createNotification({
              title: '📋 Novo Processo',
              message: `${createPayload.process_code || 'Sem número'}`,
              type: 'process_created',
              user_id: user.id,
              process_id: newProcess.id,
              metadata: { status: createPayload.status },
            } as any);
          } catch { /* notificação best-effort */ }
        }
        if (newProcess && formData.hearing_scheduled === 'sim' && formData.hearing_date) {
          try {
            const hearingMode = formData.hearing_mode === 'online' ? 'POR VÍDEO' : 'PRESENCIAL';
            await calendarService.createEvent({
              title: `AUDIÊNCIA ${hearingMode} - ${newProcess.process_code || 'PROCESSO'}`,
              description: formData.court ? `Audiência do processo ${newProcess.process_code || ''} • ${formData.court}` : undefined,
              event_type: 'hearing',
              status: 'pendente',
              start_at: `${formData.hearing_date}T${formData.hearing_time || '09:00'}:00-04:00`,
              process_id: newProcess.id,
              client_id: (newProcess as any).client_id || null,
              user_id: hearingResponsibleId || null,
            } as any);
          } catch { /* agenda best-effort */ }
        }
        if (newProcess && trimmedProcessCode) {
          processDjenSyncService.syncProcessWithDjen(newProcess as Process).catch(() => {});
        }
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar o processo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={editingProcess ? 'Editar Processo' : 'Novo Processo'}
      eyebrow="Processos"
      size="2xl"
      zIndex={80}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition">Cancelar</button>
          <button type="submit" form="wa-process-form" disabled={saving}
            className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-600 px-4 py-2.5 rounded text-sm">{error}</div>}
        {loadingEdit ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…</div>
        ) : (
        <form id="wa-process-form" onSubmit={handleSubmit} className="flex flex-col gap-5 pb-1" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
          {/* Identificação */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Identificação</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
              <div className="md:col-span-5">
                {lockClient ? (
                  <div>
                    <label className={labelStyle}>Cliente</label>
                    <div className="w-full h-[34px] px-3 rounded text-[13px] bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-600 flex items-center text-slate-700 dark:text-slate-200 truncate">
                      {initialClientName || 'Cliente vinculado'}
                    </div>
                  </div>
                ) : (
                  <ClientSearchSelect value={formData.client_id} onChange={(clientId) => handleFormChange('client_id', clientId)}
                    label="Cliente" placeholder="Buscar cliente..." required allowCreate={true} />
                )}
              </div>
              <div className="md:col-span-6">
                <label className={labelStyle}>Número do Processo</label>
                <input value={formData.process_code}
                  onChange={(e) => { const val = e.target.value; handleFormChange('process_code', val); if (!editingProcess && !searchingDjen && val.replace(/\D/g, '').length >= 20) handleSearchDjen(val); }}
                  className={inputStyle} placeholder="0001234-56.2024.8.26.0100" required />
              </div>
              <div className="md:col-span-1">
                <button type="button" onClick={() => handleSearchDjen()} disabled={searchingDjen || formData.process_code.replace(/\D/g, '').length < 20}
                  className="w-full h-9 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                  {searchingDjen ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {djenData && (
              <div className={`mt-1.5 p-2 rounded-lg text-xs ${djenData._noData ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>
                {djenData._noData ? 'Nenhum dado encontrado no DJEN' : `Vara: ${djenData.nomeOrgao}`}
              </div>
            )}
          </div>

          {/* Dados do Processo */}
          <div>
            <div className="border-b border-slate-100 dark:border-zinc-700 pb-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Dados do Processo</span>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12">
                {!fl.isHidden('practice_area') && (
                  <div className="xl:col-span-3">
                    <label className={labelStyle}>{fl.fieldLabel('practice_area', 'Área')}</label>
                    <select value={formData.practice_area} onChange={(e) => handleFormChange('practice_area', e.target.value as ProcessPracticeArea)} className={inputStyle} required={fl.isRequired('practice_area')}>
                      {PRACTICE_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </select>
                  </div>
                )}
                {!fl.isHidden('status') && (
                  <div className="xl:col-span-3">
                    <label className={labelStyle}>{fl.fieldLabel('status', 'Status')}</label>
                    <select value={formData.status} onChange={(e) => handleFormChange('status', e.target.value as ProcessStatus)} className={inputStyle} required={fl.isRequired('status')}>
                      {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="xl:col-span-3">
                  <label className={labelStyle}>Distribuição</label>
                  <input type="date" value={formData.distributed_at} onChange={(e) => handleFormChange('distributed_at', e.target.value)} className={inputStyle} />
                </div>
                {!fl.isHidden('court') && (
                  <div className="xl:col-span-3">
                    <label className={labelStyle}>{fl.fieldLabel('court', 'Vara / Comarca')}</label>
                    <input value={formData.court} onChange={(e) => handleFormChange('court', e.target.value)} className={inputStyle} required={fl.isRequired('court')} />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className={labelStyle}>Audiência</label>
                  <select value={formData.hearing_scheduled} onChange={(e) => handleFormChange('hearing_scheduled', e.target.value)} className={inputStyle}>
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
                </div>
                {formData.hearing_scheduled === 'sim' && (
                  <div>
                    <label className={labelStyle}>Modo</label>
                    <select value={formData.hearing_mode} onChange={(e) => handleFormChange('hearing_mode', e.target.value as HearingMode)} className={inputStyle}>
                      <option value="presencial">Presencial</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                )}
              </div>

              {!fl.isHidden('responsible') && (
                <div>
                  <div className="flex items-baseline gap-3 mb-1">
                    <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{fl.fieldLabel('responsible', 'Advogado do processo')}{fl.isRequired('responsible') && <span className="text-red-500"> *</span>}</label>
                    {formData.responsible_lawyer ? <span className="text-xs text-orange-600 font-semibold truncate">{formData.responsible_lawyer}</span> : <span className="text-xs text-slate-400">Selecione um advogado</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 bg-white dark:bg-zinc-800 rounded border border-slate-300 dark:border-zinc-600 p-3">
                    {members.filter(m => (m as any).is_active !== false).map(m => {
                      const isSelected = formData.responsible_lawyer_id === m.id;
                      return (
                        <button key={m.id} type="button" title={m.name || ''}
                          onClick={() => { handleFormChange('responsible_lawyer_id', m.id); handleFormChange('responsible_lawyer', m.name || ''); }}
                          className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all hover:z-10 hover:scale-110 ${isSelected ? 'ring-2 ring-offset-1 ring-orange-500 scale-110' : 'ring-1 ring-white dark:ring-zinc-600'}`}>
                          {m.avatar_url ? <img src={m.avatar_url} className="w-9 h-9 rounded-full object-cover" alt={m.name || ''} /> : <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700">{(m.name || m.email || '?')[0].toUpperCase()}</div>}
                          {isSelected && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-orange-500 rounded-full flex items-center justify-center"><svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg></span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {formData.hearing_scheduled === 'sim' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
                  <div className="xl:col-span-3">
                    <label className={labelStyle}>Data</label>
                    <input type="date" value={formData.hearing_date} onChange={(e) => handleFormChange('hearing_date', e.target.value)} className={inputStyle} min={new Date().toISOString().split('T')[0]} />
                  </div>
                  <div className="xl:col-span-3">
                    <label className={labelStyle}>Hora</label>
                    <input type="time" value={formData.hearing_time} onChange={(e) => handleFormChange('hearing_time', e.target.value)} className={inputStyle} />
                  </div>
                  <div className="xl:col-span-6">
                    <label className={labelStyle}>Responsável pela audiência</label>
                    <div className="flex flex-wrap items-center gap-1.5 min-h-9">
                      {members.map((m) => (
                        <button key={m.id} type="button" onClick={() => setHearingResponsibleId(hearingResponsibleId === (m.user_id || m.id) ? '' : (m.user_id || m.id))}
                          className={`relative flex-shrink-0 rounded-full focus:outline-none transition-all ${hearingResponsibleId === (m.user_id || m.id) ? 'ring-2 ring-offset-2 ring-amber-500' : 'ring-1 ring-transparent hover:ring-slate-300'}`} title={m.name || m.email || ''}>
                          {m.avatar_url ? <img src={m.avatar_url} className="w-8 h-8 rounded-full object-cover" alt={m.name || ''} /> : <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700">{(m.name || m.email || '?')[0].toUpperCase()}</div>}
                          {hearingResponsibleId === (m.user_id || m.id) && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 rounded-full flex items-center justify-center"><svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg></span>}
                        </button>
                      ))}
                    </div>
                    {hearingResponsibleId && <p className="text-xs text-amber-600 mt-0.5">✓ {members.find(m => (m.user_id || m.id) === hearingResponsibleId)?.name || 'Responsável selecionado'}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!fl.isHidden('description') && (
            <div>
              <label className={labelStyle}>{fl.fieldLabel('description', 'Observações')}</label>
              <textarea rows={3} value={formData.notes} onChange={(e) => handleFormChange('notes', e.target.value)} className={textareaStyle} required={fl.isRequired('description')} />
            </div>
          )}
        </form>
        )}
      </ModalBody>
    </Modal>
  );
};

export default ProcessFormModal;
