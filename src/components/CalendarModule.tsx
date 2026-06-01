import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import ptLocale from '@fullcalendar/core/locales/pt-br';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import { Loader2, Calendar as CalendarIcon, X, Filter, FileSpreadsheet, FileText, Plus, History, Users, Briefcase, Phone, MessageCircle, MapPin, ArrowUpRight, User, LayoutList, Printer, ChevronDown, ChevronRight, Check, Search, Link, DollarSign, Lock, Globe } from 'lucide-react';
import * as XLSX from 'xlsx';
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
import { usePermissions } from '../hooks/usePermissions';
import type { Deadline } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Client } from '../types/client.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { RepresentativeAppointment } from '../types/representative.types';
import RepresentativesPanel from './RepresentativesPanel';

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
  const { confirmDelete } = useDeleteConfirm();
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
        responsible_id: '',
        is_private: false,
        shared_with_ids: [],
        process_id: '',
        requirement_id: '',
        pericia_link_type: 'process',
        event_mode: '',
        ...initialValues,
      };

      setNewEventForm(merged);
      setEditingEventId(editingId);
      setIsCreateModalOpen(true);
    },
    [],
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

  useEffect(() => {
    loadData();
    loadClients();
    profileService.listMembers().then(setMembers).catch(() => {});
  }, []);

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
  }, [deadlines, processes, requirements, clientMap, calendarEventsData]);

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

  // ── Cronograma: imprimir ─────────────────────────────────────────
  const handlePrintCronograma = useCallback(() => {
    const TYPE_LABELS: Record<string, string> = {
      deadline: 'Prazo', hearing: 'Audiência', requirement: 'Exigência',
      payment: 'Recebimento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
    };
    const TYPE_COLORS: Record<string, string> = {
      deadline: '#4f46e5', hearing: '#dc2626', requirement: '#d97706',
      payment: '#0284c7', meeting: '#059669', pericia: '#7c3aed', personal: '#a21caf',
    };
    const fmtDay = (key: string) => new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const fmtTime = (ev: EventInput) => {
      if ((ev.extendedProps as any)?._hasTime !== true) return '—';
      const startStr = typeof ev.start === 'string' ? ev.start : '';
      const t = new Date(startStr);
      return isNaN(t.getTime()) ? '—' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    };

    const { start, end } = cronogramaRange;
    const periodLabel = `${start.toLocaleDateString('pt-BR')} a ${end.toLocaleDateString('pt-BR')}`;
    const issuedAt = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const daysHTML = cronogramaByDay.map(([dayKey, evs]) => {
      const rowsHTML = evs.map(ev => {
        const type  = ev.extendedProps?.type as string || 'meeting';
        const color = TYPE_COLORS[type] || '#64748b';
        const label = TYPE_LABELS[type] || type;
        const time  = fmtTime(ev);
        const client = ev.extendedProps?.clientName as string || '';
        const resp  = getResponsavel(ev);
        return `<tr>
          <td style="padding:9px 12px;white-space:nowrap;color:#475569;font-size:12px;font-variant-numeric:tabular-nums;border-bottom:1px solid #f1f5f9;">${time}</td>
          <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;">
            <span style="display:inline-block;background:${color};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;letter-spacing:.06em;text-transform:uppercase;">${label}</span>
          </td>
          <td style="padding:9px 12px;font-weight:600;color:#0f172a;font-size:12px;border-bottom:1px solid #f1f5f9;">${ev.title || ''}</td>
          <td style="padding:9px 12px;color:#475569;font-size:11.5px;border-bottom:1px solid #f1f5f9;">${client}</td>
          <td style="padding:9px 12px;color:#64748b;font-size:11.5px;border-bottom:1px solid #f1f5f9;">${resp}</td>
        </tr>`;
      }).join('');
      return `<div style="margin-bottom:28px;page-break-inside:avoid;">
        <div style="background:#0e2a47;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:0;">
          <span style="font-size:13px;font-weight:700;text-transform:capitalize;">${fmtDay(dayKey)}</span>
          <span style="font-size:10px;color:#94a3b8;">${evs.length} ${evs.length === 1 ? 'compromisso' : 'compromissos'}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:7px 12px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Horário</th>
              <th style="padding:7px 12px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Tipo</th>
              <th style="padding:7px 12px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Compromisso</th>
              <th style="padding:7px 12px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Cliente</th>
              <th style="padding:7px 12px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Responsável</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8"/>
      <title>Cronograma — ${periodLabel}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>
        @page{size:A4 portrait;margin:20mm 16mm;}
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#0f172a;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        .no-print{display:block;}
        @media print{.no-print{display:none!important;}}
      </style>
    </head><body>
      <div class="no-print" style="max-width:860px;margin:16px auto 0;text-align:right;">
        <button onclick="window.print()" style="background:#0e2a47;color:#fff;border:none;padding:9px 22px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.1em;text-transform:uppercase;">Imprimir / PDF</button>
      </div>
      <div style="max-width:860px;margin:16px auto;">
        <div style="background:#0a1828;color:#fff;padding:20px 24px 16px;border-bottom:3px solid #d4a857;margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;">
            <div>
              <div style="font-size:10px;letter-spacing:.25em;color:#d4a857;text-transform:uppercase;margin-bottom:4px;">JURIUS · Sistema Jurídico</div>
              <div style="font-size:22px;font-weight:700;letter-spacing:-.01em;">Cronograma de Compromissos</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${periodLabel}${cronogramaOnlyMine ? ' · Apenas os meus' : ' · Escritório'}</div>
            </div>
            <div style="text-align:right;font-size:10px;color:#64748b;">
              <div>Emitido em ${issuedAt}</div>
              <div style="margin-top:2px;">${cronogramaByDay.reduce((s,[,evs])=>s+evs.length,0)} compromissos · ${cronogramaByDay.length} dias</div>
            </div>
          </div>
        </div>
        <div style="margin-top:24px;">
          ${daysHTML || '<div style="text-align:center;color:#94a3b8;padding:48px 0;font-size:13px;">Nenhum compromisso no período.</div>'}
        </div>
      </div>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }, [cronogramaByDay, cronogramaRange, cronogramaOnlyMine, getResponsavel]);

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

      const basePayload = {
        title: newEventForm.title.trim(),
        description: newEventForm.description.trim() || null,
        event_type: newEventForm.type,
        start_at: computeStartAt(newEventForm.date, newEventForm.time),
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
          const typeLabel = EVENT_TYPE_LABELS[updatedEvent.event_type as EventType] || 'Compromisso';
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
        });
        setCalendarEventsData((prev) => [...prev, createdEvent]);

        // 🔔 Notificações do novo compromisso
        if (user?.id && createdEvent) {
          const eventDate = new Date(createdEvent.start_at);
          const formattedDate = eventDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          const notifyBase = { appointment_id: createdEvent.id, metadata: { event_type: newEventForm.type, start_at: createdEvent.start_at } };
          const assignerName = members.find(m => m.user_id === user.id)?.name || 'Alguém';
          const typeLabel = EVENT_TYPE_LABELS[newEventForm.type as EventType] || 'Compromisso';
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

  const prepareDescriptionForExport = useCallback(
    (value?: string | null) => truncateForExcel(convertRichTextToPlainText(value)),
    [convertRichTextToPlainText],
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
        const jspdfModule = await loadJsPdf();
        const doc = new jspdfModule.jsPDF('landscape', 'pt', 'a4');
        const now = new Date();
        const today = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const exportedBy = userName || 'Usuário do Sistema';

        // Colunas sigilosas: 4=Telefone, 5=Status, 6=Prioridade, 7=Descrição
        const REDACTED_COLS = new Set([4, 5, 6, 7]);

        // Mapa de cores por tipo de compromisso (RGB)
        const TYPE_COLORS: Record<string, [number, number, number]> = {
          'Prazo':       [220,  38,  38],  // red-600
          'Audiência':   [ 37, 99, 235],   // blue-600
          'Reunião':     [124,  58, 237],  // violet-600
          'Pagamento':   [ 22, 163,  74],  // green-600
          'Perícia':     [ 20, 184, 166],  // teal-500
          'Requerimento':[217, 119,   6],  // amber-600
          'Pessoal':     [100, 116, 139],  // slate-500
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
          // ── Barra superior escura ──────────────────────────────────────────
          doc.setFillColor(10, 15, 30);
          doc.rect(0, 0, pageWidth, 30, 'F');
          // Texto centralizado na barra
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setCharSpace(1.5);
          doc.text('JURIUS.COM.BR  —  GESTÃO JURÍDICA', pageWidth / 2, 18.5, { align: 'center' });
          doc.setCharSpace(0);

          // Faixas decorativas: âmbar + escura mais fina
          doc.setFillColor(245, 158, 11);
          doc.rect(0, 30, pageWidth, 4, 'F');
          doc.setFillColor(180, 115, 5);
          doc.rect(0, 34, pageWidth, 1, 'F');

          // ── Área de fundo do cabeçalho ─────────────────────────────────────
          doc.setFillColor(250, 250, 252);
          doc.rect(0, 35, pageWidth, 78, 'F');

          // ── Logo ──────────────────────────────────────────────────────────
          // Sombra
          doc.setFillColor(200, 150, 10);
          doc.roundedRect(43, 47, 48, 48, 8, 8, 'F');
          // Fundo âmbar
          doc.setFillColor(245, 158, 11);
          doc.roundedRect(40, 44, 48, 48, 8, 8, 'F');
          // Letra J
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(32);
          doc.text('J', 64, 78, { align: 'center' });

          // ── Título ────────────────────────────────────────────────────────
          doc.setTextColor(10, 15, 30);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(21);
          doc.text('Agenda de Compromissos', 103, 62);

          // Sublinhado âmbar preciso
          doc.setDrawColor(245, 158, 11);
          doc.setLineWidth(2.5);
          const titleW = doc.getTextWidth('Agenda de Compromissos');
          doc.line(103, 67, 103 + titleW, 67);

          // ── Período e meta ────────────────────────────────────────────────
          const periodText = exportPeriod === 'custom'
            ? `Período: ${new Date(exportStartDate + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(exportEndDate + 'T00:00:00').toLocaleDateString('pt-BR')}`
            : `Próximos ${exportPeriod} dias`;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(71, 85, 105);
          doc.text(periodText, 103, 79);

          doc.setFontSize(8);
          doc.setTextColor(120, 136, 160);
          doc.text(`Gerado em: ${today} às ${timeStr}`, 103, 90);
          doc.text(`Exportado por: ${exportedBy}`, 103, 100);

          // ── Linha divisória entre cabeçalho e tabela ──────────────────────
          doc.setDrawColor(220, 224, 232);
          doc.setLineWidth(0.5);
          doc.line(30, 113, pageWidth - 30, 113);

          // ── Badge de sigilo ───────────────────────────────────────────────
          if (exportPrivate) {
            const bW = 130; const bH = 22;
            const bX = pageWidth - 40 - bW; const bY = 44;

            // Borda vermelha sutil ao redor do badge
            doc.setDrawColor(180, 20, 20);
            doc.setLineWidth(0.5);
            doc.roundedRect(bX - 1, bY - 1, bW + 2, bH + 2, 5, 5, 'S');

            doc.setFillColor(200, 30, 30);
            doc.roundedRect(bX, bY, bW, bH, 4, 4, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.text('INFORMAÇÕES RESTRITAS', bX + bW / 2, bY + 14, { align: 'center' });

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(160, 30, 30);
            doc.text('Campos sigilosos suprimidos neste documento.', pageWidth - 40, 78, { align: 'right' });
          }
        };

        drawWatermark();
        drawPageHeader();

        // ── Tabela ─────────────────────────────────────────────────────────
        (doc as any).autoTable({
          startY: 117,
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
            cellPadding: { top: 5.5, right: 5, bottom: 5.5, left: 6 },
            lineWidth: 0.3,
            lineColor: [220, 224, 232],
            overflow: 'linebreak',
            textColor: [30, 41, 59],
            valign: 'middle',
          },
          headStyles: {
            fillColor: [10, 15, 30],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
            halign: 'center',
            cellPadding: { top: 7, right: 5, bottom: 7, left: 5 },
            lineWidth: 0,
          },
          alternateRowStyles: {
            fillColor: [246, 248, 252],
          },
          columnStyles: {
            0: { cellWidth: 78,  halign: 'center', fontSize: 7.5 },
            1: { cellWidth: 60,  halign: 'center', fontStyle: 'bold', fontSize: 7.5 },
            2: { cellWidth: 130 },
            3: { cellWidth: 95 },
            4: { cellWidth: 70,  halign: 'center' },
            5: { cellWidth: 66,  halign: 'center' },
            6: { cellWidth: 52,  halign: 'center' },
            7: { cellWidth: 'auto' },
          },
          margin: { top: 117, left: 30, right: 30, bottom: 48 },
          // Colorir bolinha do tipo + redação de células sigilosas
          didDrawCell: (data: any) => {
            if (data.section === 'body') {
              // Bolinha colorida para coluna Tipo (índice 1)
              if (data.column.index === 1 && !exportPrivate) {
                const tipo = String(data.cell.raw || '');
                const color = TYPE_COLORS[tipo];
                if (color) {
                  const cx = data.cell.x + 8;
                  const cy = data.cell.y + data.cell.height / 2;
                  doc.setFillColor(...color);
                  doc.circle(cx, cy, 2.2, 'F');
                }
              }
              // Redação preta sobre células sigilosas
              if (exportPrivate && REDACTED_COLS.has(data.column.index)) {
                const { x, y, width, height } = data.cell;
                const pad = 5;
                doc.setFillColor(22, 22, 28);
                doc.rect(x + pad, y + pad, width - pad * 2, height - pad * 2, 'F');
                // Listras sutis para efeito de redação real
                doc.setFillColor(10, 10, 14);
                const stripeW = 3;
                for (let sx = x + pad; sx < x + width - pad; sx += stripeW * 2) {
                  doc.rect(sx, y + pad, stripeW, height - pad * 2, 'F');
                }
              }
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

    const hasRealTime = Boolean(timeText && timeText.trim().length > 0);

    return (
      <div className={`calendar-chip calendar-chip--${type}`}>
        {hasRealTime && <span className="calendar-chip__time">{timeText}</span>}
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
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">Carregando calendário...</p>
        </div>
      </div>
    );
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
      <div className="bg-white border border-slate-200 rounded-t-xl shadow-sm">
        {/* Linha 1: nav + título + views + novo */}
        <div className="flex items-center gap-1.5 px-3 py-2 flex-wrap">
          {/* Navegação */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
            <button type="button" onClick={() => calendarRef.current?.getApi().prev()} className="p-1 hover:bg-white rounded-md text-slate-600 transition" aria-label="Anterior">
              <span className="text-sm font-bold leading-none">‹</span>
            </button>
            <button type="button" onClick={() => calendarRef.current?.getApi().today()} className="px-2 text-xs font-medium text-slate-700">Hoje</button>
            <button type="button" onClick={() => calendarRef.current?.getApi().next()} className="p-1 hover:bg-white rounded-md text-slate-600 transition" aria-label="Próximo">
              <span className="text-sm font-bold leading-none">›</span>
            </button>
          </div>
          <h2 className="text-sm font-bold text-slate-800 capitalize shrink-0 min-w-0 truncate flex-1 sm:flex-none sm:w-28">{currentMonthName}</h2>

          {/* Views */}
          <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0">
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
                  !showCronograma && calendarView === view ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'
                }`}
              >{label}</button>
            ))}
            <button
              type="button"
              onClick={() => setShowCronograma(v => !v)}
              className={`hidden sm:inline-flex px-2.5 py-1 text-xs font-medium rounded-md transition-all items-center gap-1 ${showCronograma ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'}`}
            >
              <LayoutList className="w-3 h-3" />Cronograma
            </button>
          </div>

          {/* Spacer desktop */}
          <div className="hidden sm:block flex-1" />

          {/* Filtro responsável — desktop only na linha 1 */}
          <div className="hidden sm:flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium shrink-0">
            {(['todos', 'mim'] as const).map(opt => (
              <button key={opt} type="button"
                onClick={() => { setCalendarResponsibleFilter(opt); setShowResponsiblePicker(false); }}
                className={`px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter === opt ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'}`}
              >{opt === 'todos' ? 'Todos' : 'A mim'}</button>
            ))}
            <div ref={responsiblePickerRef}>
              <button ref={responsibleBtnRef} type="button"
                onClick={() => {
                  const rect = responsibleBtnRef.current?.getBoundingClientRect();
                  if (rect) setResponsiblePickerPos({ top: rect.bottom + 6, left: rect.left });
                  setShowResponsiblePicker(v => !v);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'}`}
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
            <button type="button" onClick={() => setLegendExpanded(v => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${legendExpanded ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 hover:bg-slate-100 border-slate-200'}`}>
              <Filter className="w-3.5 h-3.5" />Filtros
            </button>
            <button type="button" onClick={() => setIsDeletionLogOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors">
              <History className="w-3.5 h-3.5" />Log
            </button>
            <button type="button" onClick={() => handleOpenExportModal('excel')}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-emerald-600 hover:bg-emerald-50 transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />Excel
            </button>
            <button type="button" onClick={() => handleOpenExportModal('pdf')}
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 transition-colors">
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
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium shrink-0">
            {(['todos', 'mim'] as const).map(opt => (
              <button key={opt} type="button"
                onClick={() => { setCalendarResponsibleFilter(opt); setShowResponsiblePicker(false); }}
                className={`px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter === opt ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'}`}
              >{opt === 'todos' ? 'Todos' : 'A mim'}</button>
            ))}
            <div ref={responsiblePickerRef}>
              <button ref={responsibleBtnRef} type="button"
                onClick={() => {
                  const rect = responsibleBtnRef.current?.getBoundingClientRect();
                  if (rect) setResponsiblePickerPos({ top: rect.bottom + 6, left: rect.left });
                  setShowResponsiblePicker(v => !v);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${calendarResponsibleFilter !== 'todos' && calendarResponsibleFilter !== 'mim' ? 'bg-white text-amber-600 shadow' : 'text-slate-500 hover:text-slate-800'}`}
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
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-all shrink-0 ${showCronograma ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 border-slate-200'}`}>
            <LayoutList className="w-3 h-3" />Lista
          </button>
          <button type="button" onClick={() => setLegendExpanded(v => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors shrink-0 ${legendExpanded ? 'bg-amber-50 text-amber-600 border-amber-200' : 'text-slate-500 border-slate-200'}`}>
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
        <div className="bg-slate-50 border-x border-slate-200 p-2 sm:p-4">
          <h4 className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 sm:mb-3">Filtrar por Tipo</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.deadline}
                onChange={() => setViewFilters((prev) => ({ ...prev, deadline: !prev.deadline }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs sm:text-sm font-medium text-indigo-700 bg-indigo-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-indigo-500">
                Prazos
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.hearing}
                onChange={() => setViewFilters((prev) => ({ ...prev, hearing: !prev.hearing }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-xs sm:text-sm font-medium text-red-700 bg-red-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-red-500">
                Audiências
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.requirement}
                onChange={() => setViewFilters((prev) => ({ ...prev, requirement: !prev.requirement }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-xs sm:text-sm font-medium text-orange-700 bg-orange-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-orange-500">
                Exigências
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.payment}
                onChange={() => setViewFilters((prev) => ({ ...prev, payment: !prev.payment }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <span className="text-xs sm:text-sm font-medium text-sky-700 bg-sky-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-sky-500">
                Recebimentos
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.pericia}
                onChange={() => setViewFilters((prev) => ({ ...prev, pericia: !prev.pericia }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-xs sm:text-sm font-medium text-purple-700 bg-purple-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-purple-500">
                Perícias
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.meeting}
                onChange={() => setViewFilters((prev) => ({ ...prev, meeting: !prev.meeting }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs sm:text-sm font-medium text-emerald-700 bg-emerald-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-emerald-500">
                Reuniões
              </span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={viewFilters.personal}
                onChange={() => setViewFilters((prev) => ({ ...prev, personal: !prev.personal }))}
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500"
              />
              <span className="text-xs sm:text-sm font-medium text-fuchsia-700 bg-fuchsia-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border-l-2 sm:border-l-4 border-fuchsia-500">
                Pessoal
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Dropdown "Determinado" via portal */}
      {showResponsiblePicker && createPortal(
        <div
          ref={responsibleDropdownRef}
          className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-xl p-3 min-w-[200px]"
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
        </div>,
        document.body
      )}

      {/* ═══ CRONOGRAMA VIEW ═══ */}
      {showCronograma && (
        <div className="bg-white border border-t-0 border-slate-200 rounded-b-xl shadow-sm overflow-hidden">
          {/* Controles do cronograma */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
            {/* Período */}
            <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 text-xs font-medium">
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
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                />
                <span className="text-slate-400 text-xs">até</span>
                <input
                  type="date"
                  value={cronogramaEnd}
                  onChange={e => setCronogramaEnd(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
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
                <p className="text-sm font-medium">Nenhum compromisso no período</p>
                <p className="text-xs mt-1">Ajuste o período ou os filtros de tipo</p>
              </div>
            ) : cronogramaByDay.map(([dayKey, evs]) => {
              const dayDate = new Date(dayKey + 'T12:00:00');
              const isToday = dayKey === new Date().toISOString().slice(0, 10);
              const dayLabel = dayDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

              const TYPE_COLORS: Record<string, string> = {
                deadline: 'bg-indigo-100 text-indigo-700 border-indigo-200',
                hearing:  'bg-red-100 text-red-700 border-red-200',
                requirement: 'bg-orange-100 text-orange-700 border-orange-200',
                payment:  'bg-sky-100 text-sky-700 border-sky-200',
                meeting:  'bg-emerald-100 text-emerald-700 border-emerald-200',
                pericia:  'bg-purple-100 text-purple-700 border-purple-200',
                personal: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
              };
              const TYPE_BORDER: Record<string, string> = {
                deadline: 'border-l-indigo-500',
                hearing:  'border-l-red-500',
                requirement: 'border-l-orange-500',
                payment:  'border-l-sky-500',
                meeting:  'border-l-emerald-500',
                pericia:  'border-l-purple-500',
                personal: 'border-l-fuchsia-500',
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
                      const typeColor  = TYPE_COLORS[type]  || 'bg-slate-100 text-slate-600 border-slate-200';
                      const borderColor = TYPE_BORDER[type] || 'border-l-slate-400';
                      const typeLabel  = TYPE_LABELS_LOCAL[type] || type;

                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-lg border border-slate-100 border-l-4 ${borderColor} bg-white hover:bg-slate-50 transition-colors cursor-pointer`}
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
      <div className={`bg-white border border-t-0 border-slate-200 rounded-b-xl shadow-sm overflow-hidden${showCronograma ? ' hidden' : ''}`}>
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
        className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-110 z-40 flex items-center justify-center group"
        title="Criar novo compromisso"
      >
        <CalendarIcon className="w-5 h-5 sm:w-6 sm:h-6 group-hover:scale-110 transition-transform" />
        <div className="absolute -top-10 sm:-top-12 right-0 bg-slate-900 text-white text-[10px] sm:text-xs px-2 sm:px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap hidden sm:block">
          Novo Compromisso
        </div>
      </button>

      {/* Modal de Detalhes do Evento */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center px-0 sm:px-6 py-0 sm:py-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden="true" />
          <div
            className="relative w-full sm:max-w-lg max-h-[96vh] sm:max-h-[90vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Faixa de cor por tipo */}
            {(() => {
              const t = selectedEvent.extendedProps.type as string;
              const barColor =
                t === 'deadline'    ? 'from-indigo-400 to-indigo-500' :
                t === 'hearing'     ? 'from-red-400 to-red-500' :
                t === 'requirement' ? 'from-orange-400 to-amber-500' :
                t === 'payment'     ? 'from-sky-400 to-sky-500' :
                t === 'meeting'     ? 'from-emerald-400 to-emerald-500' :
                t === 'pericia'     ? 'from-purple-400 to-purple-500' :
                t === 'personal'    ? 'from-fuchsia-400 to-fuchsia-500' :
                'from-orange-400 to-amber-500';
              return <div className={`h-1 w-full bg-gradient-to-r ${barColor} flex-shrink-0`} />;
            })()}

            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-white">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0 mt-0.5">
                  <CalendarIcon className="w-4 h-4 text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Compromisso</p>
                  <h2 className="text-base font-bold text-slate-800 leading-snug break-words">{selectedEvent.title}</h2>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {selectedEvent.extendedProps.type && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                        selectedEvent.extendedProps.type === 'deadline'    ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                        selectedEvent.extendedProps.type === 'hearing'     ? 'bg-red-50 text-red-700 border-red-200' :
                        selectedEvent.extendedProps.type === 'requirement' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                        selectedEvent.extendedProps.type === 'payment'     ? 'bg-sky-50 text-sky-700 border-sky-200' :
                        selectedEvent.extendedProps.type === 'meeting'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        selectedEvent.extendedProps.type === 'pericia'     ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        selectedEvent.extendedProps.type === 'personal'    ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' :
                        'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {EVENT_TYPE_LABELS[selectedEvent.extendedProps.type as EventType] ?? selectedEvent.extendedProps.type}
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
                      <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {selectedEventModuleLabel}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition shrink-0"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto bg-white">
              <div className="px-5 py-4 space-y-3">

                {/* Data e Hora */}
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <CalendarIcon className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Data e hora</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">
                      {selectedEvent.start ? formatDateTime(new Date(selectedEvent.start).toISOString()) : '—'}
                    </p>
                    {selectedEvent.end && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        até {formatDateTime(new Date(selectedEvent.end).toISOString())}
                      </p>
                    )}
                  </div>
                </div>

                {/* Prioridade */}
                {selectedEvent.extendedProps.priority && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${
                      selectedEvent.extendedProps.priority === 'alta' ? 'bg-red-500' :
                      selectedEvent.extendedProps.priority === 'média' || selectedEvent.extendedProps.priority === 'media' ? 'bg-amber-500' :
                      'bg-slate-400'
                    }`} />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Prioridade</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{selectedEvent.extendedProps.priority}</p>
                    </div>
                  </div>
                )}

                {/* Cliente + Telefone */}
                {selectedEvent.extendedProps.clientName && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-violet-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cliente</p>
                      {selectedEvent.extendedProps.clientId ? (
                        <button
                          type="button"
                          onClick={() => handleNavigateToModule('clientes', selectedEvent.extendedProps.clientId)}
                          className="text-sm font-semibold text-amber-600 hover:text-amber-700 hover:underline mt-0.5 truncate text-left transition"
                        >
                          {selectedEvent.extendedProps.clientName}
                        </button>
                      ) : (
                        <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{selectedEvent.extendedProps.clientName}</p>
                      )}
                      {selectedEvent.extendedProps.clientPhone && (
                        <p className="text-xs text-slate-500 mt-0.5">{selectedEvent.extendedProps.clientPhone}</p>
                      )}
                    </div>
                    {selectedEvent.extendedProps.clientPhone && (
                      <a
                        href={`tel:${selectedEvent.extendedProps.clientPhone}`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition shrink-0"
                        title="Ligar"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}

                {/* Correspondente */}
                {selectedEventRepresentativeAppointments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">Correspondente</p>
                    {selectedEventRepresentativeAppointments.map((appointment) => {
                      const representative = appointment.representative;
                      const whatsappUrl = buildWhatsAppUrl(representative?.phone);
                      const representativeName = representative?.full_name || 'Não encontrado';
                      return (
                        <div key={appointment.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                                {representativeName.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800">{representativeName}</p>
                                <p className="text-xs text-slate-500">{representative?.oab_number || 'OAB não informada'}</p>
                              </div>
                            </div>
                            {whatsappUrl ? (
                              <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition shrink-0"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                WhatsApp
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400">Sem telefone</span>
                            )}
                          </div>
                          {appointment.diligence_location && (
                            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                              <MapPin className="w-3.5 h-3.5" />
                              <span className="truncate">{appointment.diligence_location}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Modalidade (presencial / online) */}
                {(() => {
                  const mode = (selectedEvent.extendedProps.data as any)?.event_mode as string | null | undefined;
                  if (!mode) return null;
                  const isOnline = mode === 'online';
                  return (
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                        isOnline
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                        {isOnline ? '📹' : '📍'} {isOnline ? 'Online' : 'Presencial'}
                      </span>
                    </div>
                  );
                })()}

                {/* Descrição */}
                {selectedEvent.extendedProps.description && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Descrição</p>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
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

                {/* Botão Registrar Pagamento — visível apenas em eventos do tipo payment com parcela vinculada */}
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
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"
                    >
                      <DollarSign className="w-4 h-4" />
                      Registrar Pagamento
                    </button>
                  );
                })()}

                {/* Detalhes extras */}
                {selectedEventDataDetails.length > 0 && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Detalhes</p>
                    {selectedEventDataDetails.map((detail) => (
                      <div key={`${detail.label}-${detail.value}`} className="flex justify-between gap-3">
                        <span className="shrink-0 text-xs text-slate-500">{detail.label}</span>
                        <span className="text-right">
                          <span className="block text-xs font-semibold text-slate-700">{detail.value}</span>
                          {detail.secondaryValue && (
                            <span className="mt-0.5 block text-[11px] text-slate-500">{detail.secondaryValue}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition"
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition"
                >
                  <Plus className="w-3.5 h-3.5" />
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Ir para módulo
                </button>
              )}
              {showEditButton && (
                <button
                  type="button"
                  onClick={handleEditSelectedEvent}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition"
                >
                  <Check className="w-3.5 h-3.5" />
                  {editButtonLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação/Edição de Compromisso */}
      {isCreateModalOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center px-0 sm:px-6 py-0 sm:py-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={handleCloseCreateModal}
            aria-hidden="true"
          />
          <div className="relative w-full sm:max-w-2xl max-h-[96vh] sm:max-h-[95vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Faixa laranja */}
            <div className="h-1 w-full bg-gradient-to-r from-orange-400 to-amber-500 flex-shrink-0" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                  <CalendarIcon className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Agenda</p>
                  <h2 className="text-base font-bold text-slate-800 leading-tight">
                    {editingEventId ? 'Editar Compromisso' : 'Novo Compromisso'}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCreateModal}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body — 2 colunas */}
            <div className="flex-1 overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 py-5">

                {/* Título — coluna inteira */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    Título <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={newEventForm.title}
                    onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all"
                    placeholder="Ex: Reunião com cliente"
                    autoFocus
                  />
                </div>

                {/* Data */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    Data <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={newEventForm.date}
                    onChange={(e) => setNewEventForm({ ...newEventForm, date: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all"
                    required
                  />
                </div>

                {/* Horário */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    Horário
                  </label>
                  <input
                    type="time"
                    value={newEventForm.time}
                    onChange={(e) => setNewEventForm({ ...newEventForm, time: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all"
                  />
                </div>

                {/* Tipo — coluna inteira */}
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    Tipo
                  </label>
                  <div className="grid grid-cols-7 gap-2">
                    {([
                      { value: 'meeting',     label: 'Reunião',     active: 'bg-emerald-500 text-white border-emerald-500',   idle: 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-600' },
                      { value: 'deadline',    label: 'Prazo',       active: 'bg-indigo-500 text-white border-indigo-500',     idle: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400 hover:text-indigo-600' },
                      { value: 'hearing',     label: 'Audiência',   active: 'bg-red-500 text-white border-red-500',           idle: 'bg-white text-slate-600 border-slate-200 hover:border-red-400 hover:text-red-600' },
                      { value: 'pericia',     label: 'Perícia',     active: 'bg-purple-500 text-white border-purple-500',     idle: 'bg-white text-slate-600 border-slate-200 hover:border-purple-400 hover:text-purple-600' },
                      { value: 'payment',     label: 'Recebimento', active: 'bg-sky-500 text-white border-sky-500',           idle: 'bg-white text-slate-600 border-slate-200 hover:border-sky-400 hover:text-sky-600' },
                      { value: 'requirement', label: 'Exigência',   active: 'bg-orange-500 text-white border-orange-500',     idle: 'bg-white text-slate-600 border-slate-200 hover:border-orange-400 hover:text-orange-600' },
                      { value: 'personal',    label: 'Pessoal',     active: 'bg-fuchsia-500 text-white border-fuchsia-500',   idle: 'bg-white text-slate-600 border-slate-200 hover:border-fuchsia-400 hover:text-fuchsia-600' },
                    ] as const).map(({ value, label, active, idle }) => (
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
                        className={`py-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                          newEventForm.type === value ? active : idle
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Modalidade — presencial / online (Audiência, Reunião, Perícia) */}
                {(['hearing', 'meeting', 'pericia'] as EventType[]).includes(newEventForm.type) && (
                  <div className="col-span-2">
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                      Modalidade
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: '',           label: 'Não definida' },
                        { value: 'presencial', label: 'Presencial'   },
                        { value: 'online',     label: 'Online'       },
                      ] as const).map(({ value, label }) => {
                        const on = newEventForm.event_mode === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setNewEventForm(prev => ({ ...prev, event_mode: value }))}
                            className={`py-2 rounded-lg text-xs font-semibold border transition-all text-center ${
                              on
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Cliente + Responsável — linha dividida */}
                <div className="col-span-2 grid grid-cols-2 gap-5 pt-1 border-t border-slate-100">

                  {/* Cliente — campo unificado (livre ou vinculado) */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                      Cliente <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                    </label>
                    <div ref={clientSearchRef} className="relative">
                      {newEventForm.client_id ? (
                        /* Cliente cadastrado vinculado — badge verde */
                        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-emerald-50 border border-emerald-300 rounded-xl">
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
                              placeholder="Nome ou buscar cliente cadastrado..."
                              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all"
                            />
                          </div>
                          {clientSearchOpen && (clientSearchResults.length > 0 || clientSearchTerm.trim().length >= 1) && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
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

                  {/* Vínculo com processo ou requerimento — oculto para Pessoal e quando não há cliente cadastrado */}
                  {newEventForm.type !== 'personal' && newEventForm.client_id && (
                    <div className="col-span-2 pt-1 border-t border-slate-100">
                      {/* Toggle Processo / Requerimento — apenas para Perícia */}
                      {newEventForm.type === 'pericia' && (
                        <div className="flex gap-2 mb-3">
                          <button
                            type="button"
                            onClick={() => setNewEventForm(prev => ({ ...prev, pericia_link_type: 'process', requirement_id: '' }))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              newEventForm.pericia_link_type === 'process'
                                ? 'bg-purple-500 text-white border-purple-500'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-purple-400'
                            }`}
                          >
                            Processo judicial
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewEventForm(prev => ({ ...prev, pericia_link_type: 'requirement', process_id: '' }))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              newEventForm.pericia_link_type === 'requirement'
                                ? 'bg-purple-500 text-white border-purple-500'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-purple-400'
                            }`}
                          >
                            Requerimento adm.
                          </button>
                        </div>
                      )}

                      {/* Seletor de Processo */}
                      {(newEventForm.type !== 'pericia' || newEventForm.pericia_link_type === 'process') && (() => {
                        const clientProcesses = processes.filter(p => p.client_id === newEventForm.client_id);
                        const selectedProcess = clientProcesses.find(p => p.id === newEventForm.process_id);
                        return (
                          <div>
                            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                              Processo <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                            </label>
                            {selectedProcess ? (
                              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-blue-50 border border-blue-300 rounded-xl">
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
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400 transition-all"
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

                      {/* Seletor de Requerimento (apenas Perícia + requerimento adm.) */}
                      {newEventForm.type === 'pericia' && newEventForm.pericia_link_type === 'requirement' && (() => {
                        const clientRequirements = requirements.filter(r => r.client_id === newEventForm.client_id);
                        const selectedReq = clientRequirements.find(r => r.id === newEventForm.requirement_id);
                        return (
                          <div>
                            <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                              Requerimento adm. <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                            </label>
                            {selectedReq ? (
                              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-purple-50 border border-purple-300 rounded-xl">
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
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400 transition-all"
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
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Responsável — oculto para eventos pessoais */}
                  {newEventForm.type !== 'personal' && <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                        Responsável <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                      </label>
                      {newEventForm.responsible_id && (
                        <span className="text-[11px] font-semibold text-orange-500 truncate max-w-[120px]">
                          {(members.find(m => m.id === newEventForm.responsible_id || m.user_id === newEventForm.responsible_id)?.name || '').split(' ')[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2.5 min-h-[46px] items-center">
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
                              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden transition-all ${
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
                              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center">
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
                  </div>}

                </div>

                {/* Privacidade / Compartilhamento — coluna inteira */}
                <div className="col-span-2 border-t border-slate-100 pt-4">
                  {newEventForm.type === 'personal' ? (
                    /* Pessoal: sempre privado, pergunta só quem compartilhar */
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded-full bg-fuchsia-100 flex items-center justify-center shrink-0">
                          <Users className="w-3 h-3 text-fuchsia-600" />
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          Compartilhar com alguém?
                        </p>
                        {newEventForm.shared_with_ids.length > 0 && (
                          <span className="text-[10px] font-semibold text-fuchsia-600 bg-fuchsia-50 px-1.5 py-0.5 rounded-full">
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
                                    isShared ? 'ring-[3px] ring-fuchsia-500 ring-offset-1' : 'ring-1 ring-slate-200 opacity-60 group-hover:opacity-100'
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
                            : 'bg-slate-50 border-slate-200 shadow-[0_0_0_3px_rgba(148,163,184,.10)]'
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
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-300 ${newEventForm.is_private ? 'translate-x-6' : 'translate-x-1'}`} />
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
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                    Observações <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                  </label>
                  <textarea
                    value={newEventForm.description}
                    onChange={(e) => setNewEventForm({ ...newEventForm, description: e.target.value })}
                    rows={2}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 resize-none transition-all"
                    placeholder="Anotações, detalhes adicionais..."
                  />
                </div>

              </div>{/* fim grid */}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-4 flex items-center justify-between gap-3">
              <div>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCloseCreateModal}
                  className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition"
                  disabled={savingEvent}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubmitEvent}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition disabled:opacity-60 shadow-sm shadow-orange-200"
                  disabled={savingEvent}
                >
                  {savingEvent && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingEventId ? 'Salvar alterações' : 'Criar compromisso'}
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Modal de cadastro de novo cliente */}
      {isClientFormOpen && createPortal(
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-0 sm:px-6 py-0 sm:py-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsClientFormOpen(false)} />
          <div className="relative w-full sm:max-w-4xl max-h-[96vh] sm:max-h-[92vh] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Faixa verde — identidade de cliente */}
            <div className="h-1 w-full bg-gradient-to-r from-emerald-400 to-teal-500 flex-shrink-0" />
            {/* Header premium */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <User className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Clientes</p>
                  <h2 className="text-base font-bold text-slate-800 leading-tight">Novo Cliente</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsClientFormOpen(false)}
                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Corpo do ClientForm */}
            <div className="flex-1 overflow-y-auto">
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
            </div>
          </div>
        </div>
      , document.body)}

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
        .calendar-chip__title {
          flex: 1;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 600;
        }
        .calendar-chip--deadline {
          background: #e0e7ff;
          color: #4338ca;
          border-color: #6366f1;
        }
        .calendar-chip--deadline.calendar-event--priority-urgent {
          background: #fef2f2;
          color: #b91c1c;
          border-color: #ef4444;
        }
        .calendar-chip--deadline.calendar-event--priority-high {
          background: #fef3c7;
          color: #b45309;
          border-color: #f59e0b;
        }
        .calendar-chip--deadline.calendar-event--priority-medium {
          background: #e0e7ff;
          color: #4338ca;
          border-color: #6366f1;
        }
        .calendar-chip--deadline.calendar-event--priority-low {
          background: #f1f5f9;
          color: #475569;
          border-color: #94a3b8;
        }
        .calendar-chip--hearing {
          background: #fee2e2;
          color: #b91c1c;
          border-color: #ef4444;
        }
        .calendar-chip--payment {
          background: #e0f2fe;
          color: #0369a1;
          border-color: #0ea5e9;
        }
        .calendar-chip--pericia {
          background: #f3e8ff;
          color: #7c3aed;
          border-color: #a855f7;
        }
        .calendar-chip--meeting {
          background: #d1fae5;
          color: #047857;
          border-color: #10b981;
        }
        .calendar-chip--requirement {
          background: #ffedd5;
          color: #c2410c;
          border-color: #f97316;
        }
        .calendar-chip--personal {
          background: #fae8ff;
          color: #a21caf;
          border-color: #d946ef;
        }

        /* Dark mode styles for calendar chips */
        .dark .calendar-chip--deadline {
          background: #1e1b4b;
          color: #a5b4fc;
          border-color: #6366f1;
        }
        .dark .calendar-chip--deadline.calendar-event--priority-urgent {
          background: #450a0a;
          color: #fca5a5;
          border-color: #ef4444;
        }
        .dark .calendar-chip--deadline.calendar-event--priority-high {
          background: #451a03;
          color: #fcd34d;
          border-color: #f59e0b;
        }
        .dark .calendar-chip--deadline.calendar-event--priority-medium {
          background: #1e1b4b;
          color: #a5b4fc;
          border-color: #6366f1;
        }
        .dark .calendar-chip--deadline.calendar-event--priority-low {
          background: #0f172a;
          color: #cbd5e1;
          border-color: #64748b;
        }
        .dark .calendar-chip--hearing {
          background: #450a0a;
          color: #fca5a5;
          border-color: #ef4444;
        }
        .dark .calendar-chip--payment {
          background: #0c4a6e;
          color: #7dd3fc;
          border-color: #0ea5e9;
        }
        .dark .calendar-chip--pericia {
          background: #3b0764;
          color: #d8b4fe;
          border-color: #a855f7;
        }
        .dark .calendar-chip--meeting {
          background: #064e3b;
          color: #6ee7b7;
          border-color: #10b981;
        }
        .dark .calendar-chip--requirement {
          background: #431407;
          color: #fed7aa;
          border-color: #f97316;
        }
        .dark .calendar-chip--personal {
          background: #4a044e;
          color: #f0abfc;
          border-color: #d946ef;
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
          background: linear-gradient(135deg, #0ea5e9, #2563eb);
        }
        .calendar-legend-chip--hearing {
          background: linear-gradient(135deg, #f43f5e, #ef4444);
        }
        .calendar-legend-chip--requirement {
          background: linear-gradient(135deg, #f59e0b, #f97316);
        }
        .calendar-legend-chip--payment {
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
        }
        .calendar-legend-chip--pericia {
          background: linear-gradient(135deg, #a855f7, #7c3aed);
        }
        .calendar-legend-chip--meeting {
          background: linear-gradient(135deg, #34d399, #059669);
        }
        .calendar-legend-chip--personal {
          background: linear-gradient(135deg, #e879f9, #a21caf);
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
      {isExportModalOpen && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsExportModalOpen(false)} aria-hidden="true" />
        <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Exportação</p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Exportar Agenda</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Selecione o período que deseja exportar</p>
          </div>
          <div className="p-6 bg-white dark:bg-zinc-900">

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
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
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
                    : 'border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-zinc-600'
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
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
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
                    : 'border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600'
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
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${exportPrivate ? 'left-5' : 'left-0.5'}`} />
                </div>
              </button>
            )}

            {/* Botões */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border-2 border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
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
          </div>
          </div>
        </div>
      </div>
      )}

      {isDeletionLogOpen &&
        createPortal(
          <div className="fixed inset-0 z-[75] flex items-center justify-center px-3 sm:px-6 py-4">
            <div
              className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
              onClick={() => setIsDeletionLogOpen(false)}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
              <div className="h-2 w-full bg-orange-500" />
              <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    Auditoria
                  </p>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Log de Exclusões</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    Exclusões dos últimos 30 dias.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeletionLogOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                  aria-label="Fechar modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-4 sm:p-6">
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
                      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 p-6 text-sm text-slate-600 dark:text-slate-400">
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
                                className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
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
                                  <span className="shrink-0 inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
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
              </div>

              <div className="flex-shrink-0 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3 sm:py-4">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsDeletionLogOpen(false)}
                    className="px-4 py-2 text-xs sm:text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal de Correspondentes */}
      {isRepresentativesPanelOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setIsRepresentativesPanelOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl shadow-2xl">
            <RepresentativesPanel
              onClose={() => setIsRepresentativesPanelOpen(false)}
              onDataChanged={loadData}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CalendarModule;
