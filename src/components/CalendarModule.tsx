import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import ptLocale from '@fullcalendar/core/locales/pt-br';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import { Loader2, Calendar as CalendarIcon, X, Filter, FileSpreadsheet, FileText, Plus, History, Users, Briefcase, Phone, MessageCircle, MapPin, ArrowUpRight, User, LayoutList, Printer, ChevronDown, ChevronRight, Check, Search, Link, DollarSign, Lock, Globe, ShieldCheck, AlertTriangle, HelpCircle, UserCheck, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { brandMarkHTML, BRAND_SERIF } from '../constants/brand';
import { getLogoDataUrl } from '../utils/logoBase64';
import { deadlineService } from '../services/deadline.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { calendarService } from '../services/calendar.service';
import { profileService, type Profile } from '../services/profile.service';
import { representativeService } from '../services/representative.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import ClientForm from './ClientForm';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { userNotificationService } from '../services/userNotification.service';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { settingsService, type ModuleResponsibilityConfig } from '../services/settings.service';
import { usePermissions } from '../hooks/usePermissions';
import type { Deadline } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Client } from '../types/client.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { RepresentativeAppointment } from '../types/representative.types';
import RepresentativesPanel from './RepresentativesPanel';
import { Modal, ModalBody, ModuleSkeleton } from './ui';
import { useSyncTick } from '../lib/syncBus';
import { matchesCalendarSearch } from '../utils/calendarSearch.utils';

declare global {
  interface Window {
    jspdf?: any;
  }
}

type EventType = 'deadline' | 'hearing' | 'requirement' | 'payment' | 'meeting' | 'pericia' | 'personal';

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  deadline: 'Prazo',
  hearing: 'Audiência',
  requirement: 'Requerimento',
  payment: 'Pagamento',
  meeting: 'Reunião',
  pericia: 'Perícia',
  personal: 'Pessoal',
};

// Cores canônicas por tipo — usadas na legenda de filtros e nos chips do formulário
// Semântica fixa: audiência=vermelho, prazo=azul, financeiro=verde, requerimento=laranja,
// perícia=roxo, reunião=teal, pessoal=cinza (neutro). Prioridade é tratada à parte (ver .calendar-event--priority-*).
const EVENT_TYPE_COLORS: Record<EventType, { badge: string; checkbox: string }> = {
  deadline:    { badge: 'text-blue-700 bg-blue-50 border-blue-500',        checkbox: 'text-blue-600 focus:ring-blue-500' },
  hearing:     { badge: 'text-red-700 bg-red-50 border-red-500',          checkbox: 'text-red-600 focus:ring-red-500' },
  requirement: { badge: 'text-orange-800 bg-orange-50 border-orange-700', checkbox: 'text-orange-700 focus:ring-orange-600' },
  payment:     { badge: 'text-emerald-700 bg-emerald-50 border-emerald-500', checkbox: 'text-emerald-600 focus:ring-emerald-500' },
  pericia:     { badge: 'text-purple-700 bg-purple-50 border-purple-500', checkbox: 'text-purple-600 focus:ring-purple-500' },
  meeting:     { badge: 'text-teal-700 bg-teal-50 border-teal-500',       checkbox: 'text-teal-600 focus:ring-teal-500' },
  personal:    { badge: 'text-slate-700 bg-slate-200 border-slate-500',   checkbox: 'text-slate-600 focus:ring-slate-500' },
};

type DeletionLogEntry = {
  id: string;
  title: string;
  type: EventType;
  start_at: string;
  deleted_at: string;
  deleted_by: string;
};

const CALENDAR_DELETION_LOG_KEY = 'crm-calendar-deletion-log';

const getProcessHearingStartDateTime = (process: Process) => {
  if (!process.hearing_date) return null;
  return process.hearing_time ? `${process.hearing_date}T${process.hearing_time}` : process.hearing_date;
};

const normalizeHearingTitle = (title?: string | null) => (title || '').trim().toUpperCase();

