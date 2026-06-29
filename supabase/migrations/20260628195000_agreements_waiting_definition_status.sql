DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'agreements'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.agreements DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END $$;

ALTER TABLE public.agreements
  ADD CONSTRAINT agreements_status_check
  CHECK (status IN ('pendente', 'ativo', 'concluido', 'cancelado', 'aguardando_definicao'));
