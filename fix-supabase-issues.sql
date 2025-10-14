-- ================================================
-- FIX PARA ERROS DE RLS E STORAGE
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- 1. CORRIGIR POLÍTICAS RLS DA TABELA djen_comunicacoes
-- ================================================

-- Desabilitar RLS temporariamente
ALTER TABLE public.djen_comunicacoes DISABLE ROW LEVEL SECURITY;

-- Remover políticas antigas
DROP POLICY IF EXISTS "Usuários podem ver suas comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem inserir comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem atualizar suas comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem deletar suas comunicações" ON public.djen_comunicacoes;

-- Criar políticas simplificadas
CREATE POLICY "Permitir leitura de comunicações"
ON public.djen_comunicacoes
FOR SELECT
USING (true);

CREATE POLICY "Permitir inserção de comunicações"
ON public.djen_comunicacoes
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Permitir atualização de comunicações"
ON public.djen_comunicacoes
FOR UPDATE
USING (true);

CREATE POLICY "Permitir deleção de comunicações"
ON public.djen_comunicacoes
FOR DELETE
USING (true);

-- Reativar RLS
ALTER TABLE public.djen_comunicacoes ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 2. CRIAR BUCKET DE STORAGE PARA CHAT
-- ================================================
-- IMPORTANTE: Execute este comando no Supabase Dashboard
-- Storage > Create a new bucket
-- Nome: chat-attachments
-- Public: true (ou configure políticas de acesso)
-- ================================================

-- Após criar o bucket, execute estas políticas de storage:

-- Política para upload de arquivos
CREATE POLICY "Permitir upload de anexos"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'chat-attachments' AND auth.role() = 'authenticated');

-- Política para leitura de arquivos
CREATE POLICY "Permitir leitura de anexos"
ON storage.objects
FOR SELECT
USING (bucket_id = 'chat-attachments');

-- Política para deleção de arquivos (apenas o dono)
CREATE POLICY "Permitir deleção de anexos próprios"
ON storage.objects
FOR DELETE
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Após executar:
-- 1. Crie o bucket 'chat-attachments' no Dashboard
-- 2. Recarregue a aplicação
-- ================================================
