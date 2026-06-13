-- P0: get_public_signing_bundle deve negar acesso fora da política de ciclo de vida.
-- Antes só checava archived_at; agora também deleted_at, blocked_at, expires_at e status.
CREATE OR REPLACE FUNCTION public.get_public_signing_bundle(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signer signature_signers;
  v_request signature_requests;
  v_creator jsonb;
  v_fields jsonb;
  v_auth_config jsonb;
  v_auth_google boolean;
  v_auth_email boolean;
  v_auth_phone boolean;
BEGIN
  SELECT * INTO v_signer
  FROM public.signature_signers
  WHERE public_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_request
  FROM public.signature_requests
  WHERE id = v_signer.signature_request_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Estados de ciclo de vida que invalidam o link público
  IF v_request.archived_at IS NOT NULL
     OR v_request.deleted_at IS NOT NULL
     OR v_request.blocked_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Solicitação cancelada/expirada não é assinável
  IF v_request.status IN ('cancelled', 'expired') THEN
    RETURN NULL;
  END IF;

  -- Prazo expirado
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at < now() THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(p) INTO v_creator
  FROM public.profiles p
  WHERE p.user_id = v_request.created_by
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.page_number ASC), '[]'::jsonb)
    INTO v_fields
  FROM public.signature_fields f
  WHERE f.signature_request_id = v_request.id;

  SELECT COALESCE((s.value #>> '{}')::boolean, true)
    INTO v_auth_google
  FROM public.system_settings s
  WHERE s.key = 'public_signature_auth_google'
  LIMIT 1;

  SELECT COALESCE((s.value #>> '{}')::boolean, true)
    INTO v_auth_email
  FROM public.system_settings s
  WHERE s.key = 'public_signature_auth_email'
  LIMIT 1;

  SELECT COALESCE((s.value #>> '{}')::boolean, true)
    INTO v_auth_phone
  FROM public.system_settings s
  WHERE s.key = 'public_signature_auth_phone'
  LIMIT 1;

  v_auth_config := jsonb_build_object(
    'google', COALESCE(v_auth_google, true),
    'email', COALESCE(v_auth_email, true),
    'phone', COALESCE(v_auth_phone, true)
  );

  RETURN jsonb_build_object(
    'signer', to_jsonb(v_signer),
    'request', to_jsonb(v_request),
    'creator', COALESCE(v_creator, '{}'::jsonb),
    'fields', v_fields,
    'auth_config', v_auth_config
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_signing_bundle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_signing_bundle(uuid) TO anon, authenticated;
