-- ============================================================================
-- AS DUAS RPCs DE ANEXAR ARTEFATO PASSAM A EXIGIR AS MESMAS PROVAS.
-- ----------------------------------------------------------------------------
-- O envelope tem dois caminhos para registrar o PDF assinado, e eles nasceram
-- em épocas diferentes:
--
--   · `public_attach_signed_pdf`      → consolidado (2026-06), ponteiro no
--                                        signatário;
--   · `public_attach_signed_document` → per_document (2026-07), uma linha por
--                                        arquivo.
--
-- A segunda foi endurecida ao longo de agosto e setembro; a PRIMEIRA ficou como
-- nasceu. As duas são `security definer`, as duas são executáveis por `anon`, e
-- as duas recebem o caminho do arquivo do NAVEGADOR de quem assina. A diferença
-- é que uma confere o que recebe e a outra confiava.
--
-- ── O QUE A `public_attach_signed_pdf` PERMITIA ────────────────────────────
--
-- Com o `public_token` do signatário — que não é revogado depois de assinar —,
-- entre o fim da assinatura e a montagem no servidor dava para gravar como
-- artefato oficial QUALQUER string. O estrago não para no próprio envelope:
-- `public-signing-file` monta o conjunto de arquivos que o token pode ler
-- somando, entre outros, o `signed_document_path` do signatário. Escrever ali o
-- caminho de um envelope alheio faz esse arquivo virar legível pelo token —
-- vazamento cruzado, além da troca do artefato e dos hashes.
--
-- A trava one-shot (`signed_document_path IS NULL`) NÃO cobria isso: ela impede
-- a segunda escrita, não a primeira, e quem chega primeiro é quem chamar a RPC
-- primeiro. Ela protege contra adulteração DEPOIS do fluxo legítimo; não contra
-- o fluxo legítimo ser substituído.
--
-- ── AS QUATRO PROVAS, AGORA NAS DUAS ───────────────────────────────────────
--
--   (a) ciclo de vida — envelope na lixeira, bloqueado ou cancelado não recebe;
--   (b) pasta — o caminho tem de começar com `<request_id>/`;
--   (c) EXISTÊNCIA — o objeto tem de estar mesmo no bucket `assinados`. É nova
--       nas duas: até aqui dava para registrar um caminho que nunca existiu,
--       plausível e dentro da pasta certa, e o envelope contava esse documento
--       como persistido;
--   (d) hash do original — quando há linha congelada, é ela que vale; o valor
--       do cliente é descartado.
--
-- (b) foi conferida contra os 225 artefatos já registrados: TODOS os 225 já
-- seguem `<request_id>/...`, então a guarda não recusa nada que exista hoje.
--
-- ── E A CHAVE DO DOCUMENTO ─────────────────────────────────────────────────
--
-- A `public_attach_signed_document` aceitava qualquer `p_document_key` não
-- vazio. Com um token já assinado dava para inserir chaves inventadas sem
-- limite: cada uma vira linha em `signature_request_documents` com o código de
-- verificação que o chamador escolher, e cada uma CONTA no
-- `v_persisted_documents` — que é o número comparado com o esperado para
-- finalizar o envelope sozinho. Ou seja, dava para forçar a finalização com o
-- documento de verdade ainda faltando, e ainda deixar registro permanente.
--
-- O hash congelado não fechava esse buraco: para chave inventada não existe
-- linha em `signature_source_files`, e a função voltava a aceitar o
-- `p_source_file_path` e o `p_document_hash` do chamador.
--
-- Agora a chave tem de ser uma das que o envelope REALMENTE tem: `main`, ou
-- `attachment-<i>` com `i` dentro de `attachment_paths`.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) O CONSOLIDADO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.public_attach_signed_pdf(
  p_token uuid,
  p_path text,
  p_sha256 text DEFAULT NULL::text,
  p_integrity_sha256 text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_signer_id      uuid;
  v_request_id     uuid;
  v_status         text;
  v_signed_path    text;
  v_request_status text;
  v_deleted_at     timestamptz;
  v_blocked_at     timestamptz;
  v_hash_congelado text;
BEGIN
  IF p_token IS NULL OR p_path IS NULL OR btrim(p_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_document_path
    INTO v_signer_id, v_request_id, v_status, v_signed_path
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;

  -- One-shot (migration 20260621140000): só anexa depois da assinatura concluída
  -- e enquanto o artefato não foi gravado. Quem chega primeiro fica.
  IF v_status <> 'signed' OR v_signed_path IS NOT NULL THEN RETURN; END IF;

  SELECT status, deleted_at, blocked_at
    INTO v_request_status, v_deleted_at, v_blocked_at
    FROM public.signature_requests WHERE id = v_request_id;
  IF v_request_status IS NULL THEN RETURN; END IF;

  -- (a) Documento fora de circulação não recebe artefato. `signed` continua
  -- passando: é o estado normal no instante em que o PDF chega.
  IF v_deleted_at IS NOT NULL
     OR v_blocked_at IS NOT NULL
     OR v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')
  THEN
    RAISE EXCEPTION 'Documento nao esta em estado que aceite artefato assinado.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) O arquivo tem de morar na pasta desta solicitação.
  IF p_path NOT LIKE (v_request_id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho do documento assinado nao pertence a esta solicitacao.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) E tem de existir de verdade. O fluxo legítimo — navegador ou servidor —
  -- SEMPRE sobe o arquivo antes de chamar esta função, então exigir o objeto no
  -- bucket não custa nada a ele e tira do ar o registro de caminho fantasma.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'assinados' AND o.name = p_path
  ) THEN
    RAISE EXCEPTION 'Documento assinado nao encontrado no armazenamento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) O hash do ORIGINAL é o que o servidor apurou no congelamento, quando
  -- existe. O do cliente só vale para envelope anterior ao congelamento.
  SELECT sha256 INTO v_hash_congelado
    FROM public.signature_source_files
   WHERE signature_request_id = v_request_id AND document_key = 'main'
   LIMIT 1;

  UPDATE public.signature_signers
     SET signed_document_path = p_path,
         signed_pdf_sha256    = coalesce(p_sha256, signed_pdf_sha256),
         integrity_sha256     = coalesce(v_hash_congelado, p_integrity_sha256, integrity_sha256)
   WHERE id = v_signer_id AND signed_document_path IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_attach_signed_pdf(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_pdf(uuid,text,text,text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) O PER_DOCUMENT — chave válida e arquivo que existe
--    (o resto do corpo é o da migration 20260904230500, sem alteração)
-- ─────────────────────────────────────────────────────────────────────────────
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
AS $function$
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
  v_model      text;
  v_gravado    text;
  v_indice     int;
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_at
    INTO v_signer_id, v_request_id, v_status, v_signed_at
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  SELECT status, deleted_at, archived_at, blocked_at, expires_at, signature_model,
         coalesce(array_length(attachment_paths, 1), 0)
    INTO v_request_status, v_deleted_at, v_archived_at, v_blocked_at, v_expires_at, v_model,
         v_attachment_count
    FROM public.signature_requests
   WHERE id = v_request_id;
  IF v_request_id IS NULL OR v_request_status IS NULL THEN RETURN; END IF;

  -- (a) Documento fora de circulação não recebe anexo. `signed` continua
  -- passando: os documentos de um envelope chegam um a um, e o último deles
  -- costuma chegar DEPOIS de a solicitação já ter virado 'signed'.
  IF v_deleted_at IS NOT NULL
     OR v_blocked_at IS NOT NULL
     OR v_request_status IN ('cancelled', 'canceled', 'expired', 'refused', 'rejected')
  THEN
    RAISE EXCEPTION 'Documento nao esta em estado que aceite anexos assinados.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (a2) A CHAVE TEM DE SER UMA DAS QUE O ENVELOPE TEM.
  --
  -- Sem isto, qualquer string virava documento: linha nova em
  -- `signature_request_documents`, com o código de verificação escolhido por
  -- quem chamou, e mais um no `v_persisted_documents` que decide a finalização
  -- automática lá embaixo — dava para fechar o envelope com o documento de
  -- verdade ainda faltando.
  IF p_document_key <> 'main' THEN
    IF p_document_key !~ '^attachment-[0-9]+$' THEN
      RAISE EXCEPTION 'Chave de documento invalida para esta solicitacao.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_indice := (substring(p_document_key from 12))::int;
    IF v_indice < 0 OR v_indice >= coalesce(v_attachment_count, 0) THEN
      RAISE EXCEPTION 'Chave de documento fora do envelope.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- (b) O arquivo tem de morar na pasta desta solicitação.
  IF p_signed_path NOT LIKE (v_request_id::text || '/%') THEN
    RAISE EXCEPTION 'Caminho do documento assinado nao pertence a esta solicitacao.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) E tem de existir no bucket. Caminho plausível dentro da pasta certa,
  -- apontando para nada, contava como documento persistido.
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'assinados' AND o.name = p_signed_path
  ) THEN
    RAISE EXCEPTION 'Documento assinado nao encontrado no armazenamento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) O hash do original vem do congelamento quando ele existe.
  SELECT sha256, file_path
    INTO v_hash_congelado, v_path_congelado
    FROM public.signature_source_files
   WHERE signature_request_id = v_request_id
     AND document_key = p_document_key
   LIMIT 1;

  -- INSERT no primeiro documento; nas gravações seguintes, só avança se o autor
  -- for OUTRO signatário que assinou DEPOIS do autor atual do artefato.
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

  -- ── A PONTE PARA O CONSOLIDADO ───────────────────────────────────────────
  -- Aninhada, sem `return`: a finalização vem depois e não pode ser pulada.
  IF p_document_key = 'main'
     AND v_model IS DISTINCT FROM 'per_document'
     AND coalesce(v_attachment_count, 0) = 0
  THEN
    SELECT signed_file_path INTO v_gravado
      FROM public.signature_request_documents
     WHERE signature_request_id = v_request_id AND document_key = 'main';

    IF v_gravado IS NOT DISTINCT FROM p_signed_path THEN
      UPDATE public.signature_signers
         SET signed_document_path = p_signed_path,
             signed_pdf_sha256    = coalesce(p_sha256, signed_pdf_sha256),
             integrity_sha256     = coalesce(v_hash_congelado, p_document_hash, integrity_sha256)
       WHERE id = v_signer_id AND signed_document_path IS NULL;
    END IF;
  END IF;

  v_expected_documents := 1 + coalesce(v_attachment_count, 0);

  -- Só conta documento com CHAVE VÁLIDA. Com a guarda (a2) nenhuma chave
  -- inventada entra mais, mas envelopes que já receberam uma antes desta
  -- migration não podem continuar inflando a conta da finalização.
  SELECT count(*)
    INTO v_persisted_documents
  FROM public.signature_request_documents d
  WHERE d.signature_request_id = v_request_id
    AND d.signed_file_path IS NOT NULL
    AND (
      d.document_key = 'main'
      OR (d.document_key ~ '^attachment-[0-9]+$'
          AND (substring(d.document_key from 12))::int < coalesce(v_attachment_count, 0))
    );

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
      signature_request_id, signer_id, action, description
    ) VALUES (
      v_request_id, v_signer_id, 'finalized',
      format('Envelope finalizado com %s documento(s) persistido(s).', v_persisted_documents)
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
