CREATE OR REPLACE FUNCTION public.public_attach_signed_document(
  p_token uuid,
  p_document_key text,
  p_document_type text,
  p_display_name text,
  p_source_file_path text,
  p_signed_path text,
  p_verification_code text,
  p_sha256 text DEFAULT NULL,
  p_document_hash text DEFAULT NULL,
  p_page_count int DEFAULT NULL,
  p_sort_order int DEFAULT 0
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_signer_id  uuid;
  v_request_id uuid;
  v_status     text;
  v_signed_at  timestamptz;
  v_request_status text;
  v_attachment_count int;
  v_expected_documents int;
  v_persisted_documents int;
  v_all_signed boolean;
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_at
    INTO v_signer_id, v_request_id, v_status, v_signed_at
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  INSERT INTO public.signature_request_documents (
    signature_request_id, signer_id, document_type, document_key, display_name,
    source_file_path, signed_file_path, verification_code, signed_pdf_sha256,
    document_hash, page_count, sort_order, status, updated_at
  ) VALUES (
    v_request_id, v_signer_id, coalesce(p_document_type, 'attachment'), p_document_key, p_display_name,
    p_source_file_path, p_signed_path, p_verification_code, p_sha256,
    p_document_hash, p_page_count, coalesce(p_sort_order, 0), 'signed', now()
  )
  ON CONFLICT (signature_request_id, document_key) DO UPDATE SET
    signer_id         = EXCLUDED.signer_id,
    document_type     = coalesce(EXCLUDED.document_type, public.signature_request_documents.document_type),
    display_name      = coalesce(EXCLUDED.display_name, public.signature_request_documents.display_name),
    source_file_path  = coalesce(EXCLUDED.source_file_path, public.signature_request_documents.source_file_path),
    signed_file_path  = EXCLUDED.signed_file_path,
    verification_code = EXCLUDED.verification_code,
    signed_pdf_sha256 = EXCLUDED.signed_pdf_sha256,
    document_hash     = EXCLUDED.document_hash,
    page_count        = coalesce(EXCLUDED.page_count, public.signature_request_documents.page_count),
    sort_order        = coalesce(EXCLUDED.sort_order, public.signature_request_documents.sort_order),
    status            = 'signed',
    updated_at        = now()
  WHERE
    public.signature_request_documents.signer_id IS DISTINCT FROM EXCLUDED.signer_id
    AND (
      public.signature_request_documents.signer_id IS NULL
      OR COALESCE(
           (SELECT s_old.signed_at FROM public.signature_signers s_old
             WHERE s_old.id = public.signature_request_documents.signer_id),
           'epoch'::timestamptz)
         < COALESCE(v_signed_at, now())
    );

  UPDATE public.signature_requests
     SET envelope_verification_code = upper(replace(gen_random_uuid()::text, '-', ''))
   WHERE id = v_request_id AND envelope_verification_code IS NULL;

  SELECT
    status,
    coalesce(array_length(attachment_paths, 1), 0)
    INTO v_request_status, v_attachment_count
  FROM public.signature_requests
  WHERE id = v_request_id;

  v_expected_documents := 1 + coalesce(v_attachment_count, 0);

  SELECT count(*)
    INTO v_persisted_documents
  FROM public.signature_request_documents
  WHERE signature_request_id = v_request_id
    AND signed_file_path IS NOT NULL;

  SELECT coalesce(bool_and(status = 'signed'), false)
    INTO v_all_signed
  FROM public.signature_signers
  WHERE signature_request_id = v_request_id;

  IF coalesce(v_request_status, 'pending') <> 'signed'
     AND v_all_signed
     AND v_persisted_documents >= v_expected_documents THEN
    UPDATE public.signature_requests
       SET status = 'signed',
           signed_at = now()
     WHERE id = v_request_id
       AND status <> 'signed';

    INSERT INTO public.signature_audit_log (
      signature_request_id,
      signer_id,
      action,
      description
    ) VALUES (
      v_request_id,
      v_signer_id,
      'finalized',
      format('Envelope finalizado com %s documento(s) persistido(s).', v_persisted_documents)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
