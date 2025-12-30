-- Migration: Categorias de blocos por tipo de documento (configurável)
-- Permite categorias/ordem diferentes para petição, contestação, impugnação e recursos.

-- 1) Remover constraint rígida de category (permitir categorias livres)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public' AND t.relname='petition_blocks' AND c.conname='petition_blocks_category_check'
  ) THEN
    ALTER TABLE public.petition_blocks DROP CONSTRAINT petition_blocks_category_check;
  END IF;
END $$;

-- 2) Tabela de categorias por tipo
CREATE TABLE IF NOT EXISTS public.petition_block_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type = ANY (ARRAY['petition','contestation','impugnation','appeal']::text[])),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_type, key)
);

CREATE INDEX IF NOT EXISTS idx_petition_block_categories_doc_type ON public.petition_block_categories(document_type);
CREATE INDEX IF NOT EXISTS idx_petition_block_categories_active ON public.petition_block_categories(is_active);

-- Trigger updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_petition_editor_updated_at') THEN
    CREATE OR REPLACE FUNCTION update_petition_editor_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_petition_block_categories_updated_at ON public.petition_block_categories;
CREATE TRIGGER trigger_petition_block_categories_updated_at
  BEFORE UPDATE ON public.petition_block_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_petition_editor_updated_at();

-- 3) RLS
ALTER TABLE public.petition_block_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all block categories" ON public.petition_block_categories;
DROP POLICY IF EXISTS "Users can insert block categories" ON public.petition_block_categories;
DROP POLICY IF EXISTS "Users can update block categories" ON public.petition_block_categories;
DROP POLICY IF EXISTS "Users can delete block categories" ON public.petition_block_categories;

CREATE POLICY "Users can view all block categories" ON public.petition_block_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert block categories" ON public.petition_block_categories
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update block categories" ON public.petition_block_categories
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can delete block categories" ON public.petition_block_categories
  FOR DELETE TO authenticated USING (true);

-- 4) Seed inicial (idempotente)
INSERT INTO public.petition_block_categories (document_type, key, label, "order", is_active)
VALUES
  -- PETIÇÃO
  ('petition','cabecalho','Cabeçalho',0,true),
  ('petition','qualificacao','DAS QUESTÕES INICIAIS',1,true),
  ('petition','fatos','Dos Fatos',2,true),
  ('petition','direito','Do Direito',3,true),
  ('petition','pedidos','Dos Pedidos',4,true),
  ('petition','citacao','Citação',5,true),
  ('petition','encerramento','Encerramento',6,true),
  ('petition','outros','Outros',7,true),

  -- CONTESTAÇÃO
  ('contestation','preliminares','Preliminares',0,true),
  ('contestation','merito','Mérito',1,true),
  ('contestation','impugnacoes','Impugnações',2,true),
  ('contestation','provas','Provas',3,true),
  ('contestation','pedidos','Pedidos',4,true),
  ('contestation','encerramento','Encerramento',5,true),
  ('contestation','outros','Outros',6,true),

  -- IMPUGNAÇÃO
  ('impugnation','sintese','Síntese da Contestação',0,true),
  ('impugnation','impugnacoes','Impugnações',1,true),
  ('impugnation','merito','Mérito',2,true),
  ('impugnation','provas','Provas',3,true),
  ('impugnation','pedidos','Pedidos',4,true),
  ('impugnation','encerramento','Encerramento',5,true),
  ('impugnation','outros','Outros',6,true),

  -- RECURSO
  ('appeal','admissibilidade','Admissibilidade',0,true),
  ('appeal','razoes','Razões',1,true),
  ('appeal','prequestionamento','Prequestionamento',2,true),
  ('appeal','pedidos','Pedidos',3,true),
  ('appeal','encerramento','Encerramento',4,true),
  ('appeal','outros','Outros',5,true)
ON CONFLICT (document_type, key) DO NOTHING;

-- Atualizar schema cache
NOTIFY pgrst, 'reload schema';
