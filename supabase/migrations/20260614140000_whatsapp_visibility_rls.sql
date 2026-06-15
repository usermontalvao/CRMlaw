-- ============================================================
-- Módulo WhatsApp — Fase 5: regra de VISIBILIDADE por canal e setor
--
-- Antes: wa_conv_staff (FOR ALL) deixava todo staff ver toda conversa.
-- Agora: SELECT recortado. Um usuário só enxerga a conversa quando:
--   - é supervisor (role 'Administrador') — visão ampliada; ou
--   - a conversa está atribuída a ele (assigned_user_id); ou
--   - ele participa de uma transferência da conversa (origem ou destino); ou
--   - tem acesso pelo CANAL  (canal sem membros = aberto, ou é membro) E
--     tem acesso pelo SETOR  (sem setor, setor sem membros = aberto, ou é membro).
--
-- Default seguro: canal/setor SEM membros = aberto a todo staff. Assim a
-- adoção é gradual — nada some até alguém definir membros explicitamente.
--
-- Escrita (insert/update/delete) continua liberada a staff: transferir uma
-- conversa para fora do seu escopo não pode ser bloqueado por WITH CHECK.
-- Ingestão (webhook/evolution-send) usa service role e ignora RLS.
-- ============================================================

-- Helpers de visibilidade são consumidos só pelas policies (TO authenticated);
-- ninguém precisa chamá-los como RPC, e anon nunca toca nessas tabelas.
-- (REVOKEs no fim do arquivo, após as funções existirem.)

-- Supervisor com visão ampliada (papel de administração do escritório).
CREATE OR REPLACE FUNCTION public.wa_is_supervisor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.role = 'Administrador'
  );
$$;

-- Pode o usuário atual ver esta conversa? (avaliado por linha na policy de SELECT)
CREATE OR REPLACE FUNCTION public.wa_can_see_conv(
  p_channel uuid, p_dept uuid, p_assigned uuid, p_conv uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_office_staff() AND (
    public.wa_is_supervisor()
    OR p_assigned = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_transfers t
      WHERE t.conversation_id = p_conv
        AND (t.to_user_id = auth.uid() OR t.from_user_id = auth.uid())
    )
    OR (
      -- Canal: aberto (sem membros) OU sou membro
      (
        p_channel IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.whatsapp_channel_members cm WHERE cm.channel_id = p_channel)
        OR EXISTS (SELECT 1 FROM public.whatsapp_channel_members cm WHERE cm.channel_id = p_channel AND cm.user_id = auth.uid())
      )
      AND
      -- Setor: sem setor, setor aberto (sem membros), OU sou membro
      (
        p_dept IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.whatsapp_department_members dm WHERE dm.department_id = p_dept)
        OR EXISTS (SELECT 1 FROM public.whatsapp_department_members dm WHERE dm.department_id = p_dept AND dm.user_id = auth.uid())
      )
    )
  );
$$;

-- ── Conversas: SELECT recortado, escrita para staff ──
DROP POLICY IF EXISTS wa_conv_staff ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_select ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_insert ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_update ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_delete ON public.whatsapp_conversations;

CREATE POLICY wa_conv_select ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id));
CREATE POLICY wa_conv_insert ON public.whatsapp_conversations FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_conv_update ON public.whatsapp_conversations FOR UPDATE TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
CREATE POLICY wa_conv_delete ON public.whatsapp_conversations FOR DELETE TO authenticated
  USING (public.is_office_staff());

-- ── Mensagens: SELECT segue a visibilidade da conversa-pai ──
DROP POLICY IF EXISTS wa_msg_staff ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_select ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_insert ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_update ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_delete ON public.whatsapp_messages;

CREATE POLICY wa_msg_select ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
    WHERE c.id = conversation_id
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
  ));
CREATE POLICY wa_msg_insert ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_msg_update ON public.whatsapp_messages FOR UPDATE TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
CREATE POLICY wa_msg_delete ON public.whatsapp_messages FOR DELETE TO authenticated
  USING (public.is_office_staff());

-- Fecha a exposição via RPC: helpers só servem às policies de authenticated.
REVOKE EXECUTE ON FUNCTION public.wa_is_supervisor() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.wa_can_see_conv(uuid, uuid, uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.wa_is_supervisor() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.wa_can_see_conv(uuid, uuid, uuid, uuid) TO authenticated;
