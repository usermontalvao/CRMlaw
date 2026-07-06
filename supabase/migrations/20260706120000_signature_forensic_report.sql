-- ============================================================================
-- Relatório forense (dossiê probatório) de um envelope de assinatura.
-- ----------------------------------------------------------------------------
-- Monta, do lado do servidor, TODO o material necessário para comprovar a
-- licitude de uma assinatura em juízo, num único documento verificável:
--   • identificação do envelope (protocolo, código de verificação, datas);
--   • cada documento com seus DOIS hashes (PDF assinado + fonte) e código;
--   • cada signatário com a prova do ato (IP, dispositivo, geolocalização,
--     método de autenticação, aceite dos termos, biometria, carimbos de tempo);
--   • a trilha de auditoria COMPLETA com a cadeia de hash;
--   • o VEREDITO de integridade da cadeia, calculado no servidor (A2).
--
-- Somente equipe interna (is_office_staff) ou o criador do envelope acessam.
-- Read-only, sem efeito colateral.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.signature_forensic_report(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req      public.signature_requests;
  v_docs     jsonb;
  v_signers  jsonb;
  v_trail    jsonb;
  v_broken   jsonb;
  v_broken_n int;
BEGIN
  IF p_request_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_req FROM public.signature_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Autorização: equipe interna OU criador do envelope.
  IF NOT (public.is_office_staff() OR v_req.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado ao relatório forense.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Documentos (cada um com seus hashes e código de verificação).
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'document_key', d.document_key,
             'document_type', d.document_type,
             'display_name', d.display_name,
             'verification_code', d.verification_code,
             'signed_pdf_sha256', d.signed_pdf_sha256,
             'source_document_sha256', d.document_hash,
             'hash_source', d.hash_source,
             'page_count', d.page_count,
             'signed_file_path', d.signed_file_path,
             'source_file_path', d.source_file_path,
             'status', d.status,
             'created_at', d.created_at
           ) ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
    INTO v_docs
  FROM public.signature_request_documents d
  WHERE d.signature_request_id = p_request_id;

  -- Signatários (prova completa do ato de assinar).
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'name', s.name,
             'cpf', s.cpf,
             'email', s.email,
             'phone', s.phone,
             'role', s.role,
             'order', s."order",
             'status', s.status,
             'auth_method', s.auth_method,
             'auth_provider', s.auth_provider,
             'auth_email', s.auth_email,
             'auth_google_sub', s.auth_google_sub,
             'ip_address', s.signer_ip,
             'user_agent', s.signer_user_agent,
             'geolocation', s.signer_geolocation,
             'opened_at', s.opened_at,
             'viewed_at', s.viewed_at,
             'signed_at', s.signed_at,
             'last_seen_at', s.last_seen_at,
             'terms_accepted_at', s.terms_accepted_at,
             'terms_version', s.terms_version,
             'signer_verification_hash', s.verification_hash,
             'signature_image_path', s.signature_image_path,
             'facial_image_path', s.facial_image_path,
             'document_image_path', s.document_image_path,
             'signed_pdf_sha256', s.signed_pdf_sha256,
             'integrity_sha256', s.integrity_sha256,
             'presented_document_sha256', s.presented_document_sha256,
             'presented_at', s.presented_at,
             'has_facial_biometrics', (s.facial_image_path IS NOT NULL),
             'has_document_image', (s.document_image_path IS NOT NULL),
             'refused_at', s.refused_at,
             'refusal_reason', s.refusal_reason
           ) ORDER BY s."order" NULLS LAST, s.created_at), '[]'::jsonb)
    INTO v_signers
  FROM public.signature_signers s
  WHERE s.signature_request_id = p_request_id;

  -- Trilha de auditoria COMPLETA com a cadeia de hash.
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'action', a.action,
             'description', a.description,
             'ip_address', a.ip_address,
             'user_agent', a.user_agent,
             'created_at', a.created_at,
             'prev_hash', a.prev_hash,
             'entry_hash', a.entry_hash
           ) ORDER BY a.created_at, a.id), '[]'::jsonb)
    INTO v_trail
  FROM public.signature_audit_log a
  WHERE a.signature_request_id = p_request_id;

  -- Veredito da cadeia (0 quebras = íntegra), recalculado agora no servidor.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'created_at', v.created_at, 'reason', v.reason)), '[]'::jsonb),
         count(*)
    INTO v_broken, v_broken_n
  FROM public.signature_audit_verify_chain(p_request_id) v;

  RETURN jsonb_build_object(
    'report', jsonb_build_object(
      'kind', 'forensic_dossier',
      'version', 1,
      'generated_at', now(),
      'methodology', 'A integridade de cada documento é aferida por função de hash criptográfica SHA-256 e por trilha de auditoria do tipo append-only encadeada por hash (cada registro incorpora o hash do registro anterior, tornando a adulteração detectável). Cada documento é verificável de forma independente por seu código individual, e a integridade da cadeia é recalculada no servidor no momento da emissão deste laudo.'
    ),
    'envelope', jsonb_build_object(
      'id', v_req.id,
      'protocol', v_req.id::text,
      'envelope_verification_code', v_req.envelope_verification_code,
      'document_name', v_req.document_name,
      'client_name', v_req.client_name,
      'process_number', v_req.process_number,
      'requirement_number', v_req.requirement_number,
      'signature_model', v_req.signature_model,
      'auth_method', v_req.auth_method,
      'signing_order', v_req.signing_order,
      'status', v_req.status,
      'created_at', v_req.created_at,
      'signed_at', v_req.signed_at,
      'expires_at', v_req.expires_at,
      'blocked_at', v_req.blocked_at,
      'blocked_reason', v_req.blocked_reason
    ),
    'chain_integrity', jsonb_build_object(
      'verified', (v_broken_n = 0),
      'broken_count', v_broken_n,
      'broken_entries', v_broken
    ),
    'documents', v_docs,
    'signers', v_signers,
    'audit_trail', v_trail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.signature_forensic_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_forensic_report(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.signature_forensic_report(uuid) IS
  'Dossie probatorio completo de um envelope: envelope + documentos (hashes) + signatarios (prova do ato) + trilha encadeada + veredito de integridade. Acesso: is_office_staff ou criador.';
