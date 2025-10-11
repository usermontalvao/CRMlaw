-- Adicionar colunas para controle de sincronização DJEN
-- Execute este SQL no Supabase SQL Editor

ALTER TABLE processes 
ADD COLUMN IF NOT EXISTS djen_synced BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS djen_last_sync TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS djen_has_data BOOLEAN DEFAULT FALSE;

-- Criar índice para melhorar performance das buscas
CREATE INDEX IF NOT EXISTS idx_processes_djen_sync 
ON processes(djen_synced, djen_has_data, djen_last_sync);

-- Comentários para documentação
COMMENT ON COLUMN processes.djen_synced IS 'Indica se o processo já foi sincronizado com DJEN';
COMMENT ON COLUMN processes.djen_last_sync IS 'Data/hora da última tentativa de sincronização';
COMMENT ON COLUMN processes.djen_has_data IS 'Indica se foram encontrados dados no DJEN';
