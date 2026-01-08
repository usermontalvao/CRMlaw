-- Migration: Áreas Jurídicas para o Editor de Petições
-- Permite cadastrar áreas (Trabalhista, Cível, Penal, etc.) e vincular blocos a elas
-- Blocos sem área = disponíveis para todas as áreas

-- Tabela de Áreas Jurídicas
CREATE TABLE IF NOT EXISTS legal_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#f97316', -- cor para identificação visual
  icon TEXT DEFAULT 'scale', -- ícone Lucide
  "order" INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_legal_areas_is_active ON legal_areas(is_active);
CREATE INDEX IF NOT EXISTS idx_legal_areas_order ON legal_areas("order");

-- Trigger para atualizar updated_at
DROP TRIGGER IF EXISTS trigger_legal_areas_updated_at ON legal_areas;
CREATE TRIGGER trigger_legal_areas_updated_at
  BEFORE UPDATE ON legal_areas
  FOR EACH ROW
  EXECUTE FUNCTION update_petition_editor_updated_at();

-- RLS (Row Level Security)
ALTER TABLE legal_areas ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para legal_areas
DROP POLICY IF EXISTS "Allow authenticated users to read legal_areas" ON legal_areas;
CREATE POLICY "Allow authenticated users to read legal_areas" ON legal_areas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert legal_areas" ON legal_areas;
CREATE POLICY "Allow authenticated users to insert legal_areas" ON legal_areas
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update legal_areas" ON legal_areas;
CREATE POLICY "Allow authenticated users to update legal_areas" ON legal_areas
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete legal_areas" ON legal_areas;
CREATE POLICY "Allow authenticated users to delete legal_areas" ON legal_areas
  FOR DELETE TO authenticated USING (true);

-- Adicionar coluna legal_area_id na tabela petition_blocks (opcional - NULL = disponível para todas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'petition_blocks' AND column_name = 'legal_area_id'
  ) THEN
    ALTER TABLE petition_blocks ADD COLUMN legal_area_id UUID REFERENCES legal_areas(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_petition_blocks_legal_area_id ON petition_blocks(legal_area_id);
  END IF;
END $$;

-- Adicionar coluna legal_area_id na tabela saved_petitions (opcional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'saved_petitions' AND column_name = 'legal_area_id'
  ) THEN
    ALTER TABLE saved_petitions ADD COLUMN legal_area_id UUID REFERENCES legal_areas(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_saved_petitions_legal_area_id ON saved_petitions(legal_area_id);
  END IF;
END $$;

-- Adicionar coluna legal_area_id na tabela petition_block_categories (opcional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'petition_block_categories' AND column_name = 'legal_area_id'
  ) THEN
    ALTER TABLE petition_block_categories ADD COLUMN legal_area_id UUID REFERENCES legal_areas(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_petition_block_categories_legal_area_id ON petition_block_categories(legal_area_id);
  END IF;
END $$;

-- Inserir área "Trabalhista" como padrão inicial (os blocos existentes ficam sem área = disponíveis para todas)
INSERT INTO legal_areas (name, description, color, icon, "order", is_active) VALUES
('Trabalhista', 'Direito do Trabalho - CLT, Justiça do Trabalho', '#f97316', 'briefcase', 0, true),
('Cível', 'Direito Civil - Contratos, Responsabilidade Civil, Família', '#3b82f6', 'scale', 1, true),
('Penal', 'Direito Penal - Crimes, Defesa Criminal', '#ef4444', 'shield', 2, true),
('Previdenciário', 'Direito Previdenciário - INSS, Aposentadoria, Benefícios', '#10b981', 'heart', 3, true)
ON CONFLICT DO NOTHING;
