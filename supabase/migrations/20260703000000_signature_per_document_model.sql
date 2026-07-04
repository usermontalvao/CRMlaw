-- Modelo VERSIONADO de assinatura para o fluxo de DOCUMENTOS (kits).
--
-- CONTEXTO: hoje o kit gera 1 PDF assinado CONSOLIDADO (principal + anexos +
-- relatório) gravado em signature_signers.signed_document_path. Este migration
-- introduz, SEM tocar no legado, o modelo "1 PDF assinado por arquivo":
--   * signature_requests.signature_model  = 'consolidated' (legado, DEFAULT) | 'per_document'
--   * document_templates.signature_model  = escolha por kit (default 'consolidated')
--   * signature_request_documents          = documentos reais do envelope, cada um
--                                             com hash, código de verificação e
--                                             arquivo final próprios.
--
-- COMPATIBILIDADE: todo registro existente e todo kit sem o toggle permanece
-- 'consolidated' (fluxo atual intacto). As RPCs de verificação são ESTENDIDAS de
-- forma ADITIVA: primeiro tentam o signatário (legado) e só então a nova tabela.
-- Nada é reprocessado, regravado ou convertido retroativamente.

-- ── 1) Coluna de versão do modelo (envelope + kit) ───────────────────────────
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS signature_model text NOT NULL DEFAULT 'consolidated';

ALTER TABLE public.document_templates
  ADD COLUMN IF NOT EXISTS signature_model text NOT NULL DEFAULT 'consolidated';

-- Guarda de valores válidos (não quebra linhas existentes: todas são 'consolidated').
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_signature_model_chk'
  ) THEN
    ALTER TABLE public.signature_requests
      ADD CONSTRAINT signature_requests_signature_model_chk
      CHECK (signature_model IN ('consolidated', 'per_document'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_signature_model_chk'
  ) THEN
    ALTER TABLE public.document_templates
      ADD CONSTRAINT document_templates_signature_model_chk
      CHECK (signature_model IN ('consolidated', 'per_document'));
  END IF;
END $$;

-- ── 2) Documentos reais do envelope (modelo per_document) ─────────────────────
CREATE TABLE IF NOT EXISTS public.signature_request_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id  uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  signer_id             uuid REFERENCES public.signature_signers(id) ON DELETE SET NULL,
  document_type         text NOT NULL CHECK (document_type IN ('main', 'attachment')),
  document_key          text NOT NULL,          -- 'main' | 'attachment-<i>' (casa com signature_fields.document_id)
  display_name          text,
  source_file_path      text,
  signed_file_path      text,                    -- artefato final assinado INDIVIDUAL
  verification_code     text UNIQUE,             -- código de verificação próprio
  signed_pdf_sha256     text,                    -- hash do PDF assinado individual
  document_hash         text,                    -- integrity sha do arquivo original individual
  page_count            int,
  sort_order            int NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signature_request_id, document_key)
);

CREATE INDEX IF NOT EXISTS srd_request_idx  ON public.signature_request_documents (signature_request_id);
CREATE INDEX IF NOT EXISTS srd_vcode_idx    ON public.signature_request_documents (upper(verification_code));
CREATE INDEX IF NOT EXISTS srd_sha_idx      ON public.signature_request_documents (upper(signed_pdf_sha256));

-- RLS: office-staff (dono/admin) lê via can_manage_signature_request; anon NÃO lê
-- direto (acesso público só pelas RPCs token/hash-scoped abaixo). Escritas ocorrem
-- via SECURITY DEFINER (fluxo público) ou service_role (edge template-fill).
ALTER TABLE public.signature_request_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view request documents" ON public.signature_request_documents;
CREATE POLICY "Staff can view request documents"
  ON public.signature_request_documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );

-- ── 3) Attach one-shot por documento (fluxo público, por public_token) ────────
-- Espelha a trava first-write-wins de public_attach_signed_pdf: só grava o
-- artefato quando o signatário do token está 'signed' e o documento ainda não
-- tem signed_file_path. O código de verificação é gerado no cliente (estampado no
-- PDF antes do upload) e persistido aqui; a constraint UNIQUE protege colisões.
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
  v_existing   text;
BEGIN
  IF p_token IS NULL OR p_document_key IS NULL OR btrim(p_document_key) = '' THEN RETURN; END IF;
  IF p_signed_path IS NULL OR btrim(p_signed_path) = '' THEN RETURN; END IF;

  SELECT id, signature_request_id, status
    INTO v_signer_id, v_request_id, v_status
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_signer_id IS NULL THEN RETURN; END IF;
  IF v_status <> 'signed' THEN RETURN; END IF;

  -- One-shot: se já existe artefato para este documento, não sobrescreve.
  SELECT signed_file_path INTO v_existing
    FROM public.signature_request_documents
    WHERE signature_request_id = v_request_id AND document_key = p_document_key
    LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN; END IF;

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
    signed_file_path  = EXCLUDED.signed_file_path,
    verification_code = EXCLUDED.verification_code,
    signed_pdf_sha256 = EXCLUDED.signed_pdf_sha256,
    document_hash     = EXCLUDED.document_hash,
    page_count        = EXCLUDED.page_count,
    signer_id         = EXCLUDED.signer_id,
    display_name      = EXCLUDED.display_name,
    source_file_path  = EXCLUDED.source_file_path,
    status            = 'signed',
    updated_at        = now()
  WHERE public.signature_request_documents.signed_file_path IS NULL;
