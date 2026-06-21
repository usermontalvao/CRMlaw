-- Bundle público: creator reduzido ao mínimo (apenas nome), com a regra de
-- emissor desativado/KIT centralizada no servidor → "Jurius CRM".
CREATE OR REPLACE FUNCTION public.get_public_signing_bundle(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_signer signature_signers;
  v_request signature_requests;
  v_creator jsonb;
  v_creator_name text;
  v_creator_active boolean;
  v_is_kit boolean;
  v_fields jsonb;
  v_auth_config jsonb;
  v_auth_google boolean;
  v_auth_email boolean;
  v_auth_phone boolean;
  v_waiting_for text := NULL;
  v_my_order int;
BEGIN
  SELECT * INTO v_signer FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_request.archived_at IS NOT NULL OR v_request.deleted_at IS NOT NULL OR v_request.blocked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF v_request.status IN ('cancelled', 'expired') THEN RETURN NULL; END IF;
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at < now() THEN RETURN NULL; END IF;

  IF v_request.signing_order = 'sequential' THEN
    v_my_order := COALESCE((to_jsonb(v_signer)->>'order')::int, 1);
    SELECT ss.name INTO v_waiting_for
    FROM public.signature_signers ss
    WHERE ss.signature_request_id = v_request.id
      AND ss."order" < v_my_order
      AND ss.status <> 'signed'
    ORDER BY ss."order" ASC
    LIMIT 1;
  END IF;

  -- Creator mínimo: só o nome. Emissor desativado ou documento de origem KIT
  -- aparecem como "Jurius CRM" (não atribui autoria a uma pessoa).
  SELECT p.name, p.is_active INTO v_creator_name, v_creator_active
  FROM public.profiles p WHERE p.user_id = v_request.created_by LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.template_fill_links tfl WHERE tfl.signature_request_id = v_request.id
  ) INTO v_is_kit;

  IF v_creator_name IS NULL OR v_creator_active IS FALSE OR v_is_kit THEN
    v_creator := jsonb_build_object('name', 'Jurius CRM');
  ELSE
    v_creator := jsonb_build_object('name', v_creator_name);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.page_number ASC), '[]'::jsonb)
    INTO v_fields FROM public.signature_fields f WHERE f.signature_request_id = v_request.id;

  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_google
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_google' LIMIT 1;
  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_email
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_email' LIMIT 1;
  SELECT COALESCE((s.value #>> '{}')::boolean, true) INTO v_auth_phone
  FROM public.system_settings s WHERE s.key = 'public_signature_auth_phone' LIMIT 1;

  v_auth_config := jsonb_build_object(
    'google', COALESCE(v_auth_google, true),
    'email', COALESCE(v_auth_email, true),
    'phone', COALESCE(v_auth_phone, true)
  );

  RETURN jsonb_build_object(
    'signer', to_jsonb(v_signer),
    'request', to_jsonb(v_request),
    'creator', v_creator,
    'fields', v_fields,
    'auth_config', v_auth_config,
    'waiting_for', v_waiting_for
  );
END;
$function$;

-- Verificação por SHA-256: remover PII (IP, user agent, geolocalização,
-- auth_google_sub, e-mails, created_by) do retorno público.
CREATE OR REPLACE FUNCTION public.public_verify_signed_pdf_by_sha256(p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if p_sha256 is null or btrim(p_sha256) = '' then return null; end if;

  select jsonb_build_object(
    'signer', jsonb_build_object(
      'id', ss.id,
      'signature_request_id', ss.signature_request_id,
      'name', ss.name,
      'role', ss.role,
      'status', ss.status,
      'auth_method', ss.auth_method,
      'signed_at', ss.signed_at,
      'verification_hash', ss.verification_hash,
      'signed_document_path', ss.signed_document_path
    ),
    'request', jsonb_build_object(
      'id', sr.id,
      'document_name', sr.document_name,
      'client_name', sr.client_name,
      'status', sr.status,
      'auth_method', sr.auth_method,
      'signed_at', sr.signed_at
    )
  )
  into v_result
  from public.signature_signers ss
  join public.signature_requests sr on sr.id = ss.signature_request_id
  where ss.signed_pdf_sha256 is not null
    and upper(ss.signed_pdf_sha256) = upper(p_sha256)
  order by ss.signed_at desc nulls last
  limit 1;

  return v_result;
end;
$function$;
