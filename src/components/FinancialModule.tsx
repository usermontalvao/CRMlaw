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
import { useToastContext } from '../contexts/ToastContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { financialService } from '../services/financial.service';
import { clientService } from '../services/client.service';
import { calendarService } from '../services/calendar.service';
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
    const term = searchTerm.trim().toLowerCase();

    return agreements.filter((agreement: Agreement) => {
      const clientName = getClientName(agreement.client_id).toLowerCase();
      const matchesSearch = !term
        ? true
        : [
            agreement.title,
            agreement.description,
            agreement.notes,
            clientName,
            agreement.process_id,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term));

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

      setEditForm({
        clientId: agreement.client_id,
        processId: agreement.process_id || '',
        title: agreement.title,
        description: agreement.description || '',
        notes: agreement.notes || '',
        agreementDate: agreement.agreement_date || today,
        status: agreement.status,
        totalValue: agreement.total_value.toString(),
        feeType: agreement.fee_type,
        feePercentage: agreement.fee_percentage?.toString() || '',
        feeFixedValue: agreement.fee_fixed_value?.toString() || '',
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
        value: prev.totalValue && count ? (Number(prev.totalValue) / count).toFixed(2) : '',
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

      const baseValue = Number(prev.totalValue) / count;
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

    if (!editForm.totalValue || Number(editForm.totalValue) <= 0) {
      setEditError('Informe um valor total válido');
      return;
    }

    if (editForm.feeType === 'percentage' && (!editForm.feePercentage || Number(editForm.feePercentage) <= 0)) {
      setEditError('Informe o percentual de honorários');
      return;
    }

    if (editForm.feeType === 'fixed' && (!editForm.feeFixedValue || Number(editForm.feeFixedValue) <= 0)) {
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

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => {
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
      return { ...prev, [field]: value };
    });
  };

  const validateForm = () => {
    if (!formData.clientId) return 'Selecione um cliente';
    if (!formData.title.trim()) return 'Informe o título do acordo';
    if (!formData.totalValue || Number(formData.totalValue) <= 0) return 'Informe um valor total válido';
    if (formData.feeType === 'percentage') {
      if (!formData.feePercentage || Number(formData.feePercentage) <= 0) return 'Informe o percentual de honorários';
    } else {
      if (!formData.feeFixedValue || Number(formData.feeFixedValue) <= 0) return 'Informe o valor fixo de honorários';
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
    setPaymentData({
      paymentDate: today,
      paymentMethod: 'pix',
      paidValue: '',
      notes: '',
    });
  };

  const handleConfirmPayment = async () => {
    if (!selectedInstallment || !selectedAgreement) return;
    
    if (!paymentData.paidValue || Number(paymentData.paidValue) <= 0) {
      toast.error('Erro', 'Informe o valor pago');
      return;
    }

    try {
      await financialService.payInstallment(selectedInstallment.id, {
        payment_date: paymentData.paymentDate,
        payment_method: paymentData.paymentMethod,
        paid_value: Number(paymentData.paidValue),
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
    setLoadingAudit(true);
    try {
      const logs = await financialService.getPaymentAuditLog(agreementId);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Erro ao carregar auditoria:', err);
      toast.error('Erro ao carregar histórico de auditoria');
    } finally {
      setLoadingAudit(false);
    }
  };

  const loadAuditByMonth = async (month: string) => {
    setLoadingAudit(true);
    try {
      const startDate = `${month}-01T00:00:00`;
      const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
      const endDateStr = `${month}-${endDate.getDate().toString().padStart(2, '0')}T23:59:59`;
      
      const logs = await financialService.getAllPaymentAuditLogs({
        start_date: startDate,
        end_date: endDateStr,
        limit: 100,
      });
      setAuditLogs(logs);
    } catch (err) {
      console.error('Erro ao carregar auditoria:', err);
      toast.error('Erro ao carregar histórico de auditoria');
    } finally {
      setLoadingAudit(false);
    }
  };

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
  const auditTotals = useMemo(() => {
    let total = 0;
    let totalHonorarios = 0;

    auditLogs.forEach((log) => {
      const paidValue = log.new_value?.paid_value;
      if (typeof paidValue === 'number') {
        total += paidValue;

        // Calcular honorários proporcionais a partir do acordo
        const agreement = agreements.find(a => a.id === log.agreement_id);
        if (agreement && agreement.total_value > 0) {
          const ratio = agreement.fee_value / agreement.total_value;
          totalHonorarios += paidValue * ratio;
        }
      }
    });

    return { count: auditLogs.length, total, totalHonorarios };
  }, [auditLogs, agreements]);

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
      // Buscar todos os pagamentos do ano
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      
      const allInstallmentsYear = allInstallments.filter(inst => 
        inst.status === 'pago' && 
        inst.payment_date && 
        inst.payment_date >= yearStart && 
        inst.payment_date <= yearEnd
      );

      // Agrupar por cliente
      const clientPayments = new Map<string, { client: any; payments: typeof allInstallmentsYear; total: number }>();
      
      allInstallmentsYear.forEach(inst => {
        if (!inst.agreement) return;
        const clientId = inst.agreement.client_id;
        const client = clients.find(c => c.id === clientId);
        
        if (!clientPayments.has(clientId)) {
          clientPayments.set(clientId, {
            client,
            payments: [],
            total: 0
          });
        }
        
        const entry = clientPayments.get(clientId)!;
        const feeValue = inst.agreement.fee_value / inst.agreement.installments_count;
        entry.payments.push(inst);
        entry.total += feeValue;
      });

      // Dados fixos do advogado
      const lawyerName = 'PEDRO RODRIGUES MONTALVAO NETO';
      const lawyerOab = '30.021';
      const lawyerState = 'MT';
      const lawyerEmail = 'pedro@advcuiaba.com';

      const totalReceived = Array.from(clientPayments.values()).reduce((sum, entry) => sum + entry.total, 0);
      const issueDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório de Honorários para Imposto de Renda ${year}</title>
  <link rel="preconnect" href="${window.location.origin}" />
  <link rel="dns-prefetch" href="${window.location.origin}" />
  <style>
    @page { size: A4; margin: 15mm; }
    @media print {
      html, body { margin: 0; padding: 0; background: white; }
      .no-print { display: none !important; }
      .report-container { 
        box-shadow: none !important;
        border: none !important;
        page-break-inside: avoid;
        margin: 0 !important;
        padding: 20mm !important;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      background: #f5f5f5;
      padding: 20px;
      color: #1a1a1a;
      line-height: 1.6;
    }
    .report-container {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      padding: 25mm 20mm;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      border: 2px solid #000;
      position: relative;
    }
    .hero-box {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px double #000;
    }
    .lawyer-name {
      font-size: 18px;
      font-weight: 700;
      color: #000;
      margin: 10px 0 5px;
      letter-spacing: 0.5px;
    }
    .lawyer-oab {
      font-size: 14px;
      color: #333;
      font-weight: 600;
    }
    .header {
      text-align: center;
      padding: 20px;
      margin-bottom: 30px;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border: 2px solid #000;
      border-radius: 8px;
    }
    .header h1 {
      font-size: 24px;
      color: #000;
      font-weight: 700;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .header .year {
      font-size: 36px;
      font-weight: 900;
      color: #000;
      margin: 15px 0;
      letter-spacing: 2px;
    }
    .summary-box {
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border: 3px double #000;
      border-radius: 12px;
      padding: 30px;
      margin: 40px 0;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      position: relative;
      overflow: hidden;
    }
    .summary-box::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #000 0%, #333 100%);
    }
    .summary-label {
      font-size: 14px;
      color: #000;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 12px;
      letter-spacing: 1px;
    }
    .summary-value {
      font-size: 48px;
      font-weight: 900;
      color: #000;
      margin: 15px 0;
      font-family: 'Arial', sans-serif;
      letter-spacing: -1px;
    }
    .section-title {
      background: #000;
      color: white;
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 700;
      margin: 30px 0 15px 0;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 12px;
      border: 2px solid #000;
    }
    .data-table thead {
      background: #000;
      color: white;
    }
    .data-table th {
      padding: 12px;
      text-align: left;
      font-weight: 700;
      border: 1px solid #333;
      letter-spacing: 0.5px;
    }
    .data-table td {
      padding: 10px 12px;
      border: 1px solid #ccc;
    }
    .data-table tbody tr:nth-child(even) {
      background: #f8f9fa;
    }
    .data-table tbody tr:hover {
      background: #e9ecef;
    }
    .total-row {
      background: #000 !important;
      color: white !important;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .lawyer-info {
      background: #f8f9fa;
      border: 2px solid #000;
      border-radius: 8px;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 11px;
      color: #475467;
      border-top: 1px solid #e2e8f0;
      padding-top: 14px;
    }
    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0f172a;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 12px 24px;
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
  <div class="report-container">
    <div class="hero-box">
      <h1>Relatório de Honorários – IRPF</h1>
      <div class="year">${year}</div>
      <p>Emitido em ${issueDate}</p>
    </div>
    <div class="summary-box">
      <div class="summary-label">Total de honorários declarados</div>
      <div class="summary-value">${formatCurrency(totalReceived)}</div>
      <p style="margin-top:6px; color:#475467; font-size:12px;">${numberToWords(totalReceived)}</p>
    </div>
    <h2 class="section-title">Dados do profissional</h2>
    <table>
      <tbody>
        <tr>
          <th style="width:35%;">Nome</th>
          <td>${lawyerName}</td>
        </tr>
        <tr>
          <th>OAB</th>
          <td>${lawyerOab}/${lawyerState}</td>
        </tr>
        <tr>
          <th>E-mail profissional</th>
          <td>${lawyerEmail}</td>
        </tr>
      </tbody>
    </table>
    <h2 class="section-title">Resumo por cliente / fonte pagadora</h2>
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>CPF/CNPJ</th>
          <th style="text-align:center;">Pagamentos</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from(clientPayments.entries()).map(([clientId, entry]) => {
          const clientName = entry.client?.full_name || (entry.client as any)?.name || 'Cliente não identificado';
          const clientCpf = (entry.client as any)?.cpf || (entry.client as any)?.document || 'Não informado';
          return `
          <tr>
            <td>${clientName}</td>
            <td>${clientCpf}</td>
            <td style="text-align:center;">${entry.payments.length}</td>
            <td class="amount">${formatCurrency(entry.total)}</td>
          </tr>`;
        }).join('')}
        <tr class="total-row">
          <td colspan="3" style="text-align:right;">Total geral</td>
          <td class="amount">${formatCurrency(totalReceived)}</td>
        </tr>
      </tbody>
    </table>
    <h2 class="section-title">Resumo mensal</h2>
    <table>
      <thead>
        <tr>
          <th>Mês</th>
          <th style="text-align:center;">Pagamentos</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from({ length: 12 }, (_, i) => {
          const month = i + 1;
          const monthPayments = allInstallmentsYear.filter(inst => inst.payment_date && (new Date(inst.payment_date).getMonth() + 1) === month);
          const monthTotal = monthPayments.reduce((sum, inst) => {
            if (!inst.agreement) return sum;
            return sum + (inst.agreement.fee_value / inst.agreement.installments_count);
          }, 0);
          const monthName = new Date(year, i, 1).toLocaleDateString('pt-BR', { month: 'long' });
          return `
          <tr>
            <td>${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</td>
            <td style="text-align:center;">${monthPayments.length}</td>
            <td class="amount">${formatCurrency(monthTotal)}</td>
          </tr>`;
        }).join('')}
        <tr class="total-row">
          <td>Total anual</td>
          <td style="text-align:center;">${allInstallmentsYear.length}</td>
          <td class="amount">${formatCurrency(totalReceived)}</td>
        </tr>
      </tbody>
    </table>
    <h2 class="section-title">Instruções para declaração</h2>
    <div class="notes-box">
      <ul style="margin-left:18px; line-height:1.8;">
        <li>Declarar como <strong>Rendimentos Tributáveis Recebidos de Pessoa Física</strong>.</li>
        <li>Manter este relatório e os recibos arquivados por, no mínimo, 5 anos.</li>
        <li>Utilizar CPF/CNPJ de cada cliente listado como fonte pagadora.</li>
        <li>Apresentar este documento em conjunto com os comprovantes, se solicitado pela Receita Federal.</li>
        <li>Verificar obrigatoriedade de Carnê-Leão conforme legislação vigente.</li>
      </ul>
      <p style="margin-top:12px; font-size:12px; color:#c2410c;"><strong>Atenção:</strong> Relatório informativo. Consulte um contador para orientações específicas.</p>
    </div>
    <div class="footer">
      Documento emitido em ${issueDate}. Sistema de Gestão Financeira.
      <p>Guarde este relatório junto com os recibos individuais para comprovação fiscal.</p>
    </div>
  </div>

  <button class="print-button no-print" onclick="window.print()">🖨️ Imprimir Relatório</button>
</body>
</html>

    <div class="footer">
      <p><strong>Este documento foi gerado automaticamente pelo sistema de gestão financeira.</strong></p>
      <p>Guarde este relatório junto com os recibos individuais para comprovação fiscal.</p>
      <p style="margin-top: 10px;">Documento gerado em ${new Date().toLocaleString('pt-BR')}</p>
    </div>
  </div>

  <button class="print-button no-print" onclick="window.print()">🖨️ Imprimir Relatório</button>
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
    const clientCpf = (client as any)?.cpf || (client as any)?.document || '';
    const clientAddress = (client as any)?.address || '';
    const issueDate = new Date();
    const year = issueDate.getFullYear();
    const issueDateFormatted = issueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const feePerInstallment = agreement.installments_count ? agreement.fee_value / agreement.installments_count : 0;
    const amount = options?.totalPaid ?? (installment ? feePerInstallment : agreement.fee_value);
    const amountInWords = numberToWords(amount || 0);
    const receiptNumber = `REC-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getHours()).padStart(2, '0')}${String(issueDate.getMinutes()).padStart(2, '0')}${String(issueDate.getSeconds()).padStart(2, '0')}`;
    
    // Dados fixos do advogado
    const lawyerName = 'PEDRO RODRIGUES MONTALVAO NETO';
    const lawyerOab = '30.021';
    const lawyerState = 'MT';
    const lawyerEmail = 'pedro@advcuiaba.com';
    const lawyerTitle = `Dr. ${lawyerName}`;
    
    const paymentMethod = options?.paymentMethodLabel ?? getPaymentMethodLabel(installment?.payment_method);
    const paymentDateDisplay = options?.paymentDate
      ? new Date(options.paymentDate).toLocaleDateString('pt-BR')
      : installment?.payment_date
        ? new Date(installment.payment_date).toLocaleDateString('pt-BR')
        : installment?.due_date
          ? (parseLocalDate(installment.due_date) ?? new Date(installment.due_date)).toLocaleDateString('pt-BR')
          : '_____/_____/_____';
    
    const description = options?.descriptionOverride
      || (installment
        ? `Honorários advocatícios referente à parcela ${installment.installment_number}/${agreement.installments_count} do acordo "${agreement.title}".`
        : `Honorários advocatícios referente ao acordo "${agreement.title}".`);
    
    const serviceDescription = agreement.description || 'Serviços advocatícios prestados conforme contrato de honorários.';

    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Recibo de Honorários Advocatícios - Alta Profissionalidade</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;700&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#3b82f6",
                        "background-light": "#f1f5f9",
                        "background-dark": "#020617",
                        "paper-light": "#ffffff",
                        "paper-dark": "#1e293b",
                        "heading-light": "#1e293b",
                        "heading-dark": "#f1f5f9",
                        "text-light": "#334155",
                        "text-dark": "#94a3b8",
                        "subtle-light": "#64748b",
                        "subtle-dark": "#64748b",
                        "border-light": "#e2e8f0",
                        "border-dark": "#334155",
                    },
                    fontFamily: {
                        "display": ["Inter", "sans-serif"],
                        "serif": ["Roboto Slab", "serif"],
                    },
                    borderRadius: {
                        "DEFAULT": "0.375rem",
                        "lg": "0.5rem",
                        "xl": "0.75rem",
                        "2xl": "1rem",
                        "full": "9999px"
                    },
                },
            },
        }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0,
            'wght' 300, 'GRAD' 0,
            'opsz' 24
        }
        @media print {
            body {
                background-color: #fff !important;
            }
            .print-hide {
                display: none !important;
            }
            .print-shadow-none {
                box-shadow: none !important;
            }
            .print-p-0 {
                padding: 0 !important;
            }
        }
    </style>
</head>
<body class="font-display bg-background-light dark:bg-background-dark text-text-light dark:text-text-dark">
<div class="relative flex min-h-screen w-full flex-col items-center justify-center p-4 sm:p-6 lg:p-8 group/design-root print-p-0" style='font-family: Inter, "Noto Sans", sans-serif;'>
<div class="w-full max-w-4xl max-h-[92vh] bg-paper-light dark:bg-paper-dark shadow-xl print-shadow-none">
<div class="flex flex-col">
<header class="p-8 md:p-12 border-b border-border-light dark:border-border-dark">
<div class="flex justify-between items-start">
<div>
<h1 class="font-serif text-3xl font-bold text-heading-light dark:text-heading-dark">RECIBO DE HONORÁRIOS</h1>
<p class="text-xs font-semibold uppercase tracking-wider text-subtle-light dark:text-subtle-dark mt-1">Nº ${receiptNumber}</p>
</div>
<div class="text-right flex-shrink-0">
<p class="text-xs font-semibold uppercase tracking-wider text-subtle-light dark:text-subtle-dark">Data de Emissão</p>
<p class="text-base font-medium text-text-light dark:text-text-dark mt-1">${issueDateFormatted}</p>
</div>
</div>
</header>
<main class="p-8 md:p-12 space-y-10">
<section>
<p class="text-base leading-relaxed text-text-light dark:text-text-dark">
                            Recebi(emos) de <strong class="font-semibold text-heading-light dark:text-heading-dark">${clientName}</strong>${clientCpf ? `, CPF ${clientCpf}` : ''}, a importância total de:
                        </p>
<div class="mt-4 rounded-lg border border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-800/50 p-6 flex items-center justify-between">
<p class="font-serif text-4xl font-bold text-heading-light dark:text-heading-dark">${formatCurrency(amount)}</p>
<p class="text-base text-subtle-light dark:text-subtle-dark font-medium">(${amountInWords} reais)</p>
</div>
</section>
<div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
<section class="space-y-4">
<h2 class="text-sm font-semibold uppercase tracking-widest text-subtle-light dark:text-subtle-dark pb-2 border-b border-border-light dark:border-border-dark">Profissional</h2>
<div class="text-sm space-y-2.5">
<div class="flex">
<span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">Nome:</span>
<span class="font-medium text-heading-light dark:text-heading-dark">${lawyerName}</span>
</div>
<div class="flex">
<span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">OAB:</span>
<span class="font-medium text-heading-light dark:text-heading-dark">${lawyerOab}/${lawyerState}</span>
</div>
<div class="flex">
<span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">E-mail:</span>
<span class="font-medium text-heading-light dark:text-heading-dark">${lawyerEmail}</span>
</div>
</div>
</section>
<section class="space-y-4">
<h2 class="text-sm font-semibold uppercase tracking-widest text-subtle-light dark:text-subtle-dark pb-2 border-b border-border-light dark:border-border-dark">Cliente / Pagador</h2>
<div class="text-sm space-y-2.5">
<div class="flex">
<span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">Nome:</span>
<span class="font-medium text-heading-light dark:text-heading-dark">${clientName}</span>
</div>
${clientCpf ? `<div class="flex"><span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">CPF:</span><span class="font-medium text-heading-light dark:text-heading-dark">${clientCpf}</span></div>` : ''}
${clientAddress ? `<div class="flex"><span class="text-subtle-light dark:text-subtle-dark w-20 shrink-0">Endereço:</span><span class="font-medium text-heading-light dark:text-heading-dark">${clientAddress}</span></div>` : ''}
</div>
</section>
</div>
<section class="space-y-4">
<h2 class="text-sm font-semibold uppercase tracking-widest text-subtle-light dark:text-subtle-dark pb-2 border-b border-border-light dark:border-border-dark">Detalhes do Pagamento</h2>
<div class="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 text-sm">
<div>
<h3 class="font-medium text-subtle-light dark:text-subtle-dark mb-1">Referente a</h3>
<p class="text-text-light dark:text-text-dark">${description}</p>
<p class="text-text-light dark:text-text-dark mt-2">${serviceDescription}</p>
</div>
<div>
<h3 class="font-medium text-subtle-light dark:text-subtle-dark mb-1">Forma de Pagamento</h3>
<p class="text-text-light dark:text-text-dark">${paymentMethod}</p>
<p class="text-text-light dark:text-text-dark mt-2">Data do Pagamento: ${paymentDateDisplay} </p>
</div>
</div>
</section>
<div class="pt-12 flex flex-col items-center text-center">
<div class="w-80 border-t border-gray-400 dark:border-slate-600 mb-2"></div>
<p class="text-sm font-semibold text-heading-light dark:text-heading-dark">${lawyerName}</p>
<p class="text-xs text-subtle-light dark:text-subtle-dark">OAB/${lawyerState} ${lawyerOab}</p>
</div>
</main>
<footer class="p-8 md:p-10 border-t border-border-light dark:border-border-dark bg-slate-50 dark:bg-slate-900/50 print-hide">
<div class="flex flex-col md:flex-row items-center justify-between gap-4">
<p class="text-xs text-subtle-light dark:text-subtle-dark text-center md:text-left">
                            Documento emitido em ${issueDateFormatted}. Válido como comprovante de pagamento.
                        </p>
<button class="flex w-full md:w-auto shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 h-10 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 dark:focus:ring-offset-paper-dark" onclick="window.print()">
<span class="material-symbols-outlined !text-xl">print</span>
<span>Imprimir Recibo</span>
</button>
</div>
</footer>
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
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-slate-600">Carregando dados financeiros...</p>
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
              <div className="bg-emerald-100 text-emerald-700 p-2 rounded-lg">
                <PiggyBank className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Gestão Financeira</h1>
                <div className="flex items-center gap-2 mt-0.5 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                    {activeAgreementsCount} ativos
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
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
              <button onClick={handleOpenModal} className="inline-flex items-center gap-1 sm:gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-semibold transition">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {/* A Receber */}
        <div className="rounded-xl bg-emerald-600 text-white p-3 sm:p-4 shadow-md hover:shadow-lg transition">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider opacity-90">A Receber</span>
          </div>
          <p className="mt-2 sm:mt-3 text-lg sm:text-2xl font-bold">{formatCurrency(stats?.monthly_fees || 0)}</p>
          <p className="text-[10px] sm:text-xs opacity-85 mt-0.5 sm:mt-1 hidden xs:block">Previsto no mês</p>
        </div>

        {/* Recebido */}
        <div className="rounded-xl bg-blue-600 text-white p-3 sm:p-4 shadow-md hover:shadow-lg transition">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider opacity-90">Recebido</span>
          </div>
          <p className="mt-2 sm:mt-3 text-lg sm:text-2xl font-bold">{formatCurrency(stats?.monthly_fees_received || 0)}</p>
          <p className="text-[10px] sm:text-xs opacity-85 mt-0.5 sm:mt-1 hidden xs:block">Já quitado</p>
        </div>

        {/* Pendente */}
        <div className="rounded-xl bg-orange-500 text-white p-3 sm:p-4 shadow-md hover:shadow-lg transition">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider opacity-90">Pendente</span>
          </div>
          <p className="mt-2 sm:mt-3 text-lg sm:text-2xl font-bold">{formatCurrency(stats?.monthly_fees_pending || 0)}</p>
          <p className="text-[10px] sm:text-xs opacity-85 mt-0.5 sm:mt-1 hidden xs:block">Aguardando</p>
        </div>

        {/* Vencidas */}
        <div className="rounded-xl bg-slate-700 text-white p-3 sm:p-4 shadow-md hover:shadow-lg transition">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider opacity-90">Vencidas</span>
          </div>
          <p className="mt-2 sm:mt-3 text-lg sm:text-2xl font-bold">{stats?.overdue_installments || 0}</p>
          <p className="text-[10px] sm:text-xs opacity-85 mt-0.5 sm:mt-1 hidden xs:block">{stats?.overdue_installments ? 'Em atraso' : 'Nenhuma'}</p>
        </div>
      </div>

      {/* Modal de edição de acordo */}
      {isEditModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseEditModal} aria-hidden="true" />
          <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
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
              <div className="flex flex-col p-6 gap-4 flex-1 overflow-y-auto bg-white dark:bg-zinc-900">

                {editInitialLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                    <span className="ml-2 text-zinc-600 dark:text-zinc-400">Carregando dados...</span>
                  </div>
                ) : (
                  <>
                    {editError && (
                      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                        {editError}
                      </div>
                    )}

                    {/* Cliente e Processo */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                      <div className="flex flex-col w-full">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Cliente *</p>
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
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Processo (opcional)</p>
                        <input
                          type="text"
                          placeholder="Selecione o processo"
                          value={editForm.processId}
                          onChange={(e) => handleEditChange('processId', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                        />
                      </div>
                      <div className="flex flex-col w-full">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Título do acordo</p>
                        <input
                          type="text"
                          placeholder="Digite o título do acordo"
                          value={editForm.title}
                          onChange={(e) => handleEditChange('title', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Data do acordo</p>
                        <input
                          type="date"
                          value={editForm.agreementDate}
                          onChange={(e) => handleEditChange('agreementDate', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                        />
                      </div>
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Descrição (opcional)</p>
                        <textarea
                          placeholder="Digite a descrição do acordo"
                          value={editForm.description}
                          onChange={(e) => handleEditChange('description', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-zinc-500 px-4 py-3 text-sm resize-none"
                        />
                      </div>
                    </div>

                    {/* Valores e Honorários */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4">
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Valor total</p>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder=""
                          value={editForm.totalValue}
                          onChange={(e) => handleEditChange('totalValue', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Tipo de honorário</p>
                        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700/50 p-1 bg-zinc-100 dark:bg-zinc-800 h-11 items-center">
                          <button
                            type="button"
                            onClick={() => handleEditChange('feeType', 'percentage')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              editForm.feeType === 'percentage'
                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                          >
                            Percentual
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange('feeType', 'fixed')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              editForm.feeType === 'fixed'
                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                          >
                            Valor fixo
                          </button>
                        </div>
                      </div>
                      {editForm.feeType === 'percentage' ? (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Percentual (%)</p>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              step="0.5"
                              placeholder="0%"
                              value={editForm.feePercentage}
                              onChange={(e) => handleEditChange('feePercentage', e.target.value)}
                              className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              required
                            />
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1 pb-1">
                            <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                              Honorários: {editForm.totalValue ? formatCurrency(Number(editForm.totalValue) * (Number(editForm.feePercentage || '0') / 100)) : '—'}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Valor fixo</p>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">R$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder=""
                                value={editForm.feeFixedValue}
                                onChange={(e) => handleEditChange('feeFixedValue', e.target.value)}
                                className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 pl-9 pr-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                required
                              />
                            </div>
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1 pb-1">
                            <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                              Honorários: {editForm.feeFixedValue ? formatCurrency(Number(editForm.feeFixedValue)) : '—'}
                            </p>
                          </div>
                        </>
                      )}
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Forma de pagamento</p>
                        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700/50 p-1 bg-zinc-100 dark:bg-zinc-800 h-11 items-center">
                          <button
                            type="button"
                            onClick={() => handleEditChange('paymentType', 'upfront')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              editForm.paymentType === 'upfront'
                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                          >
                            À vista
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditChange('paymentType', 'installments')}
                            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                              editForm.paymentType === 'installments'
                                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                          >
                            Parcelado
                          </button>
                        </div>
                      </div>
                      {editForm.paymentType === 'installments' && (
                        <>
                          <div className="flex flex-col w-full md:col-span-1">
                            <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Nº de parcelas</p>
                            <input
                              type="number"
                              min="2"
                              max="120"
                              placeholder="1"
                              value={editForm.installmentsCount}
                              onChange={(e) => handleEditChange('installmentsCount', e.target.value)}
                              className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                              required
                            />
                          </div>
                          <div className="flex flex-col w-full justify-end md:col-span-1 gap-1 pb-1">
                            <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                              Parcela: {editForm.totalValue && editForm.installmentsCount
                                ? formatCurrency(Number(editForm.totalValue) / Number(editForm.installmentsCount))
                                : '—'}
                            </p>
                            <button
                              type="button"
                              onClick={handleToggleEditCustomInstallments}
                              className="text-sm font-medium text-blue-500 hover:underline text-left"
                            >
                              {editForm.customInstallments.length ? 'Remover personalizadas' : 'Parcelas personalizadas'}
                            </button>
                          </div>
                        </>
                      )}
                      {editForm.customInstallments.length > 0 && (
                        <div className="md:col-span-4 border border-zinc-200 dark:border-zinc-600 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 uppercase text-xs">
                              <tr>
                                <th className="py-2 px-3 text-left">Parcela</th>
                                <th className="py-2 px-3 text-left">Data</th>
                                <th className="py-2 px-3 text-left">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editForm.customInstallments.map((item, index) => (
                                <tr key={index} className="border-t border-zinc-200 dark:border-zinc-600">
                                  <td className="py-2 px-3 text-zinc-900 dark:text-white">#{index + 1}</td>
                                  <td className="py-2 px-3">
                                    <input
                                      type="date"
                                      value={item.dueDate}
                                      onChange={(e) => handleEditCustomInstallmentChange(index, 'dueDate', e.target.value)}
                                      className="border border-zinc-200 dark:border-zinc-600 rounded-lg px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                    />
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="relative">
                                      <span className="absolute left-2 top-1.5 text-zinc-500 text-sm">R$</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.value}
                                        onChange={(e) => handleEditCustomInstallmentChange(index, 'value', e.target.value)}
                                        className="border border-zinc-200 dark:border-zinc-600 rounded-lg pl-8 pr-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="bg-zinc-50 dark:bg-zinc-700 py-2 px-3 text-sm text-zinc-600 dark:text-zinc-300 flex justify-between">
                            <span>
                              Total: {
                                editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
                                  ? formatCurrency(editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0))
                                  : '—'
                              }
                            </span>
                            <button
                              type="button"
                              onClick={handleEditRecalculateCustomInstallments}
                              className="text-blue-500 hover:underline"
                            >
                              Recalcular
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Status do acordo</p>
                        <select
                          value={editForm.status}
                          onChange={(e) => handleEditChange('status', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 h-11 px-4 text-sm"
                        >
                          <option value="ativo">Ativo</option>
                          <option value="concluido">Concluído</option>
                          <option value="cancelado">Cancelado</option>
                        </select>
                      </div>
                      <div className="flex flex-col w-full md:col-span-2">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Notas internas (opcional)</p>
                        <textarea
                          placeholder="Digite as notas internas"
                          value={editForm.notes}
                          onChange={(e) => handleEditChange('notes', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-zinc-500 px-4 py-3 text-sm resize-none"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </form>
            {/* Footer */}
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex justify-between gap-3">
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
                  className="px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-2 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    disabled={editLoading}
                    className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="edit-agreement-form"
                    disabled={editLoading}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
                  >
                    {editLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                      </>
                    ) : (
                      'Salvar Alterações'
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
          <div className="bg-red-50 border-b border-red-100 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500 text-white rounded-lg flex items-center justify-center">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-base font-semibold text-red-900">
                  {stats.overdue_installments} parcela{stats.overdue_installments > 1 ? 's' : ''} em atraso
                </p>
                <p className="text-xs text-red-600">Acompanhe e faça a cobrança para evitar inadimplência</p>
              </div>
            </div>
            <button
              onClick={() => setShowOverdueOnly(!showOverdueOnly)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-2 bg-white text-red-700 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold transition"
            >
              {showOverdueOnly ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showOverdueOnly ? 'Ocultar' : 'Expandir'}
            </button>
          </div>

          {showOverdueOnly && (
            <div className="divide-y divide-slate-100">
              {allInstallments
                .filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus) && inst.due_date < today)
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
                          <p className="text-sm font-semibold text-slate-900 truncate">{clientName}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <p className="text-xs text-slate-500 truncate">{inst.agreement?.title}</p>
                            <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                              {daysOverdue} dia{daysOverdue > 1 ? 's' : ''} atraso
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
                    const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < today);
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
                        className="group relative cursor-pointer bg-white aspect-auto sm:aspect-square flex flex-col rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200"
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
                              const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < today);
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
                              <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Acordo</th>
                                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Valor</th>
                                  <th className="text-right px-4 py-3 font-semibold text-slate-600">Honorários</th>
                                  <th className="text-center px-4 py-3 font-semibold text-slate-600 hidden md:table-cell">Vencimento</th>
                                  <th className="text-center px-4 py-3 font-semibold text-slate-600 hidden lg:table-cell">Progresso</th>
                                  <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {sortedAgreements.map((agreement) => {
                                  const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                                  const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                                  const pendingInstallments = agreementInstallments.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                                  const overdueInstallments = pendingInstallments.filter(inst => inst.due_date < today);
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
                                      className="hover:bg-slate-50 cursor-pointer transition"
                                      onClick={() => handleOpenDetails(agreement)}
                                    >
                                      <td className="px-4 py-3">
                                        <p className="font-semibold text-slate-900 truncate max-w-[260px]">{agreement.title}</p>
                                        <p className="text-xs text-slate-400">{getClientName(agreement.client_id)}</p>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <p className="font-semibold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <p className={`font-bold ${isFullyPaid ? 'text-emerald-600' : overdueInstallments.length > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                                          {formatCurrency(agreement.fee_value)}
                                        </p>
                                      </td>
                                      <td className="px-4 py-3 text-center hidden md:table-cell">
                                        <p className="text-slate-600">{nextDueLabel}</p>
                                      </td>
                                      <td className="px-4 py-3 hidden lg:table-cell">
                                        <div className="flex items-center gap-2">
                                          <div className="financial-progress-track flex-1 h-1.5 bg-slate-200 dark:bg-orange-500/25 rounded-full overflow-hidden">
                                            <div
                                              className={`financial-progress-fill h-full rounded-full ${isFullyPaid ? 'bg-emerald-500 dark:bg-orange-500' : overdueInstallments.length > 0 ? 'bg-red-500 dark:bg-orange-500' : 'bg-amber-500 dark:bg-orange-500'}`}
                                              style={{ width: `${progress}%` }}
                                            />
                                          </div>
                                          <span className="text-xs text-slate-500 w-10 text-right">{paidInstallments.length}/{agreementInstallments.length}</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold ${
                                          isFullyPaid
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : overdueInstallments.length > 0
                                              ? 'bg-red-100 text-red-700'
                                              : 'bg-amber-100 text-amber-700'
                                        }`}>
                                          {isFullyPaid ? 'QUITADO' : overdueInstallments.length > 0 ? `${overdueInstallments.length} ATR.` : `${pendingInstallments.length} PEND.`}
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
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200 px-6 py-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3 text-blue-800">
                      <CheckCircle className="w-5 h-5" />
                      <p className="text-xs font-semibold uppercase tracking-[0.3em]">Encerrados</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-bold text-blue-900">Acordos concluídos</h2>
                        <p className="text-sm text-blue-700">
                          {showAllCompleted 
                            ? `${completedAgreements.length} acordo${completedAgreements.length !== 1 ? 's' : ''} encerrado${completedAgreements.length !== 1 ? 's' : ''}`
                            : `${Math.min(3, completedAgreements.length)} de ${completedAgreements.length} acordo${completedAgreements.length !== 1 ? 's' : ''}`
                          }
                        </p>
                      </div>
                      {hasMore && (
                        <button
                          onClick={() => setShowAllCompleted(!showAllCompleted)}
                          className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900"
                        >
                          {showAllCompleted ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {showAllCompleted ? 'Ver menos' : `Mostrar todos (${completedAgreements.length})`}
                        </button>
                      )}
                    </div>
                  </div>
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
            <div className="h-2 w-full bg-orange-500" />
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
              <div className="flex flex-col p-6 gap-4 flex-1 overflow-y-auto bg-white dark:bg-zinc-900">

                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                    {formError}
                  </div>
                )}

                {/* Cliente e Processo */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                  <div className="flex flex-col w-full">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Cliente *</p>
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
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Processo (opcional)</p>
                    <input
                      type="text"
                      placeholder="Selecione o processo"
                      value={formData.processId}
                      onChange={(e) => handleChange('processId', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Título do lançamento</p>
                    <input
                      type="text"
                      placeholder="Digite o título do lançamento"
                      value={formData.title}
                      onChange={(e) => handleChange('title', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                      required
                    />
                  </div>
                  <div className="flex flex-col w-full">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Data do lançamento</p>
                    <input
                      type="date"
                      value={formData.agreementDate}
                      onChange={(e) => handleChange('agreementDate', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                    />
                  </div>
                  <div className="flex flex-col w-full md:col-span-2">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Descrição (opcional)</p>
                    <textarea
                      placeholder="Digite a descrição do acordo"
                      value={formData.description}
                      onChange={(e) => handleChange('description', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-zinc-500 px-4 py-3 text-sm resize-none"
                    />
                  </div>
                </div>

                {/* Valores e Honorários */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4">
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Valor total</p>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder=""
                      value={formData.totalValue}
                      onChange={(e) => handleChange('totalValue', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      required
                    />
                  </div>
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Tipo de honorário</p>
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-600 p-1 bg-zinc-100 dark:bg-zinc-700/50 h-11 items-center">
                      <button
                        type="button"
                        onClick={() => handleChange('feeType', 'percentage')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.feeType === 'percentage'
                            ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-600'
                        }`}
                      >
                        Percentual
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange('feeType', 'fixed')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.feeType === 'fixed'
                            ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-600'
                        }`}
                      >
                        Valor fixo
                      </button>
                    </div>
                  </div>
                  {formData.feeType === 'percentage' ? (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Percentual (%)</p>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="0.5"
                          placeholder="0%"
                          value={formData.feePercentage}
                          onChange={(e) => handleChange('feePercentage', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1 pb-1">
                        <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                          Honorários: {formData.totalValue ? formatCurrency(Number(formData.totalValue) * (Number(formData.feePercentage || '0') / 100)) : '—'}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Valor fixo</p>
                        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 px-3">
                          <span className="text-zinc-500 text-sm font-medium">R$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0,00"
                            value={formData.feeFixedValue}
                            onChange={(e) => handleChange('feeFixedValue', e.target.value)}
                            className="flex-1 bg-transparent outline-none border-none text-zinc-900 dark:text-white text-sm appearance-none [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            required
                          />
                        </div>
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1 pb-1">
                        <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                          Honorários: {formData.feeFixedValue ? formatCurrency(Number(formData.feeFixedValue)) : '—'}
                        </p>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Forma de pagamento</p>
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-600 p-1 bg-zinc-100 dark:bg-zinc-700/50 h-11 items-center">
                      <button
                        type="button"
                        onClick={() => handleChange('paymentType', 'upfront')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.paymentType === 'upfront'
                            ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-600'
                        }`}
                      >
                        À vista
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChange('paymentType', 'installments')}
                        className={`flex-1 rounded-md px-3 py-1 text-sm font-medium transition ${
                          formData.paymentType === 'installments'
                            ? 'bg-white dark:bg-zinc-600 text-zinc-900 dark:text-white shadow'
                            : 'text-zinc-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-600'
                        }`}
                      >
                        Parcelado
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col w-full md:col-span-1">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Primeiro vencimento</p>
                    <input
                      type="date"
                      value={formData.firstDueDate}
                      onChange={(e) => handleChange('firstDueDate', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                      required={formData.paymentType === 'upfront' || !formData.customInstallments.length}
                    />
                  </div>
                  {formData.paymentType === 'installments' && (
                    <>
                      <div className="flex flex-col w-full md:col-span-1">
                        <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Nº de parcelas</p>
                        <input
                          type="number"
                          min="2"
                          max="120"
                          placeholder="1"
                          value={formData.installmentsCount}
                          onChange={(e) => handleChange('installmentsCount', e.target.value)}
                          className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-11 placeholder:text-zinc-500 px-4 text-sm"
                          required
                        />
                      </div>
                      <div className="flex flex-col w-full justify-end md:col-span-1 gap-1 pb-1">
                        <p className="text-zinc-500 dark:text-zinc-400 text-sm font-normal">
                          Parcela: {formData.totalValue && formData.installmentsCount
                            ? formatCurrency(Number(formData.totalValue) / Number(formData.installmentsCount))
                            : '—'}
                        </p>
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
                          className="text-sm font-medium text-blue-500 hover:underline text-left"
                        >
                          {formData.customInstallments.length ? 'Remover personalizadas' : 'Parcelas personalizadas'}
                        </button>
                      </div>
                    </>
                  )}
                  {formData.customInstallments.length > 0 && (
                    <div className="md:col-span-4 border border-zinc-200 dark:border-zinc-600 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 uppercase text-xs">
                          <tr>
                            <th className="py-2 px-3 text-left">Parcela</th>
                            <th className="py-2 px-3 text-left">Data</th>
                            <th className="py-2 px-3 text-left">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.customInstallments.map((item, index) => (
                            <tr key={index} className="border-t border-zinc-200 dark:border-zinc-600">
                              <td className="py-2 px-3 text-zinc-900 dark:text-white">#{index + 1}</td>
                              <td className="py-2 px-3">
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
                                  className="border border-zinc-200 dark:border-zinc-600 rounded-lg px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                />
                              </td>
                              <td className="py-2 px-3">
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
                                  className="w-full border border-zinc-200 dark:border-zinc-600 rounded-lg px-3 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="bg-zinc-50 dark:bg-zinc-700 py-2 px-3 text-sm text-zinc-600 dark:text-zinc-300 flex justify-between">
                        <span>
                          Total: {
                            formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0)
                              ? formatCurrency(formData.customInstallments.reduce((sum, item) => sum + parseCurrencyToNumber(item.value), 0))
                              : '—'
                          }
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
                                    ? (Number(prev.totalValue) / Number(prev.installmentsCount)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : item.value,
                              })),
                            }))
                          }
                          className="text-blue-500 hover:underline"
                        >
                          Recalcular
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col w-full md:col-span-4">
                    <p className="text-zinc-900 dark:text-white text-sm font-medium pb-2">Notas internas (opcional)</p>
                    <textarea
                      placeholder="Digite as notas internas"
                      value={formData.notes}
                      onChange={(e) => handleChange('notes', e.target.value)}
                      className="w-full rounded-lg text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[4rem] placeholder:text-zinc-500 px-4 py-3 text-sm resize-none"
                    />
                  </div>
                </div>
              </div>
            </form>
            {/* Footer */}
            <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={formLoading}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="new-agreement-form"
                  disabled={formLoading}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition disabled:opacity-50"
                >
                  {formLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    'Criar Acordo'
                  )}
                </button>
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
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Detalhes</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{selectedAgreement.title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{getClientName(selectedAgreement.client_id)}</p>
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
                  <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
                    <h2 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-white">📋 Resumo do Acordo</h2>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Valor Total</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(agreementSummary?.totalValue || selectedAgreement.total_value)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Honorários ({selectedAgreement.fee_type === 'percentage' ? `${selectedAgreement.fee_percentage}%` : 'Fixo'})</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(agreementSummary?.feeValue || selectedAgreement.fee_value)}</span>
                      </div>
                      {selectedAgreement.fee_type === 'percentage' && (
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">Valor Líquido Cliente</span>
                          <span className="font-medium text-gray-800 dark:text-gray-200">{formatCurrency(agreementSummary?.netValue || selectedAgreement.net_value)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Data do Acordo</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{new Date(selectedAgreement.agreement_date).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Forma de Pagamento</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{selectedAgreement.payment_type === 'upfront' ? 'À Vista' : 'Parcelado'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">Parcelas</span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{(agreementSummary?.installmentsCount || selectedAgreement.installments_count)}x de {formatCurrency(agreementSummary?.installmentValue || selectedAgreement.installment_value)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 dark:text-gray-400">Status</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          selectedAgreement.status === 'ativo' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' :
                          selectedAgreement.status === 'concluido' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' :
                          selectedAgreement.status === 'cancelado' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {selectedAgreement.status === 'ativo' ? 'Em Andamento' : selectedAgreement.status.charAt(0).toUpperCase() + selectedAgreement.status.slice(1)}
                        </span>
                      </div>
                    </div>
                    {selectedAgreement.description && (
                      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-zinc-700">
                        <span className="text-gray-500 dark:text-gray-400 text-sm">Descrição</span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{selectedAgreement.description}</p>
                      </div>
                    )}
                  </div>

                  {/* Ações Rápidas */}
                  <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-3">
                    <h2 className="text-sm font-semibold mb-2 text-zinc-900 dark:text-white">⚡ Ações Rápidas</h2>
                    <div className="flex flex-wrap gap-1">
                      <span
                        onClick={() => handleGenerateReceipt(selectedAgreement)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-gray-400 bg-transparent"
                      >
                        <Receipt className="w-3 h-3" />Recibo
                      </span>
                      <span
                        onClick={() => handleAddDeadline(selectedAgreement)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-gray-400 bg-transparent"
                      >
                        <CalendarIcon className="w-3 h-3" />Prazo
                      </span>
                      <span
                        onClick={() => handleExportAgreement(selectedAgreement)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-gray-400 bg-transparent"
                      >
                        <Download className="w-3 h-3" />Exportar
                      </span>
                      <span
                        onClick={() => handleOpenEditModal(selectedAgreement)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-yellow-600 dark:text-yellow-500 bg-transparent"
                      >
                        <Edit className="w-3 h-3" />Editar
                      </span>
                      <span
                        onClick={() => handleDeleteAgreement(selectedAgreement)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-red-600 dark:text-red-500 bg-transparent"
                      >
                        <Trash2 className="w-3 h-3" />Excluir
                      </span>
                      <span
                        onClick={() => handleOpenAuditModal(selectedAgreement.id)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 text-purple-600 dark:text-purple-400 bg-transparent"
                      >
                        <History className="w-3 h-3" />Auditoria
                      </span>
                    </div>
                  </div>

                  {/* Notas Internas */}
                  {selectedAgreement.notes && (
                    <div className="border border-amber-200 dark:border-amber-700 rounded-lg p-4 bg-amber-50 dark:bg-amber-900/20">
                      <h2 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-300">📝 Notas Internas</h2>
                      <p className="text-sm text-amber-800 dark:text-amber-200">{selectedAgreement.notes}</p>
                    </div>
                  )}
                </div>

                {/* Coluna 2 - Parcelas */}
                <div className="lg:col-span-2 lg:h-full min-h-0">
                  <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-3 lg:h-full flex flex-col min-h-0 bg-white dark:bg-zinc-800/60">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">💳 Parcelas e Pagamentos</h2>
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
                        {installments.map((installment, index) => {
                          const isOverdue = pendingStatuses.includes(installment.status as InstallmentStatus) && installment.due_date < today;
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
                              {installments.length > 1 && index < installments.length - 1 && (
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
            <div className="flex justify-between items-center border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-5 sm:px-8 py-4">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Criado em {new Date(selectedAgreement.created_at).toLocaleDateString('pt-BR')} às {new Date(selectedAgreement.created_at).toLocaleTimeString('pt-BR')}
              </span>
              <button
                onClick={handleCloseDetails}
                className="px-4 py-2 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-white text-sm font-medium rounded-lg transition"
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
            <div className="h-2 w-full bg-orange-500" />
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
                {/* Valor da Parcela */}
                <div className="relative">
                  <div className="absolute -inset-x-4 -inset-y-2 bg-slate-200/70 dark:bg-slate-800/30 rounded-xl blur-sm" aria-hidden="true" />
                  <div className="relative rounded-lg bg-white border border-slate-200 dark:bg-slate-800/60 dark:border-slate-700 p-3">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Valor da Parcela</label>
                    <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(selectedInstallment.value)}</p>
                  </div>
                </div>

                {/* Data e Valor */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Data do Pagamento</label>
                    <div className="relative">
                      <CalendarIcon className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 w-5 h-5 top-2.5" />
                      <input
                        type="date"
                        value={paymentData.paymentDate}
                        onChange={(e) => setPaymentData(prev => ({ ...prev, paymentDate: e.target.value }))}
                        className="w-full rounded-lg border-gray-300 bg-white py-2.5 pl-10 pr-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Valor Pago</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={paymentData.paidValue}
                        onChange={(e) => setPaymentData(prev => ({ ...prev, paidValue: formatPaidValueInput(e.target.value) }))}
                        className="w-full rounded-lg border-gray-300 bg-white py-2.5 px-3 text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100"
                        placeholder=""
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                </div>

                {/* Método de Pagamento */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Método de Pagamento</label>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Observações (opcional)</label>
                  <textarea
                    value={paymentData.notes}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full rounded-lg border-gray-300 bg-white text-gray-900 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100 px-3 py-2"
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
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
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
            <div className="h-2 w-full bg-orange-500" />
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
                <label className="text-sm font-semibold text-slate-700 mb-2 block">📅 Selecione o Mês</label>
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
                <h4 className="text-sm font-semibold text-slate-900 mb-4">📋 Informações para Declaração</h4>
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
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">📝 Detalhamento de Recebimentos</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                      <tr>
                        <th className="py-3 px-4 text-left">Cliente</th>
                        <th className="py-3 px-4 text-left">Acordo</th>
                        <th className="py-3 px-4 text-right">Valor Recebido</th>
                        <th className="py-3 px-4 text-right">Honorários</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-200">
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p>Detalhamento será gerado após implementação completa</p>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Observações Importantes */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-amber-900 mb-2">⚠️ Observações Importantes</h4>
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
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
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
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Relatório</p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-orange-500" />
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
                    📊 Anos disponíveis com pagamentos registrados:
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
                        className="w-full border-2 border-slate-200 dark:border-zinc-700 hover:border-orange-500 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-xl p-4 transition text-left group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-red-600 group-hover:bg-red-700 text-white rounded-lg w-12 h-12 flex items-center justify-center font-bold text-lg transition">
                              {year}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white group-hover:text-orange-700 dark:group-hover:text-orange-400">Ano {year}</p>
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                {yearPayments.length} pagamento{yearPayments.length > 1 ? 's' : ''} registrado{yearPayments.length > 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{formatCurrency(yearTotal)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Total recebido</p>
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
            <div className="h-2 w-full bg-orange-500" />
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl p-2.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Auditoria</p>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Histórico de Baixas</h2>
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
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase font-bold mb-1">💰 Honorários</p>
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
                          const paidValue = log.new_value?.paid_value || 0;
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
                          if (agreement && agreement.total_value > 0 && typeof paidValue === 'number') {
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
                                <span className="font-semibold text-slate-900 dark:text-white">{agreementInfo.clientName}</span>
                              </td>
                              <td className="py-3 px-3 hidden lg:table-cell">
                                <span className="text-slate-600 dark:text-slate-400 truncate max-w-[160px] block" title={agreementInfo.title}>
                                  {agreementInfo.title.length > 25 ? agreementInfo.title.substring(0, 25) + '...' : agreementInfo.title}
                                </span>
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
                        <tr className="bg-slate-100 dark:bg-zinc-800 font-semibold">
                          <td colSpan={6} className="py-3 px-4 text-right text-slate-700 dark:text-slate-300">
                            Total do Período:
                          </td>
                          <td className="py-3 px-4 text-right text-slate-700 dark:text-slate-200">
                            {formatCurrency(auditTotals.total)}
                          </td>
                          <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(auditTotals.totalHonorarios)}
                          </td>
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




