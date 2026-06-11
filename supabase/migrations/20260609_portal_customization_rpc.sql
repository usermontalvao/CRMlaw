-- ============================================================================
-- Portal do Cliente — RPC de personalização (sem portal_user_id)
-- ============================================================================
-- Retorna a config de personalização do portal (cor, mensagem, rodapé, suporte)
-- armazenada em system_settings['portal_customization_config'].
-- Não exige portal_user_id: é configuração pública do escritório.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_get_customization_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.system_settings WHERE key = 'portal_customization_config' LIMIT 1),
    '{}'::jsonb
  );
$$;

-- Concede ao role portal_client (deny-by-default, ver 20260601000010)
GRANT EXECUTE ON FUNCTION public.portal_get_customization_config() TO portal_client;
