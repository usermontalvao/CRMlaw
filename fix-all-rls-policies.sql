-- ================================================
-- FIX COMPLETO - TODAS AS POLÍTICAS RLS
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- ================================================
-- 1. TASKS (Tarefas)
-- ================================================
ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver suas tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Usuários podem inserir tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Usuários podem atualizar suas tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Usuários podem deletar suas tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Permitir leitura de tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Permitir inserção de tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Permitir atualização de tarefas" ON public.tasks;
DROP POLICY IF EXISTS "Permitir deleção de tarefas" ON public.tasks;

CREATE POLICY "Permitir todas operações em tarefas"
ON public.tasks
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 2. MESSAGES (Mensagens do Chat)
-- ================================================
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver mensagens" ON public.messages;
DROP POLICY IF EXISTS "Usuários podem inserir mensagens" ON public.messages;
DROP POLICY IF EXISTS "Usuários podem atualizar mensagens" ON public.messages;
DROP POLICY IF EXISTS "Usuários podem deletar mensagens" ON public.messages;
DROP POLICY IF EXISTS "Permitir leitura de mensagens" ON public.messages;
DROP POLICY IF EXISTS "Permitir inserção de mensagens" ON public.messages;
DROP POLICY IF EXISTS "Permitir atualização de mensagens" ON public.messages;
DROP POLICY IF EXISTS "Permitir deleção de mensagens" ON public.messages;

CREATE POLICY "Permitir todas operações em mensagens"
ON public.messages
FOR ALL
USING (
  conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_participants 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_participants 
    WHERE user_id = auth.uid()
  )
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 3. CONVERSATIONS (Conversas)
-- ================================================
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver conversas" ON public.conversations;
DROP POLICY IF EXISTS "Usuários podem inserir conversas" ON public.conversations;
DROP POLICY IF EXISTS "Usuários podem atualizar conversas" ON public.conversations;
DROP POLICY IF EXISTS "Permitir leitura de conversas" ON public.conversations;
DROP POLICY IF EXISTS "Permitir inserção de conversas" ON public.conversations;
DROP POLICY IF EXISTS "Permitir atualização de conversas" ON public.conversations;

