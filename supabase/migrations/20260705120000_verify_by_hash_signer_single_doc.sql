-- public_verify_by_hash: no modelo per_document, o verification_hash do SIGNATÁRIO
-- não representa um documento específico (o signatário assina o envelope inteiro e
-- não possui um PDF próprio). Antes, esse hash caía no ramo 1 e retornava a lista
-- completa de documentos do envelope — quebrando a regra desejada:
--   • CÓDIGO de um documento  -> retorna apenas aquele documento
--   • PROTOCOLO / código do envelope -> retorna o envelope inteiro
--
-- Correção: no ramo do signatário, se o request for per_document, redirecionamos
-- para o DOCUMENTO PRINCIPAL do envelope, devolvendo um resultado de documento
-- único (sem a lista `documents`). O comportamento legado (não per_document) e os
-- demais ramos (request hash, código do envelope, protocolo UUID, código do
-- documento) permanecem inalterados.

CREATE OR REPLACE FUNCTION public.public_verify_by_hash(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_signer signature_signers;
  v_request signature_requests;
  v_doc signature_request_documents;
  v_documents jsonb;
BEGIN
  IF p_hash IS NULL OR btrim(p_hash) = '' THEN RETURN NULL; END IF;
  v_code := upper(btrim(p_hash));

  -- 1) Assinatura no signatario.
  SELECT * INTO v_signer FROM public.signature_signers
   WHERE upper(verification_hash) = v_code LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_request FROM public.signature_requests WHERE id = v_signer.signature_request_id LIMIT 1;

    -- per_document: o hash do signatario nao e de um documento especifico.
    -- Redireciona para o documento PRINCIPAL (resultado de documento unico),
    -- preservando o nome real do signatario para a UI.
    IF v_request.signature_model = 'per_document' THEN
      SELECT * INTO v_doc FROM public.signature_request_documents
        WHERE signature_request_id = v_request.id
          AND signed_file_path IS NOT NULL
        ORDER BY (document_type = 'main') DESC, sort_order, created_at
        LIMIT 1;
      IF FOUND THEN
        IF v_request.blocked_at IS NOT NULL THEN
          RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
            'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status));
        END IF;
        RETURN jsonb_build_object('status','valid',
          'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_doc.verification_code,'signed_document_path',v_doc.signed_file_path),
          'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
      END IF;
    END IF;

    -- Legado (nao per_document): assinatura consolidada no signatario.
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

  -- 2) Legado: hash no request. Arquivo assinado vem do signatario.
  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF FOUND THEN
    SELECT * INTO v_signer FROM public.signature_signers
      WHERE signature_request_id = v_request.id AND signed_document_path IS NOT NULL
      ORDER BY signed_at DESC NULLS LAST LIMIT 1;

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
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_signer.name,v_request.client_name,'Signatario'),'status',v_request.status,'auth_method',v_request.auth_method,'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',v_request.verification_hash,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
      'documents', v_documents);
  END IF;

  -- 3) Codigo de ENVELOPE (agrupador).
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

  -- 3b) PROTOCOLO do envelope = signature_requests.id (UUID).
  IF v_code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_request FROM public.signature_requests WHERE id = v_code::uuid LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_signer FROM public.signature_signers
        WHERE signature_request_id = v_request.id AND signed_document_path IS NOT NULL
        ORDER BY signed_at DESC NULLS LAST LIMIT 1;

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
        'signer', jsonb_build_object('id',coalesce(v_signer.id,v_request.id),'signature_request_id',v_request.id,'name',coalesce(v_signer.name,v_request.client_name,'Envelope'),'status',coalesce(v_signer.status,v_request.status),'auth_method',coalesce(v_signer.auth_method,v_request.auth_method),'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',coalesce(v_request.envelope_verification_code,v_signer.verification_hash,v_request.verification_hash,v_request.id::text),'signed_document_path',v_signer.signed_document_path),
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'is_envelope',true),
        'documents', v_documents);
    END IF;
  END IF;

  -- 4) Codigo de verificacao individual de um documento do envelope.
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
$function$;
