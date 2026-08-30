-- ============================================================================
-- O DOSSIÊ PROBATÓRIO ESTAVA ABERTO AO ANÔNIMO.
-- ----------------------------------------------------------------------------
-- `signature_forensic_report` tinha a guarda certa e mesmo assim não guardava
-- nada. A linha era:
--
--     IF NOT (public.is_office_staff() OR v_req.created_by = auth.uid()) THEN
--       RAISE EXCEPTION 'Acesso negado ao relatório forense.';
--     END IF;
--
-- Para um chamador ANÔNIMO, `auth.uid()` é NULL. Então:
--
--     is_office_staff()            → false
--     created_by = NULL            → NULL   (não é false: é desconhecido)
--     false OR NULL                → NULL
--     NOT NULL                     → NULL
--     IF NULL THEN ...             → NÃO EXECUTA
--
-- Ou seja: a única situação em que a guarda PRECISAVA disparar — alguém sem
-- sessão — é exatamente a única em que ela não disparava. A lógica de três
-- valores do SQL transformou o porteiro em decoração, e a função seguia direto
-- para o RETURN devolvendo o dossiê inteiro: nome, CPF, e-mail, telefone, IP,
-- geolocalização e user-agent de cada signatário.
--
-- Conferido em produção antes desta migration, com a chave `anon` (que viaja no
-- bundle do front, ou seja, é pública) e só o UUID do envelope:
--
--     curl .../rest/v1/rpc/signature_forensic_report -d '{"p_request_id":"..."}'
--       → {"signers":[{"cpf":"045.748.031-93","name":"PEDRO RODRIGU...
--
-- Duas correções, porque uma só não basta:
--
--   1. A guarda passa a ser fail-closed por construção (`IS NOT TRUE`), que
--      trata NULL como "não autorizado" em vez de "não sei, pode passar".
--   2. O EXECUTE é revogado de `anon`. A migration original já mandava
--      `GRANT ... TO authenticated, service_role`, mas o `anon` estava lá em
--      produção assim mesmo — provavelmente de um `GRANT` amplo anterior. Um
--      CREATE OR REPLACE não mexe em ACL, então isso precisa ser explícito.
--
-- Defesa em profundidade: depois desta migration, um anônimo é barrado pelo
-- GRANT antes de chegar à função, e barrado pela guarda se algum dia o GRANT
-- voltar por engano.
-- ============================================================================

-- ── 1. Guarda fail-closed ───────────────────────────────────────────────────
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
  v_autorizado boolean;
BEGIN
  IF p_request_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_req FROM public.signature_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Autorização: equipe interna OU criador do envelope.
  --
  -- `coalesce(..., false)` + `IS NOT TRUE`: qualquer resultado que não seja um
  -- TRUE explícito (inclusive NULL, o caso do anônimo) nega o acesso. Nunca
  -- reescreva isto como `IF NOT (a OR b)` — foi assim que o dossiê vazou.
  v_autorizado := coalesce(public.is_office_staff(), false)
                  OR coalesce(v_req.created_by = auth.uid(), false);

  IF v_autorizado IS NOT TRUE THEN
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
      'version', 2,
      'generated_at', now(),
      'methodology', 'A integridade de cada documento é aferida por função de hash criptográfica SHA-256 e por trilha de auditoria do tipo append-only encadeada por hash (cada registro incorpora o hash do registro anterior, tornando a adulteração detectável). Cada documento é verificável de forma independente por seu código individual, e a integridade da cadeia é recalculada no servidor no momento da emissão deste laudo.'
    ),
    'envelope', jsonb_build_object(
      'id', v_req.id,
      -- O protocolo é o UUID. `envelope_verification_code` continua no payload
      -- por compatibilidade com quem já lê este JSON, mas NÃO é identificador
      -- público: o dossiê não o apresenta (ver ForensicDossier.tsx).
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
      'blocked_reason', v_req.blocked_reason,
      -- Quantos documentos o envelope DEVERIA ter. Sem isto o dossiê não
      -- consegue distinguir "todos conferidos" de "só os que sobraram".
      'expected_document_count', 1 + coalesce(array_length(v_req.attachment_paths, 1), 0)
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

-- ── 2. Grants: funções INTERNAS não são executáveis pelo anônimo ────────────
REVOKE ALL ON FUNCTION public.signature_forensic_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signature_forensic_report(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.signature_forensic_report(uuid) IS
  'Dossie probatorio completo de um envelope. Acesso: is_office_staff ou criador (guarda fail-closed; NULL nega). Nao executavel por anon.';

-- `signature_audit_verify_chain` devolve a auditoria interna do envelope e não
-- tem porteiro próprio — o `anon` conseguia chamá-la para qualquer UUID.
REVOKE ALL ON FUNCTION public.signature_audit_verify_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signature_audit_verify_chain(uuid) TO authenticated, service_role;

-- Enfileirar finalização é trabalho do orquestrador (service role). O fluxo
-- público chama a Edge Function, nunca este RPC diretamente.
REVOKE ALL ON FUNCTION public.enqueue_signature_finalization(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_signature_finalization(uuid, integer) TO service_role;
