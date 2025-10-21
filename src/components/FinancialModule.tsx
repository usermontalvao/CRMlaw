import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PiggyBank,
  TrendingUp,
  PlusCircle,
  Loader2,
  X,
  Percent,
  Hash,
  CalendarIcon,
  DollarSign,
  Edit,
  Eye,
  CheckCircle,
  FileText,
  Download,
  Clock,
  AlertCircle,
  CreditCard,
  Banknote,
  Building,
  Smartphone,
  Receipt,
  FileSpreadsheet,
  Bell,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  TrendingDown,
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
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
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
  const [allInstallments, setAllInstallments] = useState<(Installment & { agreement?: Agreement })[]>([]);
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editInitialLoading, setEditInitialLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isIRModalOpen, setIsIRModalOpen] = useState(false);
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

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.full_name || (client as any)?.name || 'Cliente não encontrado';
  };

  const filteredAgreements = useMemo(() => {
    return agreements.filter(agreement => {
      const matchesSearch = 
        agreement.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getClientName(agreement.client_id).toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === 'all' || agreement.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [agreements, searchTerm, filterStatus, clients]);

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

      const userMeta = (user?.user_metadata as any) || {};
      const lawyerName = userMeta.full_name || userMeta.name || userMeta.display_name || 'Advogado Responsável';
      const lawyerCpf = userMeta.cpf || userMeta.document || '';
      const lawyerOab = userMeta.oab || userMeta.oab_number || userMeta.oabNumber || '';
      const lawyerState = userMeta.oab_state || userMeta.oabState || userMeta.estado_oab || 'XX';
      const lawyerAddress = userMeta.address || userMeta.endereco || '';
      const lawyerEmail = user?.email || '';
      const lawyerPhone = userMeta.phone || userMeta.telefone || '';

      const totalReceived = Array.from(clientPayments.values()).reduce((sum, entry) => sum + entry.total, 0);
      const issueDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório de Honorários para Imposto de Renda ${year}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    @media print {
      body { margin: 0; padding: 0; background: white; }
      .no-print { display: none !important; }
      .report-container { box-shadow: none; page-break-inside: avoid; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      background: #f5f5f5;
      padding: 20px;
      color: #2c3e50;
      line-height: 1.6;
    }
    .report-container {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      padding: 30mm 20mm;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border: 3px double #c62828;
      padding: 20px;
      margin-bottom: 30px;
      background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
    }
    .header h1 {
      font-size: 24px;
      color: #c62828;
      font-weight: 700;
      margin-bottom: 10px;
      text-transform: uppercase;
    }
    .header .year {
      font-size: 32px;
      font-weight: 900;
      color: #b71c1c;
      margin: 10px 0;
    }
    .summary-box {
      background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
      border: 3px solid #4caf50;
      border-radius: 8px;
      padding: 25px;
      margin: 30px 0;
      text-align: center;
    }
    .summary-label {
      font-size: 14px;
      color: #2e7d32;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .summary-value {
      font-size: 42px;
      font-weight: 800;
      color: #1b5e20;
      margin: 10px 0;
    }
    .section-title {
      background: #c62828;
      color: white;
      padding: 10px 15px;
      font-size: 14px;
      font-weight: 600;
      margin: 30px 0 15px 0;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 12px;
    }
    .data-table thead {
      background: #37474f;
      color: white;
    }
    .data-table th {
      padding: 10px;
      text-align: left;
      font-weight: 600;
      border: 1px solid #546e7a;
    }
    .data-table td {
      padding: 8px 10px;
      border: 1px solid #e0e0e0;
    }
    .data-table tbody tr:nth-child(even) {
      background: #f5f5f5;
    }
    .data-table tbody tr:hover {
      background: #e3f2fd;
    }
    .total-row {
      background: #fff3e0 !important;
      font-weight: 700;
      border-top: 3px solid #ff9800 !important;
    }
    .lawyer-info {
      background: #e3f2fd;
      border: 2px solid #2196f3;
      border-radius: 8px;
      padding: 20px;
      margin: 25px 0;
    }
    .lawyer-info h3 {
      color: #1565c0;
      font-size: 16px;
      margin-bottom: 12px;
      border-bottom: 2px solid #2196f3;
      padding-bottom: 8px;
    }
    .lawyer-info p {
      margin: 6px 0;
      font-size: 13px;
    }
    .ir-instructions {
      background: #fff3e0;
      border-left: 4px solid #ff9800;
      padding: 20px;
      margin: 25px 0;
      font-size: 13px;
      line-height: 1.8;
    }
    .ir-instructions h3 {
      color: #e65100;
      margin-bottom: 15px;
      font-size: 16px;
    }
    .ir-instructions ul {
      margin-left: 20px;
      margin-top: 10px;
    }
    .ir-instructions li {
      margin: 8px 0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px dashed #ccc;
      font-size: 11px;
      color: #777;
      text-align: center;
    }
    .print-button {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: linear-gradient(135deg, #c62828 0%, #b71c1c 100%);
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 50px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(198, 40, 40, 0.4);
      transition: all 0.3s;
      z-index: 1000;
    }
    .print-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(198, 40, 40, 0.6);
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header">
      <h1>📊 RELATÓRIO DE HONORÁRIOS ADVOCATÍCIOS</h1>
      <div class="year">ANO-BASE ${year}</div>
      <p style="font-size: 12px; color: #666; margin-top: 10px;">Para fins de Declaração de Imposto de Renda Pessoa Física</p>
      <p style="font-size: 11px; color: #999; margin-top: 5px;">Emitido em ${issueDate}</p>
    </div>

    <div class="summary-box">
      <div class="summary-label">💰 Total de Honorários Recebidos em ${year}</div>
      <div class="summary-value">${formatCurrency(totalReceived)}</div>
      <p style="font-size: 13px; color: #2e7d32; margin-top: 10px;">
        ${numberToWords(totalReceived)}
      </p>
    </div>

    <div class="lawyer-info">
      <h3>⚖️ Dados do Advogado(a) / Escritório</h3>
      <p><strong>Nome:</strong> ${lawyerName}</p>
      <p><strong>CPF:</strong> ${lawyerCpf || 'Não informado'}</p>
      <p><strong>OAB:</strong> ${lawyerOab}/${lawyerState}</p>
      ${lawyerEmail ? `<p><strong>E-mail:</strong> ${lawyerEmail}</p>` : ''}
      ${lawyerPhone ? `<p><strong>Telefone:</strong> ${lawyerPhone}</p>` : ''}
      ${lawyerAddress ? `<p><strong>Endereço:</strong> ${lawyerAddress}</p>` : ''}
    </div>

    <div class="section-title">📋 Detalhamento por Cliente/Pagador</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Cliente/Pagador</th>
          <th>CPF/CNPJ</th>
          <th>Qtd. Pagamentos</th>
          <th style="text-align: right;">Total Recebido</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from(clientPayments.entries()).map(([clientId, entry]) => {
          const clientName = entry.client?.full_name || (entry.client as any)?.name || 'Cliente não identificado';
          const clientCpf = (entry.client as any)?.cpf || (entry.client as any)?.document || 'Não informado';
          return `
          <tr>
            <td><strong>${clientName}</strong></td>
            <td>${clientCpf}</td>
            <td style="text-align: center;">${entry.payments.length}</td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(entry.total)}</td>
          </tr>`;
        }).join('')}
        <tr class="total-row">
          <td colspan="3" style="text-align: right;"><strong>TOTAL GERAL:</strong></td>
          <td style="text-align: right;"><strong>${formatCurrency(totalReceived)}</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">📅 Detalhamento Mensal</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Mês</th>
          <th style="text-align: center;">Qtd. Pagamentos</th>
          <th style="text-align: right;">Total Recebido</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from({ length: 12 }, (_, i) => {
          const month = i + 1;
          const monthPayments = allInstallmentsYear.filter(inst => {
            if (!inst.payment_date) return false;
            const paymentMonth = new Date(inst.payment_date).getMonth() + 1;
            return paymentMonth === month;
          });
          const monthTotal = monthPayments.reduce((sum, inst) => {
            if (!inst.agreement) return sum;
            return sum + (inst.agreement.fee_value / inst.agreement.installments_count);
          }, 0);
          const monthName = new Date(year, i, 1).toLocaleDateString('pt-BR', { month: 'long' });
          return `
          <tr>
            <td><strong>${monthName.charAt(0).toUpperCase() + monthName.slice(1)}</strong></td>
            <td style="text-align: center;">${monthPayments.length}</td>
            <td style="text-align: right;">${formatCurrency(monthTotal)}</td>
          </tr>`;
        }).join('')}
        <tr class="total-row">
          <td><strong>TOTAL ANUAL:</strong></td>
          <td style="text-align: center;"><strong>${allInstallmentsYear.length}</strong></td>
          <td style="text-align: right;"><strong>${formatCurrency(totalReceived)}</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="ir-instructions">
      <h3>📝 Instruções para Declaração do Imposto de Renda</h3>
      <p><strong>Como declarar estes honorários:</strong></p>
      <ul>
        <li><strong>Ficha:</strong> Rendimentos Tributáveis Recebidos de Pessoa Física e do Exterior pelo Titular</li>
        <li><strong>Tipo de Rendimento:</strong> Outros (código 10)</li>
        <li><strong>Valor:</strong> ${formatCurrency(totalReceived)}</li>
        <li><strong>Fonte Pagadora:</strong> Informar CPF/CNPJ e nome de cada cliente listado acima</li>
        <li><strong>Carnê-Leão:</strong> Se aplicável, verificar obrigatoriedade de recolhimento mensal</li>
        <li><strong>Documentação:</strong> Manter todos os recibos arquivados por no mínimo 5 anos</li>
      </ul>
      <p style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #ff9800;">
        <strong>⚠️ ATENÇÃO:</strong> Este relatório é apenas informativo. Consulte um contador para orientações específicas sobre sua declaração de IR.
      </p>
    </div>

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
    const issueDateFormatted = issueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const amount = installment ? installment.paid_value ?? installment.value : agreement.fee_value;
    const amountInWords = numberToWords(amount || 0);
    const receiptNumber = `REC-${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getHours()).padStart(2, '0')}${String(issueDate.getMinutes()).padStart(2, '0')}${String(issueDate.getSeconds()).padStart(2, '0')}`;
    
    const userMeta = (user?.user_metadata as any) || {};
    const lawyerName = userMeta.full_name || userMeta.name || userMeta.display_name || 'Advogado Responsável';
    const lawyerCpf = userMeta.cpf || userMeta.document || '';
    const lawyerEmail = user?.email || '';
    const lawyerPhone = userMeta.phone || userMeta.telefone || '';
    const lawyerOab = userMeta.oab || userMeta.oab_number || userMeta.oabNumber || 'Não informado';
    const lawyerState = userMeta.oab_state || userMeta.oabState || userMeta.estado_oab || 'XX';
    const lawyerAddress = userMeta.address || userMeta.endereco || '';
    const lawyerTitle = lawyerName ? `Dr(a). ${lawyerName}` : 'Advogado Responsável';
    
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
    @page { size: A4; margin: 12mm; }
    @media print {
      body { margin: 0; padding: 0; background: white; }
      .no-print { display: none !important; }
      .receipt-container { box-shadow: none; border: none; page-break-inside: avoid; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      background: #f5f5f5;
      padding: 15px;
      color: #2c3e50;
      line-height: 1.5;
    }
    .receipt-container {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      padding: 20mm 15mm;
      box-shadow: 0 0 15px rgba(0,0,0,0.1);
      border: 1px solid #e0e0e0;
    }
    .header {
      text-align: center;
      border: 2px solid #2c3e50;
      padding: 15px;
      margin-bottom: 20px;
      background: #f8f9fa;
    }
    .header h1 {
      font-size: 20px;
      color: #2c3e50;
      font-weight: 700;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .header .receipt-meta {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
      font-size: 10px;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 8px;
    }
    .section {
      margin: 18px 0;
      page-break-inside: avoid;
    }
    .section-title {
      background: #2c3e50;
      color: white;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 10px;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
    }
    .data-table td {
      padding: 6px 10px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 12px;
    }
    .data-table td:first-child {
      font-weight: 600;
      color: #555;
      width: 30%;
      background: #f8f9fa;
    }
    .data-table td:last-child {
      color: #2c3e50;
    }
    .amount-highlight {
      background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
      border: 2px solid #4caf50;
      border-radius: 6px;
      padding: 18px;
      text-align: center;
      margin: 20px 0;
    }
    .amount-label {
      font-size: 11px;
      color: #2e7d32;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .amount-value {
      font-size: 32px;
      font-weight: 800;
      color: #1b5e20;
      margin: 8px 0;
    }
    .amount-words {
      font-size: 11px;
      color: #2e7d32;
      font-style: italic;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #4caf50;
    }
    .declaration-box {
      background: #fff3e0;
      border-left: 3px solid #ff9800;
      padding: 15px;
      margin: 18px 0;
      font-size: 11px;
      line-height: 1.6;
      text-align: justify;
    }
    .lawyer-info {
      background: #e3f2fd;
      border: 1px solid #2196f3;
      border-radius: 6px;
      padding: 12px;
      margin: 18px 0;
    }
    .lawyer-info h3 {
      color: #1565c0;
      font-size: 13px;
      margin-bottom: 8px;
      border-bottom: 1px solid #2196f3;
      padding-bottom: 6px;
    }
    .lawyer-info p {
      margin: 4px 0;
      font-size: 11px;
      color: #424242;
    }
    .lawyer-info strong {
      color: #1565c0;
      font-weight: 600;
    }
    .signature-section {
      margin-top: 40px;
      page-break-inside: avoid;
    }
    .signature-box {
      text-align: center;
      margin: 30px auto 0;
      max-width: 350px;
    }
    .signature-line {
      border-top: 2px solid #2c3e50;
      padding-top: 8px;
      margin-top: 50px;
    }
    .signature-name {
      font-weight: 700;
      font-size: 13px;
      color: #2c3e50;
    }
    .signature-oab {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    .footer-notes {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px dashed #ccc;
      font-size: 10px;
      color: #777;
      text-align: center;
      page-break-inside: avoid;
    }
    .footer-notes p {
      margin: 4px 0;
    }
    .ir-notice {
      background: #ffebee;
      border: 1px solid #ef5350;
      border-radius: 4px;
      padding: 10px;
      margin-top: 8px;
      font-size: 10px;
      color: #c62828;
      font-weight: 600;
    }
    .print-button {
      position: fixed;
      bottom: 30px;
      right: 30px;
      background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 50px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(76, 175, 80, 0.4);
      transition: all 0.3s;
      z-index: 1000;
    }
    .print-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(76, 175, 80, 0.6);
    }
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      color: rgba(0,0,0,0.03);
      font-weight: 900;
      pointer-events: none;
      z-index: 0;
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="watermark">RECIBO</div>
    
    <div class="header">
      <h1>📄 RECIBO DE HONORÁRIOS ADVOCATÍCIOS</h1>
      <div class="receipt-meta">
        <span><strong>Nº do Recibo:</strong> ${receiptNumber}</span>
        <span><strong>Data de Emissão:</strong> ${issueDateFormatted}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">👤 Dados do Pagador (Cliente)</div>
      <table class="data-table">
        <tr>
          <td>Nome/Razão Social</td>
          <td><strong>${clientName}</strong></td>
        </tr>
        ${clientCpf ? `<tr><td>CPF/CNPJ</td><td>${clientCpf}</td></tr>` : ''}
        ${clientAddress ? `<tr><td>Endereço</td><td>${clientAddress}</td></tr>` : ''}
      </table>
    </div>

    <div class="amount-highlight">
      <div class="amount-label">💰 Valor Recebido</div>
      <div class="amount-value">${formatCurrency(amount || 0)}</div>
      <div class="amount-words">${amountInWords}</div>
    </div>

    <div class="section">
      <div class="section-title">📋 Detalhes do Serviço Prestado</div>
      <table class="data-table">
        <tr>
          <td>Acordo/Contrato</td>
          <td><strong>${agreement.title}</strong></td>
        </tr>
        <tr>
          <td>Descrição do Serviço</td>
          <td>${serviceDescription}</td>
        </tr>
        <tr>
          <td>Data do Acordo</td>
          <td>${new Date(agreement.agreement_date).toLocaleDateString('pt-BR')}</td>
        </tr>
        ${installment ? `
        <tr>
          <td>Parcela</td>
          <td><strong>${installment.installment_number} de ${agreement.installments_count}</strong></td>
        </tr>
        <tr>
          <td>Data de Vencimento</td>
          <td>${new Date(installment.due_date).toLocaleDateString('pt-BR')}</td>
        </tr>
        <tr>
          <td>Data do Pagamento</td>
          <td>${installment.payment_date ? new Date(installment.payment_date).toLocaleDateString('pt-BR') : 'N/A'}</td>
        </tr>
        <tr>
          <td>Forma de Pagamento</td>
          <td>${paymentMethod}</td>
        </tr>` : `
        <tr>
          <td>Tipo de Pagamento</td>
          <td>${agreement.payment_type === 'upfront' ? 'À Vista' : `Parcelado (${agreement.installments_count}x)`}</td>
        </tr>`}
      </table>
    </div>

    <div class="declaration-box">
      <strong>📝 DECLARAÇÃO DE QUITAÇÃO</strong><br/><br/>
      Declaro, para os devidos fins e efeitos legais, que recebi de <strong>${clientName}</strong> a quantia de <strong>${formatCurrency(amount || 0)}</strong> (${amountInWords}), referente aos honorários advocatícios ${description.toLowerCase()}
      <br/><br/>
      Por ser verdade, firmo o presente recibo para que produza os seus efeitos legais, dando plena, rasa e irrevogável quitação pelo valor ora recebido.
    </div>

    <div class="lawyer-info">
      <h3>⚖️ Dados do Advogado(a) / Escritório</h3>
      <p><strong>Nome:</strong> ${lawyerTitle}</p>
      <p><strong>OAB:</strong> ${lawyerOab}/${lawyerState}</p>
      ${lawyerCpf ? `<p><strong>CPF:</strong> ${lawyerCpf}</p>` : ''}
      ${lawyerEmail ? `<p><strong>E-mail:</strong> ${lawyerEmail}</p>` : ''}
      ${lawyerPhone ? `<p><strong>Telefone:</strong> ${lawyerPhone}</p>` : ''}
      ${lawyerAddress ? `<p><strong>Endereço:</strong> ${lawyerAddress}</p>` : ''}
    </div>

    <div class="signature-section">
      <div class="signature-box">
        <div class="signature-line">
          <div class="signature-name">${lawyerTitle}</div>
          <div class="signature-oab">OAB/${lawyerState} ${lawyerOab}</div>
        </div>
      </div>
    </div>

    <div class="footer-notes">
      <p><strong>⚠️ IMPORTANTE:</strong> Este documento comprova o recebimento de honorários advocatícios.</p>
      <p>Guarde este recibo por no mínimo 5 (cinco) anos para fins de comprovação fiscal.</p>
      <div class="ir-notice">
        📊 IMPOSTO DE RENDA: Este valor deve ser declarado como rendimento tributável recebido de pessoa física na sua Declaração de Imposto de Renda.
      </div>
      <p style="margin-top: 15px; font-size: 10px;">Documento gerado eletronicamente em ${new Date().toLocaleString('pt-BR')}</p>
    </div>
  </div>

  <button class="print-button no-print" onclick="window.print()">🖨️ Imprimir Recibo</button>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const numberToWords = (num: number): string => {
    const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
    const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

    if (num === 0) return 'zero reais';
    if (num === 100) return 'cem reais';

    const intPart = Math.floor(num);
    const decPart = Math.round((num - intPart) * 100);

    let result = '';

    if (intPart >= 1000000) {
      const millions = Math.floor(intPart / 1000000);
      result += millions === 1 ? 'um milhão' : `${convertHundreds(millions)} milhões`;
      const remainder = intPart % 1000000;
      if (remainder > 0) result += ' e ';
    }

    const thousands = Math.floor((intPart % 1000000) / 1000);
    if (thousands > 0) {
      result += thousands === 1 ? 'mil' : `${convertHundreds(thousands)} mil`;
      const remainder = intPart % 1000;
      if (remainder > 0) result += ' e ';
    }

    const remainder = intPart % 1000;
    if (remainder > 0) {
      result += convertHundreds(remainder);
    }

    result += intPart === 1 ? ' real' : ' reais';

    if (decPart > 0) {
      result += ' e ' + convertHundreds(decPart) + (decPart === 1 ? ' centavo' : ' centavos');
    }

    return result;

    function convertHundreds(n: number): string {
      if (n === 0) return '';
      if (n < 10) return units[n];
      if (n < 20) return teens[n - 10];
      if (n < 100) {
        const ten = Math.floor(n / 10);
        const unit = n % 10;
        return tens[ten] + (unit ? ' e ' + units[unit] : '');
      }
      const hundred = Math.floor(n / 100);
      const rest = n % 100;
      return hundreds[hundred] + (rest ? ' e ' + convertHundreds(rest) : '');
    }
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
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-sm transition">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase">A Receber</span>
            <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-600" />
          </div>
          <p className="text-base sm:text-2xl font-semibold text-slate-900">{formatCurrency(stats?.monthly_fees || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Previsto no mês</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-sm transition">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase">Recebido</span>
            <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
          </div>
          <p className="text-base sm:text-2xl font-semibold text-slate-900">{formatCurrency(stats?.monthly_fees_received || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Já quitado</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 hover:shadow-sm transition">
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase">Pendente</span>
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-amber-600" />
          </div>
          <p className="text-base sm:text-2xl font-semibold text-slate-900">{formatCurrency(stats?.monthly_fees_pending || 0)}</p>
          <p className="text-[9px] sm:text-xs text-slate-500 mt-0.5 sm:mt-1 hidden sm:block">Aguardando</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm transition">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-600 uppercase">Vencidas</span>
            <AlertCircle className="w-4 h-4 text-red-600" />
          </div>
          <p className="text-2xl font-semibold text-slate-900">{stats?.overdue_installments || 0}</p>
          <p className="text-xs text-slate-500 mt-1">
            {stats?.overdue_installments ? 'Parcelas em atraso' : 'Nenhuma vencida'}
          </p>
        </div>
      </div>

      {/* Modal de edição de acordo */}
      {isEditModalOpen && selectedAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleCloseEditModal} />
          <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-green-50 flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h3 className="text-base sm:text-xl font-semibold text-slate-900 flex items-center gap-2 truncate">
                  <Edit className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 flex-shrink-0" /> Editar Acordo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 hidden sm:block">Atualize informações gerais, status e notas internas.</p>
              </div>
              <button onClick={handleCloseEditModal} className="text-slate-400 hover:text-slate-600 transition flex-shrink-0 ml-2">
                <X className="w-5 h-5" />
              </button>
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
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-red-600 text-white rounded-full p-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-red-900">⚠️ Atenção: Parcelas Vencidas</h3>
                <p className="text-sm text-red-700 mt-1">
                  {stats.overdue_installments} parcela{stats.overdue_installments > 1 ? 's' : ''} com pagamento em atraso
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowOverdueOnly(!showOverdueOnly)}
              className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center gap-2"
            >
              {showOverdueOnly ? <X className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
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

      {/* Lista de Acordos */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            Movimentações Financeiras
            <span className="text-sm font-normal text-slate-500">({filteredAgreements.length})</span>
          </h2>
          
          <div className="flex items-center gap-3">
            {/* Busca */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar acordo ou cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-64"
              />
            </div>
            
            {/* Filtro de Status */}
            <div className="relative">
              <Filter className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="w-full pl-10 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 appearance-none bg-white cursor-pointer"
              >
                <option value="all">Todos os status</option>
                <option value="ativo">Ativos</option>
                <option value="concluido">Concluídos</option>
                <option value="cancelado">Cancelados</option>
              </select>
            </div>
          </div>
        </div>

        {filteredAgreements.length === 0 ? (
          <div className="text-center py-12">
            <PiggyBank className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium">
              {agreements.length === 0 ? 'Nenhuma movimentação financeira cadastrada' : 'Nenhuma movimentação encontrada'}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {agreements.length === 0
                ? 'Clique em "Novo Acordo" para começar'
                : 'Tente ajustar os filtros de busca'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAgreements.map((agreement) => (
              <div key={agreement.id} className="border border-slate-200 rounded-xl p-3 sm:p-4 hover:border-emerald-300 transition group">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 text-sm sm:text-base truncate">{agreement.title}</h3>
                      <p className="text-xs sm:text-sm text-slate-600 mt-1 truncate">Cliente: {getClientName(agreement.client_id)}</p>
                    </div>
                    <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${
                      agreement.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                      agreement.status === 'concluido' ? 'bg-blue-100 text-blue-700' :
                      agreement.status === 'cancelado' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm">
                    <span className="text-emerald-600 font-semibold">
                      💰 {formatCurrency(agreement.fee_value)}
                    </span>
                    <span className="text-slate-500">
                      {agreement.fee_type === 'percentage' ? `${agreement.fee_percentage}%` : 'Fixo'}
                    </span>
                    <span className="text-slate-500">
                      {agreement.payment_type === 'upfront' ? '• À Vista' : `• ${agreement.installments_count}x`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => handleOpenDetails(agreement)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition"
                      title="Ver detalhes"
                    >
                      <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
                      Ver
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(agreement)}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition"
                      title="Editar acordo"
                    >
                      <Edit className="w-3 h-3 sm:w-4 sm:h-4" />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteAgreement(agreement)}
                      className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition"
                      title="Excluir acordo"
                    >
                      <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de novo acordo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleCloseModal} />
          <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-base sm:text-xl font-semibold text-slate-900 truncate">Novo Acordo Financeiro</h3>
                <p className="text-xs sm:text-sm text-slate-500 hidden sm:block">Configure honorários e condições de pagamento vinculados ao cliente</p>
              </div>
              <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 transition flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleCloseDetails} />
          <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-blue-50 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-base sm:text-xl font-bold text-slate-900 truncate">{selectedAgreement.title}</h3>
                <p className="text-xs sm:text-sm text-emerald-700 mt-1 font-semibold flex items-center gap-2 truncate">
                  <span className="inline-flex items-center justify-center bg-emerald-100 text-emerald-700 rounded-full px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-xs uppercase tracking-wide flex-shrink-0">
                    Cliente
                  </span>
                  <span className="truncate">{getClientName(selectedAgreement.client_id)}</span>
                </p>
              </div>
              <button onClick={handleCloseDetails} className="text-slate-400 hover:text-slate-600 transition flex-shrink-0">
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
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
                  <div className="space-y-3">
                    {installments.map((installment, index) => {
                      const isOverdue = pendingStatuses.includes(installment.status as InstallmentStatus) && installment.due_date < today;
                      const isPaid = installment.status === 'pago';
                      const daysOverdue = isOverdue ? Math.floor((new Date().getTime() - new Date(installment.due_date).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                      
                      return (
                        <div
                          key={installment.id}
                          className={`border-2 rounded-xl p-4 transition ${
                            isPaid ? 'border-emerald-300 bg-emerald-50' :
                            isOverdue ? 'border-red-400 bg-red-50 shadow-lg' :
                            'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 flex-1">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                                isPaid ? 'bg-emerald-600 text-white' :
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
                                  {isPaid && (
                                    <span className="bg-emerald-600 text-white text-xs font-bold px-2 py-1 rounded uppercase">
                                      ✓ PAGA
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
                                {isPaid && installment.payment_date && (
                                  <p className="text-sm text-emerald-700 font-semibold mt-1">
                                    ✓ Pago em {new Date(installment.payment_date).toLocaleDateString('pt-BR')}
                                  </p>
                                )}
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
                                {isPaid && (
                                  <button
                                    onClick={() => handleGenerateReceipt(selectedAgreement, installment)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition flex items-center justify-center gap-2 shadow w-full sm:w-auto"
                                    title="Gerar recibo desta parcela"
                                  >
                                    <Receipt className="w-4 h-4" /> Recibo
                                  </button>
                                )}
                                {!isPaid && (
                                  <button
                                    onClick={() => handleOpenPaymentModal(installment)}
                                    className={`${isOverdue ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white px-4 sm:px-5 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2 shadow-lg w-full sm:w-auto`}
                                  >
                                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" /> Dar Baixa
                                  </button>
                                )}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleClosePaymentModal} />
          <div className="relative bg-white rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-green-50 flex-shrink-0">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-base sm:text-xl font-bold text-slate-900 truncate">💳 Dar Baixa</h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 truncate">
                  Parcela {selectedInstallment.installment_number}/{selectedAgreement?.installments_count} - Venc: {new Date(selectedInstallment.due_date).toLocaleDateString('pt-BR')}
                </p>
              </div>
              <button onClick={handleClosePaymentModal} className="text-slate-400 hover:text-slate-600 transition flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
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

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button
                onClick={handleClosePaymentModal}
                className="px-6 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmPayment}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Confirmar Pagamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Relatório Mensal para IR */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsReportModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
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
                onClick={() => toast.info('Em breve', 'Funcionalidade de exportar PDF será implementada')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsIRModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
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
