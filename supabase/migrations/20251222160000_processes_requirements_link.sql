-- Vínculo entre Requerimentos e Processos
-- Permite criar um processo principal e um processo de Mandado de Segurança (MS)

ALTER TABLE public.processes
  ADD COLUMN IF NOT EXISTS requirement_id uuid NULL REFERENCES public.requirements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requirement_role text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processes_requirement_role_check'
  ) THEN
    ALTER TABLE public.processes
      ADD CONSTRAINT processes_requirement_role_check
      CHECK (requirement_role IS NULL OR requirement_role IN ('principal', 'ms'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS processes_requirement_id_idx
  ON public.processes(requirement_id);

CREATE UNIQUE INDEX IF NOT EXISTS processes_requirement_unique_role_idx
  ON public.processes(requirement_id, requirement_role)
  WHERE requirement_id IS NOT NULL AND requirement_role IS NOT NULL;
