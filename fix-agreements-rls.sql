-- ================================================
-- FIX URGENTE - POLÍTICAS RLS PARA AGREEMENTS E INSTALLMENTS
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- ================================================
-- 1. AGREEMENTS (Acordos)
-- ================================================
ALTER TABLE public.agreements DISABLE ROW LEVEL SECURITY;

-- Remove todas as políticas antigas
DROP POLICY IF EXISTS "Usuários podem ver todos os acordos" ON public.agreements;
DROP POLICY IF EXISTS "Usuários podem inserir acordos" ON public.agreements;
DROP POLICY IF EXISTS "Usuários podem atualizar acordos" ON public.agreements;
DROP POLICY IF EXISTS "Usuários podem deletar acordos" ON public.agreements;

-- Cria novas políticas permissivas
CREATE POLICY "Permitir todas operações em acordos"
ON public.agreements
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.agreements ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 2. INSTALLMENTS (Parcelas)
-- ================================================
ALTER TABLE public.installments DISABLE ROW LEVEL SECURITY;

-- Remove todas as políticas antigas
DROP POLICY IF EXISTS "Usuários podem ver todas as parcelas" ON public.installments;
DROP POLICY IF EXISTS "Usuários podem inserir parcelas" ON public.installments;
DROP POLICY IF EXISTS "Usuários podem atualizar parcelas" ON public.installments;
DROP POLICY IF EXISTS "Usuários podem deletar parcelas" ON public.installments;

-- Cria novas políticas permissivas
CREATE POLICY "Permitir todas operações em parcelas"
ON public.installments
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;

-- ================================================
-- CONCLUÍDO
-- ================================================
-- As políticas RLS foram corrigidas!
-- Agora você pode criar acordos e parcelas sem erro.
-- ================================================
