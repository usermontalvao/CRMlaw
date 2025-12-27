-- Tabela de Petições Padrões
CREATE TABLE IF NOT EXISTS standard_petitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'requerimento_administrativo' CHECK (category IN ('requerimento_administrativo', 'peticao_inicial', 'recurso', 'contestacao', 'outros')),
  content TEXT NOT NULL DEFAULT '',
  file_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Campos Personalizados das Petições
CREATE TABLE IF NOT EXISTS standard_petition_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  petition_id UUID NOT NULL REFERENCES standard_petitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  placeholder TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'select', 'textarea', 'currency', 'cpf', 'phone', 'cep')),
  required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  options JSONB,
  description TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Histórico de Documentos Gerados
CREATE TABLE IF NOT EXISTS generated_petition_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  petition_id UUID NOT NULL REFERENCES standard_petitions(id) ON DELETE CASCADE,
  petition_name TEXT NOT NULL,
  client_id UUID,
  client_name TEXT,
  requirement_id UUID,
  file_name TEXT NOT NULL,
  file_path TEXT,
  mime_type TEXT,
  field_values JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_standard_petitions_category ON standard_petitions(category);
CREATE INDEX IF NOT EXISTS idx_standard_petitions_is_active ON standard_petitions(is_active);
CREATE INDEX IF NOT EXISTS idx_standard_petition_fields_petition_id ON standard_petition_fields(petition_id);
CREATE INDEX IF NOT EXISTS idx_generated_petition_documents_petition_id ON generated_petition_documents(petition_id);
CREATE INDEX IF NOT EXISTS idx_generated_petition_documents_client_id ON generated_petition_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_generated_petition_documents_requirement_id ON generated_petition_documents(requirement_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_standard_petitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_standard_petitions_updated_at ON standard_petitions;
CREATE TRIGGER trigger_standard_petitions_updated_at
  BEFORE UPDATE ON standard_petitions
  FOR EACH ROW
  EXECUTE FUNCTION update_standard_petitions_updated_at();

DROP TRIGGER IF EXISTS trigger_standard_petition_fields_updated_at ON standard_petition_fields;
CREATE TRIGGER trigger_standard_petition_fields_updated_at
  BEFORE UPDATE ON standard_petition_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_standard_petitions_updated_at();

-- RLS (Row Level Security)
ALTER TABLE standard_petitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE standard_petition_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_petition_documents ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (permitir acesso autenticado)
DROP POLICY IF EXISTS "Allow authenticated users to read standard_petitions" ON standard_petitions;
CREATE POLICY "Allow authenticated users to read standard_petitions" ON standard_petitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert standard_petitions" ON standard_petitions;
CREATE POLICY "Allow authenticated users to insert standard_petitions" ON standard_petitions
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update standard_petitions" ON standard_petitions;
CREATE POLICY "Allow authenticated users to update standard_petitions" ON standard_petitions
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete standard_petitions" ON standard_petitions;
CREATE POLICY "Allow authenticated users to delete standard_petitions" ON standard_petitions
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to read standard_petition_fields" ON standard_petition_fields;
CREATE POLICY "Allow authenticated users to read standard_petition_fields" ON standard_petition_fields
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert standard_petition_fields" ON standard_petition_fields;
CREATE POLICY "Allow authenticated users to insert standard_petition_fields" ON standard_petition_fields
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update standard_petition_fields" ON standard_petition_fields;
CREATE POLICY "Allow authenticated users to update standard_petition_fields" ON standard_petition_fields
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete standard_petition_fields" ON standard_petition_fields;
CREATE POLICY "Allow authenticated users to delete standard_petition_fields" ON standard_petition_fields
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to read generated_petition_documents" ON generated_petition_documents;
CREATE POLICY "Allow authenticated users to read generated_petition_documents" ON generated_petition_documents
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert generated_petition_documents" ON generated_petition_documents;
CREATE POLICY "Allow authenticated users to insert generated_petition_documents" ON generated_petition_documents
  FOR INSERT TO authenticated WITH CHECK (true);

-- Criar bucket de storage para petições
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'standard-petitions',
  'standard-petitions',
  false,
  52428800,
  ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage
DROP POLICY IF EXISTS "Allow authenticated users to read standard-petitions" ON storage.objects;
CREATE POLICY "Allow authenticated users to read standard-petitions" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'standard-petitions');

DROP POLICY IF EXISTS "Allow authenticated users to insert standard-petitions" ON storage.objects;
CREATE POLICY "Allow authenticated users to insert standard-petitions" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'standard-petitions');

DROP POLICY IF EXISTS "Allow authenticated users to update standard-petitions" ON storage.objects;
CREATE POLICY "Allow authenticated users to update standard-petitions" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'standard-petitions');

DROP POLICY IF EXISTS "Allow authenticated users to delete standard-petitions" ON storage.objects;
CREATE POLICY "Allow authenticated users to delete standard-petitions" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'standard-petitions');
