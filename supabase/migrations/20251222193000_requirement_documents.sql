CREATE TABLE IF NOT EXISTS public.requirement_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'generic',
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requirement_documents_requirement_id_idx
  ON public.requirement_documents(requirement_id);

CREATE INDEX IF NOT EXISTS requirement_documents_document_type_idx
  ON public.requirement_documents(document_type);

ALTER TABLE public.requirement_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read requirement_documents" ON public.requirement_documents;
CREATE POLICY "Authenticated can read requirement_documents"
  ON public.requirement_documents
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert requirement_documents" ON public.requirement_documents;
CREATE POLICY "Authenticated can insert requirement_documents"
  ON public.requirement_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can delete requirement_documents" ON public.requirement_documents;
CREATE POLICY "Authenticated can delete requirement_documents"
  ON public.requirement_documents
  FOR DELETE
  TO authenticated
  USING (true);
