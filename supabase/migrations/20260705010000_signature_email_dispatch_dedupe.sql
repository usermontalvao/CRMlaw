-- Deduplicacao dos e-mails de conclusao de assinatura.
-- Garante que o fluxo automatico envie no maximo 1 e-mail por
-- (signature_request_id, signer_id, kind), mesmo se houver duas origens tentando
-- disparar ao mesmo tempo. O reenvio manual continua permitido via `force=true`.

CREATE TABLE IF NOT EXISTS public.signature_email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES public.signature_signers(id) ON DELETE CASCADE,
  kind text NOT NULL,
  email text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (signature_request_id, signer_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_signature_email_dispatches_request
  ON public.signature_email_dispatches (signature_request_id);

CREATE INDEX IF NOT EXISTS idx_signature_email_dispatches_signer
  ON public.signature_email_dispatches (signer_id);

ALTER TABLE public.signature_email_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view signature email dispatches" ON public.signature_email_dispatches;
CREATE POLICY "Staff can view signature email dispatches"
  ON public.signature_email_dispatches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.signature_requests sr
      WHERE sr.id = signature_request_id
        AND public.can_manage_signature_request(sr.created_by)
    )
  );
