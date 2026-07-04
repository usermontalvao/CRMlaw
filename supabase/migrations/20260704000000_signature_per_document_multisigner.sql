-- Correção do modelo per_document para MÚLTIPLOS signatários (coassinatura) +
-- identificador de ENVELOPE (agrupador). NÃO toca no fluxo consolidated (legado).
--
-- ── PROBLEMA (first-write-wins) ───────────────────────────────────────────────
-- A RPC public_attach_signed_document (migration 20260703000000) congelava o
-- artefato final de cada `document_key` na PRIMEIRA gravação (guard
-- `signed_file_path IS NOT NULL -> RETURN`). Com coassinatura, o PDF individual
-- ficava preso na versão do 1º signatário — SEM as assinaturas seguintes.
--
-- O PDF de cada arquivo é (re)composto no cliente a cada assinatura e SEMPRE
-- inclui as assinaturas de todos que já assinaram (as demais são lidas do
-- storage — ver pdfSignature.service.ts). Logo, a gravação do signatário que
-- assinou POR ÚLTIMO é a versão completa e correta do documento.
--
-- ── CORREÇÃO (last-signer-wins + one-shot por signatário) ─────────────────────
--   * Anti-replay: o MESMO signatário nunca reescreve o próprio artefato (mesma
--     trava do consolidated em 20260621140000).
--   * Convergência/anti-adulteração: só um signatário que assinou MAIS TARDE
--     (signed_at maior) pode avançar o artefato. Isso garante que o estado final
--     reflita todas as assinaturas e, na prática, congela após o último
--     signatário (não existe signed_at maior depois dele). Retry pós-falha
--     continua funcionando: o último signatário ainda tem o maior signed_at.
--   * Tudo em um único INSERT ... ON CONFLICT (a linha em conflito é travada pela
--     própria cláusula), então gravações concorrentes por document_key são
--     serializadas sem unique_violation espúria.
--
-- Cada documento continua com verification_code, signed_pdf_sha256 e
-- signed_file_path PRÓPRIOS. A validação jurídica permanece POR ARQUIVO.

-- ── 1) Identificador de ENVELOPE (agrupa o pacote; NÃO valida documentos) ──────
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS envelope_verification_code text;

CREATE UNIQUE INDEX IF NOT EXISTS signature_requests_envelope_code_uidx
  ON public.signature_requests (upper(envelope_verification_code))
  WHERE envelope_verification_code IS NOT NULL;

-- ── 2) Attach por documento — last-signer-wins (substitui a versão one-shot) ───
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
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status, signed_at
    INTO v_signer_id, v_request_id, v_status, v_signed_at
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  -- INSERT no primeiro documento; nas gravações seguintes, só avança se o autor
  -- for OUTRO signatário que assinou DEPOIS do autor atual do artefato.
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
END;
$$;

-- Grants idempotentes (mesma assinatura da migration original).
REVOKE ALL ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
