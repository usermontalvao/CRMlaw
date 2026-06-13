-- Ordem sequencial no fluxo público: o frontend (PublicSigningPage) bloqueia a UI
-- com base em `waiting_for` retornado por get_public_signing_bundle. A versão de
-- 20260613_harden_public_signing_lifecycle.sql NÃO devolvia esse campo, então em
-- deploys limpos do repositório o gate visual não funcionava (o usuário só descobria
-- estar fora de ordem no 409 da edge function). Esta migration recria a função
-- incluindo `waiting_for` (nome do signatário anterior ainda pendente; NULL = é a vez
-- deste). Precisa rodar DEPOIS do harden — daí o nome ordenar após "harden_".
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
  v_waiting_for text := NULL;
  v_my_order int;
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

  -- Ordem sequencial: se há signatário anterior (order menor) ainda pendente,
  -- expõe o nome para a página pública avisar "aguarde sua vez".
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
    'auth_config', v_auth_config,
    'waiting_for', v_waiting_for
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_signing_bundle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_signing_bundle(uuid) TO anon, authenticated;
