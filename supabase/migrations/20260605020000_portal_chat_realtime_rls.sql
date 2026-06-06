-- ============================================================================
-- Portal Chat — RLS SELECT para role portal_client (realtime fix)
-- ============================================================================
-- O role portal_client é deny-by-default. Sem políticas SELECT nas tabelas
-- abaixo, o Supabase Realtime não entrega eventos ao Portal do Cliente.
-- Este migration concede apenas o mínimo necessário para realtime funcionar.
-- Todas as escritas continuam via RPCs SECURITY DEFINER.
-- ============================================================================

-- ── portal_client_notifications ───────────────────────────────────────────────
-- Necessário para o canal portal-notifs:${clientId} entregar INSERTs ao portal.
GRANT SELECT ON public.portal_client_notifications TO portal_client;

DROP POLICY IF EXISTS "portal_client own notifications select" ON public.portal_client_notifications;
CREATE POLICY "portal_client own notifications select"
ON public.portal_client_notifications
FOR SELECT TO portal_client
USING (client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid);

-- ── chat_rooms ─────────────────────────────────────────────────────────────────
-- Necessário como subquery na policy de chat_messages abaixo.
GRANT SELECT ON public.chat_rooms TO portal_client;

DROP POLICY IF EXISTS "portal_client own chat rooms select" ON public.chat_rooms;
CREATE POLICY "portal_client own chat rooms select"
ON public.chat_rooms
FOR SELECT TO portal_client
USING (
  portal_client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid
  AND type = 'portal_client'
);

-- ── chat_messages ──────────────────────────────────────────────────────────────
-- Necessário para o canal wchat:${roomId} entregar INSERTs ao portal.
GRANT SELECT ON public.chat_messages TO portal_client;

DROP POLICY IF EXISTS "portal_client own chat messages select" ON public.chat_messages;
CREATE POLICY "portal_client own chat messages select"
ON public.chat_messages
FOR SELECT TO portal_client
USING (
  room_id IN (
    SELECT id FROM public.chat_rooms
    WHERE portal_client_id = (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid
      AND type = 'portal_client'
  )
);
