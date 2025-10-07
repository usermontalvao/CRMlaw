export type RequirementStatus =
  | 'aguardando_confeccao'
  | 'em_analise'
  | 'em_exigencia'
  | 'aguardando_pericia'
  | 'deferido'
  | 'indeferido'
  | 'ajuizado';

export type BenefitType =
  | 'bpc_loas'
  | 'aposentadoria_tempo'
  | 'aposentadoria_idade'
  | 'aposentadoria_invalidez'
  | 'auxilio_acidente'
  | 'auxilio_doenca'
  | 'pensao_morte'
  | 'salario_maternidade'
  | 'outro';

export interface Requirement {
  id: string;
  protocol: string | null;
  beneficiary: string;
  cpf: string;
  benefit_type: BenefitType;
  status: RequirementStatus;
  entry_date: string | null;
  exigency_due_date?: string | null;
  phone?: string | null;
  inss_password?: string | null;
  observations?: string | null;
  notes?: string | null;
  client_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRequirementDTO {
  protocol?: string | null;
  beneficiary: string;
  cpf: string;
  benefit_type: BenefitType;
  status?: RequirementStatus;
  entry_date?: string | null;
  exigency_due_date?: string | null;
  phone?: string | null;
  inss_password?: string | null;
  observations?: string | null;
  notes?: string | null;
  client_id?: string | null;
}

export interface UpdateRequirementDTO extends Partial<CreateRequirementDTO> {}

export interface RequirementFilters {
  status?: RequirementStatus;
  protocol?: string;
  beneficiary?: string;
  cpf?: string;
  benefit_type?: BenefitType;
  client_id?: string;
}
