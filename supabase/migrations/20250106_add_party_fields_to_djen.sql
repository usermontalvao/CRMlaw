-- Migration: Add party fields to djen_comunicacoes table
-- Description: Adds polo_ativo and polo_passivo fields to store party names

-- Add columns for parties
ALTER TABLE djen_comunicacoes
ADD COLUMN IF NOT EXISTS polo_ativo TEXT,
ADD COLUMN IF NOT EXISTS polo_passivo TEXT;

-- Add indexes for search performance
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_polo_ativo ON djen_comunicacoes(polo_ativo);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_polo_passivo ON djen_comunicacoes(polo_passivo);

-- Add comments
COMMENT ON COLUMN djen_comunicacoes.polo_ativo IS 'Nome da(s) parte(s) do polo ativo (autor/requerente)';
COMMENT ON COLUMN djen_comunicacoes.polo_passivo IS 'Nome da(s) parte(s) do polo passivo (réu/requerido)';
