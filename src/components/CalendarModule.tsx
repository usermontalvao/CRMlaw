import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import ptLocale from '@fullcalendar/core/locales/pt-br';
import type { EventContentArg, EventInput } from '@fullcalendar/core';
import { Loader2, Calendar as CalendarIcon, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { deadlineService } from '../services/deadline.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { clientService } from '../services/client.service';
import { calendarService } from '../services/calendar.service';
import type { Deadline } from '../types/deadline.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import type { Client } from '../types/client.types';
import type { CalendarEvent } from '../types/calendar.types';

declare global {
  interface Window {
    jspdf?: any;
  }
}

type EventType = 'deadline' | 'hearing' | 'requirement' | 'payment' | 'meeting' | 'pericia';

type NewEventForm = {
  title: string;
  date: string;
  time: string;
  type: EventType;
  description: string;
  client_id: string;
};

interface CalendarModuleProps {
  userName?: string;
  onNavigateToModule?: (params: { module: string; entityId?: string }) => void;
  onEditSystemEntity?: (payload: { module: string; entityId: string; data?: any }) => void;
  prefillData?: {
    title?: string;
    description?: string;
    client_id?: string;
    process_code?: string;
    client_name?: string;
  };
  forceCreate?: boolean;
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
    calendarEventId?: string;
    entityId?: string;
  };
};

