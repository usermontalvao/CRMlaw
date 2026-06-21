-- ── Writes públicos restritos por public_token (substituem policies anon amplas) ──

-- Marca visualização do próprio signatário (por token) + registra evento de auditoria.
CREATE OR REPLACE FUNCTION public.public_mark_signer_viewed(
  p_token uuid, p_ip_address text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_signer_id   uuid;
  v_request_id  uuid;
  v_signer_name text;
  v_exists      boolean;
  v_description text;
BEGIN
  IF p_token IS NULL THEN RETURN; END IF;

  SELECT ss.id, ss.signature_request_id, ss.name
    INTO v_signer_id, v_request_id, v_signer_name
    FROM public.signature_signers ss
   WHERE ss.public_token = p_token
   LIMIT 1;

  IF v_signer_id IS NULL THEN RETURN; END IF;

  UPDATE public.signature_signers
     SET viewed_at = now()
   WHERE id = v_signer_id AND viewed_at IS NULL;

  SELECT EXISTS(
    SELECT 1 FROM public.signature_audit_log al
     WHERE al.signature_request_id = v_request_id
       AND al.signer_id = v_signer_id
       AND al.action = 'viewed'
       AND coalesce(al.ip_address,'') = coalesce(p_ip_address,'')
       AND coalesce(al.user_agent,'') = coalesce(p_user_agent,'')
       AND al.created_at >= (now() - interval '5 minutes')
  ) INTO v_exists;
  IF v_exists THEN RETURN; END IF;

  v_description := coalesce(v_signer_name,'Signatário') || ' abriu o documento para leitura';
  IF p_ip_address IS NOT NULL AND p_ip_address <> '' THEN
    v_description := v_description || ' (IP: ' || p_ip_address || ')';
  END IF;

  INSERT INTO public.signature_audit_log(signature_request_id, signer_id, action, description, ip_address, user_agent)
  VALUES (v_request_id, v_signer_id, 'viewed', v_description, p_ip_address, p_user_agent);
END;
$$;

-- Heartbeat de presença do próprio signatário (por token).
CREATE OR REPLACE FUNCTION public.public_heartbeat_signer(p_token uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_signer_id uuid;
BEGIN
  IF p_token IS NULL THEN RETURN; END IF;
  SELECT id INTO v_signer_id FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  UPDATE public.signature_signers SET opened_at = now() WHERE id = v_signer_id AND opened_at IS NULL;
  UPDATE public.signature_signers SET last_seen_at = now() WHERE id = v_signer_id;
END;
$$;

-- Anexa o PDF assinado/sha256 ao próprio signatário (por token), só após assinado.
CREATE OR REPLACE FUNCTION public.public_attach_signed_pdf(
  p_token uuid, p_path text, p_sha256 text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_signer_id uuid; v_status text;
BEGIN
  IF p_token IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN RETURN; END IF;
  SELECT id, status INTO v_signer_id, v_status
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;
  UPDATE public.signature_signers
     SET signed_document_path = p_path,
         signed_pdf_sha256 = coalesce(p_sha256, signed_pdf_sha256)
   WHERE id = v_signer_id;
END;
$$;

-- Verificação pública por hash — retorna apenas campos mínimos (sem PII como IP,
-- user agent, geolocalização, auth_google_sub, e-mails).
CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_signer signature_signers;
  v_request signature_requests;
BEGIN
  IF p_hash IS NULL OR btrim(p_hash) = '' THEN RETURN NULL; END IF;
  v_code := upper(btrim(p_hash));

  SELECT * INTO v_signer FROM public.signature_signers
   WHERE upper(verification_hash) = v_code LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;
    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash),
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status));
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
  END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status));
  END IF;
  RETURN jsonb_build_object('status','valid',
    'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_request.client_name,'Signatário'),'status',v_request.status,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'verification_hash',v_request.verification_hash,'signed_document_path',v_request.signed_document_path),
    'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
END;
$$;

REVOKE ALL ON FUNCTION public.public_mark_signer_viewed(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_heartbeat_signer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_attach_signed_pdf(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_mark_signer_viewed(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_heartbeat_signer(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_pdf(uuid,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;
