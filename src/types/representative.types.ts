// Tipos para o módulo de Prepostos

export type RepresentativeStatus = 'ativo' | 'inativo';

export type ServiceStatus = 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'nao_compareceu';

export type PaymentStatus = 'pendente' | 'pago' | 'cancelado';

export type PaymentMethod = 'pix' | 'transferencia' | 'dinheiro' | 'cheque' | 'outro';

// Preposto
export interface Representative {
  id: string;
  full_name: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  pix_key?: string | null;
  bank_name?: string | null;
  bank_agency?: string | null;
  bank_account?: string | null;
  notes?: string | null;
  status: RepresentativeStatus;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface CreateRepresentativeDTO {
  full_name: string;
  cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  pix_key?: string | null;
  bank_name?: string | null;
  bank_agency?: string | null;
  bank_account?: string | null;
  notes?: string | null;
  status?: RepresentativeStatus;
}

export interface UpdateRepresentativeDTO extends Partial<CreateRepresentativeDTO> {}

// Vínculo Preposto-Compromisso
export interface RepresentativeAppointment {
  id: string;
  representative_id: string;
  calendar_event_id: string;
  service_date: string;
  diligence_location?: string | null;
  service_description?: string | null;
  service_status: ServiceStatus;
  is_archived: boolean;
  service_value: number;
  payment_status: PaymentStatus;
  payment_date?: string | null;
  payment_method?: PaymentMethod | null;
  payment_receipt?: string | null;
  payment_notes?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  // Joins
  representative?: Representative;
  calendar_event?: {
    id: string;
    title: string;
    start_at: string;
    event_type: string;
    client_id?: string | null;
  };
}

export interface CreateRepresentativeAppointmentDTO {
  representative_id: string;
  calendar_event_id: string;
  service_date: string;
  diligence_location?: string | null;
  service_description?: string | null;
  service_status?: ServiceStatus;
  is_archived?: boolean;
  service_value: number;
  payment_status?: PaymentStatus;
  payment_date?: string | null;
  payment_method?: PaymentMethod | null;
  payment_receipt?: string | null;
  payment_notes?: string | null;
  notes?: string | null;
}

export interface UpdateRepresentativeAppointmentDTO extends Partial<CreateRepresentativeAppointmentDTO> {}

// Labels para exibição
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  nao_compareceu: 'Não Compareceu',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  cancelado: 'Cancelado',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  outro: 'Outro',
};
