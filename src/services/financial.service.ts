import { supabase } from '../config/supabase';
import type {
  Agreement,
  Installment,
  CreateAgreementDTO,
  UpdateAgreementDTO,
  PayInstallmentDTO,
  FinancialStats,
  CustomInstallmentInput,
  PaymentAuditLog,
  CreatePaymentAuditDTO,
} from '../types/financial.types';

class FinancialService {
  // ============================================
  // ACORDOS
  // ============================================

  async createAgreement(data: CreateAgreementDTO): Promise<Agreement> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    // Calcular honorários baseado no tipo
    let feeValue: number;
    if (data.fee_type === 'percentage') {
      feeValue = (data.total_value * (data.fee_percentage || 0)) / 100;
    } else {
      feeValue = data.fee_fixed_value || 0;
    }

    const installmentsCount = data.payment_type === 'upfront' ? 1 : data.installments_count;
    const customInstallments = data.custom_installments?.length ? data.custom_installments : undefined;
    const installmentValue = customInstallments?.length
      ? Number((customInstallments.reduce((sum, item) => sum + item.value, 0) / customInstallments.length).toFixed(2))
      : Number((data.total_value / (installmentsCount || 1)).toFixed(2));
    const netValue = Number((data.total_value - feeValue).toFixed(2));

    const agreement: Omit<Agreement, 'id' | 'created_at' | 'updated_at'> = {
      ...data,
      installments_count: installmentsCount,
      fee_value: Number(feeValue.toFixed(2)),
      net_value: netValue,
      installment_value: installmentValue,
      status: 'ativo',
      created_by: user.id,
    };

    const { data: created, error } = await supabase
      .from('agreements')
      .insert(agreement)
      .select()
      .single();

    if (error) throw error;

    // Criar parcelas automaticamente
    await this.generateInstallments(
      created.id,
      agreement.installments_count,
      installmentValue,
      data.first_due_date,
      customInstallments,
    );

