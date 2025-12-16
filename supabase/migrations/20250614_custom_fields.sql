-- Tabela de campos personalizados GLOBAIS para documentos
-- Estes campos complementam os campos padrão do cliente (NOME COMPLETO, CPF, etc.)
-- e ficam disponíveis para TODOS os templates
CREATE TABLE IF NOT EXISTS document_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- Nome amigável do campo (ex: "Valor do Contrato")
  placeholder TEXT NOT NULL UNIQUE, -- Placeholder no template (ex: "VALOR_CONTRATO") - deve ser único
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'select', 'textarea', 'currency')),
  required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  options JSONB, -- Para campos do tipo 'select': [{"value": "opcao1", "label": "Opção 1"}]
  description TEXT, -- Descrição/ajuda para o usuário
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para ordenação
CREATE INDEX IF NOT EXISTS idx_document_custom_fields_order ON document_custom_fields("order");

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_document_custom_fields_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_document_custom_fields_updated_at ON document_custom_fields;
CREATE TRIGGER trigger_update_document_custom_fields_updated_at
  BEFORE UPDATE ON document_custom_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_document_custom_fields_updated_at();

-- RLS (Row Level Security)
ALTER TABLE document_custom_fields ENABLE ROW LEVEL SECURITY;

-- Política para permitir leitura para usuários autenticados
CREATE POLICY "Usuários autenticados podem ver campos personalizados"
  ON document_custom_fields
  FOR SELECT
  TO authenticated
  USING (true);

-- Política para permitir inserção para usuários autenticados
CREATE POLICY "Usuários autenticados podem criar campos personalizados"
  ON document_custom_fields
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Política para permitir atualização para usuários autenticados
CREATE POLICY "Usuários autenticados podem atualizar campos personalizados"
  ON document_custom_fields
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Política para permitir exclusão para usuários autenticados
CREATE POLICY "Usuários autenticados podem excluir campos personalizados"
  ON document_custom_fields
  FOR DELETE
  TO authenticated
  USING (true);
