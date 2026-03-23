import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Phone,
  Mail,
  CreditCard,
  Building2,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
  Calendar,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Eye,
  Filter,
  RefreshCw,
  Loader2,
  UserCheck,
  Banknote,
  Receipt,
  MapPin,
} from 'lucide-react';
import { representativeService } from '../services/representative.service';
import { calendarService } from '../services/calendar.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useToastContext } from '../contexts/ToastContext';
import type {
  Representative,
  RepresentativeAppointment,
  CreateRepresentativeDTO,
  UpdateRepresentativeDTO,
  CreateRepresentativeAppointmentDTO,
  ServiceStatus,
  PaymentStatus,
  PaymentMethod,
  SERVICE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../types/representative.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';

// Labels inline para evitar problemas de importação
const SERVICE_STATUS_LABELS_MAP: Record<ServiceStatus, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  nao_compareceu: 'Não Compareceu',
};

const PAYMENT_STATUS_LABELS_MAP: Record<PaymentStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

const PAYMENT_METHOD_LABELS_MAP: Record<PaymentMethod, string> = {
  pix: 'PIX',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  outro: 'Outro',
};

type TabType = 'cadastro' | 'vinculos' | 'arquivados';

interface RepresentativesPanelProps {
  onClose?: () => void;
  initialTab?: TabType;
  preSelectedEventId?: string;
  onDataChanged?: () => Promise<void> | void;
}