    return created;
  }

  async updateAgreement(id: string, data: UpdateAgreementDTO): Promise<Agreement> {
    const now = new Date().toISOString();
    const { data: current, error: fetchError } = await supabase
      .from('agreements')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    if (!current) throw new Error('Acordo não encontrado');

    const customInstallments = data.custom_installments?.length ? data.custom_installments : undefined;
    const payload = { ...data } as Omit<UpdateAgreementDTO, 'custom_installments'> & { custom_installments?: CustomInstallmentInput[] };
    delete (payload as any).custom_installments;

    const nextPaymentType = payload.payment_type ?? current.payment_type;
    const nextInstallmentsCount = nextPaymentType === 'upfront' ? 1 : (payload.installments_count ?? current.installments_count);
    const totalValue = payload.total_value ?? current.total_value;
    const feeType = payload.fee_type ?? current.fee_type;
    const feePercentage = feeType === 'percentage'
      ? (payload.fee_percentage ?? current.fee_percentage ?? 0)
      : null;
    const feeFixed = feeType === 'fixed'
      ? (payload.fee_fixed_value ?? current.fee_fixed_value ?? 0)
      : null;
    const feeValue = feeType === 'percentage'
      ? Number(((totalValue * (feePercentage ?? 0)) / 100).toFixed(2))
      : Number((feeFixed ?? 0).toFixed(2));
    const netValue = Number((totalValue - feeValue).toFixed(2));
    const firstDueDate = payload.first_due_date ?? current.first_due_date;
    const installmentValue = customInstallments?.length
      ? Number((customInstallments.reduce((sum, item) => sum + item.value, 0) / customInstallments.length).toFixed(2))
      : Number((totalValue / (nextInstallmentsCount || 1)).toFixed(2));

    const updateData: any = {
      ...payload,
      payment_type: nextPaymentType,
      installments_count: nextInstallmentsCount,
      first_due_date: firstDueDate,
      fee_value: feeValue,
      net_value: netValue,
      installment_value: installmentValue,
      fee_percentage: feeType === 'percentage' ? (feePercentage ?? 0) : null,
      fee_fixed_value: feeType === 'fixed' ? (feeFixed ?? 0) : null,
      updated_at: now,
    };

    const shouldRegenerateInstallments = Boolean(
      customInstallments?.length ||
      payload.installments_count !== undefined ||
      payload.first_due_date !== undefined ||
      payload.payment_type !== undefined ||
      payload.total_value !== undefined,
    );

    if (shouldRegenerateInstallments) {
      const { data: existingInstallments } = await supabase
        .from('installments')
        .select('id,status')
        .eq('agreement_id', id);

      const hasSettledInstallments = existingInstallments?.some((inst) => inst.status === 'pago');
      if (hasSettledInstallments) {
        throw new Error('Não é possível alterar o parcelamento de um acordo com parcelas já pagas.');
      }

      await supabase.from('installments').delete().eq('agreement_id', id);
      await this.generateInstallments(id, nextInstallmentsCount, installmentValue, firstDueDate, customInstallments);
    }

    const { data: updated, error } = await supabase
      .from('agreements')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  async deleteAgreement(id: string): Promise<void> {
    // Deletar parcelas primeiro
    await supabase.from('installments').delete().eq('agreement_id', id);
    
    const { error } = await supabase.from('agreements').delete().eq('id', id);
    if (error) throw error;
  }

  async getAgreement(id: string): Promise<Agreement> {
    const { data, error } = await supabase
      .from('agreements')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async listAgreements(filters?: { client_id?: string; status?: string }): Promise<Agreement[]> {
    let query = supabase.from('agreements').select('*').order('created_at', { ascending: false });

    if (filters?.client_id) {
      query = query.eq('client_id', filters.client_id);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // ============================================
  // PARCELAS
  // ============================================

  private async generateInstallments(
    agreementId: string,
    count: number,
    value: number,
    firstDueDate: string,
    customInstallments?: CustomInstallmentInput[],
  ): Promise<void> {
    const installments: Omit<Installment, 'id' | 'created_at' | 'updated_at'>[] = [];

    if (customInstallments && customInstallments.length) {
      for (let i = 0; i < count; i++) {
        const custom = customInstallments[i];
        installments.push({
          agreement_id: agreementId,
          installment_number: i + 1,
          due_date: (custom?.due_date || firstDueDate),
          value: Number(custom?.value ?? value),
          status: 'pendente',
          payment_date: null,
          payment_method: null,
          paid_value: null,
          notes: undefined,
        });
      }
    } else {
      const baseDate = new Date(firstDueDate);
      for (let i = 0; i < count; i++) {
        const dueDate = new Date(baseDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        installments.push({
          agreement_id: agreementId,
          installment_number: i + 1,
          due_date: dueDate.toISOString().split('T')[0],
          value: Number(value.toFixed(2)),
          status: 'pendente',
          payment_date: null,
          payment_method: null,
          paid_value: null,
          notes: undefined,
        });
      }
    }

    const { error } = await supabase.from('installments').insert(installments);
    if (error) throw error;
  }

  async payInstallment(id: string, data: PayInstallmentDTO): Promise<Installment> {
    // Buscar dados anteriores para auditoria
    const { data: oldData } = await supabase
      .from('installments')
      .select('*')
      .eq('id', id)
      .single();

    const { data: updated, error } = await supabase
      .from('installments')
      .update({
        status: 'pago',
        payment_date: data.payment_date,
        payment_method: data.payment_method,
        paid_value: data.paid_value,
        notes: data.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Registrar auditoria
    const paymentMethodLabels: Record<string, string> = {
      dinheiro: 'Dinheiro',
      pix: 'PIX',
      transferencia: 'Transferência',
      cheque: 'Cheque',
      cartao_credito: 'Cartão de Crédito',
      cartao_debito: 'Cartão de Débito',
    };
    
    await this.logPaymentAudit({
      agreement_id: updated.agreement_id,
      installment_id: id,
      action: 'payment_registered',
      description: `Baixa registrada na parcela ${updated.installment_number} - Valor: R$ ${data.paid_value.toFixed(2)} - Método: ${paymentMethodLabels[data.payment_method] || data.payment_method}`,
      old_value: oldData ? {
        status: oldData.status,
        payment_date: oldData.payment_date,
        payment_method: oldData.payment_method,
        paid_value: oldData.paid_value,
      } : undefined,
      new_value: {
        status: 'pago',
        payment_date: data.payment_date,
        payment_method: data.payment_method,
        paid_value: data.paid_value,
        notes: data.notes,
      },
    });

    // Verificar se todas as parcelas foram pagas para atualizar status do acordo
    await this.checkAndUpdateAgreementStatus(updated.agreement_id);

    return updated;
  }

  async cancelInstallment(id: string): Promise<void> {
    const { error } = await supabase
      .from('installments')
      .update({ status: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  }

  async listInstallments(agreementId: string): Promise<Installment[]> {
    const { data, error } = await supabase
      .from('installments')
      .select('*')
      .eq('agreement_id', agreementId)
      .order('installment_number', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async listAllInstallments(filters?: { status?: string; overdue?: boolean }): Promise<(Installment & { agreement?: Agreement })[]> {
    let query = supabase
      .from('installments')
      .select('*, agreements(*)')
      .order('due_date', { ascending: true });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.overdue) {
      const today = new Date().toISOString().split('T')[0];
      query = query.lt('due_date', today).eq('status', 'pendente');
    }

    const { data, error } = await query;
    if (error) throw error;

    // Atualizar status de vencidas
    if (data) {
      const today = new Date().toISOString().split('T')[0];
      const overdueIds = data
        .filter((i: any) => i.status === 'pendente' && i.due_date < today)
        .map((i: any) => i.id);

      if (overdueIds.length > 0) {
        await supabase
          .from('installments')
          .update({ status: 'vencido' })
          .in('id', overdueIds);
      }

      const overdueSet = new Set(overdueIds);
      return data.map((inst: any) => {
        const installment = overdueSet.has(inst.id)
          ? { ...inst, status: 'vencido' as const }
          : inst;
        
        // Renomear agreements para agreement (singular)
        return {
          ...installment,
          agreement: inst.agreements,
          agreements: undefined,
        };
      });
    }

    return data || [];
  }

  // ============================================
  // ESTATÍSTICAS
  // ============================================

  async getFinancialStats(referenceMonth?: string): Promise<FinancialStats> {
    const { data: agreements } = await supabase.from('agreements').select('*');
    const { data: installments } = await supabase.from('installments').select('*');

    const referenceDate = referenceMonth ? new Date(`${referenceMonth}-01T00:00:00`) : new Date();
    const today = new Date().toISOString().split('T')[0];

    const monthStartDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const monthEndDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
    const monthStart = monthStartDate.toISOString().split('T')[0];
    const monthEnd = monthEndDate.toISOString().split('T')[0];

    // Calcular honorários do escritório
    const totalFees = agreements?.reduce((sum, a) => sum + a.fee_value, 0) || 0;
    
    // Calcular proporção de honorários por parcela
    const pendingStatuses: Array<'pendente' | 'vencido'> = ['pendente', 'vencido'];

    const calculateFeesPaid = () => {
      let feesPaid = 0;
      agreements?.forEach(agreement => {
        const agreementInstallments = installments?.filter(i => i.agreement_id === agreement.id) || [];
        const paidInstallments = agreementInstallments.filter(i => i.status === 'pago');
        const feePerInstallment = agreement.fee_value / agreement.installments_count;
        feesPaid += paidInstallments.length * feePerInstallment;
      });
      return feesPaid;
    };

    const feesReceived = calculateFeesPaid();
    const feesPending = totalFees - feesReceived;

    let monthlyFees = 0;
    let monthlyFeesReceived = 0;
    let monthlyFeesPending = 0;

    agreements?.forEach(agreement => {
      const feePerInstallment = agreement.fee_value / agreement.installments_count;
      const agreementInstallments = installments?.filter(i => i.agreement_id === agreement.id) || [];

      agreementInstallments
        .filter(inst => inst.due_date >= monthStart && inst.due_date <= monthEnd)
        .forEach(inst => {
          monthlyFees += feePerInstallment;
          if (inst.status === 'pago') {
            monthlyFeesReceived += feePerInstallment;
          } else if (pendingStatuses.includes(inst.status as any)) {
            monthlyFeesPending += feePerInstallment;
          }
        });
    });

    // Garantir consistência (evita números negativos por arredondamento)
    monthlyFees = Number(monthlyFees.toFixed(2));
    monthlyFeesReceived = Number(monthlyFeesReceived.toFixed(2));
    monthlyFeesPending = Number((monthlyFees - monthlyFeesReceived).toFixed(2));

    // Calcular honorários vencidos
    let totalOverdueFees = 0;
    agreements?.forEach(agreement => {
      const feePerInstallment = agreement.fee_value / agreement.installments_count;
      const agreementInstallments = installments?.filter(i => i.agreement_id === agreement.id) || [];
      const overdueInstallments = agreementInstallments.filter(
        i => pendingStatuses.includes(i.status as any) && i.due_date < today
      );
      totalOverdueFees += overdueInstallments.length * feePerInstallment;
    });

    const stats: FinancialStats = {
      total_agreements: agreements?.length || 0,
      active_agreements: agreements?.filter(a => a.status === 'ativo').length || 0,
      total_contracted: agreements?.reduce((sum, a) => sum + a.total_value, 0) || 0,
      total_fees: totalFees,
      total_fees_received: feesReceived,
      total_fees_pending: feesPending,
      total_received: installments?.filter(i => i.status === 'pago').reduce((sum, i) => sum + (i.paid_value || 0), 0) || 0,
      total_pending:
        installments?.filter(i => pendingStatuses.includes(i.status as any)).reduce((sum, i) => sum + i.value, 0) || 0,
      total_overdue: Number(totalOverdueFees.toFixed(2)),
      overdue_installments:
        installments?.filter(i => pendingStatuses.includes(i.status as any) && i.due_date < today).length || 0,
      paid_installments: installments?.filter(i => i.status === 'pago').length || 0,
      pending_installments:
        installments?.filter(i => pendingStatuses.includes(i.status as any)).length || 0,
      monthly_fees: monthlyFees,
      monthly_fees_received: monthlyFeesReceived,
      monthly_fees_pending: monthlyFeesPending,
    };

    return stats;
  }

  private async checkAndUpdateAgreementStatus(agreementId: string): Promise<void> {
    const installments = await this.listInstallments(agreementId);
    
    const allPaid = installments.every(i => i.status === 'pago');
    if (allPaid) {
      await supabase
        .from('agreements')
        .update({ status: 'concluido', updated_at: new Date().toISOString() })
        .eq('id', agreementId);
    }
  }

  // ============================================
  // AUDITORIA DE PAGAMENTOS
  // ============================================

  /**
   * Registra uma entrada no log de auditoria de pagamentos
   */
  async logPaymentAudit(data: CreatePaymentAuditDTO): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Buscar nome do usuário
      let userName: string | null = null;
      if (user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('user_id', user.id)
          .single();
        userName = profile?.name || user.email || null;
      }

      await supabase.from('payment_audit_log').insert({
        agreement_id: data.agreement_id,
        installment_id: data.installment_id || null,
        user_id: user?.id || null,
        user_name: userName,
        action: data.action,
        description: data.description,
        old_value: data.old_value || null,
        new_value: data.new_value || null,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    } catch (err) {
      console.error('Erro ao registrar auditoria de pagamento:', err);
      // Não lançar erro para não interromper a operação principal
    }
  }

  /**
   * Busca log de auditoria de um acordo
   */
  async getPaymentAuditLog(agreementId: string): Promise<PaymentAuditLog[]> {
    const { data, error } = await supabase
      .from('payment_audit_log')
      .select('*')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar auditoria:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Busca log de auditoria de uma parcela específica
   */
  async getInstallmentAuditLog(installmentId: string): Promise<PaymentAuditLog[]> {
    const { data, error } = await supabase
      .from('payment_audit_log')
      .select('*')
      .eq('installment_id', installmentId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar auditoria da parcela:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Busca todo o histórico de auditoria com filtros
   */
  async getAllPaymentAuditLogs(filters?: {
    action?: string;
    user_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<PaymentAuditLog[]> {
    let query = supabase
      .from('payment_audit_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.action) {
      query = query.eq('action', filters.action);
    }
    if (filters?.user_id) {
      query = query.eq('user_id', filters.user_id);
    }
    if (filters?.start_date) {
      query = query.gte('created_at', filters.start_date);
    }
    if (filters?.end_date) {
      query = query.lte('created_at', filters.end_date);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Erro ao buscar logs de auditoria:', error);
      return [];
    }

    return data || [];
  }
}

export const financialService = new FinancialService();
