import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  TrendingUp,
  Search,
  Filter,
  DollarSign,
  PlusCircle,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  Eye,
  Edit,
  Trash2,
  X,
  Receipt,
  CalendarIcon,
  Calendar,
  Download,
  Loader2,
  PiggyBank,
  FileBarChart,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  FileText,
  Banknote,
  CreditCard,
  Percent,
  Hash,
  Smartphone,
  Building,
  Bell,
  ChevronRight,
  User,
  History,
  ClipboardList,
} from 'lucide-react';
import { matchesNormalizedSearch } from '../utils/search';
import { useToastContext } from '../contexts/ToastContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { financialService } from '../services/financial.service';
import { clientService } from '../services/client.service';
import { calendarService } from '../services/calendar.service';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';
import { ClientSearchSelect } from './ClientSearchSelect';
import type {
  Agreement,
  AgreementStatus,
  FinancialStats,
  Installment,
  InstallmentStatus,
  PayInstallmentDTO,
  PaymentAuditLog,
} from '../types/financial.types';
import type { Client } from '../types/client.types';
import { events, SYSTEM_EVENTS } from '../utils/events';

interface FinancialModuleProps {
  entityId?: string;
  mode?: string;
  onParamConsumed?: () => void;
}

const FinancialModule: React.FC<FinancialModuleProps> = ({ entityId, mode, onParamConsumed }) => {
  const toast = useToastContext();
  const { confirmDelete } = useDeleteConfirm();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);
  const today = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
  // Mesma base de data usada pelo servidor em getFinancialStats (UTC),
  // para a lista de parcelas vencidas bater com o contador do banner.
  const serverToday = new Date().toISOString().split('T')[0];
  const parseLocalDate = (raw?: string | null) => {
    if (!raw) return null;
    const s = String(raw).trim();
    const iso = s.slice(0, 10);
    if (iso.includes('-')) {
      const [y, m, d] = iso.split('-').map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    if (s.includes('/')) {
      const [d, m, y] = s.split('/').slice(0, 3).map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return null;
  };
  const formatLocalISODate = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<Installment | null>(null);
  const [paymentData, setPaymentData] = useState({
    paymentDate: today,
    paymentMethod: 'pix' as 'dinheiro' | 'pix' | 'transferencia' | 'cheque' | 'cartao_credito' | 'cartao_debito',
    paidValue: '',
    notes: '',
  });
  const formatPaidValueInput = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (!numbers) return '';
    const asNumber = Number(numbers) / 100;
    return asNumber.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const parsePaidValue = (formatted: string) => {
    const normalized = formatted.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };
  const getPaymentMethodLabel = (method?: string | null) => {
    if (!method) return 'Não informado';
    return method === 'pix' ? 'PIX'
      : method === 'transferencia' ? 'Transferência Bancária'
      : method === 'dinheiro' ? 'Dinheiro'
      : method === 'cartao_credito' ? 'Cartão de Crédito'
      : method === 'cartao_debito' ? 'Cartão de Débito'
      : method === 'cheque' ? 'Cheque'
      : 'Não especificado';
  };
  const currentMonth = useMemo(() => today.slice(0, 7), [today]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [activeMonth, setActiveMonth] = useState(new Date().toISOString().slice(0, 7));
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'ativo' | 'concluido' | 'cancelado'>('all');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<'all' | 'with_pending' | 'fully_paid'>('all');
  const [allInstallments, setAllInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editInitialLoading, setEditInitialLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isIRModalOpen, setIsIRModalOpen] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showPaidInstallments, setShowPaidInstallments] = useState(false);
  const [overpaymentWarning, setOverpaymentWarning] = useState<{ diff: number; scheduled: number } | null>(null);

  // Navigate to another module
  const navigateToClient = (clientId: string) => {
    events.emit(SYSTEM_EVENTS.NAVIGATE_REQUEST, { module: 'clientes', params: { mode: 'details', entityId: clientId } });
  };
  const activeAgreementsCount = useMemo(
    () => agreements.filter((agreement) => agreement.status === 'ativo').length,
    [agreements],
  );
  const concludedThisMonth = useMemo(() => {
    return agreements.filter(
      (agreement) =>
        agreement.status === 'concluido' && agreement.updated_at?.slice(0, 7) === activeMonth,
    ).length;
  }, [agreements, activeMonth]);
  const pendingStatuses: InstallmentStatus[] = ['pendente', 'vencido'];
  const [editForm, setEditForm] = useState({
    clientId: '',
    processId: '',
    title: '',
    description: '',
    notes: '',
    agreementDate: today,
    status: 'ativo' as AgreementStatus,
    totalValue: '',
    feeType: 'percentage' as 'percentage' | 'fixed',
    feePercentage: '',
    feeFixedValue: '',
    paymentType: 'installments' as 'installments' | 'upfront',
    installmentsCount: '1',
    firstDueDate: today,
    customInstallments: [] as { dueDate: string; value: string }[],
  });
  const [formData, setFormData] = useState({
    clientId: '',
    processId: '',
    title: '',
    description: '',
    agreementDate: today,
    totalValue: '',
    feeType: 'percentage' as 'percentage' | 'fixed',
    feePercentage: '40',
    feeFixedValue: '',
    paymentType: 'upfront' as 'installments' | 'upfront',
    installmentsCount: '1',
    firstDueDate: today,
    notes: '',
    customInstallments: [] as { dueDate: string; value: string }[],
  });
  const [formError, setFormError] = useState<string | null>(null);
  
  // Estados para auditoria
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<PaymentAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditAgreementId, setAuditAgreementId] = useState<string | null>(null);
  const [auditFilterMonth, setAuditFilterMonth] = useState(new Date().toISOString().slice(0, 7));

  // Estados para selector processo/requerimento
  const [clientProcesses, setClientProcesses] = useState<Process[]>([]);
  const [clientRequirements, setClientRequirements] = useState<Requirement[]>([]);
  const [loadingLinkedEntities, setLoadingLinkedEntities] = useState(false);

  const loadLinkedEntities = useCallback(async (clientId: string) => {
    if (!clientId) {
      setClientProcesses([]);
      setClientRequirements([]);
      return;
    }
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

  const focusAgreementConsumedRef = React.useRef<string | null>(null);

  const loadData = useCallback(async (month?: string) => {
    try {
      setLoading(true);
      const [statsData, agreementsData, clientsData, allInstallmentsData] = await Promise.all([
        financialService.getFinancialStats(month),
        financialService.listAgreements(),
        clientService.listClients(),
        financialService.listAllInstallments(),
      ]);
      
      // Enriquecer parcelas com dados do acordo
      const enrichedInstallments = allInstallmentsData.map(inst => {
        const agreement = agreementsData.find(a => a.id === inst.agreement_id);
        return { ...inst, agreement };
      });
      
      setStats(statsData);
      setAgreements(agreementsData);
      setClients(clientsData);
      setAllInstallments(enrichedInstallments);
    } catch (err: any) {
      toast.error('Erro ao carregar', err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData(activeMonth);
  }, [activeMonth, loadData]);

  // Tratar modo payment para abrir modal de pagamento
  useEffect(() => {
    if (mode === 'payment' && !isModalOpen) {
      setIsModalOpen(true);
      setEditForm({
        clientId: '',
        processId: '',
        title: '',
        description: '',
        notes: '',
        agreementDate: today,
        status: 'ativo' as AgreementStatus,
        totalValue: '',
        feeType: 'percentage' as 'percentage' | 'fixed',
        feePercentage: '',
        feeFixedValue: '',
        paymentType: 'installments' as 'installments' | 'upfront',
        installmentsCount: '1',
        firstDueDate: today,
        customInstallments: [] as { dueDate: string; value: string }[],
      });
      onParamConsumed?.();
    }
  }, [mode, isModalOpen, onParamConsumed]);

  // Escutar eventos globais de mudança de clientes
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 FinancialModule: Mudança de clientes detectada, recarregando...');
      loadData(activeMonth);
    });
    
    return () => unsubscribe();
  }, [activeMonth, loadData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getInstallmentFeeValue = (installment: Installment & { agreement?: Agreement }) => {
    if (installment.agreement && installment.agreement.installments_count) {
      return installment.agreement.fee_value / installment.agreement.installments_count;
    }
    return installment.paid_value ?? installment.value ?? 0;
  };

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.full_name || (client as any)?.name || 'Cliente não encontrado';
  };

  const numberToWords = (value: number) => {
    const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
    const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

    const convertGroup = (n: number): string => {
      if (n === 0) return '';
      if (n === 100) return 'cem';
      
      const h = Math.floor(n / 100);
      const t = Math.floor((n % 100) / 10);
      const u = n % 10;
      
      let words = [];
      
      if (h > 0) words.push(hundreds[h]);
      
      if (t === 1) {
        words.push(teens[u]);
      } else {
        if (t > 0) words.push(tens[t]);
        if (u > 0) words.push(units[u]);
      }
      
      return words.join(' e ');
    };

    if (value === 0) return 'zero reais';
    
    const billions = Math.floor(value / 1000000000);
    const millions = Math.floor((value % 1000000000) / 1000000);
    const thousands = Math.floor((value % 1000000) / 1000);
    const remainder = Math.floor(value % 1000);
    const cents = Math.round((value % 1) * 100);
    
    let words = [];
    
    if (billions > 0) {
      words.push(`${convertGroup(billions)} ${billions === 1 ? 'bilhão' : 'bilhões'}`);
    }
    
    if (millions > 0) {
      words.push(`${convertGroup(millions)} ${millions === 1 ? 'milhão' : 'milhões'}`);
    }
    
    if (thousands > 0) {
      words.push(`${convertGroup(thousands)} mil`);
    }
    
    if (remainder > 0) {
      words.push(convertGroup(remainder));
    }
    
    const reais = words.join(' e ') + ' ' + (value === 1 ? 'real' : 'reais');
    
    if (cents > 0) {
      return `${reais} e ${convertGroup(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
    }

    return reais;
  };

  const filteredAgreements = useMemo(() => {
    const term = searchTerm;

    return agreements.filter((agreement: Agreement) => {
      const clientName = getClientName(agreement.client_id);
      const matchesSearch = !term
        ? true
        : matchesNormalizedSearch(term, [
            agreement.title,
            agreement.description,
            agreement.notes,
            clientName,
            agreement.process_id ? String(agreement.process_id) : '',
          ]);

      const matchesStatus = filterStatus === 'all' ? true : agreement.status === filterStatus;

      // Filtro por status de pagamento
      let matchesPaymentStatus = true;
      if (filterPaymentStatus !== 'all') {
        const agreementInstallments = allInstallments.filter(
          (inst) => inst.agreement_id === agreement.id,
        );
        const hasPending = agreementInstallments.some((inst) =>
          pendingStatuses.includes(inst.status as InstallmentStatus),
        );

        if (filterPaymentStatus === 'with_pending') {
          matchesPaymentStatus = hasPending;
        } else if (filterPaymentStatus === 'fully_paid') {
          matchesPaymentStatus = !hasPending && agreementInstallments.length > 0;
        }
      }

      return matchesSearch && matchesStatus && matchesPaymentStatus;
    });
  }, [agreements, searchTerm, filterStatus, filterPaymentStatus, allInstallments, pendingStatuses]);

  const nextDueInstallment = useMemo(() => {
    const pending = allInstallments
      .filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!pending.length) return null;
    const upcoming = pending.find(inst => inst.due_date >= today);
    return upcoming || pending[0];
  }, [allInstallments, today]);

  const nextDueInfo = useMemo(() => {
    if (!nextDueInstallment) return null;
    const dueDateObj = new Date(`${nextDueInstallment.due_date}T00:00:00`);
    const todayObj = new Date(`${today}T00:00:00`);
    const diffDays = Math.round((dueDateObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
    let relativeLabel = '';
    if (diffDays === 0) relativeLabel = 'Hoje';
    else if (diffDays === 1) relativeLabel = 'Amanhã';
    else if (diffDays > 1) relativeLabel = `Em ${diffDays} dias`;
    else if (diffDays === -1) relativeLabel = 'Ontem';
    else relativeLabel = `Há ${Math.abs(diffDays)} dias`;

    return {
      installment: nextDueInstallment,
      dueDateFormatted: dueDateObj.toLocaleDateString('pt-BR'),
      relativeLabel,
    };
  }, [nextDueInstallment, today]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    allInstallments.forEach(inst => {
      if (inst.status === 'pago' && inst.payment_date) {
        const year = new Date(inst.payment_date).getFullYear();
        years.add(year);
      }
    });
    return Array.from(years).sort((a, b) => b - a); // Ordem decrescente
  }, [allInstallments]);

  const handleOpenEditModal = async (agreement: Agreement) => {
    setEditError(null);
    // Evita que o modal de detalhes continue aberto atrás do modal de edição
    setIsDetailsModalOpen(false);
    setSelectedAgreement(agreement);
    setIsEditModalOpen(true);
    setEditInitialLoading(true);

    try {
      const installmentsData = await financialService.listInstallments(agreement.id);
      const customFromAgreement = agreement.custom_installments?.length
        ? agreement.custom_installments
        : undefined;

      const customInstallments = customFromAgreement
        ? customFromAgreement.map((item) => ({ dueDate: item.due_date, value: item.value.toFixed(2) }))
        : installmentsData.map((inst) => ({ dueDate: inst.due_date, value: inst.value.toFixed(2) }));

      loadLinkedEntities(agreement.client_id);
      setEditForm({
        clientId: agreement.client_id,
        processId: agreement.process_id || '',
        title: agreement.title,
        description: agreement.description || '',
        notes: agreement.notes || '',
        agreementDate: agreement.agreement_date || today,
        status: agreement.status,
        totalValue: formatCurrencyInput(Math.round((agreement.total_value || 0) * 100).toString()),
        feeType: agreement.fee_type,
        feePercentage: agreement.fee_percentage?.toString() || '',
        feeFixedValue: agreement.fee_fixed_value ? formatCurrencyInput(Math.round(agreement.fee_fixed_value * 100).toString()) : '',
        paymentType: agreement.payment_type,
        installmentsCount: agreement.installments_count.toString(),
        firstDueDate: agreement.first_due_date,
        customInstallments,
      });
    } catch (err: any) {
      toast.error('Erro ao abrir edição', err.message);
    } finally {
      setEditInitialLoading(false);
    }
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditLoading(false);
    setEditError(null);
    setEditInitialLoading(false);
  };

  const handleEditChange = (field: keyof typeof editForm, value: string) => {
    setEditForm((prev) => {
      if (field === 'clientId') {
        loadLinkedEntities(value);
        return { ...prev, clientId: value, processId: '' };
      }
      if (field === 'paymentType') {
        const nextPayment = value as 'installments' | 'upfront';
        return {
          ...prev,
          paymentType: nextPayment,
          installmentsCount: nextPayment === 'upfront' ? '1' : (prev.installmentsCount || '1'),
          customInstallments: nextPayment === 'upfront' ? [] : prev.customInstallments,
        };
      }

      if (field === 'feeType') {
        const nextType = value as 'percentage' | 'fixed';
        return {
          ...prev,
          feeType: nextType,
          feePercentage: nextType === 'percentage' ? (prev.feePercentage || '40') : '',
          feeFixedValue: nextType === 'fixed' ? (prev.feeFixedValue || '') : '',
        };
      }

      if (['totalValue', 'feeFixedValue'].includes(field as string)) {
        return { ...prev, [field]: formatCurrencyInput(value) };
      }

      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const handleToggleEditCustomInstallments = () => {
    setEditForm((prev) => {
      const count = Number(prev.installmentsCount || '0');
      if (prev.customInstallments.length) {
        return { ...prev, customInstallments: [] };
      }

      if (!count || count <= 0) {
        return { ...prev };
      }

      const installments = Array.from({ length: count }, (_, index) => ({
        dueDate: index === 0 ? prev.firstDueDate : '',
        value: prev.totalValue && count ? (parseCurrencyToNumber(prev.totalValue) / count).toFixed(2) : '',
      }));

      return { ...prev, customInstallments: installments };
    });
  };

  const handleEditCustomInstallmentChange = (index: number, field: 'dueDate' | 'value', value: string) => {
    setEditForm((prev) => ({
      ...prev,
      customInstallments: prev.customInstallments.map((item, idx) =>
        idx === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const handleEditRecalculateCustomInstallments = () => {
    setEditForm((prev) => {
      const count = Number(prev.installmentsCount || '0');
      if (!prev.customInstallments.length || !count || !prev.totalValue) {
        return prev;
      }

      const baseValue = parseCurrencyToNumber(prev.totalValue) / count;
      return {
        ...prev,
        customInstallments: prev.customInstallments.map((item, index) => ({
          dueDate: index === 0 ? prev.firstDueDate : (prev.customInstallments[index - 1]?.dueDate || prev.firstDueDate),
          value: baseValue.toFixed(2),
        })),
      };
    });
  };

  const handleSubmitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAgreement) return;

    if (!editForm.clientId) {
      setEditError('Selecione um cliente');
      return;
    }

    if (!editForm.title.trim()) {
      setEditError('Informe o título do acordo');
      return;
    }

    if (!editForm.totalValue || parseCurrencyToNumber(editForm.totalValue) <= 0) {
      setEditError('Informe um valor total válido');
      return;
    }

    if (editForm.feeType === 'percentage' && (!editForm.feePercentage || Number(editForm.feePercentage) <= 0)) {
      setEditError('Informe o percentual de honorários');
      return;
    }

    if (editForm.feeType === 'fixed' && (!editForm.feeFixedValue || parseCurrencyToNumber(editForm.feeFixedValue) <= 0)) {
      setEditError('Informe o valor fixo dos honorários');
      return;
    }

    if (editForm.paymentType === 'installments') {
      if (!editForm.installmentsCount || Number(editForm.installmentsCount) < 2) {
        setEditError('Informe a quantidade de parcelas (mínimo 2)');
        return;
      }

      if (!editForm.firstDueDate && !editForm.customInstallments.length) {
        setEditError('Informe a data da primeira parcela');
        return;
      }

      if (editForm.customInstallments.length) {
        if (editForm.customInstallments.length !== Number(editForm.installmentsCount)) {
          setEditError('Número de parcelas personalizadas diferente da quantidade informada');
          return;
        }

        const invalid = editForm.customInstallments.find((item) => !item.dueDate || !item.value || Number(item.value) <= 0);
        if (invalid) {
          setEditError('Preencha todas as datas e valores das parcelas personalizadas');
          return;
        }
      }
    }

    try {
      setEditLoading(true);
      setEditError(null);

      const customInstallmentsPayload = editForm.customInstallments.length
        ? editForm.customInstallments.map((item) => ({
          due_date: item.dueDate,
          value: parseCurrencyToNumber(item.value),
        }))
        : undefined;

      const updated = await financialService.updateAgreement(selectedAgreement.id, {
        client_id: editForm.clientId,
        process_id: editForm.processId || null,
        title: editForm.title.trim(),
        description: editForm.description.trim() || undefined,
        agreement_date: editForm.agreementDate,
        status: editForm.status,
        notes: editForm.notes.trim() || undefined,
        total_value: parseCurrencyToNumber(editForm.totalValue),
        fee_type: editForm.feeType,
        fee_percentage: editForm.feeType === 'percentage' ? Number(editForm.feePercentage) : undefined,
        fee_fixed_value: editForm.feeType === 'fixed' ? parseCurrencyToNumber(editForm.feeFixedValue) : undefined,
        payment_type: editForm.paymentType,
        installments_count: editForm.paymentType === 'upfront' ? 1 : Number(editForm.installmentsCount),
        first_due_date: editForm.firstDueDate,
        custom_installments: customInstallmentsPayload,
      });

      setSelectedAgreement(updated);
      setAgreements((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('Acordo atualizado', 'As informações foram salvas com sucesso');
      handleCloseEditModal();
      loadData(activeMonth);
    } catch (err: any) {
      setEditError(err.message || 'Não foi possível atualizar o acordo');
      setEditLoading(false);
    }
  };

  const agreementSummary = useMemo(() => {
    if (!selectedAgreement) return null;

    // Usar sempre o total_value do acordo como fonte de verdade
    const totalValue = selectedAgreement.total_value;
    const feeValue = selectedAgreement.fee_value;
    const netValue = Number((totalValue - feeValue).toFixed(2));

    const installmentsCount = selectedAgreement.installments_count;
    const installmentValue = installmentsCount > 0 ? totalValue / installmentsCount : totalValue;

    return {
      totalValue,
      feeValue,
      netValue,
      installmentsCount,
      installmentValue,
    };
  }, [selectedAgreement]);

  const handleOpenModal = () => {
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setFormError(null);
    setFormLoading(false);
    setFormData((prev) => ({
      ...prev,
      clientId: '',
      processId: '',
      title: '',
      description: '',
      totalValue: '',
      feeType: 'percentage',
      feePercentage: '40',
      feeFixedValue: '',
      paymentType: 'installments',
      installmentsCount: '12',
      firstDueDate: today,
      notes: '',
      customInstallments: [],
    }));
  };

  // Campos monetários que aplicam máscara BR (ex: 14587 → "145,87"; 1458700 → "14.587,00")
  const CURRENCY_FIELDS = new Set(['totalValue', 'feeFixedValue']);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateForm();
    if (error) {
      setFormError(error);
      return;
    }

    try {
      setFormLoading(true);
      setFormError(null);

      const createdAgreement = await financialService.createAgreement({
        client_id: formData.clientId,
        process_id: formData.processId || undefined,
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
          ? formData.customInstallments.map((item) => ({
              due_date: item.dueDate,
              value: parseCurrencyToNumber(item.value),
            }))
          : undefined,
        notes: formData.notes?.trim() || undefined,
      });

      const schedule = buildScheduleFromForm();
      if (schedule.length) {
        await createCalendarEventsForInstallments(createdAgreement, schedule);
      }

      toast.success('Acordo criado', 'Os dados foram registrados com sucesso');
      handleCloseModal();
      loadData();
    } catch (err: any) {
      toast.error('Erro ao criar acordo', err.message);
      setFormLoading(false);
    }
  };

  const handleOpenDetails = async (agreement: Agreement) => {
    setSelectedAgreement(agreement);
    setIsDetailsModalOpen(true);
    setLoadingInstallments(true);
    try {
      const installmentsData = await financialService.listInstallments(agreement.id);
      setInstallments(installmentsData);
      await ensureOverdueDeadlines(agreement, installmentsData);
    } catch (error) {
      console.error('Erro ao carregar parcelas:', error);
    } finally {
      setLoadingInstallments(false);
    }
  };

  const handleCloseDetails = useCallback(() => {
    setIsDetailsModalOpen(false);
    setSelectedAgreement(null);
    setInstallments([]);
  }, []);

  useEffect(() => {
    if (!entityId) return;
    if (focusAgreementConsumedRef.current === entityId) return;
    if (loading) return;

    focusAgreementConsumedRef.current = entityId;
    const agreement = agreements.find((a) => a.id === entityId) || null;
    if (agreement) {
      void handleOpenDetails(agreement);
    }

    if (onParamConsumed) {
      onParamConsumed();
    }
  }, [agreements, entityId, loading, onParamConsumed]);

  const handleOpenPaymentModal = (installment: Installment) => {
    setSelectedInstallment(installment);
    setPaymentData({
      paymentDate: today,
      paymentMethod: 'pix',
      paidValue: '',
      notes: '',
    });
    setIsPaymentModalOpen(true);
  };

  const handleClosePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setSelectedInstallment(null);
    setOverpaymentWarning(null);
    setPaymentData({
      paymentDate: today,
      paymentMethod: 'pix',
      paidValue: '',
      notes: '',
    });
  };

  const handleConfirmPayment = async () => {
    if (!selectedInstallment || !selectedAgreement) return;

    const parsedValue = parsePaidValue(paymentData.paidValue);
    if (!paymentData.paidValue || parsedValue <= 0) {
      toast.error('Erro', 'Informe o valor pago');
      return;
    }

    // Registra o valor real pago (mesmo que diferente do agendado)
    // O paid_value sempre reflete a realidade da transação

    try {
      await financialService.payInstallment(selectedInstallment.id, {
        payment_date: paymentData.paymentDate,
        payment_method: paymentData.paymentMethod,
        paid_value: parsedValue,
        notes: paymentData.notes || undefined,
      });

      await updateCalendarEventStatus(
        selectedAgreement.id,
        selectedInstallment.installment_number,
        'concluido',
        paymentData.paymentDate
      );
      
      toast.success('Pagamento registrado', 'Baixa realizada com sucesso');
      handleClosePaymentModal();
      
      // Recarregar parcelas
      const updatedInstallments = await financialService.listInstallments(selectedAgreement.id);
      setInstallments(updatedInstallments);
      await ensureOverdueDeadlines(selectedAgreement, updatedInstallments);
      loadData();
    } catch (err: any) {
      toast.error('Erro ao registrar pagamento', err.message);
    }
  };

  const checkOverdueInstallments = () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = formatLocalISODate(twoDaysAgo);
    
    return installments.filter(
      inst => inst.status === 'pendente' && inst.due_date < twoDaysAgoStr
    );
  };

  const generateMonthlyReport = () => {
    setIsReportModalOpen(true);
  };

  // Funções de auditoria
  const handleOpenAuditModal = async (agreementId: string) => {
    setAuditAgreementId(agreementId);
    setIsAuditModalOpen(true);
    // Reseta o filtro de mês para o mês atual e carrega com contexto do acordo
    const currentMonth = new Date().toISOString().slice(0, 7);
    setAuditFilterMonth(currentMonth);
    await loadAuditByMonth(currentMonth, agreementId);
  };

  const loadAuditByMonth = async (month: string, forAgreementId?: string | null) => {
    // forAgreementId permite sobrepor o contexto; undefined = usar auditAgreementId atual
    const targetAgreementId = forAgreementId !== undefined ? forAgreementId : auditAgreementId;
    setLoadingAudit(true);
    try {
      if (targetAgreementId) {
        // Contexto de acordo específico: busca todos os logs do acordo e filtra por mês no client
        const logs = await financialService.getPaymentAuditLog(targetAgreementId);
        const [y, m] = month.split('-').map(Number);
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
        const filtered = logs.filter((l) => {
          const d = new Date(l.created_at);
          return d >= monthStart && d <= monthEnd;
        });
        setAuditLogs(filtered);
      } else {
        const startDate = `${month}-01T00:00:00`;
        const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
        const endDateStr = `${month}-${endDate.getDate().toString().padStart(2, '0')}T23:59:59`;
        const logs = await financialService.getAllPaymentAuditLogs({
          start_date: startDate,
          end_date: endDateStr,
          limit: 200,
        });
        setAuditLogs(logs);
      }
    } catch (err) {
      console.error('Erro ao carregar auditoria:', err);
      toast.error('Erro ao carregar histórico de auditoria');
    } finally {
      setLoadingAudit(false);
    }
  };

  // ESC fecha o modal aberto no topo da pilha (mais novo)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Ordem de prioridade: payment > audit > edit > details > new > IR
      if (isPaymentModalOpen) { handleClosePaymentModal(); }
      else if (isAuditModalOpen) { setIsAuditModalOpen(false); setAuditLogs([]); setAuditAgreementId(null); }
      else if (isEditModalOpen) { handleCloseEditModal(); }
      else if (isDetailsModalOpen) { handleCloseDetails(); }
      else if (isModalOpen) { handleCloseModal(); }
      else if (isIRModalOpen) { setIsIRModalOpen(false); }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaymentModalOpen, isAuditModalOpen, isEditModalOpen, isDetailsModalOpen, isModalOpen, isIRModalOpen]);

  const handleCloseAuditModal = () => {
    setIsAuditModalOpen(false);
    setAuditLogs([]);
    setAuditAgreementId(null);
  };

  // Buscar nome do cliente e título do acordo a partir do agreement_id
  const getAuditAgreementInfo = (agreementId: string) => {
    const agreement = agreements.find(a => a.id === agreementId);
    if (!agreement) return { clientName: 'Cliente não encontrado', title: 'Acordo não encontrado' };
    return {
      clientName: getClientName(agreement.client_id),
      title: agreement.title,
    };
  };

  const getAuditActionLabel = (action: string) => {
    const labels: Record<string, { label: string; color: string; bgColor: string }> = {
      payment_registered: { label: 'Baixa Registrada', color: 'text-emerald-700', bgColor: 'bg-emerald-100 border-emerald-200' },
      payment_cancelled: { label: 'Pagamento Cancelado', color: 'text-red-700', bgColor: 'bg-red-100 border-red-200' },
      payment_edited: { label: 'Pagamento Editado', color: 'text-blue-700', bgColor: 'bg-blue-100 border-blue-200' },
      installment_created: { label: 'Parcela Criada', color: 'text-indigo-700', bgColor: 'bg-indigo-100 border-indigo-200' },
      installment_cancelled: { label: 'Parcela Cancelada', color: 'text-orange-700', bgColor: 'bg-orange-100 border-orange-200' },
      agreement_created: { label: 'Acordo Criado', color: 'text-purple-700', bgColor: 'bg-purple-100 border-purple-200' },
      agreement_edited: { label: 'Acordo Editado', color: 'text-cyan-700', bgColor: 'bg-cyan-100 border-cyan-200' },
      agreement_cancelled: { label: 'Acordo Cancelado', color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-200' },
    };
    return labels[action] || { label: action, color: 'text-gray-700', bgColor: 'bg-gray-100 border-gray-200' };
  };

  // Helpers de moeda para inputs (ex: "1.000,00")
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
      if (decimalSeparator === '.') {
        normalized = cleaned.replace(/,/g, '');
      } else {
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
      }
    } else if (lastComma !== -1) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastDot !== -1) {
      const decimals = cleaned.length - lastDot - 1;
      if (decimals === 1 || decimals === 2) {
        normalized = cleaned;
      } else {
        normalized = cleaned.replace(/\./g, '');
      }
    }

    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  };

  const formatCurrencyInput = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    const number = Number(digits) / 100;
    return number.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Calcular totais da auditoria filtrada (incluindo honorários proporcionais)
  /** Resolve o valor pago de um log de auditoria.
   *  Tenta: new_value.paid_value → installment.paid_value → installment.value (fallback)
   *  Necessário porque registros antigos foram gravados com paid_value=null (bug de parse pt-BR). */
  const resolveAuditPaidValue = useCallback((log: PaymentAuditLog): number => {
    const raw = log.new_value?.paid_value;
    if (typeof raw === 'number' && !isNaN(raw) && raw > 0) return raw;
    if (log.installment_id) {
      const inst = allInstallments.find(i => i.id === log.installment_id);
      if (inst) {
        if (typeof inst.paid_value === 'number' && inst.paid_value > 0) return inst.paid_value;
        if (typeof inst.value === 'number' && inst.value > 0) return inst.value;
      }
    }
    return 0;
  }, [allInstallments]);

  const auditTotals = useMemo(() => {
    let total = 0;
    let totalHonorarios = 0;

    auditLogs.forEach((log) => {
      if (log.action !== 'payment_registered') return; // só somar baixas reais
      const paidValue = resolveAuditPaidValue(log);
      if (paidValue > 0) {
        total += paidValue;
        const agreement = agreements.find(a => a.id === log.agreement_id);
        if (agreement && agreement.total_value > 0) {
          const ratio = agreement.fee_value / agreement.total_value;
          totalHonorarios += paidValue * ratio;
        }
      }
    });

    return { count: auditLogs.filter(l => l.action === 'payment_registered').length, total, totalHonorarios };
  }, [auditLogs, agreements, resolveAuditPaidValue]);

  const handleExportMonthlyReport = () => {
    const monthLabel = formatMonthYear(activeMonth).replace(/^./, (char) => char.toUpperCase());
    const issueDate = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const monthPayments = allInstallments
      .filter(
        (inst) =>
          inst.status === 'pago' &&
          inst.payment_date &&
          inst.payment_date.slice(0, 7) === activeMonth,
      )
      .map((inst) => {
        const clientName = getClientName(inst.agreement?.client_id || '');
        const agreementTitle = inst.agreement?.title || 'Acordo';
        const amount = getInstallmentFeeValue(inst);
        return {
          clientName,
          agreementTitle,
          paymentDate: inst.payment_date!,
          amount,
        };
      })
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());

    const monthPending = allInstallments
      .filter(
        (inst) =>
          pendingStatuses.includes(inst.status as InstallmentStatus) &&
          inst.due_date &&
          inst.due_date.slice(0, 7) === activeMonth,
      )
      .map((inst) => ({
        clientName: getClientName(inst.agreement?.client_id || ''),
        agreementTitle: inst.agreement?.title || 'Acordo',
        dueDate: inst.due_date!,
        amount: inst.value,
      }))
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    const totalReceived = monthPayments.reduce((sum, item) => sum + item.amount, 0);
    const totalPending = monthPending.reduce((sum, item) => sum + item.amount, 0);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório Mensal - ${monthLabel}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body {
      font-family: 'Inter', Arial, sans-serif;
      background: #f5f6f7;
      color: #0f172a;
      margin: 0;
      padding: 0;
    }
    .wrapper {
      max-width: 820px;
      margin: 0 auto;
      background: #fff;
      padding: 40px 48px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 16px 40px rgba(15,23,42,0.08);
    }
    .doc-header {
      text-align: center;
      border-bottom: 4px double #0f172a;
      padding-bottom: 24px;
      margin-bottom: 24px;
    }
    .doc-header h1 {
      font-size: 24px;
      letter-spacing: 4px;
      text-transform: uppercase;
      margin: 0;
    }
    .doc-header p {
      margin: 6px 0 0;
      color: #475467;
      font-size: 13px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin: 24px 0;
    }
    .summary-card {
      border: 1px solid #d7dde5;
      border-radius: 8px;
      padding: 14px;
      background: #f9fafb;
    }
    .summary-card span {
      display: block;
      font-size: 11px;
      letter-spacing: 1px;
      color: #475467;
      text-transform: uppercase;
    }
    .summary-card strong {
      display: block;
      font-size: 20px;
      margin-top: 6px;
      color: #0f172a;
    }
    h2 {
      font-size: 13px;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin: 32px 0 12px;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 16px;
    }
    table thead {
      background: #0f172a;
      color: #fff;
    }
    th, td {
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      text-align: left;
    }
    td.amount {
      text-align: right;
      font-weight: 600;
      color: #0f172a;
    }
    .empty-row td {
      text-align: center;
      color: #94a3b8;
      font-style: italic;
    }
    .notes {
      border: 1px solid #facc15;
      background: #fffbeb;
      border-radius: 8px;
      padding: 16px;
      font-size: 12px;
      color: #854d0e;
      line-height: 1.7;
    }
    .footer {
      margin-top: 32px;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
    }
    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0f172a;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 10px 22px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 24px;
    }
    @media print {
      body { background: #fff; }
      .wrapper { box-shadow: none; border: none; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="doc-header">
      <p>Relatório Mensal Financeiro</p>
      <h1>${monthLabel.toUpperCase()}</h1>
      <p>Emitido em ${issueDate}</p>
    </div>
    <div class="summary-grid">
      <div class="summary-card">
        <span>Honorários recebidos</span>
        <strong>${formatCurrency(totalReceived)}</strong>
        <small>${monthPayments.length} pagamento${monthPayments.length === 1 ? '' : 's'}</small>
      </div>
      <div class="summary-card">
        <span>Parcelas pendentes</span>
        <strong>${formatCurrency(totalPending)}</strong>
        <small>${monthPending.length} parcela${monthPending.length === 1 ? '' : 's'}</small>
      </div>
      <div class="summary-card">
        <span>Saldo projetado</span>
        <strong>${formatCurrency(totalReceived + totalPending)}</strong>
        <small>Recebido + pendente</small>
      </div>
    </div>

    <h2>Pagamentos registrados no mês</h2>
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Acordo</th>
          <th>Data</th>
          <th style="text-align:right;">Valor</th>
        </tr>
      </thead>
      <tbody>
        ${monthPayments.length > 0
          ? monthPayments
              .map(
                (payment) => `
        <tr>
          <td>${payment.clientName}</td>
          <td>${payment.agreementTitle}</td>
          <td>${new Date(payment.paymentDate).toLocaleDateString('pt-BR')}</td>
          <td class="amount">${formatCurrency(payment.amount)}</td>
        </tr>`,
              )
              .join('')
          : '<tr class="empty-row"><td colspan="4">Sem recebimentos registrados neste mês</td></tr>'}
      </tbody>
    </table>

    <h2>Parcelas pendentes no mês</h2>
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Acordo</th>
          <th>Vencimento</th>
          <th style="text-align:right;">Valor</th>
        </tr>
      </thead>
      <tbody>
        ${monthPending.length > 0
          ? monthPending
              .map(
                (pending) => `
        <tr>
          <td>${pending.clientName}</td>
          <td>${pending.agreementTitle}</td>
          <td>${new Date(pending.dueDate).toLocaleDateString('pt-BR')}</td>
          <td class="amount">${formatCurrency(pending.amount)}</td>
        </tr>`,
              )
              .join('')
          : '<tr class="empty-row"><td colspan="4">Sem pendências para este mês</td></tr>'}
      </tbody>
    </table>

    <div class="notes">
      <strong style="display:block; margin-bottom:8px; text-transform:uppercase;">Orientações</strong>
      <ul style="margin:0 0 0 16px; padding:0;">
        <li>Utilize este relatório como base para o acompanhamento financeiro mensal.</li>
        <li>Reforce a cobrança de parcelas pendentes antes do vencimento.</li>
        <li>Mantenha os comprovantes arquivados para eventual auditoria.</li>
      </ul>
    </div>
    <div class="footer">
      Documento emitido automaticamente pelo sistema de gestão financeira.
    </div>
    <div style="text-align:center;">
      <button class="print-btn" onclick="window.print()">🖨️ Imprimir relatório</button>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    toast.success('Relatório gerado', 'Relatório mensal aberto em nova aba');
  };

  const handleGenerateIRReport = async (year: number) => {
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year}-12-31`;

      const allInstallmentsYear = allInstallments.filter(inst =>
        inst.status === 'pago' &&
        inst.payment_date &&
        inst.payment_date >= yearStart &&
        inst.payment_date <= yearEnd
      );

      // Honorários proporcionais ao que foi efetivamente baixado
      const computeFee = (inst: any): number => {
        const ag = inst?.agreement;
        if (!ag) return 0;
        const paid = inst.paid_value ?? inst.value ?? 0;
        if (ag.total_value > 0 && ag.fee_value > 0) {
          return paid * (ag.fee_value / ag.total_value);
        }
        return ag.installments_count > 0
          ? ag.fee_value / ag.installments_count
          : ag.fee_value;
      };

      const monthNames  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
      const monthShort  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

      const monthlyData = Array.from({ length: 12 }, (_, i) => {
        const insts = allInstallmentsYear.filter(inst => {
          if (!inst.payment_date) return false;
          return new Date(inst.payment_date + 'T12:00:00').getMonth() === i;
        });
        return {
          index: i,
          name : monthNames[i],
          short: monthShort[i],
          count: insts.length,
          total: insts.reduce((s, inst) => s + computeFee(inst), 0),
          insts,
        };
      });

      const totalHonorarios = monthlyData.reduce((s, m) => s + m.total, 0);
      const totalPayments   = allInstallmentsYear.length;

      // Mapa por cliente
      const clientMap = new Map<string, { name: string; cpf: string; email: string; count: number; total: number }>();
      allInstallmentsYear.forEach(inst => {
        if (!inst.agreement) return;
        const cid    = inst.agreement.client_id;
        const client = clients.find(c => c.id === cid);
        const fee    = computeFee(inst);
        if (!clientMap.has(cid)) {
          clientMap.set(cid, {
            name : client?.full_name || (client as any)?.name || 'Desconhecido',
            cpf  : client?.cpf_cnpj || '—',
            email: (client as any)?.email || '',
            count: 0,
            total: 0,
          });
        }
        const e = clientMap.get(cid)!;
        e.count++;
        e.total += fee;
      });

      const lawyerName  = 'PEDRO RODRIGUES MONTALVAO NETO';
      const lawyerOab   = '30.021';
      const lawyerState = 'MT';
      const lawyerEmail = 'pedro@advcuiaba.com';
      const issueDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

      // Helpers para o HTML
      const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const fmtShortVal = (v: number) => {
        if (v === 0) return '';
        if (v >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + 'k';
        return 'R$ ' + Math.round(v);
      };
      const methodLabelFn = (m?: string | null) => {
        const labels: Record<string, string> = { pix: 'PIX', transferencia: 'Transferência', dinheiro: 'Dinheiro', cartao_credito: 'Cartão Crédito', cartao_debito: 'Cartão Débito', cheque: 'Cheque' };
        return m ? (labels[m] ?? m) : '—';
      };
      // Máscara CPF (000.000.000-00) / CNPJ (00.000.000/0000-00)
      const maskDoc = (raw?: string | null): string => {
        if (!raw) return '—';
        const digits = String(raw).replace(/\D/g, '');
        if (digits.length === 11) {
          return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
        }
        if (digits.length === 14) {
          return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
        }
        return String(raw) || '—';
      };
      // "Nice" max for chart Y-axis (rounds up to clean number)
      const niceMax = (val: number): number => {
        if (val <= 0) return 1000;
        const mag = Math.pow(10, Math.floor(Math.log10(val)));
        const norm = val / mag;
        let n: number;
        if (norm <= 1) n = 1; else if (norm <= 2) n = 2;
        else if (norm <= 2.5) n = 2.5; else if (norm <= 5) n = 5; else n = 10;
        return n * mag;
      };

      // ── SVG Bar Chart ── Executive style com eixos e gridlines ─────
      const chartW       = 880;
      const chartH       = 320;
      const padL         = 78;     // y-axis labels
      const padR         = 24;
      const padT         = 28;     // top: value labels
      const padB         = 56;     // bottom: x-labels + count
      const plotW        = chartW - padL - padR;
      const plotH        = chartH - padT - padB;
      const plotBottomY  = padT + plotH;
      const slotW        = plotW / 12;
      const barW         = 38;
      const rawMax       = Math.max(...monthlyData.map(m => m.total), 0);
      const yMax         = niceMax(rawMax);
      const maxMonthIdx  = monthlyData.reduce((bi, m, i, arr) => m.total > arr[bi].total ? i : bi, 0);

      // Gridlines (5 níveis: 0, 25%, 50%, 75%, 100%)
      const gridLevels = [0, 0.25, 0.5, 0.75, 1];
      const svgGridLines = gridLevels.map(lvl => {
        const y = plotBottomY - lvl * plotH;
        const val = yMax * lvl;
        const label = lvl === 0 ? 'R$ 0' : 'R$ ' + fmtShortVal(val);
        return `
          <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="#eef2f6" stroke-width="1" stroke-dasharray="${lvl === 0 ? '0' : '3,3'}"/>
          <text x="${padL - 10}" y="${y + 3.5}" text-anchor="end" font-size="10" fill="#94a3b8" font-family="Inter,system-ui,sans-serif" font-weight="500">${label}</text>
        `;
      }).join('');

      const svgBarsHTML = monthlyData.map((m, i) => {
        const has = m.total > 0;
        const slotX = padL + i * slotW;
        const bx = slotX + (slotW - barW) / 2;
        const bh = has ? Math.max((m.total / yMax) * plotH, 3) : 0;
        const by = plotBottomY - bh;
        const isMax = has && i === maxMonthIdx && rawMax > 0;
        const fill = isMax ? '#0e2a47' : has ? '#3b5b7d' : '#f1f5f9';
        const labelY = by - 7;
        return [
          `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="2" fill="${fill}"/>`,
          has ? `<text x="${bx + barW/2}" y="${labelY}" text-anchor="middle" font-size="10" fill="#0e2a47" font-weight="700" font-family="Inter,system-ui,sans-serif">${fmtR(m.total)}</text>` : '',
          `<text x="${slotX + slotW/2}" y="${plotBottomY + 18}" text-anchor="middle" font-size="11" fill="${has ? '#0f172a' : '#94a3b8'}" font-weight="${has ? '600' : '400'}" font-family="Inter,system-ui,sans-serif" letter-spacing="0.05em">${m.short.toUpperCase()}</text>`,
          has ? `<text x="${slotX + slotW/2}" y="${plotBottomY + 33}" text-anchor="middle" font-size="9" fill="#94a3b8" font-family="Inter,system-ui,sans-serif">${m.count} ${m.count === 1 ? 'baixa' : 'baixas'}</text>` : '',
        ].join('');
      }).join('');

      // Baseline (eixo X)
      const svgBaseline = `<line x1="${padL}" y1="${plotBottomY}" x2="${padL + plotW}" y2="${plotBottomY}" stroke="#cbd5e1" stroke-width="1"/>`;

      const activeMonths = monthlyData.filter(m => m.count > 0);

      // ── Ticket médio ───────────────────────────────────────────────
      const ticketMedio = totalPayments > 0 ? totalHonorarios / totalPayments : 0;

      // ── Agregação por forma de pagamento ───────────────────────────
      const methodKeys = ['pix','transferencia','dinheiro','cartao_credito','cartao_debito','cheque','outros'];
      const methodLabelMap: Record<string, string> = { pix: 'PIX', transferencia: 'Transferência', dinheiro: 'Dinheiro', cartao_credito: 'Cartão Crédito', cartao_debito: 'Cartão Débito', cheque: 'Cheque', outros: 'Outros' };
      const methodPalette: Record<string, string> = { pix: '#0e2a47', transferencia: '#2d4a6f', dinheiro: '#5774a0', cartao_credito: '#7e95bc', cartao_debito: '#a5b6cf', cheque: '#c9d2e0', outros: '#dee5ee' };
      const methodAgg = new Map<string, { total: number; count: number }>();
      allInstallmentsYear.forEach(inst => {
        const raw = (inst as any).payment_method;
        const key = (raw && methodKeys.includes(raw)) ? raw : 'outros';
        const cur = methodAgg.get(key) ?? { total: 0, count: 0 };
        cur.total += computeFee(inst);
        cur.count += 1;
        methodAgg.set(key, cur);
      });
      const sortedMethods = methodKeys
        .filter(k => methodAgg.has(k) && methodAgg.get(k)!.total > 0)
        .map(k => ({ key: k, ...methodAgg.get(k)! }))
        .sort((a, b) => b.total - a.total);

      // ── Donut chart de métodos ─────────────────────────────────────
      const donutR  = 64;
      const donutSW = 22;
      const donutCx = 90;
      const donutCy = 90;
      const donutC  = 2 * Math.PI * donutR;
      let donutOff  = 0;
      const donutArcs = sortedMethods.map(m => {
        const pct = totalHonorarios > 0 ? m.total / totalHonorarios : 0;
        const dash = pct * donutC;
        const arc = `<circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" stroke="${methodPalette[m.key] ?? '#94a3b8'}" stroke-width="${donutSW}" fill="none" stroke-dasharray="${dash.toFixed(2)} ${(donutC - dash).toFixed(2)}" stroke-dashoffset="${(-donutOff).toFixed(2)}" transform="rotate(-90 ${donutCx} ${donutCy})"/>`;
        donutOff += dash;
        return arc;
      }).join('');
      const donutLegendHTML = sortedMethods.map(m => {
        const pct = totalHonorarios > 0 ? (m.total / totalHonorarios * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f1f5f9;">
          <span style="display:inline-block;width:10px;height:10px;background:${methodPalette[m.key] ?? '#94a3b8'};flex-shrink:0;"></span>
          <span style="flex:1;font-size:11.5px;color:#334155;font-weight:500;">${methodLabelMap[m.key] ?? m.key}</span>
          <span style="font-size:10.5px;color:#94a3b8;font-variant-numeric:tabular-nums;min-width:40px;text-align:right;">${pct.toFixed(1)}%</span>
          <span style="font-size:11.5px;color:#0e2a47;font-weight:600;font-variant-numeric:tabular-nums;min-width:90px;text-align:right;">${fmtR(m.total)}</span>
        </div>`;
      }).join('');

      // ── Trimestres ─────────────────────────────────────────────────
      const quarters = [
        { name: 'Q1', range: 'Jan – Mar', months: [0,1,2] },
        { name: 'Q2', range: 'Abr – Jun', months: [3,4,5] },
        { name: 'Q3', range: 'Jul – Set', months: [6,7,8] },
        { name: 'Q4', range: 'Out – Dez', months: [9,10,11] },
      ].map(q => {
        const insts = q.months.flatMap(mi => monthlyData[mi].insts);
        const total = insts.reduce((s, inst) => s + computeFee(inst), 0);
        return { ...q, count: insts.length, total };
      });
      const qMax = Math.max(...quarters.map(q => q.total), 1);
      const quartersHTML = quarters.map(q => {
        const pct = (q.total / qMax) * 100;
        const has = q.total > 0;
        return `<div style="padding:18px 20px;border-right:1px solid #e2e8f0;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:11px;font-weight:700;color:#0e2a47;letter-spacing:.05em;">${q.name}</span>
            <span style="font-size:9.5px;color:#94a3b8;letter-spacing:.05em;">${q.range}</span>
          </div>
          <div class="serif" style="font-size:17px;font-weight:600;color:${has ? '#0e2a47' : '#cbd5e1'};letter-spacing:-.01em;font-variant-numeric:tabular-nums;line-height:1.1;">${fmtR(q.total)}</div>
          <div style="margin-top:5px;font-size:10px;color:#64748b;">${q.count} ${q.count === 1 ? 'baixa' : 'baixas'}</div>
          <div style="margin-top:8px;height:3px;background:#f1f5f9;overflow:hidden;">
            <div style="height:100%;width:${pct.toFixed(1)}%;background:${has ? '#0e2a47' : 'transparent'};"></div>
          </div>
        </div>`;
      }).join('');

      // ── Top 5 fontes pagadoras ─────────────────────────────────────
      const sortedClients = Array.from(clientMap.values()).sort((a, b) => b.total - a.total);
      const top5 = sortedClients.slice(0, 5);
      const restClients = sortedClients.slice(5);
      const restTotal = restClients.reduce((s, e) => s + e.total, 0);
      const restCount = restClients.reduce((s, e) => s + e.count, 0);
      const top5HTML = top5.map((e, i) => {
        const pct = totalHonorarios > 0 ? (e.total / totalHonorarios * 100) : 0;
        return `<div style="display:grid;grid-template-columns:22px minmax(0,1fr) 90px;column-gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <span class="serif" style="font-size:16px;font-weight:600;color:#94a3b8;letter-spacing:-.02em;font-variant-numeric:tabular-nums;">${String(i + 1).padStart(2, '0')}</span>
          <div style="min-width:0;overflow:hidden;">
            <div style="font-size:11.5px;font-weight:600;color:#0e2a47;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.name}</div>
            <div style="margin-top:2px;display:flex;align-items:center;gap:8px;font-size:10px;color:#94a3b8;">
              <span style="font-variant-numeric:tabular-nums;white-space:nowrap;">${maskDoc(e.cpf)}</span>
              <span style="opacity:.5;">·</span>
              <span style="white-space:nowrap;">${e.count} ${e.count === 1 ? 'baixa' : 'baixas'}</span>
              <span style="opacity:.5;">·</span>
              <span style="font-variant-numeric:tabular-nums;color:#64748b;font-weight:500;">${pct.toFixed(1)}%</span>
            </div>
            <div style="margin-top:6px;height:3px;background:#f1f5f9;position:relative;overflow:hidden;">
              <div style="position:absolute;inset:0;width:${pct.toFixed(1)}%;background:#0e2a47;"></div>
            </div>
          </div>
          <div class="num serif" style="font-size:13px;font-weight:600;color:#0e2a47;text-align:right;letter-spacing:-.01em;white-space:nowrap;">${fmtR(e.total)}</div>
        </div>`;
      }).join('');
      const restRowHTML = restClients.length > 0 ? `<div style="display:grid;grid-template-columns:22px minmax(0,1fr) 90px;column-gap:12px;align-items:center;padding:12px 0 4px;font-size:11px;color:#64748b;">
        <span style="text-align:center;">+</span>
        <span style="font-style:italic;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Outros ${restClients.length} ${restClients.length === 1 ? 'cliente' : 'clientes'} · ${restCount} ${restCount === 1 ? 'baixa' : 'baixas'}</span>
        <span class="num" style="text-align:right;font-weight:600;color:#475569;white-space:nowrap;">${fmtR(restTotal)}</span>
      </div>` : '';

      // ── ID único do documento ──────────────────────────────────────
      const docId = `IRPF-${year}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      // ── Monthly detail rows ────────────────────────────────────────
      const monthlyTablesHTML = activeMonths.map(m => {
        const rowsHTML = m.insts
          .slice()
          .sort((a, b) => (a.payment_date ?? '').localeCompare(b.payment_date ?? ''))
          .map(inst => {
            if (!inst.agreement) return '';
            const cid    = inst.agreement.client_id;
            const client = clients.find(c => c.id === cid);
            const cName  = client?.full_name || (client as any)?.name || '—';
            const cCpf   = maskDoc(client?.cpf_cnpj || (client as any)?.cpf || (client as any)?.document);
            const dateStr = inst.payment_date
              ? new Date(inst.payment_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
              : '—';
            const rawMeth = (inst as any).payment_method;
            const methKey = (rawMeth && methodKeys.includes(rawMeth)) ? rawMeth : 'outros';
            const fee  = computeFee(inst);
            return `<tr data-method="${methKey}" data-value="${fee.toFixed(4)}">
              <td style="color:#475569;font-variant-numeric:tabular-nums;white-space:nowrap;padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:11.5px;">${dateStr}</td>
              <td style="font-weight:500;color:#0f172a;padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:11.5px;">${cName}</td>
              <td style="color:#475569;font-size:11px;white-space:nowrap;padding:10px 14px;border-bottom:1px solid #f1f5f9;font-variant-numeric:tabular-nums;">${cCpf}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#475569;font-size:11px;">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span style="display:inline-block;width:6px;height:6px;background:${methodPalette[methKey] ?? '#94a3b8'};"></span>
                  ${methodLabelFn(rawMeth)}
                </span>
              </td>
              <td style="text-align:right;font-weight:600;color:#0e2a47;font-variant-numeric:tabular-nums;white-space:nowrap;padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;">${fmtR(fee)}</td>
            </tr>`;
          }).join('');
        return `
        <div data-month-block style="margin-bottom:24px;page-break-inside:avoid;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:0 0 8px;border-bottom:2px solid #0e2a47;margin-bottom:0;">
            <div style="display:flex;align-items:baseline;gap:14px;">
              <span style="font-size:14px;font-weight:700;color:#0e2a47;letter-spacing:-.01em;">${m.name}</span>
              <span data-month-count style="font-size:10px;color:#94a3b8;font-weight:500;letter-spacing:.08em;text-transform:uppercase;">${year} · ${m.count} ${m.count === 1 ? 'baixa' : 'baixas'}</span>
            </div>
            <span data-month-total style="font-size:15px;font-weight:700;color:#0e2a47;font-variant-numeric:tabular-nums;letter-spacing:-.01em;">${fmtR(m.total)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-top:0;">
            <thead>
              <tr>
                <th style="padding:10px 14px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Data</th>
                <th style="padding:10px 14px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Cliente</th>
                <th style="padding:10px 14px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">CPF / CNPJ</th>
                <th style="padding:10px 14px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;text-align:left;border-bottom:1px solid #e2e8f0;">Forma de pagamento</th>
                <th style="padding:10px 14px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#94a3b8;text-align:right;border-bottom:1px solid #e2e8f0;">Honorários (R$)</th>
              </tr>
            </thead>
            <tbody>${rowsHTML}</tbody>
            <tfoot>
              <tr>
                <td colspan="4" style="text-align:right;font-size:10px;color:#475569;font-weight:600;padding:10px 14px;letter-spacing:.06em;text-transform:uppercase;">Subtotal</td>
                <td data-month-subtotal style="text-align:right;font-weight:700;color:#0e2a47;font-variant-numeric:tabular-nums;padding:10px 14px;font-size:13px;border-top:1px solid #0e2a47;">${fmtR(m.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`;
      }).join('');

      // ── Client summary rows ────────────────────────────────────────
      const clientRowsHTML = Array.from(clientMap.values())
        .sort((a, b) => b.total - a.total)
        .map((e) => `<tr>
          <td style="padding:11px 16px;font-weight:500;color:#0f172a;font-size:12px;border-bottom:1px solid #f1f5f9;">${e.name}</td>
          <td style="padding:11px 16px;font-size:11px;color:#475569;font-variant-numeric:tabular-nums;border-bottom:1px solid #f1f5f9;">${maskDoc(e.cpf)}</td>
          <td style="padding:11px 16px;text-align:center;color:#475569;font-size:12px;border-bottom:1px solid #f1f5f9;font-variant-numeric:tabular-nums;">${e.count}</td>
          <td style="padding:11px 16px;text-align:right;font-weight:600;color:#0e2a47;font-variant-numeric:tabular-nums;font-size:12.5px;border-bottom:1px solid #f1f5f9;">${fmtR(e.total)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Relatório IRPF ${year} — ${lawyerName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Source+Serif+4:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    @page{size:A4 portrait;margin:0;}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#eef2f7;color:#0e2a47;font-size:13px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .doc{max-width:920px;margin:0 auto;background:#fff;box-shadow:0 4px 32px rgba(15,23,42,.06);}
    .serif{font-family:'Source Serif 4',Georgia,serif;}
    .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum";}
    .eyebrow{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.18em;color:#64748b;}

    /* JURIUS Brand Bars */
    .jurius-top{background:#0a1828;color:#fff;padding:14px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #d4a857;}
    .jurius-logo{display:flex;align-items:center;gap:14px;}
    .jurius-mark{width:34px;height:34px;background:#d4a857;display:flex;align-items:center;justify-content:center;font-family:'Source Serif 4',Georgia,serif;font-weight:700;font-size:18px;color:#0a1828;letter-spacing:-.02em;}
    .jurius-wordmark{font-family:'Source Serif 4',Georgia,serif;font-size:18px;font-weight:600;letter-spacing:.18em;color:#fff;}
    .jurius-tagline{font-size:9px;letter-spacing:.25em;color:#d4a857;text-transform:uppercase;margin-top:1px;}
    .jurius-meta{text-align:right;font-size:10px;color:#94a3b8;letter-spacing:.05em;line-height:1.5;}
    .jurius-meta strong{color:#fff;font-weight:600;}

    .jurius-bottom{background:#0a1828;color:#94a3b8;padding:16px 32px;display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.04em;border-top:3px solid #d4a857;}
    .jurius-bottom strong{color:#d4a857;letter-spacing:.18em;}

    /* Filter bar */
    .filter-bar{display:flex;flex-wrap:wrap;gap:6px;padding:14px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}
    .filter-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#475569;border:1px solid #e2e8f0;padding:6px 12px;font-family:inherit;font-size:10.5px;font-weight:600;cursor:pointer;letter-spacing:.04em;text-transform:uppercase;transition:all .12s ease;}
    .filter-btn:hover{border-color:#94a3b8;color:#0e2a47;}
    .filter-btn.filter-active{background:#0e2a47;color:#fff;border-color:#0e2a47;}
    .filter-btn .count{opacity:.55;font-size:9.5px;font-weight:500;}
    .filter-status{margin-left:auto;font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:8px;}

    @media print{
      body{background:#fff;}
      .doc{box-shadow:none;max-width:none;}
      .no-print{display:none!important;}
      .filter-bar{display:none!important;}
      .page-break{page-break-before:always;}
      .jurius-top, .jurius-bottom{position:running(header);}
    }
  </style>
</head>
<body>

  <!-- Print toolbar -->
  <div class="no-print" style="max-width:920px;margin:18px auto 14px;text-align:right;padding:0 4px;">
    <button onclick="window.print()" style="display:inline-flex;align-items:center;gap:8px;background:#0a1828;color:#fff;border:none;padding:10px 22px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.1em;text-transform:uppercase;">
      Imprimir / Salvar PDF
    </button>
  </div>

<div class="doc">

  <!-- ════════ JURIUS HEADER BAR ════════ -->
  <div class="jurius-top">
    <div class="jurius-logo">
      <div class="jurius-mark">J</div>
      <div>
        <div class="jurius-wordmark">JURIUS</div>
        <div class="jurius-tagline">Sistema Jurídico</div>
      </div>
    </div>
    <div class="jurius-meta">
      <div><strong>Relatório IRPF · Exercício ${year}</strong></div>
      <div>Documento · ${docId}</div>
    </div>
  </div>

  <!-- ════════ DOCUMENT HEADER ════════ -->
  <header style="padding:32px 32px 24px;display:flex;justify-content:space-between;align-items:flex-start;gap:32px;">
    <div style="flex:1;">
      <div class="eyebrow" style="margin-bottom:6px;">Escritório</div>
      <div class="serif" style="font-size:20px;font-weight:600;color:#0e2a47;letter-spacing:-.01em;line-height:1.2;">${lawyerName}</div>
      <div style="margin-top:8px;font-size:11.5px;color:#475569;letter-spacing:.01em;">OAB/${lawyerState} nº ${lawyerOab} &nbsp;·&nbsp; ${lawyerEmail}</div>
    </div>
    <div style="text-align:right;">
      <div class="eyebrow">Documento</div>
      <div class="serif" style="font-size:22px;font-weight:700;color:#0e2a47;letter-spacing:-.02em;margin-top:4px;line-height:1.1;">Relatório de Honorários</div>
      <div style="margin-top:6px;font-size:11.5px;color:#475569;">Exercício fiscal · <strong style="color:#0e2a47;">${year}</strong></div>
      <div style="margin-top:2px;font-size:10.5px;color:#94a3b8;">Emitido em ${issueDateStr}</div>
    </div>
  </header>

  <!-- ════════ KPI ROW (4 col) ════════ -->
  <section style="margin:0 32px;display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
    <div style="padding:22px 24px 22px 0;border-right:1px solid #e2e8f0;">
      <div class="eyebrow" style="margin-bottom:8px;">Total de honorários · ${year}</div>
      <div id="kpi-total" class="serif num" style="font-size:30px;font-weight:700;color:#0e2a47;letter-spacing:-.025em;line-height:1;">${fmtR(totalHonorarios)}</div>
      <div style="margin-top:8px;font-size:10.5px;color:#64748b;line-height:1.4;font-style:italic;">${numberToWords(totalHonorarios)}</div>
    </div>
    <div style="padding:22px 20px;border-right:1px solid #e2e8f0;">
      <div class="eyebrow" style="margin-bottom:8px;">Baixas</div>
      <div id="kpi-count" class="serif num" style="font-size:24px;font-weight:700;color:#0e2a47;letter-spacing:-.02em;line-height:1;">${totalPayments}</div>
      <div style="margin-top:6px;font-size:10.5px;color:#64748b;">pagamentos</div>
    </div>
    <div style="padding:22px 20px;border-right:1px solid #e2e8f0;">
      <div class="eyebrow" style="margin-bottom:8px;">Ticket médio</div>
      <div id="kpi-medio" class="serif num" style="font-size:20px;font-weight:700;color:#0e2a47;letter-spacing:-.02em;line-height:1;">${fmtR(ticketMedio)}</div>
      <div style="margin-top:6px;font-size:10.5px;color:#64748b;">por baixa</div>
    </div>
    <div style="padding:22px 0 22px 20px;">
      <div class="eyebrow" style="margin-bottom:8px;">Fontes pagadoras</div>
      <div class="serif num" style="font-size:24px;font-weight:700;color:#0e2a47;letter-spacing:-.02em;line-height:1;">${clientMap.size}</div>
      <div style="margin-top:6px;font-size:10.5px;color:#64748b;">clientes distintos</div>
    </div>
  </section>

  <!-- ════════ FILTER BAR (interactive) ════════ -->
  <div class="filter-bar no-print">
    <button class="filter-btn filter-active" data-filter="all">Todos <span class="count">${totalPayments}</span></button>
    ${sortedMethods.map(m => `<button class="filter-btn" data-filter="${m.key}">${methodLabelMap[m.key]} <span class="count">${m.count}</span></button>`).join('')}
    <span class="filter-status">Filtre as baixas para análise contextual</span>
  </div>

  <!-- ════════ QUARTERLY ════════ -->
  <section style="margin:32px 32px 0;">
    <div style="margin-bottom:14px;">
      <div class="eyebrow">Resumo Trimestral</div>
      <div class="serif" style="font-size:15px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Evolução por trimestre — ${year}</div>
    </div>
    <div style="border:1px solid #e2e8f0;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;">
      ${quartersHTML}
    </div>
  </section>

  <!-- ════════ CHART 01: Monthly Bars ════════ -->
  <section style="margin:36px 32px 0;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;">
      <div>
        <div class="eyebrow">Gráfico 01</div>
        <div class="serif" style="font-size:15px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Distribuição mensal de honorários recebidos</div>
      </div>
      <div style="font-size:10.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;">Valores em R$</div>
    </div>
    <div style="border:1px solid #e2e8f0;padding:18px 14px 12px;">
      <svg viewBox="0 0 ${chartW} ${chartH}" width="100%" style="display:block;">
        ${svgGridLines}
        ${svgBaseline}
        ${svgBarsHTML}
      </svg>
    </div>
    <div style="margin-top:8px;display:flex;gap:18px;font-size:10px;color:#64748b;">
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;background:#0e2a47;"></span>Maior mês do exercício</span>
      <span style="display:inline-flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;background:#3b5b7d;"></span>Demais meses com baixas</span>
    </div>
  </section>

  <!-- ════════ CHART 02: Method Donut + Top 5 ════════ -->
  <section style="margin:36px 32px 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;page-break-inside:avoid;">

    <!-- Donut -->
    <div style="min-width:0;">
      <div style="margin-bottom:14px;">
        <div class="eyebrow">Gráfico 02</div>
        <div class="serif" style="font-size:15px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Composição por forma de pagamento</div>
      </div>
      <div style="border:1px solid #e2e8f0;padding:18px;display:grid;grid-template-columns:140px minmax(0,1fr);column-gap:16px;align-items:center;">
        <svg viewBox="0 0 180 180" width="140" height="140" style="display:block;">
            ${donutArcs}
            <text x="90" y="84" text-anchor="middle" font-size="9" fill="#94a3b8" font-family="Inter,system-ui,sans-serif" letter-spacing="0.1em" font-weight="600">TOTAL</text>
            <text x="90" y="100" text-anchor="middle" font-size="13" fill="#0e2a47" font-family="Source Serif 4,Georgia,serif" font-weight="700">${fmtR(totalHonorarios).replace('R$ ', 'R$ ')}</text>
            <text x="90" y="116" text-anchor="middle" font-size="9" fill="#94a3b8" font-family="Inter,system-ui,sans-serif">${sortedMethods.length} método${sortedMethods.length !== 1 ? 's' : ''}</text>
        </svg>
        <div style="min-width:0;overflow:hidden;">
          ${donutLegendHTML || '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:24px 0;">Sem dados</div>'}
        </div>
      </div>
    </div>

    <!-- Top 5 -->
    <div style="min-width:0;">
      <div style="margin-bottom:14px;">
        <div class="eyebrow">Ranking</div>
        <div class="serif" style="font-size:15px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Top 5 fontes pagadoras</div>
      </div>
      <div style="border:1px solid #e2e8f0;padding:6px 18px;min-height:180px;overflow:hidden;">
        ${top5HTML || '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:40px 0;">Sem dados</div>'}
        ${restRowHTML}
      </div>
    </div>

  </section>

  <!-- ════════ MONTHLY DETAIL ════════ -->
  <section style="margin:44px 32px 0;">
    <div style="margin-bottom:6px;">
      <div class="eyebrow">Tabela 01</div>
      <div class="serif" style="font-size:16px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Detalhamento analítico — Mês a mês</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Cada linha representa uma baixa registrada no sistema, com data, fonte pagadora, documento, forma de pagamento e o valor de honorários efetivamente recebido. Use os filtros acima para isolar formas de pagamento.</div>
    </div>
    <div style="margin-top:18px;">
      ${activeMonths.length > 0 ? monthlyTablesHTML : '<div style="text-align:center;color:#94a3b8;padding:48px 0;font-size:12px;border:1px dashed #e2e8f0;">Nenhuma baixa registrada em ' + year + '.</div>'}
    </div>
  </section>

  <!-- ════════ CLIENT SUMMARY ════════ -->
  <section style="margin:44px 32px 0;page-break-inside:avoid;">
    <div style="margin-bottom:18px;">
      <div class="eyebrow">Tabela 02</div>
      <div class="serif" style="font-size:16px;font-weight:600;color:#0e2a47;margin-top:2px;letter-spacing:-.01em;">Resumo consolidado por fonte pagadora</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">Agrupamento anual completo (não afetado pelos filtros) para preenchimento da Ficha de Rendimentos Tributáveis (IRPF).</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="border-top:2px solid #0e2a47;border-bottom:1px solid #0e2a47;">
          <th style="padding:11px 16px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#0e2a47;text-align:left;">Cliente / Fonte pagadora</th>
          <th style="padding:11px 16px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#0e2a47;text-align:left;">CPF / CNPJ</th>
          <th style="padding:11px 16px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#0e2a47;text-align:center;">Baixas</th>
          <th style="padding:11px 16px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#0e2a47;text-align:right;">Total (R$)</th>
        </tr>
      </thead>
      <tbody>${clientRowsHTML}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:14px 16px;font-weight:700;color:#0e2a47;font-size:12px;text-transform:uppercase;letter-spacing:.08em;border-top:2px solid #0e2a47;">Total geral</td>
          <td style="padding:14px 16px;text-align:center;font-weight:700;color:#0e2a47;border-top:2px solid #0e2a47;font-variant-numeric:tabular-nums;">${totalPayments}</td>
          <td class="serif num" style="padding:14px 16px;text-align:right;font-weight:700;color:#0e2a47;font-size:15px;border-top:2px solid #0e2a47;letter-spacing:-.01em;">${fmtR(totalHonorarios)}</td>
        </tr>
      </tfoot>
    </table>
  </section>

  <!-- ════════ DOCUMENT FOOTER (lawyer info) ════════ -->
  <footer style="margin:48px 32px 24px;padding-top:18px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end;font-size:10px;color:#94a3b8;">
    <div>
      <div style="font-weight:600;color:#475569;font-size:11px;letter-spacing:.02em;">${lawyerName}</div>
      <div style="margin-top:2px;">OAB/${lawyerState} ${lawyerOab} · ${lawyerEmail}</div>
    </div>
    <div style="text-align:right;">
      <div>Relatório IRPF · Exercício ${year}</div>
      <div style="margin-top:2px;">Emitido em ${issueDateStr}</div>
    </div>
  </footer>

  <!-- ════════ JURIUS FOOTER BAR ════════ -->
  <div class="jurius-bottom">
    <div>
      <strong>JURIUS</strong> &nbsp;·&nbsp; Sistema Jurídico &nbsp;·&nbsp; © ${new Date().getFullYear()}
    </div>
    <div style="text-align:right;">
      <div>Documento confidencial · Sigilo profissional (Lei 8.906/94, art. 7º, II)</div>
      <div style="margin-top:2px;color:#64748b;font-size:9.5px;">ID: ${docId}</div>
    </div>
  </div>

</div><!-- /.doc -->

<!-- Print button bottom -->
<div class="no-print" style="max-width:920px;margin:18px auto 32px;text-align:center;">
  <button onclick="window.print()" style="display:inline-flex;align-items:center;gap:8px;background:#0a1828;color:#fff;border:none;padding:11px 28px;font-family:inherit;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.1em;text-transform:uppercase;">
    Imprimir / Salvar PDF
  </button>
</div>

<script>
(function(){
  const fmtBRL = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const buttons = document.querySelectorAll('.filter-btn');
  const totalAll = ${totalHonorarios};
  const countAll = ${totalPayments};
  const medioAll = ${ticketMedio};
  const totalEl  = document.getElementById('kpi-total');
  const countEl  = document.getElementById('kpi-count');
  const medioEl  = document.getElementById('kpi-medio');

  function setActive(btn){
    buttons.forEach(b => b.classList.toggle('filter-active', b === btn));
  }
  function applyFilter(method){
    const rows = document.querySelectorAll('tr[data-method]');
    rows.forEach(row => {
      row.style.display = (method === 'all' || row.dataset.method === method) ? '' : 'none';
    });

    // Recalc por mês
    document.querySelectorAll('[data-month-block]').forEach(block => {
      const visible = Array.from(block.querySelectorAll('tr[data-method]')).filter(r => r.style.display !== 'none');
      const subtotal = visible.reduce((s, r) => s + parseFloat(r.dataset.value || '0'), 0);
      const count = visible.length;
      const tEl = block.querySelector('[data-month-total]');
      const cEl = block.querySelector('[data-month-count]');
      const sEl = block.querySelector('[data-month-subtotal]');
      if (tEl) tEl.textContent = fmtBRL(subtotal);
      if (cEl) {
        const baseMonth = cEl.textContent.split('·')[0].trim();
        cEl.textContent = baseMonth + ' · ' + count + ' ' + (count === 1 ? 'baixa' : 'baixas');
      }
      if (sEl) sEl.textContent = fmtBRL(subtotal);
      block.style.display = count === 0 ? 'none' : '';
    });

    // Recalc KPIs
    if (method === 'all') {
      if (totalEl) totalEl.textContent = fmtBRL(totalAll);
      if (countEl) countEl.textContent = countAll;
      if (medioEl) medioEl.textContent = fmtBRL(medioAll);
    } else {
      let gt = 0, gc = 0;
      document.querySelectorAll('tr[data-method]').forEach(r => {
        if (r.style.display !== 'none') {
          gt += parseFloat(r.dataset.value || '0');
          gc++;
        }
      });
      if (totalEl) totalEl.textContent = fmtBRL(gt);
      if (countEl) countEl.textContent = gc;
      if (medioEl) medioEl.textContent = fmtBRL(gc > 0 ? gt / gc : 0);
    }
  }
  buttons.forEach(b => b.addEventListener('click', () => {
    setActive(b);
    applyFilter(b.dataset.filter);
  }));
})();
</script>

</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      
      toast.success('Relatório gerado', 'Relatório de IR aberto em nova aba');
    } catch (err: any) {
      toast.error('Erro ao gerar relatório', err.message);
    }
  };

  const handlePreviousMonth = () => {
    const date = new Date(`${activeMonth}-01T00:00:00`);
    date.setMonth(date.getMonth() - 1);
    setActiveMonth(date.toISOString().slice(0, 7));
  };

  const handleNextMonth = () => {
    const date = new Date(`${activeMonth}-01T00:00:00`);
    date.setMonth(date.getMonth() + 1);
    setActiveMonth(date.toISOString().slice(0, 7));
  };

  const formatMonthYear = (monthStr: string) => {
    const date = new Date(`${monthStr}-01T00:00:00`);
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const buildScheduleFromForm = () => {
    if (!formData.firstDueDate) {
      return [] as { number: number; dueDate: string; value: number }[];
    }

    if (formData.paymentType === 'upfront') {
      return [
        {
          number: 1,
          dueDate: formData.firstDueDate,
          value: Number(formData.totalValue || 0),
        },
      ];
    }

    if (formData.customInstallments.length) {
      return formData.customInstallments.map((item, index) => ({
        number: index + 1,
        dueDate: item.dueDate || formData.firstDueDate,
        value: Number(item.value || 0),
      }));
    }

    const schedule: { number: number; dueDate: string; value: number }[] = [];
    const total = Number(formData.totalValue || 0);
    const count = Number(formData.installmentsCount || '0') || 1;
    const baseDate = new Date(formData.firstDueDate);
    const installmentValue = count > 0 ? total / count : total;

    for (let i = 0; i < count; i++) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      schedule.push({
        number: i + 1,
        dueDate: formatLocalISODate(dueDate),
        value: Number(installmentValue.toFixed(2)),
      });
    }

    return schedule;
  };

  const createCalendarEventsForInstallments = async (
    agreement: Agreement,
    schedule: { number: number; dueDate: string; value: number }[]
  ) => {
    if (!schedule.length) return;
    const clientName = getClientName(agreement.client_id);

    try {
      await Promise.all(
        schedule.map((item) =>
          calendarService.createEvent({
            title: `Recebimento ${clientName} - Parcela ${item.number}`,
            description: `Acordo: ${agreement.title}\nParcela ${item.number}/${schedule.length}\nValor: ${formatCurrency(item.value)}\n[agreement_id:${agreement.id}] [installment:${item.number}]`,
            event_type: 'payment',
            start_at: `${item.dueDate}T00:00:00`,
            notify_minutes_before: 60,
            client_id: agreement.client_id,
            process_id: agreement.process_id ?? undefined,
          })
        )
      );
    } catch (error: any) {
      toast.error('Calendário', 'Não foi possível agendar os recebimentos');
    }
  };

  const updateCalendarEventStatus = async (
    agreementId: string,
    installmentNumber: number,
    status: 'pendente' | 'concluido' | 'cancelado',
    paymentDate?: string
  ) => {
    try {
      const events = await calendarService.listEvents(['payment']);
      const target = events.find(
        (event) =>
          event.description?.includes(`[agreement_id:${agreementId}]`) &&
          event.description?.includes(`[installment:${installmentNumber}]`)
      );

      if (!target) return;

      await calendarService.updateEvent(target.id, {
        status,
        start_at: paymentDate ? `${paymentDate}T00:00:00` : target.start_at,
        description: target.description,
      });
    } catch (_) {
      // Silenciar erros de sincronização do calendário para não interromper fluxo principal
    }
  };

  const ensureOverdueDeadlines = async (agreement: Agreement, installmentsList: Installment[]) => {
    try {
      const events = await calendarService.listEvents(['deadline']);
      await Promise.all(
        installmentsList
          .filter((inst) => {
            const dueDate = parseLocalDate(inst.due_date);
            if (!dueDate) return false;
            const threshold = new Date();
            threshold.setDate(threshold.getDate() - 2);
            return inst.status === 'pendente' && dueDate < threshold;
          })
          .map(async (inst) => {
            const exists = events.some(
              (event) =>
                event.description?.includes(`[agreement_id:${agreement.id}]`) &&
                event.description?.includes(`[installment:${inst.installment_number}]`) &&
                event.description?.includes('[inadimplencia]')
            );

            if (exists) return;

            const clientName = getClientName(agreement.client_id);
            const deadlineDate = parseLocalDate(inst.due_date);
            if (!deadlineDate) return;
            deadlineDate.setDate(deadlineDate.getDate() + 2);

            await calendarService.createEvent({
              title: `Prazo: Denúncia de inadimplência - ${clientName}`,
              description: `Acordo: ${agreement.title}\nParcela ${inst.installment_number}/${agreement.installments_count}\nValor: ${formatCurrency(inst.value)}\n[inadimplencia] [agreement_id:${agreement.id}] [installment:${inst.installment_number}]`,
              event_type: 'deadline',
              start_at: `${formatLocalISODate(deadlineDate)}T00:00:00`,
              notify_minutes_before: 60,
              client_id: agreement.client_id,
              process_id: agreement.process_id ?? undefined,
            });
          })
      );
    } catch (_) {
      // Silenciar erros de calendário
    }
  };

  const handleGenerateReceipt = (
    agreement: Agreement,
    installment?: Installment,
    options?: {
      totalPaid?: number;
      paymentMethodLabel?: string;
      paymentDate?: string;
      descriptionOverride?: string;
    }
  ) => {
    const client = clients.find(c => c.id === agreement.client_id);
    const clientName = client?.full_name || (client as any)?.name || 'Cliente não encontrado';
    const rawCpf = (client as any)?.cpf_cnpj || (client as any)?.cpf || (client as any)?.document || '';
    const clientCpf = (() => {
      const d = String(rawCpf).replace(/\D/g, '');
      if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
      if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
      return rawCpf;
    })();
    const clientAddress = (client as any)?.address || '';
    const issueDate = new Date();
    const year = issueDate.getFullYear();
    const issueDateFormatted = issueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    // Usa o valor real pago (paid_value) — não o valor agendado
    const actualPaid = installment?.paid_value ?? installment?.value ?? 0;
    // Para recibo do acordo completo: soma apenas os honorários das parcelas efetivamente baixadas
    const totalPaidFees = !installment
      ? allInstallments
          .filter(i => i.agreement_id === agreement.id && i.status === 'pago')
          .reduce((sum, i) => {
            const feeRatio = agreement.total_value > 0 ? agreement.fee_value / agreement.total_value : 1;
            return sum + (i.paid_value ?? i.value ?? 0) * feeRatio;
          }, 0)
      : 0;
    const amount = options?.totalPaid ?? (installment ? actualPaid : (totalPaidFees || agreement.fee_value));
    const amountInWords = numberToWords(amount || 0);
    const receiptNumber = `REC-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getHours()).padStart(2, '0')}${String(issueDate.getMinutes()).padStart(2, '0')}${String(issueDate.getSeconds()).padStart(2, '0')}`;
    
    // Dados fixos do advogado
    const lawyerName = 'PEDRO RODRIGUES MONTALVAO NETO';
    const lawyerOab = '30.021';
    const lawyerState = 'MT';
    const lawyerEmail = 'pedro@advcuiaba.com';
    const lawyerTitle = `Dr. ${lawyerName}`;
    
    // Para recibo do acordo completo, deriva forma/data da(s) baixa(s) efetiva(s)
    const paidInstallmentsForAgreement = !installment
      ? allInstallments
          .filter(i => i.agreement_id === agreement.id && i.status === 'pago')
          .sort((a, b) => (b.payment_date ?? '').localeCompare(a.payment_date ?? ''))
      : [];
    const distinctMethods = Array.from(new Set(paidInstallmentsForAgreement.map(i => i.payment_method).filter(Boolean)));
    const aggregateMethodLabel = distinctMethods.length === 1
      ? getPaymentMethodLabel(distinctMethods[0])
      : distinctMethods.length > 1
        ? 'Múltiplas formas de pagamento'
        : null;
    const latestPaidDate = paidInstallmentsForAgreement[0]?.payment_date ?? null;

    const paymentMethod = options?.paymentMethodLabel
      ?? (installment ? getPaymentMethodLabel(installment.payment_method) : null)
      ?? aggregateMethodLabel
      ?? 'Não informado';
    const paymentDateDisplay = options?.paymentDate
      ? new Date(options.paymentDate).toLocaleDateString('pt-BR')
      : installment?.payment_date
        ? new Date(installment.payment_date).toLocaleDateString('pt-BR')
        : installment?.due_date
          ? (parseLocalDate(installment.due_date) ?? new Date(installment.due_date)).toLocaleDateString('pt-BR')
          : latestPaidDate
            ? new Date(latestPaidDate + 'T12:00:00').toLocaleDateString('pt-BR')
            : new Date().toLocaleDateString('pt-BR');
    
    const description = options?.descriptionOverride
      || (installment
        ? `Honorários advocatícios referente à parcela ${installment.installment_number}/${agreement.installments_count} do acordo "${agreement.title}".`
        : `Honorários advocatícios referente ao acordo "${agreement.title}".`);
    
    const serviceDescription = agreement.description || 'Serviços advocatícios prestados conforme contrato de honorários.';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Recibo de Honorários Nº ${receiptNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Inter',system-ui,sans-serif;background:#e8e8e8;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:13px;line-height:1.5}
.wrapper{max-width:720px;margin:0 auto;padding:2rem 1rem}
.page{background:#fff;border:1px solid #c8c8c8;position:relative}
/* Top stripe */
.stripe-top{height:6px;background:#1a2744}
.stripe-green{height:3px;background:#2d6a4f}
/* Header */
.header{padding:2rem 2.5rem 1.5rem;display:flex;justify-content:space-between;align-items:flex-start;gap:2rem;border-bottom:1.5px solid #e0e0e0}
.office-name{font-family:'EB Garamond',Georgia,serif;font-size:1.5rem;font-weight:700;color:#1a2744;letter-spacing:-.01em;line-height:1.1}
.office-meta{margin-top:.4rem;font-size:.75rem;color:#555;line-height:1.6}
.receipt-badge{text-align:right}
.receipt-title{font-family:'EB Garamond',Georgia,serif;font-size:1.1rem;font-weight:600;color:#1a2744;text-transform:uppercase;letter-spacing:.05em}
.receipt-num{font-size:.7rem;color:#777;margin-top:.2rem;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.receipt-date{font-size:.75rem;color:#555;margin-top:.1rem}
/* Main body text */
.body-text{padding:1.75rem 2.5rem;border-bottom:1px dashed #ccc}
.decl-text{font-size:1rem;line-height:1.9;color:#1a1a1a;text-align:justify}
.decl-text strong{font-weight:600}
.amount-inline{font-family:'EB Garamond',Georgia,serif;font-size:1.15rem;font-weight:700;color:#1a2744}
/* Details table */
.details{padding:1.25rem 2.5rem;border-bottom:1px solid #e0e0e0}
.details-title{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:.75rem}
.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem 2rem}
.detail-row{display:flex;flex-direction:column;gap:.1rem;padding:.4rem 0;border-bottom:1px dotted #e8e8e8}
.detail-key{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:#999;font-weight:600}
.detail-val{font-size:.82rem;color:#1a1a1a;font-weight:500}
/* Signature */
.signature-section{padding:2rem 2.5rem 1.5rem;display:flex;align-items:flex-end;justify-content:space-between;gap:3rem}
.sig-block{display:flex;flex-direction:column;align-items:center;gap:.3rem}
.sig-line{width:200px;border-top:1px solid #333;margin-bottom:.3rem}
.sig-name{font-size:.78rem;font-weight:600;color:#1a1a1a;text-align:center;text-transform:uppercase;letter-spacing:.03em}
.sig-oab{font-size:.7rem;color:#666;text-align:center}
.date-block{font-size:.78rem;color:#555;text-align:right;line-height:1.6}
/* Footer */
.footer{background:#f5f5f3;border-top:1.5px solid #e0e0e0;padding:.75rem 2.5rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
.footer-note{font-size:.65rem;color:#999;line-height:1.5}
.btn-print{display:inline-flex;align-items:center;gap:.4rem;background:#1a2744;color:#fff;border:none;padding:.4rem 1rem;font-size:.72rem;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.03em}
.btn-print:hover{background:#243660}
/* Watermark */
.watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-family:'EB Garamond',Georgia,serif;font-size:5rem;font-weight:700;color:rgba(26,39,68,.04);pointer-events:none;white-space:nowrap;z-index:0;letter-spacing:.1em}
.content{position:relative;z-index:1}
@media print{
  html,body{background:#fff}
  .wrapper{padding:0;max-width:100%}
  .page{border:none}
  .btn-print{display:none!important}
  .stripe-top,.stripe-green{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
</head>
<body>
<div class="wrapper">
<div class="page">
  <div class="watermark">RECIBO</div>
  <div class="content">
  <div class="stripe-top"></div>
  <div class="stripe-green"></div>

  <div class="header">
    <div>
      <div class="office-name">${lawyerTitle}</div>
      <div class="office-meta">
        Advogado &nbsp;|&nbsp; OAB/${lawyerState} n° ${lawyerOab}<br>
        ${lawyerEmail}
      </div>
    </div>
    <div class="receipt-badge">
      <div class="receipt-title">Recibo de Honorários</div>
      <div class="receipt-num">Nº ${receiptNumber}</div>
      <div class="receipt-date">${issueDateFormatted}</div>
    </div>
  </div>

  <div class="body-text">
    <p class="decl-text">
      Recebi de <strong>${clientName}</strong>${clientCpf ? `, CPF/MF nº ${clientCpf},` : ','} a quantia de
      <span class="amount-inline">${formatCurrency(amount)}</span>
      <em>(${amountInWords} reais)</em>, referente a honorários advocatícios pela prestação dos seguintes serviços:
      <strong>${description}</strong>${serviceDescription && serviceDescription !== 'Serviços advocatícios prestados conforme contrato de honorários.' ? ` — ${serviceDescription}` : '.'}
      Dou plena, geral e irrevogável quitação pelo valor acima descrito.
    </p>
  </div>

  <div class="details">
    <div class="details-title">Dados do Pagamento</div>
    <div class="details-grid">
      <div class="detail-row">
        <span class="detail-key">Cliente / Pagador</span>
        <span class="detail-val">${clientName}</span>
      </div>
      ${clientCpf ? `<div class="detail-row"><span class="detail-key">CPF</span><span class="detail-val">${clientCpf}</span></div>` : `<div class="detail-row"><span class="detail-key">Referente ao Acordo</span><span class="detail-val">${agreement.title}</span></div>`}
      <div class="detail-row">
        <span class="detail-key">Data do Recebimento</span>
        <span class="detail-val">${paymentDateDisplay}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Forma de Pagamento</span>
        <span class="detail-val">${paymentMethod}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Valor Recebido</span>
        <span class="detail-val" style="font-weight:700;color:#1a2744;font-size:.9rem">${formatCurrency(amount)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-key">Advogado Responsável</span>
        <span class="detail-val">${lawyerName} — OAB/${lawyerState} ${lawyerOab}</span>
      </div>
    </div>
  </div>

  <div class="signature-section">
    <div class="date-block">
      Cuiabá/MT,<br>
      ${issueDateFormatted}
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-name">${lawyerName}</div>
      <div class="sig-oab">OAB/${lawyerState} n° ${lawyerOab}</div>
    </div>
  </div>

  <div class="footer">
    <span class="footer-note">
      Documento válido como comprovante de pagamento de honorários advocatícios conforme Lei nº 8.906/94.<br>
      Ref.: ${receiptNumber} &nbsp;|&nbsp; Emitido em ${issueDateFormatted}
    </span>
    <button class="btn-print" onclick="window.print()">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Imprimir / PDF
    </button>
  </div>
  </div>
</div>
</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleGenerateFullReceipt = (agreement: Agreement) => {
    if (!installments.length) {
      toast.info('Recibo', 'Sem parcelas para gerar recibo total.');
      return;
    }
    const allPaid = installments.every((inst) => inst.status === 'pago');
    if (!allPaid) {
      toast.info('Recibo', 'Gere o recibo total apenas após quitar todas as parcelas.');
      return;
    }
    const totalPaid = agreement.fee_value;
    const methods = new Set(installments.map((inst) => inst.payment_method).filter(Boolean));
    const methodLabel = methods.size === 1 ? getPaymentMethodLabel([...methods][0] as string) : methods.size > 1 ? 'Múltiplos métodos' : 'Não informado';
    const dates = installments
      .map((inst) => inst.payment_date || inst.due_date || '')
      .filter(Boolean)
      .sort();
    const lastDate = dates.length ? dates[dates.length - 1] : undefined;
    handleGenerateReceipt(agreement, undefined, {
      totalPaid,
      paymentMethodLabel: methodLabel,
      paymentDate: lastDate,
    });
  };

  const handleExportAgreement = (agreement: Agreement) => {
    const clientName = getClientName(agreement.client_id);
    const payload = {
      agreement,
      clientName,
      generatedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `acordo-${agreement.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Exportação', 'Dados exportados com sucesso');
  };

  const handleAddDeadline = (agreement: Agreement) => {
    const clientName = getClientName(agreement.client_id);
    toast.info('Prazo', `Funcionalidade de prazo para "${agreement.title}" será implementada em breve`);
  };

  const deleteCalendarEventsForAgreement = async (agreementId: string) => {
    try {
      const events = await calendarService.listEvents(['payment', 'deadline']);
      const related = events.filter((event) => event.description?.includes(`[agreement_id:${agreementId}]`));
      await Promise.all(related.map((event) => calendarService.deleteEvent(event.id)));
    } catch (_) {
      // silenciar erros de limpeza para não travar fluxo de exclusão
    }
  };

  const handleDeleteAgreement = async (agreement: Agreement) => {
    const confirmed = await confirmDelete({
      title: 'Excluir acordo',
      entityName: agreement.title,
      message: 'Tem certeza que deseja excluir este acordo? Esta ação apagará todas as parcelas relacionadas.',
      confirmLabel: 'Excluir acordo',
    });
    if (!confirmed) return;

    try {
      await deleteCalendarEventsForAgreement(agreement.id);
      await financialService.deleteAgreement(agreement.id);
      toast.success('Acordo excluído', 'O acordo e suas parcelas foram removidos');

      if (selectedAgreement?.id === agreement.id) {
        handleCloseDetails();
      }

      await loadData();
    } catch (err: any) {
      toast.error('Erro ao excluir acordo', err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
          </div>
          <p className="text-sm font-medium text-slate-500">Carregando dados financeiros…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Unificado */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        {/* Linha 1: Título + Badges + Ações */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-600 text-white p-2 rounded-xl shadow-sm">
                <PiggyBank className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Gestão Financeira</h1>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    {activeAgreementsCount} ativos
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-100">
                    <CheckCircle className="w-3 h-3" />
                    {concludedThisMonth} concluídos no mês
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Navegação de Mês */}
              <div className="flex items-center gap-0.5 sm:gap-1 border border-slate-200 rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5">
                <button onClick={handlePreviousMonth} className="hover:bg-slate-100 p-0.5 rounded transition" title="Mês anterior">
                  <ChevronLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" />
                </button>
                <span className="text-[10px] sm:text-xs font-medium min-w-[70px] sm:min-w-[90px] text-center capitalize text-slate-700">
                  {formatMonthYear(activeMonth)}
                </span>
                <button onClick={handleNextMonth} className="hover:bg-slate-100 p-0.5 rounded transition" title="Próximo mês">
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" />
                </button>
              </div>
              <button onClick={() => setIsIRModalOpen(true)} className="p-1.5 sm:p-2 border border-slate-200 hover:bg-slate-50 rounded-lg transition" title="Relatório IR">
                <FileSpreadsheet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" />
              </button>
              <button onClick={() => { setIsAuditModalOpen(true); setAuditAgreementId(null); loadAuditByMonth(auditFilterMonth); }} className="p-1.5 sm:p-2 border border-purple-200 hover:bg-purple-50 rounded-lg transition" title="Auditoria">
                <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600" />
              </button>
              <button onClick={handleOpenModal} className="inline-flex items-center gap-1 sm:gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition shadow-sm hover:shadow-md">
                <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                Novo Lançamento
              </button>
            </div>
          </div>
        </div>
        {/* Linha 2: Busca + Filtros */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar acordos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-2 sm:px-3 py-1.5 sm:py-2 border border-slate-200 rounded-lg text-[10px] sm:text-xs focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
            >
              <option value="all">Status</option>
              <option value="ativo">Ativos</option>
              <option value="concluido">Concluídos</option>
              <option value="cancelado">Cancelados</option>
            </select>
            <select
              value={filterPaymentStatus}
              onChange={(e) => setFilterPaymentStatus(e.target.value as any)}
              className="px-2 sm:px-3 py-1.5 sm:py-2 border border-slate-200 rounded-lg text-[10px] sm:text-xs focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
            >
              <option value="all">Pagamento</option>
              <option value="with_pending">Pendentes</option>
              <option value="fully_paid">Pagos</option>
            </select>
            {/* Toggle Grade/Lista */}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 sm:p-2 transition ${viewMode === 'grid' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                title="Visualização em grade"
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 sm:p-2 transition ${viewMode === 'list' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                title="Visualização em lista"
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* A Receber */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
          <div className="p-3 sm:p-4 pl-4 sm:pl-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">A Receber</span>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-slate-900 leading-tight tabular-nums">{formatCurrency(stats?.monthly_fees || 0)}</p>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">Previsto no mês</p>
          </div>
        </div>

        {/* Recebido */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-blue-500" />
          <div className="p-3 sm:p-4 pl-4 sm:pl-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">Recebido</span>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
              </div>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-slate-900 leading-tight tabular-nums">{formatCurrency(stats?.monthly_fees_received || 0)}</p>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">Já quitado</p>
          </div>
        </div>

        {/* Pendente */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 w-1 bg-amber-400" />
          <div className="p-3 sm:p-4 pl-4 sm:pl-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">Pendente</span>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-500" />
              </div>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-slate-900 leading-tight tabular-nums">{formatCurrency(stats?.monthly_fees_pending || 0)}</p>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">Aguardando</p>
          </div>
        </div>

        {/* Vencidas */}
        <div className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden relative ${stats?.overdue_installments ? 'border-red-200' : 'border-slate-200'}`}>
          <div className={`absolute inset-y-0 left-0 w-1 ${stats?.overdue_installments ? 'bg-red-500' : 'bg-slate-300'}`} />
          <div className="p-3 sm:p-4 pl-4 sm:pl-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">Vencidas</span>
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center ${stats?.overdue_installments ? 'bg-red-50' : 'bg-slate-50'}`}>
                <AlertCircle className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${stats?.overdue_installments ? 'text-red-500' : 'text-slate-400'}`} />
              </div>
            </div>
            <p className={`text-lg sm:text-2xl font-bold leading-tight tabular-nums ${stats?.overdue_installments ? 'text-red-600' : 'text-slate-900'}`}>{stats?.overdue_installments || 0}</p>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">{stats?.overdue_installments ? 'Em atraso' : 'Em dia'}</p>
          </div>
        </div>
      </div>

      {/* Modal de edição de acordo */}
      {isEditModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseEditModal} aria-hidden="true" />
          <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-amber-400" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Edição</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Editar Acordo</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseEditModal}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form id="edit-agreement-form" onSubmit={handleSubmitEdit} className="flex flex-col flex-1 min-h-0">
              <div className="flex flex-col p-5 gap-4 flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950">

                {editInitialLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                    <span className="ml-2 text-slate-600 dark:text-zinc-400">Carregando dados...</span>
                  </div>
                ) : (
                  <>
                    {editError && (
                      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                        {editError}
                      </div>
                    )}

                    {/* Seção 1 — Identificação */}
                    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5">
                      <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-zinc-800">
                        <div className="w-5 h-5 rounded bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                          <User className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Identificação</span>
                      </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      <div className="flex flex-col w-full">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Cliente <span className="text-red-400">*</span></p>
                        <ClientSearchSelect
                          value={editForm.clientId}
                          onChange={(clientId) => handleEditChange('clientId', clientId)}
                          label=""
                          placeholder="Selecione o cliente"
                          required
                          allowCreate={true}
                        />
                      </div>
                      <div className="flex flex-col w-full">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                          Processo / Requerimento
                          <span className="text-slate-400 dark:text-slate-500 font-normal normal-case ml-1">(opcional)</span>
                        </p>
                        <div className="relative">
                          <select
                            value={editForm.processId}
                            onChange={(e) => handleEditChange('processId', e.target.value)}
                            disabled={!editForm.clientId || loadingLinkedEntities}
                            className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 px-4 text-sm appearance-none disabled:opacity-50 disabled:cursor-not-allowed pr-10 transition"
                          >
                            <option value="">
                              {!editForm.clientId ? 'Selecione um cliente primeiro' : loadingLinkedEntities ? 'Carregando…' : clientProcesses.length === 0 && clientRequirements.length === 0 ? 'Nenhum processo/requerimento' : '— Sem vínculo —'}
                            </option>
                            {clientProcesses.length > 0 && (
                              <optgroup label="Processos">
                                {clientProcesses.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.process_code || '—'} · {practiceLabelMap[p.practice_area] ?? p.practice_area}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {clientRequirements.length > 0 && (
                              <optgroup label="Requerimentos">
                                {clientRequirements.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.protocol ? `Prot. ${r.protocol}` : 'Sem protocolo'} · {benefitLabelMap[r.benefit_type] ?? r.benefit_type}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                            {loadingLinkedEntities
                              ? <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                              : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col w-full">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Título do acordo <span className="text-red-400">*</span></p>
                        <input
                          type="text"
                          placeholder="Ex: Ação Trabalhista — Cálculo de Verbas"
                          value={editForm.title}
                          onChange={(e) => handleEditChange('title', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm transition"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Data do acordo</p>
                        <input
                          type="date"
                          value={editForm.agreementDate}
                          onChange={(e) => handleEditChange('agreementDate', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 px-4 text-sm transition"
                        />
                      </div>
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                          Objeto / Descrição
                          <span className="text-slate-400 dark:text-slate-500 font-normal normal-case ml-1">(opcional)</span>
                        </p>
                        <textarea
                          placeholder="Descreva o objeto do serviço, ex: Revisão de benefício previdenciário — auxílio-doença."
                          value={editForm.description}
                          onChange={(e) => handleEditChange('description', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-slate-400 px-4 py-3 text-sm resize-none transition"
                        />
                      </div>
                    </div>
                    </div>

                    {/* Seção 2 — Financeiro */}
                    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5">
                      <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-zinc-800">
                        <div className="w-5 h-5 rounded bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                          <DollarSign className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Financeiro</span>
                      </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4">
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Valor total <span className="text-red-400">*</span></p>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none select-none">R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={editForm.totalValue}
                            onChange={(e) => handleEditChange('totalValue', e.target.value)}
                            className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 pl-10 pr-4 text-sm font-medium tabular-nums transition"
                            required
                          />
                        </div>
                      </div>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Tipo de honorário</p>
                        <div className="flex rounded-lg border border-slate-200 dark:border-zinc-700 p-1 bg-slate-100 dark:bg-zinc-800 h-11 items-center">
                          <button
                            type="button"
                            onClick={() => handleEditChange('feeType', 'percentage')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                              editForm.feeType === 'percentage'
                                ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                          >
                            Percentual
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange('feeType', 'fixed')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                              editForm.feeType === 'fixed'
                                ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                          >
                            Valor fixo
                          </button>
                        </div>
                      </div>
                      {editForm.feeType === 'percentage' ? (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Percentual (%) <span className="text-red-400">*</span></p>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              step="0.5"
                              placeholder="0"
                              value={editForm.feePercentage}
                              onChange={(e) => handleEditChange('feePercentage', e.target.value)}
                              className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition"
                              required
                            />
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1">
                            <div className="h-11 flex items-center">
                              {editForm.totalValue && editForm.feePercentage ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  {formatCurrency(parseCurrencyToNumber(editForm.totalValue) * (Number(editForm.feePercentage || '0') / 100))}
                                </span>
                              ) : (
                                <span className="text-sm text-slate-400 dark:text-slate-500">Honorários: —</span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Honorários fixos <span className="text-red-400">*</span></p>
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 px-3 focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-400 transition">
                              <span className="text-slate-500 dark:text-slate-400 text-sm font-medium select-none">R$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={editForm.feeFixedValue}
                                onChange={(e) => handleEditChange('feeFixedValue', e.target.value)}
                                className="flex-1 bg-transparent outline-none border-none text-slate-900 dark:text-white text-sm font-medium tabular-nums"
                                required
                              />
                            </div>
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1">
                            <div className="h-11 flex items-center">
                              {editForm.feeFixedValue ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  {formatCurrency(parseCurrencyToNumber(editForm.feeFixedValue))}
                                </span>
                              ) : (
                                <span className="text-sm text-slate-400 dark:text-slate-500">Honorários: —</span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Forma de pagamento</p>
                        <div className="flex rounded-lg border border-slate-200 dark:border-zinc-700 p-1 bg-slate-100 dark:bg-zinc-800 h-11 items-center">
                          <button
                            type="button"
                            onClick={() => handleEditChange('paymentType', 'upfront')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                              editForm.paymentType === 'upfront'
                                ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                          >
                            À vista
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange('paymentType', 'installments')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                              editForm.paymentType === 'installments'
                                ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                          >
                            Parcelado
                          </button>
                        </div>
                      </div>
                      {editForm.paymentType === 'installments' && (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Nº de parcelas</p>
                            <input
                              type="number"
                              min="2"
                              max="120"
                              placeholder="2"
                              value={editForm.installmentsCount}
                              onChange={(e) => handleEditChange('installmentsCount', e.target.value)}
                              className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm transition"
                              required
                            />
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1 gap-2">
                            <div className="h-11 flex items-center gap-3">
                              {editForm.totalValue && editForm.installmentsCount ? (
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                  Parcela: <strong className="text-slate-800 dark:text-white tabular-nums">{formatCurrency(parseCurrencyToNumber(editForm.totalValue) / Number(editForm.installmentsCount))}</strong>
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={handleToggleEditCustomInstallments}
                                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                              >
                                {editForm.customInstallments.length ? 'Remover personalizadas' : 'Personalizar parcelas'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                      {editForm.customInstallments.length > 0 && (
                        <div className="md:col-span-4 border border-slate-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700">
                              <tr>
                                <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">#</th>
                                <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Vencimento</th>
                                <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Valor</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-zinc-700">
                              {editForm.customInstallments.map((item, index) => (
                                <tr key={index} className="hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition">
                                  <td className="py-2 px-4 text-slate-500 dark:text-slate-400 font-medium">{index + 1}</td>
                                  <td className="py-2 px-4">
                                    <input
                                      type="date"
                                      value={item.dueDate}
                                      onChange={(e) => handleEditCustomInstallmentChange(index, 'dueDate', e.target.value)}
                                      className="border border-slate-200 dark:border-zinc-600 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-sm"
                                    />
                                  </td>
                                  <td className="py-2 px-4">
                                    <div className="relative">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm select-none">R$</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.value}
                                        onChange={(e) => handleEditCustomInstallmentChange(index, 'value', e.target.value)}
                                        className="border border-slate-200 dark:border-zinc-600 rounded-lg pl-8 pr-2 py-1.5 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none tabular-nums"
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="bg-slate-50 dark:bg-zinc-800 py-2.5 px-4 text-sm text-slate-600 dark:text-slate-300 flex justify-between items-center border-t border-slate-100 dark:border-zinc-700">
                            <span className="font-medium">
                              Total: <span className="font-bold text-slate-900 dark:text-white tabular-nums">{
                                editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
                                  ? formatCurrency(editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0))
                                  : '—'
                              }</span>
                            </span>
                            <button
                              type="button"
                              onClick={handleEditRecalculateCustomInstallments}
                              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Recalcular
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Status do acordo</p>
                        <select
                          value={editForm.status}
                          onChange={(e) => handleEditChange('status', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 h-11 px-4 text-sm transition appearance-none"
                        >
                          <option value="ativo">Ativo</option>
                          <option value="concluido">Concluído</option>
                          <option value="cancelado">Cancelado</option>
                        </select>
                      </div>
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Notas internas <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(opcional)</span></p>
                        <textarea
                          placeholder="Observações internas sobre este lançamento…"
                          value={editForm.notes}
                          onChange={(e) => handleEditChange('notes', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-slate-400 px-4 py-3 text-sm resize-none transition"
                        />
                      </div>
                    </div>
                    </div>
                  </>
                )}
              </div>
            </form>
            {/* Footer */}
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedAgreement) return;
                    const confirmed = await confirmDelete({
                      title: 'Excluir acordo',
                      entityName: selectedAgreement.title,
                      message: 'Tem certeza que deseja excluir este acordo? Esta ação apagará todas as parcelas relacionadas.',
                      confirmLabel: 'Excluir acordo',
                    });
                    if (!confirmed) return;
                    await handleDeleteAgreement(selectedAgreement);
                    handleCloseEditModal();
                  }}
                  disabled={editLoading}
                  className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-2 transition border border-red-200 dark:border-red-900/50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    disabled={editLoading}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="edit-agreement-form"
                    disabled={editLoading}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition disabled:opacity-50 shadow-sm"
                  >
                    {editLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Salvando…
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" /> Salvar Alterações
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parcelas Vencidas */}
      {stats && stats.overdue_installments > 0 && (
        <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
          <div className="border-b border-red-100 px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-gradient-to-r from-red-50 to-rose-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-900">
                  {stats.overdue_installments} parcela{stats.overdue_installments > 1 ? 's' : ''} em atraso
                </p>
                <p className="text-xs text-red-500">Regularize para evitar inadimplência</p>
              </div>
            </div>
            <button
              onClick={() => setShowOverdueOnly(!showOverdueOnly)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-red-700 hover:bg-red-50 border border-red-200 rounded-lg text-xs font-semibold transition shadow-sm"
            >
              {showOverdueOnly ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showOverdueOnly ? 'Ocultar' : 'Ver parcelas'}
            </button>
          </div>

          {showOverdueOnly && (
            <div className="divide-y divide-slate-100">
              {allInstallments
                .filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus) && inst.due_date < serverToday)
                .sort((a, b) => a.due_date.localeCompare(b.due_date))
                .map(inst => {
                  const dueMidnight = parseLocalDate(inst.due_date);
                  const now = new Date();
                  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const daysOverdue = dueMidnight
                    ? Math.floor((todayMidnight.getTime() - dueMidnight.getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  const clientName = inst.agreement ? getClientName(inst.agreement.client_id) : 'N/A';
                  return (
                    <div
                      key={inst.id}
                      className="flex flex-col sm:flex-row sm:items-center gap-4 px-4 py-4 sm:py-3 hover:bg-slate-50 transition"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-shrink-0 w-11 h-11 bg-red-100 text-red-700 rounded-lg flex items-center justify-center font-bold text-sm">
                          {inst.installment_number}º
                        </div>
                        <div className="flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => { if (inst.agreement) handleOpenDetails(inst.agreement); }}
                            disabled={!inst.agreement}
                            className="text-sm font-semibold text-slate-900 truncate text-left hover:text-emerald-700 hover:underline transition disabled:no-underline disabled:cursor-default"
                            title="Abrir acordo"
                          >
                            {clientName}
                          </button>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <p className="text-xs text-slate-500 truncate">{inst.agreement?.title}</p>
                            <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                              {daysOverdue <= 0 ? 'vence hoje' : `${daysOverdue} dia${daysOverdue > 1 ? 's' : ''} atraso`}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                        <div className="flex justify-between sm:flex-col sm:text-right text-sm font-semibold text-slate-900">
                          <p>{formatCurrency(inst.value)}</p>
                          <p className="text-[11px] font-normal text-slate-500">
                            {(parseLocalDate(inst.due_date) ?? new Date(inst.due_date)).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            if (inst.agreement) {
                              setSelectedAgreement(inst.agreement);
                              handleOpenPaymentModal(inst);
                            }
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition shadow-sm hover:shadow w-full sm:w-auto"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Dar Baixa
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Lista de Acordos */}
      <div className="py-6 space-y-6">
        {filteredAgreements.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-12 text-center transform transition-all duration-300 hover:shadow-lg hover:scale-[1.01]">
            <div className="bg-slate-50 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 transform transition-all duration-300 hover:scale-110 hover:bg-slate-100">
              <PiggyBank className="w-12 h-12 text-slate-400 transition-colors duration-300 hover:text-slate-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-3">
              {agreements.length === 0 ? 'Nenhuma movimentação financeira' : 'Nenhum resultado encontrado'}
            </h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              {agreements.length === 0
                ? 'Comece criando um novo lançamento financeiro clicando no botão "Novo Lançamento" acima.'
                : 'Tente ajustar os filtros ou usar termos diferentes na busca para encontrar o que procura.'}
            </p>
            {agreements.length === 0 && (
              <button
                onClick={handleOpenModal}
                className="mt-8 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:scale-105"
              >
                <PlusCircle className="w-5 h-5" />
                Registrar Primeiro Lançamento
              </button>
            )}
          </div>
        ) : (
          <>
          {/* Acordos Ativos */}
          {(() => {
            const activeAgreements = filteredAgreements.filter((a: Agreement) => a.status === 'ativo');
            if (activeAgreements.length === 0) return null;
            
            return (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-1 flex items-center justify-between border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Acordos Ativos &nbsp;·&nbsp; {activeAgreements.length}
                    </h2>
                  </div>
                </div>
                <div className="p-4 sm:p-6">
                  {viewMode === 'grid' ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1.5 sm:p-2">
                    <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2">
                    {[...activeAgreements]
                      .sort((a, b) => {
                        const getNextDueTimestamp = (agreementId: string) => {
                          const related = allInstallments.filter(inst => inst.agreement_id === agreementId);
                          if (related.length === 0) return Number.POSITIVE_INFINITY;
                          const pending = related.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                          const reference = pending.length > 0 ? pending : related;
                          const ordered = [...reference].sort((x, y) => (parseLocalDate(x.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(y.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                          return parseLocalDate(ordered[0]?.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
                        };
                        return getNextDueTimestamp(a.id) - getNextDueTimestamp(b.id);
                      })
                      .map((agreement, index) => {
                    const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                    const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                    const pendingInstallments = agreementInstallments.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                    const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < serverToday);
                    const isFullyPaid = agreementInstallments.length > 0 && pendingInstallments.length === 0;
                    const progress = agreementInstallments.length ? (paidInstallments.length / agreementInstallments.length) * 100 : 0;
                    const futurePending = pendingInstallments
                      .filter(inst => inst.due_date >= today)
                      .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? 0) - (parseLocalDate(bInst.due_date)?.getTime() ?? 0));
                    const nextDueFallback = [...pendingInstallments, ...agreementInstallments]
                      .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? 0) - (parseLocalDate(bInst.due_date)?.getTime() ?? 0));
                    const nextDue = futurePending[0] ?? nextDueFallback[0];
                    const nextDueDate = nextDue ? (parseLocalDate(nextDue.due_date) ?? new Date(nextDue.due_date)) : null;
                    const nextDueLabel = nextDueDate
                      ? nextDueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                      : 'Sem parcelas';
                    const diffDays = nextDue?.due_date
                      ? (() => {
                          const raw = String(nextDue.due_date).slice(0, 10);
                          const parts = raw.split('-').map(Number);
                          if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
                          const dueMidnight = new Date(parts[0], parts[1] - 1, parts[2]);
                          const now = new Date();
                          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                          return Math.round((dueMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
                        })()
                      : null;
                    const relativeDueLabel = diffDays !== null
                      ? diffDays === 0
                        ? 'vence hoje'
                        : diffDays > 0
                          ? `em ${diffDays} dia${diffDays > 1 ? 's' : ''}`
                          : `há ${Math.abs(diffDays)} dia${Math.abs(diffDays) > 1 ? 's' : ''}`
                      : '';

                    return (
                      <div
                        key={agreement.id}
                        className={`group relative cursor-pointer bg-white aspect-auto sm:aspect-square flex flex-col rounded-xl sm:rounded-2xl border shadow-sm hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 ${
                          isFullyPaid
                            ? 'border-emerald-200 hover:border-emerald-300'
                            : overdueInstallments.length > 0
                              ? 'border-red-200 hover:border-red-300'
                              : 'border-slate-200 hover:border-slate-300'
                        }`}
                        onClick={() => handleOpenDetails(agreement)}
                      >
                        {/* Indicador de status no canto */}
                        <div
                          className={`absolute top-2 sm:top-3 right-2 sm:right-3 h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full ${
                            isFullyPaid
                              ? 'bg-emerald-500 dark:bg-orange-500'
                              : overdueInstallments.length > 0
                                ? 'bg-red-500 dark:bg-orange-500'
                                : 'bg-amber-500 dark:bg-orange-500'
                          }`}
                        />

                        {/* Conteúdo principal */}
                        <div className="flex-1 p-3 sm:p-4 flex flex-col">
                          {/* Topo: contexto + status */}
                          <div className="flex items-start justify-between gap-2 sm:gap-3">
                            <div className="min-w-0">
                              <p className="text-[9px] sm:text-[10px] font-mono text-slate-400">#{agreement.id.slice(0, 7)}</p>
                              <h3 className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                                {agreement.title}
                              </h3>
                              <p className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-slate-500 truncate">
                                {getClientName(agreement.client_id)}
                              </p>
                            </div>
                            <span
                              className={`flex-shrink-0 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-bold ${
                                isFullyPaid
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : overdueInstallments.length > 0
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {isFullyPaid
                                ? 'QUITADO'
                                : overdueInstallments.length > 0
                                  ? `${overdueInstallments.length} ATR.`
                                  : `${pendingInstallments.length} PEND.`}
                            </span>
                          </div>

                          {/* KPI central */}
                          <div className="mt-3 sm:mt-5">
                            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-slate-400">Honorários</p>
                            <p
                              className={`mt-0.5 sm:mt-1 text-lg sm:text-2xl font-bold tracking-tight ${
                                isFullyPaid
                                  ? 'text-emerald-600'
                                  : overdueInstallments.length > 0
                                    ? 'text-red-600'
                                    : 'text-amber-600'
                              }`}
                            >
                              {formatCurrency(agreement.fee_value)}
                            </p>
                          </div>

                          {/* Secundário */}
                          <div className="mt-2 sm:mt-3 text-[10px] sm:text-xs text-slate-600">
                            <span className="text-slate-400">Valor: </span>
                            <span className="font-semibold text-slate-700">{formatCurrency(agreement.total_value)}</span>
                          </div>

                          {/* Rodapé técnico */}
                          <div className="mt-auto pt-3 sm:pt-4">
                            <div className="flex items-center justify-between text-[10px] sm:text-xs">
                              <div className="flex items-center gap-1 sm:gap-2 text-slate-500 min-w-0">
                                <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400" />
                                <span className="truncate">{nextDueLabel}</span>
                                {relativeDueLabel && (
                                  <span
                                    className={`hidden xs:inline text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${
                                      diffDays !== null && diffDays < 0
                                        ? 'bg-red-100 text-red-600'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {relativeDueLabel}
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded-lg bg-slate-100 text-slate-700">
                                {agreement.payment_type === 'upfront' ? 'À vista' : `${agreement.installments_count}x`}
                              </span>
                            </div>

                            <div className="mt-2 sm:mt-3">
                              <div className="flex items-center justify-between text-[10px] sm:text-[11px]">
                                <span className="text-slate-400 dark:text-slate-500">Progresso</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{paidInstallments.length}/{agreementInstallments.length}</span>
                              </div>
                              <div className="financial-progress-track mt-1.5 sm:mt-2 h-1 sm:h-1.5 w-full bg-slate-200 dark:bg-orange-500/25 rounded-full overflow-hidden">
                                <div
                                  className={`financial-progress-fill h-full rounded-full transition-all duration-500 ${
                                    isFullyPaid
                                      ? 'bg-emerald-500 dark:bg-orange-500'
                                      : overdueInstallments.length > 0
                                        ? 'bg-red-500 dark:bg-orange-500'
                                        : 'bg-amber-500 dark:bg-orange-500'
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>

                            <div className="mt-2 sm:mt-3 flex items-center justify-between">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditModal(agreement);
                                }}
                                className="text-[10px] sm:text-xs font-semibold text-slate-500 hover:text-blue-600 transition"
                                title="Editar"
                              >
                                Editar
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAgreement(agreement);
                                }}
                                className="text-[10px] sm:text-xs font-semibold text-slate-500 hover:text-red-600 transition"
                                title="Excluir"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                    </div>
                  </div>
                  ) : (
                  /* Modo Lista */
                  <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                    {(() => {
                      const sortedAgreements = [...activeAgreements].sort((a, b) => {
                        const getNextDueTimestamp = (agreementId: string) => {
                          const related = allInstallments.filter(inst => inst.agreement_id === agreementId);
                          if (related.length === 0) return Number.POSITIVE_INFINITY;
                          const pending = related.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                          const reference = pending.length > 0 ? pending : related;
                          const ordered = [...reference].sort((x, y) => (parseLocalDate(x.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(y.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                          return parseLocalDate(ordered[0]?.due_date)?.getTime() ?? Number.POSITIVE_INFINITY;
                        };
                        return getNextDueTimestamp(a.id) - getNextDueTimestamp(b.id);
                      });

                      return (
                        <>
                          <div className="sm:hidden divide-y divide-slate-100">
                            {sortedAgreements.map((agreement) => {
                              const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                              const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                              const pendingInstallments = agreementInstallments.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                              const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < serverToday);
                              const isFullyPaid = agreementInstallments.length > 0 && pendingInstallments.length === 0;
                              const futurePending = pendingInstallments
                                .filter(inst => inst.due_date >= today)
                                .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(bInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                              const nextDueFallback = [...pendingInstallments, ...agreementInstallments]
                                .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(bInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                              const nextDue = futurePending[0] ?? nextDueFallback[0];
                              const nextDueDate = nextDue ? (parseLocalDate(nextDue.due_date) ?? new Date(nextDue.due_date)) : null;
                              const nextDueLabel = nextDueDate
                                ? nextDueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                                : '—';

                              return (
                                <button
                                  key={agreement.id}
                                  type="button"
                                  onClick={() => handleOpenDetails(agreement)}
                                  className="w-full text-left px-3 py-3 hover:bg-slate-50 transition"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-slate-900 truncate">{agreement.title}</p>
                                      <p className="mt-0.5 text-xs text-slate-500 truncate">{getClientName(agreement.client_id)}</p>
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        Venc.: <span className="font-semibold text-slate-700">{nextDueLabel}</span>
                                      </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-sm font-bold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                                      <p className={`mt-0.5 text-[11px] font-bold ${isFullyPaid ? 'text-emerald-600' : overdueInstallments.length > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                                        Hon: {formatCurrency(agreement.fee_value)}
                                      </p>
                                      <span
                                        className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                          isFullyPaid
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : overdueInstallments.length > 0
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-amber-100 text-amber-700'
                                        }`}
                                      >
                                        {isFullyPaid ? 'QUITADO' : overdueInstallments.length > 0 ? `${overdueInstallments.length} ATR.` : `${pendingInstallments.length} PEND.`}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-sm min-w-[680px]">
                              <thead>
                                <tr className="border-b-2 border-slate-100">
                                  <th className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Acordo</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Valor</th>
                                  <th className="text-right px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-emerald-600">Honorários</th>
                                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 hidden md:table-cell">Vencimento</th>
                                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 hidden lg:table-cell">Progresso</th>
                                  <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedAgreements.map((agreement) => {
                                  const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                                  const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                                  const pendingInstallments = agreementInstallments.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                                  const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < serverToday);
                                  const isFullyPaid = agreementInstallments.length > 0 && pendingInstallments.length === 0;
                                  const progress = agreementInstallments.length ? (paidInstallments.length / agreementInstallments.length) * 100 : 0;
                                  const futurePending = pendingInstallments
                                    .filter(inst => inst.due_date >= today)
                                    .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(bInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                                  const nextDueFallback = [...pendingInstallments, ...agreementInstallments]
                                    .sort((aInst, bInst) => (parseLocalDate(aInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY) - (parseLocalDate(bInst.due_date)?.getTime() ?? Number.POSITIVE_INFINITY));
                                  const nextDue = futurePending[0] ?? nextDueFallback[0];
                                  const nextDueDate = nextDue ? (parseLocalDate(nextDue.due_date) ?? new Date(nextDue.due_date)) : null;
                                  const nextDueLabel = nextDueDate
                                    ? nextDueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                                    : '—';

                                  return (
                                    <tr
                                      key={agreement.id}
                                      className={`group cursor-pointer border-b border-slate-50 hover:bg-slate-50/80 transition-colors duration-100 ${overdueInstallments.length > 0 ? 'hover:bg-red-50/40' : ''}`}
                                      onClick={() => handleOpenDetails(agreement)}
                                    >
                                      <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-3">
                                          <div className={`w-1 h-8 rounded-full flex-shrink-0 ${isFullyPaid ? 'bg-emerald-400' : overdueInstallments.length > 0 ? 'bg-red-400' : 'bg-amber-400'}`} />
                                          <div className="min-w-0">
                                            <p className="font-semibold text-slate-900 truncate max-w-[220px] group-hover:text-emerald-700 transition-colors">{agreement.title}</p>
                                            <p className="text-xs text-slate-400 truncate">{getClientName(agreement.client_id)}</p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5 text-right">
                                        <p className="font-semibold text-slate-700 tabular-nums">{formatCurrency(agreement.total_value)}</p>
                                      </td>
                                      <td className="px-4 py-3.5 text-right">
                                        <p className={`font-bold tabular-nums ${isFullyPaid ? 'text-emerald-600' : overdueInstallments.length > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                          {formatCurrency(agreement.fee_value)}
                                        </p>
                                      </td>
                                      <td className="px-4 py-3.5 text-center hidden md:table-cell">
                                        <span className="text-sm font-medium text-slate-600 tabular-nums">{nextDueLabel}</span>
                                      </td>
                                      <td className="px-4 py-3.5 hidden lg:table-cell">
                                        <div className="flex items-center gap-2.5">
                                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                              className={`financial-progress-fill h-full rounded-full transition-all duration-500 ${isFullyPaid ? 'bg-emerald-500' : overdueInstallments.length > 0 ? 'bg-red-400' : 'bg-amber-400'}`}
                                              style={{ width: `${progress}%` }}
                                            />
                                          </div>
                                          <span className="text-xs font-medium text-slate-400 w-10 text-right tabular-nums">{paidInstallments.length}/{agreementInstallments.length}</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3.5 text-center">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${
                                          isFullyPaid
                                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                            : overdueInstallments.length > 0
                                              ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                                              : 'bg-slate-100 text-slate-600'
                                        }`}>
                                          {isFullyPaid ? 'QUITADO' : overdueInstallments.length > 0 ? `${overdueInstallments.length} ATRAS.` : `${pendingInstallments.length} PEND.`}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Acordos Concluídos */}
          {(() => {
            const completedAgreements = filteredAgreements.filter((a: Agreement) => a.status === 'concluido');
            if (completedAgreements.length === 0) return null;
            
            const displayedAgreements = showAllCompleted ? completedAgreements : completedAgreements.slice(0, 3);
            const hasMore = completedAgreements.length > 3;
            
            return (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                    <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Acordos Concluídos &nbsp;·&nbsp; {completedAgreements.length}
                    </h2>
                  </div>
                  {hasMore && (
                    <button
                      onClick={() => setShowAllCompleted(!showAllCompleted)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                    >
                      {showAllCompleted ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showAllCompleted ? 'Ver menos' : `Mostrar todos (${completedAgreements.length})`}
                    </button>
                  )}
                </div>
                {viewMode === 'list' ? (
                  <div className="p-2 sm:p-6">
                    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                      <div className="sm:hidden divide-y divide-slate-100">
                        {displayedAgreements.map((agreement: Agreement) => {
                          const closedLabel = new Date(agreement.updated_at).toLocaleDateString('pt-BR');

                          return (
                            <button
                              key={agreement.id}
                              type="button"
                              onClick={() => handleOpenDetails(agreement)}
                              className="w-full text-left px-3 py-3 hover:bg-slate-50 transition"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-slate-900 truncate">{agreement.title}</p>
                                  <p className="mt-0.5 text-xs text-slate-500 truncate">{getClientName(agreement.client_id)}</p>
                                  <p className="mt-1 text-[11px] text-slate-500">Encerrado: <span className="font-semibold text-slate-700">{closedLabel}</span></p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-bold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                                  <p className="mt-0.5 text-[11px] font-bold text-blue-700">Hon: {formatCurrency(agreement.fee_value)}</p>
                                  <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                    ENCERRADO
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm min-w-[640px]">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="text-left px-4 py-3 font-semibold text-slate-600">Acordo</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-600">Valor</th>
                              <th className="text-right px-4 py-3 font-semibold text-slate-600">Honorários</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-600 hidden md:table-cell">Encerrado em</th>
                              <th className="text-center px-4 py-3 font-semibold text-slate-600">Pagamento</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {displayedAgreements.map((agreement: Agreement) => {
                              return (
                                <tr
                                  key={agreement.id}
                                  className="hover:bg-slate-50 cursor-pointer transition"
                                  onClick={() => handleOpenDetails(agreement)}
                                >
                                  <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-900 truncate max-w-[280px]">{agreement.title}</p>
                                    <p className="text-xs text-slate-400">{getClientName(agreement.client_id)}</p>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <p className="font-semibold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <p className="font-bold text-blue-700">{formatCurrency(agreement.fee_value)}</p>
                                  </td>
                                  <td className="px-4 py-3 text-center hidden md:table-cell">
                                    <p className="text-slate-600">{new Date(agreement.updated_at).toLocaleDateString('pt-BR')}</p>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                      ENCERRADO
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {displayedAgreements.map((agreement: Agreement, index: number) => {
                      return (
                        <div
                          key={agreement.id}
                          className="group px-4 py-3 hover:bg-blue-50/60 transition-all duration-200 cursor-pointer"
                          onClick={() => handleOpenDetails(agreement)}
                          style={{ animationDelay: `${index * 50}ms` }}
                        >
                          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-blue-500">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Concluído
                              <span className="text-slate-300">•</span>
                              <span className="text-slate-400">#{agreement.id.slice(0, 6)}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="text-emerald-600 font-semibold">Encerrado</span>
                              <span className="hidden sm:inline text-slate-300">•</span>
                              <span className="font-medium text-slate-400">{new Date(agreement.updated_at).toLocaleDateString('pt-BR')}</span>
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold text-blue-950 truncate" title={agreement.title}>{agreement.title}</h3>
                              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                                <span className="inline-flex items-center gap-1.5">
                                  <User className="h-3.5 w-3.5 text-slate-400" />
                                  {getClientName(agreement.client_id)}
                                </span>
                                <span className="text-slate-300">•</span>
                                <span>{agreement.payment_type === 'upfront' ? 'À vista' : `${agreement.installments_count} parcelas`}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-base font-semibold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                              <p className="text-[11px] text-blue-600 font-semibold">Honorários: {formatCurrency(agreement.fee_value)}</p>
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 text-[11px]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditModal(agreement);
                              }}
                              className="rounded-lg border border-blue-100 px-2.5 py-1 font-semibold text-blue-700 hover:border-blue-200 hover:bg-blue-50"
                            >
                              Editar
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAgreement(agreement);
                              }}
                              className="rounded-lg border border-red-100 px-2.5 py-1 font-semibold text-red-600 hover:border-red-200 hover:bg-red-50"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-blue-100 px-6 py-3 text-xs text-slate-500">
                  <span>
                    {showAllCompleted
                      ? `Exibindo todos os ${completedAgreements.length} acordos concluídos`
                      : `Mostrando ${Math.min(3, completedAgreements.length)} de ${completedAgreements.length}`}
                  </span>
                  {completedAgreements.length > 3 && (
                    <button
                      onClick={() => setShowAllCompleted(!showAllCompleted)}
                      className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 hover:text-blue-900"
                    >
                      <span>Ver todos concluídos</span>
                      {showAllCompleted ? <ChevronUp className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Acordos Cancelados */}
          {(() => {
            const canceledAgreements = agreements.filter((a: Agreement) => a.status === 'cancelado');
            if (canceledAgreements.length === 0) return null;
            
            return (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-red-100 text-red-600 p-2.5 rounded-lg">
                        <X className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-700">Acordos Cancelados</h2>
                        <p className="text-sm text-slate-500">{canceledAgreements.length} acordo{canceledAgreements.length !== 1 ? 's' : ''} neste mês</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-slate-200">
                  {canceledAgreements.map((agreement: Agreement) => {
                    const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                    const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                    
                    return (
                      <div 
                        key={agreement.id} 
                        className="group px-6 py-5 hover:bg-slate-50 transition-all duration-200 cursor-pointer opacity-60 hover:opacity-100"
                        onClick={() => handleOpenDetails(agreement)}
                      >
                        <div className="flex items-center justify-between gap-6">
                          {/* Coluna Esquerda - Info Principal */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-slate-600 text-base truncate line-through decoration-slate-400" title={agreement.title}>
                                {agreement.title}
                              </h3>
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-100 text-red-700 uppercase tracking-wide flex-shrink-0">
                                ✕ Cancelado
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              <span className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5" />
                                {getClientName(agreement.client_id)}
                              </span>
                              <span className="text-slate-300">•</span>
                              <span>{paidInstallments.length}/{agreementInstallments.length} parcelas pagas</span>
                              <span className="text-slate-300">•</span>
                              <span className="text-slate-400">#{agreement.id.slice(0, 6)}</span>
                            </div>
                          </div>
                          
                          {/* Coluna Direita - Valores e Ações */}
                          <div className="flex items-center gap-6 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-lg font-bold text-slate-500 line-through">
                                {formatCurrency(agreement.total_value)}
                              </p>
                              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                                Valor original
                              </p>
                            </div>
                            
                            {/* Botões de Ação */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAgreement(agreement);
                                }}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Excluir permanentemente"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </>
      )}
      </div>

      {/* Modal de novo lançamento */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseModal} aria-hidden="true" />
          <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-emerald-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Financeiro</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Novo Lançamento</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form id="new-agreement-form" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex flex-col p-5 gap-4 flex-1 overflow-y-auto bg-slate-50 dark:bg-zinc-950">

                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                    {formError}
                  </div>
                )}

                {/* Seção 1 — Identificação */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5">
                  <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-zinc-800">
                    <div className="w-5 h-5 rounded bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                      <User className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Identificação</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div className="flex flex-col w-full">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Cliente <span className="text-red-400">*</span></p>
                    <ClientSearchSelect
                      value={formData.clientId}
                      onChange={(clientId) => handleChange('clientId', clientId)}
                      label=""
                      placeholder="Selecione o cliente"
                      required
                      allowCreate={true}
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      Processo / Requerimento
                      <span className="text-slate-400 dark:text-slate-500 font-normal normal-case ml-1">(opcional)</span>
                    </p>
                    <div className="relative">
                      <select
                        value={formData.processId}
                        onChange={(e) => handleChange('processId', e.target.value)}
                        disabled={!formData.clientId || loadingLinkedEntities}
                        className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 px-4 text-sm appearance-none disabled:opacity-50 disabled:cursor-not-allowed pr-10 transition"
                      >
                        <option value="">
                          {!formData.clientId ? 'Selecione um cliente primeiro' : loadingLinkedEntities ? 'Carregando…' : clientProcesses.length === 0 && clientRequirements.length === 0 ? 'Nenhum processo/requerimento' : '— Sem vínculo —'}
                        </option>
                        {clientProcesses.length > 0 && (
                          <optgroup label="Processos">
                            {clientProcesses.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.process_code || '—'} · {practiceLabelMap[p.practice_area] ?? p.practice_area}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {clientRequirements.length > 0 && (
                          <optgroup label="Requerimentos">
                            {clientRequirements.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.protocol ? `Prot. ${r.protocol}` : 'Sem protocolo'} · {benefitLabelMap[r.benefit_type] ?? r.benefit_type}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        {loadingLinkedEntities
                          ? <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                          : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col w-full">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Título do lançamento <span className="text-red-400">*</span></p>
                    <input
                      type="text"
                      placeholder="Ex: Ação Trabalhista — Cálculo de Verbas"
                      value={formData.title}
                      onChange={(e) => handleChange('title', e.target.value)}
                      className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm transition"
                      required
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Data do lançamento</p>
                    <input
                      type="date"
                      value={formData.agreementDate}
                      onChange={(e) => handleChange('agreementDate', e.target.value)}
                      className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 px-4 text-sm transition"
                    />
                  </div>
                  <div className="flex flex-col w-full md:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      Objeto / Descrição
                      <span className="text-slate-400 dark:text-slate-500 font-normal normal-case ml-1">(opcional)</span>
                    </p>
                    <textarea
                      placeholder="Descreva o objeto do serviço, ex: Revisão de benefício previdenciário — auxílio-doença."
                      value={formData.description}
                      onChange={(e) => handleChange('description', e.target.value)}
                      className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-slate-400 px-4 py-3 text-sm resize-none transition"
                    />
                  </div>
                  </div>
                </div>

                {/* Seção 2 — Financeiro */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5">
                  <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-zinc-800">
                    <div className="w-5 h-5 rounded bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                      <DollarSign className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Financeiro</span>
                  </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4">
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Valor total <span className="text-red-400">*</span></p>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none select-none">R$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={formData.totalValue}
                        onChange={(e) => handleChange('totalValue', e.target.value)}
                        className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 pl-10 pr-4 text-sm font-medium tabular-nums transition"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Tipo de honorário</p>
                    <div className="flex rounded-lg border border-slate-200 dark:border-zinc-600 p-1 bg-slate-100 dark:bg-zinc-800 h-11 items-center">
                      <button
                        type="button"
                        onClick={() => handleChange('feeType', 'percentage')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.feeType === 'percentage'
                            ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        Percentual
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange('feeType', 'fixed')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.feeType === 'fixed'
                            ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        Valor fixo
                      </button>
                    </div>
                  </div>
                  {formData.feeType === 'percentage' ? (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Percentual (%) <span className="text-red-400">*</span></p>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="0.5"
                          placeholder="0"
                          value={formData.feePercentage}
                          onChange={(e) => handleChange('feePercentage', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1">
                        <div className="h-11 flex items-center">
                          {formData.totalValue && formData.feePercentage ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {formatCurrency(parseCurrencyToNumber(formData.totalValue) * (Number(formData.feePercentage || '0') / 100))}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400 dark:text-slate-500">Honorários: —</span>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Honorários fixos <span className="text-red-400">*</span></p>
                        <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 px-3 focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-400 transition">
                          <span className="text-slate-500 dark:text-slate-400 text-sm font-medium select-none">R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={formData.feeFixedValue}
                            onChange={(e) => handleChange('feeFixedValue', e.target.value)}
                            className="flex-1 bg-transparent outline-none border-none text-slate-900 dark:text-white text-sm font-medium tabular-nums"
                            required
                          />
                        </div>
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1">
                        <div className="h-11 flex items-center">
                          {formData.feeFixedValue ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {formatCurrency(parseCurrencyToNumber(formData.feeFixedValue))}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400 dark:text-slate-500">Honorários: —</span>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Forma de pagamento</p>
                    <div className="flex rounded-lg border border-slate-200 dark:border-zinc-600 p-1 bg-slate-100 dark:bg-zinc-800 h-11 items-center">
                      <button
                        type="button"
                        onClick={() => handleChange('paymentType', 'upfront')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.paymentType === 'upfront'
                            ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        À vista
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange('paymentType', 'installments')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.paymentType === 'installments'
                            ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        Parcelado
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Primeiro vencimento</p>
                    <input
                      type="date"
                      value={formData.firstDueDate}
                      onChange={(e) => handleChange('firstDueDate', e.target.value)}
                      className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 px-4 text-sm transition"
                      required={formData.paymentType === 'upfront' || !formData.customInstallments.length}
                    />
                  </div>
                  {formData.paymentType === 'installments' && (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Nº de parcelas</p>
                        <input
                          type="number"
                          min="2"
                          max="120"
                          placeholder="2"
                          value={formData.installmentsCount}
                          onChange={(e) => handleChange('installmentsCount', e.target.value)}
                          className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-slate-400 px-4 text-sm transition"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1 gap-2">
                        <div className="h-11 flex items-center gap-3">
                          {formData.totalValue && formData.installmentsCount ? (
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                              Parcela: <strong className="text-slate-800 dark:text-white tabular-nums">{formatCurrency(parseCurrencyToNumber(formData.totalValue) / Number(formData.installmentsCount))}</strong>
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                customInstallments: prev.customInstallments.length
                                  ? []
                                  : Array.from({ length: Number(prev.installmentsCount || '0') }, (_, index) => ({
                                      dueDate: index === 0 ? prev.firstDueDate : '',
                                      value: prev.totalValue && prev.installmentsCount
                                        ? (Number(prev.totalValue) / Number(prev.installmentsCount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : '',
                                    })),
                              }))
                            }
                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {formData.customInstallments.length ? 'Remover personalizadas' : 'Personalizar parcelas'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {formData.customInstallments.length > 0 && (
                    <div className="md:col-span-4 border border-slate-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-zinc-800 border-b border-slate-200 dark:border-zinc-700">
                          <tr>
                            <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">#</th>
                            <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Vencimento</th>
                            <th className="py-2.5 px-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-700">
                          {formData.customInstallments.map((item, index) => (
                            <tr key={index} className="hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition">
                              <td className="py-2 px-4 text-slate-500 dark:text-slate-400 font-medium">{index + 1}</td>
                              <td className="py-2 px-4">
                                <input
                                  type="date"
                                  value={item.dueDate}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setFormData((prev) => ({
                                      ...prev,
                                      customInstallments: prev.customInstallments.map((ci, ciIndex) =>
                                        ciIndex === index ? { ...ci, dueDate: value } : ci
                                      ),
                                    }));
                                  }}
                                  className="border border-slate-200 dark:border-zinc-600 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-sm"
                                />
                              </td>
                              <td className="py-2 px-4">
                                <input
                                  type="text"
                                  placeholder="R$ 0,00"
                                  value={item.value}
                                  onChange={(e) => {
                                    const formatted = formatCurrencyInput(e.target.value);
                                    setFormData((prev) => ({
                                      ...prev,
                                      customInstallments: prev.customInstallments.map((ci, ciIndex) =>
                                        ciIndex === index ? { ...ci, value: formatted } : ci
                                      ),
                                    }));
                                  }}
                                  className="w-full border border-slate-200 dark:border-zinc-600 rounded-lg px-3 py-1.5 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 tabular-nums"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="bg-slate-50 dark:bg-zinc-800 py-2.5 px-4 text-sm text-slate-600 dark:text-slate-300 flex justify-between items-center border-t border-slate-100 dark:border-zinc-700">
                        <span className="font-medium">
                          Total: <span className="font-bold text-slate-900 dark:text-white tabular-nums">{
                            formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0)
                              ? formatCurrency(formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0))
                              : '—'
                          }</span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              customInstallments: prev.customInstallments.map((item, index) => ({
                                dueDate:
                                  index === 0
                                    ? prev.firstDueDate
                                    : prev.customInstallments[index - 1]?.dueDate || prev.firstDueDate,
                                value:
                                  prev.totalValue && prev.installmentsCount
                                    ? (parseCurrencyToNumber(prev.totalValue) / Number(prev.installmentsCount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : item.value,
                              })),
                            }))
                          }
                          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Recalcular
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col w-full md:col-span-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Notas internas <span className="text-slate-400 dark:text-slate-500 font-normal normal-case">(opcional)</span></p>
                    <textarea
                      placeholder="Observações internas sobre este lançamento…"
                      value={formData.notes}
                      onChange={(e) => handleChange('notes', e.target.value)}
                      className="w-full rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 border border-slate-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-slate-400 px-4 py-3 text-sm resize-none transition"
                    />
                  </div>
                </div>
                </div>
              </div>
            </form>
            {/* Live Summary Preview */}
            {(() => {
              const total = parseCurrencyToNumber(formData.totalValue);
              if (total <= 0) return null;
              const feeVal = formData.feeType === 'percentage'
                ? total * (Number(formData.feePercentage || '0') / 100)
                : parseCurrencyToNumber(formData.feeFixedValue);
              const count = formData.paymentType === 'upfront' ? 1 : Math.max(Number(formData.installmentsCount || '1'), 1);
              const perInst = total / count;
              const dueDateStr = formData.firstDueDate
                ? new Date(formData.firstDueDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';
              return (
                <div className="border-t border-slate-900/10 bg-slate-900 dark:bg-zinc-950 px-5 sm:px-8 py-3">
                  <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap text-xs">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
                      <span className="w-1 h-1 rounded-full bg-emerald-400" /> Resumo
                    </span>
                    <span className="text-slate-400">Valor <strong className="text-white tabular-nums font-semibold ml-1">{formatCurrency(total)}</strong></span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-400">Honorários <strong className="text-emerald-400 tabular-nums font-semibold ml-1">{formatCurrency(feeVal)}</strong></span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-400">
                      {count === 1 ? 'À vista' : `${count}× de`} <strong className="text-white tabular-nums font-semibold ml-1">{formatCurrency(perInst)}</strong>
                    </span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-400">{count === 1 ? 'Vence' : '1ª parcela'} <strong className="text-white font-semibold ml-1">{dueDateStr}</strong></span>
                  </div>
                </div>
              );
            })()}
            {/* Footer */}
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-slate-400 hidden sm:block">Campos com <span className="text-red-400">*</span> são obrigatórios</p>
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    disabled={formLoading}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="new-agreement-form"
                    disabled={formLoading}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition disabled:opacity-50 shadow-sm"
                  >
                    {formLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-4 h-4" /> Criar Acordo
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Acordo */}
      {isDetailsModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center px-3 sm:px-6 py-4 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseDetails} aria-hidden="true" />
          <div className="relative w-full max-w-5xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-slate-800" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Detalhes</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white leading-tight">{selectedAgreement.title}</h2>
                <button
                  type="button"
                  onClick={() => { handleCloseDetails(); navigateToClient(selectedAgreement.client_id); }}
                  className="mt-1 inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition group"
                  title="Abrir ficha do cliente"
                >
                  <User className="w-3.5 h-3.5" />
                  {getClientName(selectedAgreement.client_id)}
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleCloseDetails}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col p-6 gap-6 flex-1 min-h-0 overflow-y-auto touch-pan-y overscroll-contain [-webkit-overflow-scrolling:touch] bg-white dark:bg-zinc-900">

              {/* Grid de 3 colunas */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Coluna 1 - Resumo e Ações */}
                <div className="lg:col-span-1 flex flex-col gap-6">
                  {/* Resumo do Acordo */}
                  <div className="border border-slate-200 dark:border-zinc-700 rounded-xl p-4 sm:p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-zinc-700 flex items-center justify-center">
                        <FileText className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                      </div>
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Resumo do Acordo</h2>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-zinc-700/50 text-sm">
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Valor Total</span>
                        <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{formatCurrency(agreementSummary?.totalValue || selectedAgreement.total_value)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Honorários ({selectedAgreement.fee_type === 'percentage' ? `${selectedAgreement.fee_percentage}%` : 'Fixo'})</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(agreementSummary?.feeValue || selectedAgreement.fee_value)}</span>
                      </div>
                      {selectedAgreement.fee_type === 'percentage' && (
                        <div className="flex justify-between items-center py-2.5">
                          <span className="text-slate-500 dark:text-slate-400">Valor Líquido Cliente</span>
                          <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{formatCurrency(agreementSummary?.netValue || selectedAgreement.net_value)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Data do Acordo</span>
                        <span className="font-semibold text-slate-900 dark:text-white">{new Date(selectedAgreement.agreement_date).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Forma de Pagamento</span>
                        <span className="font-semibold text-slate-900 dark:text-white">{selectedAgreement.payment_type === 'upfront' ? 'À Vista' : 'Parcelado'}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Parcelas</span>
                        <span className="font-semibold text-slate-900 dark:text-white">{(agreementSummary?.installmentsCount || selectedAgreement.installments_count)}x de {formatCurrency(agreementSummary?.installmentValue || selectedAgreement.installment_value)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5">
                        <span className="text-slate-500 dark:text-slate-400">Status</span>
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                          selectedAgreement.status === 'ativo' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                          selectedAgreement.status === 'concluido' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                          selectedAgreement.status === 'cancelado' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                          'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {selectedAgreement.status === 'ativo' ? 'Em Andamento' : selectedAgreement.status.charAt(0).toUpperCase() + selectedAgreement.status.slice(1)}
                        </span>
                      </div>
                    </div>
                    {selectedAgreement.description && (
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-zinc-700">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Descrição</span>
                        <p className="text-sm text-slate-700 dark:text-slate-200 mt-1 leading-relaxed">{selectedAgreement.description}</p>
                      </div>
                    )}
                  </div>

                  {/* Ações Rápidas */}
                  <div className="border border-slate-200 dark:border-zinc-700 rounded-xl p-4 sm:p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-zinc-700 flex items-center justify-center">
                        <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                      </div>
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ações</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleGenerateReceipt(selectedAgreement)}
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-slate-300 transition border border-slate-200 dark:border-zinc-600"
                      >
                        <Receipt className="w-3.5 h-3.5 text-slate-500" />Gerar Recibo
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(selectedAgreement)}
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 transition border border-amber-200 dark:border-amber-700/50"
                      >
                        <Edit className="w-3.5 h-3.5" />Editar Acordo
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenAuditModal(selectedAgreement.id)}
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/30 text-purple-700 dark:text-purple-400 transition border border-purple-200 dark:border-purple-700/50"
                      >
                        <History className="w-3.5 h-3.5" />Auditoria
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAgreement(selectedAgreement)}
                        className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 transition border border-red-200 dark:border-red-700/50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />Excluir
                      </button>
                    </div>
                  </div>

                  {/* Cliente — acesso rápido */}
                  {(() => {
                    const detailClient = clients.find(c => c.id === selectedAgreement.client_id);
                    if (!detailClient) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => { handleCloseDetails(); navigateToClient(selectedAgreement.client_id); }}
                        className="group w-full text-left border border-blue-100 dark:border-blue-700/40 rounded-xl p-4 bg-blue-50/60 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                            <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <h2 className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 flex-1">Cliente</h2>
                          <ChevronRight className="w-3.5 h-3.5 text-blue-400 opacity-0 group-hover:opacity-100 transition" />
                        </div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{getClientName(selectedAgreement.client_id)}</p>
                        {(detailClient as any).cpf && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">CPF: {(detailClient as any).cpf}</p>}
                        {(detailClient as any).phone && <p className="text-xs text-slate-500 dark:text-slate-400">{(detailClient as any).phone}</p>}
                        <p className="text-xs text-blue-500 dark:text-blue-400 mt-1.5 font-medium">Abrir ficha do cliente →</p>
                      </button>
                    );
                  })()}

                  {/* Notas Internas */}
                  {selectedAgreement.notes && (
                    <div className="border border-amber-200 dark:border-amber-700/50 rounded-xl p-4 sm:p-5 bg-amber-50 dark:bg-amber-900/10">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Notas Internas</h2>
                      </div>
                      <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">{selectedAgreement.notes}</p>
                    </div>
                  )}
                </div>

                {/* Coluna 2 - Parcelas */}
                <div className="lg:col-span-2 lg:h-full min-h-0">
                  <div className="border border-slate-200 dark:border-zinc-700 rounded-xl p-4 sm:p-5 lg:h-full flex flex-col min-h-0 bg-white dark:bg-zinc-800/60">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-zinc-700 flex items-center justify-center">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        </div>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Parcelas e Pagamentos</h2>
                      </div>
                      {installments.length > 0 && installments.every(inst => inst.status === 'pago') && (
                        <button
                          onClick={() => handleGenerateFullReceipt(selectedAgreement)}
                          className="flex items-center gap-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 shadow hover:bg-emerald-700 transition"
                        >
                          <FileText className="w-3.5 h-3.5" /> Recibo total
                        </button>
                      )}
                    </div>
                    
                    {loadingInstallments ? (
                      <div className="flex items-center justify-center py-8 flex-grow">
                        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                      </div>
                    ) : installments.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400 flex-grow">
                        <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>Nenhuma parcela encontrada</p>
                      </div>
                    ) : (
                      <div className="space-y-2 pr-1 lg:flex-grow lg:overflow-y-auto">
                        {/* Parcelas pagas — colapsáveis */}
                        {(() => {
                          const paid = installments.filter(i => i.status === 'pago');
                          const unpaid = installments.filter(i => i.status !== 'pago');
                          if (paid.length === 0) return null;
                          return (
                            <div className="rounded-xl border border-emerald-200 dark:border-emerald-700/40 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setShowPaidInstallments(v => !v)}
                                className="w-full flex items-center justify-between px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition"
                              >
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                    {paid.length} parcela{paid.length > 1 ? 's' : ''} paga{paid.length > 1 ? 's' : ''} · {formatCurrency(paid.reduce((s, i) => s + (i.paid_value ?? i.value), 0))} recebido
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                  {showPaidInstallments ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  {showPaidInstallments ? 'Ocultar' : 'Expandir'}
                                </div>
                              </button>
                              {showPaidInstallments && (
                                <div className="divide-y divide-emerald-100 dark:divide-emerald-800/30">
                                  {paid.map(inst => (
                                    <div key={inst.id} className="px-4 py-2.5 flex items-center justify-between bg-white dark:bg-zinc-900/50 text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold text-[10px]">{inst.installment_number}</span>
                                        <div>
                                          <p className="font-semibold text-slate-700 dark:text-slate-300">Parcela {inst.installment_number}/{selectedAgreement.installments_count}</p>
                                          <p className="text-slate-400 dark:text-slate-500">
                                            Recebido em {inst.payment_date ? new Date(inst.payment_date).toLocaleDateString('pt-BR') : '—'} · {inst.payment_method ? { pix: 'PIX', transferencia: 'Transf.', dinheiro: 'Dinheiro', cartao_credito: 'Crédito', cartao_debito: 'Débito', cheque: 'Cheque' }[inst.payment_method] ?? inst.payment_method : '—'}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(inst.paid_value ?? inst.value)}</p>
                                        <button
                                          onClick={() => handleGenerateReceipt(selectedAgreement, inst)}
                                          className="text-[10px] text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition mt-0.5"
                                        >
                                          Recibo
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {installments.filter(i => i.status !== 'pago').length === 0 && <div />}
                        {installments.filter(i => i.status !== 'pago').map((installment, index) => {
                          const _ = index; // suppress unused var
                          const isOverdue = pendingStatuses.includes(installment.status as InstallmentStatus) && installment.due_date < serverToday;
                          const isPaid = installment.status === 'pago';
                          const dueMidnight = parseLocalDate(installment.due_date);
                          const now = new Date();
                          const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                          const daysOverdue = isOverdue && dueMidnight
                            ? Math.floor((todayMidnight.getTime() - dueMidnight.getTime()) / (1000 * 60 * 60 * 24))
                            : 0;
                          const paymentMethodLabels: Record<string, string> = {
                            dinheiro: 'Dinheiro',
                            pix: 'PIX',
                            transferencia: 'Transferência',
                            cheque: 'Cheque',
                            cartao_credito: 'Cartão de Crédito',
                            cartao_debito: 'Cartão de Débito',
                          };
                          const installmentsCount = selectedAgreement.installments_count || 1;
                          const netAgreementValue =
                            selectedAgreement.net_value ??
                            (selectedAgreement.total_value - selectedAgreement.fee_value);
                          const clientInstallmentValue = netAgreementValue / installmentsCount;
                          
                          const dueDate = dueMidnight ?? new Date(installment.due_date);
                          const diffMs = dueDate.getTime() - todayMidnight.getTime();
                          const daysUntilDue = diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
                          const pendingMessage =
                            daysUntilDue === 0
                              ? 'Vence hoje'
                              : daysUntilDue === 1
                                ? 'Vence amanhã'
                                : `Vence em ${daysUntilDue} dias`;

                          const theme = isPaid
                            ? {
                                border: 'border-emerald-200 dark:border-emerald-500/40',
                                bg: 'from-emerald-50/80 via-white to-white dark:from-emerald-500/10 dark:via-zinc-900 dark:to-zinc-900',
                                badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-100',
                                pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
                                number: 'bg-emerald-500',
                              }
                            : isOverdue
                              ? {
                                  border: 'border-rose-200 dark:border-[#fb7185]/40',
                                  bg: 'from-rose-50/80 via-white to-white dark:from-[#3f0b1d] dark:via-[#1a090f] dark:to-[#09090b]',
                                  badge: 'bg-rose-100 text-rose-800 dark:bg-[#4c0e1f] dark:text-[#ffe4e6]',
                                  pill: 'bg-rose-500/15 text-rose-700 dark:bg-[#4c0e1f]/80 dark:text-[#fecdd3]',
                                  number: 'bg-rose-500 dark:bg-[#fb7185]',
                                }
                              : {
                                  border: 'border-slate-200 dark:border-slate-600',
                                  bg: 'from-slate-50/70 via-white to-white dark:from-slate-500/10 dark:via-zinc-900 dark:to-zinc-900',
                                  badge: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
                                  pill: 'bg-slate-500/10 text-slate-700 dark:text-slate-200',
                                  number: 'bg-slate-500',
                                };

                          const statusBadge = isPaid
                            ? 'Pagamento concluído'
                            : isOverdue
                              ? 'Em atraso'
                              : 'Aguardando';

                          const statusDescription = isPaid
                            ? `Recebido em ${new Date(installment.payment_date!).toLocaleDateString('pt-BR')}`
                            : isOverdue
                              ? `Vencida há ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'}`
                              : pendingMessage;

                          return (
                            <React.Fragment key={installment.id}>
                              <div
                                className={`rounded-xl border ${theme.border} bg-gradient-to-br ${theme.bg} shadow-sm transition-all duration-200 hover:shadow-md`}
                              >
                              {/* Header da parcela */}
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/70 dark:border-white/10 px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-white text-xs font-bold ${theme.number}`}>
                                    {installment.installment_number}
                                  </span>
                                  <div>
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                      Parcela {installment.installment_number}/{selectedAgreement.installments_count}
                                    </p>
                                    <span
                                      className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${theme.pill}`}
                                    >
                                      {statusDescription}
                                    </span>
                                  </div>
                                </div>
                                <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${theme.badge}`}>
                                  {statusBadge}
                                </span>
                              </div>

                              {/* Detalhes da parcela */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-3 py-3 text-xs">
                                {isPaid ? (
                                  <>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Recebido em</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {new Date(installment.payment_date!).toLocaleDateString('pt-BR')}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Valor recebido</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {formatCurrency(installment.paid_value || installment.value)}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Método</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {installment.payment_method ? paymentMethodLabels[installment.payment_method] : 'Não informado'}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Vencimento</span>
                                      {(() => {
                                        const pay = installment.payment_date ? (parseLocalDate(installment.payment_date) ?? new Date(installment.payment_date)) : null;
                                        const late = pay ? pay.getTime() > dueDate.getTime() : false;
                                        return (
                                          <p className={`text-xs font-semibold ${late ? 'text-rose-600 dark:text-rose-200' : 'text-emerald-600 dark:text-emerald-200'}`}>
                                            {late ? 'Pago com atraso' : 'Pago em dia'}
                                          </p>
                                        );
                                      })()}
                                    </div>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Honorários</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {formatCurrency(selectedAgreement.fee_type === 'fixed' ? selectedAgreement.fee_value : selectedAgreement.fee_value / selectedAgreement.installments_count)}
                                      </p>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Vencimento</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {dueDate.toLocaleDateString('pt-BR')}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Valor</span>
                                      <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                        {formatCurrency(selectedAgreement.total_value / installmentsCount)}
                                      </p>
                                    </div>
                                    {selectedAgreement.fee_type === 'percentage' && (
                                      <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Valor cliente</span>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                          {formatCurrency(clientInstallmentValue)}
                                        </p>
                                      </div>
                                    )}
                                    {selectedAgreement.fee_type === 'percentage' && (
                                      <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-2 dark:bg-white/5 dark:border-white/10">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Honorários</span>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-white">
                                          {formatCurrency(selectedAgreement.fee_value / installmentsCount)}
                                        </p>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* Footer da parcela */}
                              {isPaid ? (
                                <div className="px-3 pb-3">
                                  <div className="mt-1 flex justify-end">
                                    <button
                                      onClick={() => handleGenerateReceipt(selectedAgreement, installment)}
                                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-white/90 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-white dark:border-emerald-500/40 dark:bg-zinc-900/60 dark:text-emerald-200"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      Gerar recibo
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="px-3 pb-3">
                                  <div className="mt-1 flex flex-col gap-1.5 text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                                    <span>
                                      Registre o pagamento assim que receber para manter o financeiro atualizado.
                                    </span>
                                    <button
                                      onClick={() => handleOpenPaymentModal(installment)}
                                      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition ${
                                        isOverdue ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'
                                      }`}
                                    >
                                      <CheckCircle className="w-3.5 h-3.5" />
                                      Dar baixa
                                    </button>
                                  </div>
                                </div>
                              )}
                              </div>
                              {index < installments.filter(i => i.status !== 'pago').length - 1 && (
                                <div className="hidden dark:block h-px bg-gradient-to-r from-transparent via-white/15 to-transparent mx-2 rounded-full" />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center border-t border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900 px-5 sm:px-8 py-3.5">
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Criado em {new Date(selectedAgreement.created_at).toLocaleDateString('pt-BR')}
              </span>
              <button
                onClick={handleCloseDetails}
                className="px-4 py-2 border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700 text-slate-600 dark:text-slate-300 text-sm font-medium rounded-lg transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Baixa de Pagamento */}
      {isPaymentModalOpen && selectedInstallment && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleClosePaymentModal} aria-hidden="true" />
          <div className="relative w-full max-w-3xl max-h-[85vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-emerald-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Pagamento</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Registrar Pagamento</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Parcela {selectedInstallment.installment_number}/{selectedAgreement?.installments_count} - Vencimento {(parseLocalDate(selectedInstallment.due_date) ?? new Date(selectedInstallment.due_date)).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePaymentModal}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Conteúdo rolável */}
            <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-zinc-900">

              <div className="space-y-5">
                {/* Resumo da Parcela */}
                <div className="rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5">
                      Parcela {selectedInstallment.installment_number}{selectedAgreement?.installments_count ? `/${selectedAgreement.installments_count}` : ''}
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{formatCurrency(selectedInstallment.value)}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Vencimento: {(parseLocalDate(selectedInstallment.due_date) ?? new Date(selectedInstallment.due_date)).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                </div>

                {/* Data e Valor */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">Data do Pagamento</label>
                    <div className="relative">
                      <CalendarIcon className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 w-4 h-4 top-3" />
                      <input
                        type="date"
                        value={paymentData.paymentDate}
                        onChange={(e) => setPaymentData(prev => ({ ...prev, paymentDate: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-slate-900 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">Valor Pago</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 text-sm font-medium">R$</span>
                      <input
                        type="text"
                        value={paymentData.paidValue}
                        onChange={(e) => {
                          const formatted = formatPaidValueInput(e.target.value);
                          setPaymentData(prev => ({ ...prev, paidValue: formatted }));
                          if (selectedInstallment) {
                            const parsed = parsePaidValue(formatted);
                            if (parsed > selectedInstallment.value * 1.001) {
                              setOverpaymentWarning({ diff: parsed - selectedInstallment.value, scheduled: selectedInstallment.value });
                            } else {
                              setOverpaymentWarning(null);
                            }
                          }
                        }}
                        className={`w-full rounded-lg border py-2.5 pl-9 pr-3 bg-white text-slate-900 text-sm font-semibold focus:ring-1 transition tabular-nums dark:bg-zinc-800 dark:text-gray-100 ${overpaymentWarning ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500 dark:border-amber-500' : 'border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 dark:border-zinc-700'}`}
                        placeholder="0,00"
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>

                {/* Aviso de sobrepagamento */}
                {overpaymentWarning && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50 px-4 py-3 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 dark:text-amber-200">
                      <p className="font-semibold mb-0.5">Valor acima do agendado</p>
                      <p>Parcela: <span className="font-semibold tabular-nums">{formatCurrency(overpaymentWarning.scheduled)}</span> · Excedente: <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">+{formatCurrency(overpaymentWarning.diff)}</span></p>
                      <p className="mt-0.5 text-amber-600 dark:text-amber-400">O valor <strong>real pago</strong> será registrado integralmente.</p>
                    </div>
                  </div>
                )}

                {/* Método de Pagamento */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">Método de Pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'pix', icon: Smartphone, label: 'PIX' },
                      { key: 'transferencia', icon: Building, label: 'Transferência' },
                      { key: 'dinheiro', icon: Banknote, label: 'Dinheiro' },
                      { key: 'cartao_credito', icon: CreditCard, label: 'Cartão Créd.' },
                      { key: 'cartao_debito', icon: CreditCard, label: 'Cartão Déb.' },
                      { key: 'cheque', icon: FileText, label: 'Cheque' },
                    ].map(({ key, icon: Icon, label }) => {
                      const active = paymentData.paymentMethod === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: key as typeof prev.paymentMethod }))}
                          aria-pressed={active}
                          className={`flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-sm font-semibold transition-all
                            ${active
                              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 scale-[1.02] dark:bg-emerald-500'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'}
                          `}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Observações */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">Observações (opcional)</label>
                  <textarea
                    value={paymentData.notes}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white text-slate-900 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-100 px-3 py-2 resize-none transition"
                    rows={2}
                    placeholder="Adicione uma anotação sobre o pagamento..."
                  />
                </div>
              </div>
            </div>

            {/* Footer fixo */}
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClosePaymentModal}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPayment}
                  disabled={!paymentData.paymentDate || !paymentData.paymentMethod || !paymentData.paidValue || parsePaidValue(paymentData.paidValue) <= 0}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  Confirmar Pagamento
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Relatório Mensal para IR */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsReportModalOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-blue-600" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Relatório</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Relatório Mensal para IR</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Receitas de honorários advocatícios</p>
              </div>
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {/* Seletor de Mês */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">Selecione o Mês</label>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className="border-2 border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Resumo do Mês */}
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-xs text-blue-600 uppercase font-semibold mb-1">Honorários Recebidos</p>
                  <p className="text-2xl font-bold text-blue-700">{formatCurrency(stats?.monthly_fees_received || 0)}</p>
                  <p className="text-xs text-blue-600 mt-1">Receita tributável</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <p className="text-xs text-emerald-600 uppercase font-semibold mb-1">Parcelas Pagas</p>
                  <p className="text-2xl font-bold text-emerald-700">{stats?.paid_installments || 0}</p>
                  <p className="text-xs text-emerald-600 mt-1">No período</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-xs text-amber-600 uppercase font-semibold mb-1">A Receber</p>
                  <p className="text-2xl font-bold text-amber-700">{formatCurrency(stats?.monthly_fees_pending || 0)}</p>
                  <p className="text-xs text-amber-600 mt-1">Pendente</p>
                </div>
              </div>

              {/* Informações para IR */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                <h4 className="text-sm font-semibold text-slate-900 mb-4">Informações para Declaração</h4>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Código da Receita:</span>
                    <span className="font-semibold text-slate-900">1406 - Honorários Advocatícios</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Tipo de Rendimento:</span>
                    <span className="font-semibold text-slate-900">Trabalho Não Assalariado</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Regime de Tributação:</span>
                    <span className="font-semibold text-slate-900">Carnê-Leão</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-3">
                    <span className="text-slate-600 font-semibold">Valor a Declarar:</span>
                    <span className="font-bold text-blue-700 text-lg">{formatCurrency(stats?.monthly_fees_received || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Detalhamento */}
              {(() => {
                const [ry, rm] = reportMonth.split('-').map(Number);
                const monthStart = new Date(ry, rm - 1, 1);
                const monthEnd = new Date(ry, rm, 0, 23, 59, 59, 999);
                const monthPaidInsts = allInstallments.filter(inst => {
                  if (inst.status !== 'pago') return false;
                  const d = inst.payment_date ? new Date(inst.payment_date + 'T12:00:00') : null;
                  return d && d >= monthStart && d <= monthEnd;
                });
                // Agrupar por acordo
                const byAgreement = new Map<string, { agreement: Agreement; insts: typeof monthPaidInsts }>();
                monthPaidInsts.forEach(inst => {
                  const ag = agreements.find(a => a.id === inst.agreement_id);
                  if (!ag) return;
                  if (!byAgreement.has(ag.id)) byAgreement.set(ag.id, { agreement: ag, insts: [] });
                  byAgreement.get(ag.id)!.insts.push(inst);
                });
                const rows = Array.from(byAgreement.values());
                return (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 mb-3">Detalhamento de Recebimentos</h4>
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                          <tr>
                            <th className="py-3 px-4 text-left">Cliente</th>
                            <th className="py-3 px-4 text-left">Acordo</th>
                            <th className="py-3 px-4 text-center">Parcelas</th>
                            <th className="py-3 px-4 text-right">Valor Recebido</th>
                            <th className="py-3 px-4 text-right">Honorários</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? (
                            <tr className="border-t border-slate-200">
                              <td colSpan={5} className="py-8 text-center text-slate-500">
                                <FileSpreadsheet className="w-10 h-10 mx-auto mb-2 opacity-40" />
                                <p>Nenhum recebimento neste mês</p>
                              </td>
                            </tr>
                          ) : rows.map(({ agreement: ag, insts }) => {
                            const totalPaid = insts.reduce((s, i) => s + (i.paid_value || i.value), 0);
                            const feePerInstallment = ag.fee_value / (ag.installments_count || 1);
                            const totalFee = feePerInstallment * insts.length;
                            return (
                              <tr key={ag.id} className="border-t border-slate-200 hover:bg-slate-50">
                                <td className="py-2.5 px-4 font-medium text-slate-900">{getClientName(ag.client_id)}</td>
                                <td className="py-2.5 px-4 text-slate-600 max-w-[180px] truncate">{ag.title}</td>
                                <td className="py-2.5 px-4 text-center text-slate-700">{insts.length}</td>
                                <td className="py-2.5 px-4 text-right font-semibold text-slate-900">{formatCurrency(totalPaid)}</td>
                                <td className="py-2.5 px-4 text-right font-semibold text-emerald-600">{formatCurrency(totalFee)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {rows.length > 0 && (() => {
                          const grandTotal = rows.reduce((s, r) => s + r.insts.reduce((ss, i) => ss + (i.paid_value || i.value), 0), 0);
                          const grandFee = rows.reduce((s, r) => {
                            const ag = r.agreement;
                            const feePerInst = ag.fee_value / (ag.installments_count || 1);
                            return s + feePerInst * r.insts.length;
                          }, 0);
                          return (
                            <tfoot>
                              <tr className="bg-slate-100 font-semibold border-t-2 border-slate-300">
                                <td colSpan={3} className="py-3 px-4 text-right text-slate-700 uppercase text-xs tracking-wide">Total</td>
                                <td className="py-3 px-4 text-right text-slate-900">{formatCurrency(grandTotal)}</td>
                                <td className="py-3 px-4 text-right text-emerald-700">{formatCurrency(grandFee)}</td>
                              </tr>
                            </tfoot>
                          );
                        })()}
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Observações Importantes */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Observações Importantes</h4>
                <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside">
                  <li>Os valores apresentados referem-se aos honorários efetivamente recebidos no período</li>
                  <li>Consulte seu contador para orientações específicas sobre deduções permitidas</li>
                  <li>Mantenha os comprovantes de pagamento arquivados por no mínimo 5 anos</li>
                  <li>Este relatório é apenas informativo e não substitui a orientação profissional</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleExportMonthlyReport}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition shadow-sm"
              >
                <Download className="w-4 h-4" />
                Exportar PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Seleção de Ano para Relatório IR */}
      {isIRModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setIsIRModalOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-indigo-600" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Relatório</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Imposto de Renda
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Selecione o ano para gerar o relatório</p>
              </div>
              <button
                type="button"
                onClick={() => setIsIRModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6 bg-white dark:bg-zinc-900">
              {availableYears.length === 0 ? (
                <div className="text-center py-8">
                  <FileSpreadsheet className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-600 dark:text-slate-300 font-medium mb-2">Nenhum pagamento registrado</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Registre pagamentos de honorários para gerar relatórios de IR
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                    Anos disponíveis com pagamentos registrados:
                  </p>
                  {availableYears.map((year) => {
                    const yearPayments = allInstallments.filter(inst => 
                      inst.status === 'pago' && 
                      inst.payment_date && 
                      new Date(inst.payment_date).getFullYear() === year
                    );
                    const yearTotal = yearPayments.reduce((sum, inst) => {
                      if (!inst.agreement) return sum;
                      return sum + (inst.agreement.fee_value / inst.agreement.installments_count);
                    }, 0);

                    return (
                      <button
                        key={year}
                        onClick={() => {
                          handleGenerateIRReport(year);
                          setIsIRModalOpen(false);
                        }}
                        className="w-full border border-slate-200 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 rounded-xl p-4 transition text-left group shadow-sm hover:shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-indigo-600 group-hover:bg-indigo-700 text-white rounded-xl w-12 h-12 flex items-center justify-center font-bold text-sm transition">
                              {year}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-400">Exercício {year}</p>
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                {yearPayments.length} pagamento{yearPayments.length > 1 ? 's' : ''} registrado{yearPayments.length > 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(yearTotal)}</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">Honorários</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900">
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                💡 O relatório incluirá todos os honorários recebidos no ano selecionado
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Auditoria de Pagamentos */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseAuditModal} aria-hidden="true" />
          <div className="relative w-full max-w-5xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-1 w-full bg-purple-600" />
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl p-2.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Auditoria</p>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Histórico de Baixas</h2>
                  {auditAgreementId && (() => {
                    const ag = agreements.find(a => a.id === auditAgreementId);
                    return ag ? (
                      <p className="text-xs text-orange-600 dark:text-orange-400 font-medium mt-0.5">
                        {ag.title} — {getClientName(ag.client_id)}
                      </p>
                    ) : null;
                  })()}
                  {!auditAgreementId && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Todos os acordos</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {/* Filtro de Mês */}
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-slate-500" />
                  <input
                    type="month"
                    value={auditFilterMonth}
                    onChange={(e) => {
                      setAuditFilterMonth(e.target.value);
                      loadAuditByMonth(e.target.value);
                    }}
                    className="border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-zinc-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <button 
                  type="button"
                  onClick={handleCloseAuditModal} 
                  className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
                  aria-label="Fechar modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Resumo do Mês */}
            <div className="px-6 py-4 bg-slate-50/80 dark:bg-zinc-900/60 border-b border-slate-200/80 dark:border-zinc-800/80 backdrop-blur-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-3 border border-slate-200 dark:border-zinc-800 shadow-sm">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-medium mb-1">Período</p>
                  <p className="text-base font-bold text-slate-900 dark:text-white">
                    {new Date(auditFilterMonth + '-01').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-3 border border-slate-200 dark:border-zinc-800 shadow-sm">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-medium mb-1">Baixas</p>
                  <p className="text-base font-bold text-purple-600">{auditTotals.count}</p>
                </div>
                <div className="bg-white dark:bg-zinc-900 rounded-xl p-3 border border-blue-200 dark:border-blue-700 shadow-sm">
                  <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-medium mb-1">Total Recebido</p>
                  <p className="text-base font-bold text-blue-600">{formatCurrency(auditTotals.total)}</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 via-emerald-50 to-green-50 dark:from-emerald-900/40 dark:via-emerald-900/30 dark:to-green-900/40 rounded-xl p-3 border border-emerald-300 dark:border-emerald-700 shadow-sm">
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-bold mb-1">Honorários</p>
                  <p className="text-base font-bold text-emerald-600">{formatCurrency(auditTotals.totalHonorarios)}</p>
                </div>
              </div>
            </div>

            {/* Conteúdo - Lista de Baixas */}
            <div className="flex-1 overflow-y-auto px-6 py-4 bg-white dark:bg-zinc-900">
              {loadingAudit ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12">
                  <History className="w-16 h-16 text-slate-300 dark:text-zinc-600 mx-auto mb-4" />
                  <p className="text-slate-600 dark:text-slate-400 font-medium mb-2">Nenhuma baixa neste período</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500">
                    Selecione outro mês para ver os registros
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Tabela de Baixas */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-zinc-700 bg-slate-50/80 dark:bg-zinc-900/80">
                          <th className="text-left py-3 px-3 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase">Data</th>
                          <th className="text-left py-3 px-3 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase">Cliente</th>
                          <th className="text-left py-3 px-3 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase hidden lg:table-cell">Acordo</th>
                          <th className="text-center py-3 px-2 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase">Parc.</th>
                          <th className="text-left py-3 px-2 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase hidden sm:table-cell">Método</th>
                          <th className="text-right py-3 px-3 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase">Valor</th>
                          <th className="text-right py-3 px-3 text-[11px] font-semibold tracking-wide text-emerald-700 dark:text-emerald-400 uppercase">Honorário</th>
                          <th className="text-left py-3 px-3 text-[11px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 uppercase">Usuário / Horário</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => {
                          const actionInfo = getAuditActionLabel(log.action);
                          const agreementInfo = getAuditAgreementInfo(log.agreement_id);
                          const paymentDate = log.new_value?.payment_date 
                            ? new Date(log.new_value.payment_date + 'T12:00:00').toLocaleDateString('pt-BR')
                            : new Date(log.created_at).toLocaleDateString('pt-BR');
                          const paymentMethod = log.new_value?.payment_method;
                          const methodLabel = paymentMethod === 'pix' ? 'PIX'
                            : paymentMethod === 'transferencia' ? 'Transf.'
                            : paymentMethod === 'dinheiro' ? 'Dinheiro'
                            : paymentMethod === 'cartao_credito' ? 'Cartão Créd.'
                            : paymentMethod === 'cartao_debito' ? 'Cartão Déb.'
                            : paymentMethod === 'cheque' ? 'Cheque'
                            : 'N/I';
                          const paidValue = resolveAuditPaidValue(log);
                          // Extrair número da parcela da descrição
                          const parcelaMatch = log.description.match(/parcela (\d+)/i);
                          const parcelaNum = parcelaMatch ? parcelaMatch[1] : '-';

                          const logDateTime = new Date(log.created_at);
                          const userLabel = log.user_name === '(Migração automática)'
                            ? 'Migração automática'
                            : (log.user_name || '-');

                          // Honorários proporcionais deste pagamento
                          const agreement = agreements.find(a => a.id === log.agreement_id);
                          let feeThisPayment = 0;
                          if (agreement && agreement.total_value > 0 && paidValue > 0) {
                            const ratio = agreement.fee_value / agreement.total_value;
                            feeThisPayment = paidValue * ratio;
                          }
                          
                          return (
                            <tr
                              key={log.id}
                              className="border-b border-slate-100 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition"
                            >
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                                  <span className="font-medium text-slate-900 dark:text-white">{paymentDate}</span>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                {agreement ? (
                                  <button
                                    type="button"
                                    onClick={() => { handleCloseAuditModal(); navigateToClient(agreement.client_id); }}
                                    className="font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline transition text-left"
                                    title="Abrir ficha do cliente"
                                  >
                                    {agreementInfo.clientName}
                                  </button>
                                ) : (
                                  <span className="font-semibold text-slate-900 dark:text-white">{agreementInfo.clientName}</span>
                                )}
                              </td>
                              <td className="py-3 px-3 hidden lg:table-cell">
                                {agreement ? (
                                  <button
                                    type="button"
                                    onClick={() => { handleCloseAuditModal(); setTimeout(() => handleOpenDetails(agreement), 80); }}
                                    className="text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline transition truncate max-w-[160px] block text-left"
                                    title={`Abrir acordo: ${agreementInfo.title}`}
                                  >
                                    {agreementInfo.title.length > 25 ? agreementInfo.title.substring(0, 25) + '...' : agreementInfo.title}
                                  </button>
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-400 truncate max-w-[160px] block" title={agreementInfo.title}>
                                    {agreementInfo.title.length > 25 ? agreementInfo.title.substring(0, 25) + '...' : agreementInfo.title}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-2 text-center">
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-bold">
                                  {parcelaNum}
                                </span>
                              </td>
                              <td className="py-3 px-2 hidden sm:table-cell">
                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                                  paymentMethod === 'pix' ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' :
                                  paymentMethod === 'transferencia' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                                  paymentMethod === 'dinheiro' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                                  'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                }`}>
                                  {methodLabel}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {formatCurrency(paidValue)}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(feeThisPayment)}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex flex-col text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-medium truncate">{userLabel}</span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {logDateTime.toLocaleDateString('pt-BR')} às {logDateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 dark:bg-zinc-800 font-semibold border-t-2 border-slate-300 dark:border-zinc-600">
                          {/* Data */}
                          <td className="py-3 px-3" />
                          {/* Cliente */}
                          <td className="py-3 px-3" />
                          {/* Acordo (hidden lg) */}
                          <td className="py-3 px-3 hidden lg:table-cell" />
                          {/* Parc. */}
                          <td className="py-3 px-2" />
                          {/* Método (hidden sm) */}
                          <td className="py-3 px-2 hidden sm:table-cell text-right text-slate-600 dark:text-slate-400 text-xs font-semibold uppercase tracking-wide">
                            Total do Período
                          </td>
                          {/* Valor */}
                          <td className="py-3 px-3 text-right">
                            <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(auditTotals.total)}</span>
                          </td>
                          {/* Honorário */}
                          <td className="py-3 px-3 text-right">
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(auditTotals.totalHonorarios)}</span>
                          </td>
                          {/* Usuário */}
                          <td className="py-3 px-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-zinc-700 bg-slate-50/90 dark:bg-zinc-900/80 sticky bottom-0 backdrop-blur-sm">
              <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <span className="text-red-500">▌</span>
                {auditTotals.count} registro{auditTotals.count !== 1 ? 's' : ''} em {new Date(auditFilterMonth + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </p>
              <button
                onClick={handleCloseAuditModal}
                className="px-5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white bg-white dark:bg-zinc-700 border border-slate-200 dark:border-zinc-600 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-600 transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialModule;




