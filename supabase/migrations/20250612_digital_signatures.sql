-- Migration: Módulo de Assinatura Digital
-- Criado em: 2025-06-12

-- Tabela principal de solicitações de assinatura
CREATE TABLE IF NOT EXISTS signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  document_name VARCHAR(500) NOT NULL,
  document_path TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_name VARCHAR(255),
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  process_number VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired', 'cancelled')),
  auth_method VARCHAR(50) NOT NULL DEFAULT 'signature_only' CHECK (auth_method IN ('signature_only', 'signature_facial', 'signature_facial_document')),
  expires_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Dados coletados (para assinatura única sem signatários múltiplos)
  signature_image_path TEXT,
  facial_image_path TEXT,
  document_image_path TEXT,
  -- Metadados
  signer_ip VARCHAR(50),
  signer_user_agent TEXT,
  signer_geolocation TEXT,
  -- Token público para assinatura externa
  public_token UUID DEFAULT gen_random_uuid()
);

-- Tabela de signatários (para múltiplos assinantes)
CREATE TABLE IF NOT EXISTS signature_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  cpf VARCHAR(20),
  phone VARCHAR(30),
  role VARCHAR(100), -- Ex: "Contratante", "Contratado", "Testemunha"
  "order" INTEGER DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'expired', 'cancelled')),
  auth_method VARCHAR(50) NOT NULL DEFAULT 'signature_only' CHECK (auth_method IN ('signature_only', 'signature_facial', 'signature_facial_document')),
  signed_at TIMESTAMPTZ,
  -- Dados coletados
  signature_image_path TEXT,
  facial_image_path TEXT,
  document_image_path TEXT,
  -- Metadados
  signer_ip VARCHAR(50),
  signer_user_agent TEXT,
  signer_geolocation TEXT,
  -- Token público para assinatura
  public_token UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela de histórico/auditoria
CREATE TABLE IF NOT EXISTS signature_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES signature_signers(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'sent', 'viewed', 'signed', 'cancelled', 'expired', 'reminder_sent')),
  description TEXT NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON signature_requests(status);
