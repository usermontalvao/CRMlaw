-- Adiciona campos de perícia (médica/social) no módulo de Requerimentos

ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS pericia_medica_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pericia_social_at timestamptz NULL;
