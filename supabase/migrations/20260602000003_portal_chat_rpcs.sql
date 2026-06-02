-- ============================================================================
-- Portal Chat — RPCs e políticas RLS  (v3 — FK fix: portal_client_id = client_portal_users.id)
-- ============================================================================
-- IMPORTANTE: portal_client_id em chat_rooms e chat_messages referencia
-- client_portal_users.id (p_portal_user_id), NÃO clients.id.
--
-- PADRÃO DE "FECHAMENTO": salas portal_client usam created_by como indicador:
--   created_by IS NULL     → sala aberta (ativa)
--   created_by = user_id   → sala fechada (quem fechou)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RLS: salas portal_client visíveis para todos os autenticados (equipe do escritório)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_rooms_portal_client_select" ON public.chat_rooms;
CREATE POLICY "chat_rooms_portal_client_select"
ON public.chat_rooms FOR SELECT TO authenticated
USING (type = 'portal_client');

-- Mensagens de salas portal_client visíveis para todos os autenticados
DROP POLICY IF EXISTS "chat_messages_portal_client_select" ON public.chat_messages;
CREATE POLICY "chat_messages_portal_client_select"
ON public.chat_messages FOR SELECT TO authenticated
USING (
  room_id IN (
    SELECT id FROM public.chat_rooms WHERE type = 'portal_client'
  )
);

-- Atendente pode inserir mensagens em salas portal_client
DROP POLICY IF EXISTS "chat_messages_portal_client_insert" ON public.chat_messages;
CREATE POLICY "chat_messages_portal_client_insert"
ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND room_id IN (
    SELECT id FROM public.chat_rooms WHERE type = 'portal_client'
  )
);

-- ----------------------------------------------------------------------------
-- portal_get_or_create_chat_room — pega sala aberta ou cria nova
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_or_create_chat_room(
  p_portal_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id   uuid := public._portal_resolve_client(p_portal_user_id);
  v_client_name text;
  v_room_id     uuid;
BEGIN
  -- Procura sala aberta mais recente (created_by IS NULL = aberta)
  SELECT id INTO v_room_id
  FROM public.chat_rooms
  WHERE portal_client_id = v_client_id
    AND type = 'portal_client'
    AND created_by IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  -- Sem sala aberta → cria nova
  SELECT full_name INTO v_client_name
  FROM public.clients
  WHERE id = v_client_id;

  INSERT INTO public.chat_rooms (type, name, is_public, created_by, portal_client_id)
  VALUES ('portal_client', COALESCE(v_client_name, 'Cliente'), false, NULL, v_client_id)
  RETURNING id INTO v_room_id;

  -- Mensagem de sistema indicando nova conversa
  INSERT INTO public.chat_messages (room_id, user_id, content, is_system)
  VALUES (v_room_id, NULL, 'Nova conversa iniciada', true);

  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = v_room_id;

  RETURN v_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_or_create_chat_room(uuid) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- portal_list_chat_messages — retorna mensagens da sala mais recente do cliente
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_list_chat_messages(uuid, integer);
CREATE OR REPLACE FUNCTION public.portal_list_chat_messages(
  p_portal_user_id uuid,
  p_limit          integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_room_id   uuid;
  v_room_name text;
  v_is_closed boolean;
  v_messages  jsonb;
BEGIN
  -- Sala mais recente (aberta OU fechada) — o cliente sempre vê a última sala
  SELECT id, name, (created_by IS NOT NULL)
  INTO v_room_id, v_room_name, v_is_closed
  FROM public.chat_rooms
  WHERE portal_client_id = v_client_id
    AND type = 'portal_client'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_room_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Mensagens ordenadas cronologicamente (busca as p_limit mais recentes)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',          m.id,
      'content',     m.content,
      'created_at',  m.created_at,
      'from_client', (m.portal_client_id IS NOT NULL),
      'is_system',   COALESCE(m.is_system, false),
      'sender_name', CASE
        WHEN COALESCE(m.is_system, false) THEN NULL
        WHEN m.portal_client_id IS NOT NULL THEN NULL
        ELSE COALESCE(
          (SELECT p.name FROM public.profiles p WHERE p.user_id = m.user_id LIMIT 1),
          'Escritório'
        )
      END
    ) ORDER BY m.created_at ASC
  ), '[]'::jsonb)
  INTO v_messages
  FROM (
    SELECT *
    FROM public.chat_messages
    WHERE room_id = v_room_id
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT p_limit
  ) m;

  RETURN jsonb_build_object(
    'room', jsonb_build_object(
      'id',        v_room_id,
      'name',      v_room_name,
      'is_closed', v_is_closed
    ),
    'messages', COALESCE(v_messages, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_list_chat_messages(uuid, integer) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- portal_send_chat_message — envia mensagem; cria sala nova se atual fechada
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_send_chat_message(uuid, text);
CREATE OR REPLACE FUNCTION public.portal_send_chat_message(
  p_portal_user_id uuid,
  p_content        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_room_id   uuid;
  v_msg_id    uuid;
  v_preview   text;
BEGIN
  IF p_content IS NULL OR trim(p_content) = '' THEN
    RAISE EXCEPTION 'Mensagem não pode ser vazia' USING ERRCODE = '22023';
  END IF;

  -- Garante sala aberta (cria nova automaticamente se a última estiver fechada)
  v_room_id := public.portal_get_or_create_chat_room(p_portal_user_id);
  v_preview := left(trim(p_content), 100);

  -- Insere mensagem do cliente
  INSERT INTO public.chat_messages (room_id, user_id, portal_client_id, content)
  VALUES (v_room_id, NULL, v_client_id, trim(p_content))
  RETURNING id INTO v_msg_id;

  -- Atualiza preview da sala
  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = v_room_id;

  RETURN jsonb_build_object('id', v_msg_id, 'room_id', v_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_send_chat_message(uuid, text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- portal_close_chat_room — encerra conversa (marca created_by = quem fechou)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_close_chat_room(uuid, uuid);
CREATE OR REPLACE FUNCTION public.portal_close_chat_room(
  p_room_id    uuid,
  p_closed_by  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só encerra salas portal_client abertas
  UPDATE public.chat_rooms
  SET created_by = p_closed_by
  WHERE id = p_room_id
    AND type = 'portal_client'
    AND created_by IS NULL;

  -- Mensagem de sistema
  INSERT INTO public.chat_messages (room_id, user_id, content, is_system)
  VALUES (p_room_id, p_closed_by, 'Conversa encerrada', true);

  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_close_chat_room(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- portal_reopen_chat_room — reabre conversa (limpa created_by)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_reopen_chat_room(uuid);
CREATE OR REPLACE FUNCTION public.portal_reopen_chat_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_rooms
  SET created_by = NULL
  WHERE id = p_room_id
    AND type = 'portal_client';

  INSERT INTO public.chat_messages (room_id, user_id, content, is_system)
  VALUES (p_room_id, auth.uid(), 'Conversa reaberta', true);

  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_reopen_chat_room(uuid) TO authenticated;
