// Tipos do Módulo Financeiro

export type AgreementStatus = 'pendente' | 'ativo' | 'concluido' | 'cancelado';
export type InstallmentStatus = 'pendente' | 'pago' | 'vencido' | 'cancelado';
export type PaymentMethod = 'dinheiro' | 'pix' | 'transferencia' | 'cheque' | 'cartao_credito' | 'cartao_debito';
export type FeeType = 'percentage' | 'fixed'; // Tipo de honorário (risco ou fixo)
export type PaymentType = 'upfront' | 'installments'; // À vista ou parcelado

export interface CustomInstallmentInput {
  due_date: string;
  value: number;
}

// Acordo Trabalhista
export interface Agreement {
  id: string;
  client_id: string;
  process_id?: string | null;
  
  // Dados do Acordo
  title: string;
  description?: string;
  agreement_date: string; // Data do acordo
  
  // Valores
  total_value: number; // Valor total do acordo
  fee_type: FeeType; // Tipo de honorário (percentual ou fixo)
  fee_percentage?: number | null; // Percentual de honorários (ex: 30) - se fee_type = 'percentage'
  fee_fixed_value?: number | null; // Valor fixo de honorários - se fee_type = 'fixed'
  fee_value: number; // Valor dos honorários calculado
  net_value: number; // Valor líquido para o cliente
  
  // Parcelamento
  payment_type: PaymentType; // À vista ou parcelado
  installments_count: number; // Número de parcelas (1 se à vista)
  installment_value: number; // Valor de cada parcela
  first_due_date: string; // Data do vencimento (ou primeiro vencimento)
  custom_installments?: CustomInstallmentInput[]; // Parcelas personalizadas

  // Metadados
  status: AgreementStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

// Parcela
export interface Installment {
  id: string;
  agreement_id: string;
  
  // Dados da Parcela
  installment_number: number; // Número da parcela (1, 2, 3...)
  due_date: string; // Data de vencimento
  value: number; // Valor da parcela
  
  // Pagamento
  status: InstallmentStatus;
  payment_date?: string | null; // Data do pagamento
  payment_method?: PaymentMethod | null;
  paid_value?: number | null; // Valor pago (pode ser diferente se houver desconto/juros)
  
  // Observações
  notes?: string;
  created_at: string;
  updated_at: string;
}

// DTOs para criação
export interface CreateAgreementDTO {
  client_id: string;
  process_id?: string;
  title: string;
  description?: string;
  agreement_date: string;
  total_value: number;
  fee_type: FeeType;
  fee_percentage?: number; // Obrigatório se fee_type = 'percentage'
  fee_fixed_value?: number; // Obrigatório se fee_type = 'fixed'
  payment_type: PaymentType; // À vista ou parcelado
  installments_count: number; // 1 se à vista
  first_due_date: string;
  custom_installments?: CustomInstallmentInput[];
  notes?: string;
}

export interface UpdateAgreementDTO {
  title?: string;
  description?: string;
  agreement_date?: string;
  total_value?: number;
  fee_type?: FeeType;
  fee_percentage?: number;
  fee_fixed_value?: number;
  installments_count?: number;
  first_due_date?: string;
  payment_type?: PaymentType;
  client_id?: string;
  process_id?: string | null;
  custom_installments?: CustomInstallmentInput[];
  status?: AgreementStatus;
  notes?: string;
}

export interface PayInstallmentDTO {
  payment_date: string;
  payment_method: PaymentMethod;
  paid_value: number;
  notes?: string;
  receipt_url?: string;
}

// Estatísticas financeiras
export interface FinancialStats {
  total_agreements: number;
  active_agreements: number;
  total_contracted: number;
  total_fees: number; // Total de honorários previstos (benefício do escritório)
  total_fees_received: number; // Honorários já recebidos
  total_fees_pending: number; // Honorários pendentes
  total_received: number;
  total_pending: number;
  total_overdue: number; // Total vencido
  overdue_installments: number;
  paid_installments: number;
  pending_installments: number;
  monthly_fees: number; // Honorários previstos para o mês vigente
  monthly_fees_received: number; // Honorários recebidos no mês vigente
  monthly_fees_pending: number; // Honorários pendentes no mês vigente
}

// Parcela com informações do acordo (para calendário)
export interface InstallmentWithAgreement extends Installment {
  agreement: Agreement;
}