END;
$$;

-- ── 4) Listagem token-scoped dos documentos do envelope (fluxo público) ───────
CREATE OR REPLACE FUNCTION public.public_signing_request_documents(p_token uuid)
RETURNS SETOF public.signature_request_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_request_id uuid;
BEGIN
  SELECT signature_request_id INTO v_request_id
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_request_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.* FROM public.signature_request_documents d
    WHERE d.signature_request_id = v_request_id
    ORDER BY d.sort_order ASC, d.created_at ASC;
END;
$$;

-- ── 5) Verificação por HASH — estendida (aditiva) para a nova tabela ──────────
-- Mantém IDÊNTICO o comportamento legado (signatário e request). Só quando NADA
-- casa é que procura em signature_request_documents.verification_code.
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
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash),
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status));
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_signer.id,'signature_request_id',v_signer.signature_request_id,'name',v_signer.name,'role',v_signer.role,'status',v_signer.status,'auth_method',v_signer.auth_method,'signed_at',v_signer.signed_at,'verification_hash',v_signer.verification_hash,'signed_document_path',v_signer.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
  END IF;

  SELECT * INTO v_request FROM public.signature_requests WHERE upper(verification_hash) = v_code LIMIT 1;
  IF FOUND THEN
    IF v_request.blocked_at IS NOT NULL THEN
      RETURN jsonb_build_object('status','blocked','reason',v_request.blocked_reason,
        'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status));
    END IF;
    RETURN jsonb_build_object('status','valid',
      'signer', jsonb_build_object('id',v_request.id,'signature_request_id',v_request.id,'name',coalesce(v_request.client_name,'Signatário'),'status',v_request.status,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at,'verification_hash',v_request.verification_hash,'signed_document_path',v_request.signed_document_path),
      'request', jsonb_build_object('id',v_request.id,'document_name',v_request.document_name,'status',v_request.status,'client_name',v_request.client_name,'auth_method',v_request.auth_method,'signed_at',v_request.signed_at));
  END IF;

  -- NOVO: código de verificação individual de um documento do envelope.
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

-- ── 6) Verificação por SHA-256 — estendida (aditiva) para a nova tabela ───────
CREATE OR REPLACE FUNCTION public.public_verify_signed_pdf_by_sha256(p_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  v_result jsonb;
begin
  if p_sha256 is null or btrim(p_sha256) = '' then return null; end if;

  -- Legado: assinatura consolidada no signatário.
  select jsonb_build_object(
    'signer', jsonb_build_object(
      'id', ss.id, 'signature_request_id', ss.signature_request_id, 'name', ss.name,
      'role', ss.role, 'status', ss.status, 'auth_method', ss.auth_method,
      'signed_at', ss.signed_at, 'verification_hash', ss.verification_hash,
      'signed_document_path', ss.signed_document_path
    ),
    'request', jsonb_build_object(
      'id', sr.id, 'document_name', sr.document_name, 'client_name', sr.client_name,
      'status', sr.status, 'auth_method', sr.auth_method, 'signed_at', sr.signed_at
    )
  )
  into v_result
  from public.signature_signers ss
  join public.signature_requests sr on sr.id = ss.signature_request_id
  where ss.signed_pdf_sha256 is not null
    and upper(ss.signed_pdf_sha256) = upper(p_sha256)
  order by ss.signed_at desc nulls last
  limit 1;

  if v_result is not null then return v_result; end if;

  -- NOVO: documento individual do envelope (modelo per_document).
  select jsonb_build_object(
    'signer', jsonb_build_object(
      'id', d.id, 'signature_request_id', d.signature_request_id,
      'name', coalesce(d.display_name, sr.document_name), 'role', NULL,
      'status', 'signed', 'auth_method', sr.auth_method,
      'signed_at', sr.signed_at, 'verification_hash', d.verification_code,
      'signed_document_path', d.signed_file_path
    ),
    'request', jsonb_build_object(
      'id', sr.id, 'document_name', coalesce(d.display_name, sr.document_name),
      'client_name', sr.client_name, 'status', sr.status,
      'auth_method', sr.auth_method, 'signed_at', sr.signed_at
    )
  )
  into v_result
  from public.signature_request_documents d
  join public.signature_requests sr on sr.id = d.signature_request_id
  where d.signed_pdf_sha256 is not null
    and upper(d.signed_pdf_sha256) = upper(p_sha256)
  order by sr.signed_at desc nulls last
  limit 1;

  return v_result;
end;
$$;

-- ── Grants (espelham as RPCs públicas existentes) ─────────────────────────────
REVOKE ALL ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_signing_request_documents(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_by_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_verify_signed_pdf_by_sha256(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_attach_signed_document(uuid,text,text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_signing_request_documents(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_verify_by_hash(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_verify_signed_pdf_by_sha256(text) TO anon, authenticated;