CREATE POLICY "Permitir todas operações em conversas"
ON public.conversations
FOR ALL
USING (
  id IN (
    SELECT conversation_id 
    FROM public.conversation_participants 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (true);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 4. CONVERSATION_PARTICIPANTS (Participantes)
-- ================================================
ALTER TABLE public.conversation_participants DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver participantes" ON public.conversation_participants;
DROP POLICY IF EXISTS "Usuários podem inserir participantes" ON public.conversation_participants;
DROP POLICY IF EXISTS "Permitir leitura de participantes" ON public.conversation_participants;
DROP POLICY IF EXISTS "Permitir inserção de participantes" ON public.conversation_participants;

CREATE POLICY "Permitir todas operações em participantes"
ON public.conversation_participants
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 5. DJEN_COMUNICACOES (Comunicações DJEN)
-- ================================================
ALTER TABLE public.djen_comunicacoes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver suas comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem inserir comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem atualizar suas comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Usuários podem deletar suas comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Permitir leitura de comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Permitir inserção de comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Permitir atualização de comunicações" ON public.djen_comunicacoes;
DROP POLICY IF EXISTS "Permitir deleção de comunicações" ON public.djen_comunicacoes;

CREATE POLICY "Permitir todas operações em comunicações"
ON public.djen_comunicacoes
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.djen_comunicacoes ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 6. CLIENTS (Clientes)
-- ================================================
ALTER TABLE public.clients DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver clientes" ON public.clients;
DROP POLICY IF EXISTS "Usuários podem inserir clientes" ON public.clients;
DROP POLICY IF EXISTS "Usuários podem atualizar clientes" ON public.clients;
DROP POLICY IF EXISTS "Usuários podem deletar clientes" ON public.clients;

CREATE POLICY "Permitir todas operações em clientes"
ON public.clients
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 7. PROCESSES (Processos)
-- ================================================
ALTER TABLE public.processes DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver processos" ON public.processes;
DROP POLICY IF EXISTS "Usuários podem inserir processos" ON public.processes;
DROP POLICY IF EXISTS "Usuários podem atualizar processos" ON public.processes;
DROP POLICY IF EXISTS "Usuários podem deletar processos" ON public.processes;

CREATE POLICY "Permitir todas operações em processos"
ON public.processes
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.processes ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 8. DEADLINES (Prazos)
-- ================================================
ALTER TABLE public.deadlines DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver prazos" ON public.deadlines;
DROP POLICY IF EXISTS "Usuários podem inserir prazos" ON public.deadlines;
DROP POLICY IF EXISTS "Usuários podem atualizar prazos" ON public.deadlines;
DROP POLICY IF EXISTS "Usuários podem deletar prazos" ON public.deadlines;

CREATE POLICY "Permitir todas operações em prazos"
ON public.deadlines
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 9. REQUIREMENTS (Requerimentos)
-- ================================================
ALTER TABLE public.requirements DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver requerimentos" ON public.requirements;
DROP POLICY IF EXISTS "Usuários podem inserir requerimentos" ON public.requirements;
DROP POLICY IF EXISTS "Usuários podem atualizar requerimentos" ON public.requirements;
DROP POLICY IF EXISTS "Usuários podem deletar requerimentos" ON public.requirements;

CREATE POLICY "Permitir todas operações em requerimentos"
ON public.requirements
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.requirements ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 10. CALENDAR_EVENTS (Eventos da Agenda)
-- ================================================
ALTER TABLE public.calendar_events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver eventos" ON public.calendar_events;
DROP POLICY IF EXISTS "Usuários podem inserir eventos" ON public.calendar_events;
DROP POLICY IF EXISTS "Usuários podem atualizar eventos" ON public.calendar_events;
DROP POLICY IF EXISTS "Usuários podem deletar eventos" ON public.calendar_events;

CREATE POLICY "Permitir todas operações em eventos"
ON public.calendar_events
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 11. PROFILES (Perfis de Usuários)
-- ================================================
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver perfis" ON public.profiles;
DROP POLICY IF EXISTS "Usuários podem atualizar seu perfil" ON public.profiles;
DROP POLICY IF EXISTS "Permitir leitura de perfis" ON public.profiles;
DROP POLICY IF EXISTS "Permitir atualização de perfis" ON public.profiles;

CREATE POLICY "Permitir leitura de todos os perfis"
ON public.profiles
FOR SELECT
USING (true);

CREATE POLICY "Permitir atualização do próprio perfil"
ON public.profiles
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 12. DOCUMENT_TEMPLATES (Templates de Documentos)
-- ================================================
ALTER TABLE public.document_templates DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver templates" ON public.document_templates;
DROP POLICY IF EXISTS "Usuários podem inserir templates" ON public.document_templates;
DROP POLICY IF EXISTS "Usuários podem atualizar templates" ON public.document_templates;
DROP POLICY IF EXISTS "Usuários podem deletar templates" ON public.document_templates;

CREATE POLICY "Permitir todas operações em templates"
ON public.document_templates
FOR ALL
USING (true)
WITH CHECK (true);

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

-- ================================================
-- 13. STORAGE OBJECTS (Arquivos)
-- ================================================
DROP POLICY IF EXISTS "Permitir upload de anexos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir leitura de anexos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir deleção de anexos próprios" ON storage.objects;
DROP POLICY IF EXISTS "Permitir upload de arquivos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir leitura de arquivos" ON storage.objects;
DROP POLICY IF EXISTS "Permitir deleção de arquivos" ON storage.objects;

-- Política para chat-attachments
CREATE POLICY "Permitir upload no chat-attachments"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'chat-attachments' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Permitir leitura no chat-attachments"
ON storage.objects
FOR SELECT
USING (bucket_id = 'chat-attachments');

CREATE POLICY "Permitir deleção no chat-attachments"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'chat-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Todas as políticas RLS foram corrigidas!
-- Recarregue a aplicação para testar.
-- ================================================
