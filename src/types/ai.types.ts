// Tipos para integração com IA (OpenAI)

export interface IntimationAnalysis {
  summary: string; // Resumo objetivo da intimação
  deadline: DeadlineExtraction | null; // Prazo extraído
  urgency: 'baixa' | 'media' | 'alta' | 'critica'; // Nível de urgência
  suggestedActions: string[]; // Ações sugeridas
  keyPoints: string[]; // Pontos-chave
  documentType: string; // Tipo de documento identificado
}

export interface DeadlineExtraction {
  days: number; // Número de dias
  dueDate: string; // Data limite (ISO)
  description: string; // Descrição do prazo
  confidence: 'baixa' | 'media' | 'alta'; // Confiança na extração
}

export interface ProcessAnalysis {
  currentStatus: string; // Status atual identificado
  nextSteps: string[]; // Próximos passos sugeridos
  anomalies: string[]; // Anomalias detectadas
  timeline: TimelineEvent[]; // Linha do tempo
}

export interface TimelineEvent {
  date: string; // Data do evento
  description: string; // Descrição
  type: 'intimacao' | 'sentenca' | 'despacho' | 'audiencia' | 'outro';
}

export interface DocumentSummary {
  summary: string; // Resumo do documento
  extractedData: Record<string, any>; // Dados extraídos
  mainPoints: string[]; // Pontos principais
  confidence: number; // Confiança (0-1)
}

export interface AIServiceConfig {
  model: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-3.5-turbo';
  temperature: number;
  maxTokens?: number;
}
