-- ============================================================================
-- Módulo de Solicitações de Documentos
-- Admin cria checklist → cliente envia via portal → IA processa → admin revisa
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  process_id    uuid REFERENCES public.processes(id) ON DELETE SET NULL,
  created_by    uuid,
  title         text NOT NULL,
  description   text,
  due_date      date,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','partial','complete','reviewed','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_request_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES public.document_requests(id) ON DELETE CASCADE,
  label         text NOT NULL,
  description   text,
  required      boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','uploaded','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS public.document_uploads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_item_id       uuid NOT NULL REFERENCES public.document_request_items(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL,
  original_paths        text[] NOT NULL DEFAULT '{}',
  processed_path        text,
  ai_document_type      text,
  ai_suggested_name     text,
  ai_confidence         numeric(4,2),
  final_name            text,
  pages_count           int DEFAULT 1,
  file_size_bytes       bigint,
  processing_status     text NOT NULL DEFAULT 'pending'
                          CHECK (processing_status IN ('pending','processing','ready','error')),
  processing_error      text,
  review_status         text DEFAULT 'pending'
                          CHECK (review_status IN ('pending','approved','rejected')),
  rejection_reason      text,
  reviewed_by           uuid,
  reviewed_at           timestamptz,
  uploaded_at           timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dr_client   ON public.document_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_dri_request ON public.document_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_du_item     ON public.document_uploads(request_item_id);
CREATE INDEX IF NOT EXISTS idx_du_client   ON public.document_uploads(client_id);

ALTER TABLE public.document_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_uploads       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_full_document_requests"      ON public.document_requests      FOR ALL TO authenticated USING (true);
CREATE POLICY "crm_full_document_request_items" ON public.document_request_items FOR ALL TO authenticated USING (true);
CREATE POLICY "crm_full_document_uploads"       ON public.document_uploads       FOR ALL TO authenticated USING (true);

-- RPCs do portal (ver migration aplicada no Supabase)
