-- ============================================================================
-- FASE 0 — Camada de auditoria à prova de adulteração (A2 + A3), colunas A1/A5
-- ----------------------------------------------------------------------------
-- Objetivo forense: tornar signature_audit_log INVIOLÁVEL e SOBREVIVENTE, para
-- que o escritório possa demonstrar, contra uma acusação de manipulação, que:
--   A2) nenhuma linha do histórico foi editada ou apagada (append-only) e que
--       a sequência é encadeada por hash (adulterar qualquer linha quebra a
--       cadeia e é detectável);
--   A3) o histórico sobrevive mesmo se o envelope (signature_requests) for
--       deletado — os dados-chave ficam "congelados" na própria linha do log.
--
-- Esta migration é ADITIVA e não altera o fluxo de assinatura. Não há mudança
-- em como o PDF é montado hoje; apenas blinda o registro de auditoria.
--
-- Reversível: ver bloco "ROLLBACK" comentado ao final.
-- ============================================================================

-- pgcrypto fornece digest()/hmac; no Supabase vive no schema `extensions`.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Colunas novas (todas nullable → seguras para linhas existentes)
-- ----------------------------------------------------------------------------
ALTER TABLE public.signature_audit_log
  ADD COLUMN IF NOT EXISTS prev_hash        text,   -- entry_hash da linha anterior do MESMO envelope
  ADD COLUMN IF NOT EXISTS entry_hash       text,   -- SHA-256 do conteúdo canônico desta linha + prev_hash
  ADD COLUMN IF NOT EXISTS request_snapshot jsonb;  -- A3: cópia congelada dos dados-chave do envelope

COMMENT ON COLUMN public.signature_audit_log.prev_hash IS
  'Hash-chain (A2): entry_hash da entrada anterior do mesmo envelope. NULL na primeira entrada.';
COMMENT ON COLUMN public.signature_audit_log.entry_hash IS
  'Hash-chain (A2): SHA-256 do conteúdo canônico desta linha encadeado com prev_hash. Recomputável por perito.';
COMMENT ON COLUMN public.signature_audit_log.request_snapshot IS
  'A3: snapshot congelado (protocolo, nome do documento, cliente) para o log permanecer legível após deleção do envelope.';

-- ----------------------------------------------------------------------------
-- 2. A3 — deixar o log SOBREVIVER à deleção do envelope
--    FK ON DELETE CASCADE  →  ON DELETE SET NULL  +  coluna nullable
-- ----------------------------------------------------------------------------
ALTER TABLE public.signature_audit_log
  ALTER COLUMN signature_request_id DROP NOT NULL;

ALTER TABLE public.signature_audit_log
  DROP CONSTRAINT IF EXISTS signature_audit_log_signature_request_id_fkey;

ALTER TABLE public.signature_audit_log
  ADD CONSTRAINT signature_audit_log_signature_request_id_fkey
  FOREIGN KEY (signature_request_id)
  REFERENCES public.signature_requests(id)
  ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 3. Função canônica de hash de uma entrada
