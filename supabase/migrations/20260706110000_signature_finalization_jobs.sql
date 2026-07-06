-- ============================================================================
-- FASE 1 — Motor de finalização server-side (job engine)
-- ----------------------------------------------------------------------------
-- Passa o CONTROLE da finalização (verificação de integridade, recálculo de
-- hash, flip do envelope para 'signed', disparo de e-mail/webhook) do cliente
-- para o servidor, de forma:
--   • idempotente e retomável (retry seguro);
--   • observável por etapas (frontend faz polling);
--   • sem duplicar e-mail nem documento;
--   • compatível com per_document e consolidado.
--
-- Nesta fase o CLIENTE ainda compõe/upa os PDFs; o SERVIDOR passa a ser a
-- autoridade sobre hash (A1) e finalização. A composição server-side completa
-- (aposentar o renderer do cliente) vem nas fases 3/4.
--
-- Depende da migration 20260706100000 (auditoria tamper-evident).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signature_finalization_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id      uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  -- ciclo: queued → running → hashing → persisting → finalized | failed
  status                    text NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued','running','hashing','persisting','finalized','failed')),
  stage                     text,                     -- rótulo humano da etapa atual
  progress                  int  NOT NULL DEFAULT 0    -- 0..100
                             CHECK (progress BETWEEN 0 AND 100),
  attempts                  int  NOT NULL DEFAULT 0,
  max_attempts              int  NOT NULL DEFAULT 5,
  expected_document_count   int,
  persisted_document_count  int  NOT NULL DEFAULT 0,
  last_error                text,
  -- lock cooperativo: evita dois workers processando o mesmo envelope
  locked_at                 timestamptz,
  locked_by                 text,
  lock_expires_at           timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  finalized_at              timestamptz
);

-- No máximo UM job ativo (não terminal) por envelope → idempotência de enfileiramento.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signature_finalization_active
  ON public.signature_finalization_jobs (signature_request_id)
  WHERE status NOT IN ('finalized','failed');

CREATE INDEX IF NOT EXISTS idx_signature_finalization_status
  ON public.signature_finalization_jobs (status, updated_at);

DROP TRIGGER IF EXISTS trg_signature_finalization_updated_at ON public.signature_finalization_jobs;
CREATE TRIGGER trg_signature_finalization_updated_at
  BEFORE UPDATE ON public.signature_finalization_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_signature_updated_at();

ALTER TABLE public.signature_finalization_jobs ENABLE ROW LEVEL SECURITY;

-- Dono do envelope enxerga o progresso dos seus jobs (painel interno).
DROP POLICY IF EXISTS "Owner reads finalization jobs" ON public.signature_finalization_jobs;
CREATE POLICY "Owner reads finalization jobs"
  ON public.signature_finalization_jobs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.signature_requests sr
     WHERE sr.id = signature_request_id AND sr.created_by = auth.uid()
  ));
-- Escrita é exclusiva do backend (service_role ignora RLS). Nada de anon/authenticated.

-- ----------------------------------------------------------------------------
-- enqueue: idempotente. Retorna o job ativo existente ou cria um novo.
-- SECURITY DEFINER porque o fluxo público (anon, via token) precisa enfileirar.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_signature_finalization(
  p_request_id uuid,
  p_expected_document_count int DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job_id uuid;
  v_expected int;
BEGIN
  IF p_request_id IS NULL THEN RETURN NULL; END IF;

  -- Serializa o enfileiramento do mesmo envelope.
  PERFORM pg_advisory_xact_lock(hashtextextended('finalize:' || p_request_id::text, 0));

  SELECT id INTO v_job_id
    FROM public.signature_finalization_jobs
   WHERE signature_request_id = p_request_id
     AND status NOT IN ('finalized','failed')
   LIMIT 1;
  IF v_job_id IS NOT NULL THEN RETURN v_job_id; END IF;

  -- Já finalizado? Não recria job.
  IF EXISTS (SELECT 1 FROM public.signature_finalization_jobs
              WHERE signature_request_id = p_request_id AND status = 'finalized') THEN
    SELECT id INTO v_job_id FROM public.signature_finalization_jobs
     WHERE signature_request_id = p_request_id AND status = 'finalized'
     ORDER BY finalized_at DESC NULLS LAST LIMIT 1;
    RETURN v_job_id;
  END IF;

  v_expected := coalesce(
    p_expected_document_count,
    1 + coalesce(array_length((SELECT attachment_paths FROM public.signature_requests WHERE id = p_request_id), 1), 0)
  );

  INSERT INTO public.signature_finalization_jobs (signature_request_id, status, stage, expected_document_count)
  VALUES (p_request_id, 'queued', 'enfileirado', v_expected)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_signature_finalization(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_signature_finalization(uuid, int) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Status token-scoped para o POLLING do frontend público (sem expor PII).
-- Requer um public_token válido de um signatário do mesmo envelope.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_signature_finalization_status(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_job public.signature_finalization_jobs;
  v_req_status text;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;
  SELECT signature_request_id INTO v_request_id
    FROM public.signature_signers WHERE public_token = p_token LIMIT 1;
  IF v_request_id IS NULL THEN RETURN NULL; END IF;

  SELECT status INTO v_req_status FROM public.signature_requests WHERE id = v_request_id;

  SELECT * INTO v_job FROM public.signature_finalization_jobs
   WHERE signature_request_id = v_request_id
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'request_status', v_req_status,
    'job_status',     coalesce(v_job.status, 'none'),
    'stage',          v_job.stage,
    'progress',       coalesce(v_job.progress, 0),
    'expected',       v_job.expected_document_count,
    'persisted',      v_job.persisted_document_count,
    'finalized',      (v_req_status = 'signed'),
    'error',          CASE WHEN v_job.status = 'failed' THEN v_job.last_error ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_signature_finalization_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_signature_finalization_status(uuid) TO anon, authenticated;

COMMENT ON TABLE public.signature_finalization_jobs IS
  'Fase 1: jobs de finalização server-side da assinatura. Idempotente, observável, retomável.';
