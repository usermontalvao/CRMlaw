-- Reduz o custo de avaliação do RLS do chat.
--
-- Sintoma: 4.8 milhões de seq scans em chat_room_members e 1.3 milhão em
-- chat_rooms. Os índices já existiam (a PK de chat_room_members cobre
-- room_id + user_id); o problema era o número de execuções, não a falta de
-- índice.
--
-- Três causas, atacadas aqui:
--   1. As funções auxiliares do RLS estavam VOLATILE (padrão do Postgres,
--      ninguém declarou). Elas são LANGUAGE sql e só leem — o correto é
--      STABLE. Sendo VOLATILE, o planejador é obrigado a reexecutar a
--      chamada linha a linha, sem poder içar a avaliação.
--   2. Não existia índice em chat_rooms(type). As policies do portal filtram
--      por type = 'portal_client' em subconsulta, o que virava seq scan.
--   3. auth.uid() e auth.jwt() apareciam soltos nas expressões, sendo
--      avaliados por linha. Envolvidos em (select ...), viram InitPlan e são
--      avaliados uma única vez por consulta.
--
-- Nada aqui muda quem enxerga o quê: as expressões são reescritas de forma
-- semanticamente idêntica, e usamos ALTER POLICY para não recriar policy
-- alguma (o WITH CHECK de cada uma permanece exatamente como está, exceto
-- pela mesma reescrita de auth.uid()).

-- ---------------------------------------------------------------------------
-- 1. Funções auxiliares: VOLATILE -> STABLE
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.is_chat_room_member(uuid, uuid) STABLE;
ALTER FUNCTION public.is_chat_room_public(uuid) STABLE;
ALTER FUNCTION public.chat_room_created_by(uuid) STABLE;

-- ---------------------------------------------------------------------------
-- 2. Índice que faltava
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON public.chat_rooms (type);

-- ---------------------------------------------------------------------------
-- 3. auth.uid() / auth.jwt() como InitPlan
-- ---------------------------------------------------------------------------

-- chat_messages
ALTER POLICY chat_messages_select ON public.chat_messages
  USING (
    public.is_chat_room_public(room_id)
    OR public.is_chat_room_member(room_id, (SELECT auth.uid()))
  );

ALTER POLICY chat_messages_insert ON public.chat_messages
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      public.is_chat_room_public(room_id)
      OR public.is_chat_room_member(room_id, (SELECT auth.uid()))
    )
  );

ALTER POLICY chat_messages_portal_client_insert ON public.chat_messages
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND room_id IN (
      SELECT r.id FROM public.chat_rooms r WHERE r.type = 'portal_client'
    )
  );

ALTER POLICY chat_messages_update ON public.chat_messages
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND lower(COALESCE(p.role, '')) LIKE '%admin%'
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND lower(COALESCE(p.role, '')) LIKE '%admin%'
    )
  );

ALTER POLICY "portal_client own chat messages select" ON public.chat_messages
  USING (
    room_id IN (
      SELECT r.id FROM public.chat_rooms r
      WHERE r.portal_client_id = (((SELECT auth.jwt()) -> 'app_metadata' ->> 'client_id'))::uuid
        AND r.type = 'portal_client'
    )
  );

-- chat_rooms
ALTER POLICY chat_rooms_select ON public.chat_rooms
  USING (
    is_public = true
    OR created_by = (SELECT auth.uid())
    OR public.is_chat_room_member(id, (SELECT auth.uid()))
  );

ALTER POLICY chat_rooms_insert ON public.chat_rooms
  WITH CHECK (created_by = (SELECT auth.uid()));

ALTER POLICY chat_rooms_update ON public.chat_rooms
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (created_by = (SELECT auth.uid()));

ALTER POLICY "portal_client own chat rooms select" ON public.chat_rooms
  USING (
    portal_client_id = (((SELECT auth.jwt()) -> 'app_metadata' ->> 'client_id'))::uuid
    AND type = 'portal_client'
  );

-- chat_room_members
ALTER POLICY chat_room_members_select ON public.chat_room_members
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_chat_room_public(room_id)
    OR public.is_chat_room_member(room_id, (SELECT auth.uid()))
  );

ALTER POLICY chat_room_members_insert ON public.chat_room_members
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      user_id = (SELECT auth.uid())
      OR public.chat_room_created_by(room_id) = (SELECT auth.uid())
    )
  );

ALTER POLICY chat_room_members_update ON public.chat_room_members
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER POLICY chat_room_members_delete ON public.chat_room_members
  USING (public.chat_room_created_by(room_id) = (SELECT auth.uid()));

ANALYZE public.chat_rooms;
ANALYZE public.chat_room_members;
