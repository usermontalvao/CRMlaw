-- ============================================================================
-- O ARTEFATO MONTADO NO SERVIDOR PRECISA APARECER ONDE O CONSOLIDADO OLHA.
-- ----------------------------------------------------------------------------
-- Os dois modelos guardam o PDF assinado em lugares DIFERENTES:
--
--   · `per_document`  → uma linha por arquivo em `signature_request_documents`;
--   · `consolidated`  → o caminho pendurado no SIGNATÁRIO
--                       (`signature_signers.signed_document_path`).
--
-- `montar-documento-assinado` sempre gravou só o primeiro. Ligar a montagem no
-- servidor para o envelope consolidado sem esta ponte produziria o pior
-- resultado possível: o PDF existiria no bucket, registrado e íntegro, e
-- TODA a interface do consolidado — a tela de sucesso de quem assina, o botão
-- de baixar do módulo, o e-mail de conclusão — continuaria dizendo que o
-- documento ainda está sendo finalizado, porque nenhuma delas lê aquela tabela.
--
-- A ponte vive AQUI, dentro da RPC, e não na Edge Function, por dois motivos:
-- ela vale para qualquer chamador (a função de hoje e o que vier depois), e
-- `public_attach_signed_document` já é `security definer` — não precisa de
-- concessão nova para o papel de serviço.
--
-- A TRAVA É A MESMA do `public_attach_signed_pdf` (migration 20260621140000):
-- só grava enquanto `signed_document_path` é nulo. É o que garante que a
-- montagem no navegador, que continua existindo como plano B, não seja
-- sobrescrita depois — e vice-versa. Quem chegar primeiro fica; o outro
-- descobre isso e não escreve.
--
-- ── LEIA ISTO ANTES DE EDITAR ESTE ARQUIVO ──────────────────────────────────
--
-- Este corpo é o da migration 20260903210500 (`hash_do_original_vem_do
-- _servidor`) com a ponte ACRESCENTADA no fim. A primeira versão desta
-- migration foi escrita a partir de uma cópia ANTIGA da função e apagou, sem
-- que ninguém notasse, quatro proteções que já existiam:
--
--   (a) a recusa de envelope na lixeira, bloqueado ou cancelado;
--   (b) a exigência de que o PDF esteja na pasta da própria solicitação;
--   (c) a troca do hash do original vindo do navegador pelo hash CONGELADO
--       que o servidor apurou;
--   (d) a finalização automática do envelope, com o registro na trilha.
--
-- Como a RPC é `security definer` e `anon` a executa com o token público, (a) e
-- (b) são o que impede quem tem o link de registrar caminho arbitrário. Toda
-- alteração futura aqui parte do corpo COMPLETO; nunca de uma versão anterior.
-- ============================================================================

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
    -- anti-replay: mesmo signatário não reescreve o próprio artefato
    public.signature_request_documents.signer_id IS DISTINCT FROM EXCLUDED.signer_id
    AND (
      -- artefato sem autor conhecido (não deveria ocorrer) → permite avançar
      public.signature_request_documents.signer_id IS NULL
      -- ou: quem está gravando assinou DEPOIS do autor atual do artefato
      OR COALESCE(
           (SELECT s_old.signed_at FROM public.signature_signers s_old
             WHERE s_old.id = public.signature_request_documents.signer_id),
           'epoch'::timestamptz)
         < COALESCE(v_signed_at, now())
    );

  -- Envelope agrupador: garante (idempotente) um código de verificação de
  -- ENVELOPE, separado do código de cada documento. Serve para rastrear/listar o
  -- pacote completo; NÃO substitui a validação por arquivo.
  UPDATE public.signature_requests
     SET envelope_verification_code = upper(replace(gen_random_uuid()::text, '-', ''))
   WHERE id = v_request_id AND envelope_verification_code IS NULL;

  -- ── A PONTE PARA O CONSOLIDADO ───────────────────────────────────────────
  --
  -- Só o documento PRINCIPAL de um envelope consolidado de UM arquivo. Anexo
  -- nunca é o artefato do signatário, e no `per_document` o ponteiro do
  -- signatário não existe de propósito — o pacote é que é entregue, não um
  -- arquivo só. Escrever lá faria a interface do kit mostrar o principal como
  -- se fosse o envelope inteiro.
  --
  -- Tudo aqui é ANINHADO, sem `return`: a finalização do envelope vem depois e
  -- não pode ser pulada por um anexo ou por um kit.
  IF p_document_key = 'main'
     AND v_model IS DISTINCT FROM 'per_document'
     AND coalesce(v_attachment_count, 0) = 0
  THEN
    -- Confere que a gravação acima é REALMENTE a que está valendo. Sem isto,
    -- uma chamada recusada pelo anti-replay ainda repontaria o signatário — que
    -- é exatamente o buraco que a trava one-shot existe para fechar.
    SELECT signed_file_path INTO v_gravado
      FROM public.signature_request_documents
     WHERE signature_request_id = v_request_id AND document_key = 'main';

    IF v_gravado IS NOT DISTINCT FROM p_signed_path THEN
      -- One-shot, igual ao `public_attach_signed_pdf`: quem chegou primeiro fica.
      UPDATE public.signature_signers
         SET signed_document_path = p_signed_path,
             signed_pdf_sha256    = coalesce(p_sha256, signed_pdf_sha256),
             integrity_sha256     = coalesce(v_hash_congelado, p_document_hash, integrity_sha256)
       WHERE id = v_signer_id AND signed_document_path IS NULL;
    END IF;
  END IF;

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
REVOKE ALL ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