const RepresentativesPanel: React.FC<RepresentativesPanelProps> = ({
  onClose,
  initialTab = 'vinculos',
  preSelectedEventId,
  onDataChanged,
}) => {
  const { confirmDelete } = useDeleteConfirm();
  const toast = useToastContext();

  // Estados principais
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [loading, setLoading] = useState(true);
  const [representatives, setRepresentatives] = useState<Representative[]>([]);
  const [appointments, setAppointments] = useState<RepresentativeAppointment[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [representativeModalSearchTerm, setRepresentativeModalSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ativo' | 'inativo'>('ativo');
  const [serviceStatusFilter, setServiceStatusFilter] = useState<'all' | ServiceStatus>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');

  // Modais
  const [isRepresentativeModalOpen, setIsRepresentativeModalOpen] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [editingRepresentative, setEditingRepresentative] = useState<Representative | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<RepresentativeAppointment | null>(null);
  const [payingAppointment, setPayingAppointment] = useState<RepresentativeAppointment | null>(null);

  // Forms
  const [representativeForm, setRepresentativeForm] = useState<CreateRepresentativeDTO>({
    full_name: '',
    cpf: '',
    phone: '',
    email: '',
    pix_key: '',
    bank_name: '',
    bank_agency: '',
    bank_account: '',
    notes: '',
    status: 'ativo',
  });

  const [appointmentForm, setAppointmentForm] = useState<CreateRepresentativeAppointmentDTO>({
    representative_id: '',
    calendar_event_id: preSelectedEventId || '',
    service_date: '',
    diligence_location: '',
    service_description: '',
    service_status: 'agendado',
    service_value: 0,
    payment_status: 'pendente',
    notes: '',
  });

  const [paymentForm, setPaymentForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'pix' as PaymentMethod,
    payment_receipt: '',
    payment_notes: '',
  });

  const [saving, setSaving] = useState(false);

  // Funções de máscara
  const applyCpfMask = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    const maxLength = 11;
    const truncated = numbers.slice(0, maxLength);
    if (truncated.length <= 3) return truncated;
    if (truncated.length <= 6) return `${truncated.slice(0, 3)}.${truncated.slice(3)}`;
    if (truncated.length <= 9) return `${truncated.slice(0, 3)}.${truncated.slice(3, 6)}.${truncated.slice(6)}`;
    return `${truncated.slice(0, 3)}.${truncated.slice(3, 6)}.${truncated.slice(6, 9)}-${truncated.slice(9)}`;
  };

  const applyPhoneMask = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    const maxLength = 11;
    const truncated = numbers.slice(0, maxLength);
    if (truncated.length <= 2) return truncated;
    if (truncated.length <= 3) return `(${truncated.slice(0, 2)}) ${truncated.slice(2)}`;
    if (truncated.length <= 7) return `(${truncated.slice(0, 2)}) ${truncated.slice(2, 3)} ${truncated.slice(3)}`;
    return `(${truncated.slice(0, 2)}) ${truncated.slice(2, 3)} ${truncated.slice(3, 7)}-${truncated.slice(7)}`;
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Carregar dados
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [reps, apts, events, clientsData, processesData] = await Promise.all([
        representativeService.listRepresentatives(),
        representativeService.listAppointments(),
        calendarService.listEvents(),
        clientService.listClients(),
        processService.listProcesses(),
      ]);
      setRepresentatives(reps);
      setAppointments(apts);
      setCalendarEvents(events);
      setClients(clientsData);
      setProcesses(processesData);
    } catch (err: any) {
      toast.error('Erro ao carregar dados', err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtrar prepostos
  const filteredRepresentatives = useMemo(() => {
    return representatives.filter((rep) => {
      if (rep.status !== 'ativo') return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          rep.full_name.toLowerCase().includes(term) ||
          rep.cpf?.toLowerCase().includes(term) ||
          rep.phone?.toLowerCase().includes(term) ||
          rep.email?.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [representatives, searchTerm]);

  const archivedAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      if (!apt.is_archived) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const repName = apt.representative?.full_name?.toLowerCase() || '';
        const eventTitle = apt.calendar_event?.title?.toLowerCase() || '';
        return repName.includes(term) || eventTitle.includes(term);
      }
      return true;
    });
  }, [appointments, searchTerm]);

  const archivedRepresentatives = useMemo(() => {
    return representatives.filter((rep) => {
      if (rep.status !== 'inativo') return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          rep.full_name.toLowerCase().includes(term) ||
          rep.cpf?.toLowerCase().includes(term) ||
          rep.phone?.toLowerCase().includes(term) ||
          rep.email?.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [representatives, searchTerm]);

  // Filtrar vínculos
  const filteredAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      if (apt.is_archived) return false;
      if (serviceStatusFilter !== 'all' && apt.service_status !== serviceStatusFilter) return false;
      if (paymentStatusFilter !== 'all' && apt.payment_status !== paymentStatusFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const repName = apt.representative?.full_name?.toLowerCase() || '';
        const eventTitle = apt.calendar_event?.title?.toLowerCase() || '';
        return repName.includes(term) || eventTitle.includes(term);
      }
      return true;
    });
  }, [appointments, serviceStatusFilter, paymentStatusFilter, searchTerm]);

  const availableActiveRepresentatives = useMemo(() => {
    return representatives.filter((rep) => rep.status === 'ativo');
  }, [representatives]);

  const filteredModalRepresentatives = useMemo(() => {
    const term = representativeModalSearchTerm.trim().toLowerCase();
    if (!term) return [];

    return availableActiveRepresentatives.filter((rep) => (
      rep.full_name.toLowerCase().includes(term)
      || rep.cpf?.toLowerCase().includes(term)
      || rep.phone?.toLowerCase().includes(term)
      || rep.email?.toLowerCase().includes(term)
    )).slice(0, 8);
  }, [availableActiveRepresentatives, representativeModalSearchTerm]);

  const selectedAppointmentRepresentative = useMemo(() => {
    return representatives.find((rep) => rep.id === appointmentForm.representative_id) || null;
  }, [representatives, appointmentForm.representative_id]);

  // Estatísticas
  const stats = useMemo(() => {
    const activeOnly = appointments.filter((apt) => !apt.is_archived);
    const totalValue = activeOnly.reduce((sum, apt) => sum + Number(apt.service_value || 0), 0);
    const paidValue = appointments
      .filter((apt) => !apt.is_archived)
      .filter((apt) => apt.payment_status === 'pago')
      .reduce((sum, apt) => sum + Number(apt.service_value || 0), 0);
    const pendingValue = appointments
      .filter((apt) => !apt.is_archived)
      .filter((apt) => apt.payment_status === 'pendente')
      .reduce((sum, apt) => sum + Number(apt.service_value || 0), 0);
    const activeAppointments = activeOnly.length;

    return {
      totalRepresentatives: representatives.filter((r) => r.status === 'ativo').length,
      totalAppointments: appointments.length,
      activeAppointments,
      totalValue,
      paidValue,
      pendingValue,
    };
  }, [representatives, appointments]);

  // Handlers - Preposto
  const handleOpenRepresentativeModal = (rep?: Representative) => {
    if (rep) {
      setEditingRepresentative(rep);
      setRepresentativeForm({
        full_name: rep.full_name,
        cpf: rep.cpf || '',
        phone: rep.phone || '',
        email: rep.email || '',
        pix_key: rep.pix_key || '',
        bank_name: rep.bank_name || '',
        bank_agency: rep.bank_agency || '',
        bank_account: rep.bank_account || '',
        notes: rep.notes || '',
        status: rep.status,
      });
    } else {
      setEditingRepresentative(null);
      setRepresentativeForm({
        full_name: '',
        cpf: '',
        phone: '',
        email: '',
        pix_key: '',
        bank_name: '',
        bank_agency: '',
        bank_account: '',
        notes: '',
        status: 'ativo',
      });
    }
    setIsRepresentativeModalOpen(true);
  };

  const handleSaveRepresentative = async () => {
    if (!representativeForm.full_name.trim()) {
      toast.error('Erro', 'Nome é obrigatório');
      return;
    }

    try {
      setSaving(true);
      if (editingRepresentative) {
        await representativeService.updateRepresentative(editingRepresentative.id, representativeForm);
        toast.success('Correspondente atualizado');
      } else {
        await representativeService.createRepresentative(representativeForm);
        toast.success('Correspondente cadastrado');
      }
      await loadData();
      setIsRepresentativeModalOpen(false);
    } catch (err: any) {
      toast.error('Erro ao salvar', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRepresentative = async (rep: Representative) => {
    const confirmed = await confirmDelete({
      title: 'Excluir Correspondente',
      entityName: rep.full_name,
      message: 'Todos os vínculos com compromissos também serão removidos.',
    });
    if (!confirmed) return;

    try {
      await representativeService.deleteRepresentative(rep.id);
      toast.success('Correspondente excluído');
      await loadData();
    } catch (err: any) {
      toast.error('Erro ao excluir', err.message);
    }
  };

  // Handlers - Vínculo
  const handleOpenAppointmentModal = (apt?: RepresentativeAppointment) => {
    if (apt) {
      setEditingAppointment(apt);
      setRepresentativeModalSearchTerm(apt.representative?.full_name || '');
      setAppointmentForm({
        representative_id: apt.representative_id,
        calendar_event_id: apt.calendar_event_id,
        service_date: apt.service_date,
        diligence_location: apt.diligence_location || '',
        service_description: apt.service_description || '',
        service_status: apt.service_status,
        service_value: apt.service_value,
        payment_status: apt.payment_status,
        notes: apt.notes || '',
      });
    } else {
      setEditingAppointment(null);
      setRepresentativeModalSearchTerm('');
      setAppointmentForm({
        representative_id: '',
        calendar_event_id: preSelectedEventId || '',
        service_date: '',
        diligence_location: '',
        service_description: '',
        service_status: 'agendado',
        service_value: 0,
        payment_status: 'pendente',
        notes: '',
      });
    }
    setIsAppointmentModalOpen(true);
  };

  const handleSaveAppointment = async () => {
    if (!appointmentForm.representative_id || !appointmentForm.calendar_event_id || !appointmentForm.service_date) {
      toast.error('Erro', 'Correspondente, compromisso e data são obrigatórios');
      return;
    }

    try {
      setSaving(true);
      let calendarEventId = appointmentForm.calendar_event_id;

      if (calendarEventId.startsWith('process-hearing:')) {
        const processId = calendarEventId.replace('process-hearing:', '');
        const process = processes.find((item) => item.id === processId);
        const hearingInfo = process ? getProcessHearingDateTime(process) : null;

        if (!process || !hearingInfo) {
          throw new Error('Não foi possível localizar a audiência do processo selecionado.');
        }

        const hearingModeLabel = process.hearing_mode === 'online' ? 'por vídeo' : 'presencial';
        const createdEvent = await calendarService.createEvent({
          title: `AUDIÊNCIA ${process.hearing_mode === 'online' ? 'POR VÍDEO' : 'PRESENCIAL'} - ${process.process_code || 'PROCESSO'}`,
          description: process.court
            ? `Audiência ${hearingModeLabel} do processo ${process.process_code || ''} • ${process.court}`
            : `Audiência ${hearingModeLabel} do processo ${process.process_code || ''}`,
          event_type: 'hearing',
          status: 'pendente',
          start_at: hearingInfo.dateTime,
          process_id: process.id,
          client_id: process.client_id || null,
        });

        calendarEventId = createdEvent.id;
      }

      const payload = {
        ...appointmentForm,
        calendar_event_id: calendarEventId,
      };

      if (editingAppointment) {
        await representativeService.updateAppointment(editingAppointment.id, payload);
        toast.success('Vínculo atualizado');
      } else {
        await representativeService.createAppointment(payload);
        toast.success('Correspondente vinculado ao compromisso');
      }
      await loadData();
      await onDataChanged?.();
      setIsAppointmentModalOpen(false);
    } catch (err: any) {
      toast.error('Erro ao salvar', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAppointment = async (apt: RepresentativeAppointment) => {
    const confirmed = await confirmDelete({
      title: 'Remover Vínculo',
      message: `Remover ${apt.representative?.full_name} do compromisso?`,
    });
    if (!confirmed) return;

    try {
      await representativeService.deleteAppointment(apt.id);
      toast.success('Vínculo removido');
      await loadData();
      await onDataChanged?.();
    } catch (err: any) {
      toast.error('Erro ao remover', err.message);
    }
  };

  const handleArchiveAppointment = async (apt: RepresentativeAppointment) => {
    try {
      await representativeService.archiveAppointment(apt.id);
      toast.success('Diligência arquivada');
      await loadData();
      await onDataChanged?.();
    } catch (err: any) {
      toast.error('Erro ao arquivar', err.message);
    }
  };

  const handleRestoreAppointment = async (apt: RepresentativeAppointment) => {
    try {
      await representativeService.reactivateAppointment(apt.id);
      toast.success('Diligência reativada');
      await loadData();
      await onDataChanged?.();
    } catch (err: any) {
      toast.error('Erro ao reativar', err.message);
    }
  };

  // Handlers - Pagamento
  const handleOpenPaymentModal = (apt: RepresentativeAppointment) => {
    setPayingAppointment(apt);
    setPaymentForm({
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'pix',
      payment_receipt: '',
      payment_notes: '',
    });
    setIsPaymentModalOpen(true);
  };

  const handleSavePayment = async () => {
    if (!payingAppointment) return;

    try {
      setSaving(true);
      await representativeService.markAsPaid(payingAppointment.id, paymentForm);
      toast.success('Pagamento registrado');
      await loadData();
      await onDataChanged?.();
      setIsPaymentModalOpen(false);
    } catch (err: any) {
      toast.error('Erro ao registrar pagamento', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateServiceStatus = async (apt: RepresentativeAppointment, status: ServiceStatus) => {
    try {
      await representativeService.updateServiceStatus(apt.id, status);
      toast.success('Status atualizado');
      await loadData();
      await onDataChanged?.();
    } catch (err: any) {
      toast.error('Erro ao atualizar', err.message);
    }
  };

  // Formatadores
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('pt-BR');
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr || !dateStr.includes('T')) return 'Sem horário';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'Sem horário';
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getEventTypeLabel = (eventType: CalendarEvent['event_type']) => {
    switch (eventType) {
      case 'hearing':
        return 'Audiência';
      case 'meeting':
        return 'Reunião';
      case 'deadline':
        return 'Prazo';
      case 'requirement':
        return 'Diligência';
      case 'payment':
        return 'Pagamento';
      case 'pericia':
        return 'Perícia';
      default:
        return 'Compromisso';
    }
  };

  const getEventOptionLabel = (event: CalendarEvent) => {
    const title = event.title?.trim() || 'Sem título';
    const description = event.description?.trim() || '';
    const clientName = event.client_id ? clients.find((client) => client.id === event.client_id)?.full_name || '' : '';
    const clientLabel = clientName ? ` | Cliente: ${clientName}` : '';
    const shortDescription = description ? ` | ${description.slice(0, 45)}${description.length > 45 ? '...' : ''}` : '';
    return `${getEventTypeLabel(event.event_type)} | ${formatDate(event.start_at)} | ${formatTime(event.start_at)} | ${title}${clientLabel}${shortDescription}`;
  };

  const getProcessHearingDateTime = (process: Process) => {
    if (!process.hearing_scheduled || !process.hearing_date) return null;
    const time = process.hearing_time && process.hearing_time.trim() ? process.hearing_time.trim() : '09:00';
    const normalizedTime = time.length === 5 ? `${time}:00` : time;
    const dateTime = `${process.hearing_date}T${normalizedTime}`;
    const parsed = new Date(dateTime);
    if (Number.isNaN(parsed.getTime())) return null;
    return { parsed, dateTime };
  };

  const availableFutureEvents = useMemo(() => {
    const now = new Date();

    const realEvents = calendarEvents
      .filter((event) => event.event_type === 'hearing' || event.event_type === 'meeting')
      .filter((event) => {
        if (!event.start_at) return false;
        const eventDate = new Date(event.start_at);
        return !Number.isNaN(eventDate.getTime()) && eventDate >= now;
      })
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    const processHearings = processes
      .filter((process) => process.hearing_scheduled && process.hearing_date)
      .map((process) => {
        const hearingInfo = getProcessHearingDateTime(process);
        if (!hearingInfo || hearingInfo.parsed < now) return null;

        const existingEvent = realEvents.find((event) => {
          if (event.process_id !== process.id || event.event_type !== 'hearing') return false;
          const existingDate = new Date(event.start_at);
          return !Number.isNaN(existingDate.getTime()) && existingDate.getTime() === hearingInfo.parsed.getTime();
        });

        if (existingEvent) return null;

        const clientName = clients.find((client) => client.id === process.client_id)?.full_name;
        const hearingModeLabel = process.hearing_mode === 'online' ? 'POR VÍDEO' : 'PRESENCIAL';
        const title = `AUDIÊNCIA ${hearingModeLabel} - ${process.process_code || 'PROCESSO'}`;

        return {
          id: `process-hearing:${process.id}`,
          title,
          description: process.court || null,
          event_type: 'hearing' as const,
          status: 'pendente' as const,
          start_at: hearingInfo.dateTime,
          end_at: null,
          notify_minutes_before: null,
          deadline_id: null,
          requirement_id: null,
          process_id: process.id,
          client_id: process.client_id,
          created_at: process.created_at,
          updated_at: process.updated_at,
          __source: 'process-hearing' as const,
          __clientName: clientName || null,
        };
      })
      .filter((event): event is CalendarEvent & { __source: 'process-hearing'; __clientName: string | null } => Boolean(event));

    return [...realEvents, ...processHearings]
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [calendarEvents, processes, clients]);

  const getServiceStatusColor = (status: ServiceStatus) => {
    switch (status) {
      case 'agendado':
        return 'bg-blue-100 text-blue-700';
      case 'confirmado':
        return 'bg-indigo-100 text-indigo-700';
      case 'realizado':
        return 'bg-emerald-100 text-emerald-700';
      case 'cancelado':
        return 'bg-red-100 text-red-700';
      case 'nao_compareceu':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  const getPaymentStatusColor = (status: PaymentStatus) => {
    switch (status) {
      case 'pago':
        return 'bg-emerald-100 text-emerald-700';
      case 'pendente':
        return 'bg-amber-100 text-amber-700';
      case 'cancelado':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm overflow-hidden">
      <div className="h-2 w-full bg-orange-500" />
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Correspondentes</h2>
              <p className="text-xs text-slate-500">Gestão de vínculos, diligências e cadastro de correspondentes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              title="Atualizar"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Diligências Ativas</p>
            <p className="text-lg font-bold text-slate-900">{stats.activeAppointments}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Correspondentes Ativos</p>
            <p className="text-lg font-bold text-slate-900">{stats.totalRepresentatives}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Valor Pago</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(stats.paidValue)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Pendente</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(stats.pendingValue)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('vinculos')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'vinculos'
                ? 'text-amber-600 border-b-2 border-amber-500 bg-amber-50/50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Calendar className="w-4 h-4 inline-block mr-2" />
            Vínculos com Compromissos
          </button>
          <button
            onClick={() => setActiveTab('arquivados')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'arquivados'
                ? 'border-b-2 border-slate-600 bg-slate-100 text-slate-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Archive className="w-4 h-4 inline-block mr-2" />
            Arquivados
          </button>
          <button
            onClick={() => setActiveTab('cadastro')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'cadastro'
                ? 'border-b-2 border-blue-600 bg-blue-50/70 text-blue-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4 inline-block mr-2" />
            Cadastro de Correspondentes
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {activeTab === 'vinculos' ? 'Operação' : activeTab === 'arquivados' ? 'Histórico' : 'Cadastro'}
              </p>
              <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                {activeTab === 'vinculos'
                  ? 'Diligências vinculadas aos compromissos'
                  : activeTab === 'arquivados'
                    ? 'Diligências arquivadas para consulta e reativação'
                    : 'Base de correspondentes cadastrados'}
              </h3>
            </div>
            <div className="text-xs text-slate-500">
              {activeTab === 'vinculos'
                ? `${filteredAppointments.length} item(ns) ativo(s)`
                : activeTab === 'arquivados'
                  ? `${archivedAppointments.length} item(ns) arquivado(s)`
                  : `${filteredRepresentatives.length} correspondente(s)`}
            </div>
          </div>
        </div>

        {/* Barra de ações */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {activeTab === 'vinculos' && (
            <>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar vínculo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <select
                value={serviceStatusFilter}
                onChange={(e) => setServiceStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">Status da Diligência</option>
                {Object.entries(SERVICE_STATUS_LABELS_MAP).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">Status Pagamento</option>
                {Object.entries(PAYMENT_STATUS_LABELS_MAP).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </>
          )}
          {activeTab === 'arquivados' && (
            <>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar diligência arquivada..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </>
          )}
          {activeTab === 'cadastro' && (
            <>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por nome..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </>
          )}

          {activeTab !== 'arquivados' && (
            <button
              onClick={() => activeTab === 'cadastro' ? handleOpenRepresentativeModal() : handleOpenAppointmentModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              {activeTab === 'cadastro' ? 'Novo Correspondente' : 'Vincular Correspondente'}
            </button>
          )}
        </div>

        {/* Lista de Correspondentes */}
        {activeTab === 'cadastro' && (
          <div className="space-y-3">
            {filteredRepresentatives.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500">Nenhum correspondente cadastrado</p>
                <button
                  onClick={() => handleOpenRepresentativeModal()}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Cadastrar primeiro correspondente
                </button>
              </div>
            ) : (
              filteredRepresentatives.map((rep) => (
                <div
                  key={rep.id}
                  className="rounded-xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/30"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 truncate">{rep.full_name}</h3>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          rep.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {rep.status === 'ativo' ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                        {rep.cpf && (
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {rep.cpf}
                          </span>
                        )}
                        {rep.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" />
                            {rep.phone}
                          </span>
                        )}
                        {rep.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5" />
                            {rep.email}
                          </span>
                        )}
                        {rep.pix_key && (
                          <span className="flex items-center gap-1">
                            <CreditCard className="w-3.5 h-3.5" />
                            PIX: {rep.pix_key}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenRepresentativeModal(rep)}
                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteRepresentative(rep)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'arquivados' && (
          <div className="space-y-3">
            {archivedAppointments.length === 0 ? (
              <div className="text-center py-12">
                <Archive className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500">Nenhuma diligência arquivada</p>
              </div>
            ) : (
              archivedAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 shadow-sm transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-slate-900 truncate">{apt.calendar_event?.title || 'Compromisso não encontrado'}</h3>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-200 text-slate-700">
                          Arquivado
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                        <span className="flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5" />
                          {apt.representative?.full_name || 'Correspondente não encontrado'}
                        </span>
                        {apt.diligence_location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {apt.diligence_location}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(apt.service_date)}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getServiceStatusColor(apt.service_status)}`}>
                          {SERVICE_STATUS_LABELS_MAP[apt.service_status]}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getPaymentStatusColor(apt.payment_status)}`}>
                          {PAYMENT_STATUS_LABELS_MAP[apt.payment_status]}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRestoreAppointment(apt)}
                        className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                        title="Reativar diligência"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleOpenAppointmentModal(apt)}
                        className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                        title="Abrir vínculo"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteAppointment(apt)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Lista de Vínculos */}
        {activeTab === 'vinculos' && (
          <div className="space-y-3">
            {filteredAppointments.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-500">Nenhum vínculo encontrado</p>
                <button
                  onClick={() => handleOpenAppointmentModal()}
                  className="mt-3 text-amber-600 hover:text-amber-700 text-sm font-medium"
                >
                  Vincular correspondente a compromisso
                </button>
              </div>
            ) : (
              filteredAppointments.map((apt) => (
                <div
                  key={apt.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-amber-200 hover:shadow-md transition"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <UserCheck className="w-4 h-4 text-amber-500" />
                        <span className="font-semibold text-slate-900">
                          {apt.representative?.full_name || 'Correspondente não encontrado'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{apt.calendar_event?.title || 'Compromisso não encontrado'}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-slate-500">
                          Data: {formatDate(apt.service_date)}
                        </span>
                        {apt.diligence_location && (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                            <MapPin className="w-3 h-3" />
                            {apt.diligence_location}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getServiceStatusColor(apt.service_status)}`}>
                          {SERVICE_STATUS_LABELS_MAP[apt.service_status]}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getPaymentStatusColor(apt.payment_status)}`}>
                          {PAYMENT_STATUS_LABELS_MAP[apt.payment_status]}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div className="min-w-0 flex-1 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Status da diligência</p>
                            <p className="mt-1 text-xs text-slate-500">Altere rapidamente sem abrir a edição completa.</p>
                          </div>
                          <select
                            value={apt.service_status}
                            onChange={(e) => handleUpdateServiceStatus(apt, e.target.value as ServiceStatus)}
                            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 sm:w-56"
                          >
                            {Object.entries(SERVICE_STATUS_LABELS_MAP).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <div className="text-left sm:text-right">
                        <p className="text-lg font-bold text-slate-900">{formatCurrency(apt.service_value)}</p>
                        {apt.payment_date && (
                          <p className="text-xs text-slate-500">Pago em {formatDate(apt.payment_date)}</p>
                        )}
                        </div>
                        <div className="flex items-center gap-1">
                        {apt.payment_status === 'pendente' && (
                          <button
                            onClick={() => handleOpenPaymentModal(apt)}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                            title="Registrar Pagamento"
                          >
                            <Banknote className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenAppointmentModal(apt)}
                          className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleArchiveAppointment(apt)}
                          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                          title="Arquivar diligência"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAppointment(apt)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Remover"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal de Correspondente */}
      {isRepresentativeModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsRepresentativeModalOpen(false)} />
          <div className="relative w-full max-w-2xl max-h-[92vh] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Correspondente</p>
                <h3 className="text-xl font-semibold text-slate-900">
                  {editingRepresentative ? 'Editar Correspondente' : 'Novo Correspondente'}
                </h3>
              </div>
              <button
                onClick={() => setIsRepresentativeModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              <div className="p-4 pb-24 sm:p-6 sm:pb-28 md:p-8 md:pb-32 space-y-4 sm:space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    value={representativeForm.full_name}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, full_name: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                    placeholder="Nome do correspondente"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">CPF</label>
                  <input
                    type="text"
                    value={representativeForm.cpf || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, cpf: applyCpfMask(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="000.000.000-00"
                    maxLength={14}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={representativeForm.phone || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, phone: applyPhoneMask(e.target.value) })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="(00) 0 0000-0000"
                    maxLength={16}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                  <input
                    type="email"
                    value={representativeForm.email || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, email: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="email@exemplo.com"
                  />
                  {representativeForm.email && !validateEmail(representativeForm.email) && (
                    <p className="text-xs text-red-500 mt-1">E-mail inválido</p>
                  )}
                </div>

                <div className="sm:col-span-2 border-t border-slate-200 pt-4">
                  <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-orange-500" />
                    Dados Bancários
                  </h4>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Chave PIX</label>
                  <input
                    type="text"
                    value={representativeForm.pix_key || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, pix_key: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="CPF, e-mail, telefone ou chave aleatória"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Banco</label>
                  <input
                    type="text"
                    value={representativeForm.bank_name || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, bank_name: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="Nome do banco"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Agência</label>
                  <input
                    type="text"
                    value={representativeForm.bank_agency || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, bank_agency: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="0000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Conta</label>
                  <input
                    type="text"
                    value={representativeForm.bank_account || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, bank_account: e.target.value })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    placeholder="00000-0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={representativeForm.status}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, status: e.target.value as any })}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Observações</label>
                  <textarea
                    value={representativeForm.notes || ''}
                    onChange={(e) => setRepresentativeForm({ ...representativeForm, notes: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 resize-none"
                    placeholder="Observações sobre o correspondente..."
                  />
                </div>
              </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 px-5 sm:px-8 py-5 flex justify-end gap-3 backdrop-blur-sm">
              <button
                onClick={() => setIsRepresentativeModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveRepresentative}
                disabled={saving}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingRepresentative ? 'Salvar' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Vínculo */}
      <>
        {isAppointmentModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsAppointmentModalOpen(false)} />
            <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/5">
              <div className="h-2 w-full bg-orange-500" />
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 sm:px-8 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Vínculo</p>
                  <h3 className="text-xl font-semibold text-slate-900">
                    {editingAppointment ? 'Editar Vínculo' : 'Vincular Correspondente'}
                  </h3>
                </div>
                <button
                  onClick={() => setIsAppointmentModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-white">
                <div className="p-4 pb-24 sm:p-6 sm:pb-28 md:p-8 md:pb-32 space-y-4 sm:space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Correspondente *</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={representativeModalSearchTerm}
                        onChange={(e) => {
                          setRepresentativeModalSearchTerm(e.target.value);
                          if (!e.target.value.trim()) {
                            setAppointmentForm({ ...appointmentForm, representative_id: '' });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-10 py-2.5 text-sm focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                        placeholder="Digite para buscar correspondente..."
                      />
                      {selectedAppointmentRepresentative && representativeModalSearchTerm.trim() === selectedAppointmentRepresentative.full_name && (
                        <button
                          type="button"
                          onClick={() => {
                            setRepresentativeModalSearchTerm('');
                            setAppointmentForm({ ...appointmentForm, representative_id: '' });
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {representativeModalSearchTerm.trim() && representativeModalSearchTerm.trim() !== (selectedAppointmentRepresentative?.full_name || '') && (
                        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                          {filteredModalRepresentatives.length > 0 ? (
                            filteredModalRepresentatives.map((rep) => (
                              <button
                                key={rep.id}
                                type="button"
                                onClick={() => {
                                  setAppointmentForm({ ...appointmentForm, representative_id: rep.id });
                                  setRepresentativeModalSearchTerm(rep.full_name);
                                }}
                                className={`flex w-full items-center border-b border-slate-100 px-3 py-2.5 text-left text-sm transition last:border-b-0 ${appointmentForm.representative_id === rep.id ? 'bg-orange-50 text-orange-700' : 'text-slate-700 hover:bg-slate-50'}`}
                              >
                                <span className="font-medium">{rep.full_name}</span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-4 text-sm text-slate-500">Nenhum correspondente encontrado para a busca digitada.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Compromisso *</label>
                    <select
                      value={appointmentForm.calendar_event_id}
                      onChange={(e) => {
                        const eventId = e.target.value;
                        const event = availableFutureEvents.find((ev) => ev.id === eventId);
                        setAppointmentForm({
                          ...appointmentForm,
                          calendar_event_id: eventId,
                          service_date: event?.start_at?.split('T')[0] || appointmentForm.service_date,
                        });
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    >
                      <option value="">Selecione um compromisso</option>
                      {availableFutureEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>{getEventOptionLabel(ev)}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      Exibe tipo, data, hora e título para facilitar a localização do compromisso.
                    </p>
                    {availableFutureEvents.length === 0 && (
                      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Nenhum compromisso futuro disponível para vinculação no momento.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Data do Serviço *</label>
                    <input
                      type="date"
                      value={appointmentForm.service_date}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, service_date: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    />
                    <p className="mt-1 text-xs text-slate-500">Puxada automaticamente do compromisso selecionado</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Local da Diligência</label>
                    <input
                      type="text"
                      value={appointmentForm.diligence_location || ''}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, diligence_location: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      placeholder="Ex: Fórum Trabalhista de Cuiabá - Sala 3"
                    />
                    <p className="mt-1 text-xs text-slate-500">Informe o endereço, fórum, sala ou ponto de atendimento da diligência.</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Valor do Serviço *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={appointmentForm.service_value}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, service_value: parseFloat(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      placeholder="0,00"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Status do Serviço</label>
                    <select
                      value={appointmentForm.service_status}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, service_status: e.target.value as ServiceStatus })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    >
                      {Object.entries(SERVICE_STATUS_LABELS_MAP).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Status do Pagamento</label>
                    <select
                      value={appointmentForm.payment_status}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, payment_status: e.target.value as PaymentStatus })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    >
                      {Object.entries(PAYMENT_STATUS_LABELS_MAP).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Descrição do Serviço</label>
                    <input
                      type="text"
                      value={appointmentForm.service_description || ''}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, service_description: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      placeholder="Ex: Audiência trabalhista"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
                    <textarea
                      value={appointmentForm.notes || ''}
                      onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      placeholder="Observações sobre o serviço..."
                    />
                  </div>
                </div>
                </div>
              </div>

              <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-slate-200 bg-white/95 px-5 sm:px-8 py-5 backdrop-blur-sm">
                <button
                  onClick={() => setIsAppointmentModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 transition hover:text-slate-900"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveAppointment}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingAppointment ? 'Salvar' : 'Vincular'}
                </button>
              </div>
            </div>
          </div>
        )}

        {isPaymentModalOpen && payingAppointment && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsPaymentModalOpen(false)} />
            <div className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl ring-1 ring-black/5">
              <div className="h-2 w-full bg-orange-500" />
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 sm:px-8 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Pagamento</p>
                  <h3 className="text-xl font-semibold text-slate-900">Registrar Pagamento</h3>
                </div>
                <button
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 bg-white p-4 sm:p-6 md:p-8">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-800">
                    <strong>Correspondente:</strong> {payingAppointment.representative?.full_name}
                  </p>
                  <p className="text-sm text-emerald-800">
                    <strong>Valor:</strong> {formatCurrency(payingAppointment.service_value)}
                  </p>
                  {payingAppointment.representative?.pix_key && (
                    <p className="mt-2 text-sm text-emerald-800">
                      <strong>PIX:</strong> {payingAppointment.representative.pix_key}
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Data do Pagamento *</label>
                  <input
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Método de Pagamento *</label>
                  <select
                    value={paymentForm.payment_method}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value as PaymentMethod })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS_MAP).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Comprovante</label>
                  <input
                    type="text"
                    value={paymentForm.payment_receipt}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_receipt: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    placeholder="Número do comprovante ou referência"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Observações</label>
                  <textarea
                    value={paymentForm.payment_notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_notes: e.target.value })}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    placeholder="Observações sobre o pagamento..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-white px-5 sm:px-8 py-5">
                <button
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 transition hover:text-slate-900"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSavePayment}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar Pagamento
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    </div>
  );
};

export default RepresentativesPanel;
