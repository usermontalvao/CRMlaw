-- ================================================
-- FIX CHAT REALTIME - HABILITAR REPLICAÇÃO
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- 1. VERIFICAR SE REPLICAÇÃO ESTÁ HABILITADA
-- ================================================
-- Habilitar replicação para a tabela messages
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- Habilitar replicação para a tabela conversations
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

-- Habilitar replicação para a tabela conversation_participants
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;

-- ================================================
-- 2. VERIFICAR PUBLICAÇÃO REALTIME
-- ================================================
-- No Supabase Dashboard, vá em Database > Replication
-- Certifique-se que as seguintes tabelas estão habilitadas:
-- - messages
-- - conversations
-- - conversation_participants

-- ================================================
-- 3. CRIAR ÍNDICES PARA PERFORMANCE
-- ================================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON public.messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender 
ON public.messages(sender_id);

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Após executar:
-- 1. Vá em Database > Replication no Dashboard
-- 2. Habilite as tabelas: messages, conversations, conversation_participants
-- 3. Recarregue a aplicação
-- ================================================
