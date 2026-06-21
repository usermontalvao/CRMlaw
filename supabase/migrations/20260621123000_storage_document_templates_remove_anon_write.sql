-- Remove anon de DELETE/UPDATE no bucket document-templates (risco destrutivo:
-- anon podia apagar/sobrescrever TODOS os modelos). Mantém authenticated (staff).
-- INSERT/SELECT anon permanecem por ora: o fluxo de assinatura pública ainda lê
-- document-templates/generated-documents/signatures/assinados direto como anon
-- (createSignedUrl) e sobe o PDF assinado em `assinados` via anon. O lockdown
-- total desses buckets depende de migrar o fluxo público para edge functions
-- (public-signing-file já existe para leitura; falta a escrita).

DROP POLICY IF EXISTS "Allow delete document templates" ON storage.objects;
CREATE POLICY "Allow delete document templates"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'document-templates');

DROP POLICY IF EXISTS "Allow update document templates" ON storage.objects;
CREATE POLICY "Allow update document templates"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'document-templates')
  WITH CHECK (bucket_id = 'document-templates');
