-- Tabela para links fixos reutilizáveis de preenchimento público
-- Cada permalink gera um novo token a cada acesso (não expira após uso)

CREATE TABLE IF NOT EXISTS template_fill_permalinks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) NOT NULL UNIQUE,
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  template_file_id UUID REFERENCES template_files(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prefill JSONB DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_template_fill_permalinks_slug ON template_fill_permalinks(slug);
CREATE INDEX IF NOT EXISTS idx_template_fill_permalinks_template_id ON template_fill_permalinks(template_id);
CREATE INDEX IF NOT EXISTS idx_template_fill_permalinks_created_by ON template_fill_permalinks(created_by);

-- RLS
ALTER TABLE template_fill_permalinks ENABLE ROW LEVEL SECURITY;

-- Tornar o script idempotente (SQL Editor pode rodar mais de uma vez)
DROP POLICY IF EXISTS "Users can view own permalinks" ON template_fill_permalinks;
DROP POLICY IF EXISTS "Users can insert own permalinks" ON template_fill_permalinks;
DROP POLICY IF EXISTS "Users can update own permalinks" ON template_fill_permalinks;
DROP POLICY IF EXISTS "Users can delete own permalinks" ON template_fill_permalinks;

CREATE POLICY "Users can view own permalinks"
  ON template_fill_permalinks FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own permalinks"
  ON template_fill_permalinks FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own permalinks"
  ON template_fill_permalinks FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own permalinks"
  ON template_fill_permalinks FOR DELETE
  USING (auth.uid() = created_by);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_template_fill_permalinks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_template_fill_permalinks_updated_at ON template_fill_permalinks;
CREATE TRIGGER trigger_update_template_fill_permalinks_updated_at
  BEFORE UPDATE ON template_fill_permalinks
  FOR EACH ROW
  EXECUTE FUNCTION update_template_fill_permalinks_updated_at();
