/**
 * EventFormModal — criar/editar Compromisso, fiel ao CalendarModule
 * (mesmo Modal/ModalBody, tipos de evento, responsável, privacidade/compartilhamento,
 *  durations do settings, notificações). Autocontido para reuso no WhatsApp 360.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Loader2, X, Check, Search, Lock, Globe, Users,
  Calendar as CalendarIcon, Plus,
} from 'lucide-react';
import { Modal, ModalBody } from './ui';
import { useAuth } from '../contexts/AuthContext';
import { useToastContext } from '../contexts/ToastContext';
import { calendarService } from '../services/calendar.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { profileService, type Profile } from '../services/profile.service';
import { settingsService } from '../services/settings.service';
import { userNotificationService } from '../services/userNotification.service';
import ClientForm from './ClientForm';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EventType = 'deadline' | 'hearing' | 'requirement' | 'payment' | 'meeting' | 'pericia' | 'personal';

const DEFAULT_LABELS: Record<EventType, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};

const DEFAULT_DURATIONS: Record<string, number> = {
  deadline: 60, hearing: 120, requirement: 60, payment: 30, meeting: 60, pericia: 180, personal: 60,
};

const TYPE_STYLES: Record<EventType, { active: string; idle: string }> = {
  meeting:     { active: 'bg-emerald-500 text-white border-emerald-500', idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-emerald-400 hover:text-emerald-600' },
  deadline:    { active: 'bg-indigo-500  text-white border-indigo-500',  idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-indigo-400 hover:text-indigo-600' },
  hearing:     { active: 'bg-red-500     text-white border-red-500',     idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-red-400 hover:text-red-600' },
  pericia:     { active: 'bg-purple-500  text-white border-purple-500',  idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-purple-400 hover:text-purple-600' },
  payment:     { active: 'bg-sky-500     text-white border-sky-500',     idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-sky-400 hover:text-sky-600' },
  requirement: { active: 'bg-orange-500  text-white border-orange-500',  idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-orange-400 hover:text-orange-600' },
  personal:    { active: 'bg-fuchsia-500 text-white border-fuchsia-500', idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-fuchsia-400 hover:text-fuchsia-600' },
};

const ALL_TYPES: EventType[] = ['meeting', 'deadline', 'hearing', 'pericia', 'payment', 'requirement', 'personal'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getMemberInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
const getMemberHue = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = (h << 5) - h + name.charCodeAt(i); h |= 0; }
  return Math.abs(h) % 360;
};
const computeStartAt = (date: string, time: string) => {
  if (time) return `${date}T${time.length === 5 ? `${time}:00` : time}`;
  return `${date}T00:00:00`;
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface EventFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  eventId?: string;
  initialClientId?: string;
  initialClientName?: string;
  initialProcessId?: string;
  lockClient?: boolean;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export const EventFormModal: React.FC<EventFormModalProps> = ({
  open, onClose, onSaved,
  eventId,
  initialClientId, initialClientName, initialProcessId,
  lockClient = false,
}) => {
  const { user } = useAuth();
  const toast = useToastContext();

  // ── Config do settings ────────────────────────────────────────────────────
  const [eventTypeLabels, setEventTypeLabels] = useState<Record<string, string>>(DEFAULT_LABELS);
  const [eventTypeDurations, setEventTypeDurations] = useState<Record<string, number>>(DEFAULT_DURATIONS);
  const [bufferMin, setBufferMin] = useState(0);
  const [inactiveKeys, setInactiveKeys] = useState<Set<string>>(new Set());

  // ── Dados ─────────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<Profile[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [allProcesses, setAllProcesses] = useState<Process[]>([]);
  const [allRequirements, setAllRequirements] = useState<Requirement[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ── Form ──────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: '',
    date: new Date().toISOString().slice(0, 10),
    time: '',
    type: 'meeting' as EventType,
    event_mode: '' as '' | 'presencial' | 'online',
    client_id: initialClientId || '',
    client_name: initialClientName || '',
    process_id: initialProcessId || '',
    requirement_id: '',
    pericia_link_type: 'process' as 'process' | 'requirement',
    responsible_id: '',
    is_private: false,
    shared_with_ids: [] as string[],
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(!!eventId);

  // ── Client search ─────────────────────────────────────────────────────────
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  // ── Linked client ─────────────────────────────────────────────────────────
  const linkedClient = allClients.find(c => c.id === form.client_id) ?? null;

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    Promise.all([
      profileService.listMembers(),
      clientService.listClients(),
      processService.listProcesses(),
      requirementService.listRequirements(),
      settingsService.getCalendarModuleConfig().catch(() => null),
    ]).then(([m, c, p, r, cfg]) => {
      setMembers(m);
      setAllClients(c);
      setAllProcesses(p);
      setAllRequirements(r);
      if (cfg) {
        const labels = { ...DEFAULT_LABELS } as Record<string, string>;
        const durs   = { ...DEFAULT_DURATIONS };
        cfg.event_types?.forEach((et: any) => {
          if (et.key) {
            if (et.label)    labels[et.key] = et.label;
            if (et.duration) durs[et.key]   = et.duration;
          }
        });
        setEventTypeLabels(labels);
        setEventTypeDurations(durs);
        if (cfg.buffer_min) setBufferMin(cfg.buffer_min);
        const inactive = new Set(
          (cfg.event_types as any[] ?? []).filter((et: any) => et.active === false).map((et: any) => et.key as string)
        );
        setInactiveKeys(inactive);
      }
    }).finally(() => setLoadingData(false));
  }, [open]);

  // ── Load existing event ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !eventId) return;
    setLoadingEvent(true);
    calendarService.getEventById(eventId).then((ev: any) => {
      if (!ev) return;
      const startAt = ev.start_at || '';
      const datePart = startAt.slice(0, 10);
      const timePart = startAt.includes('T') ? startAt.slice(11, 16) : '';
      setForm({
        title:             ev.title || '',
        date:              datePart,
        time:              timePart,
        type:              (ev.event_type as EventType) || 'meeting',
        event_mode:        ev.event_mode || '',
        client_id:         ev.client_id || '',
        client_name:       '',
        process_id:        ev.process_id || '',
        requirement_id:    ev.requirement_id || '',
        pericia_link_type: ev.requirement_id ? 'requirement' : 'process',
        responsible_id:    ev.user_id || '',
        is_private:        ev.is_private ?? false,
        shared_with_ids:   ev.shared_with_ids ?? [],
        description:       ev.description || '',
      });
    }).finally(() => setLoadingEvent(false));
  }, [open, eventId]);

  // ── Reset on open (create mode) ───────────────────────────────────────────
  useEffect(() => {
    if (!open || eventId) return;
    setForm({
      title: '',
      date: new Date().toISOString().slice(0, 10),
      time: '',
      type: 'meeting',
      event_mode: '',
      client_id: initialClientId || '',
      client_name: initialClientName || '',
      process_id: initialProcessId || '',
      requirement_id: '',
      pericia_link_type: 'process',
      responsible_id: '',
      is_private: false,
      shared_with_ids: [],
      description: '',
    });
    setClientSearch('');
    setClientSearchOpen(false);
  }, [open, eventId, initialClientId, initialClientName, initialProcessId]);

  // ── Click outside para fechar busca de cliente ────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setClientSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const isPersonal     = form.type === 'personal';
  const showModality   = (['hearing', 'meeting', 'pericia'] as EventType[]).includes(form.type);
  const showProcessReq = !isPersonal;
  const showReqToggle  = form.type === 'pericia' && !!form.client_id;
  const showReq        = form.type === 'pericia' && form.pericia_link_type === 'requirement';

  const clientProcesses    = allProcesses.filter(p => p.client_id === form.client_id);
  const clientRequirements = allRequirements.filter(r => r.client_id === form.client_id);
  const selectedProcess    = clientProcesses.find(p => p.id === form.process_id);
  const selectedReq        = clientRequirements.find(r => r.id === form.requirement_id);

  const clientSearchResults = clientSearch.trim().length >= 1
    ? allClients.filter(c => c.full_name.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 8)
    : [];

  const visibleTypes = ALL_TYPES.filter(t => !inactiveKeys.has(t));

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!form.title.trim()) { toast.error('Informe o título do compromisso.'); return; }
    if (!form.date)         { toast.error('Informe a data.'); return; }
    setSaving(true);
    try {
      const linkProcessId = (!isPersonal && form.process_id &&
        (form.type !== 'pericia' || form.pericia_link_type === 'process'))
        ? form.process_id : null;
      const linkRequirementId = (!isPersonal && form.requirement_id &&
        form.type === 'pericia' && form.pericia_link_type === 'requirement')
        ? form.requirement_id : null;

      const computedStartAt = computeStartAt(form.date, form.time);
      const computedEndAt   = form.time
        ? (() => {
            const dur = (eventTypeDurations[form.type] ?? 60) + bufferMin;
            return new Date(new Date(computedStartAt).getTime() + dur * 60000).toISOString();
          })()
        : null;

      const payload = {
        title:              form.title.trim(),
        description:        form.description.trim() || null,
        event_type:         form.type,
        start_at:           computedStartAt,
        end_at:             computedEndAt,
        notify_minutes_before: null as number | null,
        client_id:          form.client_id || null,
        client_name:        !form.client_id && form.client_name.trim() ? form.client_name.trim() : null,
        user_id:            isPersonal ? (user?.id || null) : (form.responsible_id || null),
        is_private:         isPersonal ? true : form.is_private,
        shared_with_ids:    (isPersonal || form.is_private) ? form.shared_with_ids : [],
        process_id:         linkProcessId,
        requirement_id:     linkRequirementId,
        event_mode:         showModality ? (form.event_mode || null) : null,
      };

      if (eventId) {
        await calendarService.updateEvent(eventId, payload);
        // Notificações de edição
        if (user?.id) {
          const formattedDate = new Date(computedStartAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          const notifyBase = { appointment_id: eventId, metadata: { event_type: form.type, start_at: computedStartAt } };
          const assignerName = members.find(m => m.user_id === user.id)?.name || 'Alguém';
          const typeLabel = eventTypeLabels[form.type] || 'Compromisso';
          if (payload.user_id && payload.user_id !== user.id) {
            try {
              await userNotificationService.createNotification({
                title: `📅 ${typeLabel} Atribuída`, type: 'appointment_assigned',
                message: `${assignerName} atribuiu uma ${typeLabel} a você\n"${form.title}" • ${formattedDate}`,
                user_id: payload.user_id, ...notifyBase,
              });
            } catch {}
          }
        }
        toast.success('Compromisso atualizado.');
      } else {
        const created = await calendarService.createEvent({ ...payload, status: 'pendente' } as any);
        // Notificações de criação
        if (user?.id && created) {
          const formattedDate = new Date(computedStartAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          const notifyBase = { appointment_id: created.id, metadata: { event_type: form.type, start_at: computedStartAt } };
          const assignerName = members.find(m => m.user_id === user.id)?.name || 'Alguém';
          const typeLabel = eventTypeLabels[form.type] || 'Compromisso';
          if (payload.user_id && payload.user_id !== user.id) {
            try {
              await userNotificationService.createNotification({
                title: `📅 ${typeLabel} Atribuída`, type: 'appointment_assigned',
                message: `${assignerName} atribuiu uma ${typeLabel} a você\n"${form.title}" • ${formattedDate}`,
                user_id: payload.user_id, ...notifyBase,
              });
            } catch {}
          }
          for (const uid of (payload.shared_with_ids ?? []).filter(id => id !== user.id)) {
            try {
              await userNotificationService.createNotification({
                title: `👁️ ${typeLabel} Compartilhada`, type: 'appointment_assigned',
                message: `${assignerName} compartilhou uma ${typeLabel} com você\n"${form.title}" • ${formattedDate}`,
                user_id: uid, ...notifyBase,
              });
            } catch {}
          }
        }
        toast.success('Compromisso criado na agenda.');
      }
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error('Falha ao salvar compromisso', e.message);
    } finally { setSaving(false); }
  }, [form, eventId, isPersonal, showModality, user, members, eventTypeLabels, eventTypeDurations, bufferMin, onSaved, onClose, toast]);

  // ── Helpers de renderização ───────────────────────────────────────────────
  const setF = (k: keyof typeof form, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const inputCls = 'w-full rounded text-slate-900 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 bg-white h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1';

  const sortedMembers = [...members].sort((a, b) => {
    const rank = (m: Profile) => {
      const r = (m.role || '').toLowerCase();
      if (r.includes('admin')) return 0;
      if (r.includes('advogad')) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });

  const membersExcludingSelf = sortedMembers.filter(m => (m.user_id || m.id) !== user?.id);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={eventId ? 'Editar compromisso' : 'Novo compromisso'}
        eyebrow="Agenda"
        icon={<CalendarIcon className="w-4 h-4" />}
        size="lg"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition">
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={saving || loadingData || loadingEvent}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold shadow-sm hover:bg-amber-600 disabled:opacity-60 transition">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {eventId ? 'Salvar alterações' : 'Criar compromisso'}
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
          {(loadingData || loadingEvent) ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Carregando…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6 lg:grid-cols-12">

              {/* Título */}
              <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                <label className={labelCls}>Título <span className="text-red-400">*</span></label>
                <input value={form.title} onChange={e => setF('title', e.target.value)}
                  className={inputCls} placeholder="Ex: Reunião com cliente" autoFocus />
              </div>

              {/* Data */}
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <label className={labelCls}>Data <span className="text-red-400">*</span></label>
                <input type="date" value={form.date} onChange={e => setF('date', e.target.value)}
                  className={inputCls + ' appearance-none'} />
              </div>

              {/* Horário */}
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <label className={labelCls}>Horário</label>
                <input type="time" value={form.time} onChange={e => setF('time', e.target.value)}
                  className={inputCls + ' appearance-none'} />
              </div>

              {/* Modalidade (só hearing/meeting/pericia) */}
              <div className="col-span-1 sm:col-span-2 lg:col-span-6">
                {showModality && (
                  <>
                    <label className={labelCls}>Modalidade</label>
                    <select value={form.event_mode} onChange={e => setF('event_mode', e.target.value)}
                      className={inputCls + ' appearance-none'}>
                      <option value="">Não definida</option>
                      <option value="presencial">Presencial</option>
                      <option value="online">Online</option>
                    </select>
                  </>
                )}
              </div>

              {/* Tipo de evento */}
              <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                <label className={labelCls}>Tipo</label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                  {visibleTypes.map(t => {
                    const s = TYPE_STYLES[t];
                    return (
                      <button key={t} type="button"
                        onClick={() => setForm(prev => ({
                          ...prev, type: t,
                          ...(t === 'personal' ? { process_id: '', requirement_id: '' } : {}),
                          ...(t !== 'pericia'  ? { requirement_id: '', pericia_link_type: 'process' as const } : {}),
                        }))}
                        className={`py-1.5 rounded-lg text-xs font-semibold border transition-all text-center ${form.type === t ? s.active : s.idle}`}>
                        {eventTypeLabels[t] ?? t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cliente | Processo/Req | Responsável */}
              <div className="col-span-1 sm:col-span-6 lg:col-span-12 border-t border-slate-100 pt-1">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">

                  {/* ── Cliente ── */}
                  <div className="col-span-1">
                    <label className={labelCls}>
                      Cliente <span className="text-slate-300 font-normal">(opcional)</span>
                    </label>
                    <div ref={clientSearchRef} className="relative">
                      {form.client_id ? (
                        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-300 rounded-xl">
                          <span className="flex-1 text-sm font-semibold text-emerald-800 truncate">
                            {linkedClient?.full_name || initialClientName}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full shrink-0">
                            Cliente
                          </span>
                          {!lockClient && (
                            <button type="button"
                              onClick={() => { setF('client_id', ''); setF('client_name', ''); setF('process_id', ''); setF('requirement_id', ''); setClientSearch(''); }}
                              className="w-5 h-5 flex items-center justify-center text-emerald-500 hover:text-red-500 hover:bg-red-50 rounded-full transition shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                            <input type="text"
                              value={clientSearch || form.client_name}
                              onChange={e => { setClientSearch(e.target.value); setF('client_name', e.target.value); setClientSearchOpen(true); }}
                              onFocus={() => { if (clientSearch.trim()) setClientSearchOpen(true); }}
                              placeholder="Nome ou buscar..."
                              className={inputCls + ' pl-9'}
                            />
                          </div>
                          {clientSearchOpen && clientSearchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e7e5df] rounded-xl shadow-lg z-50 overflow-hidden">
                              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Clientes cadastrados</p>
                              {clientSearchResults.map(c => (
                                <button key={c.id} type="button"
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setForm(prev => ({ ...prev, client_id: c.id, client_name: '', process_id: '', requirement_id: '' }));
                                    setClientSearch('');
                                    setClientSearchOpen(false);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-amber-50 text-left transition">
                                  <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-bold shrink-0">
                                    {c.full_name?.charAt(0)?.toUpperCase() || '?'}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-800 truncate">{c.full_name}</p>
                                    {c.cpf_cnpj && <p className="text-xs text-slate-400">{c.cpf_cnpj}</p>}
                                  </div>
                                </button>
                              ))}
                              <div className="border-t border-slate-100" />
                              <button type="button"
                                onMouseDown={e => { e.preventDefault(); setClientSearchOpen(false); setShowClientForm(true); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-emerald-50 text-left transition text-emerald-700">
                                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                  <Plus className="w-3.5 h-3.5 text-emerald-600" />
                                </div>
                                <span className="text-sm font-medium">Cadastrar novo cliente</span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Processo / Requerimento ── */}
                  {showProcessReq && (
                    <div className="col-span-1">
                      {showReqToggle && (
                        <div className="mb-1.5 grid grid-cols-2 gap-1.5">
                          {(['process', 'requirement'] as const).map(pt => (
                            <button key={pt} type="button"
                              onClick={() => setForm(prev => ({
                                ...prev, pericia_link_type: pt,
                                ...(pt === 'process' ? { requirement_id: '' } : { process_id: '' }),
                              }))}
                              className={`flex-1 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                                form.pericia_link_type === pt
                                  ? 'bg-purple-500 text-white border-purple-500'
                                  : 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-purple-400'
                              }`}>
                              {pt === 'process' ? 'Processo jud.' : 'Req. adm.'}
                            </button>
                          ))}
                        </div>
                      )}
                      <label className={labelCls}>
                        {showReq ? 'Requerimento' : 'Processo'}{' '}
                        <span className="text-slate-300 font-normal">(opcional)</span>
                      </label>
                      {!form.client_id ? (
                        <select disabled className={inputCls + ' opacity-60 cursor-not-allowed'}>
                          <option>— Sem vínculo —</option>
                        </select>
                      ) : showReq ? (
                        selectedReq ? (
                          <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-300 rounded-xl">
                            <span className="flex-1 text-sm font-semibold text-purple-800 truncate">{selectedReq.beneficiary}</span>
                            <button type="button" onClick={() => setF('requirement_id', '')}
                              className="w-5 h-5 flex items-center justify-center text-purple-400 hover:text-red-500 rounded-full transition shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <select value={form.requirement_id} onChange={e => setF('requirement_id', e.target.value)}
                            className={inputCls + ' appearance-none'}>
                            <option value="">— Sem vínculo —</option>
                            {clientRequirements.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.beneficiary}{r.protocol ? ` · ${r.protocol}` : ''}
                              </option>
                            ))}
                          </select>
                        )
                      ) : selectedProcess ? (
                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-300 rounded-xl">
                          <span className="flex-1 text-sm font-semibold text-blue-800 font-mono truncate">{selectedProcess.process_code}</span>
                          <button type="button" onClick={() => setF('process_id', '')}
                            className="w-5 h-5 flex items-center justify-center text-blue-400 hover:text-red-500 rounded-full transition shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <select value={form.process_id} onChange={e => setF('process_id', e.target.value)}
                          className={inputCls + ' appearance-none'}>
                          <option value="">— Sem vínculo —</option>
                          {clientProcesses.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.process_code}{p.practice_area ? ` · ${p.practice_area}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {/* ── Responsável ── */}
                  {!isPersonal && (
                    <div className="col-span-1">
                      <div className="mb-1 flex items-center justify-between gap-1.5">
                        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          Responsável <span className="font-normal normal-case tracking-normal">(opcional)</span>
                        </label>
                        {form.responsible_id && (
                          <span className="text-[11px] font-semibold text-orange-500 truncate max-w-[100px]">
                            {(members.find(m => m.user_id === form.responsible_id || m.id === form.responsible_id)?.name || '').split(' ')[0]}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 bg-slate-50 rounded-xl border border-[#e7e5df] px-2 py-2 min-h-[42px] items-center">
                        {sortedMembers.map(member => {
                          const memberId = member.user_id || member.id;
                          const isSelected = form.responsible_id === memberId;
                          const hue = getMemberHue(member.name || '');
                          const initials = getMemberInitials(member.name || '');
                          return (
                            <button key={member.id} type="button" title={member.name}
                              onClick={() => setF('responsible_id', isSelected ? '' : memberId)}
                              className="relative group transition-transform hover:z-10 hover:scale-110 focus:outline-none">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${isSelected ? 'ring-[3px] ring-orange-500 ring-offset-1' : 'ring-1 ring-slate-200'}`}
                                style={{ background: `hsl(${hue}, 50%, ${isSelected ? '85%' : '93%'})`, color: `hsl(${hue}, 45%, 30%)` }}>
                                {initials}
                                {(member as any).avatar_url && (
                                  <img src={(member as any).avatar_url} alt={member.name} loading="eager" decoding="async"
                                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    className={`absolute inset-0 w-full h-full rounded-full object-cover ${isSelected ? '' : 'grayscale-[40%] group-hover:grayscale-0'}`}
                                  />
                                )}
                              </div>
                              {isSelected && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center">
                                  <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                                </div>
                              )}
                            </button>
                          );
                        })}
                        {members.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum membro.</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Privacidade */}
              <div className="col-span-1 sm:col-span-6 lg:col-span-12 border-t border-slate-100 pt-3">
                {isPersonal ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-5 h-5 rounded-full bg-fuchsia-100 flex items-center justify-center shrink-0">
                        <Users className="w-3 h-3 text-fuchsia-600" />
                      </div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Compartilhar com alguém?</p>
                      {form.shared_with_ids.length > 0 && (
                        <span className="text-[10px] font-semibold text-fuchsia-600 bg-fuchsia-50 px-1.5 py-0.5 rounded-full">
                          {form.shared_with_ids.length} pessoa(s)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {membersExcludingSelf.map(member => {
                        const memberId = member.user_id || member.id;
                        const isShared = form.shared_with_ids.includes(memberId);
                        const hue = getMemberHue(member.name || '');
                        const initials = getMemberInitials(member.name || '');
                        return (
                          <button key={member.id} type="button" title={member.name}
                            onClick={() => setF('shared_with_ids', isShared
                              ? form.shared_with_ids.filter(id => id !== memberId)
                              : [...form.shared_with_ids, memberId]
                            )}
                            className="relative group transition-transform hover:scale-110 focus:outline-none">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${isShared ? 'ring-[3px] ring-fuchsia-500 ring-offset-1' : 'ring-1 ring-slate-200 opacity-60 group-hover:opacity-100'}`}
                              style={{ background: `hsl(${hue}, 50%, ${isShared ? '85%' : '93%'})`, color: `hsl(${hue}, 45%, 30%)` }}>
                              {initials}
                              {(member as any).avatar_url && (
                                <img src={(member as any).avatar_url} alt={member.name} loading="eager" decoding="async"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                  className="absolute inset-0 w-full h-full rounded-full object-cover" />
                              )}
                            </div>
                            {isShared && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-fuchsia-500 border-2 border-white flex items-center justify-center">
                                <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button"
                      onClick={() => setForm(prev => ({ ...prev, is_private: !prev.is_private, shared_with_ids: [] }))}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-all ${form.is_private ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-[#e7e5df]'}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-full shadow-sm ${form.is_private ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>
                          {form.is_private ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                        </span>
                        <div className="min-w-0 text-left">
                          <p className={`text-xs font-bold ${form.is_private ? 'text-amber-700' : 'text-slate-600'}`}>
                            {form.is_private ? 'Privado' : 'Público'}
                          </p>
                          <p className={`text-[11px] truncate ${form.is_private ? 'text-amber-500' : 'text-slate-400'}`}>
                            {form.is_private
                              ? form.shared_with_ids.length > 0
                                ? `visível para ${form.shared_with_ids.length} pessoa(s)`
                                : 'só você vê este evento'
                              : 'todos do escritório veem'}
                          </p>
                        </div>
                      </div>
                      <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_private ? 'bg-amber-400' : 'bg-slate-300'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${form.is_private ? 'translate-x-6' : 'translate-x-1'}`} />
                      </div>
                    </button>
                    {form.is_private && (
                      <div className="mt-3">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Compartilhar com</p>
                        <div className="flex flex-wrap gap-2">
                          {membersExcludingSelf.map(member => {
                            const memberId = member.user_id || member.id;
                            const isShared = form.shared_with_ids.includes(memberId);
                            const hue = getMemberHue(member.name || '');
                            const initials = getMemberInitials(member.name || '');
                            return (
                              <button key={member.id} type="button" title={member.name}
                                onClick={() => setF('shared_with_ids', isShared
                                  ? form.shared_with_ids.filter(id => id !== memberId)
                                  : [...form.shared_with_ids, memberId]
                                )}
                                className="relative group transition-transform hover:scale-110 focus:outline-none">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${isShared ? 'ring-[3px] ring-amber-500 ring-offset-1' : 'ring-1 ring-slate-200 opacity-60 group-hover:opacity-100'}`}
                                  style={{ background: `hsl(${hue}, 50%, ${isShared ? '85%' : '93%'})`, color: `hsl(${hue}, 45%, 30%)` }}>
                                  {initials}
                                  {(member as any).avatar_url && (
                                    <img src={(member as any).avatar_url} alt={member.name} loading="eager" decoding="async"
                                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                      className="absolute inset-0 w-full h-full rounded-full object-cover" />
                                  )}
                                </div>
                                {isShared && (
                                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center">
                                    <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Observações */}
              <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                <label className={labelCls}>Observações <span className="text-slate-300 font-normal">(opcional)</span></label>
                <textarea value={form.description} onChange={e => setF('description', e.target.value)} rows={2}
                  className="w-full rounded text-slate-900 focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 bg-white px-3 py-2 text-[13px] resize-none placeholder:text-slate-400 transition"
                  placeholder="Anotações, detalhes adicionais..." />
              </div>

            </div>
          )}
        </ModalBody>
      </Modal>

      {/* Modal de cadastro de novo cliente */}
      {showClientForm && (
        <Modal open onClose={() => setShowClientForm(false)} title="Novo Cliente" eyebrow="Clientes" size="xl" zIndex={80}>
          <ModalBody className="p-0">
            <ClientForm
              client={null}
              prefill={clientSearch.trim() ? { full_name: clientSearch.trim() } : null}
              variant="modal"
              onBack={() => setShowClientForm(false)}
              onSave={saved => {
                setAllClients(prev => [saved, ...prev]);
                setForm(prev => ({ ...prev, client_id: saved.id, client_name: '' }));
                setClientSearch('');
                setShowClientForm(false);
              }}
            />
          </ModalBody>
        </Modal>
      )}
    </>
  );
};

export default EventFormModal;
