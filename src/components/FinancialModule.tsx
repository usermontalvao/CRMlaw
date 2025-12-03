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
  Clock,
  Eye,
  Edit,
  Trash2,
  X,
  Receipt,
  CalendarIcon,
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
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
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
} from '../types/financial.types';
import type { Client } from '../types/client.types';

const FinancialModule: React.FC = () => {
  const toast = useToastContext();
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
  const today = new Date().toISOString().split('T')[0];
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<Installment | null>(null);
  const [paymentData, setPaymentData] = useState({
    paymentDate: today,
    paymentMethod: 'pix' as 'dinheiro' | 'pix' | 'transferencia' | 'cheque' | 'cartao_credito' | 'cartao_debito',
    paidValue: '',
    notes: '',
  });
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
  const pendingStatuses: InstallmentStatus[] = ['pendente', 'vencido'];
  const [editForm, setEditForm] = useState({
    clientId: '',
    processId: '',
    title: '',
    description: '',
    notes: '',
    agreementDate: new Date().toISOString().split('T')[0],
    status: 'ativo' as AgreementStatus,
    totalValue: '',
    feeType: 'percentage' as 'percentage' | 'fixed',
    feePercentage: '',
    feeFixedValue: '',
    paymentType: 'installments' as 'installments' | 'upfront',
    installmentsCount: '1',
    firstDueDate: new Date().toISOString().split('T')[0],
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
    paymentType: 'installments' as 'installments' | 'upfront',
    installmentsCount: '12',
    firstDueDate: today,
    notes: '',
    customInstallments: [] as { dueDate: string; value: string }[],
  });
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    if (stats?.overdue_installments) {
      setShowOverdueOnly(true);
    }
  }, [stats?.overdue_installments]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
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
    return agreements.filter(agreement => {
      const matchesSearch = 
        agreement.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getClientName(agreement.client_id).toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || agreement.status === filterStatus;
      
      // Filtro por status de pagamento
      let matchesPaymentStatus = true;
      if (filterPaymentStatus !== 'all') {
        const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
        const hasPending = agreementInstallments.some(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
        
        if (filterPaymentStatus === 'with_pending') {
          matchesPaymentStatus = hasPending;
        } else if (filterPaymentStatus === 'fully_paid') {
          matchesPaymentStatus = !hasPending && agreementInstallments.length > 0;
        }
      }
      
      return matchesSearch && matchesStatus && matchesPaymentStatus;
    });
  }, [agreements, searchTerm, filterStatus, filterPaymentStatus, clients, allInstallments]);

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
            value: Number(item.value),
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
        total_value: Number(editForm.totalValue),
        fee_type: editForm.feeType,
        fee_percentage: editForm.feeType === 'percentage' ? Number(editForm.feePercentage) : undefined,
        fee_fixed_value: editForm.feeType === 'fixed' ? Number(editForm.feeFixedValue) : undefined,
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

    const hasInstallments = installments.length > 0;
    const totalInstallments = hasInstallments
      ? Number(installments.reduce((sum, inst) => sum + (inst.value || 0), 0).toFixed(2))
      : selectedAgreement.total_value;

    const totalValue = Number(totalInstallments.toFixed(2));
    const feeValue = selectedAgreement.fee_type === 'percentage'
      ? Number(((totalValue * (selectedAgreement.fee_percentage ?? 0)) / 100).toFixed(2))
      : Number(selectedAgreement.fee_value.toFixed(2));
    const netValue = Number((totalValue - feeValue).toFixed(2));

    const installmentsCount = hasInstallments
      ? installments.length
      : selectedAgreement.installments_count;
    const installmentValue = installmentsCount > 0
      ? Number((totalValue / installmentsCount).toFixed(2))
      : Number(selectedAgreement.installment_value.toFixed(2));

    return {
      totalValue,
      feeValue,
      netValue,
      installmentsCount,
      installmentValue,
    };
  }, [selectedAgreement, installments]);

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
        const invalid = formData.customInstallments.find((item) => !item.dueDate || !item.value || Number(item.value) <= 0);
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
        total_value: Number(formData.totalValue),
        fee_type: formData.feeType,
        fee_percentage: formData.feeType === 'percentage' ? Number(formData.feePercentage) : undefined,
        fee_fixed_value: formData.feeType === 'fixed' ? Number(formData.feeFixedValue) : undefined,
        payment_type: formData.paymentType,
        installments_count: formData.paymentType === 'upfront' ? 1 : Number(formData.installmentsCount),
        first_due_date: formData.firstDueDate || (formData.customInstallments[0]?.dueDate ?? today),
        custom_installments: formData.customInstallments.length
          ? formData.customInstallments.map((item) => ({
              due_date: item.dueDate,
              value: Number(item.value),
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
    } catch (err: any) {
      toast.error('Erro ao carregar parcelas', err.message);
    } finally {
      setLoadingInstallments(false);
    }
  };

  const handleCloseDetails = () => {
    setIsDetailsModalOpen(false);
    setSelectedAgreement(null);
    setInstallments([]);
  };

  const handleOpenPaymentModal = (installment: Installment) => {
    setSelectedInstallment(installment);
    setPaymentData({
      paymentDate: today,
      paymentMethod: 'pix',
      paidValue: installment.value.toString(),
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
    const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];
    
    return installments.filter(
      inst => inst.status === 'pendente' && inst.due_date < twoDaysAgoStr
    );
  };

  const generateMonthlyReport = () => {
    setIsReportModalOpen(true);
  };

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
        dueDate: dueDate.toISOString().split('T')[0],
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
            const dueDate = new Date(inst.due_date);
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
            const deadlineDate = new Date(inst.due_date);
            deadlineDate.setDate(deadlineDate.getDate() + 2);

            await calendarService.createEvent({
              title: `Prazo: Denúncia de inadimplência - ${clientName}`,
              description: `Acordo: ${agreement.title}\nParcela ${inst.installment_number}/${agreement.installments_count}\nValor: ${formatCurrency(inst.value)}\n[inadimplencia] [agreement_id:${agreement.id}] [installment:${inst.installment_number}]`,
              event_type: 'deadline',
              start_at: `${deadlineDate.toISOString().split('T')[0]}T00:00:00`,
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

  const handleGenerateReceipt = (agreement: Agreement, installment?: Installment) => {
    const client = clients.find(c => c.id === agreement.client_id);
    const clientName = client?.full_name || (client as any)?.name || 'Cliente não encontrado';
    const clientCpf = (client as any)?.cpf || (client as any)?.document || '';
    const clientAddress = (client as any)?.address || '';
    const issueDate = new Date();
    const year = issueDate.getFullYear();
    const issueDateFormatted = issueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const amount = installment ? installment.paid_value ?? installment.value : agreement.fee_value;
    const amountInWords = numberToWords(amount || 0);
    const receiptNumber = `REC-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getHours()).padStart(2, '0')}${String(issueDate.getMinutes()).padStart(2, '0')}${String(issueDate.getSeconds()).padStart(2, '0')}`;
    
    // Dados fixos do advogado
    const lawyerName = 'PEDRO RODRIGUES MONTALVAO NETO';
    const lawyerOab = '30.021';
    const lawyerState = 'MT';
    const lawyerEmail = 'pedro@advcuiaba.com';
    const lawyerTitle = `Dr. ${lawyerName}`;
    
    const paymentMethod = installment?.payment_method
      ? installment.payment_method === 'pix' ? 'PIX'
      : installment.payment_method === 'transferencia' ? 'Transferência Bancária'
      : installment.payment_method === 'dinheiro' ? 'Dinheiro'
      : installment.payment_method === 'cartao_credito' ? 'Cartão de Crédito'
      : installment.payment_method === 'cartao_debito' ? 'Cartão de Débito'
      : installment.payment_method === 'cheque' ? 'Cheque'
      : 'Não especificado'
      : 'Não especificado';
    
    const description = installment
      ? `Honorários advocatícios referente à parcela ${installment.installment_number}/${agreement.installments_count} do acordo "${agreement.title}".`
      : `Honorários advocatícios referente ao acordo "${agreement.title}".`;
    
    const serviceDescription = agreement.description || 'Serviços advocatícios prestados conforme contrato de honorários.';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recibo de Honorários - ${receiptNumber}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    @media print {
      body { background: #fff; }
      .wrapper { box-shadow: none; border: none; }
      .print-btn { display: none; }
    }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      background: #fff;
      color: #000;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }
    .wrapper {
      max-width: 760px;
      margin: 0 auto;
      background: #fff;
      padding: 32px 38px;
      border: 2px solid #000;
      box-shadow: 0 6px 18px rgba(0,0,0,0.12);
    }
    .doc-header {
      text-align: center;
      border-bottom: 3px double #000;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .doc-header h1 {
      font-size: 22px;
      letter-spacing: 3px;
      text-transform: uppercase;
      margin: 0;
      font-weight: 700;
    }
    .doc-header p {
      margin: 8px 0 0;
      color: #333;
      font-size: 12px;
    }
    .section {
      margin-bottom: 18px;
    }
    .section-title {
      font-size: 11px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #000;
      font-weight: 700;
      margin-bottom: 10px;
      border-bottom: 1px solid #000;
      padding-bottom: 4px;
    }
    .section p {
      font-size: 13px;
      color: #000;
      margin: 4px 0;
    }
    .amount-box {
      border: 3px double #000;
      padding: 22px;
      text-align: center;
      margin: 24px 0;
      background: #f8f9fa;
    }
    .amount-box span {
      display: block;
      font-size: 36px;
      font-weight: 900;
      letter-spacing: 1px;
      margin-bottom: 8px;
      color: #000;
    }
    .amount-box p {
      font-size: 12px;
      color: #333;
      margin-top: 8px;
      font-style: italic;
    }
    .signature {
      margin-top: 32px;
      text-align: center;
    }
    .signature-line {
      width: 240px;
      border-top: 2px solid #000;
      margin: 0 auto 10px;
    }
    .signature p {
      font-size: 13px;
      color: #000;
      margin: 4px 0;
    }
    .footer {
      margin-top: 28px;
      font-size: 11px;
      color: #666;
      text-align: center;
      border-top: 1px dashed #999;
      padding-top: 12px;
    }
    .print-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #000;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 10px 24px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 18px;
      transition: all 0.3s;
    }
    .print-btn:hover {
      background: #333;
      transform: translateY(-2px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    td {
      padding: 4px 0;
      font-size: 12px;
      vertical-align: top;
    }
    td:first-child {
      font-weight: 600;
      width: 32%;
      color: #000;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="doc-header">
      <h1>${receiptNumber}</h1>
      <p>RECIBO DE HONORÁRIOS ADVOCATÍCIOS</p>
      <p style="margin-top: 12px;">${issueDateFormatted}</p>
    </div>
    
    <div class="section">
      <div class="section-title">Profissional</div>
      <table>
        <tr>
          <td>Nome:</td>
          <td>${lawyerName}</td>
        </tr>
        <tr>
          <td>OAB:</td>
          <td>${lawyerOab}/${lawyerState}</td>
        </tr>
        <tr>
          <td>E-mail:</td>
          <td>${lawyerEmail}</td>
        </tr>
      </table>
    </div>
    
    <div class="section">
      <div class="section-title">Cliente / Pagador</div>
      <table>
        <tr>
          <td>Nome:</td>
          <td>${clientName}</td>
        </tr>
        ${clientCpf ? `<tr><td>CPF/CNPJ:</td><td>${clientCpf}</td></tr>` : ''}
        ${clientAddress ? `<tr><td>Endereço:</td><td>${clientAddress}</td></tr>` : ''}
      </table>
    </div>
    
    <div class="amount-box">
      <span>${formatCurrency(amount)}</span>
      <p>${amountInWords}</p>
    </div>
    
    <div class="section">
      <div class="section-title">Referente a</div>
      <p>${description}</p>
      <p style="font-size:12px; color:#555; margin-top:10px;">${serviceDescription}</p>
    </div>
    
    <div class="section">
      <div class="section-title">Forma de Pagamento</div>
      <p>${paymentMethod}</p>
    </div>
    
    <div class="signature">
      <div class="signature-line"></div>
      <p style="font-weight:700; margin-top:8px;">${lawyerName}</p>
      <p style="font-weight:600;">OAB/${lawyerState} ${lawyerOab}</p>
    </div>
    
    <div class="footer">
      <p>Documento emitido em ${issueDateFormatted}.</p>
      <p style="margin-top:6px;">Guarde este recibo para fins contábeis e fiscais por no mínimo 5 anos.</p>
    </div>
    
    <div style="text-align:center;">
      <button class="print-btn" onclick="window.print()">Imprimir Recibo</button>
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  
  const handleAddDeadline = async (agreement: Agreement) => {
    if (!installments.length) {
      toast.info('Acordo', 'Sem parcelas para gerar prazo');
      return;
    }

    const nextPending = installments.find((inst) => inst.status !== 'pago');
    if (!nextPending) {
      toast.info('Acordo', 'Todas as parcelas já foram quitadas');
      return;
    }

    try {
      const clientName = getClientName(agreement.client_id);
      const deadlineDate = new Date(nextPending.due_date);
      deadlineDate.setDate(deadlineDate.getDate() + 2);

      await calendarService.createEvent({
        title: `Prazo interno - ${clientName}`,
        description: `Monitorar pagamento da parcela ${nextPending.installment_number}/${agreement.installments_count} do acordo "${agreement.title}".\n[agreement_id:${agreement.id}] [installment:${nextPending.installment_number}]`,
        event_type: 'deadline',
        start_at: `${deadlineDate.toISOString().split('T')[0]}T00:00:00`,
        notify_minutes_before: 60,
        client_id: agreement.client_id,
        process_id: agreement.process_id ?? undefined,
      });

      toast.success('Prazo criado', 'O prazo foi adicionado ao calendário');
    } catch (error: any) {
      toast.error('Prazo', 'Não foi possível adicionar o prazo ao calendário');
    }
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
    const confirmed = window.confirm('Tem certeza que deseja excluir este acordo? Esta ação apagará todas as parcelas relacionadas.');
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
      {/* Header Compacto e Profissional */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-lg sm:text-2xl font-semibold text-slate-900 flex items-center gap-2">
              <PiggyBank className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600" />
              Gestão Financeira
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Controle de acordos e honorários
            </p>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
            {/* Navegação de Mês + Relatório IR */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2 py-1.5">
                <button
                  onClick={handlePreviousMonth}
                  className="hover:bg-slate-100 p-1 rounded transition"
                  title="Mês anterior"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                <span className="text-xs font-medium min-w-[100px] text-center capitalize text-slate-700">
                  {formatMonthYear(activeMonth)}
                </span>
                <button
                  onClick={handleNextMonth}
                  className="hover:bg-slate-100 p-1 rounded transition"
                  title="Próximo mês"
                >
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
              <button
                onClick={() => setIsIRModalOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 border border-slate-200 hover:bg-slate-50 transition-colors px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700"
                title="Relatório de Imposto de Renda"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="hidden sm:inline">Relatório IR</span>
                <span className="sm:hidden">IR</span>
              </button>
            </div>
            
            {/* Botão Novo Acordo */}
            <button
              onClick={handleOpenModal}
              className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 transition-colors px-3 py-1.5 rounded-lg text-xs font-medium text-white w-full sm:w-auto"
            >
              <PlusCircle className="w-4 h-4" />
              Novo Acordo
            </button>
          </div>
        </div>
      </div>

      {/* Stats Minimalistas */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-md hover:border-emerald-300 transition-all duration-200 cursor-pointer group">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase group-hover:text-emerald-600 transition-colors">A Receber</span>
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-base sm:text-2xl font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{formatCurrency(stats?.monthly_fees || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Previsto no mês</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-md hover:border-blue-300 transition-all duration-200 cursor-pointer group">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase group-hover:text-blue-600 transition-colors">Recebido</span>
            <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-base sm:text-2xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{formatCurrency(stats?.monthly_fees_received || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Já quitado</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-md hover:border-amber-300 transition-all duration-200 cursor-pointer group">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase group-hover:text-amber-600 transition-colors">Pendente</span>
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-amber-600 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-base sm:text-2xl font-bold text-slate-900 group-hover:text-amber-600 transition-colors">{formatCurrency(stats?.monthly_fees_pending || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Aguardando</p>
        </div>
        <div className={`bg-white border rounded-lg p-3 sm:p-4 hover:shadow-md transition-all duration-200 cursor-pointer group ${
          stats?.overdue_installments ? 'border-red-300 hover:border-red-400' : 'border-slate-200 hover:border-slate-300'
        }`}>
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className={`text-[10px] sm:text-xs font-medium uppercase transition-colors ${
              stats?.overdue_installments ? 'text-red-600 group-hover:text-red-700' : 'text-slate-600 group-hover:text-slate-700'
            }`}>Vencidas</span>
            <AlertCircle className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform group-hover:scale-110 ${
              stats?.overdue_installments ? 'text-red-600 animate-pulse' : 'text-slate-400'
            }`} />
          </div>
          <p className={`text-base sm:text-2xl font-bold transition-colors ${
            stats?.overdue_installments ? 'text-red-600 group-hover:text-red-700' : 'text-slate-900 group-hover:text-slate-700'
          }`}>{stats?.overdue_installments || 0}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">
            {stats?.overdue_installments ? 'Parcelas em atraso' : 'Nenhuma vencida'}
          </p>
        </div>
      </div>

      {/* Modal de edição de acordo */}
      {isEditModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={handleCloseEditModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
            {/* Header Minimalista */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex-shrink-0 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <Edit className="w-5 h-5 text-slate-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">Editar Acordo</h3>
                    <p className="text-xs sm:text-sm text-slate-500 hidden sm:block">Atualize as informações do acordo</p>
                  </div>
                </div>
                <button 
                  onClick={handleCloseEditModal} 
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-2 rounded-lg transition-all duration-200 flex-shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitEdit} className="flex-1 overflow-y-auto">
              <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
              {editInitialLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                  <span className="ml-2 text-slate-600">Carregando dados...</span>
                </div>
              ) : (
                <>
                  {editError && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                      {editError}
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-4">
                    <ClientSearchSelect
                      value={editForm.clientId}
                      onChange={(clientId) => handleEditChange('clientId', clientId)}
                      label="Cliente"
                      placeholder="Buscar cliente..."
                      required
                      allowCreate={true}
                    />
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Processo (opcional)</label>
                      <input
                        type="text"
                        placeholder="ID do processo vinculado"
                        value={editForm.processId}
                        onChange={(e) => handleEditChange('processId', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Título do acordo</label>
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => handleEditChange('title', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Data do acordo</label>
                      <input
                        type="date"
                        value={editForm.agreementDate}
                        onChange={(e) => handleEditChange('agreementDate', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Descrição</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => handleEditChange('description', e.target.value)}
                      placeholder="Detalhes do acordo, condições específicas..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={3}
                    />
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Valor total do acordo</label>
                      <div className="relative">
                        <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.totalValue}
                          onChange={(e) => handleEditChange('totalValue', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Tipo de honorário</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditChange('feeType', 'percentage')}
                          className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                            editForm.feeType === 'percentage'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                              : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                          }`}
                        >
                          <Percent className="w-4 h-4" /> Percentual
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditChange('feeType', 'fixed')}
                          className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                            editForm.feeType === 'fixed'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                              : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                          }`}
                        >
                          <Hash className="w-4 h-4" /> Valor fixo
                        </button>
                      </div>
                    </div>
                  </div>

                  {editForm.feeType === 'percentage' ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Percentual de honorários (%)</label>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="0.5"
                          value={editForm.feePercentage}
                          onChange={(e) => handleEditChange('feePercentage', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                      </div>
                      <div className="bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 px-3 py-2 text-sm flex items-center">
                        Honorários: {editForm.totalValue && editForm.feePercentage ? formatCurrency(Number(editForm.totalValue) * (Number(editForm.feePercentage) / 100)) : '—'}
                      </div>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Valor fixo dos honorários</label>
                        <div className="relative">
                          <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.feeFixedValue}
                            onChange={(e) => handleEditChange('feeFixedValue', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            required
                          />
                        </div>
                      </div>
                      <div className="bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 px-3 py-2 text-sm flex items-center">
                        Honorários: {editForm.feeFixedValue ? formatCurrency(Number(editForm.feeFixedValue)) : '—'}
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Forma de pagamento</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditChange('paymentType', 'upfront')}
                          className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                            editForm.paymentType === 'upfront'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                              : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                          }`}
                        >
                          <DollarSign className="w-4 h-4" /> À vista
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditChange('paymentType', 'installments')}
                          className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                            editForm.paymentType === 'installments'
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                              : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                          }`}
                        >
                          <CalendarIcon className="w-4 h-4" /> Parcelado
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Data do primeiro vencimento</label>
                      <input
                        type="date"
                        value={editForm.firstDueDate}
                        onChange={(e) => handleEditChange('firstDueDate', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required={editForm.paymentType === 'upfront' || !editForm.customInstallments.length}
                      />
                    </div>
                  </div>

                  {editForm.paymentType === 'installments' && (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Número de parcelas</label>
                        <input
                          type="number"
                          min="2"
                          max="120"
                          value={editForm.installmentsCount}
                          onChange={(e) => handleEditChange('installmentsCount', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          required
                        />
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm flex items-center">
                        Parcela estimada: {editForm.totalValue && editForm.installmentsCount
                          ? formatCurrency(Number(editForm.totalValue) / Number(editForm.installmentsCount))
                          : '—'}
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Parcelas personalizadas (opcional)</label>
                        <button
                          type="button"
                          onClick={handleToggleEditCustomInstallments}
                          className="text-sm text-emerald-600 underline"
                        >
                          {editForm.customInstallments.length ? 'Remover parcelas personalizadas' : 'Definir parcelas manualmente'}
                        </button>
                      </div>
                      {editForm.customInstallments.length > 0 && (
                        <div className="md:col-span-2 border border-slate-200 rounded-xl overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                              <tr>
                                <th className="py-2 px-3 text-left">Parcela</th>
                                <th className="py-2 px-3 text-left">Data</th>
                                <th className="py-2 px-3 text-left">Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editForm.customInstallments.map((item, index) => (
                                <tr key={index} className="border-t border-slate-200">
                                  <td className="py-2 px-3">#{index + 1}</td>
                                  <td className="py-2 px-3">
                                    <input
                                      type="date"
                                      value={item.dueDate}
                                      onChange={(e) => handleEditCustomInstallmentChange(index, 'dueDate', e.target.value)}
                                      className="border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="relative">
                                      <DollarSign className="w-4 h-4 text-slate-400 absolute left-2 top-1.5" />
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.value}
                                        onChange={(e) => handleEditCustomInstallmentChange(index, 'value', e.target.value)}
                                        className="border border-slate-200 rounded-lg pl-7 pr-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="bg-slate-50 py-2 px-3 text-sm text-slate-600 flex justify-between">
                            <span>
                              Total personalizado: {
                                editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
                                  ? formatCurrency(editForm.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0))
                                  : '—'
                              }
                            </span>
                            <button
                              type="button"
                              onClick={handleEditRecalculateCustomInstallments}
                              className="text-emerald-600 underline"
                            >
                              Recalcular valores por parcela
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Status do acordo</label>
                      <select
                        value={editForm.status}
                        onChange={(e) => handleEditChange('status', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="ativo">Ativo</option>
                        <option value="concluido">Concluído</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Notas internas</label>
                      <textarea
                        value={editForm.notes}
                        onChange={(e) => handleEditChange('notes', e.target.value)}
                        placeholder="Observações internas..."
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        rows={2}
                      />
                    </div>
                  </div>
                </>
              )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Tem certeza que deseja excluir este acordo?')) {
                      handleDeleteAgreement(selectedAgreement);
                      handleCloseEditModal();
                    }
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-xs sm:text-sm px-4 py-2 rounded-lg transition"
                  disabled={editLoading}
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir Acordo
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="flex-1 sm:flex-none text-xs sm:text-sm font-semibold text-slate-500 hover:text-slate-700 px-4 py-2"
                    disabled={editLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={editLoading}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 transition-colors text-white font-semibold text-xs sm:text-sm px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg disabled:opacity-60"
                  >
                    {editLoading ? (
                      <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" /> Salvar alterações
                    </>
                  )}
                </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Parcelas Vencidas - Destaque */}
      {stats && stats.overdue_installments > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-2xl shadow-lg p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-red-600 text-white rounded-full p-3 animate-pulse">
                <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-red-900">⚠️ Atenção: Parcelas Vencidas</h3>
                <p className="text-xs sm:text-sm text-red-700 mt-1">
                  {stats.overdue_installments} parcela{stats.overdue_installments > 1 ? 's' : ''} com pagamento em atraso
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowOverdueOnly(!showOverdueOnly)}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-[0.98]"
            >
              {showOverdueOnly ? <X className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
              {showOverdueOnly ? 'Ocultar' : 'Ver Detalhes'}
            </button>
          </div>

          {showOverdueOnly && (
            <div className="space-y-3 mt-4 pt-4 border-t-2 border-red-200">
              {allInstallments
                .filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus) && inst.due_date < today)
                .sort((a, b) => a.due_date.localeCompare(b.due_date))
                .map(inst => {
                  const daysOverdue = Math.floor((new Date().getTime() - new Date(inst.due_date).getTime()) / (1000 * 60 * 60 * 24));
                  const clientName = inst.agreement ? getClientName(inst.agreement.client_id) : 'Cliente não encontrado';
                  return (
                    <div key={inst.id} className="bg-white border-2 border-red-300 rounded-xl p-4 hover:shadow-md transition">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="bg-red-600 text-white rounded-full w-12 h-12 flex items-center justify-center font-bold text-lg">
                            {inst.installment_number}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded uppercase">
                                Cliente em Atraso
                              </span>
                            </div>
                            <p className="text-lg font-bold text-slate-900">{clientName}</p>
                            <p className="text-sm text-slate-600 mt-1">
                              {inst.agreement?.title || 'Acordo não encontrado'}
                            </p>
                            <div className="flex items-center gap-3 mt-2">
                              <p className="text-sm text-red-700 font-semibold flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                Venceu há {daysOverdue} dia{daysOverdue > 1 ? 's' : ''}
                              </p>
                              <p className="text-sm text-slate-500">
                                📅 {new Date(inst.due_date).toLocaleDateString('pt-BR', { 
                                  day: '2-digit', 
                                  month: 'long', 
                                  year: 'numeric' 
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-red-900">{formatCurrency(inst.value)}</p>
                          {inst.agreement && (
                            <p className="text-xs text-emerald-600 mt-1">
                              💰 Honorário: {formatCurrency(inst.agreement.fee_value / inst.agreement.installments_count)}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (inst.agreement) {
                              setSelectedAgreement(inst.agreement);
                              handleOpenPaymentModal(inst);
                            }
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-lg font-semibold transition flex items-center gap-2 shadow-lg"
                        >
                          <CheckCircle className="w-5 h-5" /> Dar Baixa
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Header Principal Simplificado */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 xl:px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Título e resumo */}
            <div className="flex items-start gap-3">
              <div className="bg-emerald-100 text-emerald-700 p-2 rounded-lg">
                <PiggyBank className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Módulo Financeiro</p>
                <h1 className="text-2xl font-bold text-slate-900 leading-tight">Acordos e recebíveis</h1>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs font-medium">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {filteredAgreements.filter(a => a.status === 'ativo').length} ativos
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                    {filteredAgreements.filter(a => a.status === 'concluido').length} concluídos
                  </span>
                  <span className="text-slate-400 hidden sm:inline">•</span>
                  <span className="text-slate-500">Monitorando clientes e próximos vencimentos.</span>
                </div>
              </div>
            </div>

            {/* Barra de Ferramentas */}
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              {/* Busca */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                />
              </div>

              {/* Filtros */}
              <div className="flex gap-2">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
                >
                  <option value="all">Status: Todos</option>
                  <option value="ativo">Ativos</option>
                  <option value="concluido">Concluídos</option>
                  <option value="cancelado">Cancelados</option>
                </select>

                <select
                  value={filterPaymentStatus}
                  onChange={(e) => setFilterPaymentStatus(e.target.value as any)}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
                >
                  <option value="all">Pagamento: Todos</option>
                  <option value="with_pending">Pendentes</option>
                  <option value="fully_paid">Pagos</option>
                </select>
              </div>

              {/* Ações Principais */}
              <div className="flex gap-2 border-t border-slate-200 pt-2 mt-2 sm:border-t-0 sm:pt-0 sm:mt-0 sm:border-l sm:pl-2 sm:ml-2">
                <button
                  onClick={() => setIsReportModalOpen(true)}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Relatório Mensal"
                >
                  <FileBarChart className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsIRModalOpen(true)}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Relatório IR"
                >
                  <FileSpreadsheet className="w-5 h-5" />
                </button>
                <button
                  onClick={handleOpenModal}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm sm:ml-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  Novo acordo
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de Acordos */}
      <div className="max-w-[1600px] mx-auto px-4 xl:px-6 py-6 space-y-6">
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
                ? 'Comece criando um novo acordo financeiro clicando no botão "Novo Acordo" acima.'
                : 'Tente ajustar os filtros ou usar termos diferentes na busca para encontrar o que procura.'}
            </p>
            {agreements.length === 0 && (
              <button
                onClick={handleOpenModal}
                className="mt-8 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:scale-105"
              >
                <PlusCircle className="w-5 h-5" />
                Criar Primeiro Acordo
              </button>
            )}
          </div>
        ) : (
          <>
          {/* Acordos Ativos */}
          {(() => {
            const activeAgreements = filteredAgreements.filter(a => a.status === 'ativo');
            if (activeAgreements.length === 0) return null;
            
            return (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="px-4 pb-6 sm:px-6">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[...activeAgreements]
                      .sort((a, b) => {
                        const getNextDueTimestamp = (agreementId: string) => {
                          const related = allInstallments.filter(inst => inst.agreement_id === agreementId);
                          if (related.length === 0) return Number.POSITIVE_INFINITY;
                          const pending = related.filter(inst => pendingStatuses.includes(inst.status as InstallmentStatus));
                          const reference = pending.length > 0 ? pending : related;
                          const ordered = [...reference].sort((x, y) => new Date(x.due_date).getTime() - new Date(y.due_date).getTime());
                          return new Date(ordered[0].due_date).getTime();
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
                      .sort((aInst, bInst) => new Date(aInst.due_date).getTime() - new Date(bInst.due_date).getTime());
                    const nextDueFallback = [...pendingInstallments, ...agreementInstallments]
                      .sort((aInst, bInst) => new Date(aInst.due_date).getTime() - new Date(bInst.due_date).getTime());
                    const nextDue = futurePending[0] ?? nextDueFallback[0];
                    const nextDueDate = nextDue ? new Date(nextDue.due_date) : null;
                    const nextDueLabel = nextDueDate
                      ? nextDueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                      : 'Sem parcelas';
                    const diffDays = nextDueDate
                      ? Math.ceil((nextDueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
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
                        className="group relative flex cursor-pointer flex-col gap-5 rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-slate-50 to-slate-100/60 p-6 shadow-[0_15px_40px_rgba(15,23,42,0.05)] backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_20px_45px_rgba(16,185,129,0.15)]"
                        style={{ animationDelay: `${index * 45}ms` }}
                        onClick={() => handleOpenDetails(agreement)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Ativo
                              </span>
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">• #{agreement.id.slice(0, 6)}</span>
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900" title={agreement.title}>
                              {agreement.title}
                            </h3>
                            <p className="text-sm text-slate-500 flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-slate-400" />
                              {getClientName(agreement.client_id)}
                            </p>
                          </div>
                          <div className="text-right">
                            {isFullyPaid ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 uppercase">
                                ✓ Pago
                              </span>
                            ) : overdueInstallments.length > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-[11px] font-semibold text-red-700 uppercase">
                                ⚠ {overdueInstallments.length} atraso{overdueInstallments.length > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 uppercase">
                                {pendingInstallments.length} pendente{pendingInstallments.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {agreement.payment_type === 'upfront' ? 'À vista' : `${agreement.installments_count} parcelas`}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-4 rounded-2xl border border-white/70 bg-white/60 p-4 text-sm text-slate-600 shadow-inner">
                          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white/80 px-3 py-2">
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-400">Próximo vencimento</p>
                              <p className="text-sm font-semibold text-slate-900">{nextDueLabel}</p>
                            </div>
                            {relativeDueLabel && (
                              <span className={`text-xs font-semibold ${diffDays !== null && diffDays < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                {relativeDueLabel}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-400">Valor total</p>
                              <p className="text-lg font-semibold text-slate-900">{formatCurrency(agreement.total_value)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-slate-400">Honorários</p>
                              <p className="text-lg font-semibold text-emerald-600">{formatCurrency(agreement.fee_value)}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-xs font-semibold text-slate-500">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">Pagas</span>
                              <span className="text-sm text-slate-800">{paidInstallments.length}</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">Pendentes</span>
                              <span className="text-sm text-amber-600">{pendingInstallments.length}</span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">Atraso</span>
                              <span className="text-sm text-red-500">{overdueInstallments.length}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                            <span>Progresso</span>
                            <span className="text-slate-700">{paidInstallments.length}/{agreementInstallments.length}</span>
                          </div>
                          <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isFullyPaid
                                  ? 'bg-gradient-to-r from-emerald-300 via-emerald-500 to-emerald-600'
                                  : overdueInstallments.length > 0
                                  ? 'bg-gradient-to-r from-red-300 via-red-500 to-red-600'
                                  : 'bg-gradient-to-r from-blue-300 via-blue-500 to-indigo-600'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                            <span className="absolute inset-0 rounded-full border border-white/20" />
                          </div>
                        </div>

                        <div className="flex items-end justify-between gap-4 border-t border-white/60 pt-4">
                          <div className="text-xs text-slate-500">
                            <p className="font-semibold text-slate-400">Próximo passo</p>
                            {overdueInstallments.length > 0 ? (
                              <p className="text-red-600">Regularizar parcelas em atraso</p>
                            ) : pendingInstallments.length > 0 ? (
                              <p className="text-slate-700">Monitorar parcelas pendentes</p>
                            ) : (
                              <p className="text-emerald-600">Todo o acordo pago</p>
                            )}
                          </div>
                          <div className="flex gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditModal(agreement);
                              }}
                              className="rounded-xl border border-slate-200/70 bg-white/80 p-2 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-600"
                              title="Editar acordo"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAgreement(agreement);
                              }}
                              className="rounded-xl border border-slate-200/70 bg-white/80 p-2 text-slate-500 transition hover:border-red-200 hover:bg-red-50/70 hover:text-red-600"
                              title="Excluir acordo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Acordos Concluídos */}
          {(() => {
            const completedAgreements = filteredAgreements.filter(a => a.status === 'concluido');
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
                <div className="divide-y divide-slate-100">
                  {displayedAgreements.map((agreement, index) => {
                    const agreementInstallments = allInstallments.filter(inst => inst.agreement_id === agreement.id);
                    const paidInstallments = agreementInstallments.filter(inst => inst.status === 'pago');
                    const isFullyPaid = agreementInstallments.length > 0 && paidInstallments.length === agreementInstallments.length;

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
                            <span className="text-emerald-600 font-semibold">{isFullyPaid ? 'Pago integralmente' : 'Recebido parcialmente'}</span>
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
            const canceledAgreements = filteredAgreements.filter(a => a.status === 'cancelado');
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
                  {canceledAgreements.map((agreement) => {
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

      {/* Modal de novo acordo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleCloseModal} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200/80 animate-in zoom-in-95 duration-200">
            {/* Header Minimalista */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex-shrink-0 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <PiggyBank className="w-5 h-5 text-slate-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">Novo Acordo</h3>
                    <p className="text-xs sm:text-sm text-slate-500 hidden sm:block">Preencha os dados financeiros abaixo</p>
                  </div>
                </div>
                <button 
                  onClick={handleCloseModal} 
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-2 rounded-lg transition-all duration-200 flex-shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                  {formError}
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <ClientSearchSelect
                  value={formData.clientId}
                  onChange={(clientId) => handleChange('clientId', clientId)}
                  label="Cliente"
                  placeholder="Buscar cliente..."
                  required
                  allowCreate={true}
                />
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Processo (opcional)</label>
                  <input
                    type="text"
                    placeholder="ID do processo vinculado"
                    value={formData.processId}
                    onChange={(e) => handleChange('processId', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Título do acordo</label>
                  <input
                    type="text"
                    placeholder="Ex: Acordo trabalhista - Rescisão"
                    value={formData.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Data do acordo</label>
                  <input
                    type="date"
                    value={formData.agreementDate}
                    onChange={(e) => handleChange('agreementDate', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Descrição (opcional)</label>
                <textarea
                  placeholder="Detalhes do acordo, condições específicas, observações..."
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={3}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Valor total do acordo</label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.totalValue}
                      onChange={(e) => handleChange('totalValue', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Tipo de honorário</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleChange('feeType', 'percentage')}
                      className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                        formData.feeType === 'percentage'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                      }`}
                    >
                      <Percent className="w-4 h-4" /> Percentual
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('feeType', 'fixed')}
                      className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                        formData.feeType === 'fixed'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                      }`}
                    >
                      <Hash className="w-4 h-4" /> Valor fixo
                    </button>
                  </div>
                </div>
              </div>

              {formData.feeType === 'percentage' ? (
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Percentual de honorários (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="0.5"
                      value={formData.feePercentage}
                      onChange={(e) => handleChange('feePercentage', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>
                  <div className="bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 px-3 py-2 text-sm">
                    Honorários previstos: {formData.totalValue ? formatCurrency(Number(formData.totalValue) * (Number(formData.feePercentage || '0') / 100)) : '—'}
                  </div>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Valor fixo dos honorários</label>
                    <div className="relative">
                      <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.feeFixedValue}
                        onChange={(e) => handleChange('feeFixedValue', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>
                  </div>
                  <div className="bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 px-3 py-2 text-sm">
                    Honorários previstos: {formData.feeFixedValue ? formatCurrency(Number(formData.feeFixedValue)) : '—'}
                  </div>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Forma de pagamento</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleChange('paymentType', 'upfront')}
                      className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                        formData.paymentType === 'upfront'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                      }`}
                    >
                      <DollarSign className="w-4 h-4" /> À vista
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('paymentType', 'installments')}
                      className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-2 justify-center transition ${
                        formData.paymentType === 'installments'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                      }`}
                    >
                      <CalendarIcon className="w-4 h-4" /> Parcelado
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Data do primeiro vencimento</label>
                  <input
                    type="date"
                    value={formData.firstDueDate}
                    onChange={(e) => handleChange('firstDueDate', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required={formData.paymentType === 'upfront' || !formData.customInstallments.length}
                  />
                </div>
              </div>

              {formData.paymentType === 'installments' && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Número de parcelas</label>
                    <input
                      type="number"
                      min="2"
                      max="120"
                      value={formData.installmentsCount}
                      onChange={(e) => handleChange('installmentsCount', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    Parcela estimada: {formData.totalValue && formData.installmentsCount
                      ? formatCurrency(Number(formData.totalValue) / Number(formData.installmentsCount))
                      : '—'}
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Parcelas personalizadas (opcional)</label>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          customInstallments: prev.customInstallments.length
                            ? []
                            : Array.from({ length: Number(prev.installmentsCount || '0') }, (_, index) => ({
                                dueDate: index === 0 ? prev.firstDueDate : '',
                                value: prev.totalValue && prev.installmentsCount ? (
                                  Number(prev.totalValue) / Number(prev.installmentsCount)
                                ).toFixed(2) : '',
                              })),
                        }))
                      }
                      className="text-sm text-emerald-600 underline"
                    >
                      {formData.customInstallments.length ? 'Remover parcelas personalizadas' : 'Definir parcelas manualmente'}
                    </button>
                  </div>
                  {formData.customInstallments.length > 0 && (
                    <div className="md:col-span-2 border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                          <tr>
                            <th className="py-2 px-3 text-left">Parcela</th>
                            <th className="py-2 px-3 text-left">Data</th>
                            <th className="py-2 px-3 text-left">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.customInstallments.map((item, index) => (
                            <tr key={index} className="border-t border-slate-200">
                              <td className="py-2 px-3">#{index + 1}</td>
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
                                  className="border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <div className="relative">
                                  <DollarSign className="w-4 h-4 text-slate-400 absolute left-2 top-1.5" />
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.value}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      setFormData((prev) => ({
                                        ...prev,
                                        customInstallments: prev.customInstallments.map((ci, ciIndex) =>
                                          ciIndex === index ? { ...ci, value } : ci
                                        ),
                                      }));
                                    }}
                                    className="border border-slate-200 rounded-lg pl-7 pr-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="bg-slate-50 py-2 px-3 text-sm text-slate-600 flex justify-between">
                        <span>
                          Total personalizado: {
                            formData.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
                              ? formatCurrency(formData.customInstallments.reduce((sum, item) => sum + (Number(item.value) || 0), 0))
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
                                    ? (
                                        Number(prev.totalValue) / Number(prev.installmentsCount)
                                      ).toFixed(2)
                                    : item.value,
                              })),
                            }))
                          }
                          className="text-emerald-600 underline"
                        >
                          Recalcular valores por parcela
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase mb-1 block">Notas internas (opcional)</label>
                <textarea
                  placeholder="Informações importantes para a equipe financeira..."
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={3}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                  disabled={formLoading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 transition-colors text-white font-semibold text-sm px-5 py-2.5 rounded-lg disabled:opacity-60"
                >
                  {formLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                    </>
                  ) : (
                    <>
                      <PlusCircle className="w-4 h-4" /> Criar acordo
                    </>
                  )}
                </button>
              </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Detalhes do Acordo */}
      {isDetailsModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={handleCloseDetails} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
            {/* Header Minimalista */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex-shrink-0 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <FileText className="w-5 h-5 text-slate-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">{selectedAgreement.title}</h3>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5 flex items-center gap-1.5 truncate">
                      <User className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                      <span className="truncate">{getClientName(selectedAgreement.client_id)}</span>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handleCloseDetails} 
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-2 rounded-lg transition-all duration-200 flex-shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Resumo do Acordo */}
              <div className="px-4 sm:px-6 py-4 sm:py-6 border-b border-slate-200">
                <h4 className="text-base sm:text-lg font-semibold text-slate-900 mb-3 sm:mb-4">📋 Resumo do Acordo</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                  <div className="bg-slate-50 rounded-lg p-3 sm:p-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Valor Total</p>
                    <p className="text-lg sm:text-2xl font-bold text-slate-900">{formatCurrency(agreementSummary?.totalValue || selectedAgreement.total_value)}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4">
                    <p className="text-xs text-emerald-600 uppercase mb-1">Honorários ({selectedAgreement.fee_type === 'percentage' ? `${selectedAgreement.fee_percentage}%` : 'Fixo'})</p>
                    <p className="text-2xl font-bold text-emerald-700">{formatCurrency(agreementSummary?.feeValue || selectedAgreement.fee_value)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-blue-600 uppercase mb-1">Valor Líquido Cliente</p>
                    <p className="text-2xl font-bold text-blue-700">{formatCurrency(agreementSummary?.netValue || selectedAgreement.net_value)}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-4 gap-4 mt-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1">Data do Acordo</p>
                    <p className="text-sm font-semibold text-slate-900">{new Date(selectedAgreement.agreement_date).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1">Forma de Pagamento</p>
                    <p className="text-sm font-semibold text-slate-900">{selectedAgreement.payment_type === 'upfront' ? 'À Vista' : 'Parcelado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1">Parcelas</p>
                    <p className="text-sm font-semibold text-slate-900">{(agreementSummary?.installmentsCount || selectedAgreement.installments_count)}x de {formatCurrency(agreementSummary?.installmentValue || selectedAgreement.installment_value)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase mb-1">Status</p>
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedAgreement.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                      selectedAgreement.status === 'concluido' ? 'bg-blue-100 text-blue-700' :
                      selectedAgreement.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {selectedAgreement.status.charAt(0).toUpperCase() + selectedAgreement.status.slice(1)}
                    </span>
                  </div>
                </div>

                {selectedAgreement.description && (
                  <div className="mt-4">
                    <p className="text-xs text-slate-500 uppercase mb-1">Descrição</p>
                    <p className="text-sm text-slate-700">{selectedAgreement.description}</p>
                  </div>
                )}
              </div>

              {/* Ações Rápidas */}
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">⚡ Ações Rápidas</h4>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleGenerateReceipt(selectedAgreement)}
                    className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <FileText className="w-4 h-4" /> Gerar Recibo
                  </button>
                  <button
                    onClick={() => handleAddDeadline(selectedAgreement)}
                    className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <CalendarIcon className="w-4 h-4" /> Adicionar Prazo
                  </button>
                  <button
                    onClick={() => handleExportAgreement(selectedAgreement)}
                    className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <Download className="w-4 h-4" /> Exportar Dados
                  </button>
                  <button
                    onClick={() => handleDeleteAgreement(selectedAgreement)}
                    className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <Trash2 className="w-4 h-4" /> Excluir Acordo
                  </button>
                  <button
                    onClick={() => handleOpenEditModal(selectedAgreement)}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    <Edit className="w-4 h-4" /> Editar Acordo
                  </button>
                </div>
              </div>

              {/* Parcelas */}
              <div className="px-6 py-6">
                <h4 className="text-lg font-semibold text-slate-900 mb-4">💳 Parcelas e Pagamentos</h4>
                
                {loadingInstallments ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                  </div>
                ) : installments.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Nenhuma parcela encontrada</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {installments.map((installment, index) => {
                      const isOverdue = pendingStatuses.includes(installment.status as InstallmentStatus) && installment.due_date < today;
                      const isPaid = installment.status === 'pago';
                      const daysOverdue = isOverdue ? Math.floor((new Date().getTime() - new Date(installment.due_date).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                      const paymentMethodLabels = {
                        dinheiro: '💵 Dinheiro',
                        pix: '📱 PIX',
                        transferencia: '🏦 Transferência',
                        cheque: '📝 Cheque',
                        cartao_credito: '💳 Cartão de Crédito',
                        cartao_debito: '💳 Cartão de Débito',
                      };
                      
                      return (
                        <div
                          key={installment.id}
                          className={`rounded-xl transition ${
                            isPaid ? 'border border-emerald-100 bg-white' :
                            isOverdue ? 'border-2 border-red-400 bg-red-50 shadow-lg' :
                            'border-2 border-slate-200 bg-white'
                          }`}
                        >
                          {/* PAGAMENTO CONCLUÍDO - minimalista */}
                          {isPaid ? (
                            <div className="p-3 sm:p-4">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full border border-emerald-200 flex items-center justify-center">
                                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <p className="text-[11px] font-semibold text-emerald-600 tracking-wide uppercase">Pagamento concluído</p>
                                    <p className="text-[11px] text-slate-500">
                                      Parcela {installment.installment_number}/{selectedAgreement.installments_count} · Recebido em {new Date(installment.payment_date!).toLocaleDateString('pt-BR')}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-lg font-semibold text-slate-900">
                                    {formatCurrency(installment.paid_value || installment.value)}
                                  </p>
                                  <p className="text-[11px] text-slate-500">Valor recebido</p>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
                                <p>
                                  <span className="uppercase text-[10px] tracking-wide text-slate-400 mr-1">Método:</span>
                                  <span className="text-slate-700 font-medium">
                                    {installment.payment_method ? paymentMethodLabels[installment.payment_method] : 'Não informado'}
                                  </span>
                                </p>
                                <p>
                                  <span className="uppercase text-[10px] tracking-wide text-slate-400 mr-1">Vencimento:</span>
                                  <span className="text-slate-700 font-medium">
                                    {new Date(installment.due_date).toLocaleDateString('pt-BR')}
                                  </span>
                                  {installment.payment_date && (
                                    <span className={`ml-2 ${new Date(installment.payment_date) > new Date(installment.due_date) ? 'text-orange-600' : 'text-emerald-600'}`}>
                                      {new Date(installment.payment_date) > new Date(installment.due_date) ? 'Pago com atraso' : 'Pago em dia'}
                                    </span>
                                  )}
                                </p>
                                <p>
                                  <span className="uppercase text-[10px] tracking-wide text-slate-400 mr-1">Honorários:</span>
                                  <span className="text-slate-700 font-medium">
                                    {formatCurrency(selectedAgreement.fee_value / selectedAgreement.installments_count)}
                                  </span>
                                  <span className="ml-1 text-slate-500">({selectedAgreement.fee_type === 'percentage' ? `${selectedAgreement.fee_percentage}%` : 'Valor fixo'})</span>
                                </p>
                              </div>

                              {installment.notes && (
                                <p className="mt-2 text-[11px] text-slate-500">
                                  <span className="uppercase text-[10px] tracking-wide text-slate-400 mr-1">Observações:</span>
                                  {installment.notes}
                                </p>
                              )}

                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={() => handleGenerateReceipt(selectedAgreement, installment)}
                                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                                  title="Gerar recibo desta parcela"
                                >
                                  <Receipt className="w-3 h-3" />
                                  Gerar recibo
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* PAGAMENTO PENDENTE - Design Original Melhorado */
                            <div className="p-4">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4 flex-1">
                                  <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                                    isOverdue ? 'bg-red-600 text-white animate-pulse' :
                                    'bg-slate-300 text-slate-700'
                                  }`}>
                                    {installment.installment_number}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      {isOverdue && (
                                        <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded uppercase">
                                          ⚠️ VENCIDA
                                        </span>
                                      )}
                                      {!isOverdue && (
                                        <span className="bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded uppercase">
                                          ⏳ PENDENTE
                                        </span>
                                      )}
                                    </div>
                                    <p className="font-semibold text-slate-900">Parcela {installment.installment_number}/{selectedAgreement.installments_count}</p>
                                    <p className="text-sm text-slate-600 mt-1">
                                      📅 Vencimento: {new Date(installment.due_date).toLocaleDateString('pt-BR', { 
                                        day: '2-digit', 
                                        month: 'long', 
                                        year: 'numeric' 
                                      })}
                                    </p>
                                    {isOverdue && (
                                      <p className="text-sm text-red-700 font-bold mt-1 flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        Atrasada há {daysOverdue} dia{daysOverdue > 1 ? 's' : ''}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-3">
                                  <div className="text-right">
                                    <p className={`text-xl font-bold ${isOverdue ? 'text-red-900' : 'text-slate-900'}`}>
                                      {formatCurrency(installment.value)}
                                    </p>
                                    <p className="text-xs text-emerald-600 mt-1">
                                      💰 Honorário: {formatCurrency(selectedAgreement.fee_value / selectedAgreement.installments_count)}
                                    </p>
                                  </div>
                                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                                    <button
                                      onClick={() => handleOpenPaymentModal(installment)}
                                      className={`${isOverdue ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-4 sm:px-5 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2 shadow-lg w-full sm:w-auto`}
                                    >
                                      <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" /> Dar Baixa
                                    </button>
                                  </div>
                                </div>
                              </div>
                              {installment.notes && (
                                <div className="mt-3 pt-3 border-t border-slate-200">
                                  <p className="text-xs text-slate-500 uppercase mb-1">📝 Observações</p>
                                  <p className="text-sm text-slate-700">{installment.notes}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notas Internas */}
              {selectedAgreement.notes && (
                <div className="px-6 py-4 border-t border-slate-200 bg-amber-50">
                  <h4 className="text-sm font-semibold text-amber-900 mb-2">📝 Notas Internas</h4>
                  <p className="text-sm text-amber-800">{selectedAgreement.notes}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
              <p className="text-xs text-slate-500">
                Criado em {new Date(selectedAgreement.created_at).toLocaleDateString('pt-BR')} às {new Date(selectedAgreement.created_at).toLocaleTimeString('pt-BR')}
              </p>
              <button
                onClick={handleCloseDetails}
                className="bg-slate-600 hover:bg-slate-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Baixa de Pagamento */}
      {isPaymentModalOpen && selectedInstallment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header Minimalista */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex-shrink-0 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <CheckCircle className="w-5 h-5 text-slate-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg sm:text-xl font-semibold text-slate-900 truncate">Dar Baixa</h3>
                    <p className="text-xs sm:text-sm text-slate-500 mt-0.5 truncate">
                      Parcela {selectedInstallment.installment_number}/{selectedAgreement?.installments_count} - {new Date(selectedInstallment.due_date).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handleClosePaymentModal} 
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-2 rounded-lg transition-all duration-200 flex-shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5 space-y-4 sm:space-y-5">
              {/* Valor da Parcela */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-emerald-600 uppercase font-semibold mb-1">Valor da Parcela</p>
                    <p className="text-3xl font-bold text-emerald-700">{formatCurrency(selectedInstallment.value)}</p>
                  </div>
                  <Receipt className="w-12 h-12 text-emerald-600 opacity-50" />
                </div>
              </div>

              {/* Data do Pagamento */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">📅 Data do Pagamento</label>
                <input
                  type="date"
                  value={paymentData.paymentDate}
                  onChange={(e) => setPaymentData(prev => ({ ...prev, paymentDate: e.target.value }))}
                  className="w-full border-2 border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>

              {/* Método de Pagamento */}
              <div>
                <label className="text-xs sm:text-sm font-semibold text-slate-700 mb-2 block">💰 Método de Pagamento</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'pix' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'pix'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <Smartphone className="w-5 h-5" />
                    PIX
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'transferencia' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'transferencia'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <Building className="w-5 h-5" />
                    Transferência
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'dinheiro' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'dinheiro'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <Banknote className="w-5 h-5" />
                    Dinheiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'cartao_credito' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'cartao_credito'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                    Cartão Créd.
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'cartao_debito' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'cartao_debito'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <CreditCard className="w-5 h-5" />
                    Cartão Déb.
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentData(prev => ({ ...prev, paymentMethod: 'cheque' }))}
                    className={`border-2 rounded-lg px-3 py-3 text-sm font-medium transition flex flex-col items-center gap-2 ${
                      paymentData.paymentMethod === 'cheque'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}
                  >
                    <FileText className="w-5 h-5" />
                    Cheque
                  </button>
                </div>
              </div>

              {/* Valor Pago */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">💵 Valor Pago</label>
                <div className="relative">
                  <DollarSign className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentData.paidValue}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, paidValue: e.target.value }))}
                    className="w-full border-2 border-slate-200 rounded-lg pl-12 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="0,00"
                  />
                </div>
                {paymentData.paidValue && Number(paymentData.paidValue) !== selectedInstallment.value && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Valor diferente da parcela original
                  </p>
                )}
              </div>

              {/* Observações */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">📝 Observações (opcional)</label>
                <textarea
                  value={paymentData.notes}
                  onChange={(e) => setPaymentData(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full border-2 border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  rows={3}
                  placeholder="Ex: Comprovante anexado, desconto concedido, etc..."
                />
              </div>

              {/* Alerta de Inadimplência */}
              {selectedInstallment.due_date < new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] && (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Bell className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-900">⚠️ Parcela com mais de 2 dias de atraso</p>
                      <p className="text-xs text-red-700 mt-1">
                        Esta parcela está vencida há mais de 2 dias. Considere enviar notificação de inadimplemento ao cliente.
                      </p>
                      <button
                        onClick={() => toast.info('Em breve', 'Funcionalidade de denúncia de inadimplemento será implementada')}
                        className="mt-2 text-xs font-semibold text-red-600 underline hover:text-red-700"
                      >
                        Gerar Notificação de Inadimplemento
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500 hidden sm:block">
                ✓ Certifique-se de que todos os dados estão corretos
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClosePaymentModal}
                  className="flex-1 sm:flex-none px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmPayment}
                  disabled={!paymentData.paymentDate || !paymentData.paymentMethod || !paymentData.paidValue}
                  className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:shadow-none active:scale-[0.98]"
                  title={!paymentData.paymentDate || !paymentData.paymentMethod || !paymentData.paidValue ? 'Preencha todos os campos obrigatórios' : ''}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200/80 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 sticky top-0">
              <div>
                <h3 className="text-xl font-bold text-slate-900">📊 Relatório Mensal para Imposto de Renda</h3>
                <p className="text-sm text-slate-600 mt-1">Receitas de honorários advocatícios</p>
              </div>
              <button onClick={() => setIsReportModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
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
                onClick={() => setIsReportModalOpen(false)}
                className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition"
              >
                Fechar
              </button>
              <button
                onClick={handleExportMonthlyReport}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200/80">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-red-50 to-orange-50">
              <div>
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-6 h-6 text-red-600" />
                  Relatório de Imposto de Renda
                </h3>
                <p className="text-sm text-slate-600 mt-1">Selecione o ano para gerar o relatório</p>
              </div>
              <button onClick={() => setIsIRModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-6">
              {availableYears.length === 0 ? (
                <div className="text-center py-8">
                  <FileSpreadsheet className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 font-medium mb-2">Nenhum pagamento registrado</p>
                  <p className="text-sm text-slate-500">
                    Registre pagamentos de honorários para gerar relatórios de IR
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 mb-4">
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
                        className="w-full border-2 border-slate-200 hover:border-red-500 hover:bg-red-50 rounded-xl p-4 transition text-left group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="bg-red-600 group-hover:bg-red-700 text-white rounded-lg w-12 h-12 flex items-center justify-center font-bold text-lg transition">
                              {year}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 group-hover:text-red-900">Ano {year}</p>
                              <p className="text-sm text-slate-600">
                                {yearPayments.length} pagamento{yearPayments.length > 1 ? 's' : ''} registrado{yearPayments.length > 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-emerald-700">{formatCurrency(yearTotal)}</p>
                            <p className="text-xs text-slate-500">Total recebido</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
              <p className="text-xs text-slate-500 text-center">
                💡 O relatório incluirá todos os honorários recebidos no ano selecionado
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialModule;
