-- Migration: Public signing bundle RPC (includes signature fields)
-- Criado em: 2025-12-15

-- RPC: retorna signer + request + creator + fields via public_token (acesso público)
-- Motivo: RLS de signature_fields permite SELECT apenas para created_by=auth.uid(),
-- então a página pública não consegue ler os campos para aplicar a assinatura.

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

  SELECT to_jsonb(p) INTO v_creator
  FROM public.profiles p
  WHERE p.user_id = v_request.created_by
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.page_number ASC), '[]'::jsonb)
    INTO v_fields
  FROM public.signature_fields f
  WHERE f.signature_request_id = v_request.id;

  RETURN jsonb_build_object(
    'signer', to_jsonb(v_signer),
    'request', to_jsonb(v_request),
    'creator', COALESCE(v_creator, '{}'::jsonb),
    'fields', v_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_signing_bundle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_signing_bundle(uuid) TO anon, authenticated;
