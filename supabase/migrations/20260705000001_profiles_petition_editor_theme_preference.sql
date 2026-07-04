ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS petition_editor_theme_preference varchar(10) DEFAULT 'light';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_petition_editor_theme_preference_check'
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_petition_editor_theme_preference_check
    CHECK (petition_editor_theme_preference IN ('light', 'dark'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.petition_editor_theme_preference IS
'Preferência de tema do editor de documentos/petições por usuário.';
