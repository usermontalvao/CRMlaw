-- ================================================
-- SCHEMA DE CHAT PARA SUPABASE
-- ================================================
-- Execute este SQL no Supabase SQL Editor
-- ================================================

-- IMPORTANTE: Se você já executou o schema anterior,
-- execute primeiro este comando para adicionar a coluna faltante:
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ================================================

-- 1. Tabela de Conversas
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    is_group BOOLEAN DEFAULT false,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Tabela de Participantes
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(conversation_id, user_id)
);

-- 3. Tabela de Mensagens
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Tabela de Sessões de Chamada (opcional)
CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    caller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended', 'missed')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ================================================
-- ÍNDICES PARA PERFORMANCE
-- ================================================

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);

-- ================================================
-- ROW LEVEL SECURITY (RLS)
-- ================================================

-- Habilitar RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

-- Políticas para CONVERSATIONS
CREATE POLICY "Usuários podem ver conversas das quais participam"
    ON public.conversations FOR SELECT
    USING (
        id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Usuários podem criar conversas"
    ON public.conversations FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Usuários podem atualizar conversas das quais participam"
    ON public.conversations FOR UPDATE
    USING (
        id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

-- Políticas para CONVERSATION_PARTICIPANTS
CREATE POLICY "Usuários podem ver participantes de suas conversas"
    ON public.conversation_participants FOR SELECT
    USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Usuários podem adicionar participantes"
    ON public.conversation_participants FOR INSERT
    WITH CHECK (true);

-- Políticas para MESSAGES
CREATE POLICY "Usuários podem ver mensagens de suas conversas"
    ON public.messages FOR SELECT
    USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Usuários podem enviar mensagens em suas conversas"
    ON public.messages FOR INSERT
    WITH CHECK (
        sender_id = auth.uid() AND
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

-- Políticas para CALL_SESSIONS
CREATE POLICY "Usuários podem ver chamadas de suas conversas"
    ON public.call_sessions FOR SELECT
    USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Usuários podem criar chamadas"
    ON public.call_sessions FOR INSERT
    WITH CHECK (caller_id = auth.uid());

CREATE POLICY "Usuários podem atualizar chamadas"
    ON public.call_sessions FOR UPDATE
    USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid()
        )
    );

-- ================================================
-- TRIGGERS PARA ATUALIZAR updated_at
-- ================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================
-- FUNÇÃO PARA CALCULAR MENSAGENS NÃO LIDAS
-- ================================================

CREATE OR REPLACE FUNCTION get_unread_count(p_conversation_id UUID, p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_last_read_at TIMESTAMP WITH TIME ZONE;
    v_unread_count INTEGER;
BEGIN
    -- Buscar último horário de leitura
    SELECT last_read_at INTO v_last_read_at
    FROM public.conversation_participants
    WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
    
    -- Contar mensagens não lidas
    SELECT COUNT(*) INTO v_unread_count
    FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND sender_id != p_user_id
      AND created_at > COALESCE(v_last_read_at, '1970-01-01'::TIMESTAMP WITH TIME ZONE);
    
    RETURN v_unread_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- SISTEMA DE PRESENÇA (ONLINE/AUSENTE/OFFLINE)
-- ================================================

-- Adicionar colunas de presença na tabela profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS presence_status TEXT DEFAULT 'offline' CHECK (presence_status IN ('online', 'away', 'offline'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Criar índice para performance
CREATE INDEX IF NOT EXISTS idx_profiles_presence ON public.profiles(presence_status, last_seen_at);

-- Função para atualizar presença automaticamente
CREATE OR REPLACE FUNCTION update_user_presence()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_seen_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar last_seen_at quando o perfil é atualizado
DROP TRIGGER IF EXISTS trigger_update_presence ON public.profiles;
CREATE TRIGGER trigger_update_presence
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_presence();

-- Função para marcar usuário como online
CREATE OR REPLACE FUNCTION set_user_online(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'online',
      last_seen_at = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para marcar usuário como ausente
CREATE OR REPLACE FUNCTION set_user_away(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'away',
      last_seen_at = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para marcar usuário como offline
CREATE OR REPLACE FUNCTION set_user_offline(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'offline',
      last_seen_at = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para calcular status baseado em last_seen_at (fallback)
CREATE OR REPLACE FUNCTION get_computed_presence(p_last_seen_at TIMESTAMP WITH TIME ZONE, p_presence_status TEXT)
RETURNS TEXT AS $$
DECLARE
  minutes_since_seen INTEGER;
BEGIN
  IF p_presence_status = 'online' THEN
    minutes_since_seen := EXTRACT(EPOCH FROM (now() - p_last_seen_at)) / 60;
    
    -- Se passou mais de 5 minutos, considerar ausente
    IF minutes_since_seen > 5 THEN
      RETURN 'away';
    END IF;
    
    -- Se passou mais de 15 minutos, considerar offline
    IF minutes_since_seen > 15 THEN
      RETURN 'offline';
    END IF;
    
    RETURN 'online';
  END IF;
  
  RETURN p_presence_status;
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- CONCLUÍDO
-- ================================================
-- Execute este script no Supabase SQL Editor
-- Depois recarregue a aplicação
-- ================================================