--    Serialização determinística: campos em ordem fixa, separados por \x1f
--    (unit separator), encadeada com prev_hash. Qualquer alteração de conteúdo
--    OU de posição na cadeia muda o entry_hash.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signature_audit_compute_hash(
  p_prev_hash   text,
  p_request_id  uuid,
  p_signer_id   uuid,
  p_action      text,
  p_description text,
  p_ip          text,
  p_user_agent  text,
  p_created_at  timestamptz,
  p_snapshot    jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE
-- pgcrypto pode viver em `extensions` (Supabase) ou `public` (self-hosted);
-- incluir ambos garante que digest() resolva em qualquer ambiente.
SET search_path = public, extensions
AS $$
  SELECT encode(
    digest(
      convert_to(
        concat_ws(
          E'\x1f',
          coalesce(p_prev_hash, ''),
          coalesce(p_request_id::text, ''),
          coalesce(p_signer_id::text, ''),
          coalesce(p_action, ''),
          coalesce(p_description, ''),
          coalesce(p_ip, ''),
          coalesce(p_user_agent, ''),
          -- timestamp canônico em UTC com microssegundos
          coalesce(to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          coalesce(p_snapshot::text, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Backfill: encadear as linhas JÁ existentes em ordem cronológica por
--    envelope, para que a cadeia cubra também o histórico anterior a esta
--    migration. Roda ANTES de instalar o guard de append-only.
-- ----------------------------------------------------------------------------
DO $backfill$
DECLARE
  r           record;
  v_prev      text;
  v_last_req  uuid;
  v_hash      text;
BEGIN
  v_last_req := NULL;
  v_prev     := NULL;
  FOR r IN
    SELECT id, signature_request_id, signer_id, action, description,
           ip_address, user_agent, created_at
    FROM public.signature_audit_log
    ORDER BY signature_request_id NULLS FIRST, created_at ASC, id ASC
  LOOP
    -- Reinicia a cadeia a cada envelope (cadeia POR ENVELOPE).
    IF r.signature_request_id IS DISTINCT FROM v_last_req THEN
      v_prev := NULL;
      v_last_req := r.signature_request_id;
    END IF;

    v_hash := public.signature_audit_compute_hash(
      v_prev, r.signature_request_id, r.signer_id, r.action, r.description,
      r.ip_address, r.user_agent, r.created_at, NULL
    );

    UPDATE public.signature_audit_log
       SET prev_hash = v_prev, entry_hash = v_hash
     WHERE id = r.id;

    v_prev := v_hash;
  END LOOP;
END;
$backfill$;

-- ----------------------------------------------------------------------------
-- 5. BEFORE INSERT — preenche snapshot (A3), calcula prev_hash/entry_hash (A2).
--    Serializa inserts do MESMO envelope via advisory lock transacional, para
--    a cadeia nunca "bifurcar" sob concorrência.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signature_audit_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev text;
BEGIN
  -- created_at já resolvido pelo DEFAULT antes deste trigger.
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;

  -- A3: congela dados-chave do envelope na própria linha (best-effort).
  IF NEW.request_snapshot IS NULL AND NEW.signature_request_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'request_id', sr.id,
             'envelope_protocol', sr.id::text,
             'envelope_verification_code', sr.envelope_verification_code,
             'document_name', sr.document_name,
             'client_name', sr.client_name,
             'process_number', sr.process_number,
             'signature_model', sr.signature_model
           )
      INTO NEW.request_snapshot
      FROM public.signature_requests sr
     WHERE sr.id = NEW.signature_request_id;
  END IF;

  -- A2: hash-chain por envelope. Serializa concorrência do mesmo envelope.
  IF NEW.signature_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.signature_request_id::text, 0));
    SELECT entry_hash INTO v_prev
      FROM public.signature_audit_log
     WHERE signature_request_id = NEW.signature_request_id
     ORDER BY created_at DESC, id DESC
     LIMIT 1;
  ELSE
    v_prev := NULL;
  END IF;

  NEW.prev_hash  := v_prev;
  NEW.entry_hash := public.signature_audit_compute_hash(
    v_prev, NEW.signature_request_id, NEW.signer_id, NEW.action, NEW.description,
    NEW.ip_address, NEW.user_agent, NEW.created_at, NEW.request_snapshot
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signature_audit_before_insert ON public.signature_audit_log;
CREATE TRIGGER trg_signature_audit_before_insert
  BEFORE INSERT ON public.signature_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.signature_audit_before_insert();

-- ----------------------------------------------------------------------------
-- 6. A2 — GUARD append-only: nenhum UPDATE/DELETE, nem via service_role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signature_audit_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'signature_audit_log é append-only (auditoria): % não é permitido.', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_signature_audit_block_update ON public.signature_audit_log;
CREATE TRIGGER trg_signature_audit_block_update
  BEFORE UPDATE ON public.signature_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.signature_audit_block_mutation();

DROP TRIGGER IF EXISTS trg_signature_audit_block_delete ON public.signature_audit_log;
CREATE TRIGGER trg_signature_audit_block_delete
  BEFORE DELETE ON public.signature_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.signature_audit_block_mutation();

-- Defesa em profundidade: também remove o privilégio no nível de GRANT.
-- (O trigger acima já barra o superusuário lógico da app; isto fecha o resto.)
REVOKE UPDATE, DELETE ON public.signature_audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.signature_audit_log FROM anon;
REVOKE UPDATE, DELETE ON public.signature_audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.signature_audit_log FROM service_role;

-- ----------------------------------------------------------------------------
-- 7. Verificador de integridade da cadeia (perícia/relatório).
--    Retorna as entradas quebradas (se houver). Cadeia íntegra → 0 linhas.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signature_audit_verify_chain(p_request_id uuid)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      record;
  v_prev text := NULL;
  v_calc text;
BEGIN
  FOR r IN
    SELECT * FROM public.signature_audit_log
     WHERE signature_request_id = p_request_id
     ORDER BY created_at ASC, id ASC
  LOOP
    v_calc := public.signature_audit_compute_hash(
      v_prev, r.signature_request_id, r.signer_id, r.action, r.description,
      r.ip_address, r.user_agent, r.created_at, r.request_snapshot
    );
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      id := r.id; created_at := r.created_at; reason := 'prev_hash divergente (linha removida/reordenada)'; RETURN NEXT;
    ELSIF r.entry_hash IS DISTINCT FROM v_calc THEN
      id := r.id; created_at := r.created_at; reason := 'entry_hash divergente (conteúdo alterado)'; RETURN NEXT;
    END IF;
    v_prev := r.entry_hash;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.signature_audit_verify_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signature_audit_verify_chain(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Colunas de proveniência (A1) e vínculo do visto (A5).
--    Aditivas e nullable: nada muda no fluxo atual. Serão POPULADAS pelas
--    fases seguintes (re-hash server-side e composição server-side).
-- ----------------------------------------------------------------------------

-- A1: distinguir hash calculado pelo servidor vs. hash legado declarado pelo
-- cliente. Enquanto a composição estiver no cliente, novas rotinas server-side
-- de re-hash marcam 'server'; linhas antigas permanecem NULL (= legado).
ALTER TABLE public.signature_request_documents
  ADD COLUMN IF NOT EXISTS hash_source text
    CHECK (hash_source IS NULL OR hash_source IN ('client_legacy', 'server'));

COMMENT ON COLUMN public.signature_request_documents.hash_source IS
  'A1: proveniência do signed_pdf_sha256. server = recalculado no backend a partir do arquivo no Storage; client_legacy/NULL = declarado pelo cliente.';

-- A5: hash do documento-fonte EXATO apresentado ao signatário no instante do
-- aceite (o que ele "viu"). Preenchido server-side no ato da assinatura.
ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS presented_document_sha256 text,
  ADD COLUMN IF NOT EXISTS presented_at timestamptz;

COMMENT ON COLUMN public.signature_signers.presented_document_sha256 IS
  'A5: SHA-256 do documento-fonte apresentado ao signatário no momento do aceite. Vincula o "visto" ao PDF final composto.';
COMMENT ON COLUMN public.signature_signers.presented_at IS
  'A5: instante em que o documento-fonte apresentado teve seu hash registrado.';

-- ============================================================================
-- ROLLBACK (manual, se necessário):
--   DROP TRIGGER IF EXISTS trg_signature_audit_block_update  ON public.signature_audit_log;
--   DROP TRIGGER IF EXISTS trg_signature_audit_block_delete  ON public.signature_audit_log;
--   DROP TRIGGER IF EXISTS trg_signature_audit_before_insert ON public.signature_audit_log;
--   -- restaurar FK cascade se desejado; colunas prev_hash/entry_hash/request_snapshot podem permanecer.
-- ============================================================================
