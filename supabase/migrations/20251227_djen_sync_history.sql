-- Adicionar colunas que podem estar faltando na tabela djen_sync_history
-- (a tabela já existe, apenas garantindo que todas as colunas necessárias existam)

DO $$ 
BEGIN
  -- Adicionar coluna source se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'source') THEN
    ALTER TABLE djen_sync_history ADD COLUMN source TEXT;
  END IF;

  -- Adicionar coluna origin se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'origin') THEN
    ALTER TABLE djen_sync_history ADD COLUMN origin TEXT;
  END IF;

  -- Adicionar coluna trigger_type se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'trigger_type') THEN
    ALTER TABLE djen_sync_history ADD COLUMN trigger_type TEXT;
  END IF;

  -- Adicionar coluna status se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'status') THEN
    ALTER TABLE djen_sync_history ADD COLUMN status TEXT DEFAULT 'pending';
  END IF;

  -- Adicionar coluna run_started_at se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'run_started_at') THEN
    ALTER TABLE djen_sync_history ADD COLUMN run_started_at TIMESTAMPTZ;
  END IF;

  -- Adicionar coluna run_finished_at se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'run_finished_at') THEN
    ALTER TABLE djen_sync_history ADD COLUMN run_finished_at TIMESTAMPTZ;
  END IF;

  -- Adicionar coluna created_at se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'created_at') THEN
    ALTER TABLE djen_sync_history ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Adicionar coluna next_run_at se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'next_run_at') THEN
    ALTER TABLE djen_sync_history ADD COLUMN next_run_at TIMESTAMPTZ;
  END IF;

  -- Adicionar coluna items_found se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'items_found') THEN
    ALTER TABLE djen_sync_history ADD COLUMN items_found INTEGER DEFAULT 0;
  END IF;

  -- Adicionar coluna items_saved se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'items_saved') THEN
    ALTER TABLE djen_sync_history ADD COLUMN items_saved INTEGER DEFAULT 0;
  END IF;

  -- Adicionar coluna error_message se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'error_message') THEN
    ALTER TABLE djen_sync_history ADD COLUMN error_message TEXT;
  END IF;

  -- Adicionar coluna message se não existir
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'djen_sync_history' AND column_name = 'message') THEN
    ALTER TABLE djen_sync_history ADD COLUMN message TEXT;
  END IF;
END $$;

-- Índices para performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_djen_sync_history_status ON djen_sync_history(status);
CREATE INDEX IF NOT EXISTS idx_djen_sync_history_created_at ON djen_sync_history(created_at DESC);

-- RLS
ALTER TABLE djen_sync_history ENABLE ROW LEVEL SECURITY;

-- Política para leitura (todos autenticados podem ver)
DROP POLICY IF EXISTS "Authenticated users can view sync history" ON djen_sync_history;
CREATE POLICY "Authenticated users can view sync history"
  ON djen_sync_history FOR SELECT
  TO authenticated
  USING (true);

-- Política para inserção (service role e authenticated)
DROP POLICY IF EXISTS "Service role can insert sync history" ON djen_sync_history;
CREATE POLICY "Service role can insert sync history"
  ON djen_sync_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Política para atualização (service role e authenticated)
DROP POLICY IF EXISTS "Service role can update sync history" ON djen_sync_history;
CREATE POLICY "Service role can update sync history"
  ON djen_sync_history FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Comentário na tabela
COMMENT ON TABLE djen_sync_history IS 'Histórico de execuções de sincronização com DJEN';
