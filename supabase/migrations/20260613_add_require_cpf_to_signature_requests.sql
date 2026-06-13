-- Parte 3: exigir que o CPF informado na assinatura pública confira com o CPF
-- cadastrado do signatário (caso de "declaração do cliente").
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS require_cpf boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.signature_requests.require_cpf IS
  'Quando true, o CPF informado na assinatura pública deve conferir com o CPF cadastrado do signatário (declaração do cliente).';
