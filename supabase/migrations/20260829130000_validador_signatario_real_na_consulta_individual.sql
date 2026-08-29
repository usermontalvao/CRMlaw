-- CONSULTA POR CÓDIGO DE UM DOCUMENTO: quem assinou, como se autenticou, e o hash.
--
-- O ramo 4 (código individual de um documento do envelope) montava um
-- signatário SINTÉTICO a partir da linha do documento:
--
--     'name', coalesce(v_doc.display_name, v_request.document_name)
--
-- ou seja, o campo "Assinado por" recebia o NOME DO ARQUIVO. Na tela pública
-- saía "Assinado por: KIT CONSUMIDOR - JENIFFER APARECIDA ALVES RODRI" — o
-- título do documento no lugar da pessoa. Num comprovante de assinatura, esse é
-- justamente o campo que não pode estar errado.
--
-- Junto disso faltavam três coisas nesse ramo: o método de autenticação, o
-- canal por onde a identidade foi confirmada, e a impressão digital do PDF
-- daquele documento — que é o que permite conferir o arquivo em mãos.
--
-- O que esta migration faz:
--
--   · ramo 4 passa a buscar o SIGNATÁRIO DE VERDADE e usar o nome dele;
--   · o payload do signatário ganha `auth_provider`, `auth_verified_channel` e
--     `signed_pdf_sha256` em todos os ramos onde existe um signatário real;
--   · o ramo 4 e o redirecionamento per_document passam a devolver também o
--     array `documents`, que eles omitiam.
--
-- NÃO é exposto o `auth_verified_identifier` (o telefone ou e-mail que recebeu
-- o código). O canal responde "por onde", que é o que interessa a quem confere;
-- o identificador é dado pessoal e não tem por que sair daqui.

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
        v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);
        RETURN jsonb_build_object('status','valid',
          'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',v_signer.signed_at,'verification_hash',v_doc.verification_code,'signed_pdf_sha256',v_doc.signed_pdf_sha256,'signed_document_path',v_doc.signed_file_path),
          'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
          'documents', v_documents);
      END IF;
    END IF;

    v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash),
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash,'signed_pdf_sha256',v_signer.signed_pdf_sha256,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
      'documents', v_documents);
  END IF;

  -- 2) Legado: hash no request. Arquivo assinado vem do signatario.
  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF FOUND THEN
    SELECT * INTO v_signer FROM public.signature_signers
      WHERE signature_request_id = v_request.id AND signed_document_path IS NOT NULL
      ORDER BY signed_at DESC NULLS LAST LIMIT 1;

    v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_signer.name,v_request.client_name,'Signatario'),'status',v_request.status,'auth_method',coalesce(v_signer.auth_method,v_request.auth_method),'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',v_request.verification_hash,'signed_pdf_sha256',v_signer.signed_pdf_sha256,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
      'documents', v_documents);
  END IF;

  -- 3) Codigo de ENVELOPE (agrupador).
  SELECT * INTO v_request FROM public.signature_requests WHERE upper(envelope_verification_code) = v_code LIMIT 1;
  IF FOUND THEN
    SELECT * INTO v_signer FROM public.signature_signers
      WHERE signature_request_id = v_request.id AND signed_document_path IS NOT NULL
      ORDER BY signed_at DESC NULLS LAST LIMIT 1;

    v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);

    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
        'documents', v_documents);
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_signer.name,v_request.client_name,'Envelope'),'status',v_request.status,'auth_method',coalesce(v_signer.auth_method,v_request.auth_method),'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',v_request.envelope_verification_code,'signed_document_path',NULL),
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

      v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);

      IF v_request.blocked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
          'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status),
          'documents', v_documents);
      END IF;
      RETURN jsonb_build_object('status','valid',
        'signer', jsonb_build_object('id',coalesce(v_signer.id,v_request.id),'signature_request_id',v_request.id,'name',coalesce(v_signer.name,v_request.client_name,'Envelope'),'status',coalesce(v_signer.status,v_request.status),'auth_method',coalesce(v_signer.auth_method,v_request.auth_method),'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',coalesce(v_request.envelope_verification_code,v_signer.verification_hash,v_request.verification_hash,v_request.id::text),'signed_document_path',v_signer.signed_document_path),
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

  -- QUEM ASSINOU. Era aqui que o nome do ARQUIVO entrava no lugar da pessoa.
  SELECT * INTO v_signer FROM public.signature_signers
    WHERE signature_request_id = v_request.id AND signed_document_path IS NOT NULL
    ORDER BY signed_at DESC NULLS LAST LIMIT 1;

  v_documents := public.public_signature_request_documents_json(v_request.id, v_request.document_name, v_request.attachment_paths);

  RETURN jsonb_build_object('status','valid',
    'signer', jsonb_build_object('id',v_doc.id,'signature_request_id',v_doc.signature_request_id,'name',coalesce(v_signer.name,v_request.client_name,'Signatario'),'role',v_signer.role,'status','signed','auth_method',coalesce(v_signer.auth_method,v_request.auth_method),'auth_provider',v_signer.auth_provider,'auth_verified_channel',v_signer.auth_verified_channel,'signed_at',coalesce(v_signer.signed_at,v_request.signed_at),'verification_hash',v_doc.verification_code,'signed_pdf_sha256',v_doc.signed_pdf_sha256,'signed_document_path',v_doc.signed_file_path),
    'request', jsonb_build_object('id',v_request.id,'document_name',coalesce(v_doc.display_name,v_request.document_name),'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at),
    'documents', v_documents);
END;
$function$;
