-- Datas de nascimento da equipe ficam separadas de public.profiles.
-- profiles é legível pela equipe inteira; a data completa de nascimento é um
-- dado pessoal e deve ser acessível somente pelo próprio titular.
CREATE TABLE IF NOT EXISTS public.staff_birthdays (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  birth_date date NOT NULL,
  -- Ano da última celebração ABERTA pela pessoa. É o que garante que o vídeo
  -- de aniversário toque uma única vez por ano, em qualquer sessão/dispositivo.
  celebrated_year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_birthdays_birth_date_check
    CHECK (birth_date >= DATE '1900-01-01' AND birth_date <= CURRENT_DATE)
);

ALTER TABLE public.staff_birthdays
  ADD COLUMN IF NOT EXISTS celebrated_year integer;

ALTER TABLE public.staff_birthdays ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.staff_birthdays FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_birthdays TO authenticated;

DROP POLICY IF EXISTS "Staff can read own birthday" ON public.staff_birthdays;
CREATE POLICY "Staff can read own birthday"
  ON public.staff_birthdays
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Staff can insert own birthday" ON public.staff_birthdays;
CREATE POLICY "Staff can insert own birthday"
  ON public.staff_birthdays
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Staff can update own birthday" ON public.staff_birthdays;
CREATE POLICY "Staff can update own birthday"
  ON public.staff_birthdays
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.staff_birthdays IS
  'Data de nascimento privada dos usuários internos, usada na experiência de aniversário.';

COMMENT ON COLUMN public.staff_birthdays.celebrated_year IS
  'Ano em que a pessoa abriu a celebração de aniversário. Impede repetição.';
