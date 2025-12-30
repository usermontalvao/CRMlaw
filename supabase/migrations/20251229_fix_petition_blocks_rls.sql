-- Migration: Corrigir RLS da tabela petition_blocks
-- Corrige erro: new row violates row-level security policy for table "petition_blocks"

ALTER TABLE public.petition_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all blocks" ON public.petition_blocks;
DROP POLICY IF EXISTS "Users can insert blocks" ON public.petition_blocks;
DROP POLICY IF EXISTS "Users can update blocks" ON public.petition_blocks;
DROP POLICY IF EXISTS "Users can delete blocks" ON public.petition_blocks;

CREATE POLICY "Users can view all blocks" ON public.petition_blocks
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can insert blocks" ON public.petition_blocks
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update blocks" ON public.petition_blocks
  FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Users can delete blocks" ON public.petition_blocks
  FOR DELETE TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
