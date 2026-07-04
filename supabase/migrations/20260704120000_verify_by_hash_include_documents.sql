-- Verificação pública: expõe os DOCUMENTOS finais do envelope (modelo per_document)
-- e passa a reconhecer o código de ENVELOPE. Aditivo; não altera o contrato legado
-- (as chaves 'signer'/'request'/'status' permanecem idênticas).
--
-- MOTIVO: no per_document o arquivo assinado NÃO fica em
-- signature_signers.signed_document_path (fica em signature_request_documents, um
-- por arquivo, cada um com verification_code próprio). Ao validar pelo hash do
-- SIGNATÁRIO (ou pelo código do ENVELOPE), a página não tinha como oferecer acesso
-- aos PDFs assinados. Agora a RPC devolve `documents[]` (código + nome + tipo) para
-- a página listar/baixar cada documento final via public-verify-file.

CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_signer signature_signers;
  v_request signature_requests;
  v_doc signature_request_documents;
  v_documents jsonb;
BEGIN
  IF p_hash IS NULL OR btrim(p_hash) = '' THEN RETURN NULL; END IF;
  v_code := upper(btrim(p_hash));

  -- Helper inline: lista dos artefatos finais por arquivo do envelope (só os já
  -- assinados). '[]' quando é consolidated ou ainda não há documentos.
  -- (preenchido depois que v_request estiver resolvido)

  -- 1) Legado: assinatura no signatário.
  SELECT * INTO v_signer FROM public.signature_signers
   WHERE upper(verification_hash) = v_code LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'verification_code', d.verification_code,
             'display_name', d.display_name,
             'document_type', d.document_type,
             'sort_order', d.sort_order
           ) ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
      INTO v_documents
      FROM public.signature_request_documents d
      WHERE d.signature_request_id = v_request.id AND d.signed_file_path IS NOT NULL;

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash),
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
      'documents', v_documents);
  END IF;

  -- 2) Legado: hash no request.
  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'verification_code', d.verification_code,
             'display_name', d.display_name,
             'document_type', d.document_type,
             'sort_order', d.sort_order
           ) ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
      INTO v_documents
      FROM public.signature_request_documents d
      WHERE d.signature_request_id = v_request.id AND d.signed_file_path IS NOT NULL;

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_request.client_name,'Signatário'),'status',v_request.status,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'verification_hash',v_request.verification_hash,'signed_document_path',v_request.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
      'documents', v_documents);
  END IF;

  -- 3) NOVO: código de ENVELOPE (agrupador). Resolve o pacote e seus documentos.
  SELECT * INTO v_request FROM public.signature_requests WHERE upper(envelope_verification_code) = v_code LIMIT 1;
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'verification_code', d.verification_code,
             'display_name', d.display_name,
             'document_type', d.document_type,
             'sort_order', d.sort_order
           ) ORDER BY d.sort_order, d.created_at), '[]'::jsonb)
      INTO v_documents
      FROM public.signature_request_documents d
      WHERE d.signature_request_id = v_request.id AND d.signed_file_path IS NOT NULL;

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_request.client_name,'Envelope'),'status',v_request.status,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'verification_hash',v_request.envelope_verification_code,'signed_document_path',NULL),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'is_envelope',true),
      'documents', v_documents);
  END IF;

  -- 4) Código de verificação individual de um documento do envelope.
  SELECT * INTO v_doc FROM public.signature_request_documents
   WHERE upper(verification_code) = v_code LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE id = v_doc.signature_request_id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_request.blocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
      'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status));
  END IF;
  RETURN jsonb_build_object('status','valid',
    'signer', jsonb_build_object('id',v_doc.id,'signature_request_id',v_doc.signature_request_id,'name',coalesce(v_doc.display_name,v_request.document_name),'role',NULL,'status','signed','auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'verification_hash',v_doc.verification_code,'signed_document_path',v_doc.signed_file_path),
    'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
END;
$$;

REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;
