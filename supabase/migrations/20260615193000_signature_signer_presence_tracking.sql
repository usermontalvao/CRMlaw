ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_signature_signers_opened_at
  ON public.signature_signers(opened_at);

CREATE INDEX IF NOT EXISTS idx_signature_signers_last_seen_at
  ON public.signature_signers(last_seen_at);

COMMENT ON COLUMN public.signature_signers.opened_at IS
  'Primeira vez em que o signatario abriu a pagina publica de assinatura.';

COMMENT ON COLUMN public.signature_signers.last_seen_at IS
  'Ultimo heartbeat observado na pagina publica de assinatura.';
