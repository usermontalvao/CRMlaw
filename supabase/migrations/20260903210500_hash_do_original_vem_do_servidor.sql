-- ============================================================================
-- O HASH DO ORIGINAL PASSA A SER O QUE O SERVIDOR APUROU.
-- ----------------------------------------------------------------------------
-- A migration `assinatura_fecha_token_trilha_e_anexo` deixou anotado o que ela
-- não conseguia consertar: "`p_verification_code`, `p_sha256` e
-- `p_document_hash` continuam vindo do cliente". Este arquivo tira um dos três
-- da lista.
--
-- `document_hash` é o SHA-256 do arquivo de ORIGEM — o que o dossiê publica
-- como `source_document_sha256`. Ele vinha do navegador de quem assinou, e o
-- servidor, que tem o arquivo no Storage desde sempre, nunca tinha sido
-- consultado. Com o congelamento (`signature_source_files`, apurado pela Edge
-- Function `signature-freeze-source`), o valor do servidor existe — e passa a
-- ser o que fica gravado. O do cliente é descartado.
--
-- Compatibilidade: envelope sem linha congelada continua exatamente como era.
-- São os anteriores a esta mudança; para eles, rodar o congelamento depois
-- promove o hash, porque a função de congelar é idempotente.
--
-- Os outros dois (`verification_code` e `sha256` do PDF ASSINADO) só saem do
-- cliente na etapa 2, quando a montagem inteira for do servidor: o código já
-- foi carimbado DENTRO do PDF antes desta chamada, e mudar isso é redesenho do
-- fluxo, não remendo. Ver `docs/assinatura-montagem-no-servidor.md`.
-- ============================================================================

create or replace function public.public_attach_signed_document(
  p_token uuid,
  p_document_key text,
  p_document_type text,
  p_display_name text,
  p_source_file_path text,
  p_signed_path text,
  p_verification_code text,
  p_sha256 text default null,
  p_document_hash text default null,
  p_page_count integer default null,
  p_sort_order integer default 0
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_deleted_at timestamptz;
  v_archived_at timestamptz;
  v_blocked_at timestamptz;
  v_expires_at timestamptz;
  v_hash_congelado text;
  v_path_congelado text;
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_at
    INTO v_signer_id, v_request_id, v_status, v_signed_at
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  SELECT status, deleted_at, archived_at, blocked_at, expires_at,
         coalesce(array_length(attachment_paths, 1), 0)
    INTO v_request_status, v_deleted_at, v_archived_at, v_blocked_at, v_expires_at, v_attachment_count
    FROM public.signature_requests
   WHERE id = v_request_id;
  IF v_request_id IS NULL OR v_request_status IS NULL THEN RETURN; END IF;

  -- (a) Documento fora de circulação não recebe anexo. `signed` continua
  -- passando: os documentos de um envelope chegam um a um, e o último deles
  -- costuma chegar DEPOIS de a solicitação já ter virado 'signed'.
  --
  -- `archived_at` e o RELÓGIO de `expires_at` ficaram DE FORA da trava, embora
  -- o `public-sign-document` os recuse na hora de assinar. Lá eles impedem uma
  -- assinatura de começar; aqui barrariam o anexo de uma assinatura que JÁ
  -- aconteceu — arquivar (ou o relógio virar) no segundo entre assinar e anexar
  -- custaria o PDF de um ato válido. Fica o que significa "isto não pode
  -- receber dado": lixeira, bloqueio e cancelamento/recusa.
  IF v_deleted_at IS NOT NULL
     OR v_blocked_at IS NOT NULL
     OR v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')
  THEN
    RAISE EXCEPTION 'Documento nao esta em estado que aceite anexos assinados.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) O arquivo tem de morar na pasta desta solicitação.
  IF p_signed_path NOT LIKE (v_request_id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho do documento assinado nao pertence a esta solicitacao.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── DE ONDE VEM A IMPRESSÃO DIGITAL DO ORIGINAL ──────────────────────────
  -- `p_document_hash` é o SHA-256 do arquivo de ORIGEM, e ele chega aqui
  -- calculado pelo NAVEGADOR de quem assinou. É o valor que o dossiê publica
  -- como `source_document_sha256` e que a defesa cita: o servidor tem o arquivo
  -- no Storage desde sempre, e nunca tinha sido ele a olhar.
  --
  -- Quando o envelope foi congelado (`signature-freeze-source`), o valor
  -- apurado pelo servidor EXISTE e é ele que vale — o que o cliente mandou é
  -- descartado sem cerimônia. Sem linha congelada, cai no valor do cliente: são
  -- os envelopes anteriores a esta mudança, e recusá-los aqui deixaria o
  -- documento assinado sem hash nenhum, que é pior. Para esses, rodar o
  -- congelamento depois resolve — a função é idempotente.
  SELECT sha256, file_path
    INTO v_hash_congelado, v_path_congelado
    FROM public.signature_source_files
   WHERE signature_request_id = v_request_id
     AND document_key = p_document_key
   LIMIT 1;

  INSERT INTO public.signature_request_documents (
    signature_request_id, signer_id, document_type, document_key, display_name,
    source_file_path, signed_file_path, verification_code, signed_pdf_sha256,
    document_hash, page_count, sort_order, status, updated_at
  ) VALUES (
    v_request_id, v_signer_id, coalesce(p_document_type, 'attachment'), p_document_key, p_display_name,
    coalesce(v_path_congelado, p_source_file_path), p_signed_path, p_verification_code, p_sha256,
    coalesce(v_hash_congelado, p_document_hash), p_page_count, coalesce(p_sort_order, 0), 'signed', now()
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
$function$;

-- `create or replace` de função que NÃO mudou de assinatura preserva as
-- permissões, mas reafirmá-las é barato e já evitou estrago aqui antes: neste
-- projeto função nova nasce com EXECUTE para PUBLIC por concessão padrão do
-- Postgres, e foi assim que o bypass do núcleo se abriu da primeira vez.
revoke all on function public.public_attach_signed_document(uuid, text, text, text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.public_attach_signed_document(uuid, text, text, text, text, text, text, text, text, integer, integer) to anon, authenticated, service_role;