const toMinuteKey = (value?: string | null) => {
  if (!value) return null;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const day = `${parsed.getDate()}`.padStart(2, '0');
    const hours = `${parsed.getHours()}`.padStart(2, '0');
    const minutes = `${parsed.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  return value.trim().replace(' ', 'T').slice(0, 16);
};

const getPersistedHearingDedupKey = (event: CalendarEvent) => {
  if (event.event_type !== 'hearing' || !event.start_at) return null;

  const processKey = event.process_id ? `process:${event.process_id}` : 'process:none';
  const clientKey = event.client_id ? `client:${event.client_id}` : 'client:none';
  const titleKey = normalizeHearingTitle(event.title);

  return `${event.start_at}::${processKey}::${clientKey}::${titleKey}`;
};

type NewEventForm = {
  title: string;
  date: string;
  time: string;
  type: EventType;
  description: string;
  client_id: string;
  client_name: string;
  responsible_id: string;
  is_private: boolean;
  shared_with_ids: string[];
  // Vínculo com processo ou requerimento (opcional — todos os tipos exceto 'personal')
  process_id: string;
  // Requerimento administrativo (para tipo 'pericia' + requerimentos previdenciários)
  requirement_id: string;
  // Controla qual vínculo está ativo quando tipo = 'pericia'
  pericia_link_type: 'process' | 'requirement';
  // Modalidade: presencial ou online (visível para Audiência, Reunião, Perícia)
  event_mode: 'presencial' | 'online' | '';
  // Vínculo com a intimação de origem (guardião de compromissos) — usado quando
  // o evento é criado a partir de uma sugestão da agenda
  djen_intimation_id?: string | null;
};

interface CalendarModuleProps {
  userName?: string;
  onNavigateToModule?: (params: { module: string; entityId?: string; extra?: Record<string, unknown> }) => void;
  onEditSystemEntity?: (payload: { module: string; entityId: string; data?: any }) => void;
  prefillData?: {
    title?: string;
    description?: string;
    client_id?: string;
    process_code?: string;
    client_name?: string;
  };
  forceCreate?: boolean;
  focusEventId?: string;
  onParamConsumed?: () => void;
}

type SelectedEvent = {
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  extendedProps: {
    type?: string;
    priority?: string;
    status?: string;
    description?: string;
    client?: string;
    data?: any;
    moduleLink?: string;
    clientName?: string;
    clientPhone?: string;
    clientId?: string;
    calendarEventId?: string;
    entityId?: string;
    representativeAppointments?: RepresentativeAppointment[];
    djenStatus?: string;
    djenIntimationId?: string;
  };
};

const CalendarModule: React.FC<CalendarModuleProps> = ({
  userName,
  onNavigateToModule,
  onEditSystemEntity,
  prefillData,
  forceCreate,
  focusEventId,
  onParamConsumed,
}) => {
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const { user } = useAuth();
  const { canView, isAdmin, loading: permissionsLoading } = usePermissions();

  // Mapeia event_type para módulo de permissão
  const canViewEventType = useCallback((eventType: string) => {
    if (permissionsLoading) return true;
    if (isAdmin) return true;
    switch (eventType) {
      case 'payment':
        return canView('financeiro');
      case 'hearing':
        return canView('processos');
      case 'deadline':
        return canView('prazos');
      case 'requirement':
      case 'pericia':
        return canView('requerimentos');
      case 'personal':
        return true;
      case 'meeting':
      case 'task':
      default:
        return canView('agenda');
    }
  }, [permissionsLoading, isAdmin, canView]);

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

  const calendarRef = useRef<FullCalendar | null>(null);
  const [responsibilityConfig, setResponsibilityConfig] = useState<ModuleResponsibilityConfig | null>(null);
  const [eventTypeLabels, setEventTypeLabels] = useState<Record<string, string>>(EVENT_TYPE_LABELS);
  const [eventTypeHexColors, setEventTypeHexColors] = useState<Record<string, string>>({});
  const [inactiveEventTypeKeys, setInactiveEventTypeKeys] = useState<Set<string>>(new Set());
  const [bufferMin, setBufferMin] = useState(0);
  const [eventTypeDurations, setEventTypeDurations] = useState<Record<string, number>>({
    deadline: 60, hearing: 120, requirement: 60, payment: 30, meeting: 60, pericia: 180, personal: 60,
  });

  useEffect(() => {
    settingsService.getResponsibilityConfig().then(cfgs => {
      const cfg = cfgs.find(c => c.module === 'calendar');
      if (cfg) setResponsibilityConfig(cfg);
    }).catch(() => {});
    settingsService.getCalendarModuleConfig().then(cfg => {
      if (cfg.event_types.length > 0) {
        const labels: Record<string, string> = { ...EVENT_TYPE_LABELS };
        const durations: Record<string, number> = { ...eventTypeDurations };
        const hexColors: Record<string, string> = {};
        const inactive = new Set<string>();
        const newFilters: Record<string, boolean> = {};
        cfg.event_types.forEach(et => {
          if (et.active === false) { inactive.add(et.key); return; }
          labels[et.key] = et.label;
          if (et.duration_min > 0) durations[et.key] = et.duration_min;
          if (et.color) hexColors[et.key] = et.color;
          newFilters[et.key] = true;
        });
        setEventTypeLabels(labels);
        setEventTypeHexColors(hexColors);
        setEventTypeDurations(durations);
        setInactiveEventTypeKeys(inactive);
        // Sincronizar viewFilters: adicionar tipos novos da config, manter os canônicos
        setViewFilters(prev => {
          const merged: Record<string, boolean> = { ...prev };
          Object.keys(newFilters).forEach(k => { if (!(k in merged)) merged[k] = true; });
          // Tipos removidos da config ficam mas inativos não aparecem na UI — sem remoção para não perder estado de filtro
          return merged as Record<EventType, boolean>;
        });
      }
      setBufferMin(cfg.buffer_min ?? 0);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [calendarEventsData, setCalendarEventsData] = useState<CalendarEvent[]>([]);
  const [representativeAppointments, setRepresentativeAppointments] = useState<RepresentativeAppointment[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFormInitialClientName, setCreateFormInitialClientName] = useState('');
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [viewFilters, setViewFilters] = useState<Record<EventType, boolean>>({
    deadline: true,
    hearing: true,
    requirement: true,
    payment: true,
    meeting: true,
    pericia: true,
    personal: true,
  });
  const [newEventForm, setNewEventForm] = useState<NewEventForm>({
    title: '',
    date: '',
    time: '',
    type: 'meeting',
    description: '',
    client_id: '',
    client_name: '',
    responsible_id: '',
    is_private: false,
    shared_with_ids: [],
    process_id: '',
    requirement_id: '',
    pericia_link_type: 'process',
    event_mode: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string; persistent?: boolean } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isDeletionLogOpen, setIsDeletionLogOpen] = useState(false);
  const [deletionLog, setDeletionLog] = useState<DeletionLogEntry[]>([]);
  const [exportPeriod, setExportPeriod] = useState<'7' | '15' | '30' | '60' | 'custom'>('30');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportFormat, setExportFormat] = useState<'excel' | 'pdf'>('excel');
  const [exportPrivate, setExportPrivate] = useState(false);
  const [showTodayPanel, setShowTodayPanel] = useState(true);
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarView, setCalendarView] = useState<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'>('dayGridMonth');
  const [isRepresentativesPanelOpen, setIsRepresentativesPanelOpen] = useState(false);

  // ── Cronograma ───────────────────────────────────────────────────
  const [showCronograma, setShowCronograma] = useState(false);
  const [calendarResponsibleFilter, setCalendarResponsibleFilter] = useState<'todos' | 'mim' | string>('todos');
  const [showResponsiblePicker, setShowResponsiblePicker] = useState(false);
  const [responsiblePickerPos, setResponsiblePickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const responsiblePickerRef = useRef<HTMLDivElement>(null);
  const responsibleBtnRef = useRef<HTMLButtonElement>(null);
  const responsibleDropdownRef = useRef<HTMLDivElement>(null);
  const [cronogramaPeriod, setCronogramaPeriod] = useState<'semana' | 'proxima' | 'mes' | 'custom'>('semana');
  const [cronogramaOnlyMine, setCronogramaOnlyMine] = useState(false);
  const [cronogramaStart, setCronogramaStart] = useState('');
  const [cronogramaEnd, setCronogramaEnd] = useState('');

  // ── Busca global ────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const defaultFilterSet = useRef(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientSearchResults, setClientSearchResults] = useState<Client[]>([]);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  const [isClientFormOpen, setIsClientFormOpen] = useState(false);
  const linkedClient = useMemo(
    () => clients.find((client) => client.id === newEventForm.client_id) || null,
    [clients, newEventForm.client_id],
  );

  const representativeAppointmentsMap = useMemo(() => {
    const map = new Map<string, RepresentativeAppointment[]>();
    representativeAppointments.forEach((appointment) => {
      if (!appointment.calendar_event_id) return;
      const current = map.get(appointment.calendar_event_id) || [];
      current.push(appointment);
      map.set(appointment.calendar_event_id, current);
    });
    return map;
  }, [representativeAppointments]);

  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    clients.forEach((client) => {
      if (client.id) {
        map.set(client.id, client);
      }
    });
    return map;
  }, [clients]);

  const focusEventConsumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showResponsiblePicker) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (responsiblePickerRef.current?.contains(t)) return;
      if (responsibleDropdownRef.current?.contains(t)) return;
      setShowResponsiblePicker(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showResponsiblePicker]);

  // Busca de clientes no campo unificado
  useEffect(() => {
    const term = clientSearchTerm.trim().toLowerCase();
    if (term.length < 1) { setClientSearchResults([]); return; }
    const results = clients.filter(c =>
      c.full_name?.toLowerCase().includes(term) || c.cpf_cnpj?.includes(term)
    ).slice(0, 6);
    setClientSearchResults(results);
  }, [clientSearchTerm, clients]);

  useEffect(() => {
    if (!clientSearchOpen) return;
    const handler = (e: MouseEvent) => {
      if (!clientSearchRef.current?.contains(e.target as Node)) {
        setClientSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [clientSearchOpen]);

  useEffect(() => {
    if (!focusEventId) return;
    if (focusEventConsumedRef.current === focusEventId) return;
    if (calendarEventsData.length === 0) return;

    focusEventConsumedRef.current = focusEventId;
    const event = calendarEventsData.find((e) => e.id === focusEventId) || null;
    if (!event) {
      if (onParamConsumed) onParamConsumed();
      return;
    }

    const startAt = event.start_at;
    const endAt = event.end_at || undefined;
    const hasTime =
      Boolean(startAt) &&
      typeof startAt === 'string' &&
      startAt.includes('T') &&
      startAt.slice(11, 16) !== '00:00';

    const moduleLink =
      event.event_type === 'deadline'
        ? 'prazos'
        : event.event_type === 'hearing'
        ? 'processos'
        : event.event_type === 'requirement' || event.event_type === 'pericia'
        ? 'requerimentos'
        : event.event_type === 'payment'
        ? 'financeiro'
        : undefined;

    setSelectedEvent({
      title: event.title,
      start: startAt,
      end: endAt,
      allDay: !hasTime,
      extendedProps: {
        type: event.event_type,
        status: event.status,
        description: event.description ?? undefined,
        data: event,
        moduleLink,
        clientName: event.client_id ? clientMap.get(event.client_id)?.full_name : undefined,
        clientPhone: event.client_id ? (clientMap.get(event.client_id)?.mobile || clientMap.get(event.client_id)?.phone) : undefined,
        clientId: event.client_id ?? undefined,
        calendarEventId: event.id,
        representativeAppointments: representativeAppointmentsMap.get(event.id) || [],
      },
    });

    if (onParamConsumed) onParamConsumed();
  }, [calendarEventsData, clientMap, focusEventId, onParamConsumed, representativeAppointmentsMap]);

  const currentMonthName = useMemo(() => {
    return calendarTitle || new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }, [calendarTitle]);

  useEffect(() => {
    if (!feedback || feedback.persistent) return;
    const timeout = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  // Calcular estatísticas
  const stats = useMemo(() => {
    // Usar timezone de Cuiabá (UTC-4)
    const now = new Date();
    const cuiabaOffset = -4 * 60; // UTC-4 em minutos
    const localOffset = now.getTimezoneOffset();
    const diff = (cuiabaOffset - localOffset) * 60 * 1000;
    
    const today = new Date(now.getTime() + diff);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    // Mês atual (do dia 1 até o último dia do mês)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let totalCount = 0;

    // Prazos
    deadlines.forEach((d) => {
      if (d.status === 'cumprido' || d.status === 'cancelado') return;
      if (!d.due_date) return;
      const dueDate = new Date(d.due_date);
      totalCount++;
      if (dueDate >= today && dueDate < tomorrow) todayCount++;
      if (dueDate >= today && dueDate < weekEnd) weekCount++;
      if (dueDate >= monthStart && dueDate <= monthEnd) monthCount++;
    });

    // Audiências
    processes.forEach((p) => {
      if (!p.hearing_scheduled || !p.hearing_date) return;
      const hearingDate = new Date(p.hearing_date);
      totalCount++;
      if (hearingDate >= today && hearingDate < tomorrow) todayCount++;
      if (hearingDate >= today && hearingDate < weekEnd) weekCount++;
      if (hearingDate >= monthStart && hearingDate <= monthEnd) monthCount++;
    });

    // Requerimentos
    requirements.forEach((r) => {
      if (r.status !== 'em_exigencia' || !r.exigency_due_date) return;
      const exigencyDate = new Date(r.exigency_due_date);
      totalCount++;
      if (exigencyDate >= today && exigencyDate < tomorrow) todayCount++;
      if (exigencyDate >= today && exigencyDate < weekEnd) weekCount++;
      if (exigencyDate >= monthStart && exigencyDate <= monthEnd) monthCount++;
    });

    // Eventos do calendário
    calendarEventsData.forEach((e) => {
      if (!e.start_at) return;
      const eventDate = new Date(e.start_at);
      totalCount++;
      if (eventDate >= today && eventDate < tomorrow) todayCount++;
      if (eventDate >= today && eventDate < weekEnd) weekCount++;
      if (eventDate >= monthStart && eventDate <= monthEnd) monthCount++;
    });

    return { todayCount, weekCount, monthCount, totalCount };
  }, [deadlines, processes, requirements, calendarEventsData]);

  const openEventForm = useCallback(
    (initialValues?: Partial<NewEventForm>, editingId: string | null = null) => {
      const merged: NewEventForm = {
        title: '',
        date: '',
        time: '',
        type: 'meeting',
        description: '',
        client_id: '',
        client_name: '',
        responsible_id: (() => {
          if (editingId) return '';
          if (responsibilityConfig?.default_mode === 'creator') return user?.id ?? '';
          if (responsibilityConfig?.default_mode === 'single' && responsibilityConfig.single_member_id)
            return responsibilityConfig.single_member_id;
          return '';
        })(),
        is_private: false,
        shared_with_ids: [],
        process_id: '',
        requirement_id: '',
        pericia_link_type: 'process',
        event_mode: '',
        djen_intimation_id: null,
        ...initialValues,
      };

      setNewEventForm(merged);
      setEditingEventId(editingId);
      setIsCreateModalOpen(true);
    },
    [responsibilityConfig, user],
  );

  const formatDateInputValue = useCallback((date: Date) => {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, []);

  const formatTimeInputValue = useCallback((date: Date) => {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, []);

  const mapPriorityClass = (priority: Deadline['priority']) => {
    switch (priority) {
      case 'urgente':
        return 'calendar-event--priority-urgent';
      case 'alta':
        return 'calendar-event--priority-high';
      case 'baixa':
        return 'calendar-event--priority-low';
      default:
        return 'calendar-event--priority-medium';
    }
  };

  const moduleLabels: Record<string, string> = useMemo(
    () => ({
      deadlines: 'Prazos',
      cases: 'Processos',
      requirements: 'Requerimentos',
      payments: 'Financeiro',
      meetings: 'Reuniões',
    }),
    [],
  );

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return '';
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const hour = date.getHours().toString().padStart(2, '0');
      const minute = date.getMinutes().toString().padStart(2, '0');
      return `${day}/${month}/${year} às ${hour}:${minute}`;
    } catch {
      return '';
    }
  }, []);

  const toLogIsoFromLocal = useCallback((dateOnly: string, timeOnly?: string) => {
    if (!dateOnly) return '';
    const time = timeOnly?.trim() ? timeOnly.trim() : '00:00';
    const dt = new Date(`${dateOnly}T${time}:00`);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CALENDAR_DELETION_LOG_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed
          .filter((item) => item && typeof item === 'object')
          .slice(0, 200)
          .map((item) => ({
            id: String((item as any).id ?? ''),
            title: String((item as any).title ?? ''),
            type: String((item as any).type ?? 'meeting') as EventType,
            start_at: String((item as any).start_at ?? ''),
            deleted_at: String((item as any).deleted_at ?? ''),
            deleted_by: String((item as any).deleted_by ?? ''),
          }))
          .filter((item) => Boolean(item.id) && Boolean(item.deleted_at));

        setDeletionLog(valid);
      }
    } catch {
      setDeletionLog([]);
    }
  }, []);

  const persistDeletionLog = useCallback((next: DeletionLogEntry[]) => {
    try {
      localStorage.setItem(CALENDAR_DELETION_LOG_KEY, JSON.stringify(next.slice(0, 200)));
    } catch {
      // ignore
    }
  }, []);

  const addDeletionLogEntry = useCallback(
    (entry: DeletionLogEntry) => {
      setDeletionLog((prev) => {
        const next = [entry, ...prev].slice(0, 200);
        persistDeletionLog(next);
        return next;
      });
    },
    [persistDeletionLog],
  );


  const selectedEventModuleLabel = useMemo(() => {
    if (!selectedEvent?.extendedProps?.moduleLink) return null;
    const moduleKey = selectedEvent.extendedProps.moduleLink;
    return moduleLabels[moduleKey] ?? moduleKey;
  }, [moduleLabels, selectedEvent]);

  const selectedEventProcess = useMemo(() => {
    if (selectedEvent?.extendedProps?.moduleLink !== 'processos' || !selectedEvent.extendedProps.entityId) {
      return null;
    }

    return processes.find((process) => process.id === selectedEvent.extendedProps.entityId) || null;
  }, [processes, selectedEvent]);

  const [selectedEventProcessOrgao, setSelectedEventProcessOrgao] = useState<string | null>(null);

  // DJEN: dados da intimação que confirmou/divergiu o evento
  const [selectedEventDjenData, setSelectedEventDjenData] = useState<{
    numero_processo: string | null;
    nome_orgao: string | null;
    sigla_tribunal: string | null;
    texto: string | null;
    data_disponibilizacao: string | null;
    datesFound: string[];
    timesFound: string[];
    detectedMode: 'online' | 'presencial' | null;
  } | null>(null);

  // Status DJEN das audiências VIRTUAIS (derivadas de processes.hearing_scheduled,
  // que não existem em calendar_events). Read-only: apenas alimenta o selo de
  // confirmação na UI — não cria nem altera nenhum compromisso. A regra de match
  // vive no banco (fn_djen_hearing_statuses → fn_match_djen_for_process).
  const [hearingDjenMap, setHearingDjenMap] = useState<Map<string, { status: string; intimationId: string | null }>>(new Map());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_djen_hearing_statuses');
        if (error || !data || !active) return;
        const m = new Map<string, { status: string; intimationId: string | null }>();
        for (const row of data as Array<{ process_id: string; djen_status: string; djen_intimation_id: string | null }>) {
          m.set(row.process_id, { status: row.djen_status, intimationId: row.djen_intimation_id });
        }
        setHearingDjenMap(m);
      } catch { /* silencioso: sem status, a audiência apenas mantém o ponto cinza */ }
    })();
    return () => { active = false; };
  }, [processes]);

  useEffect(() => {
    const intimationId = selectedEvent?.extendedProps?.djenIntimationId;
    if (!intimationId) { setSelectedEventDjenData(null); return; }

    const fetchDjenData = async () => {
      try {
        const { data, error } = await supabase
          .from('djen_comunicacoes')
          .select('numero_processo, nome_orgao, sigla_tribunal, texto, data_disponibilizacao')
          .eq('id', intimationId)
          .maybeSingle();

        if (error || !data) { setSelectedEventDjenData(null); return; }

        const texto = data.texto ?? '';

        // Extrair datas DD/MM/YYYY — apenas ANCORADAS a contexto de audiência/
        // perícia, para não capturar datas avulsas do corpo (ex.: "voo marcado
        // para o dia 31/07/2026" ou citação de jurisprudência). Espelha
        // fn_extract_hearing_dates no banco.
        const kw = 'audi[eê]ncia|per[ií]cia|per[ií]cial|sess[aã]o\\s+de\\s+instru|julgamento\\s+oral|exame\\s+m[ée]dico|avalia[cç][aã]o\\s+m[ée]dica';
        const schedDates = [
          // (A) palavra-chave de audiência/perícia -> data (proximidade 70 chars)
          ...[...texto.matchAll(new RegExp(`(?:${kw})[\\s\\S]{0,70}(\\d{2}\\/\\d{2}\\/\\d{4})`, 'gi'))].map((m) => m[1]),
          // (A') data -> palavra-chave (proximidade 70 chars)
          ...[...texto.matchAll(new RegExp(`(\\d{2}\\/\\d{2}\\/\\d{4})[\\s\\S]{0,70}(?:${kw})`, 'gi'))].map((m) => m[1]),
          // (B) bloco estruturado de pauta DJEN: "Data: <data> ... Hora:"
          ...[...texto.matchAll(/data[\s\S]{0,15}(\d{2}\/\d{2}\/\d{4})[\s\S]{0,12}hora/gi)].map((m) => m[1]),
        ];
        const allDates = [...texto.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map((m) => m[1]);
        // Se nada em contexto de agendamento, cai para todas (formato atípico) — defensivo.
        const uniqueDates = [...new Set(schedDates.length ? schedDates : allDates)];

        // Extrair horários: "14:00", "às 14h30", "14h30min", "14:00h"
        const timeRaw = [...texto.matchAll(/(\d{1,2})[h:](\d{2})(?:min)?(?:h)?/gi)].map((m) => {
          const h = m[1].padStart(2, '0');
          const min = m[2].padStart(2, '0');
          return `${h}:${min}`;
        });
        const uniqueTimes = [...new Set(timeRaw)];

        // Detectar modalidade
        const textLower = texto.toLowerCase();
        const isOnline = /videoconfer[eê]ncia|virtual|zoom|teams|microsoft\s+teams|online|teleaudiência|plataforma/.test(textLower);
        const isPresencial = /presencial|in\s+loco/.test(textLower);
        const detectedMode: 'online' | 'presencial' | null =
          isOnline ? 'online' : isPresencial ? 'presencial' : null;

        setSelectedEventDjenData({
          numero_processo: data.numero_processo,
          nome_orgao: data.nome_orgao,
          sigla_tribunal: data.sigla_tribunal,
          texto,
          data_disponibilizacao: data.data_disponibilizacao,
          datesFound: uniqueDates,
          timesFound: uniqueTimes,
          detectedMode,
        });
      } catch { setSelectedEventDjenData(null); }
    };

    fetchDjenData();
  }, [selectedEvent?.extendedProps?.djenIntimationId]);

  useEffect(() => {
    if (selectedEvent?.extendedProps?.moduleLink !== 'processos' || !selectedEvent.extendedProps.entityId) {
      setSelectedEventProcessOrgao(null);
      return;
    }

    const processId = selectedEvent.extendedProps.entityId;
    const process = processes.find((p) => p.id === processId);

    // Se o processo já tem court, não precisa buscar
    if (process?.court) {
      setSelectedEventProcessOrgao(null);
      return;
    }

    // Buscar última intimação do processo para pegar o órgão
    const fetchOrgao = async () => {
      try {
        const { data, error } = await supabase
          .from('djen_comunicacoes')
          .select('nome_orgao')
          .eq('process_id', processId)
          .order('data_disponibilizacao', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data?.nome_orgao) {
          setSelectedEventProcessOrgao(data.nome_orgao);
        } else {
          setSelectedEventProcessOrgao(null);
        }
      } catch {
        setSelectedEventProcessOrgao(null);
      }
    };

    fetchOrgao();
  }, [processes, selectedEvent]);

  const selectedEventDataDetails = useMemo(() => {
    if (!selectedEvent?.extendedProps?.data) return [] as { label: string; value: string; secondaryValue?: string }[];
    const data = selectedEvent.extendedProps.data as Record<string, any>;
    const details: { label: string; value: string; secondaryValue?: string }[] = [];

    // Para eventos customizados (calendar_events), process_code não existe em `data`
    // — buscamos no processo encontrado via entityId/selectedEventProcess.
    const linkedProcess = selectedEventProcess
      || processes.find((p) => p.id === (data as any).process_id);
    const processCode = data.process_code ?? linkedProcess?.process_code;
    const processCourt = data.court
      || linkedProcess?.court
      || selectedEventProcessOrgao
      || data.forum
      || data.vara
      || data.comarca;

    const pushDetail = (label: string, value?: any, formatter?: (value: any) => string, secondaryValue?: string) => {
      if (value === undefined || value === null || value === '') return;
      const formatted = formatter ? formatter(value) : String(value);
      details.push({ label, value: formatted, secondaryValue });
    };

    pushDetail('Processo', processCode, undefined, processCourt);
    pushDetail('Protocolo', data.protocol);
    pushDetail('Responsável', data.responsible_lawyer);
    pushDetail('Beneficiário', data.beneficiary);
    pushDetail('Prazo original', data.due_date, formatDateTime);
    pushDetail('Agendado para', data.hearing_date, (date: string) => {
      const combined = data.hearing_time ? `${date}T${data.hearing_time}` : date;
      return formatDateTime(combined);
    });

    return details;
  }, [formatDateTime, selectedEvent, selectedEventProcess, selectedEventProcessOrgao]);

  const selectedEventRepresentativeAppointments = useMemo(() => {
    return selectedEvent?.extendedProps?.representativeAppointments || [];
  }, [selectedEvent]);

  const buildWhatsAppUrl = useCallback((phone?: string | null) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;
    return `https://wa.me/${normalized}`;
  }, []);

  const canCreateLinkedEvent = Boolean(
    selectedEvent &&
      !selectedEvent.extendedProps.calendarEventId &&
      !selectedEvent.extendedProps.moduleLink,
  );
  const showEditButton = Boolean(
    selectedEvent &&
      (selectedEvent.extendedProps.calendarEventId ||
        (selectedEvent.extendedProps.moduleLink &&
          selectedEvent.extendedProps.entityId &&
          onEditSystemEntity)),
  );
  const editButtonLabel = selectedEvent
    ? selectedEvent.extendedProps.calendarEventId
      ? 'Editar compromisso'
      : selectedEventModuleLabel
      ? `Editar ${selectedEventModuleLabel}`
      : 'Editar registro'
    : 'Editar';

  useEffect(() => {
    const channel = supabase
      .channel('calendar-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => {
        calendarService.listEvents().then(setCalendarEventsData).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deadlines' }, () => {
        deadlineService.listDeadlines().then(setDeadlines).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'representative_appointments' }, () => {
        representativeService.listAppointments().then(setRepresentativeAppointments).catch(() => {});
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const calendarSyncTick = useSyncTick(['calendar', 'deadlines']);

  useEffect(() => {
    loadData();
    loadClients();
    profileService.listMembers().then(setMembers).catch(() => {});
  }, [calendarSyncTick]);

  useEffect(() => {
    if (defaultFilterSet.current || !user?.id || members.length === 0) return;
    defaultFilterSet.current = true;
    const myProfile = members.find(m => m.user_id === user.id);
    const isAdmin = (myProfile?.role || '').toLowerCase().includes('admin');
    if (!isAdmin) {
      setCalendarResponsibleFilter('mim');
    }
  }, [members, user]);

  useEffect(() => {
    if (forceCreate && !isCreateModalOpen) {
      const initialValues: Partial<NewEventForm> = {};
      
      if (prefillData) {
        if (prefillData.title) initialValues.title = prefillData.title;
        if (prefillData.description) initialValues.description = prefillData.description;
        if (prefillData.client_id) initialValues.client_id = prefillData.client_id;
        if (prefillData.client_name) setCreateFormInitialClientName(prefillData.client_name);

        // Define data/hora para hoje
        const now = new Date();
        initialValues.date = formatDateInputValue(now);
        initialValues.time = formatTimeInputValue(now);
      }

      openEventForm(initialValues);
      
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, isCreateModalOpen, prefillData, onParamConsumed, openEventForm, formatDateInputValue, formatTimeInputValue]);

  const loadClients = async () => {
    try {
      const data = await clientService.listClients();
      setClients(data);
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [deadlinesData, processesData, requirementsData, calendarEventsRemote, representativeAppointmentsData] = await Promise.all([
        deadlineService.listDeadlines(),
        processService.listProcesses(),
        requirementService.listRequirements(),
        calendarService.listEvents(),
        representativeService.listAppointments(),
      ]);

      setDeadlines(deadlinesData);
      setProcesses(processesData);
      setRequirements(requirementsData);
      setCalendarEventsData(calendarEventsRemote);
      setRepresentativeAppointments(representativeAppointmentsData);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados do calendário');
    } finally {
      setLoading(false);
    }
  };

  const systemEvents: EventInput[] = useMemo(() => {
    const calendarEvents: EventInput[] = [];
    const hasPersistedHearingEvent = (process: Process, startDateTime: string) => {
      const processClient = process.client_id ? clientMap.get(process.client_id) : null;
      const modeLabel = process.hearing_mode ? process.hearing_mode.toUpperCase() : 'SEM MODO';
      const clientLabel = (processClient?.full_name || 'Sem cliente').toUpperCase();
      const processCodeTitle = `AUDIÊNCIA ${process.hearing_mode === 'online' ? 'POR VÍDEO' : 'PRESENCIAL'} - ${process.process_code || 'PROCESSO'}`.toUpperCase();
      const legacyTitle = `AUDIÊNCIA - ${modeLabel} - ${clientLabel}`.toUpperCase();
      const processMinuteKey = toMinuteKey(startDateTime);

      return calendarEventsData.some((event) => {
        if (event.event_type !== 'hearing' || !event.start_at) return false;

        if (event.process_id && event.process_id === process.id) return true;

        if (toMinuteKey(event.start_at) !== processMinuteKey) return false;

        const normalizedTitle = (event.title || '').trim().toUpperCase();
        const sameClient = process.client_id ? event.client_id === process.client_id : true;

        return sameClient && (normalizedTitle === processCodeTitle || normalizedTitle === legacyTitle);
      });
    };

    // Prazos
    deadlines
      .forEach((deadline) => {
        if (!deadline.due_date) return;
        if (deadline.status === 'cumprido') return;
        if (deadline.status === 'cancelado') return;

        const relatedClient = deadline.client_id ? clientMap.get(deadline.client_id) : null;
        const clientLabel = (relatedClient?.full_name || 'Sem cliente').toUpperCase();
        const baseTitle = (deadline.title || 'Prazo').toUpperCase();
        const formattedTitle = `${baseTitle} - ${clientLabel}`;
        const startDate = deadline.due_date.includes('T')
          ? deadline.due_date.split('T')[0]
          : deadline.due_date;

        calendarEvents.push({
          id: `deadline-${deadline.id}`,
          title: formattedTitle,
          start: startDate,
          allDay: true,
          classNames: ['calendar-event', 'calendar-event--type-deadline', mapPriorityClass(deadline.priority)],
          extendedProps: {
            type: 'deadline',
            priority: deadline.priority,
            status: deadline.status,
            description: deadline.description,
            data: deadline,
            moduleLink: 'prazos',
            clientName: relatedClient?.full_name,
            clientPhone: relatedClient?.mobile || relatedClient?.phone,
            clientId: deadline.client_id ?? undefined,
            entityId: deadline.id,
          },
        });
      });

    // Audiências
    processes
      .filter((p) => p.hearing_scheduled && p.hearing_date)
      .forEach((process) => {
        const startDateTime = getProcessHearingStartDateTime(process);
        if (!startDateTime) return;
        if (hasPersistedHearingEvent(process, startDateTime)) return;

        const relatedClient = process.client_id ? clientMap.get(process.client_id) : null;
        const clientLabel = (relatedClient?.full_name || 'Sem cliente').toUpperCase();
        const modeLabel = process.hearing_mode ? process.hearing_mode.toUpperCase() : 'SEM MODO';
        const formattedTitle = `AUDIÊNCIA - ${modeLabel} - ${clientLabel}`;

        calendarEvents.push({
          id: `hearing-${process.id}`,
          title: formattedTitle,
          start: startDateTime!,
          classNames: ['calendar-event', 'calendar-event--type-hearing'],
          extendedProps: {
            type: 'hearing',
            description: `Processo: ${process.process_code}`,
            data: process,
            moduleLink: 'processos',
            clientName: relatedClient?.full_name,
            clientPhone: relatedClient?.mobile || relatedClient?.phone,
            clientId: process.client_id ?? undefined,
            entityId: process.id,
            // Confirmação DJEN (read-only) vinda de fn_djen_hearing_statuses.
            djenStatus: hearingDjenMap.get(process.id)?.status,
            djenIntimationId: hearingDjenMap.get(process.id)?.intimationId ?? undefined,
          },
        });
      });

    // Requerimentos com prazo de exigência
    requirements
      .filter((r) => r.status === 'em_exigencia' && r.exigency_due_date)
      .forEach((requirement) => {
        if (!requirement.exigency_due_date) return;

        const clientLabel = (requirement.beneficiary || 'Sem beneficiário').toUpperCase();
        const formattedTitle = `REQUERIMENTO - ${clientLabel}`;
        const startDate = requirement.exigency_due_date.includes('T')
          ? requirement.exigency_due_date.split('T')[0]
          : requirement.exigency_due_date;

        calendarEvents.push({
          id: `requirement-${requirement.id}`,
          title: formattedTitle,
          start: startDate,
          allDay: true,
          classNames: ['calendar-event', 'calendar-event--type-requirement'],
          extendedProps: {
            type: 'requirement',
            description: `Protocolo: ${requirement.protocol || 'N/A'}`,
            data: requirement,
            moduleLink: 'requerimentos',
            clientName: requirement.beneficiary,
            clientPhone: requirement.phone || undefined,
            entityId: requirement.id,
          },
        });
      });

    return calendarEvents;
  }, [deadlines, processes, requirements, clientMap, calendarEventsData, hearingDjenMap]);

  // Eventos personalizados vindos da tabela calendar_events
  const customEvents = useMemo(() => {
    const visibleEvents = calendarEventsData.filter(item => {
      if (!item.is_private) return true;
      if (!user?.id) return false;
      if (item.user_id === user.id) return true;
      if (item.shared_with_ids && item.shared_with_ids.includes(user.id)) return true;
      return false;
    });
    const dedupedEvents = visibleEvents.reduce<CalendarEvent[]>((acc, item) => {
      const dedupKey = getPersistedHearingDedupKey(item);

      if (!dedupKey) {
        acc.push(item);
        return acc;
      }

      const existingIndex = acc.findIndex((candidate) => getPersistedHearingDedupKey(candidate) === dedupKey);
      if (existingIndex === -1) {
        acc.push(item);
        return acc;
      }

      const existingItem = acc[existingIndex];
      const existingLinkedAppointments = representativeAppointmentsMap.get(existingItem.id) || [];
      const nextLinkedAppointments = representativeAppointmentsMap.get(item.id) || [];

      const shouldReplace = nextLinkedAppointments.length > existingLinkedAppointments.length
        || (nextLinkedAppointments.length === existingLinkedAppointments.length
          && new Date(item.updated_at).getTime() > new Date(existingItem.updated_at).getTime());

      if (shouldReplace) {
        acc[existingIndex] = item;
      }

      return acc;
    }, []);

    return dedupedEvents.map((item) => {
      const relatedClient = item.client_id ? clientMap.get(item.client_id) : null;
      const classNames = ['calendar-event', `calendar-chip--${item.event_type}`];
      let hasTime: boolean;
      if (!item.start_at.includes('T')) {
        hasTime = false; // string apenas com data, sem hora
      } else {
        const sd = new Date(item.start_at);
        hasTime = isNaN(sd.getTime()) ? false : !(sd.getHours() === 0 && sd.getMinutes() === 0);
      }
      const linkedRepresentativeAppointments = representativeAppointmentsMap.get(item.id) || [];
      // Nome do cliente: cadastrado > nome livre digitado
      const resolvedClientName = relatedClient?.full_name || item.client_name || undefined;

      return {
        id: `calendar-${item.id}`,
        title: item.title,
        start: item.start_at,
        allDay: !hasTime,
        classNames,
        extendedProps: {
          type: item.event_type,
          description: item.description,
          status: item.status,
          data: item,
          // process_id tem prioridade: qualquer tipo de evento vinculado a um processo
          // aponta para o módulo Processos, independentemente do event_type.
          moduleLink:
            item.process_id
              ? 'processos'
              : item.event_type === 'deadline'
              ? 'prazos'
              : item.event_type === 'hearing'
              ? 'processos'
              : item.event_type === 'requirement'
              ? 'requerimentos'
              : undefined,
          // entityId conecta o evento ao registro do módulo (necessário para
          // selectedEventProcess, "Ir para módulo" e exibição de detalhes).
          entityId: item.process_id ?? item.deadline_id ?? item.requirement_id ?? undefined,
          clientName: resolvedClientName,
          clientPhone: relatedClient?.mobile || relatedClient?.phone,
          clientId: item.client_id ?? undefined,
          calendarEventId: item.id,
          djenStatus: item.djen_status ?? undefined,
          djenIntimationId: item.djen_intimation_id ?? undefined,
          representativeAppointments: linkedRepresentativeAppointments,
        },
      } as EventInput;
    });
  }, [calendarEventsData, clientMap, representativeAppointmentsMap, user]);

  // memberMap: user_id → name (usado em filtros e cronograma)
  const memberMap = useMemo(() => {
    const m = new Map<string, string>();
    members.forEach(p => { if (p.user_id) m.set(p.user_id, p.name || p.email || ''); });
    return m;
  }, [members]);

  // userIdToProfileId: user_id → profile.id
  // Necessário porque deadline.responsible_id armazena profile.id, não user_id
  const userIdToProfileId = useMemo(() => {
    const m = new Map<string, string>();
    members.forEach(p => { if (p.user_id) m.set(p.user_id, p.id); });
    return m;
  }, [members]);

  // profileIdToName: profile.id → name (para prazos que usam profile.id em responsible_id)
  const profileIdToName = useMemo(() => {
    const m = new Map<string, string>();
    members.forEach(p => { m.set(p.id, p.name || p.email || ''); });
    return m;
  }, [members]);

  const allEvents = useMemo(() => {
    const combined = [...systemEvents, ...customEvents];
    return combined
      .filter((event) => {
        const eventType = event.extendedProps?.type as EventType | undefined;
        if (!eventType) return true;
        if (!canViewEventType(eventType)) return false;
        if (!(viewFilters[eventType] ?? true)) return false;
        // Filtro de responsável
        if (calendarResponsibleFilter !== 'todos') {
          const targetId = calendarResponsibleFilter === 'mim' ? user?.id : calendarResponsibleFilter;
          if (targetId) {
            const raw = event.extendedProps?.data as any;
            // targetProfileId: profile.id do usuário alvo (prazos usam profile.id em responsible_id)
            const targetProfileId = userIdToProfileId.get(targetId) || '';
            const byId =
              (raw?.responsible_id && (raw.responsible_id === targetId || raw.responsible_id === targetProfileId)) ||
              (raw?.user_id && raw.user_id === targetId);
            const targetName = memberMap.get(targetId) || '';
            const byName = targetName && raw?.responsible_lawyer &&
              (raw.responsible_lawyer as string).toLowerCase().includes(targetName.split(' ')[0].toLowerCase());
            const byShared = Array.isArray(raw?.shared_with_ids) && raw.shared_with_ids.includes(targetId);
            if (!byId && !byName && !byShared) return false;
          }
        }
        return true;
      })
      .map((event) => ({
        ...event,
        extendedProps: { ...(event.extendedProps as any), _hasTime: event.allDay !== true },
      }));
  }, [systemEvents, customEvents, viewFilters, canViewEventType, calendarResponsibleFilter, user, memberMap, userIdToProfileId]);

  // ── Cronograma: faixa de datas ──────────────────────────────────
  const cronogramaRange = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=dom, 1=seg...
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    if (cronogramaPeriod === 'semana') {
      const end = new Date(monday);
      end.setDate(monday.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start: monday, end };
    }
    if (cronogramaPeriod === 'proxima') {
      const start = new Date(monday);
      start.setDate(monday.getDate() + 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (cronogramaPeriod === 'mes') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    // custom
    const start = cronogramaStart ? new Date(cronogramaStart + 'T00:00:00') : monday;
    const end   = cronogramaEnd   ? new Date(cronogramaEnd   + 'T23:59:59') : new Date(monday.getTime() + 6 * 86400000);
    return { start, end };
  }, [cronogramaPeriod, cronogramaStart, cronogramaEnd]);


  const getResponsavel = useCallback((event: EventInput): string => {
    const d = event.extendedProps?.data as any;
    if (!d) return '';
    // Processo/audiência
    if (d.responsible_lawyer) return d.responsible_lawyer;
    // Deadline: responsible_id é profile.id; tenta profileIdToName primeiro, depois memberMap
    if (d.responsible_id) {
      return profileIdToName.get(d.responsible_id) || memberMap.get(d.responsible_id) || '';
    }
    // Evento manual: user_id é auth user_id
    if (d.user_id) return memberMap.get(d.user_id) || '';
    return '';
  }, [memberMap, profileIdToName]);

  // ── Busca global: resultados do modal (hoje+futuros, ordenados) ─
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchModalResults = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return allEvents
      .filter((ev) => {
        const startStr = typeof ev.start === 'string' ? ev.start : '';
        if (!startStr) return false;
        const d = new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00');
        if (d < todayStart) return false;
        if (!deferredSearchQuery.trim()) return false; // sem query = sem resultados
        return matchesCalendarSearch(ev, deferredSearchQuery, getResponsavel);
      })
      .sort((a, b) => {
        const as = typeof a.start === 'string' ? a.start : '';
        const bs = typeof b.start === 'string' ? b.start : '';
        return as.localeCompare(bs);
      })
      .slice(0, 60);
  }, [allEvents, deferredSearchQuery, getResponsavel]);

  // ── Cronograma: eventos filtrados e agrupados por dia ───────────
  const cronogramaByDay = useMemo(() => {
    const { start, end } = cronogramaRange;

    const filtered = allEvents.filter(ev => {
      const startStr = typeof ev.start === 'string' ? ev.start : '';
      if (!startStr) return false;
      const d = new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00');
      if (d < start || d > end) return false;
      // Respeita os filtros de tipo do calendário
      const evType = (ev.extendedProps?.type as EventType) || 'meeting';
      if (!(viewFilters[evType] ?? true)) return false;
      if (cronogramaOnlyMine && user) {
        const raw = ev.extendedProps?.data as any;
        const isResponsible =
          (raw?.responsible_id && raw.responsible_id === user.id) ||
          (raw?.user_id && raw.user_id === user.id);
        const myName = members.find(m => m.user_id === user.id)?.name || '';
        const byName = myName && raw?.responsible_lawyer && raw.responsible_lawyer.toLowerCase().includes(myName.split(' ')[0].toLowerCase());
        if (!isResponsible && !byName) return false;
      }
      return true;
    });

    // Ordenar por data/hora
    filtered.sort((a, b) => {
      const aStr = (typeof a.start === 'string' ? a.start : '') || '';
      const bStr = (typeof b.start === 'string' ? b.start : '') || '';
      return aStr.localeCompare(bStr);
    });

    // Agrupar por dia
    const groups = new Map<string, EventInput[]>();
    filtered.forEach(ev => {
      const startStr = typeof ev.start === 'string' ? ev.start : '';
      const dayKey = startStr.slice(0, 10);
      if (!groups.has(dayKey)) groups.set(dayKey, []);
      groups.get(dayKey)!.push(ev);
    });

    // Ordena dentro de cada dia: com hora primeiro (por horário), sem hora depois
    groups.forEach((evs) => {
      evs.sort((a, b) => {
        const aHasTime = (a.extendedProps as any)?._hasTime === true;
        const bHasTime = (b.extendedProps as any)?._hasTime === true;
        if (aHasTime && !bHasTime) return -1;
        if (!aHasTime && bHasTime) return 1;
        const aStr = typeof a.start === 'string' ? a.start : '';
        const bStr = typeof b.start === 'string' ? b.start : '';
        return aStr.localeCompare(bStr);
      });
    });

    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allEvents, cronogramaRange, cronogramaOnlyMine, viewFilters, user, members]);

  // ── Busca: ao clicar num resultado, navega para a data do evento ─
  const handleSelectSearchResult = useCallback((ev: EventInput) => {
    setIsSearchOpen(false);
    setSearchQuery('');

    const startStr = typeof ev.start === 'string' ? ev.start : '';
    if (startStr) {
      const d = new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00');
      setShowCronograma(false);
      setTimeout(() => {
        calendarRef.current?.getApi().gotoDate(d);
      }, 50);
    }

    // Highlight pulse no evento encontrado (6 pulsos × 1.1s ≈ 7s)
    if (ev.id) {
      setSearchHighlightId(ev.id as string);
      setTimeout(() => setSearchHighlightId(null), 7500);
    }

    // Abre o painel de detalhe do evento
    const ep = (ev.extendedProps ?? {}) as any;
    setSelectedEvent({
      title: ev.title as string,
      start: startStr,
      end: typeof ev.end === 'string' ? ev.end : undefined,
      allDay: ev.allDay as boolean,
      extendedProps: ep,
    });
  }, []);

  // ── Cronograma: exportar PDF (usa o mesmo template do export global) ─
  const handlePrintCronograma = useCallback(async () => {
    try {
      const [jspdfModule, logoDataUrl] = await Promise.all([loadJsPdf(), getLogoDataUrl()]);
      const doc = new jspdfModule.jsPDF('landscape', 'pt', 'a4');
      const now = new Date();
      const todayStr = now.toLocaleDateString('pt-BR');
      const timeStr  = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const pageWidth  = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const M = 30;

      const { start, end } = cronogramaRange;
      const periodLabel = `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`;
      const issuedBy = userName || 'Usuário do Sistema';

      // Monta linhas a partir do cronogramaByDay (já filtrado por período + "apenas meus")
      const TYPE_COLORS_RGB: Record<string, [number, number, number]> = {
        'Prazo':        [ 29,  78, 216],  // blue-700
        'Audiência':    [185,  28,  28],  // red-700
        'Reunião':      [ 15, 118, 110],  // teal-700
        'Recebimento':  [  4, 120,  87],  // emerald-700
        'Pagamento':    [  4, 120,  87],  // emerald-700
        'Perícia':      [126,  34, 206],  // purple-700
        'Requerimento': [154,  52,  18],  // orange-800
        'Exigência':    [154,  52,  18],  // orange-800
        'Pessoal':      [ 51,  65,  85],  // slate-700
      };

      const rows: string[][] = [];
      cronogramaByDay.forEach(([, evs]) => {
        evs.forEach(ev => {
          const startStr = typeof ev.start === 'string' ? ev.start : '';
          const hasTime  = (ev.extendedProps as any)?._hasTime === true;
          const d = startStr ? new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00') : null;
          const dayPart  = d ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
          const timePart = hasTime && d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
          const typeKey  = (ev.extendedProps?.type as string) || 'meeting';
          const typeLabel = eventTypeLabels[typeKey] ?? typeKey;
          rows.push([
            `${dayPart}\n${timePart}`,
            typeLabel,
            (ev.title as string) || '',
            (ev.extendedProps?.clientName as string) || '',
            getResponsavel(ev),
          ]);
        });
      });

      if (!rows.length) {
        setFeedback({ type: 'error', message: 'Nenhum compromisso no período para exportar.' });
        return;
      }

      const drawPageHeader = () => {
        // Barra escura superior
        doc.setFillColor(10, 15, 30);
        doc.rect(0, 0, pageWidth, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setCharSpace(2);
        doc.text('JURIUS.COM.BR  —  GESTÃO JURÍDICA', pageWidth / 2, 17, { align: 'center' });
        doc.setCharSpace(0);

        // Faixa âmbar
        doc.setFillColor(245, 158, 11);
        doc.rect(0, 28, pageWidth, 3.5, 'F');

        // Área branca do cabeçalho
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 31.5, pageWidth, 76, 'F');

        // Logo
        try { doc.addImage(logoDataUrl, 'PNG', M + 4, 40, 50, 50); } catch (_) {}

        // Título
        const tX = M + 66;
        doc.setTextColor(10, 15, 30);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text('Cronograma de Compromissos', tX, 57);
        doc.setDrawColor(245, 158, 11);
        doc.setLineWidth(2);
        doc.line(tX, 61, tX + doc.getTextWidth('Cronograma de Compromissos'), 61);

        // Sub-título (período)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(`${periodLabel}${cronogramaOnlyMine ? '  ·  Apenas os meus' : ''}`, tX, 73);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(`Gerado em ${todayStr} às ${timeStr}  ·  Exportado por: ${issuedBy}`, tX, 84);

        // Contador (canto direito)
        const rX = pageWidth - M;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(10, 15, 30);
        doc.text(String(rows.length), rX, 57, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(`compromisso${rows.length !== 1 ? 's' : ''}`, rX, 68, { align: 'right' });

        // Linha divisória
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.4);
        doc.line(0, 107.5, pageWidth, 107.5);
      };

      drawPageHeader();

      (doc as any).autoTable({
        startY: 111,
        head: [['Data / Hora', 'Tipo', 'Compromisso', 'Cliente', 'Responsável']],
        body: rows,
        styles: {
          font: 'helvetica',
          fontSize: 7.8,
          cellPadding: { top: 6, right: 6, bottom: 6, left: 7 },
          lineWidth: 0,
          overflow: 'linebreak',
          textColor: [30, 41, 59],
          valign: 'middle',
        },
        headStyles: {
          fillColor: [10, 15, 30],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 7.5,
          halign: 'center',
          cellPadding: { top: 7, right: 5, bottom: 7, left: 5 },
          lineWidth: 0,
        },
        columnStyles: {
          0: { cellWidth: 82,   halign: 'center', fontSize: 7.5, textColor: [71, 85, 105] },
          1: { cellWidth: 76,   halign: 'center', fontSize: 7.5 },
          2: { cellWidth: 'auto', fontStyle: 'bold' },
          3: { cellWidth: 120 },
          4: { cellWidth: 110 },
        },
        margin: { top: 111, left: M, right: M, bottom: 46 },
        // Oculta texto bruto da coluna Tipo — desenhamos o ponto colorido manualmente
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 1)
            data.cell.styles.textColor = data.cell.styles.fillColor ?? [255, 255, 255];
        },
        didDrawCell: (data: any) => {
          if (data.section !== 'body' || data.column.index !== 1) return;
          const tipo  = String(data.row.cells[1]?.raw || '');
          const color = TYPE_COLORS_RGB[tipo];
          if (!color) return;
          const cy   = data.cell.y + data.cell.height / 2;
          const dotX = data.cell.x + 10;
          doc.setFillColor(...color);
          doc.circle(dotX, cy, 2.5, 'F');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(30, 41, 59);
          doc.text(tipo, dotX + 6, cy + 2.5);
        },
        didDrawPage: (_data: any) => {
          const pageNum   = doc.internal.getCurrentPageInfo().pageNumber;
          const pageCount = doc.internal.pages.length - 1;
          // Faixa âmbar + rodapé escuro
          doc.setFillColor(245, 158, 11);
          doc.rect(0, pageHeight - 36, pageWidth, 1.5, 'F');
          doc.setFillColor(10, 15, 30);
          doc.rect(0, pageHeight - 34, pageWidth, 34, 'F');
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(140, 155, 175);
          doc.text('jurius.com.br — Sistema de Gestão Jurídica', M, pageHeight - 15);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(200, 210, 225);
          doc.text(`Página ${pageNum} de ${pageCount}`, pageWidth / 2, pageHeight - 15, { align: 'center' });
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(140, 155, 175);
          doc.text(`Gerado em ${todayStr}`, pageWidth - M, pageHeight - 15, { align: 'right' });
          if (pageNum > 1) drawPageHeader();
        },
      });

      const fileLabel = `cronograma_${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`;
      doc.save(`${fileLabel}.pdf`);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao gerar PDF do cronograma.' });
    }
  }, [cronogramaByDay, cronogramaRange, cronogramaOnlyMine, getResponsavel, eventTypeLabels, userName]);

  const handleEventClick = useCallback(
    (info: any) => {
      const extendedProps = info.event.extendedProps as Record<string, any>;
      setSelectedEvent({
        title: info.event.title,
        start: info.event.startStr,
        end: info.event.endStr,
        allDay: info.event.allDay,
        extendedProps,
      });
    },
    [],
  );

  const handleDateClick = useCallback(
    (info: any) => {
      openEventForm({ date: info.dateStr });
    },
    [openEventForm],
  );

  // ── Confirmação manual de audiência (designada em ata, sem DJEN) ──
  const [manualBusy, setManualBusy] = useState(false);
  const applyEventUpdateLocally = (updated: CalendarEvent) => {
    setCalendarEventsData((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setSelectedEvent((prev) =>
      prev
        ? {
            ...prev,
            extendedProps: {
              ...prev.extendedProps,
              djenStatus: updated.djen_status ?? undefined,
              djenIntimationId: updated.djen_intimation_id ?? undefined,
              data: updated,
            },
          }
        : prev,
    );
  };
  const handleManualConfirm = async (eventId: string) => {
    setManualBusy(true);
    try {
      const updated = await calendarService.manualConfirmHearing(eventId, null);
      if (updated) applyEventUpdateLocally(updated);
    } catch (err) {
      console.error('Falha ao confirmar manualmente:', err);
    } finally {
      setManualBusy(false);
    }
  };
  const handleManualUnconfirm = async (eventId: string) => {
    setManualBusy(true);
    try {
      const updated = await calendarService.manualUnconfirmHearing(eventId);
      if (updated) applyEventUpdateLocally(updated);
    } catch (err) {
      console.error('Falha ao desfazer confirmação manual:', err);
    } finally {
      setManualBusy(false);
    }
  };

  const computeStartAt = (dateValue: string, timeValue: string) => {
    const normalizeTime = (value: string) => (value.length === 5 ? `${value}:00` : value);

    if (timeValue) {
      const normalized = normalizeTime(timeValue);
      // Retorna no formato ISO LOCAL sem conversão
      // Ex: 2024-01-15T08:30:00 será salvo exatamente assim
      return `${dateValue}T${normalized}`;
    }

    // Para eventos sem hora específica (dia inteiro)
    return `${dateValue}T00:00:00`;
  };

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
    setEditingEventId(null);
    setSelectedEvent(null);
    setCreateFormInitialClientName('');
    setClientSearchTerm('');
    setClientSearchOpen(false);
  }, []);

  const handleSubmitEvent = async () => {
    if (!newEventForm.title.trim()) {
      alert('Informe o título do compromisso.');
      return;
    }

    try {
      setSavingEvent(true);
      // Eventos pessoais são sempre privados do criador
      const isPersonal = newEventForm.type === 'personal';
      // Resolve o vínculo de processo/requerimento conforme tipo de evento.
      // - Pessoal: sem vínculo.
      // - Perícia: usa process_id OU requirement_id conforme pericia_link_type.
      // - Demais: usa process_id.
      const linkProcessId = (!isPersonal && newEventForm.process_id &&
        (newEventForm.type !== 'pericia' || newEventForm.pericia_link_type === 'process'))
        ? newEventForm.process_id : null;
      const linkRequirementId = (!isPersonal && newEventForm.requirement_id &&
        newEventForm.type === 'pericia' && newEventForm.pericia_link_type === 'requirement')
        ? newEventForm.requirement_id : null;

      const computedStartAt = computeStartAt(newEventForm.date, newEventForm.time);
      const computedEndAt = newEventForm.time
        ? (() => {
            const durationMin = (eventTypeDurations[newEventForm.type] ?? 60) + bufferMin;
            const endMs = new Date(computedStartAt).getTime() + durationMin * 60 * 1000;
            return new Date(endMs).toISOString();
          })()
        : null;

      const basePayload = {
        title: newEventForm.title.trim(),
        description: newEventForm.description.trim() || null,
        event_type: newEventForm.type,
        start_at: computedStartAt,
        end_at: computedEndAt,
        notify_minutes_before: null as number | null,
        client_id: newEventForm.client_id || null,
        client_name: !newEventForm.client_id && newEventForm.client_name.trim()
          ? newEventForm.client_name.trim()
          : null,
        user_id: isPersonal ? (user?.id || null) : (newEventForm.responsible_id || null),
        is_private: isPersonal ? true : newEventForm.is_private,
        shared_with_ids: (isPersonal || newEventForm.is_private) ? newEventForm.shared_with_ids : [],
        process_id: linkProcessId,
        requirement_id: linkRequirementId,
        // event_mode só faz sentido para Audiência, Reunião e Perícia; nos outros tipos vai null
        event_mode: (['hearing', 'meeting', 'pericia'] as EventType[]).includes(newEventForm.type)
          ? (newEventForm.event_mode || null)
          : null,
      };

      const isAllDay = !newEventForm.time;

      if (editingEventId) {
        const updatedEvent = await calendarService.updateEvent(editingEventId, basePayload);
        setCalendarEventsData((prev) =>
          prev.map((event) => (event.id === updatedEvent.id ? updatedEvent : event)),
        );

        const api = calendarRef.current?.getApi();
        const fcEvent = api?.getEventById(`calendar-${editingEventId}`);
        if (fcEvent) {
          fcEvent.setProp('title', updatedEvent.title);
          fcEvent.setExtendedProp('description', updatedEvent.description ?? '');
          fcEvent.setExtendedProp('status', updatedEvent.status);
          fcEvent.setExtendedProp('clientName', linkedClient?.full_name ?? '');
          fcEvent.setExtendedProp('clientPhone', linkedClient?.mobile || linkedClient?.phone || '');
          fcEvent.setDates(new Date(updatedEvent.start_at), null, {
            allDay: isAllDay,
          });
        }
        // 🔔 Notificações da edição
        if (user?.id && updatedEvent) {
          const oldEvent = calendarEventsData.find(e => e.id === editingEventId);
          const eventDate = new Date(updatedEvent.start_at);
          const formattedDate = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          const notifyBase = { appointment_id: updatedEvent.id, metadata: { event_type: updatedEvent.event_type, start_at: updatedEvent.start_at } };
          const assignerName = members.find(m => m.user_id === user.id)?.name || 'Alguém';
          const typeLabel = eventTypeLabels[updatedEvent.event_type as EventType] || 'Compromisso';
          const typeEmojis: Record<string, string> = { hearing: '⚖️', meeting: '🤝', payment: '💰', pericia: '🔬', personal: '👤', requirement: '📋', deadline: '📅' };
          const typeEmoji = typeEmojis[updatedEvent.event_type] || '📅';

          // Responsável mudou
          const newResp = basePayload.user_id;
          if (newResp && newResp !== user.id && newResp !== oldEvent?.user_id) {
            try {
              await userNotificationService.createNotification({
                title: `${typeEmoji} ${typeLabel} Atribuída`, type: 'appointment_assigned',
                message: `${assignerName} atribuiu uma ${typeLabel} a você\n"${updatedEvent.title}" • ${formattedDate}`,
                user_id: newResp, ...notifyBase,
              });
            } catch {}
          }

          // Novos na visibilidade
          const oldShared = oldEvent?.shared_with_ids ?? [];
          const newlyShared = (basePayload.shared_with_ids ?? []).filter(id => !oldShared.includes(id) && id !== user.id);
          for (const uid of newlyShared) {
            try {
              await userNotificationService.createNotification({
                title: `👁️ ${typeLabel} Compartilhada`, type: 'appointment_assigned',
                message: `${assignerName} deu visibilidade de uma ${typeLabel} a você\n"${updatedEvent.title}" • ${formattedDate}`,
                user_id: uid, ...notifyBase,
              });
            } catch {}
          }
        }

        setFeedback({ type: 'success', message: `Compromisso "${newEventForm.title}" atualizado com sucesso!` });
      } else {
        const createdEvent = await calendarService.createEvent({
          ...basePayload,
          status: 'pendente',
          // Vínculo com a intimação de origem quando criado a partir de sugestão
          djen_intimation_id: newEventForm.djen_intimation_id || null,
        });
        setCalendarEventsData((prev) => [...prev, createdEvent]);

        // 🔔 Notificações do novo compromisso
        if (user?.id && createdEvent) {
          const eventDate = new Date(createdEvent.start_at);
          const formattedDate = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          const notifyBase = { appointment_id: createdEvent.id, metadata: { event_type: newEventForm.type, start_at: createdEvent.start_at } };
          const assignerName = members.find(m => m.user_id === user.id)?.name || 'Alguém';
          const typeLabel = eventTypeLabels[newEventForm.type as EventType] || 'Compromisso';
          const typeEmojis: Record<string, string> = { hearing: '⚖️', meeting: '🤝', payment: '💰', pericia: '🔬', personal: '👤', requirement: '📋', deadline: '📅' };
          const typeEmoji = typeEmojis[newEventForm.type] || '📅';

          // Responsável atribuído (quando diferente do criador)
          if (newEventForm.responsible_id && newEventForm.responsible_id !== user.id) {
            try {
              await userNotificationService.createNotification({
                title: `${typeEmoji} Nova ${typeLabel}`, type: 'appointment_assigned',
                message: `${assignerName} atribuiu uma ${typeLabel} a você\n"${createdEvent.title}" • ${formattedDate}`,
                user_id: newEventForm.responsible_id, ...notifyBase,
              });
            } catch {}
          }

          // Pessoas que receberam visibilidade (shared_with_ids)
          const sharedToNotify = (newEventForm.shared_with_ids ?? []).filter(id => id !== user.id && id !== newEventForm.responsible_id);
          for (const uid of sharedToNotify) {
            try {
              await userNotificationService.createNotification({
                title: `👁️ ${typeLabel} Compartilhada`, type: 'appointment_assigned',
                message: `${assignerName} deu visibilidade de uma ${typeLabel} a você\n"${createdEvent.title}" • ${formattedDate}`,
                user_id: uid, ...notifyBase,
              });
            } catch {}
          }
        }
        
        setFeedback({ type: 'success', message: `Compromisso "${newEventForm.title}" criado com sucesso!` });
      }

      handleCloseCreateModal();
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isNetworkError =
        !navigator.onLine ||
        /failed to fetch|networkerror|network error|fetch|conex|connection|timeout|net::|err_/i.test(msg);
      if (isNetworkError) {
        setFeedback({
          type: 'error',
          persistent: true,
          message: 'Sem conexão com o servidor — o compromisso NÃO foi salvo. Verifique sua internet e clique em salvar novamente. Os dados do formulário foram mantidos.',
        });
      } else {
        setFeedback({ type: 'error', message: msg || 'Erro ao salvar compromisso.' });
      }
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteSelectedEvent = async () => {
    if (!selectedEvent?.extendedProps.calendarEventId) return;
    const eventId = selectedEvent.extendedProps.calendarEventId as string;
    const eventTitle = selectedEvent.title || '';
    const confirmed = await confirmDelete({
      title: 'Excluir compromisso',
      entityName: eventTitle || undefined,
      message: 'Deseja realmente excluir este compromisso?',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      setSavingEvent(true);
      addDeletionLogEntry({
        id: eventId,
        title: eventTitle || '(Sem título)',
        type: (selectedEvent.extendedProps.type ?? 'personal') as EventType,
        start_at: ((selectedEvent.start as unknown) instanceof Date ? (selectedEvent.start as unknown as Date).toISOString() : String(selectedEvent.start ?? '')) || new Date().toISOString(),
        deleted_at: new Date().toISOString(),
        deleted_by: userName || 'Usuário',
      });
      await calendarService.deleteEvent(eventId);
      notifyDeleted(eventTitle || undefined);
      setCalendarEventsData((prev) => prev.filter((e) => e.id !== eventId));
      const api = calendarRef.current?.getApi();
      api?.getEventById(`calendar-${eventId}`)?.remove();
      setSelectedEvent(null);
      await loadData();
      setFeedback({ type: 'success', message: 'Compromisso excluído com sucesso!' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Não foi possível excluir o compromisso.' });
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!editingEventId) return;
    const confirmed = await confirmDelete({
      title: 'Excluir compromisso',
      entityName: newEventForm.title || undefined,
      message: 'Deseja realmente excluir este compromisso?',
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      setSavingEvent(true);
      addDeletionLogEntry({
        id: editingEventId,
        title: newEventForm.title?.trim() || '(Sem título)',
        type: newEventForm.type,
        start_at: toLogIsoFromLocal(newEventForm.date, newEventForm.time),
        deleted_at: new Date().toISOString(),
        deleted_by: userName || 'Usuário',
      });
      await calendarService.deleteEvent(editingEventId);
      notifyDeleted(newEventForm.title || undefined);

      setCalendarEventsData((prev) => prev.filter((event) => event.id !== editingEventId));

      const api = calendarRef.current?.getApi();
      const fcEvent = api?.getEventById(`calendar-${editingEventId}`);
      fcEvent?.remove();

      await loadData();
      handleCloseCreateModal();
      setFeedback({ type: 'success', message: 'Compromisso excluído com sucesso!' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Não foi possível excluir o compromisso.' });
    } finally {
      setSavingEvent(false);
    }
  };

  const handleNavigateToModule = useCallback(
    (moduleLink?: string, entityId?: string, extra?: Record<string, unknown>) => {
      if (!moduleLink) return;
      setSelectedEvent(null);
      if (onNavigateToModule) {
        onNavigateToModule({ module: moduleLink, entityId, extra });
      }
    },
    [onNavigateToModule]
  );

  const handleEditSelectedEvent = useCallback(() => {
    if (!selectedEvent) return;

    const { extendedProps, start } = selectedEvent;
    const calendarEventId = extendedProps.calendarEventId;

    if (calendarEventId) {
      const existing = calendarEventsData.find((event) => event.id === calendarEventId);
      if (!existing) return;

      const startDate = existing.start_at ? new Date(existing.start_at) : new Date();
      const validDate = !Number.isNaN(startDate.getTime());
      const hasTime = validDate && existing.start_at?.includes('T');

      openEventForm(
        {
          title: existing.title,
          date: validDate ? formatDateInputValue(startDate) : '',
          time: hasTime ? formatTimeInputValue(startDate) : '',
          type: (existing.event_type as EventType) || 'meeting',
          description: existing.description ?? '',
          client_id: existing.client_id ?? '',
          client_name: existing.client_name ?? '',
          responsible_id: existing.user_id ?? '',
          is_private: existing.is_private ?? false,
          shared_with_ids: existing.shared_with_ids ?? [],
          process_id: existing.process_id ?? '',
          requirement_id: existing.requirement_id ?? '',
          pericia_link_type: existing.requirement_id ? 'requirement' : 'process',
          event_mode: (existing as any).event_mode ?? '',
        },
        calendarEventId,
      );
      if (!existing.client_id && existing.client_name) {
        setClientSearchTerm(existing.client_name);
      }
      setSelectedEvent(null);
      return;
    }

    const moduleLink = extendedProps.moduleLink;
    const entityId = extendedProps.entityId;

    if (moduleLink && entityId && onEditSystemEntity) {
      onEditSystemEntity({ module: moduleLink, entityId, data: extendedProps.data });
      setSelectedEvent(null);
      return;
    }

    // Fallback: open creation flow using event info
    if (start) {
      const startDate = new Date(start);
      const validDate = !Number.isNaN(startDate.getTime());
      openEventForm({
        title: selectedEvent.title,
        date: validDate ? formatDateInputValue(startDate) : '',
        time: !selectedEvent.allDay && validDate ? formatTimeInputValue(startDate) : '',
        type: (extendedProps.type as EventType) || 'meeting',
        description: extendedProps.description ?? '',
        client_id: extendedProps.data?.client_id ?? '',
      });
      setSelectedEvent(null);
    }
  }, [
    calendarEventsData,
    formatDateInputValue,
    formatTimeInputValue,
    handleNavigateToModule,
    onEditSystemEntity,
    openEventForm,
    selectedEvent,
  ]);

  const decodeBase64IfNeeded = useCallback((raw: string) => {
    const sanitized = raw.trim();
    if (sanitized.length < 16) return raw;
    if (sanitized.length % 4 !== 0) return raw;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(sanitized)) return raw;

    const tryDecode = (input: string) => {
      const normalized = input.replace(/\s+/g, '');
      try {
        if (typeof window !== 'undefined' && typeof window.atob === 'function') {
          return window.atob(normalized);
        }
        if (typeof globalThis !== 'undefined' && typeof (globalThis as any).atob === 'function') {
          return (globalThis as any).atob(normalized);
        }
      } catch {
        return null;
      }
      return null;
    };

    let current = sanitized;
    for (let i = 0; i < 2; i += 1) {
      const decoded = tryDecode(current);
      if (!decoded || decoded === current) break;

      const nonPrintableRatio = decoded.replace(/[\x20-\x7E\s]/g, '').length / decoded.length;
      if (nonPrintableRatio > 0.2) break;

      current = decoded;
    }

    return current;
  }, []);

  const parseNotesIfJson = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return raw;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
              const parts: string[] = [];
              if (item.author_name) parts.push(`[${item.author_name}]`);
              if (item.text) parts.push(item.text);
              if (item.created_at) {
                const date = new Date(item.created_at);
                if (!isNaN(date.getTime())) {
                  parts.push(`(${date.toLocaleDateString('pt-BR')})`);
                }
              }
              return parts.join(' ');
            }
            return String(item);
          })
          .filter(Boolean)
          .join(' | ');
      }
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
      }
    } catch {
      return raw;
    }
    return raw;
  }, []);

  const convertRichTextToPlainText = useCallback(
    (value?: string | null) => {
      if (!value) return '';

      let text = decodeBase64IfNeeded(value);
      text = parseNotesIfJson(text);

      text = text.replace(/<br\s*\/?>/gi, '\n');
      text = text.replace(
        /<a [^>]*href="([^"#]+)"[^>]*>(.*?)<\/a>/gi,
        (_, href: string, inner: string = '') => {
          const cleaned = inner.replace(/<[^>]+>/g, '').trim();
          if (cleaned && cleaned !== href) {
            return `${cleaned} (${href})`;
          }
          return href;
        },
      );
      text = text.replace(
        /<a [^>]*href='#'[^>]*>(.*?)<\/a>/gi,
        (_, inner: string = '') => inner.replace(/<[^>]+>/g, '').trim(),
      );
      text = text.replace(/<\/?[^>]+>/g, '');

      if (typeof window !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        text = textarea.value;
      }

      return text.replace(/\s+/g, ' ').trim();
    },
    [decodeBase64IfNeeded, parseNotesIfJson],
  );

  const truncateForExcel = (value?: string | null) => {
    if (!value) return '';
    const str = value.toString();
    return str.length > 32760 ? `${str.slice(0, 32757)}...` : str;
  };

  const stripInternalMetadata = useCallback((value?: string | null): string => {
    if (!value) return '';
    return value
      .replace(/\[agreement_id:[^\]]+\]/g, '')
      .replace(/\[installment:\d+\]/g, '')
      .replace(/\[inadimplencia\]/g, '')
      .split('\n')
      .filter(line => !/Valor:\s*R\$\s*(NaN|undefined|null|--)/.test(line))
      .join('\n')
      .trim();
  }, []);

  const prepareDescriptionForExport = useCallback(
    (value?: string | null) => truncateForExcel(convertRichTextToPlainText(stripInternalMetadata(value))),
    [convertRichTextToPlainText, stripInternalMetadata],
  );


  const buildAgendaRows = (startDate?: Date, endDate?: Date) => {
    const rows: Record<string, string>[] = [];

    deadlines.forEach((deadline) => {
      if (deadline.status === 'cumprido' || deadline.status === 'cancelado') return;
      if (!viewFilters.deadline) return;
      
      // Filtrar por período se especificado
      if (startDate && endDate && deadline.due_date) {
        const dueDate = new Date(deadline.due_date);
        if (dueDate < startDate || dueDate > endDate) return;
      }
      
      const client = deadline.client_id ? clientMap.get(deadline.client_id) : null;
      rows.push({
        Data: formatDateTime(deadline.due_date),
        Tipo: 'Prazo',
        Título: truncateForExcel(deadline.title),
        Cliente: truncateForExcel(client?.full_name ?? 'Sem cliente'),
        Telefone: truncateForExcel(client?.mobile ?? client?.phone ?? ''),
        Status: truncateForExcel(deadline.status),
        Prioridade: truncateForExcel(deadline.priority),
        Descrição: prepareDescriptionForExport(deadline.description),
      });
    });

    processes
      .filter((p) => p.hearing_scheduled && p.hearing_date)
      .forEach((process) => {
        if (!viewFilters.hearing) return;
        
        // Filtrar por período se especificado
        if (startDate && endDate && process.hearing_date) {
          const hearingDate = new Date(process.hearing_date);
          if (hearingDate < startDate || hearingDate > endDate) return;
        }
        
        const client = process.client_id ? clientMap.get(process.client_id) : null;
        rows.push({
          Data: formatDateTime(
            process.hearing_time
              ? `${process.hearing_date}T${process.hearing_time}`
              : process.hearing_date ?? undefined,
          ),
          Tipo: 'Audiência',
          Título: truncateForExcel(`Audiência - ${process.hearing_mode ?? 'Sem modo'}`),
          Cliente: truncateForExcel(client?.full_name ?? 'Sem cliente'),
          Telefone: truncateForExcel(client?.mobile ?? client?.phone ?? ''),
          Status: truncateForExcel(process.status),
          Prioridade: '',
          Descrição: prepareDescriptionForExport(process.notes),
        });
      });

    requirements
      .filter((r) => r.status === 'em_exigencia' && r.exigency_due_date)
      .forEach((requirement) => {
        if (!viewFilters.requirement) return;
        
        // Filtrar por período se especificado
        if (startDate && endDate && requirement.exigency_due_date) {
          const exigencyDate = new Date(requirement.exigency_due_date);
          if (exigencyDate < startDate || exigencyDate > endDate) return;
        }
        
        rows.push({
          Data: formatDateTime(requirement.exigency_due_date ?? undefined),
          Tipo: 'Requerimento',
          Título: truncateForExcel(`Requerimento - ${requirement.beneficiary}`),
          Cliente: truncateForExcel(requirement.beneficiary),
          Telefone: truncateForExcel(requirement.phone ?? ''),
          Status: truncateForExcel(requirement.status),
          Prioridade: '',
          Descrição: prepareDescriptionForExport(requirement.observations ?? requirement.notes ?? ''),
        });
      });

    calendarEventsData.forEach((event) => {
      if (!viewFilters[event.event_type]) return;
      
      // Filtrar por período se especificado
      if (startDate && endDate && event.start_at) {
        const eventDate = new Date(event.start_at);
        if (eventDate < startDate || eventDate > endDate) return;
      }
      
      const eventTypeLabels: Record<string, string> = {
        payment: 'Pagamento',
        meeting: 'Reunião',
        pericia: 'Perícia',
        hearing: 'Audiência',
        deadline: 'Prazo',
        requirement: 'Requerimento',
      };
      const client = event.client_id ? clientMap.get(event.client_id) : null;
      rows.push({
        Data: formatDateTime(event.start_at),
        Tipo: eventTypeLabels[event.event_type] || event.event_type,
        Título: truncateForExcel(event.title),
        Cliente: truncateForExcel(client?.full_name ?? 'Sem cliente'),
        Telefone: truncateForExcel(client?.mobile ?? client?.phone ?? ''),
        Status: truncateForExcel(event.status),
        Prioridade: '',
        Descrição: prepareDescriptionForExport(event.description),
      });
    });

    // Ordenar por data (mais recente primeiro)
    rows.sort((a, b) => {
      const dateA = new Date(a['Data'].split(',')[0].split('/').reverse().join('-'));
      const dateB = new Date(b['Data'].split(',')[0].split('/').reverse().join('-'));
      return dateA.getTime() - dateB.getTime(); // Crescente (mais próximo primeiro)
    });

    return rows;
  };

  const handleOpenExportModal = (format: 'excel' | 'pdf' = 'excel') => {
    const today = new Date();
    setExportStartDate(today.toISOString().split('T')[0]);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);
    setExportEndDate(endDate.toISOString().split('T')[0]);
    setExportFormat(format);
    setIsExportModalOpen(true);
  };

  const handleExportCalendar = async () => {
    try {
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (exportPeriod === 'custom') {
        if (!exportStartDate || !exportEndDate) {
          setFeedback({ type: 'error', message: 'Selecione as datas de início e fim.' });
          return;
        }
        // Corrigir timezone: adicionar 'T00:00:00' para forçar horário local
        startDate = new Date(exportStartDate + 'T00:00:00');
        endDate = new Date(exportEndDate + 'T23:59:59');
      } else {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(exportPeriod));
        endDate.setHours(23, 59, 59, 999);
      }

      const rows = buildAgendaRows(startDate, endDate);

      if (!rows.length) {
        setFeedback({ type: 'error', message: 'Não há compromissos no período selecionado.' });
        return;
      }

      if (exportFormat === 'pdf') {
        const [jspdfModule, logoDataUrl] = await Promise.all([loadJsPdf(), getLogoDataUrl()]);
        const doc = new jspdfModule.jsPDF('landscape', 'pt', 'a4');
        const now = new Date();
        const today = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const exportedBy = userName || 'Usuário do Sistema';

        // Colunas sigilosas: 4=Telefone, 5=Status, 6=Prioridade, 7=Descrição
        const REDACTED_COLS = new Set([4, 5, 6, 7]);

        // Cores idênticas ao EVENT_TYPE_COLORS do calendário (Tailwind exato)
        const TYPE_COLORS: Record<string, [number, number, number]> = {
          'Prazo':       [ 29,  78, 216],  // blue-700
          'Audiência':   [185,  28,  28],  // red-700
          'Reunião':     [ 15, 118, 110],  // teal-700
          'Recebimento': [  4, 120,  87],  // emerald-700
          'Pagamento':   [  4, 120,  87],  // emerald-700
          'Perícia':     [126,  34, 206],  // purple-700
          'Exigência':   [154,  52,  18],  // orange-800
          'Pessoal':     [ 51,  65,  85],  // slate-700
        };

        const drawWatermark = () => {
          if (!exportPrivate) return;
          try {
            doc.saveGraphicsState();
            (doc as any).setGState(new (jspdfModule as any).GState({ opacity: 0.06 }));
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(100);
            doc.setTextColor(180, 0, 0);
            doc.text('SIGILOSO', pageWidth / 2, pageHeight / 2 + 30, {
              align: 'center',
              angle: 35,
            });
            doc.restoreGraphicsState();
          } catch (_) { /* GState não suportado na versão carregada */ }
        };

        const drawPageHeader = () => {
          const M = 30;
          // ── Barra superior escura ─────────────────────────────────────────
          doc.setFillColor(10, 15, 30);
          doc.rect(0, 0, pageWidth, 28, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setCharSpace(2);
          doc.text('JURIUS.COM.BR  —  GESTÃO JURÍDICA', pageWidth / 2, 17, { align: 'center' });
          doc.setCharSpace(0);

          // Faixa âmbar
          doc.setFillColor(245, 158, 11);
          doc.rect(0, 28, pageWidth, 3.5, 'F');

          // ── Área branca do cabeçalho ──────────────────────────────────────
          doc.setFillColor(255, 255, 255);
          doc.rect(0, 31.5, pageWidth, 76, 'F');

          // Logo
          try { doc.addImage(logoDataUrl, 'PNG', M + 4, 40, 50, 50); } catch (_) {}

          // Título
          const tX = M + 66;
          doc.setTextColor(10, 15, 30);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(20);
          doc.text('Agenda de Compromissos', tX, 57);
          doc.setDrawColor(245, 158, 11);
          doc.setLineWidth(2);
          doc.line(tX, 61, tX + doc.getTextWidth('Agenda de Compromissos'), 61);

          // Período e meta numa linha só
          const periodText = exportPeriod === 'custom'
            ? `${new Date(exportStartDate + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(exportEndDate + 'T00:00:00').toLocaleDateString('pt-BR')}`
            : `Próximos ${exportPeriod} dias`;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(71, 85, 105);
          doc.text(periodText, tX, 73);
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text(`Gerado em ${today} às ${timeStr}  ·  Exportado por: ${exportedBy}`, tX, 84);

          // Contador de registros (canto direito)
          const rX = pageWidth - M;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(22);
          doc.setTextColor(10, 15, 30);
          doc.text(String(rows.length), rX, 57, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text(`compromisso${rows.length !== 1 ? 's' : ''}`, rX, 68, { align: 'right' });

          // Linha divisória
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.4);
          doc.line(0, 107.5, pageWidth, 107.5);

          // Badge sigilo
          if (exportPrivate) {
            const bW = 128; const bH = 20; const bX = rX - bW; const bY = 74;
            doc.setFillColor(185, 28, 28);
            doc.roundedRect(bX, bY, bW, bH, 4, 4, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.text('INFORMAÇÕES RESTRITAS', bX + bW / 2, bY + 13, { align: 'center' });
          }
        };

        drawWatermark();
        drawPageHeader();

        // ── Tabela ─────────────────────────────────────────────────────────
        (doc as any).autoTable({
          startY: 111,
          head: [['Data', 'Tipo', 'Título', 'Cliente', 'Telefone', 'Status', 'Prioridade', 'Descrição']],
          body: rows.map((row) => [
            row['Data'],
            row['Tipo'],
            row['Título'],
            row['Cliente'],
            exportPrivate ? '' : row['Telefone'],
            exportPrivate ? '' : row['Status'],
            exportPrivate ? '' : row['Prioridade'],
            exportPrivate ? '' : row['Descrição'],
          ]),
          styles: {
            font: 'helvetica',
            fontSize: 7.8,
            cellPadding: { top: 6, right: 6, bottom: 6, left: 7 },
            lineWidth: 0,
            overflow: 'linebreak',
            textColor: [30, 41, 59],
            valign: 'middle',
          },
          headStyles: {
            fillColor: [10, 15, 30],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7.5,
            halign: 'center',
            cellPadding: { top: 7, right: 5, bottom: 7, left: 5 },
            lineWidth: 0,
          },
          columnStyles: {
            0: { cellWidth: 80,  halign: 'center', fontSize: 7.5, textColor: [71, 85, 105] },
            1: { cellWidth: 74,  halign: 'center', fontSize: 7.5 },
            2: { cellWidth: 132, fontStyle: 'bold' },
            3: { cellWidth: 98  },
            4: { cellWidth: 68,  halign: 'center', fontSize: 7.5 },
            5: { cellWidth: 60,  halign: 'center', fontSize: 7.5 },
            6: { cellWidth: 50,  halign: 'center', fontSize: 7.5 },
            7: { cellWidth: 'auto', fontSize: 7.5, textColor: [71, 85, 105] },
          },
          margin: { top: 111, left: 30, right: 30, bottom: 46 },

            // Oculta o texto bruto da coluna Tipo — desenhamos o indicador manualmente
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1)
              data.cell.styles.textColor = data.cell.styles.fillColor ?? [255, 255, 255];
          },

          didDrawCell: (data: any) => {
            if (data.section !== 'body') return;

            const tipo = String(data.row.cells[1]?.raw || '');
            const color = TYPE_COLORS[tipo];

            // Coluna Tipo: ponto colorido + texto ao lado
            if (data.column.index === 1 && color) {
              const cy = data.cell.y + data.cell.height / 2;
              const dotX = data.cell.x + 10;
              doc.setFillColor(...color);
              doc.circle(dotX, cy, 2.5, 'F');
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(7.5);
              doc.setTextColor(30, 41, 59);
              doc.text(tipo, dotX + 6, cy + 2.5);
            }

            // Redação de células sigilosas
            if (exportPrivate && REDACTED_COLS.has(data.column.index)) {
              const { x, y, width, height } = data.cell;
              const pad = 4;
              doc.setFillColor(22, 22, 28);
              doc.rect(x + pad, y + pad, width - pad * 2, height - pad * 2, 'F');
            }
          },
          didDrawPage: (_data: any) => {
            const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
            const pageCount = doc.internal.pages.length - 1;

            // Faixa âmbar no rodapé
            doc.setFillColor(245, 158, 11);
            doc.rect(0, pageHeight - 36, pageWidth, 1.5, 'F');

            // Fundo escuro do rodapé
            doc.setFillColor(10, 15, 30);
            doc.rect(0, pageHeight - 34, pageWidth, 34, 'F');

            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(140, 155, 175);
            doc.text('jurius.com.br — Sistema de Gestão Jurídica', 30, pageHeight - 15);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(200, 210, 225);
            doc.text(`Página ${pageNumber} de ${pageCount}`, pageWidth / 2, pageHeight - 15, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(140, 155, 175);
            doc.text(`Gerado em ${today}`, pageWidth - 30, pageHeight - 15, { align: 'right' });

            if (pageNumber > 1) {
              drawWatermark();
              drawPageHeader();
            }
          },
        });

        const periodLabel = exportPeriod === 'custom'
          ? `${exportStartDate}_${exportEndDate}`
          : `proximos_${exportPeriod}_dias`;
        const suffix = exportPrivate ? '_sigiloso' : '';
        doc.save(`agenda_${periodLabel}${suffix}.pdf`);
      } else {
        // Exportar Excel
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet['!cols'] = [
          { wch: 22 },
          { wch: 18 },
          { wch: 50 },
          { wch: 35 },
          { wch: 18 },
          { wch: 12 },
          { wch: 10 },
          { wch: 40 },
        ];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Agenda');
        
        const periodLabel = exportPeriod === 'custom' 
          ? `${exportStartDate}_${exportEndDate}`
          : `proximos_${exportPeriod}_dias`;
        XLSX.writeFile(workbook, `agenda_${periodLabel}.xlsx`);
      }
      
      setIsExportModalOpen(false);
      setFeedback({ type: 'success', message: `Agenda exportada com sucesso! ${rows.length} compromissos.` });
    } catch (err: any) {
      console.error(err);
      setFeedback({ type: 'error', message: err.message || 'Não foi possível exportar a agenda.' });
    }
  };

  const loadJsPdf = () => {
    if (window.jspdf?.jsPDF && (window.jspdf.autoTable || window.jspdf?.jspdf?.autoTable)) {
      return Promise.resolve(window.jspdf);
    }

    const loadScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
        document.body.appendChild(script);
      });

    return loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.5.31/dist/jspdf.plugin.autotable.min.js'))
      .then(() => window.jspdf || (window as any).jspdf)
      .catch((err) => {
        console.error(err);
        throw new Error('Não foi possível carregar dependências de PDF.');
      });
  };


  const renderEventContent = useCallback(({ event, timeText }: EventContentArg) => {
    const extendedProps = event.extendedProps as Record<string, any>;
    const rawType = extendedProps?.type;
    const type = (rawType ? (rawType as EventType) : 'meeting');
    const linkedRepresentativeAppointments = (extendedProps?.representativeAppointments as RepresentativeAppointment[] | undefined) || [];
    const showDjenDot = ['hearing', 'pericia'].includes(type);
    const djenStatus = (extendedProps?.djenStatus as string | undefined) || 'unconfirmed';

    const hasRealTime = Boolean(timeText && timeText.trim().length > 0);

    // Segundo canal visual do grupo "Prazo": contagem de dias até o vencimento.
    // Como os prazos são allDay (sem hasRealTime), este badge ocupa o mesmo
    // espaço que o horário ocuparia em outros tipos — não adiciona ruído extra,
    // e o número varia por evento, quebrando a leitura uniforme de "tudo azul".
    let daysUntilDue: number | null = null;
    if (type === 'deadline' && event.start) {
      const due = new Date(event.start as Date);
      due.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86400000);
    }
    const dueLabel = daysUntilDue === null ? '' :
      daysUntilDue < 0 ? `${Math.abs(daysUntilDue)}d atrás` :
      daysUntilDue === 0 ? 'hoje' :
      `${daysUntilDue}d`;
    const dueTitle = daysUntilDue === null ? '' :
      daysUntilDue < 0 ? `Vencido há ${Math.abs(daysUntilDue)} dia(s)` :
      daysUntilDue === 0 ? 'Vence hoje' :
      `Vence em ${daysUntilDue} dia(s)`;

    const dotColor =
      djenStatus === 'confirmed'        ? '#16a34a' :
      djenStatus === 'confirmed_manual' ? '#16a34a' :
      djenStatus === 'divergence'       ? '#f59e0b' :
                                          'rgba(255,255,255,0.45)';
    const dotShadow =
      djenStatus === 'confirmed'        ? '0 0 5px #22c55e' :
      djenStatus === 'confirmed_manual' ? '0 0 5px #22c55e' :
      djenStatus === 'divergence'       ? '0 0 5px #f59e0b' :
                                          'none';
    const djenTitle =
      djenStatus === 'confirmed'        ? 'Confirmado pelo DJEN' :
      djenStatus === 'confirmed_manual' ? 'Confirmado manualmente' :
      djenStatus === 'divergence'       ? '⚠️ Divergência com DJEN' :
                                          'Não confirmado no DJEN';

    return (
      <div className={`calendar-chip calendar-chip--${type}`}>
        {showDjenDot && (
          <span
            title={djenTitle}
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              flexShrink: 0,
              background: dotColor,
              boxShadow: dotShadow,
              border: '1.5px solid rgba(255,255,255,0.7)',
            }}
          />
        )}
        {hasRealTime && <span className="calendar-chip__time">{timeText}</span>}
        {daysUntilDue !== null && (
          <span
            className={`calendar-chip__due${daysUntilDue < 0 ? ' calendar-chip__due--overdue' : ''}`}
            title={dueTitle}
          >
            <Clock className="calendar-chip__due-icon" />
            {dueLabel}
          </span>
        )}
        <span className="calendar-chip__title" title={event.title}>
          {event.title}
        </span>
        {linkedRepresentativeAppointments.length > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
            <Briefcase className="h-3 w-3" />
            Correspondente
          </span>
        )}
      </div>
    );
  }, []);

  const handleDayCellDidMount = useCallback(() => {
    // Sem badge personalizado para "hoje"
  }, []);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    setCalendarTitle(api.view.title);
    setCalendarView(api.view.type as typeof calendarView);
  }, []);

  const handleChangeView = useCallback(
    (view: typeof calendarView) => {
      const api = calendarRef.current?.getApi();
      if (!api) return;
      api.changeView(view);
      setCalendarView(view);
      setCalendarTitle(api.view.title);
    },
    [],
  );

  if (loading) {
    return <ModuleSkeleton variant="calendar" header />;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
        {error}
      </div>
    );
  }

  return (
    <div className="calendar-page space-y-0">
      {feedback && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] max-w-sm rounded-xl border px-4 py-3 shadow-lg transition transform flex items-start gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex-1 text-sm leading-snug">{feedback.message}</span>
          {feedback.persistent && (
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="flex-shrink-0 -mr-1 -mt-0.5 rounded p-0.5 hover:bg-red-100 transition"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Toolbar responsiva */}
      <div className="bg-[#f5f5f3] border-b border-[#e7e5df] rounded-xl mb-3">
        {/* Linha 1: nav + título + views + novo */}
        <div className="flex items-center gap-1.5 px-3 py-2 flex-wrap">
          {/* Navegação */}
          <div className="flex items-center bg-[#f8f7f5] ring-1 ring-black/[0.06] rounded-lg p-0.5 shrink-0">
            <button type="button" onClick={() => calendarRef.current?.getApi().prev()} className="p-1 hover:bg-[#eeede9] rounded-md text-slate-600 transition" aria-label="Anterior">
              <span className="text-sm font-bold leading-none">‹</span>
            </button>
            <button type="button" onClick={() => calendarRef.current?.getApi().today()} className="px-2 text-xs font-medium text-slate-700">Hoje</button>
            <button type="button" onClick={() => calendarRef.current?.getApi().next()} className="p-1 hover:bg-[#eeede9] rounded-md text-slate-600 transition" aria-label="Próximo">
              <span className="text-sm font-bold leading-none">›</span>
            </button>
          </div>
          <h2 className="text-sm font-bold text-slate-800 capitalize shrink-0 min-w-0 truncate flex-1 sm:flex-none sm:w-28">{currentMonthName}</h2>

          {/* Views */}
          <div className="flex bg-[#f8f7f5] ring-1 ring-black/[0.06] p-0.5 rounded-lg shrink-0">
            {([
              { label: 'Mês', view: 'dayGridMonth' },
              { label: 'Semana', view: 'timeGridWeek' },
              { label: 'Dia', view: 'timeGridDay' },
            ] as const).map(({ label, view }) => (
              <button
                key={view}
                type="button"
                onClick={() => { setShowCronograma(false); handleChangeView(view); }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  !showCronograma && calendarView === view ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >{label}</button>
            ))}
            <button
              type="button"
              onClick={() => setShowCronograma(v => !v)}
              className={`hidden sm:inline-flex px-2.5 py-1 text-xs font-medium rounded-md transition-all items-center gap-1 ${showCronograma ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <LayoutList className="w-3 h-3" />Cronograma
            </button>
          </div>

          {/* Spacer desktop */}
          <div className="hidden sm:block flex-1" />

          {/* Filtro responsável — desktop only na linha 1 */}
          <div className="hidden sm:flex items-center bg-[#f8f7f5] ring-1 ring-black/[0.06] p-0.5 rounded-lg text-xs font-medium shrink-0">
            {(['todos', 'mim'] as const).map(opt => (
              <button key={opt} type="button"
                onClick={() => { setCalendarResponsibleFilter(opt); setShowResponsiblePicker(false); }}
                className={`px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter === opt ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >{opt === 'todos' ? 'Todos' : 'A mim'}</button>
            ))}
            <div ref={responsiblePickerRef}>
              <button ref={responsibleBtnRef} type="button"
                onClick={() => {
                  const rect = responsibleBtnRef.current?.getBoundingClientRect();
                  if (rect) setResponsiblePickerPos({ top: rect.bottom + 6, left: rect.left });
                  setShowResponsiblePicker(v => !v);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? (() => {
                  const m = members.find(m => (m.user_id || m.id) === calendarResponsibleFilter);
                  const hue = getMemberHue(m?.name || '');
                  return (<>
                    <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex items-center justify-center text-[7px] font-bold shrink-0"
                      style={{ background: `hsl(${hue},50%,85%)`, color: `hsl(${hue},45%,30%)` }}>
                      {(m as any)?.avatar_url ? <img src={(m as any).avatar_url} className="w-full h-full object-cover" alt="" /> : getMemberInitials(m?.name || '')}
                    </div>
                    <span className="max-w-[52px] truncate">{m?.name?.split(' ')[0]}</span>
                  </>);
                })() : <span>Pessoa</span>}
                <ChevronDown className="w-2.5 h-2.5 opacity-50" />
              </button>
            </div>
          </div>

          <div className="hidden sm:block h-5 w-px bg-slate-200 shrink-0" />

          {/* Ações secundárias — desktop only */}
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => setIsSearchOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[#e7e5df] text-slate-500 hover:bg-slate-100 transition-colors"
              aria-label="Buscar compromissos">
              <Search className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setLegendExpanded(v => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${legendExpanded ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 hover:bg-slate-100 border-[#e7e5df]'}`}>
              <Filter className="w-3.5 h-3.5" />Filtros
            </button>
            <button type="button" onClick={() => setIsDeletionLogOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[#e7e5df] text-slate-500 hover:bg-slate-100 transition-colors">
              <History className="w-3.5 h-3.5" />Log
            </button>
            <button type="button" onClick={() => handleOpenExportModal('excel')}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[#e7e5df] text-emerald-600 hover:bg-emerald-50 transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />Excel
            </button>
            <button type="button" onClick={() => handleOpenExportModal('pdf')}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[#e7e5df] text-red-500 hover:bg-red-50 transition-colors">
              <FileText className="w-3.5 h-3.5" />PDF
            </button>
            <button type="button" onClick={() => setIsRepresentativesPanelOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors">
              <Users className="w-3.5 h-3.5" />Corresp.
            </button>
          </div>

          {/* Novo */}
          <button type="button" onClick={() => openEventForm()}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg shadow-sm transition-colors">
            <Plus className="w-3.5 h-3.5" /><span className="hidden sm:inline">Novo</span><span className="sm:hidden">+</span>
          </button>
        </div>

        {/* Linha 2 mobile: filtro responsável + ações */}
        <div className="sm:hidden flex items-center gap-1.5 px-3 pb-2 overflow-x-auto scroll-hidden">
          {/* Filtro responsável */}
          <div className="flex items-center bg-[#f8f7f5] ring-1 ring-black/[0.06] p-0.5 rounded-lg text-xs font-medium shrink-0">
            {(['todos', 'mim'] as const).map(opt => (
              <button key={opt} type="button"
                onClick={() => { setCalendarResponsibleFilter(opt); setShowResponsiblePicker(false); }}
                className={`px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter === opt ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >{opt === 'todos' ? 'Todos' : 'A mim'}</button>
            ))}
            <div ref={responsiblePickerRef}>
              <button ref={responsibleBtnRef} type="button"
                onClick={() => {
                  const rect = responsibleBtnRef.current?.getBoundingClientRect();
                  if (rect) setResponsiblePickerPos({ top: rect.bottom + 6, left: rect.left });
                  setShowResponsiblePicker(v => !v);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? 'bg-[#f5f5f3] text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? (() => {
                  const m = members.find(m => (m.user_id || m.id) === calendarResponsibleFilter);
                  const hue = getMemberHue(m?.name || '');
                  return (<>
                    <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex items-center justify-center text-[7px] font-bold shrink-0"
                      style={{ background: `hsl(${hue},50%,85%)`, color: `hsl(${hue},45%,30%)` }}>
                      {(m as any)?.avatar_url ? <img src={(m as any).avatar_url} className="w-full h-full object-cover" alt="" /> : getMemberInitials(m?.name || '')}
                    </div>
                    <span className="max-w-[52px] truncate">{m?.name?.split(' ')[0]}</span>
                  </>);
                })() : <span>Pessoa</span>}
                <ChevronDown className="w-2.5 h-2.5 opacity-50" />
              </button>
            </div>
          </div>
          {/* Cronograma mobile */}
          <button type="button" onClick={() => setShowCronograma(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all shrink-0 ${showCronograma ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 border-[#e7e5df]'}`}>
            <LayoutList className="w-3 h-3" />Lista
          </button>
          <button type="button" onClick={() => setIsSearchOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-[#e7e5df] text-slate-500 shrink-0"
            aria-label="Buscar">
            <Search className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => setLegendExpanded(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors shrink-0 ${legendExpanded ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 border-[#e7e5df]'}`}>
            <Filter className="w-3 h-3" />Filtros
          </button>
          <button type="button" onClick={() => setIsRepresentativesPanelOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-600 shrink-0">
            <Users className="w-3 h-3" />Corresp.
          </button>
        </div>
      </div>

      {/* Filtros Expansíveis */}
      {legendExpanded && (
        <div className="bg-slate-50 border-x border-[#e7e5df] p-2 sm:p-4">
          <h4 className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 sm:mb-3">Filtrar por Tipo</h4>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {Object.keys(viewFilters)
              .filter(key => !inactiveEventTypeKeys.has(key))
              .map(key => {
                const canonical = EVENT_TYPE_COLORS[key as EventType];
                const hex = eventTypeHexColors[key];
                const badgeClass = canonical
                  ? `text-[11px] sm:text-xs font-medium px-1.5 py-0.5 rounded border-l-2 whitespace-nowrap ${canonical.badge}`
                  : 'text-[11px] sm:text-xs font-medium px-1.5 py-0.5 rounded border-l-2 whitespace-nowrap text-slate-700 bg-slate-100 border-slate-500';
                const badgeStyle = !canonical && hex
                  ? { borderLeftColor: hex, background: hex + '22', color: '#374151' }
                  : undefined;
                return (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer group shrink-0">
                    <input
                      type="checkbox"
                      checked={!!viewFilters[key as EventType]}
                      onChange={() => setViewFilters(prev => ({ ...prev, [key]: !prev[key as EventType] }))}
                      className={`w-3.5 h-3.5 rounded border-slate-300 ${canonical?.checkbox ?? 'text-slate-600 focus:ring-slate-500'}`}
                    />
                    <span className={badgeClass} style={badgeStyle}>
                      {eventTypeLabels[key] ?? key}
                    </span>
                  </label>
                );
              })
            }
          </div>
        </div>
      )}

      {/* Dropdown "Determinado" — posicionado via fixed */}
      {showResponsiblePicker && (
        <div
          ref={responsibleDropdownRef}
          className="fixed z-[9999] bg-white border border-[#e7e5df] rounded-xl shadow-xl p-3 min-w-[200px]"
          style={{ top: responsiblePickerPos.top, left: responsiblePickerPos.left }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Selecionar pessoa</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {[...members].sort((a, b) => {
              const rank = (m: Profile) => {
                const r = (m.role || '').toLowerCase();
                if (r.includes('admin')) return 0;
                if (r.includes('advogad')) return 1;
                return 2;
              };
              return rank(a) - rank(b);
            }).map(member => {
              const memberId = member.user_id || member.id;
              const isSelected = calendarResponsibleFilter === memberId;
              const hue = getMemberHue(member.name || '');
              const initials = getMemberInitials(member.name || '');
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => { setCalendarResponsibleFilter(memberId); setShowResponsiblePicker(false); }}
                  className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-all ${
                    isSelected ? 'bg-amber-50 text-amber-700' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold overflow-hidden flex-shrink-0 relative"
                    style={{ background: `hsl(${hue},50%,88%)`, color: `hsl(${hue},45%,30%)` }}
                  >
                    {initials}
                    {(member as any).avatar_url && (
                      <img src={(member as any).avatar_url} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
                    )}
                  </div>
                  <span className="truncate font-medium">{member.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-amber-500 ml-auto flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ CRONOGRAMA VIEW ═══ */}
      {showCronograma && (
        <div className="bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden">
          {/* Controles do cronograma */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#e7e5df] bg-[#f5f5f3]">
            {/* Período */}
            <div className="flex bg-[#f8f7f5] border border-[#e7e5df] rounded-lg p-0.5 text-xs font-medium">
              {([
                { key: 'semana',  label: 'Esta semana' },
                { key: 'proxima', label: 'Próx. semana' },
                { key: 'mes',     label: 'Este mês' },
                { key: 'custom',  label: 'Período' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCronogramaPeriod(key)}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    cronogramaPeriod === key
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Datas customizadas */}
            {cronogramaPeriod === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={cronogramaStart}
                  onChange={e => setCronogramaStart(e.target.value)}
                  className="text-xs border border-[#e7e5df] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
                <span className="text-slate-400 text-xs">até</span>
                <input
                  type="date"
                  value={cronogramaEnd}
                  onChange={e => setCronogramaEnd(e.target.value)}
                  className="text-xs border border-[#e7e5df] rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
              </div>
            )}

            <div className="h-5 w-px bg-slate-200 mx-1" />

            {/* Apenas meus */}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-slate-600 select-none">
              <input
                type="checkbox"
                checked={cronogramaOnlyMine}
                onChange={e => setCronogramaOnlyMine(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
              />
              Apenas os meus
            </label>

            {/* Contador */}
            <span className="ml-auto text-xs text-slate-400">
              {cronogramaByDay.reduce((s, [, evs]) => s + evs.length, 0)} compromisso(s) · {cronogramaByDay.length} dia(s)
            </span>

            {/* Imprimir */}
            <button
              type="button"
              onClick={handlePrintCronograma}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg transition"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </button>
          </div>

          {/* Lista de dias */}
          <div className="divide-y divide-slate-100">
            {cronogramaByDay.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <LayoutList className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {searchQuery.trim() ? 'Nenhum resultado para a busca' : 'Nenhum compromisso no período'}
                </p>
                <p className="text-xs mt-1">
                  {searchQuery.trim()
                    ? <button type="button" className="underline hover:text-slate-600 transition" onClick={() => setSearchQuery('')}>Limpar busca</button>
                    : 'Ajuste o período ou os filtros de tipo'}
                </p>
              </div>
            ) : cronogramaByDay.map(([dayKey, evs]) => {
              const dayDate = new Date(dayKey + 'T12:00:00');
              const isToday = dayKey === new Date().toISOString().slice(0, 10);
              const dayLabel = dayDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

              const TYPE_COLORS: Record<string, string> = {
                deadline: 'bg-blue-50 text-blue-700 border-blue-200',
                hearing:  'bg-red-50 text-red-700 border-red-200',
                requirement: 'bg-orange-50 text-orange-800 border-orange-300',
                payment:  'bg-emerald-50 text-emerald-700 border-emerald-200',
                meeting:  'bg-teal-50 text-teal-700 border-teal-200',
                pericia:  'bg-purple-50 text-purple-700 border-purple-200',
                personal: 'bg-slate-200 text-slate-700 border-slate-300',
              };
              const TYPE_BORDER: Record<string, string> = {
                deadline: 'border-l-blue-500',
                hearing:  'border-l-red-500',
                requirement: 'border-l-orange-700',
                payment:  'border-l-emerald-500',
                meeting:  'border-l-teal-500',
                pericia:  'border-l-purple-500',
                personal: 'border-l-slate-500',
              };
              const TYPE_LABELS_LOCAL: Record<string, string> = {
                deadline: 'Prazo', hearing: 'Audiência', requirement: 'Exigência',
                payment: 'Recebimento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
              };

              return (
                <div key={dayKey}>
                  {/* Cabeçalho do dia */}
                  <div className={`flex items-center gap-3 px-4 py-2.5 ${isToday ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'bg-slate-50 border-l-4 border-l-transparent'}`}>
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isToday ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {dayDate.getDate()}
                    </div>
                    <div>
                      <span className={`text-sm font-semibold capitalize ${isToday ? 'text-blue-700' : 'text-slate-700'}`}>{dayLabel}</span>
                      {isToday && <span className="ml-2 text-xs font-semibold text-blue-500 uppercase tracking-wider">Hoje</span>}
                    </div>
                    <span className="ml-auto text-xs text-slate-400">{evs.length} compromisso{evs.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Eventos do dia */}
                  <div className="px-4 py-2 space-y-2">
                    {evs.map((ev, idx) => {
                      const type = (ev.extendedProps?.type as string) || 'meeting';
                      const startStr = typeof ev.start === 'string' ? ev.start : '';
                      const hasTime = (ev.extendedProps as any)?._hasTime === true;
                      const timeStr = hasTime
                        ? new Date(startStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                        : null;
                      const client = ev.extendedProps?.clientName as string | undefined;
                      const resp   = getResponsavel(ev);
                      const typeColor  = TYPE_COLORS[type]  || 'bg-slate-100 text-slate-600 border-[#e7e5df]';
                      const borderColor = TYPE_BORDER[type] || 'border-l-slate-400';
                      const typeLabel  = TYPE_LABELS_LOCAL[type] || type;

                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-lg border border-slate-100 border-l-4 ${borderColor} bg-[#f8f7f5] hover:bg-slate-50 transition-colors cursor-pointer`}
                          onClick={() => {
                            // abre o detalhe do evento existente no calendário
                            const d = ev.extendedProps?.data as any;
                            if (d) {
                              setSelectedEvent({
                                title: ev.title as string || '',
                                start: startStr,
                                allDay: !hasTime,
                                extendedProps: ev.extendedProps as any,
                              });
                            }
                          }}
                        >
                          {/* Hora */}
                          <div className="flex-shrink-0 w-12 text-right">
                            {timeStr
                              ? <span className="text-sm font-semibold text-slate-700 tabular-nums">{timeStr}</span>
                              : <span className="text-xs text-slate-400 font-medium">Dia todo</span>
                            }
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${typeColor}`}>
                                {typeLabel}
                              </span>
                              <span className="text-sm font-semibold text-slate-800 truncate">{ev.title}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {client && (
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                  <User className="w-3 h-3" />
                                  {client}
                                </span>
                              )}
                              {resp && (
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                  <Briefcase className="w-3 h-3" />
                                  {resp}
                                </span>
                              )}
                            </div>
                          </div>

                          <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Calendário */}
      <div className={`bg-[#f8f7f5] rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden${showCronograma ? ' hidden' : ''}`}>
        <div className="calendar-container">
          <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView="dayGridMonth"
              locale={ptLocale}
              timeZone="local"
              headerToolbar={false}
              contentHeight="auto"
              aspectRatio={1.35}
              customButtons={{
                calendarExpand: {
                  text: 'Expandir',
                  click: () => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  },
                },
                calendarFilter: {
                  text: 'Filtrar',
                  click: () => {
                    setLegendExpanded((prev) => !prev);
                  },
                },
              }}
              buttonText={{
                today: 'Hoje',
                month: 'Mês',
                week: 'Semana',
                day: 'Dia',
                list: 'Lista',
              }}
              height="auto"
              events={allEvents}
              eventClick={handleEventClick}
              dateClick={handleDateClick}
              eventContent={renderEventContent}
              eventClassNames={(arg) => searchHighlightId && arg.event.id === searchHighlightId ? ['calendar-event--search-pulse'] : []}
              eventDisplay="block"
              datesSet={(arg) => {
                setCalendarTitle(arg.view.title);
                setCalendarView(arg.view.type as typeof calendarView);
              }}
              editable={false}
              selectable={true}
              selectMirror={true}
              dayMaxEvents={false}
              eventOrder={(a: any, b: any) => {
                const aHasTime = a._hasTime === true;
                const bHasTime = b._hasTime === true;
                if (aHasTime && !bHasTime) return -1;
                if (!aHasTime && bHasTime) return 1;
                return (a.start ?? 0) - (b.start ?? 0);
              }}
              weekends={true}
              firstDay={1}
              slotMinTime="08:00:00"
              slotMaxTime="20:00:00"
              allDaySlot={true}
              nowIndicator={true}
              dayCellDidMount={handleDayCellDidMount}
            />
          </div>
        </div>

      {/* Botão Flutuante para Novo Compromisso */}
      <button
        onClick={() => openEventForm()}
        className="fixed bottom-[88px] right-4 sm:right-8 w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-110 z-40 flex items-center justify-center group"
        title="Criar novo compromisso"
      >
        <CalendarIcon className="w-5 h-5 sm:w-6 sm:h-6 group-hover:scale-110 transition-transform" />
        <div className="absolute -top-10 sm:-top-12 right-0 bg-slate-900 text-white text-[10px] sm:text-xs px-2 sm:px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden sm:block">
          Novo Compromisso
        </div>
      </button>

      {/* Modal de Detalhes do Evento */}
      <Modal
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title ?? ''}
        eyebrow="Compromisso"
        icon={<CalendarIcon className="w-4 h-4" />}
        size="md"
        zIndex={70}
        subtitle={selectedEvent ? (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {selectedEvent.extendedProps.type && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                selectedEvent.extendedProps.type === 'deadline'    ? 'bg-blue-50 text-blue-700 border-blue-200' :
                selectedEvent.extendedProps.type === 'hearing'     ? 'bg-red-50 text-red-700 border-red-200' :
                selectedEvent.extendedProps.type === 'requirement' ? 'bg-orange-50 text-orange-800 border-orange-300' :
                selectedEvent.extendedProps.type === 'payment'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                selectedEvent.extendedProps.type === 'meeting'     ? 'bg-teal-50 text-teal-700 border-teal-200' :
                selectedEvent.extendedProps.type === 'pericia'     ? 'bg-purple-50 text-purple-700 border-purple-200' :
                selectedEvent.extendedProps.type === 'personal'    ? 'bg-slate-200 text-slate-700 border-slate-300' :
                'bg-slate-100 text-slate-600 border-[#e7e5df]'
              }`}>
                {eventTypeLabels[selectedEvent.extendedProps.type as EventType] ?? selectedEvent.extendedProps.type}
              </span>
            )}
            {selectedEvent.extendedProps.status && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                selectedEvent.extendedProps.status === 'concluido' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                selectedEvent.extendedProps.status === 'cancelado' ? 'bg-red-50 text-red-700 border-red-200' :
                'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {selectedEvent.extendedProps.status === 'concluido' ? 'Concluído' :
                 selectedEvent.extendedProps.status === 'cancelado' ? 'Cancelado' : 'Pendente'}
              </span>
            )}
            {selectedEventModuleLabel && (
              <span className="inline-flex items-center rounded-full bg-slate-100 border border-[#e7e5df] px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {selectedEventModuleLabel}
              </span>
            )}
          </div>
        ) : undefined}
        footer={selectedEvent ? (
          <div className="flex items-center justify-between gap-2 w-full">
            {selectedEvent.extendedProps.calendarEventId ? (
              <button
                type="button"
                onClick={handleDeleteSelectedEvent}
                disabled={savingEvent}
                className="shrink-0 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition disabled:opacity-50"
              >
                Excluir
              </button>
            ) : <span />}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="shrink-0 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition"
              >
                Fechar
              </button>
              {canCreateLinkedEvent && (
                <button
                  type="button"
                  onClick={() => {
                    const startDate = selectedEvent.start ? new Date(selectedEvent.start) : new Date();
                    const validDate = !Number.isNaN(startDate.getTime());
                    openEventForm({
                      title: selectedEvent.title,
                      date: validDate ? formatDateInputValue(startDate) : '',
                      time: !selectedEvent.allDay && validDate ? formatTimeInputValue(startDate) : '',
                      type: (selectedEvent.extendedProps.type as EventType) || 'meeting',
                      description: selectedEvent.extendedProps.description ?? '',
                      client_id: selectedEvent.extendedProps.data?.client_id ?? '',
                    });
                    setSelectedEvent(null);
                  }}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition"
                >
                  <Plus className="w-3 h-3" />
                  Criar na agenda
                </button>
              )}
              {selectedEvent.extendedProps.moduleLink && (
                <button
                  type="button"
                  onClick={() => handleNavigateToModule(
                    selectedEvent.extendedProps.moduleLink,
                    selectedEvent.extendedProps.entityId
                  )}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium transition"
                >
                  <ArrowUpRight className="w-3 h-3" />
                  Ir para módulo
                </button>
              )}
              {showEditButton && (
                <button
                  type="button"
                  onClick={handleEditSelectedEvent}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium transition"
                >
                  <Check className="w-3 h-3" />
                  {editButtonLabel}
                </button>
              )}
            </div>
          </div>
        ) : undefined}
      >
        {selectedEvent && (
        <ModalBody className="px-5 py-4">

          {/* ── Resumo compacto ── */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">

              {/* Data/Hora */}
              <div className="flex items-start gap-2">
                <CalendarIcon className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Data e hora</p>
                  <p className="text-xs font-semibold text-slate-800 mt-0.5">
                    {selectedEvent.start ? formatDateTime(new Date(selectedEvent.start).toISOString()) : '—'}
                  </p>
                  {selectedEvent.end && (
                    <p className="text-[10px] text-slate-400 mt-0.5">até {formatDateTime(new Date(selectedEvent.end).toISOString())}</p>
                  )}
                </div>
              </div>

              {/* Cliente */}
              {selectedEvent.extendedProps.clientName && (
                <div className="flex items-start gap-2 min-w-0">
                  <User className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cliente</p>
                    {selectedEvent.extendedProps.clientId ? (
                      <button
                        type="button"
                        onClick={() => handleNavigateToModule('clientes', selectedEvent.extendedProps.clientId)}
                        className="text-xs font-semibold text-amber-600 hover:underline text-left truncate max-w-full transition mt-0.5 block"
                      >
                        {selectedEvent.extendedProps.clientName}
                      </button>
                    ) : (
                      <p className="text-xs font-semibold text-slate-800 truncate mt-0.5">{selectedEvent.extendedProps.clientName}</p>
                    )}
                    {selectedEvent.extendedProps.clientPhone && (
                      <p className="text-[10px] text-slate-400">{selectedEvent.extendedProps.clientPhone}</p>
                    )}
                  </div>
                  {selectedEvent.extendedProps.clientPhone && (
                    <a
                      href={`tel:${selectedEvent.extendedProps.clientPhone}`}
                      className="w-6 h-6 flex items-center justify-center rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition shrink-0 mt-0.5"
                      title="Ligar"
                    >
                      <Phone className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Processo */}
              {selectedEventProcess && (
                <div className="flex items-start gap-2 min-w-0">
                  <div className="w-3.5 mt-1.5 shrink-0 flex justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 block" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Processo</p>
                    <p className="text-xs font-semibold text-slate-800 font-mono truncate mt-0.5">{selectedEventProcess.process_code}</p>
                    {selectedEventProcess.practice_area && (
                      <p className="text-[10px] text-slate-400 capitalize">{selectedEventProcess.practice_area}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Vara / Órgão */}
              {(selectedEventProcessOrgao || selectedEventDjenData?.nome_orgao) && (
                <div className="flex items-start gap-2 min-w-0">
                  <div className="w-3.5 mt-1.5 shrink-0 flex justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 block" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vara / Tribunal</p>
                    <p className="text-xs font-semibold text-slate-700 truncate mt-0.5">
                      {selectedEventProcessOrgao || selectedEventDjenData?.nome_orgao}
                    </p>
                  </div>
                </div>
              )}

              {/* Prioridade */}
              {selectedEvent.extendedProps.priority && (
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    selectedEvent.extendedProps.priority === 'urgente' ? 'bg-red-600' :
                    selectedEvent.extendedProps.priority === 'alta' ? 'bg-amber-500' :
                    selectedEvent.extendedProps.priority === 'baixa' ? 'bg-slate-300' :
                    'bg-slate-400'
                  }`} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Prioridade</p>
                    <p className="text-xs font-semibold text-slate-800 capitalize mt-0.5">{selectedEvent.extendedProps.priority}</p>
                  </div>
                </div>
              )}

              {/* Modalidade */}
              {(() => {
                const mode = (selectedEvent.extendedProps.data as any)?.event_mode as string | null | undefined;
                if (!mode) return null;
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{mode === 'online' ? '📹' : '📍'}</span>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Modalidade</p>
                      <p className="text-xs font-semibold text-slate-800 capitalize mt-0.5">{mode === 'online' ? 'Online' : 'Presencial'}</p>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>

          {/* ── Verificação DJEN ── */}
          {['hearing', 'pericia'].includes(selectedEvent.extendedProps.type ?? '') && (() => {
            const djenStatus = selectedEvent.extendedProps.djenStatus as string | undefined;
            const eventDateObj = selectedEvent.start ? new Date(selectedEvent.start) : null;
            const eventDate = eventDateObj
              ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(eventDateObj)
              : null;
            const eventTime = eventDateObj
              ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' }).format(eventDateObj)
              : null;
            const eventMode = (selectedEvent.extendedProps.data as any)?.event_mode as string | null | undefined;
            const eventData = selectedEvent.extendedProps.data as any;
            const calendarEventId = selectedEvent.extendedProps.calendarEventId as string | undefined;
            const manualConfirmedAt = eventData?.manual_confirmed_at as string | null | undefined;
            const manualNote = eventData?.manual_note as string | null | undefined;

            const StatusIcon =
              djenStatus === 'confirmed'        ? ShieldCheck :
              djenStatus === 'confirmed_manual' ? UserCheck :
              djenStatus === 'divergence'       ? AlertTriangle :
                                                  HelpCircle;
            const iconColor =
              djenStatus === 'confirmed'        ? 'text-green-600' :
              djenStatus === 'confirmed_manual' ? 'text-green-600' :
              djenStatus === 'divergence'       ? 'text-amber-500' :
                                                  'text-slate-400';
            const badgeStyle =
              djenStatus === 'confirmed'        ? 'bg-green-100 text-green-700 ring-green-200' :
              djenStatus === 'confirmed_manual' ? 'bg-green-100 text-green-700 ring-green-200' :
              djenStatus === 'divergence'       ? 'bg-amber-100 text-amber-700 ring-amber-200' :
                                                  'bg-slate-100 text-slate-500 ring-slate-200';
            const statusLabel =
              djenStatus === 'confirmed'        ? 'Confirmado' :
              djenStatus === 'confirmed_manual' ? 'Confirmado (manual)' :
              djenStatus === 'divergence'       ? 'Divergência' :
                                                  'Não confirmado';
            const borderColor =
              djenStatus === 'confirmed'        ? 'border-green-100' :
              djenStatus === 'confirmed_manual' ? 'border-green-100' :
              djenStatus === 'divergence'       ? 'border-amber-100' :
                                                  'border-slate-100';

            return (
              <div className={`rounded-xl border bg-[#f8f7f5] px-3 py-2.5 space-y-2 ${borderColor}`}>

                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Verificação DJEN</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${badgeStyle}`}>
                    {statusLabel}
                  </span>
                </div>

                {/* Tabela de comparação compacta */}
                {eventDate && (
                  <div className="rounded-lg overflow-hidden border border-slate-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="text-left px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide w-[26%]">Campo</th>
                          <th className="text-right px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Agenda</th>
                          <th className="text-right px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">DJEN</th>
                          <th className="w-8 px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {/* Data */}
                        <tr>
                          <td className="px-2 py-1.5 text-slate-500">Data</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{eventDate}</td>
                          <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${
                            djenStatus === 'confirmed' ? 'text-green-700' :
                            djenStatus === 'divergence' ? 'text-amber-700' : 'text-slate-400'
                          }`}>
                            {selectedEventDjenData?.datesFound[0] ?? '—'}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {djenStatus === 'confirmed'
                              ? <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                              : djenStatus === 'divergence'
                              ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" />
                              : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                        {/* Hora */}
                        {eventTime && (
                          <tr>
                            <td className="px-2 py-1.5 text-slate-500">Hora</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{eventTime}</td>
                            <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${
                              selectedEventDjenData?.timesFound.length ? 'text-green-700' : 'text-slate-400'
                            }`}>
                              {selectedEventDjenData?.timesFound.join(' / ') ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {selectedEventDjenData?.timesFound.length
                                ? <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        )}
                        {/* Modalidade */}
                        {(eventMode || selectedEventDjenData?.detectedMode) && (
                          <tr className={
                            eventMode && selectedEventDjenData?.detectedMode && eventMode !== selectedEventDjenData.detectedMode
                              ? 'bg-amber-50'
                              : ''
                          }>
                            <td className="px-2 py-1.5 text-slate-500">Modalidade</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-slate-700">
                              {eventMode === 'online' ? 'Online' : eventMode === 'presencial' ? 'Presencial' : '—'}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-semibold ${
                              !selectedEventDjenData?.detectedMode ? 'text-slate-400' :
                              eventMode === selectedEventDjenData.detectedMode ? 'text-green-700' : 'text-amber-700'
                            }`}>
                              {selectedEventDjenData?.detectedMode === 'online' ? 'Online' :
                               selectedEventDjenData?.detectedMode === 'presencial' ? 'Presencial' : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {eventMode && selectedEventDjenData?.detectedMode
                                ? eventMode === selectedEventDjenData.detectedMode
                                  ? <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                                  : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" />
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Meta DJEN compacto */}
                {selectedEventDjenData && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1">
                    {selectedEventDjenData.numero_processo && (
                      <span className="text-[10px] text-slate-400">
                        Proc. <span className="font-semibold text-slate-600 tabular-nums">{selectedEventDjenData.numero_processo}</span>
                      </span>
                    )}
                    {selectedEventDjenData.sigla_tribunal && (
                      <span className="text-[10px] text-slate-400">
                        {selectedEventDjenData.sigla_tribunal}
                        {selectedEventDjenData.nome_orgao ? ` · ${selectedEventDjenData.nome_orgao}` : ''}
                      </span>
                    )}
                    {selectedEventDjenData.data_disponibilizacao && (
                      <span className="text-[10px] text-slate-400">
                        Pub. <span className="font-semibold text-slate-600">
                          {new Intl.DateTimeFormat('pt-BR').format(new Date(selectedEventDjenData.data_disponibilizacao))}
                        </span>
                      </span>
                    )}
                  </div>
                )}

                {/* Trecho da intimação */}
                {selectedEventDjenData?.texto && (
                  <details className="group">
                    <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition select-none">
                      <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                      Ver trecho da intimação
                    </summary>
                    <div className="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-50 border border-[#e7e5df] px-2.5 py-2">
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {(() => {
                          const snippet = selectedEventDjenData.texto.slice(0, 800);
                          const pattern = /(\d{2}\/\d{2}\/\d{4}|\d{1,2}[h:]\d{2}(?:min)?(?:h)?|videoconferência|presencial|virtual|zoom|teams)/gi;
                          const parts = snippet.split(pattern);
                          return parts.map((part, i) =>
                            pattern.test(part)
                              ? <strong key={i} className="text-slate-900 font-bold">{part}</strong>
                              : <span key={i}>{part}</span>
                          );
                        })()}
                        {selectedEventDjenData.texto.length > 800 ? '…' : ''}
                      </p>
                    </div>
                  </details>
                )}

                {/* Sem DJEN */}
                {(!djenStatus || djenStatus === 'unconfirmed') && !selectedEventDjenData && (
                  <p className="text-[10px] text-slate-400 italic text-center py-0.5">
                    Nenhuma intimação DJEN localizada para este evento.
                  </p>
                )}

                {/* ── Confirmação manual (audiência designada em ata) ── */}
                {calendarEventId && (
                  <div className="pt-1 border-t border-slate-100 space-y-1.5">
                    {manualConfirmedAt && (
                      <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
                        <UserCheck className="w-3 h-3 mt-0.5 shrink-0 text-green-600" />
                        <span>
                          Confirmado manualmente em{' '}
                          <span className="font-semibold text-slate-700">
                            {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(manualConfirmedAt))}
                          </span>
                          {manualNote ? <> — <span className="italic">{manualNote}</span></> : null}
                        </span>
                      </div>
                    )}

                    {/* Despacho novo após a confirmação manual: alerta sem alterar nada */}
                    {djenStatus === 'divergence' && manualConfirmedAt && (
                      <p className="text-[10px] text-amber-700 bg-amber-50 rounded-md px-2 py-1">
                        ⚠️ Nova publicação no DJEN após sua confirmação — a nova data prevalece. Confira e atualize o compromisso.
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      {(djenStatus === 'divergence' || djenStatus === 'unconfirmed') && (
                        <button
                          type="button"
                          disabled={manualBusy}
                          onClick={() => handleManualConfirm(calendarEventId)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium transition"
                        >
                          <UserCheck className="w-3 h-3" />
                          Confirmar manualmente
                        </button>
                      )}
                      {manualConfirmedAt && (
                        <button
                          type="button"
                          disabled={manualBusy}
                          onClick={() => handleManualUnconfirm(calendarEventId)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-xs font-medium transition"
                        >
                          Desfazer confirmação
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Correspondente ── */}
          {selectedEventRepresentativeAppointments.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Correspondente</p>
              {selectedEventRepresentativeAppointments.map((appointment) => {
                const representative = appointment.representative;
                const whatsappUrl = buildWhatsAppUrl(representative?.phone);
                const representativeName = representative?.full_name || 'Não encontrado';
                return (
                  <div key={appointment.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                          {representativeName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">{representativeName}</p>
                          <p className="text-[10px] text-slate-500">{representative?.oab_number || 'OAB não informada'}</p>
                        </div>
                      </div>
                      {whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition shrink-0"
                        >
                          <MessageCircle className="w-3 h-3" />
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">Sem telefone</span>
                      )}
                    </div>
                    {appointment.diligence_location && (
                      <div className="mt-2 flex items-center gap-2 border-t border-[#e7e5df] pt-2 text-xs text-slate-500">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{appointment.diligence_location}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Botão Registrar Pagamento ── */}
          {(() => {
            const desc = selectedEvent.extendedProps.description as string | undefined;
            if (!desc) return null;
            const agreementMatch = desc.match(/\[agreement_id:([^\]]+)\]/);
            const installmentMatch = desc.match(/\[installment:(\d+)\]/);
            if (!agreementMatch || !installmentMatch) return null;
            const agreementId = agreementMatch[1];
            const instNum = parseInt(installmentMatch[1], 10);
            return (
              <button
                type="button"
                onClick={() => handleNavigateToModule('financeiro', agreementId, { installmentNumber: instNum })}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"
              >
                <DollarSign className="w-4 h-4" />
                Registrar Pagamento
              </button>
            );
          })()}

          {/* ── Descrição ── */}
          {selectedEvent.extendedProps.description && (
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Descrição</p>
              <p className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed">
                {(selectedEvent.extendedProps.description as string)
                  .replace(/\[agreement_id:[^\]]+\]/g, '')
                  .replace(/\[installment:\d+\]/g, '')
                  .replace(/\[inadimplencia\]/g, '')
                  .split('\n')
                  .filter(line => !/Valor:\s*R\$\s*(NaN|undefined|null|--)/.test(line))
                  .join('\n')
                  .trim()}
              </p>
            </div>
          )}

          {/* ── Detalhes extras ── */}
          {selectedEventDataDetails.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Detalhes</p>
              {selectedEventDataDetails.map((detail) => (
                <div key={`${detail.label}-${detail.value}`} className="flex justify-between gap-3">
                  <span className="shrink-0 text-xs text-slate-500">{detail.label}</span>
                  <span className="text-right">
                    <span className="block text-xs font-semibold text-slate-700">{detail.value}</span>
                    {detail.secondaryValue && (
                      <span className="mt-0.5 block text-[10px] text-slate-500">{detail.secondaryValue}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

        </ModalBody>
        )}
      </Modal>

      {/* Modal de Criação/Edição de Compromisso */}
      <Modal
        open={isCreateModalOpen}
        onClose={handleCloseCreateModal}
        title={editingEventId ? 'Editar Compromisso' : 'Novo Compromisso'}
        eyebrow="Agenda"
        icon={<CalendarIcon className="w-4 h-4" />}
        size="lg"
        zIndex={70}
        footer={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-h-10 items-center">
              {editingEventId && (
                <button
                  type="button"
                  onClick={handleDeleteEvent}
                  className="px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition disabled:opacity-50"
                  disabled={savingEvent}
                >
                  Excluir
                </button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCloseCreateModal}
                className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
                disabled={savingEvent}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmitEvent}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-amber-200 transition hover:bg-amber-600 disabled:opacity-60 sm:w-auto"
                disabled={savingEvent}
              >
                {savingEvent && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingEventId ? 'Salvar alterações' : 'Criar compromisso'}
              </button>
            </div>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-6 lg:grid-cols-12">

                {/* Título — coluna inteira */}
                <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Título <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={newEventForm.title}
                    onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                    placeholder="Ex: Reunião com cliente"
                    autoFocus
                  />
                </div>

                {/* Data */}
                <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Data <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={newEventForm.date}
                    onChange={(e) => setNewEventForm({ ...newEventForm, date: e.target.value })}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition appearance-none"
                    required
                  />
                </div>

                {/* Horário */}
                <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={newEventForm.time}
                    onChange={(e) => setNewEventForm({ ...newEventForm, time: e.target.value })}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition appearance-none"
                  />
                </div>

                {/* Modalidade — select compacto ao lado de Data/Horário */}
                <div className="col-span-1 sm:col-span-2 lg:col-span-6">
                  {(['hearing', 'meeting', 'pericia'] as EventType[]).includes(newEventForm.type) && (
                    <>
                      <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                        Modalidade
                      </label>
                      <select
                        value={newEventForm.event_mode}
                        onChange={(e) => setNewEventForm(prev => ({ ...prev, event_mode: e.target.value as '' | 'presencial' | 'online' }))}
                        className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition appearance-none"
                      >
                        <option value="">Não definida</option>
                        <option value="presencial">Presencial</option>
                        <option value="online">Online</option>
                      </select>
                    </>
                  )}
                </div>

                {/* Tipo — coluna inteira */}
                <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Tipo
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                    {([
                      { value: 'meeting',     active: 'bg-teal-500 text-white border-teal-500',         idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-teal-400 hover:text-teal-600' },
                      { value: 'deadline',    active: 'bg-blue-500 text-white border-blue-500',         idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-blue-400 hover:text-blue-600' },
                      { value: 'hearing',     active: 'bg-red-500 text-white border-red-500',           idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-red-400 hover:text-red-600' },
                      { value: 'pericia',     active: 'bg-purple-500 text-white border-purple-500',     idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-purple-400 hover:text-purple-600' },
                      { value: 'payment',     active: 'bg-emerald-500 text-white border-emerald-500',   idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-emerald-400 hover:text-emerald-600' },
                      { value: 'requirement', active: 'bg-orange-500 text-white border-orange-500',     idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-orange-400 hover:text-orange-600' },
                      { value: 'personal',    active: 'bg-slate-500 text-white border-slate-500',       idle: 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-slate-400 hover:text-slate-600' },
                    ] as const).filter(({ value }) => !inactiveEventTypeKeys.has(value)).map(({ value, active, idle }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setNewEventForm(prev => ({
                          ...prev,
                          type: value,
                          // Pessoal não tem vínculo; troca de tipo limpa seleção
                          ...(value === 'personal' ? { process_id: '', requirement_id: '' } : {}),
                          // Ao sair de perícia, limpa o requerimento
                          ...(value !== 'pericia' ? { requirement_id: '', pericia_link_type: 'process' as const } : {}),
                        }))}
                        className={`py-1.5 rounded-lg text-xs font-semibold border transition-all text-center ${
                          newEventForm.type === value ? active : idle
                        }`}
                      >
                        {eventTypeLabels[value] ?? value}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cliente | Processo | Responsável — linha fixa */}
                <div className="col-span-1 border-t border-slate-100 pt-1 sm:col-span-6 lg:col-span-12">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">

                    {/* ── Cliente ── */}
                    <div className="col-span-1">
                      <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                        Cliente <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                      </label>
                      <div ref={clientSearchRef} className="relative">
                        {newEventForm.client_id ? (
                          /* Cliente cadastrado vinculado — badge verde */
                          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-300 rounded-xl">
                            <Link className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="flex-1 text-sm font-semibold text-emerald-800 truncate">
                              {linkedClient?.full_name || createFormInitialClientName}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full shrink-0">
                              Cliente
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setNewEventForm(prev => ({ ...prev, client_id: '', client_name: '', process_id: '', requirement_id: '' }));
                                setCreateFormInitialClientName('');
                                setClientSearchTerm('');
                              }}
                              className="w-5 h-5 flex items-center justify-center text-emerald-500 hover:text-red-500 hover:bg-red-50 rounded-full transition shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          /* Input livre com busca */
                          <>
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                              <input
                                type="text"
                                value={clientSearchTerm || newEventForm.client_name}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setClientSearchTerm(v);
                                  setNewEventForm(prev => ({ ...prev, client_name: v }));
                                  setClientSearchOpen(true);
                                }}
                                onFocus={() => { if (clientSearchTerm.trim()) setClientSearchOpen(true); }}
                                placeholder="Nome ou buscar..."
                                className="w-full pl-9 pr-3 rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] text-[13px] placeholder:text-slate-400 transition"
                              />
                            </div>
                            {clientSearchOpen && (clientSearchResults.length > 0 || clientSearchTerm.trim().length >= 1) && (
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#e7e5df] rounded-xl shadow-lg z-50 overflow-hidden">
                                {clientSearchResults.length > 0 && (
                                  <>
                                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Clientes cadastrados</p>
                                    {clientSearchResults.map(c => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          setNewEventForm(prev => ({ ...prev, client_id: c.id, client_name: '', process_id: '', requirement_id: '' }));
                                          setCreateFormInitialClientName(c.full_name);
                                          setClientSearchTerm('');
                                          setClientSearchOpen(false);
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-amber-50 text-left transition"
                                      >
                                        <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-bold shrink-0">
                                          {c.full_name?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium text-slate-800 truncate">{c.full_name}</p>
                                          {c.cpf_cnpj && <p className="text-xs text-slate-400">{c.cpf_cnpj}</p>}
                                        </div>
                                        <Link className="w-3 h-3 text-emerald-500 ml-auto shrink-0" />
                                      </button>
                                    ))}
                                    <div className="border-t border-slate-100" />
                                  </>
                                )}
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setClientSearchOpen(false);
                                    setIsClientFormOpen(true);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-emerald-50 text-left transition text-emerald-700"
                                >
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

                    {/* ── Processo / Requerimento — sempre na mesma coluna ── */}
                    {newEventForm.type !== 'personal' && (() => {
                      const clientProcesses = processes.filter(p => p.client_id === newEventForm.client_id);
                      const selectedProcess = clientProcesses.find(p => p.id === newEventForm.process_id);
                      const clientRequirements = requirements.filter(r => r.client_id === newEventForm.client_id);
                      const selectedReq = clientRequirements.find(r => r.id === newEventForm.requirement_id);
                      const showReq = newEventForm.type === 'pericia' && newEventForm.pericia_link_type === 'requirement';
                      return (
                        <div className="col-span-1">
                          {/* Toggle Processo / Requerimento — apenas para Perícia com cliente selecionado */}
                          {newEventForm.type === 'pericia' && newEventForm.client_id && (
                            <div className="mb-1.5 grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => setNewEventForm(prev => ({ ...prev, pericia_link_type: 'process', requirement_id: '' }))}
                                className={`flex-1 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                                  newEventForm.pericia_link_type === 'process'
                                    ? 'bg-purple-500 text-white border-purple-500'
                                    : 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-purple-400'
                                }`}
                              >
                                Processo jud.
                              </button>
                              <button
                                type="button"
                                onClick={() => setNewEventForm(prev => ({ ...prev, pericia_link_type: 'requirement', process_id: '' }))}
                                className={`flex-1 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                                  newEventForm.pericia_link_type === 'requirement'
                                    ? 'bg-purple-500 text-white border-purple-500'
                                    : 'bg-[#f8f7f5] text-slate-600 border-[#e7e5df] hover:border-purple-400'
                                }`}
                              >
                                Req. adm.
                              </button>
                            </div>
                          )}
                          <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                            {showReq ? 'Requerimento' : 'Processo'}{' '}
                            <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                          </label>
                          {!newEventForm.client_id ? (
                            <select
                              disabled
                              className="w-full rounded border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] text-slate-400 opacity-60 cursor-not-allowed"
                            >
                              <option>— Sem vínculo —</option>
                            </select>
                          ) : showReq ? (
                            selectedReq ? (
                              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-300 rounded-xl">
                                <span className="flex-1 text-sm font-semibold text-purple-800 truncate">{selectedReq.beneficiary}</span>
                                {selectedReq.protocol && <span className="text-[10px] font-mono text-purple-600 shrink-0">{selectedReq.protocol}</span>}
                                <button
                                  type="button"
                                  onClick={() => setNewEventForm(prev => ({ ...prev, requirement_id: '' }))}
                                  className="w-5 h-5 flex items-center justify-center text-purple-400 hover:text-red-500 hover:bg-red-50 rounded-full transition shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <select
                                value={newEventForm.requirement_id}
                                onChange={e => setNewEventForm(prev => ({ ...prev, requirement_id: e.target.value }))}
                                className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition appearance-none"
                              >
                                <option value="">— Sem vínculo —</option>
                                {clientRequirements.length === 0 && (
                                  <option disabled>Nenhum requerimento para este cliente</option>
                                )}
                                {clientRequirements.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.beneficiary}{r.protocol ? ` · ${r.protocol}` : ''}
                                  </option>
                                ))}
                              </select>
                            )
                          ) : selectedProcess ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-300 rounded-xl">
                              <span className="flex-1 text-sm font-semibold text-blue-800 truncate font-mono">{selectedProcess.process_code}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full shrink-0 capitalize">{selectedProcess.practice_area}</span>
                              <button
                                type="button"
                                onClick={() => setNewEventForm(prev => ({ ...prev, process_id: '' }))}
                                className="w-5 h-5 flex items-center justify-center text-blue-400 hover:text-red-500 hover:bg-red-50 rounded-full transition shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <select
                              value={newEventForm.process_id}
                              onChange={e => setNewEventForm(prev => ({ ...prev, process_id: e.target.value }))}
                              className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] transition appearance-none"
                            >
                              <option value="">— Sem vínculo —</option>
                              {clientProcesses.length === 0 && (
                                <option disabled>Nenhum processo para este cliente</option>
                              )}
                              {clientProcesses.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.process_code}{p.practice_area ? ` · ${p.practice_area}` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Responsável — oculto para eventos pessoais ── */}
                    {newEventForm.type !== 'personal' && (
                      <div className="col-span-1">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            Responsável <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                          </label>
                          {newEventForm.responsible_id && (
                            <span className="text-[11px] font-semibold text-orange-500 truncate max-w-[100px]">
                              {(members.find(m => m.id === newEventForm.responsible_id || m.user_id === newEventForm.responsible_id)?.name || '').split(' ')[0]}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 bg-slate-50 rounded-xl border border-[#e7e5df] px-2 py-2 min-h-[42px] items-center">
                          {[...members].sort((a, b) => {
                            const rank = (m: Profile) => {
                              const r = (m.role || '').toLowerCase();
                              if (r.includes('admin')) return 0;
                              if (r.includes('advogad')) return 1;
                              return 2;
                            };
                            return rank(a) - rank(b);
                          }).map((member) => {
                            const memberId = member.user_id || member.id;
                            const isSelected = newEventForm.responsible_id === memberId;
                            const hue = getMemberHue(member.name || '');
                            const initials = getMemberInitials(member.name || '');
                            return (
                              <button
                                key={member.id}
                                type="button"
                                title={member.name}
                                onClick={() => setNewEventForm(prev => ({
                                  ...prev,
                                  responsible_id: isSelected ? '' : memberId,
                                }))}
                                className="relative group transition-transform hover:z-10 hover:scale-110 focus:outline-none"
                              >
                                <div
                                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${
                                    isSelected ? 'ring-[3px] ring-orange-500 ring-offset-1' : 'ring-1 ring-slate-200'
                                  }`}
                                  style={{
                                    background: `hsl(${hue}, 50%, ${isSelected ? '85%' : '93%'})`,
                                    color: `hsl(${hue}, 45%, 30%)`,
                                  }}
                                >
                                  {initials}
                                  {(member as any).avatar_url && (
                                    <img
                                      src={(member as any).avatar_url}
                                      alt={member.name}
                                      loading="eager"
                                      decoding="async"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                      className={`absolute inset-0 w-full h-full rounded-full object-cover transition-all ${
                                        isSelected ? '' : 'grayscale-[40%] group-hover:grayscale-0'
                                      }`}
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
                          {members.length === 0 && (
                            <p className="text-xs text-slate-400 italic">Nenhum membro.</p>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* Privacidade / Compartilhamento — coluna inteira */}
                <div className="col-span-1 border-t border-slate-100 pt-3 sm:col-span-6 lg:col-span-12">
                  {newEventForm.type === 'personal' ? (
                    /* Pessoal: sempre privado, pergunta só quem compartilhar */
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          <Users className="w-3 h-3 text-slate-500" />
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          Compartilhar com alguém?
                        </p>
                        {newEventForm.shared_with_ids.length > 0 && (
                          <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {newEventForm.shared_with_ids.length} pessoa(s)
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[...members]
                          .filter(m => (m.user_id || m.id) !== (user?.id))
                          .sort((a, b) => {
                            const rank = (m: Profile) => {
                              const r = (m.role || '').toLowerCase();
                              if (r.includes('admin')) return 0;
                              if (r.includes('advogad')) return 1;
                              return 2;
                            };
                            return rank(a) - rank(b);
                          })
                          .map(member => {
                            const memberId = member.user_id || member.id;
                            const isShared = newEventForm.shared_with_ids.includes(memberId);
                            const hue = getMemberHue(member.name || '');
                            const initials = getMemberInitials(member.name || '');
                            return (
                              <button
                                key={member.id}
                                type="button"
                                title={member.name}
                                onClick={() => setNewEventForm(prev => ({
                                  ...prev,
                                  shared_with_ids: isShared
                                    ? prev.shared_with_ids.filter(id => id !== memberId)
                                    : [...prev.shared_with_ids, memberId],
                                }))}
                                className="relative group transition-transform hover:scale-110 focus:outline-none"
                              >
                                <div
                                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${
                                    isShared ? 'ring-[3px] ring-slate-500 ring-offset-1' : 'ring-1 ring-slate-200 opacity-60 group-hover:opacity-100'
                                  }`}
                                  style={{
                                    background: `hsl(${hue}, 50%, ${isShared ? '85%' : '93%'})`,
                                    color: `hsl(${hue}, 45%, 30%)`,
                                  }}
                                >
                                  {initials}
                                  {(member as any).avatar_url && (
                                    <img src={(member as any).avatar_url} alt={member.name} loading="eager" decoding="async"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                      className="absolute inset-0 w-full h-full rounded-full object-cover"
                                    />
                                  )}
                                </div>
                                {isShared && (
                                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-slate-500 border-2 border-white flex items-center justify-center">
                                    <Check className="w-1.5 h-1.5 text-white" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ) : (
                    /* Outros tipos: toggle público/privado */
                    <>
                      {/* Visibility toggle card */}
                      <style>{`
                        @keyframes visiBadgePop{0%{transform:scale(.7) rotate(-8deg);opacity:0}60%{transform:scale(1.12) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}
                        @keyframes globeSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
                        @keyframes lockShake{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
                        .visi-icon-public{animation:globeSpin 0.6s ease-out;}
                        .visi-icon-private{animation:lockShake 0.4s ease-out;}
                        .visi-badge{animation:visiBadgePop 0.32s cubic-bezier(.34,1.56,.64,1) both;}
                      `}</style>
                      <button
                        type="button"
                        onClick={() => setNewEventForm(prev => ({ ...prev, is_private: !prev.is_private, shared_with_ids: [] }))}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-all duration-300 active:scale-[.98] ${
                          newEventForm.is_private
                            ? 'bg-amber-50 border-amber-200 shadow-[0_0_0_3px_rgba(251,191,36,.15)]'
                            : 'bg-slate-50 border-[#e7e5df] shadow-[0_0_0_3px_rgba(148,163,184,.10)]'
                        }`}
                      >
                        {/* Ícone + texto */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            key={String(newEventForm.is_private)}
                            className={`visi-badge shrink-0 flex items-center justify-center w-8 h-8 rounded-full shadow-sm ${
                              newEventForm.is_private
                                ? 'bg-amber-100 text-amber-600'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {newEventForm.is_private
                              ? <Lock key="lock" className="visi-icon-private w-4 h-4" />
                              : <Globe key="globe" className="visi-icon-public w-4 h-4" />}
                          </span>
                          <div className="min-w-0 text-left">
                            <p className={`text-xs font-bold ${newEventForm.is_private ? 'text-amber-700' : 'text-slate-600'}`}>
                              {newEventForm.is_private ? 'Privado' : 'Público'}
                            </p>
                            <p className={`text-[11px] truncate ${newEventForm.is_private ? 'text-amber-500' : 'text-slate-400'}`}>
                              {newEventForm.is_private
                                ? newEventForm.shared_with_ids.length > 0
                                  ? `visível para ${newEventForm.shared_with_ids.length} pessoa(s)`
                                  : 'só você vê este evento'
                                : 'todos do escritório veem'}
                            </p>
                          </div>
                        </div>
                        {/* Toggle pill */}
                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${newEventForm.is_private ? 'bg-amber-400' : 'bg-slate-300'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-[#f8f7f5] shadow-md transition-transform duration-300 ${newEventForm.is_private ? 'translate-x-6' : 'translate-x-1'}`} />
                          </div>
                          <span className={`text-[9px] font-semibold whitespace-nowrap ${newEventForm.is_private ? 'text-amber-400' : 'text-slate-400'}`}>
                            {newEventForm.is_private ? 'Tornar público' : 'Tornar privado'}
                          </span>
                        </div>
                      </button>
                      {newEventForm.is_private && (
                        <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Compartilhar com</p>
                            {newEventForm.shared_with_ids.length > 0 && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 animate-in fade-in duration-150">
                                {newEventForm.shared_with_ids.length} selecionado{newEventForm.shared_with_ids.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {[...members]
                              .filter(m => (m.user_id || m.id) !== (user?.id))
                              .sort((a, b) => {
                                const rank = (m: Profile) => {
                                  const r = (m.role || '').toLowerCase();
                                  if (r.includes('admin')) return 0;
                                  if (r.includes('advogad')) return 1;
                                  return 2;
                                };
                                return rank(a) - rank(b);
                              })
                              .map(member => {
                                const memberId = member.user_id || member.id;
                                const isShared = newEventForm.shared_with_ids.includes(memberId);
                                const hue = getMemberHue(member.name || '');
                                const initials = getMemberInitials(member.name || '');
                                return (
                                  <button
                                    key={member.id}
                                    type="button"
                                    title={member.name}
                                    onClick={() => setNewEventForm(prev => ({
                                      ...prev,
                                      shared_with_ids: isShared
                                        ? prev.shared_with_ids.filter(id => id !== memberId)
                                        : [...prev.shared_with_ids, memberId],
                                    }))}
                                    className="relative group transition-transform hover:scale-110 focus:outline-none"
                                  >
                                    <div
                                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${
                                        isShared ? 'ring-[3px] ring-amber-500 ring-offset-1' : 'ring-1 ring-slate-200 opacity-60 group-hover:opacity-100'
                                      }`}
                                      style={{ background: `hsl(${hue}, 50%, ${isShared ? '85%' : '93%'})`, color: `hsl(${hue}, 45%, 30%)` }}
                                    >
                                      {initials}
                                      {(member as any).avatar_url && (
                                        <img src={(member as any).avatar_url} alt={member.name} loading="eager" decoding="async"
                                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                          className="absolute inset-0 w-full h-full rounded-full object-cover"
                                        />
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

                {/* Observações — coluna inteira */}
                <div className="col-span-1 sm:col-span-6 lg:col-span-12">
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Observações <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                  </label>
                  <textarea
                    value={newEventForm.description}
                    onChange={(e) => setNewEventForm({ ...newEventForm, description: e.target.value })}
                    rows={2}
                    className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
                    placeholder="Anotações, detalhes adicionais..."
                  />
                </div>

          </div>{/* fim grid */}
        </ModalBody>
      </Modal>

      {/* Modal de cadastro de novo cliente */}
      <Modal
        open={isClientFormOpen}
        onClose={() => setIsClientFormOpen(false)}
        title="Novo Cliente"
        eyebrow="Clientes"
        icon={<User className="w-4 h-4" />}
        size="xl"
        zIndex={80}
      >
        <ModalBody className="p-0">
          <ClientForm
            client={null}
            prefill={clientSearchTerm.trim() ? { full_name: clientSearchTerm.trim() } : null}
            variant="modal"
            onBack={() => setIsClientFormOpen(false)}
            onSave={(savedClient) => {
              setClients(prev => [savedClient, ...prev]);
              setNewEventForm(prev => ({ ...prev, client_id: savedClient.id, client_name: '' }));
              setCreateFormInitialClientName(savedClient.full_name);
              setClientSearchTerm('');
              setIsClientFormOpen(false);
            }}
          />
        </ModalBody>
      </Modal>

      {/* CSS para FullCalendar */}
      <style>{`
        .calendar-page {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .calendar-container .fc {
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .calendar-container .fc-daygrid-day-number {
          color: #475569;
          font-weight: 700;
          font-size: 0.875rem;
        }
        .calendar-container .fc-col-header-cell-cushion {
          color: #1e293b;
          font-weight: 700;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .calendar-container .fc-col-header-cell {
          background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
          border-color: #e2e8f0;
        }
        .calendar-container .fc-daygrid-day {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          transition: all 0.2s ease;
        }
        .calendar-container .fc-daygrid-day-frame {
          padding: 6px;
          min-height: 100px;
        }
        @media (max-width: 640px) {
          .calendar-container .fc-daygrid-day-frame {
            padding: 3px;
            min-height: 70px;
          }
          .calendar-container .fc-daygrid-day-number {
            font-size: 0.75rem;
          }
          .calendar-container .fc-col-header-cell-cushion {
            font-size: 0.65rem;
            padding: 4px 2px;
          }
          .calendar-container .fc-day-today .fc-daygrid-day-number {
            width: 22px;
            height: 22px;
            font-size: 0.7rem;
          }
          .calendar-event-custom {
            padding: 0.25rem 0.4rem !important;
            font-size: 0.6rem !important;
          }
          .calendar-event-time {
            font-size: 0.55rem !important;
            padding: 0.1rem 0.25rem !important;
          }
        }
        .calendar-container .fc-daygrid-day:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          box-shadow: inset 0 0 0 1px #cbd5e1;
        }
        .calendar-container .fc-day-today {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%) !important;
          border: 2px solid #3b82f6 !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .calendar-container .fc-day-today .fc-daygrid-day-number {
          background: #3b82f6;
          color: white;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
        }
        .calendar-container .fc-scrollgrid {
          border-radius: 1rem;
          border: 2px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .calendar-container .fc-list {
          border-radius: 1rem;
          border: 2px solid #e2e8f0;
        }
        .calendar-container .fc-event {
          border: none !important;
          padding: 0 !important;
        }
        .calendar-container {
          width: 100%;
        }
        .calendar-container .fc-view-harness,
        .calendar-container .fc-view-harness-active,
        .calendar-container .fc-view,
        .calendar-container .fc-daygrid,
        .calendar-container .fc-daygrid-body,
        .calendar-container .fc-scrollgrid {
          width: 100% !important;
        }

        /* Dark mode calendar container styles */
        .dark .calendar-container .fc-theme-standard .fc-scrollgrid {
          border-color: #374151;
        }
        .dark .calendar-container .fc-theme-standard td,
        .dark .calendar-container .fc-theme-standard th {
          border-color: #374151;
        }
        .dark .calendar-container .fc-daygrid-day-number {
          color: #f3f4f6;
        }
        .dark .calendar-container .fc-col-header-cell {
          background-color: #1f2937;
        }
        .dark .calendar-container .fc-col-header-cell-cushion {
          color: #9ca3af;
        }
        .dark .calendar-container .fc-day-today {
          background-color: #1e293b !important;
        }
        .dark .calendar-container .fc-daygrid-day.fc-day-today .fc-daygrid-day-number {
          color: #60a5fa;
        }
        .calendar-container .fc-daygrid-event-harness {
          margin-bottom: 3px;
        }
        .calendar-chip {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          border-radius: 6px;
          padding: 0.3rem 0.5rem 0.3rem 0.45rem;
          font-size: 0.7rem;
          font-weight: 500;
          width: 100%;
          box-sizing: border-box;
          border-left: 3px solid;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .calendar-chip:hover {
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(15, 23, 42, 0.13);
        }
        .calendar-chip__time {
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          font-variant-numeric: tabular-nums;
          padding: 0.05rem 0.3rem;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.55);
          flex-shrink: 0;
        }
        .dark .calendar-chip__time {
          background: rgba(255, 255, 255, 0.12);
        }
        .calendar-chip__due {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          font-variant-numeric: tabular-nums;
          padding: 0.05rem 0.3rem;
          border-radius: 4px;
          background: rgba(37, 99, 235, 0.14);
          color: #1d4ed8;
          flex-shrink: 0;
        }
        .calendar-chip__due-icon {
          width: 9px;
          height: 9px;
          flex-shrink: 0;
        }
        .calendar-chip__due--overdue {
          background: rgba(220, 38, 38, 0.16);
          color: #b91c1c;
        }
        .dark .calendar-chip__due {
          background: rgba(147, 197, 253, 0.18);
          color: #93c5fd;
        }
        .dark .calendar-chip__due--overdue {
          background: rgba(248, 113, 113, 0.22);
          color: #fca5a5;
        }
        .calendar-chip__title {
          flex: 1;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 600;
        }
        /* Tipo = cor (fixo). Prioridade = acento visual complementar, nunca uma cor concorrente
           (ver .calendar-event--priority-* mais abaixo, aplicado ao wrapper do FullCalendar). */
        .calendar-chip--deadline {
          background: #eff6ff;
          color: #1d4ed8;
          border-color: #3b82f6;
        }
        .calendar-chip--hearing {
          background: #fef2f2;
          color: #b91c1c;
          border-color: #ef4444;
        }
        .calendar-chip--payment {
          background: #ecfdf5;
          color: #047857;
          border-color: #10b981;
        }
        .calendar-chip--pericia {
          background: #faf5ff;
          color: #7e22ce;
          border-color: #a855f7;
        }
        .calendar-chip--meeting {
          background: #f0fdfa;
          color: #0f766e;
          border-color: #14b8a6;
        }
        .calendar-chip--requirement {
          background: #fff7ed;
          color: #9a3412;
          border-color: #c2410c;
        }
        .calendar-chip--personal {
          background: #e2e8f0;
          color: #334155;
          border-color: #64748b;
        }

        /* Dark mode styles for calendar chips */
        .dark .calendar-chip--deadline {
          background: #172554;
          color: #93c5fd;
          border-color: #3b82f6;
        }
        .dark .calendar-chip--hearing {
          background: #450a0a;
          color: #fca5a5;
          border-color: #ef4444;
        }
        .dark .calendar-chip--payment {
          background: #022c22;
          color: #6ee7b7;
          border-color: #10b981;
        }
        .dark .calendar-chip--pericia {
          background: #3b0764;
          color: #d8b4fe;
          border-color: #a855f7;
        }
        .dark .calendar-chip--meeting {
          background: #042f2e;
          color: #5eead4;
          border-color: #14b8a6;
        }
        .dark .calendar-chip--requirement {
          background: #431407;
          color: #fdba74;
          border-color: #c2410c;
        }
        .dark .calendar-chip--personal {
          background: #1e293b;
          color: #e2e8f0;
          border-color: #94a3b8;
        }

        /* Prioridade — nunca troca a cor do tipo. Apenas acentua: espessura da borda,
           ponto de urgência e atenuação para baixa prioridade. Aplicado via seletor
           descendente porque o FullCalendar coloca calendar-event--priority-* no wrapper
           (.fc-event) e .calendar-chip é um filho interno renderizado por eventContent. */
        .calendar-event--priority-urgent .calendar-chip {
          border-left-width: 5px;
          font-weight: 700;
          box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.35), 0 1px 2px rgba(15, 23, 42, 0.06);
        }
        .calendar-event--priority-urgent .calendar-chip::after {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #dc2626;
          flex-shrink: 0;
          margin-left: 0.3rem;
        }
        .calendar-event--priority-high .calendar-chip {
          border-left-width: 4px;
        }
        .calendar-event--priority-high .calendar-chip::after {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #f59e0b;
          flex-shrink: 0;
          margin-left: 0.3rem;
        }
        .calendar-event--priority-low .calendar-chip {
          opacity: 0.72;
        }
        .dark .calendar-event--priority-urgent .calendar-chip {
          box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2);
        }
        .dark .calendar-event--priority-urgent .calendar-chip::after {
          background: #f87171;
        }
        .dark .calendar-event--priority-high .calendar-chip::after {
          background: #fbbf24;
        }
        .calendar-container .fc-list-event-title {
          font-weight: 600;
        }
        .calendar-container .fc-list-event-time {
          color: #475569;
        }
        .calendar-today-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 0.5rem;
          padding: 0.1rem 0.4rem;
          border-radius: 999px;
          background: linear-gradient(135deg, #0ea5e9, #2563eb);
          color: #ffffff;
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        .calendar-legend-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #ffffff;
          font-size: 0.7rem;
          box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.7);
        }
        .calendar-legend-chip--deadline {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
        }
        .calendar-legend-chip--hearing {
          background: linear-gradient(135deg, #ef4444, #dc2626);
        }
        .calendar-legend-chip--requirement {
          background: linear-gradient(135deg, #ea580c, #c2410c);
        }
        .calendar-legend-chip--payment {
          background: linear-gradient(135deg, #10b981, #059669);
        }
        .calendar-legend-chip--pericia {
          background: linear-gradient(135deg, #a855f7, #9333ea);
        }
        .calendar-legend-chip--meeting {
          background: linear-gradient(135deg, #14b8a6, #0d9488);
        }
        .calendar-legend-chip--personal {
          background: linear-gradient(135deg, #64748b, #475569);
        }
        .export-filter {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.35rem 0.6rem;
          border-radius: 999px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          color: #334155;
        }
        .export-filter input {
          accent-color: #6366f1;
        }
      `}</style>

      {/* Modal de Exportação */}
      <Modal
        open={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title="Exportar Agenda"
        eyebrow="Exportação"
        subtitle="Selecione o período que deseja exportar"
        size="sm"
        zIndex={70}
        footer={
          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={() => setIsExportModalOpen(false)}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExportCalendar}
              className={`flex-1 px-4 py-2.5 rounded-lg text-white font-bold shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 border border-transparent whitespace-nowrap ${
                exportFormat === 'pdf' && exportPrivate
                  ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600'
                  : exportFormat === 'pdf'
                  ? 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600'
                  : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600'
              }`}
            >
              {exportFormat === 'pdf' && exportPrivate ? '🔒 Exportar com Sigilo' : exportFormat === 'pdf' ? '📄 Exportar PDF' : '📥 Exportar Excel'}
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
          <div className="space-y-4">
            {/* Opções de Período */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                📅 Período
              </label>
              
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: '7', label: 'Próximos 7 dias' },
                  { value: '15', label: 'Próximos 15 dias' },
                  { value: '30', label: 'Próximos 30 dias' },
                  { value: '60', label: 'Próximos 60 dias' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExportPeriod(option.value as any)}
                    className={`px-4 py-2.5 rounded-lg border-2 font-medium text-sm transition-all ${
                      exportPeriod === option.value
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-[#e7e5df] text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setExportPeriod('custom')}
                className={`w-full px-4 py-2.5 rounded-lg border-2 font-medium text-sm transition-all ${
                  exportPeriod === 'custom'
                    ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-600'
                    : 'border-[#e7e5df] dark:border-zinc-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-zinc-600'
                }`}
              >
                📆 Período Personalizado
              </button>
            </div>

            {/* Datas Personalizadas */}
            {exportPeriod === 'custom' && (
              <div className="grid grid-cols-2 gap-3 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-700">
                <div>
                  <label className="block text-xs font-semibold text-orange-900 dark:text-orange-300 mb-1.5">
                    Data Início
                  </label>
                  <input
                    type="date"
                    value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-orange-200 dark:border-orange-600 dark:bg-zinc-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-orange-900 dark:text-orange-300 mb-1.5">
                    Data Fim
                  </label>
                  <input
                    type="date"
                    value={exportEndDate}
                    onChange={(e) => setExportEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-orange-200 dark:border-orange-600 dark:bg-zinc-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Informação */}
            <div className="bg-slate-50 border border-[#e7e5df] rounded-lg p-3">
              <p className="text-xs text-slate-600">
                💡 <strong>Dica:</strong> A exportação incluirá todos os compromissos visíveis (prazos, audiências, reuniões, etc.) dentro do período selecionado.
              </p>
            </div>

            {/* Toggle de Sigilo — só disponível no PDF */}
            {exportFormat === 'pdf' && (
              <button
                type="button"
                onClick={() => setExportPrivate((v) => !v)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${
                  exportPrivate
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20 dark:border-red-600'
                    : 'border-[#e7e5df] dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0 ${
                    exportPrivate ? 'bg-red-500 text-white' : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                  }`}>
                    {exportPrivate ? '🔒' : '🔓'}
                  </div>
                  <div className="text-left">
                    <p className={`text-sm font-semibold ${exportPrivate ? 'text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-300'}`}>
                      Exportação com Sigilo
                    </p>
                    <p className={`text-xs ${exportPrivate ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'}`}>
                      Telefone, status e descrição serão riscados
                    </p>
                  </div>
                </div>
                {/* Pill indicator */}
                <div className={`w-10 h-5 rounded-full flex-shrink-0 transition-colors relative ${exportPrivate ? 'bg-red-500' : 'bg-slate-300 dark:bg-zinc-600'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-[#f8f7f5] shadow transition-all ${exportPrivate ? 'left-5' : 'left-0.5'}`} />
                </div>
              </button>
            )}

          </div>
        </ModalBody>
      </Modal>

      <Modal
        open={isDeletionLogOpen}
        onClose={() => setIsDeletionLogOpen(false)}
        title="Log de Exclusões"
        eyebrow="Auditoria"
        subtitle="Exclusões dos últimos 30 dias."
        size="lg"
        zIndex={75}
        footer={
          <div className="flex justify-end w-full">
            <button
              type="button"
              onClick={() => setIsDeletionLogOpen(false)}
              className="px-4 py-2 text-xs sm:text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition"
            >
              Fechar
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
                {(() => {
                  const thirtyDaysAgo = new Date();
                  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                  const filtered = deletionLog
                    .filter((e) => {
                      const deletedDate = new Date(e.deleted_at);
                      return deletedDate >= thirtyDaysAgo;
                    })
                    .slice()
                    .sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());

                  const pad = (n: number) => String(n).padStart(2, '0');
                  const toDayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                  const today = new Date();
                  const todayKey = toDayKey(today);
                  const yesterday = new Date(today);
                  yesterday.setDate(yesterday.getDate() - 1);
                  const yesterdayKey = toDayKey(yesterday);

                  const groups = filtered.reduce<Record<string, DeletionLogEntry[]>>((acc, entry) => {
                    const d = new Date(entry.deleted_at);
                    const key = toDayKey(d);
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(entry);
                    return acc;
                  }, {});
                  const groupKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

                  const formatDayLabel = (key: string) => {
                    if (key === todayKey) return 'Hoje';
                    if (key === yesterdayKey) return 'Ontem';
                    const dt = new Date(`${key}T00:00:00`);
                    if (Number.isNaN(dt.getTime())) return key;
                    return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  };
                  if (filtered.length === 0) {
                    return (
                      <div className="rounded-xl border border-[#e7e5df] dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 p-6 text-sm text-slate-600 dark:text-slate-400">
                        Nenhuma exclusão nos últimos 30 dias.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-6">
                      {groupKeys.map((key) => (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                              {formatDayLabel(key)}
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                              {groups[key].length} {groups[key].length === 1 ? 'item' : 'itens'}
                            </p>
                          </div>
                          <div className="space-y-3">
                            {groups[key].map((entry) => (
                              <div
                                key={`${entry.id}-${entry.deleted_at}`}
                                className="rounded-xl border border-[#e7e5df] dark:border-zinc-800 bg-[#f8f7f5] dark:bg-zinc-900 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                      {entry.title}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                      Data: {formatDateTime(entry.start_at)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      Excluído em: {formatDateTime(entry.deleted_at)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                      Por: {entry.deleted_by}
                                    </p>
                                  </div>
                                  <span className="shrink-0 inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-[#f8f7f5]/10 text-slate-700 dark:text-slate-200">
                                    {entry.type}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
        </ModalBody>
      </Modal>

      {/* Modal de Correspondentes */}
      <Modal
        open={isRepresentativesPanelOpen}
        onClose={() => setIsRepresentativesPanelOpen(false)}
        title="Correspondentes"
        size="xl"
        zIndex={70}
      >
        <ModalBody className="p-0">
          <RepresentativesPanel
            onClose={() => setIsRepresentativesPanelOpen(false)}
            onDataChanged={loadData}
          />
        </ModalBody>
      </Modal>

      {/* ── Modal de busca global ─────────────────────────────────── */}
      {isSearchOpen && (
        <div
          className="fixed inset-0 z-[9998] bg-black/40 flex items-start justify-center pt-[10vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setIsSearchOpen(false); setSearchQuery(''); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col" style={{ maxHeight: '75vh' }}>
            {/* Input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por cliente, processo, responsável, título…"
                className="flex-1 text-sm text-slate-700 placeholder-slate-400 bg-transparent focus:outline-none"
              />
              {searchQuery ? (
                <button type="button" onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 transition shrink-0">
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button type="button" onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 transition shrink-0">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Resultados */}
            <div className="overflow-y-auto flex-1">
              {!searchQuery.trim() ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Search className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">Digite para buscar compromissos futuros</p>
                </div>
              ) : searchModalResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Search className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm font-medium">Nenhum resultado encontrado</p>
                  <p className="text-xs mt-1">Somente compromissos de hoje em diante</p>
                </div>
              ) : (
                <ul>
                  {searchModalResults.map((ev, idx) => {
                    const ep = (ev.extendedProps ?? {}) as any;
                    const startStr = typeof ev.start === 'string' ? ev.start : '';
                    const d = startStr ? new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00') : null;
                    const hasTime = ep._hasTime === true;
                    const dateLabel = d
                      ? d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                      : '';
                    const timeLabel = hasTime && d
                      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : '';

                    const typeKey = ep.type as string;
                    const canonical = EVENT_TYPE_COLORS[typeKey as EventType];
                    const hex = eventTypeHexColors[typeKey];
                    const badgeClass = canonical
                      ? `text-[10px] font-semibold px-1.5 py-0.5 rounded border-l-2 ${canonical.badge}`
                      : 'text-[10px] font-semibold px-1.5 py-0.5 rounded border-l-2 text-slate-700 bg-slate-100 border-slate-400';
                    const badgeStyle = !canonical && hex
                      ? { borderLeftColor: hex, background: hex + '22', color: '#374151' }
                      : undefined;

                    const responsible = getResponsavel(ev);
                    const clientName = ep.clientName as string | undefined;

                    return (
                      <li key={`${ev.id}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(ev)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-start gap-3 border-b border-slate-50 last:border-0"
                        >
                          <div className="shrink-0 mt-0.5">
                            <span className={badgeClass} style={badgeStyle}>
                              {eventTypeLabels[typeKey] ?? typeKey}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{ev.title as string}</p>
                            {clientName && (
                              <p className="text-xs text-slate-500 truncate">{clientName}</p>
                            )}
                            {responsible && (
                              <p className="text-xs text-slate-400 truncate">{responsible}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-medium text-slate-600">{dateLabel}</p>
                            {timeLabel && <p className="text-xs text-slate-400">{timeLabel}</p>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Rodapé com contagem */}
            {searchQuery.trim() && searchModalResults.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {searchModalResults.length} resultado{searchModalResults.length !== 1 ? 's' : ''} · apenas hoje em diante
                </span>
                <span className="text-xs text-slate-400">↵ clique para navegar</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarModule;
