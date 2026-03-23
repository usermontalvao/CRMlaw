ALTER TABLE public.representatives
ADD COLUMN IF NOT EXISTS oab_number TEXT;

COMMENT ON COLUMN public.representatives.oab_number IS 'Número da OAB do correspondente';
