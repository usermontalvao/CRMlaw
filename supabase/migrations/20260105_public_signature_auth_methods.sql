-- Configuração: habilitar/desabilitar métodos de autenticação da Assinatura Pública

-- Garantir chaves no system_settings
INSERT INTO public.system_settings (key, value, description, category)
SELECT 'public_signature_auth_google', to_jsonb(true), 'Habilita autenticação Google na assinatura pública', 'assinatura'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'public_signature_auth_google');

INSERT INTO public.system_settings (key, value, description, category)
SELECT 'public_signature_auth_email', to_jsonb(true), 'Habilita autenticação por e-mail (OTP) na assinatura pública', 'assinatura'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'public_signature_auth_email');

INSERT INTO public.system_settings (key, value, description, category)
SELECT 'public_signature_auth_phone', to_jsonb(true), 'Habilita autenticação por telefone (OTP) na assinatura pública', 'assinatura'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'public_signature_auth_phone');

-- RPC público: incluir configuração dos métodos de autenticação no bundle
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

  IF v_request.archived_at IS NOT NULL THEN
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
