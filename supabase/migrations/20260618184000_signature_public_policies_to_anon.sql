-- Restringe as policies públicas do fluxo de assinatura ao role anon.
-- Antes elas usavam TO public, o que também vazava esse acesso para usuários
-- autenticados do escritório.

DROP POLICY IF EXISTS "Public can view request by id" ON public.signature_requests;
CREATE POLICY "Public can view request by id"
  ON public.signature_requests
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Public view via token" ON public.signature_requests;
CREATE POLICY "Public view via token"
  ON public.signature_requests
  FOR SELECT
  TO anon
  USING (public_token IS NOT NULL);

DROP POLICY IF EXISTS "Public can view signer by token" ON public.signature_signers;
CREATE POLICY "Public can view signer by token"
  ON public.signature_signers
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Public access via token for signing" ON public.signature_signers;
CREATE POLICY "Public access via token for signing"
  ON public.signature_signers
  FOR UPDATE
  TO anon
  USING (public_token IS NOT NULL)
  WITH CHECK (public_token IS NOT NULL);

DROP POLICY IF EXISTS "Allow public update viewed_at" ON public.signature_signers;
CREATE POLICY "Allow public update viewed_at"
  ON public.signature_signers
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public insert audit log" ON public.signature_audit_log;
CREATE POLICY "Allow public insert audit log"
  ON public.signature_audit_log
  FOR INSERT
  TO anon
  WITH CHECK (true);
