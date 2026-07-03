ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS petition_ribbon_custom_styles jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.petition_ribbon_custom_styles IS
'Estilos personalizados do ribbon do editor de peticoes persistidos por usuario para uso em qualquer dispositivo.';
