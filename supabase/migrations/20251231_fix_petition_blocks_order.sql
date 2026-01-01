-- Migration: Garantir coluna order em petition_blocks
-- Corrige problema 400 na API quando a coluna order não existe

-- Garantir que a tabela petition_blocks tenha a coluna order
ALTER TABLE petition_blocks
  ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

-- Garantir que a coluna document_type exista (se não existir)
ALTER TABLE petition_blocks
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'petition';

-- Criar índice para order se não existir
CREATE INDEX IF NOT EXISTS idx_petition_blocks_order ON petition_blocks("order");

-- Criar índice para document_type se não existir
CREATE INDEX IF NOT EXISTS idx_petition_blocks_document_type ON petition_blocks(document_type);

-- Atualizar registros que não têm document_type definido
UPDATE petition_blocks 
SET document_type = 'petition' 
WHERE document_type IS NULL OR document_type = '';

-- Atualizar registros que não têm order definido
UPDATE petition_blocks 
SET "order" = 0 
WHERE "order" IS NULL;
