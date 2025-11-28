// Tipos para o módulo de Monitoramento Inteligente de Processos

export type ProcessPhase = 
  | 'distribuicao'
  | 'citacao'
  | 'contestacao'
  | 'instrucao'
  | 'sentenca'
  | 'recurso'
  | 'transito_julgado'
  | 'cumprimento'
  | 'arquivamento';

export type ProcessHealthStatus = 
  | 'healthy'      // Processo em andamento normal
  | 'attention'    // Requer atenção (prazo próximo, movimentação importante)
  | 'critical'     // Crítico (prazo vencido, urgência)
  | 'archived'     // Arquivado
  | 'suspended';   // Suspenso

export type MovementType =
  | 'despacho'
  | 'decisao'
  | 'sentenca'
  | 'intimacao'
  | 'peticao'
  | 'audiencia'
  | 'julgamento'
  | 'recurso'
  | 'citacao'
  | 'outros';

export interface ProcessParty {
  id: string;
  name: string;
  document?: string; // CPF/CNPJ
  role: 'autor' | 'reu' | 'terceiro' | 'advogado';
  pole: 'ativo' | 'passivo' | 'neutro';
  is_client?: boolean; // Indica se é o cliente representado pelo escritório
  linked_client_id?: string; // ID do cliente vinculado no CRM
}

export interface ProcessMovement {
  id: string;
  process_id: string;
  date: string;
  type: MovementType;
  title: string;
  description: string;
  source: 'djen' | 'manual' | 'system';
  djen_hash?: string;
  requires_action: boolean;
  deadline_date?: string;
  completed: boolean;
  completed_at?: string;
  created_at: string;
}

export interface MonitoredProcess {
  id: string;
  process_number: string;
  process_number_formatted: string;
  court: string;
  court_unit?: string;
  class_name: string;
  class_code?: string;
  subject?: string;
  distribution_date?: string;
  current_phase: ProcessPhase;
  health_status: ProcessHealthStatus;
  last_movement_date?: string;
  days_without_movement: number;
  parties: ProcessParty[];
  movements: ProcessMovement[];
  total_movements: number;
  pending_deadlines: number;
  linked_client_id?: string;
  linked_client_name?: string; // Nome do cliente vinculado
  linked_process_id?: string;
  our_client_pole?: 'ativo' | 'passivo'; // Qual polo nosso cliente representa
  auto_synced: boolean;
  last_sync_at?: string;
  ai_summary?: string; // Resumo gerado por IA
  ai_next_steps?: string; // Próximos passos sugeridos pela IA
  ai_risk_assessment?: 'low' | 'medium' | 'high'; // Avaliação de risco
  created_at: string;
  updated_at: string;
}

export interface ProcessTimelineItem {
  id: string;
  date: string;
  type: MovementType;
  title: string;
  description: string;
  phase?: ProcessPhase;
  is_milestone: boolean;
  requires_action: boolean;
  action_completed: boolean;
}

export interface ProcessStats {
  total: number;
  healthy: number;
  attention: number;
  critical: number;
  archived: number;
  suspended: number;
  avgDaysWithoutMovement: number;
  pendingDeadlines: number;
  recentMovements: number; // últimos 7 dias
}

export interface ProcessDiscoveryResult {
  process_number: string;
  court: string;
  class_name: string;
  parties: {
    polo_ativo: string[];
    polo_passivo: string[];
  };
  movements_count: number;
  first_movement_date: string;
  last_movement_date: string;
  already_registered: boolean;
}

export interface SyncProgress {
  status: 'idle' | 'searching' | 'analyzing' | 'saving' | 'complete' | 'error';
  message: string;
  current: number;
  total: number;
  found: number;
  new: number;
}

// Configurações de análise de fase baseado em palavras-chave
export const PHASE_KEYWORDS: Record<ProcessPhase, string[]> = {
  distribuicao: ['distribuído', 'distribuição', 'sorteio', 'autuação'],
  citacao: ['citação', 'citado', 'citar', 'mandado de citação'],
  contestacao: ['contestação', 'defesa', 'resposta do réu'],
  instrucao: ['instrução', 'prova', 'perícia', 'audiência de instrução', 'testemunha'],
  sentenca: ['sentença', 'julgamento', 'procedente', 'improcedente'],
  recurso: ['recurso', 'apelação', 'agravo', 'embargos'],
  transito_julgado: ['trânsito em julgado', 'transitado', 'certidão de trânsito'],
  cumprimento: ['cumprimento de sentença', 'execução', 'penhora', 'leilão'],
  arquivamento: ['arquivado', 'arquivamento', 'baixa definitiva'],
};

// Palavras-chave que indicam necessidade de atenção
export const ATTENTION_KEYWORDS = [
  'prazo',
  'urgente',
  'intimação',
  'manifestação',
  'audiência designada',
  'comparecer',
  'apresentar',
  'juntar',
  'cumprir',
];

// Palavras-chave que indicam situação crítica
export const CRITICAL_KEYWORDS = [
  'revelia',
  'preclusão',
  'multa',
  'extinção',
  'deserção',
  'intempestivo',
  'não comparecimento',
];
