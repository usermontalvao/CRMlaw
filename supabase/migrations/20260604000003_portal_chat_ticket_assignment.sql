-- ============================================================================
-- Portal Chat — Sistema de fila e atribuição de tickets
--
-- accepted_by IS NULL      → ticket na fila (todos os atendentes veem)
-- accepted_by = user_id    → atribuído, só esse atendente vê
-- Cliente abre nova conversa → nova sala com accepted_by = NULL → volta à fila
-- Reabrir encerrada         → accepted_by = NULL → volta à fila
-- ============================================================================

-- 1. Coluna accepted_by
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.chat_rooms.accepted_by IS
  'Atendente que aceitou o ticket. NULL = na fila. Preenchido = atribuído, visível só para este atendente.';

CREATE INDEX IF NOT EXISTS idx_chat_rooms_accepted_by
  ON public.chat_rooms(accepted_by)
  WHERE type = 'portal_client';

-- 2. portal_accept_ticket
DROP FUNCTION IF EXISTS public.portal_accept_ticket(uuid);

CREATE FUNCTION public.portal_accept_ticket(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_name text;
BEGIN
  UPDATE public.chat_rooms
  SET accepted_by = auth.uid()
  WHERE id = p_room_id
    AND type = 'portal_client'
    AND accepted_by IS NULL
    AND created_by IS NULL;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(name, 'Atendente') INTO v_staff_name
  FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.chat_messages (room_id, user_id, content, is_system)
  VALUES (p_room_id, auth.uid(), v_staff_name || ' entrou na conversa', true);

  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_accept_ticket(uuid) TO authenticated;

-- 3. portal_reopen_chat_room: zera accepted_by → volta para a fila
CREATE OR REPLACE FUNCTION public.portal_reopen_chat_room(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_rooms
  SET created_by  = NULL,
      accepted_by = NULL
  WHERE id = p_room_id AND type = 'portal_client';

  INSERT INTO public.chat_messages (room_id, user_id, content, is_system)
  VALUES (p_room_id, auth.uid(), 'Conversa reaberta', true);

  UPDATE public.chat_rooms SET last_message_at = now() WHERE id = p_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_reopen_chat_room(uuid) TO authenticated;

-- 4. Policy UPDATE para staff aceitar tickets
DROP POLICY IF EXISTS "chat_rooms_portal_client_update" ON public.chat_rooms;
CREATE POLICY "chat_rooms_portal_client_update"
ON public.chat_rooms FOR UPDATE TO authenticated
USING  (type = 'portal_client')
WITH CHECK (type = 'portal_client');

-- 5. REPLICA IDENTITY FULL para realtime propagar UPDATEs com valores anteriores
ALTER TABLE public.chat_rooms REPLICA IDENTITY FULL;