const CalendarModule: React.FC<CalendarModuleProps> = ({
  userName,
  onNavigateToModule,
  onEditSystemEntity,
  prefillData,
  forceCreate,
  onParamConsumed,
}) => {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [calendarEventsData, setCalendarEventsData] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [viewFilters, setViewFilters] = useState<Record<EventType, boolean>>({
    deadline: true,
    hearing: true,
    requirement: true,
    payment: true,
    meeting: true,
    pericia: true,
  });
  const [newEventForm, setNewEventForm] = useState<NewEventForm>({
    title: '',
    date: '',
    time: '',
    type: 'meeting',
    description: '',
    client_id: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPeriod, setExportPeriod] = useState<'7' | '15' | '30' | '60' | 'custom'>('30');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportFormat, setExportFormat] = useState<'excel' | 'pdf'>('excel');
  const [showTodayPanel, setShowTodayPanel] = useState(true);
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarView, setCalendarView] = useState<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek'>('dayGridMonth');
  const linkedClient = useMemo(
    () => clients.find((client) => client.id === newEventForm.client_id) || null,
    [clients, newEventForm.client_id],
  );

  const currentMonthName = useMemo(() => {
    return calendarTitle || new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }, [calendarTitle]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [feedback]);
  const clientMap = useMemo(() => {
    const map = new Map<string, Client>();
    clients.forEach((client) => {
      if (client.id) {
        map.set(client.id, client);
      }
    });
    return map;
  }, [clients]);

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
        ...initialValues,
      };

      setNewEventForm(merged);

      if (merged.client_id) {
        const client = clientMap.get(merged.client_id);
        setClientSearchTerm(client?.full_name ?? '');
      } else {
        setClientSearchTerm('');
      }

      setShowClientSuggestions(false);
      setEditingEventId(editingId);
      setIsCreateModalOpen(true);
    },
    [clientMap],
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
      return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }, []);

  const selectedEventModuleLabel = useMemo(() => {
    if (!selectedEvent?.extendedProps?.moduleLink) return null;
    const moduleKey = selectedEvent.extendedProps.moduleLink;
    return moduleLabels[moduleKey] ?? moduleKey;
  }, [moduleLabels, selectedEvent]);

  const selectedEventDataDetails = useMemo(() => {
    if (!selectedEvent?.extendedProps?.data) return [] as { label: string; value: string }[];
    const data = selectedEvent.extendedProps.data as Record<string, any>;
    const details: { label: string; value: string }[] = [];

    const pushDetail = (label: string, value?: any, formatter?: (value: any) => string) => {
      if (value === undefined || value === null || value === '') return;
      const formatted = formatter ? formatter(value) : String(value);
      details.push({ label, value: formatted });
    };

    pushDetail('Processo', data.process_code);
    pushDetail('Protocolo', data.protocol);
    pushDetail('Responsável', data.responsible_lawyer);
    pushDetail('Vara/Órgão', data.court);
    pushDetail('Beneficiário', data.beneficiary);
    pushDetail('Prazo original', data.due_date, formatDateTime);
    pushDetail('Agendado para', data.hearing_date, (date: string) => {
      const combined = data.hearing_time ? `${date}T${data.hearing_time}` : date;
      return formatDateTime(combined);
    });

    return details;
  }, [formatDateTime, selectedEvent]);

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
    loadData();
    loadClients();
  }, []);

  useEffect(() => {
    if (forceCreate && !isCreateModalOpen) {
      const initialValues: Partial<NewEventForm> = {};
      
      if (prefillData) {
        if (prefillData.title) initialValues.title = prefillData.title;
        if (prefillData.description) initialValues.description = prefillData.description;
        if (prefillData.client_id) initialValues.client_id = prefillData.client_id;
        
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

      const [deadlinesData, processesData, requirementsData, calendarEventsRemote] = await Promise.all([
        deadlineService.listDeadlines(),
        processService.listProcesses(),
        requirementService.listRequirements(),
        calendarService.listEvents(),
      ]);

      setDeadlines(deadlinesData);
      setProcesses(processesData);
      setRequirements(requirementsData);
      setCalendarEventsData(calendarEventsRemote);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados do calendário');
    } finally {
      setLoading(false);
    }
  };

  const systemEvents: EventInput[] = useMemo(() => {
    const calendarEvents: EventInput[] = [];

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
            entityId: deadline.id,
          },
        });
      });

    // Audiências
    processes
      .filter((p) => p.hearing_scheduled && p.hearing_date)
      .forEach((process) => {
        const relatedClient = process.client_id ? clientMap.get(process.client_id) : null;
        const clientLabel = (relatedClient?.full_name || 'Sem cliente').toUpperCase();
        const modeLabel = process.hearing_mode ? process.hearing_mode.toUpperCase() : 'SEM MODO';
        const formattedTitle = `AUDIÊNCIA - ${modeLabel} - ${clientLabel}`;
        const startDateTime = process.hearing_time
          ? `${process.hearing_date}T${process.hearing_time}`
          : process.hearing_date;

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
  }, [deadlines, processes, requirements, clientMap]);

  // Eventos personalizados vindos da tabela calendar_events
  const customEvents = useMemo(() => {
    return calendarEventsData.map((item) => {
      const relatedClient = item.client_id ? clientMap.get(item.client_id) : null;
      const classNames = ['calendar-event', `calendar-chip--${item.event_type}`];
      const hasTime = item.start_at.includes('T') && !item.start_at.endsWith('T00:00:00.000Z') && !item.start_at.endsWith('T00:00:00+00:00');

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
          moduleLink:
            item.event_type === 'deadline'
              ? 'prazos'
              : item.event_type === 'hearing'
              ? 'processos'
              : item.event_type === 'requirement'
              ? 'requerimentos'
              : undefined,
          clientName: relatedClient?.full_name,
          clientPhone: relatedClient?.mobile || relatedClient?.phone,
          calendarEventId: item.id,
        },
      } as EventInput;
    });
  }, [calendarEventsData, clientMap]);

  const allEvents = useMemo(() => {
    const combined = [...systemEvents, ...customEvents];
    return combined.filter((event) => {
      const eventType = event.extendedProps?.type as EventType | undefined;
      if (!eventType) return true;
      return viewFilters[eventType] ?? true;
    });
  }, [systemEvents, customEvents, viewFilters]);

  const handleEventClick = useCallback(
    (info: any) => {
      const extendedProps = info.event.extendedProps as Record<string, any>;
      const calendarEventId = extendedProps?.calendarEventId as string | undefined;

      if (calendarEventId) {
        const startDate = info.event.start ?? new Date();
        const isAllDay = info.event.allDay;
        const existing = calendarEventsData.find((event) => event.id === calendarEventId) || null;

        openEventForm(
          {
            title: info.event.title,
            date: formatDateInputValue(startDate),
            time: isAllDay ? '' : formatTimeInputValue(startDate),
            type: (extendedProps.type as EventType) || 'meeting',
            description: extendedProps.description ?? '',
            client_id: existing?.client_id ?? '',
          },
          calendarEventId,
        );
        return;
      }

      setSelectedEvent({
        title: info.event.title,
        start: info.event.startStr,
        end: info.event.endStr,
        allDay: info.event.allDay,
        extendedProps,
      });
    },
    [calendarEventsData, formatDateInputValue, formatTimeInputValue, openEventForm],
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
    setShowClientSuggestions(false);
    setSelectedEvent(null);
  }, []);

  const handleSubmitEvent = async () => {
    if (!newEventForm.title.trim()) {
      alert('Informe o título do compromisso.');
      return;
    }

    try {
      setSavingEvent(true);
      const basePayload = {
        title: newEventForm.title.trim(),
        description: newEventForm.description.trim() || null,
        event_type: newEventForm.type,
        start_at: computeStartAt(newEventForm.date, newEventForm.time),
        notify_minutes_before: null as number | null,
        client_id: newEventForm.client_id || null,
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
        setFeedback({ type: 'success', message: `Compromisso "${newEventForm.title}" atualizado com sucesso!` });
      } else {
        const createdEvent = await calendarService.createEvent({
          ...basePayload,
          status: 'pendente',
        });
        setCalendarEventsData((prev) => [...prev, createdEvent]);

        const api = calendarRef.current?.getApi();
        api?.addEvent({
          id: `calendar-${createdEvent.id}`,
          title: createdEvent.title,
          start: createdEvent.start_at,
          allDay: isAllDay,
        });
        setFeedback({ type: 'success', message: `Compromisso "${newEventForm.title}" criado com sucesso!` });
      }

      await loadData();
      handleCloseCreateModal();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erro ao salvar compromisso.' });
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!editingEventId) return;
    const confirmed = window.confirm('Deseja realmente excluir este compromisso?');
    if (!confirmed) {
      return;
    }

    try {
      setSavingEvent(true);
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
    (moduleLink?: string, entityId?: string) => {
      if (!moduleLink) return;
      setSelectedEvent(null);
      if (onNavigateToModule) {
        onNavigateToModule({ module: moduleLink, entityId });
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
        },
        calendarEventId,
      );
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
        // Exportar PDF
        const jspdfModule = await loadJsPdf();
        const doc = new jspdfModule.jsPDF('landscape', 'pt', 'a4');
        const today = new Date().toLocaleDateString('pt-BR');
        const pageWidth = doc.internal.pageSize.getWidth();

        // Adicionar logo
        try {
          const logoImg = new Image();
          logoImg.src = '/icon-512.png';
          await new Promise((resolve, reject) => {
            logoImg.onload = resolve;
            logoImg.onerror = reject;
            setTimeout(reject, 3000); // timeout de 3s
          });
          doc.addImage(logoImg, 'PNG', 40, 30, 50, 50);
        } catch (err) {
          console.warn('Logo não carregada:', err);
        }

        // Cabeçalho - Título e Informações
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, pageWidth, 25, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('ADVOGADO.WEB - GESTÃO JURÍDICA', pageWidth / 2, 16, { align: 'center' });

        // Título Principal
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.text('Agenda de Compromissos', 110, 55);

        // Linha decorativa
        doc.setDrawColor(245, 158, 11); // amber-500
        doc.setLineWidth(3);
        doc.line(110, 62, 280, 62);

        // Informações do período e data
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105); // slate-600
        
        const periodText = exportPeriod === 'custom'
          ? `Período: ${new Date(exportStartDate + 'T00:00:00').toLocaleDateString('pt-BR')} a ${new Date(exportEndDate + 'T00:00:00').toLocaleDateString('pt-BR')}`
          : `Próximos ${exportPeriod} dias`;
        doc.text(periodText, 110, 75);
        
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Gerado em: ${today} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 110, 88);
        
        // Nome do usuário
        const exportedBy = userName || 'Usuário do Sistema';
        doc.text(`Exportado por: ${exportedBy}`, 110, 100);

        // Tabela de compromissos
        (doc as any).autoTable({
          startY: 115,
          head: [['Data', 'Tipo', 'Título', 'Cliente', 'Telefone', 'Status', 'Prioridade', 'Descrição']],
          body: rows.map((row) => [
            row['Data'],
            row['Tipo'],
            row['Título'],
            row['Cliente'],
            row['Telefone'],
            row['Status'],
            row['Prioridade'],
            row['Descrição'],
          ]),
          styles: {
            font: 'helvetica',
            fontSize: 8,
            cellPadding: 4,
            lineWidth: 0.5,
            lineColor: [226, 232, 240], // slate-200
            overflow: 'linebreak',
            cellWidth: 'wrap',
            textColor: [30, 41, 59], // slate-800
          },
          headStyles: {
            fillColor: [15, 23, 42], // slate-900
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9,
            halign: 'center',
            cellPadding: 5,
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252], // slate-50
          },
          columnStyles: {
            0: { cellWidth: 75, halign: 'center' },
            1: { cellWidth: 55, halign: 'center', fontStyle: 'bold' },
            2: { cellWidth: 130 },
            3: { cellWidth: 90 },
            4: { cellWidth: 70, halign: 'center' },
            5: { cellWidth: 65, halign: 'center' },
            6: { cellWidth: 50, halign: 'center' },
            7: { cellWidth: 'auto' },
          },
          margin: { top: 115, left: 30, right: 30, bottom: 40 },
          didDrawPage: (data: any) => {
            // Rodapé
            const pageCount = doc.internal.pages.length - 1;
            const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
            
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184); // slate-400
            doc.text(
              `Página ${pageNumber} de ${pageCount}`,
              pageWidth / 2,
              doc.internal.pageSize.getHeight() - 20,
              { align: 'center' }
            );
            
            // Linha no rodapé
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.5);
            doc.line(30, doc.internal.pageSize.getHeight() - 30, pageWidth - 30, doc.internal.pageSize.getHeight() - 30);
            
            doc.setFontSize(7);
            doc.text(
              'Advogado.Web - Sistema de Gestão Jurídica',
              30,
              doc.internal.pageSize.getHeight() - 20
            );
            doc.text(
              `Gerado em ${today}`,
              pageWidth - 30,
              doc.internal.pageSize.getHeight() - 20,
              { align: 'right' }
            );
          },
        });

        const periodLabel = exportPeriod === 'custom' 
          ? `${exportStartDate}_${exportEndDate}`
          : `proximos_${exportPeriod}_dias`;
        doc.save(`agenda_${periodLabel}.pdf`);
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

    const displayTime = timeText && timeText.trim().length > 0 ? timeText : '00';

    return (
      <div className={`calendar-chip calendar-chip--${type}`}>
        <span className="calendar-chip__time">{displayTime}</span>
        <span className="calendar-chip__title" title={event.title}>
          {event.title}
        </span>
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
    <div className="calendar-page">
      {feedback && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] max-w-sm rounded-xl border px-4 py-3 shadow-lg transition transform ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Header Premium Full Width */}
      <div className="relative -mx-3 sm:-mx-4 lg:-mx-6 xl:-mx-8 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-transparent to-purple-600/10" />

        <div className="relative px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          {/* Tudo em uma única linha */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto">
            {/* Esquerda: Título + Navegação + Mês */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <CalendarIcon className="w-4 h-4 text-white" />
                </div>
                <h1 className="text-base font-bold text-white">Agenda</h1>
              </div>
              
              <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => calendarRef.current?.getApi().prev()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-white font-bold hover:bg-white/30 transition"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => calendarRef.current?.getApi().today()}
                  className="px-2 py-1 text-xs font-bold text-white rounded-lg bg-white/20 hover:bg-white/30 transition"
                >
                  Hoje
                </button>
                <button
                  type="button"
                  onClick={() => calendarRef.current?.getApi().next()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 text-white font-bold hover:bg-white/30 transition"
                >
                  ›
                </button>
              </div>

              <div className="px-3 py-1.5 bg-white/20 rounded-xl">
                <span className="text-xs font-bold text-white capitalize whitespace-nowrap">{currentMonthName}</span>
              </div>
            </div>

            {/* Centro: Views */}
            <div className="hidden md:flex items-center gap-1 bg-white/10 rounded-xl p-1">
              {([
                { label: 'Mês', view: 'dayGridMonth' },
                { label: 'Semana', view: 'timeGridWeek' },
                { label: 'Dia', view: 'timeGridDay' },
              ] as const).map(({ label, view }) => {
                const isActive = calendarView === view;
                return (
                  <button
                    key={view}
                    type="button"
                    onClick={() => handleChangeView(view)}
                    className={`px-2 py-1 rounded-lg transition text-xs font-semibold ${
                      isActive ? 'bg-white text-slate-900 shadow-lg' : 'text-white hover:bg-white/20'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Direita: Ações */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => openEventForm()}
                className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-xl font-semibold text-xs transition shadow-lg"
              >
                + Novo
              </button>
              <button
                type="button"
                onClick={() => setLegendExpanded((prev) => !prev)}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-xs transition border border-white/30"
              >
                Filtros
              </button>
              <div className="hidden lg:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleOpenExportModal('excel')}
                  className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-xs transition shadow-lg"
                >
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenExportModal('pdf')}
                  className="px-2 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold text-xs transition shadow-lg"
                >
                  PDF
                </button>
              </div>
            </div>
          </div>

          {/* Filtros e Legenda */}
          {legendExpanded && (
            <div className="border-t border-white/20 pt-4 mt-4">
            <div className="bg-white/10 rounded-xl p-4">
              <h4 className="text-xs sm:text-sm font-bold text-white mb-3">Filtrar por Tipo</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.deadline}
                    onChange={() => setViewFilters((prev) => ({ ...prev, deadline: !prev.deadline }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--deadline group-hover:scale-105 transition-transform">
                    Prazos
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.hearing}
                    onChange={() => setViewFilters((prev) => ({ ...prev, hearing: !prev.hearing }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--hearing group-hover:scale-105 transition-transform">
                    Audiências
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.requirement}
                    onChange={() => setViewFilters((prev) => ({ ...prev, requirement: !prev.requirement }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--requirement group-hover:scale-105 transition-transform">
                    Exigências
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.payment}
                    onChange={() => setViewFilters((prev) => ({ ...prev, payment: !prev.payment }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--payment group-hover:scale-105 transition-transform">
                    Recebimentos
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.pericia}
                    onChange={() => setViewFilters((prev) => ({ ...prev, pericia: !prev.pericia }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--pericia group-hover:scale-105 transition-transform">
                    Perícias
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={viewFilters.meeting}
                    onChange={() => setViewFilters((prev) => ({ ...prev, meeting: !prev.meeting }))}
                    className="w-4 h-4 rounded border-2 border-white/30 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="calendar-legend-chip calendar-legend-chip--meeting group-hover:scale-105 transition-transform">
                    Reuniões
                  </span>
                </label>
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* Calendário com recuo */}
      <div className="relative bg-white mt-4 sm:mt-6 rounded-t-2xl sm:rounded-t-3xl shadow-2xl">
          <div className="calendar-container px-2 sm:px-4 md:px-6 py-4 sm:py-6 md:py-8">
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
              dayMaxEvents={3}
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
        className="fixed bottom-8 right-8 w-16 h-16 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white rounded-full shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-110 z-40 flex items-center justify-center group"
        title="Criar novo compromisso"
      >
        <CalendarIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />
        <div className="absolute -top-12 right-0 bg-slate-900 text-white text-xs px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          Novo Compromisso
        </div>
      </button>

      {/* Modal de Detalhes do Evento */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/50 max-w-lg w-full overflow-hidden border border-zinc-200 dark:border-zinc-700/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-zinc-800 dark:to-zinc-900 p-6 border-b border-slate-100 dark:border-zinc-700/50">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{selectedEvent.title}</h3>
                  {selectedEventModuleLabel && (
                    <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-semibold">
                      {selectedEventModuleLabel}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full p-2 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">Data:</span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {selectedEvent.start
                    ? new Intl.DateTimeFormat('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(selectedEvent.start))
                    : '—'}
                </span>
              </div>

              {selectedEvent.extendedProps.type && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Tipo:</span>
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">{selectedEvent.extendedProps.type}</span>
                </div>
              )}

              {selectedEvent.extendedProps.priority && (
                <div>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Prioridade:</span>{' '}
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">{selectedEvent.extendedProps.priority}</span>
                </div>
              )}

              {selectedEvent.extendedProps.status && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Status:</span>
                  <span className="text-zinc-600 dark:text-zinc-400 capitalize">{selectedEvent.extendedProps.status}</span>
                </div>
              )}

              {selectedEvent.extendedProps.clientName && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Cliente:</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{selectedEvent.extendedProps.clientName}</span>
                </div>
              )}

              {selectedEvent.extendedProps.clientPhone && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Telefone:</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{selectedEvent.extendedProps.clientPhone}</span>
                </div>
              )}

              {selectedEvent.extendedProps.description && (
                <div>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Descrição:</span>{' '}
                  <p className="text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap">{selectedEvent.extendedProps.description}</p>
                </div>
              )}

              {selectedEventDataDetails.length > 0 && (
                <div className="space-y-1">
                  {selectedEventDataDetails.map((detail) => (
                    <div key={`${detail.label}-${detail.value}`} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">{detail.label}:</span>
                      <span>{detail.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 pb-6 flex flex-wrap items-center justify-end gap-3">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white transition"
              >
                Fechar
              </button>
              {showEditButton && (
                <button
                  onClick={handleEditSelectedEvent}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                >
                  {editButtonLabel}
                </button>
              )}
              {canCreateLinkedEvent && (
                <button
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
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition"
                >
                  Criar compromisso
                </button>
              )}
              {selectedEvent.extendedProps.moduleLink && (
                <button
                  onClick={() => handleNavigateToModule(
                    selectedEvent.extendedProps.moduleLink,
                    selectedEvent.extendedProps.entityId
                  )}
                  className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                >
                  Ir para Módulo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação/Edição de Compromisso */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={handleCloseCreateModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {editingEventId ? 'Editar Compromisso' : 'Novo Compromisso'}
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  {newEventForm.date
                    ? new Date(newEventForm.date + 'T00:00:00').toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })
                    : 'Selecione uma data'}
                </p>
              </div>
              <button
                onClick={handleCloseCreateModal}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corpo rolável */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700">Título *</label>
                <input
                  value={newEventForm.title}
                  onChange={(e) => setNewEventForm({ ...newEventForm, title: e.target.value })}
                  className="input-field"
                  placeholder="Ex: Reunião com cliente"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Data *</label>
                  <input
                    type="date"
                    value={newEventForm.date}
                    onChange={(e) => setNewEventForm({ ...newEventForm, date: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Horário</label>
                  <input
                    type="time"
                    value={newEventForm.time}
                    onChange={(e) => setNewEventForm({ ...newEventForm, time: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Tipo de Compromisso</label>
                <select
                  value={newEventForm.type}
                  onChange={(e) => setNewEventForm({ ...newEventForm, type: e.target.value as EventType })}
                  className="input-field"
                >
                  <option value="meeting">Reunião</option>
                  <option value="deadline">Prazo</option>
                  <option value="hearing">Audiência</option>
                  <option value="pericia">Perícia</option>
                  <option value="payment">Recebimento</option>
                  <option value="requirement">Exigência</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Cliente (Opcional)</label>
                <div className="relative">
                  <input
                    value={clientSearchTerm}
                    onChange={(e) => {
                      setClientSearchTerm(e.target.value);
                      setShowClientSuggestions(true);
                    }}
                    onFocus={() => setShowClientSuggestions(true)}
                    className="input-field"
                    placeholder="Buscar cliente..."
                  />
                  {showClientSuggestions && clientSearchTerm.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {clients
                        .filter((c) =>
                          c.full_name.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
                          (c.cpf_cnpj && c.cpf_cnpj.includes(clientSearchTerm))
                        )
                        .slice(0, 5)
                        .map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition"
                            onClick={() => {
                              setNewEventForm({ ...newEventForm, client_id: client.id });
                              setClientSearchTerm(client.full_name);
                              setShowClientSuggestions(false);
                            }}
                          >
                            <div className="font-semibold text-slate-800">{client.full_name}</div>
                            <div className="text-xs text-slate-500 flex flex-col">
                              <span>{client.cpf_cnpj || 'CPF não informado'}</span>
                              <span>{client.mobile || client.phone || 'Telefone não informado'}</span>
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {linkedClient && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex flex-col gap-1">
                    <div className="font-semibold text-slate-800">{linkedClient.full_name}</div>
                    {linkedClient.mobile || linkedClient.phone ? (
                      <span>Telefone: {linkedClient.mobile || linkedClient.phone}</span>
                    ) : (
                      <span>Telefone não informado.</span>
                    )}
                    {linkedClient.email && <span>Email: {linkedClient.email}</span>}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">Descrição</label>
                <textarea
                  value={newEventForm.description}
                  onChange={(e) => setNewEventForm({ ...newEventForm, description: e.target.value })}
                  rows={3}
                  className="input-field"
                  placeholder="Detalhes adicionais sobre o compromisso"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0 bg-white">
              {editingEventId && (
                <button
                  type="button"
                  onClick={handleDeleteEvent}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:cursor-not-allowed"
                  disabled={savingEvent}
                >
                  Excluir
                </button>
              )}
              <button
                type="button"
                onClick={handleCloseCreateModal}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                disabled={savingEvent}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmitEvent}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-60"
                disabled={savingEvent}
              >
                {savingEvent && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingEventId ? 'Salvar alterações' : 'Criar Compromisso'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        .calendar-chip {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          border-radius: 8px;
          padding: 0.35rem 0.6rem;
          font-size: 0.7rem;
          font-weight: 600;
          color: #ffffff;
          box-shadow: 0 8px 18px -14px rgba(15, 23, 42, 0.8);
          width: 100%;
          box-sizing: border-box;
        }
        .calendar-chip__time {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.8rem;
          padding: 0.2rem 0.3rem;
          border-radius: 5px;
          background: rgba(15, 23, 42, 0.2);
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .calendar-chip__title {
          flex: 1;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .calendar-chip--deadline {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        }
        .calendar-chip--deadline.calendar-event--priority-urgent {
          background: linear-gradient(135deg, #7c3aed, #5b21b6);
        }
        .calendar-chip--deadline.calendar-event--priority-high {
          background: linear-gradient(135deg, #a855f7, #7c3aed);
        }
        .calendar-chip--deadline.calendar-event--priority-medium {
          background: linear-gradient(135deg, #c4b5fd, #a855f7);
        }
        .calendar-chip--deadline.calendar-event--priority-low {
          background: linear-gradient(135deg, #ddd6fe, #c4b5fd);
          color: #4c1d95;
        }
        .calendar-chip--hearing {
          background: linear-gradient(135deg, #f43f5e, #ef4444);
        }
        .calendar-chip--payment {
          background: linear-gradient(135deg, #06b6d4, #3b82f6);
        }
        .calendar-chip--pericia {
          background: linear-gradient(135deg, #a855f7, #7c3aed);
        }
        .calendar-chip--meeting {
          background: linear-gradient(135deg, #34d399, #059669);
        }
        .calendar-chip--requirement {
          background: linear-gradient(135deg, #f59e0b, #f97316);
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
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Exportar Agenda</h3>
          <p className="text-sm text-slate-600 mb-6">Selecione o período que deseja exportar</p>

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
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                📆 Período Personalizado
              </button>
            </div>

            {/* Datas Personalizadas */}
            {exportPeriod === 'custom' && (
              <div className="grid grid-cols-2 gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1.5">
                    Data Início
                  </label>
                  <input
                    type="date"
                    value={exportStartDate}
                    onChange={(e) => setExportStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-900 mb-1.5">
                    Data Fim
                  </label>
                  <input
                    type="date"
                    value={exportEndDate}
                    onChange={(e) => setExportEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className={`flex-1 px-4 py-2.5 rounded-lg ${
                  exportFormat === 'pdf'
                    ? 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600'
                    : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600'
                } text-white font-bold shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5`}
              >
                {exportFormat === 'pdf' ? '📄 Exportar PDF' : '📥 Exportar Excel'}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};

export default CalendarModule;
