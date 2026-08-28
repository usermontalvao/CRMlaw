import type { DeadlinePriority, DeadlineType } from './deadline.types';

/**
 * Automação de prazo: "quando chegar a data X, cadastre o prazo Y".
 *
 * A v1 lê datas de `requirements`. Abrir para processos e agenda é acrescentar
 * valores aqui e nos CHECKs da migration — nada no runner presume requerimento.
 */
export type AutomationSourceTable = 'requirements';

export type AutomationSourceDateField =
  | 'exigency_due_date'
  | 'pericia_social_at'
  | 'pericia_medica_at'
  | 'entry_date';

export type AutomationFilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'in'
  | 'is_null'
  | 'not_null';

export interface AutomationFilter {
  field: string;
  op: AutomationFilterOp;
  value?: unknown;
}

export interface DeadlineAutomation {
  id: string;
  name: string;
  description?: string | null;

  /** Regra nasce desligada; quando ligada, nasce em simulação. */
  is_active: boolean;
  /** Registra o prazo que TERIA criado, sem criar. Ver AUTOMATION_DEFAULTS. */
  simulate_only: boolean;

  // ── Gatilho ────────────────────────────────────────────────────────────────
  source_table: AutomationSourceTable;
  source_date_field: AutomationSourceDateField;
  source_filter: AutomationFilter[];
  filter_mode: 'all' | 'any';
  /** Dias em relação à data-fonte para disparar. Negativo = antes. */
  trigger_offset_days: number;

  // ── Ação ───────────────────────────────────────────────────────────────────
  title_template: string;
  description_template?: string | null;
  deadline_type: DeadlineType;
  priority: DeadlinePriority;
  counting_type?: 'processual' | 'material' | null;
  /** Dias em relação à data-fonte para o vencimento. Independente do gatilho. */
  due_offset_days: number;
  responsible_id?: string | null;

  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateDeadlineAutomationDTO =
  Omit<DeadlineAutomation, 'id' | 'created_at' | 'updated_at' | 'created_by'>;

export type UpdateDeadlineAutomationDTO = Partial<CreateDeadlineAutomationDTO>;

/** Status de uma execução no ledger. */
export type AutomationRunStatus = 'criado' | 'simulado' | 'ignorado' | 'erro';

export interface DeadlineAutomationRun {
  id: string;
  automation_id: string;
  source_row_id: string;
  /** A data-fonte resolvida (YYYY-MM-DD) que esta execução atendeu. */
  occurrence_key: string;
  status: AutomationRunStatus;
  deadline_id?: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** Rótulos das datas-fonte, para os selects e para o log. */
export const SOURCE_DATE_LABELS: Record<AutomationSourceDateField, string> = {
  exigency_due_date: 'Vencimento da exigência',
  // Social antes de médica: a ordem do Meu INSS, e a ordem do select.
  pericia_social_at: 'Perícia social',
  pericia_medica_at: 'Perícia médica',
  entry_date: 'Data de entrada do requerimento',
};

/** Variáveis aceitas nos templates de título e descrição. */
export const TEMPLATE_VARS = [
  { token: '{{cliente}}', descricao: 'Nome do beneficiário' },
  { token: '{{protocolo}}', descricao: 'Protocolo do requerimento' },
  { token: '{{beneficio}}', descricao: 'Tipo de benefício' },
  { token: '{{data}}', descricao: 'Data-fonte, em dd/mm/aaaa' },
  { token: '{{evento}}', descricao: 'Nome da data-fonte (ex: perícia médica)' },
] as const;

/**
 * Como uma regra nasce. Desligada e em simulação, nesta ordem, de propósito:
 * automação que cria prazo errado é passivo do escritório, e a única forma de
 * descobrir isso antes é deixá-la falar antes de agir.
 */
export const AUTOMATION_DEFAULTS: CreateDeadlineAutomationDTO = {
  name: '',
  description: null,
  is_active: false,
  simulate_only: true,
  source_table: 'requirements',
  source_date_field: 'pericia_medica_at',
  source_filter: [],
  filter_mode: 'all',
  trigger_offset_days: -10,
  title_template: 'Preparar cliente para {{evento}} — {{cliente}}',
  description_template: 'Protocolo {{protocolo}} · {{beneficio}} · {{evento}} em {{data}}.',
  deadline_type: 'requerimento',
  priority: 'media',
  counting_type: null,
  due_offset_days: -1,
  responsible_id: null,
};
