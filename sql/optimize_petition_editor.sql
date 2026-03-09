-- Migration: Otimização de performance para o Editor de Petições
-- Resolve erros 500 (Statement Timeout) em consultas de blocos e petições

-- Índices para a tabela de blocos (petition_blocks)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_blocks_user_id ON public.petition_blocks(user_id) WHERE user_id IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'category'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'is_active'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_blocks_category_active ON public.petition_blocks(category, is_active)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'document_type'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_blocks_doc_type ON public.petition_blocks(document_type) WHERE document_type IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'legal_area_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_blocks_legal_area ON public.petition_blocks(legal_area_id) WHERE legal_area_id IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_blocks' AND column_name = 'order'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_blocks_order ON public.petition_blocks("order")';
  END IF;
END $$;

-- Índices para a tabela de petições salvas (saved_petitions)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_petitions' AND column_name = 'updated_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_saved_petitions_updated_at ON public.saved_petitions(updated_at DESC)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_petitions' AND column_name = 'created_by'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'saved_petitions' AND column_name = 'updated_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_saved_petitions_created_by_updated ON public.saved_petitions(created_by, updated_at DESC)';
  END IF;
END $$;

-- Índices para a tabela de templates padrão (petition_default_templates)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_default_templates' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_petition_default_templates_user_id ON public.petition_default_templates(user_id)';
  END IF;
END $$;

-- Índices para a tabela de vínculos (petition_standard_type_blocks)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_standard_type_blocks' AND column_name = 'standard_type_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'petition_standard_type_blocks' AND column_name = 'order'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_standard_type_blocks_main ON public.petition_standard_type_blocks(standard_type_id, "order")';
  END IF;
END $$;

-- Adicionar tabelas de petição ao Realtime (com verificação de existência para evitar erros)
DO $$
BEGIN
  -- petition_blocks
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'petition_blocks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.petition_blocks;
  END IF;

  -- saved_petitions
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'saved_petitions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.saved_petitions;
  END IF;
END $$;

-- Forçar reload do schema cache
NOTIFY pgrst, 'reload schema';
