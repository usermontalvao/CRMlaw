-- Migration: Garantir que petition_blocks tenha todas as colunas necessárias
-- Corrige erro PGRST204: "Could not find the 'is_active' column"

-- Alguns ambientes possuem schema alternativo (ex: coluna `name` em vez de `title`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='petition_blocks' AND column_name='name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='petition_blocks' AND column_name='title'
  ) THEN
    ALTER TABLE public.petition_blocks RENAME COLUMN name TO title;
  END IF;
END $$;

-- Adicionar colunas faltantes de forma idempotente
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Colunas base do app
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE petition_blocks ADD COLUMN IF NOT EXISTS category TEXT;

-- Backfill mínimos (best-effort)
UPDATE petition_blocks SET category = 'outros' WHERE category IS NULL;

-- Normalizar categorias legadas para 'outros'
UPDATE public.petition_blocks
SET category = 'outros'
WHERE category IN ('trabalhista','civel','penal','custom');

DO $$
BEGIN
  -- Só força NOT NULL se não houver valores nulos
  IF NOT EXISTS (SELECT 1 FROM public.petition_blocks WHERE title IS NULL LIMIT 1) THEN
    ALTER TABLE public.petition_blocks ALTER COLUMN title SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.petition_blocks WHERE content IS NULL LIMIT 1) THEN
    ALTER TABLE public.petition_blocks ALTER COLUMN content SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.petition_blocks WHERE category IS NULL LIMIT 1) THEN
    ALTER TABLE public.petition_blocks ALTER COLUMN category SET NOT NULL;
  END IF;
END $$;

-- Garantir que a coluna category tenha o CHECK constraint correto
-- (só adiciona se não existir)
DO $$
BEGIN
  -- Alguns ambientes já têm constraint com valores diferentes (ex: 'trabalhista', 'civel').
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='petition_blocks' AND c.conname='petition_blocks_category_check'
  ) THEN
    ALTER TABLE public.petition_blocks DROP CONSTRAINT petition_blocks_category_check;
  END IF;

  ALTER TABLE public.petition_blocks ADD CONSTRAINT petition_blocks_category_check
    CHECK (
      category = ANY (
        ARRAY[
          'cabecalho','qualificacao','fatos','direito','pedidos','citacao','encerramento','outros'
        ]::text[]
      )
    );
EXCEPTION WHEN duplicate_object THEN
  -- Constraint já existe, ignorar
  NULL;
END $$;

-- Atualizar schema cache do PostgREST (força reload)
NOTIFY pgrst, 'reload schema';
