-- Fecha os helpers SECURITY DEFINER criados pelas migrations de permissão de
-- assinaturas. Como essas migrations já podem ter sido aplicadas antes da
-- correção dos REVOKEs, este arquivo é intencionalmente um follow-up idempotente.

REVOKE ALL ON FUNCTION public.current_role_slug() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_module_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_module_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_signature_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_signature_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_delete_signature_request(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_role_slug() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_module_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_module_permission(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_signature_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_signature_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_signature_request(uuid) TO authenticated;

-- Função de trigger não é endpoint RPC.
REVOKE ALL ON FUNCTION public.tg_signature_archive_needs_delete_permission()
  FROM PUBLIC, anon, authenticated;