CREATE INDEX IF NOT EXISTS idx_signature_requests_created_by ON signature_requests(created_by);
CREATE INDEX IF NOT EXISTS idx_signature_requests_client_id ON signature_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_process_id ON signature_requests(process_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_public_token ON signature_requests(public_token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_expires_at ON signature_requests(expires_at);

CREATE INDEX IF NOT EXISTS idx_signature_signers_request_id ON signature_signers(signature_request_id);
CREATE INDEX IF NOT EXISTS idx_signature_signers_status ON signature_signers(status);
CREATE INDEX IF NOT EXISTS idx_signature_signers_public_token ON signature_signers(public_token);
CREATE INDEX IF NOT EXISTS idx_signature_signers_email ON signature_signers(email);

CREATE INDEX IF NOT EXISTS idx_signature_audit_log_request_id ON signature_audit_log(signature_request_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_signature_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_signature_requests_updated_at ON signature_requests;
CREATE TRIGGER trigger_signature_requests_updated_at
  BEFORE UPDATE ON signature_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_updated_at();

DROP TRIGGER IF EXISTS trigger_signature_signers_updated_at ON signature_signers;
CREATE TRIGGER trigger_signature_signers_updated_at
  BEFORE UPDATE ON signature_signers
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_updated_at();

-- RLS Policies
ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_audit_log ENABLE ROW LEVEL SECURITY;

-- Policies para signature_requests
DROP POLICY IF EXISTS "Users can view their own signature requests" ON signature_requests;
CREATE POLICY "Users can view their own signature requests"
  ON signature_requests FOR SELECT
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can create signature requests" ON signature_requests;
CREATE POLICY "Users can create signature requests"
  ON signature_requests FOR INSERT
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update their own signature requests" ON signature_requests;
CREATE POLICY "Users can update their own signature requests"
  ON signature_requests FOR UPDATE
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete their own signature requests" ON signature_requests;
CREATE POLICY "Users can delete their own signature requests"
  ON signature_requests FOR DELETE
  USING (auth.uid() = created_by);

-- Policies para signature_signers (baseado no request)
DROP POLICY IF EXISTS "Users can view signers of their requests" ON signature_signers;
CREATE POLICY "Users can view signers of their requests"
  ON signature_signers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create signers for their requests" ON signature_signers;
CREATE POLICY "Users can create signers for their requests"
  ON signature_signers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update signers of their requests" ON signature_signers;
CREATE POLICY "Users can update signers of their requests"
  ON signature_signers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete signers of their requests" ON signature_signers;
CREATE POLICY "Users can delete signers of their requests"
  ON signature_signers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

-- Policies para audit_log
DROP POLICY IF EXISTS "Users can view audit logs of their requests" ON signature_audit_log;
CREATE POLICY "Users can view audit logs of their requests"
  ON signature_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create audit logs for their requests" ON signature_audit_log;
CREATE POLICY "Users can create audit logs for their requests"
  ON signature_audit_log FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

-- Policy especial: Permitir acesso público via token para assinatura
-- Isso permite que signatários externos acessem e assinem documentos

-- SELECT público pelo token (para página de assinatura sem login)
DROP POLICY IF EXISTS "Public can view signer by token" ON signature_signers;
CREATE POLICY "Public can view signer by token"
  ON signature_signers FOR SELECT
  USING (true);

-- UPDATE público pelo token (para assinar documento)
DROP POLICY IF EXISTS "Public access via token for signing" ON signature_signers;
CREATE POLICY "Public access via token for signing"
  ON signature_signers FOR UPDATE
  USING (public_token IS NOT NULL)
  WITH CHECK (public_token IS NOT NULL);

-- SELECT público para signature_requests (para mostrar info do documento)
DROP POLICY IF EXISTS "Public can view request by id" ON signature_requests;
CREATE POLICY "Public can view request by id"
  ON signature_requests FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Public view via token" ON signature_requests;
CREATE POLICY "Public view via token"
  ON signature_requests FOR SELECT
  USING (public_token IS NOT NULL);

-- ================================
-- Campos visíveis no documento (posicionamento)
-- ================================

CREATE TABLE IF NOT EXISTS signature_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES signature_signers(id) ON DELETE CASCADE,
  field_type VARCHAR(20) NOT NULL CHECK (field_type IN ('signature', 'initials', 'name', 'cpf', 'date')),
  page_number INTEGER NOT NULL DEFAULT 1,
  -- Posição e tamanho em porcentagem (0-100) relativos ao viewer
  x_percent NUMERIC(6,3) NOT NULL CHECK (x_percent >= 0 AND x_percent <= 100),
  y_percent NUMERIC(6,3) NOT NULL CHECK (y_percent >= 0 AND y_percent <= 100),
  w_percent NUMERIC(6,3) NOT NULL CHECK (w_percent > 0 AND w_percent <= 100),
  h_percent NUMERIC(6,3) NOT NULL CHECK (h_percent > 0 AND h_percent <= 100),
  required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_fields_request_id ON signature_fields(signature_request_id);
CREATE INDEX IF NOT EXISTS idx_signature_fields_signer_id ON signature_fields(signer_id);
CREATE INDEX IF NOT EXISTS idx_signature_fields_type ON signature_fields(field_type);

DROP TRIGGER IF EXISTS trigger_signature_fields_updated_at ON signature_fields;
CREATE TRIGGER trigger_signature_fields_updated_at
  BEFORE UPDATE ON signature_fields
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_updated_at();

ALTER TABLE signature_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view fields of their requests" ON signature_fields;
CREATE POLICY "Users can view fields of their requests"
  ON signature_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create fields for their requests" ON signature_fields;
CREATE POLICY "Users can create fields for their requests"
  ON signature_fields FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update fields of their requests" ON signature_fields;
CREATE POLICY "Users can update fields of their requests"
  ON signature_fields FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete fields of their requests" ON signature_fields;
CREATE POLICY "Users can delete fields of their requests"
  ON signature_fields FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM signature_requests sr
      WHERE sr.id = signature_request_id
      AND sr.created_by = auth.uid()
    )
  );

-- Comentários nas tabelas
COMMENT ON TABLE signature_requests IS 'Solicitações de assinatura digital de documentos';
COMMENT ON TABLE signature_signers IS 'Signatários de cada solicitação de assinatura';
COMMENT ON TABLE signature_audit_log IS 'Histórico de ações nas assinaturas para auditoria';
COMMENT ON TABLE signature_fields IS 'Campos visíveis (posição/tamanho) a serem inseridos no documento durante a assinatura';

COMMENT ON COLUMN signature_requests.auth_method IS 'Método de autenticação: signature_only (só assinatura), signature_facial (assinatura + foto), signature_facial_document (assinatura + foto + documento)';
COMMENT ON COLUMN signature_requests.public_token IS 'Token único para acesso público à assinatura (link externo)';
COMMENT ON COLUMN signature_signers.role IS 'Papel do signatário no documento (ex: Contratante, Contratado, Testemunha)';
COMMENT ON COLUMN signature_signers."order" IS 'Ordem de assinatura quando há múltiplos signatários';
COMMENT ON COLUMN signature_fields.field_type IS 'Tipo do campo: signature, initials, name, cpf, date';
COMMENT ON COLUMN signature_fields.x_percent IS 'Posição X (0-100) relativa ao viewer';
COMMENT ON COLUMN signature_fields.y_percent IS 'Posição Y (0-100) relativa ao viewer';
