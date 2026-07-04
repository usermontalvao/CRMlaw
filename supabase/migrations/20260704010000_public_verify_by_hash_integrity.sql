-- Expõe o hash de integridade do documento original na verificação pública por código.
-- Isso permite que a tela pública mostre o SHA-256 do original quando ele existir
-- no registro do signatário (consolidated) ou do documento individual (per_document).

CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_signer signature_signers;
  v_request signature_requests;
  v_doc signature_request_documents;
BEGIN
  IF p_hash IS NULL OR btrim(p_hash) = '' THEN RETURN NULL; END IF;
  v_code := upper(btrim(p_hash));

  SELECT * INTO v_signer FROM public.signature_signers
   WHERE upper(verification_hash) = v_code LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;
    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status','blocked',
        'reason',v_request.blocked_reason,
        'signer', jsonb_build_object(
          'id',v_signer.id,
          'signature_request_id',v_signer.signature_request_id,
          'name',v_signer.name,
          'role',v_signer.role,
          'status',v_signer.status,
          'auth_method',v_signer.auth_method,
          'signed_at',v_signer.signed_at,
          'verification_hash',v_signer.verification_hash,
          'integrity_sha256',v_signer.integrity_sha256
        ),
        'request', jsonb_build_object(
          'id',v_request.id,
          'document_name',v_request.document_name,
          'status',v_request.status
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'status','valid',
      'signer', jsonb_build_object(
        'id',v_signer.id,
        'signature_request_id',v_signer.signature_request_id,
        'name',v_signer.name,
        'role',v_signer.role,
        'status',v_signer.status,
        'auth_method',v_signer.auth_method,
        'signed_at',v_signer.signed_at,
        'verification_hash',v_signer.verification_hash,
        'signed_document_path',v_signer.signed_document_path,
        'integrity_sha256',v_signer.integrity_sha256
      ),
      'request', jsonb_build_object(
        'id',v_request.id,
        'document_name',v_request.document_name,
        'status',v_request.status,
        'client_name',v_request.client_name,
        'auth_method',v_request.auth_method,
        'signed_at',v_request.signed_at
      )
    );
  END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF FOUND THEN
    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status','blocked',
        'reason',v_request.blocked_reason,
        'request', jsonb_build_object(
          'id',v_request.id,
          'document_name',v_request.document_name,
          'status',v_request.status
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'status','valid',
      'signer', jsonb_build_object(
        'id',v_request.id,
        'signature_request_id',v_request.id,
        'name',coalesce(v_request.client_name,'Signatário'),
        'status',v_request.status,
        'auth_method',v_request.auth_method,
        'signed_at',v_request.signed_at,
        'verification_hash',v_request.verification_hash,
        'signed_document_path',v_request.signed_document_path
      ),
      'request', jsonb_build_object(
        'id',v_request.id,
        'document_name',v_request.document_name,
        'status',v_request.status,
        'client_name',v_request.client_name,
        'auth_method',v_request.auth_method,
        'signed_at',v_request.signed_at
      )
    );
  END IF;

  SELECT * INTO v_doc FROM public.signature_request_documents
   WHERE upper(verification_code) = v_code LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE id = v_doc.signature_request_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'reason',v_request.blocked_reason,
      'request', jsonb_build_object(
        'id',v_request.id,
        'document_name',coalesce(v_doc.display_name,v_request.document_name),
        'status',v_request.status
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status','valid',
    'signer', jsonb_build_object(
      'id',v_doc.id,
      'signature_request_id',v_doc.signature_request_id,
      'name',coalesce(v_doc.display_name,v_request.document_name),
      'role',NULL,
      'status','signed',
      'auth_method',v_request.auth_method,
      'signed_at',v_request.signed_at,
      'verification_hash',v_doc.verification_code,
      'signed_document_path',v_doc.signed_file_path,
      'integrity_sha256',v_doc.document_hash
    ),
    'request', jsonb_build_object(
      'id',v_request.id,
      'document_name',coalesce(v_doc.display_name,v_request.document_name),
      'status',v_request.status,
      'client_name',v_request.client_name,
      'auth_method',v_request.auth_method,
      'signed_at',v_request.signed_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;
