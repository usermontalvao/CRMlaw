-- ================================================
-- FIX TABELA MESSAGES - ADICIONAR COLUNAS DE ANEXOS
-- ================================================

-- Adicionar colunas faltantes na tabela messages
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS file_url TEXT,
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS file_size INTEGER;

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_messages_file_url ON public.messages(file_url);

-- ================================================
-- CORRIGIR POLÍTICAS RLS PARA PERMITIR DELETE
-- ================================================

-- Remover política antiga de DELETE se existir
DROP POLICY IF EXISTS "Usuários podem deletar mensagens" ON public.messages;
DROP POLICY IF EXISTS "Permitir deleção de mensagens" ON public.messages;

-- Criar política para permitir deleção de mensagens da própria conversa
CREATE POLICY "Permitir deleção de mensagens"
ON public.messages
FOR DELETE
USING (
  conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_participants 
    WHERE user_id = auth.uid()
  )
);

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- Depois recarregue a aplicação
-- ================================================
