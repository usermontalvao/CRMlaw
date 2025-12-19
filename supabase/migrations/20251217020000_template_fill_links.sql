-- Migration: Links públicos para preenchimento de templates (estilo ZapSign)

CREATE TABLE IF NOT EXISTS template_fill_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token UUID NOT NULL DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  template_file_id UUID REFERENCES template_files(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  signature_request_id UUID REFERENCES signature_requests(id) ON DELETE SET NULL,
  prefill jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_template_fill_links_public_token ON template_fill_links(public_token);
CREATE INDEX IF NOT EXISTS idx_template_fill_links_template_id ON template_fill_links(template_id);
CREATE INDEX IF NOT EXISTS idx_template_fill_links_created_by ON template_fill_links(created_by);

ALTER TABLE template_fill_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own template fill links" ON template_fill_links;
CREATE POLICY "Users can view their own template fill links"
  ON template_fill_links FOR SELECT
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can create template fill links" ON template_fill_links;
CREATE POLICY "Users can create template fill links"
  ON template_fill_links FOR INSERT
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update their own template fill links" ON template_fill_links;
CREATE POLICY "Users can update their own template fill links"
  ON template_fill_links FOR UPDATE
  USING (auth.uid() = created_by);

DROP TRIGGER IF EXISTS trigger_template_fill_links_updated_at ON template_fill_links;
CREATE TRIGGER trigger_template_fill_links_updated_at
  BEFORE UPDATE ON template_fill_links
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_updated_at();
