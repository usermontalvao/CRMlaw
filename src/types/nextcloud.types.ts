/**
 * types/nextcloud.types
 * -----------------------------------------------------------------------------
 * Tipos compartilhados do módulo Nextcloud. Fonte única de verdade para o
 * resultado de operações em lote e para a resolução de conflitos de nome —
 * reutilizados por upload, arrastar, copiar, mover, conversões e ferramentas PDF.
 */

/** Estado de um item dentro de uma operação em lote. */
export type BatchItemStatus = 'pending' | 'processing' | 'done' | 'skipped' | 'failed';

/** Resultado individual de um item de uma operação em lote. */
export interface BatchItemResult {
  /** Identificador estável do item (ex.: caminho de origem). */
  id: string;
  /** Origem legível (para exibir na UI). */
  source: string;
  /** Destino final efetivo (pode diferir da origem por renomeação anti-conflito). */
  destination?: string;
  status: BatchItemStatus;
  /** Mensagem de erro quando `status === 'failed'`. */
  error?: string;
}

/** Como resolver um conflito quando o destino já existe. */
export type ConflictStrategy = 'keep-both' | 'replace' | 'cancel';

/** Decisão do usuário (ou política) para um conflito específico. */
export interface ConflictDecision {
  strategy: ConflictStrategy;
  /** Quando `keep-both`, o nome novo, único e confirmado contra o servidor. */
  resolvedName?: string;
}

/** Escopo explícito das ferramentas PDF que aceitam vários documentos. */
export type PdfToolScope = 'active' | 'selected';
