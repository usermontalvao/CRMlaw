-- Parte 4: fluxo de recusa de assinatura
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS allow_refusal boolean NOT NULL DEFAULT false;

ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS refused_at timestamptz,
  ADD COLUMN IF NOT EXISTS refusal_reason text;

COMMENT ON COLUMN public.signature_requests.allow_refusal IS
  'Quando true, o signatário pode recusar a assinatura (com motivo) na página pública.';
COMMENT ON COLUMN public.signature_signers.refused_at IS 'Momento em que o signatário recusou a assinatura.';
COMMENT ON COLUMN public.signature_signers.refusal_reason IS 'Motivo informado pelo signatário ao recusar.';
