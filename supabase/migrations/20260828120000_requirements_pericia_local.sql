-- Local (endereço) de cada perícia do requerimento.
--
-- A data já vivia aqui (`pericia_social_at` / `pericia_medica_at`); o endereço
-- vinha em papel e se perdia. É o campo que o aviso ao cliente precisa para
-- dizer ONDE comparecer — sem ele o lembrete só repete a data que a pessoa já
-- tem.

ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS pericia_social_local text NULL,
  ADD COLUMN IF NOT EXISTS pericia_medica_local text NULL;

COMMENT ON COLUMN public.requirements.pericia_social_local IS 'Endereço/local da perícia social, como informado pelo INSS.';
COMMENT ON COLUMN public.requirements.pericia_medica_local IS 'Endereço/local da perícia médica, como informado pelo INSS.';
