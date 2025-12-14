-- Migration: Adicionar campo viewed_at e criar bucket signatures
-- Criado em: 2025-06-13

-- =====================================================
-- IMPORTANTE: Criar bucket 'signatures' MANUALMENTE no Supabase Dashboard
-- 1. Vá em Storage > New bucket
-- 2. Nome: signatures
-- 3. Marque "Public bucket"
-- 4. Clique em Create bucket
-- 5. Vá em Policies e adicione:
--    - INSERT: true (permite upload público)
--    - SELECT: true (permite leitura pública)
-- =====================================================

-- Adicionar coluna viewed_at para registrar quando o signatário visualizou o documento
ALTER TABLE signature_signers 
ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;

-- Criar índice para consultas por viewed_at
CREATE INDEX IF NOT EXISTS idx_signature_signers_viewed_at ON signature_signers(viewed_at);

-- Comentário explicativo
COMMENT ON COLUMN signature_signers.viewed_at IS 'Data/hora em que o signatário visualizou o documento pela primeira vez';

-- Policy para permitir UPDATE público em signature_signers (para marcar viewed_at)
DROP POLICY IF EXISTS "Allow public update viewed_at" ON signature_signers;
CREATE POLICY "Allow public update viewed_at" ON signature_signers
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Policy para permitir leitura pública de profiles (para exibir dados do criador)
DROP POLICY IF EXISTS "Allow public read profiles for signature" ON profiles;
CREATE POLICY "Allow public read profiles for signature" ON profiles
  FOR SELECT
  USING (true);

-- Policy para permitir INSERT público em signature_audit_log (para registrar visualização)
DROP POLICY IF EXISTS "Allow public insert audit log" ON signature_audit_log;
CREATE POLICY "Allow public insert audit log" ON signature_audit_log
  FOR INSERT
  WITH CHECK (true);
