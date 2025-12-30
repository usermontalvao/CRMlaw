-- Migration: Adicionar document_type em petition_blocks para separar blocos por tipo de documento
-- Tipos suportados: petition | contestation | impugnation | appeal

ALTER TABLE public.petition_blocks
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'petition';

-- Backfill
UPDATE public.petition_blocks
SET document_type = 'petition'
WHERE document_type IS NULL OR document_type = '';

-- Constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='petition_blocks' AND c.conname='petition_blocks_document_type_check'
  ) THEN
    ALTER TABLE public.petition_blocks DROP CONSTRAINT petition_blocks_document_type_check;
  END IF;

  ALTER TABLE public.petition_blocks ADD CONSTRAINT petition_blocks_document_type_check
    CHECK (document_type = ANY (ARRAY['petition','contestation','impugnation','appeal']::text[]));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Índice para filtro por tipo
CREATE INDEX IF NOT EXISTS idx_petition_blocks_document_type ON public.petition_blocks(document_type);

-- Atualizar schema cache do PostgREST (força reload)
NOTIFY pgrst, 'reload schema';
