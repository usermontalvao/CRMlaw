-- Migration: Add sub-stages to process status
-- Date: 2025-12-26
-- Description: Adds new process status values for better granularity:
--   citacao, conciliacao, contestacao, instrucao, recurso

-- Drop the existing constraint
ALTER TABLE processes DROP CONSTRAINT IF EXISTS processes_status_check;

-- Add the new constraint with all status values
ALTER TABLE processes ADD CONSTRAINT processes_status_check CHECK (
  status IN (
    'nao_protocolado',
    'distribuido',
    'aguardando_confeccao',
    'citacao',
    'conciliacao',
    'contestacao',
    'instrucao',
    'andamento',
    'sentenca',
    'recurso',
    'cumprimento',
    'arquivado'
  )
);
