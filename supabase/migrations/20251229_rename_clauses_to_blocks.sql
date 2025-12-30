  -- Migration: Renomear petition_clauses para petition_blocks
  -- Também remove a coluna 'formatting' que agora é gerenciada pelo Syncfusion (SFDT)

  -- 1. Renomear a tabela (apenas se petition_clauses existir e petition_blocks não existir)
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'petition_clauses' AND table_schema = 'public')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'petition_blocks' AND table_schema = 'public') THEN
      ALTER TABLE petition_clauses RENAME TO petition_blocks;
    END IF;
  END $$;

  -- 2. Remover a coluna formatting (formatação agora é via Syncfusion SFDT)
  ALTER TABLE petition_blocks DROP COLUMN IF EXISTS formatting;

  -- 2.1 Garantir coluna de ordenação (muitos ambientes já possuem petition_blocks sem a coluna "order")
  ALTER TABLE petition_blocks
    ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

  -- 3. Renomear coluna clauses_used para blocks_used na tabela saved_petitions (se ainda não foi renomeada)
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saved_petitions' AND column_name = 'clauses_used' AND table_schema = 'public') THEN
      ALTER TABLE saved_petitions RENAME COLUMN clauses_used TO blocks_used;
    END IF;
  END $$;

  -- 4. Atualizar comentários da tabela
  COMMENT ON TABLE petition_blocks IS 'Blocos reutilizáveis para petições - conteúdo em formato SFDT (Syncfusion)';
  COMMENT ON COLUMN petition_blocks.content IS 'Conteúdo do bloco em formato SFDT (Syncfusion Document Text)';

  -- 5. Atualizar RLS policies (se existirem com nome antigo)
  DO $$
  BEGIN
    -- Tentar renomear policies se existirem
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'petition_blocks' AND policyname LIKE '%clause%') THEN
      -- Drop e recria com novo nome
      DROP POLICY IF EXISTS "Users can view all clauses" ON petition_blocks;
      DROP POLICY IF EXISTS "Users can insert clauses" ON petition_blocks;
      DROP POLICY IF EXISTS "Users can update clauses" ON petition_blocks;
      DROP POLICY IF EXISTS "Users can delete clauses" ON petition_blocks;
      
      -- Recriar com novos nomes
      CREATE POLICY "Users can view all blocks" ON petition_blocks FOR SELECT USING (true);
      CREATE POLICY "Users can insert blocks" ON petition_blocks FOR INSERT WITH CHECK (true);
      CREATE POLICY "Users can update blocks" ON petition_blocks FOR UPDATE USING (true);
      CREATE POLICY "Users can delete blocks" ON petition_blocks FOR DELETE USING (true);
    END IF;
  END $$;
