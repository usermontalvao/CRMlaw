-- ============================================================================
-- Admin: leitura de portal_client_notifications e check de push subscriptions
-- Necessário para as abas Atendimento + Portal na ficha 360 do cliente.
-- ============================================================================

-- Admin pode ler notificações do portal de qualquer cliente
DROP POLICY IF EXISTS "Staff lê notificações portal" ON public.portal_client_notifications;
CREATE POLICY "Staff lê notificações portal" ON public.portal_client_notifications
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Função SECURITY DEFINER: retorna true se o cliente tem push ativo
-- (evita expor endpoint/p256dh/auth do WebPush para o frontend)
CREATE OR REPLACE FUNCTION public.admin_portal_push_active(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.portal_push_subscriptions ps
    JOIN public.client_portal_users cpu ON cpu.id = ps.portal_user_id
    WHERE cpu.client_id = p_client_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.admin_portal_push_active(uuid) TO authenticated;
