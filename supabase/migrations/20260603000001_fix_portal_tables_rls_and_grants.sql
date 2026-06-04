-- Security fix: habilita RLS e revoga grants diretos de anon/authenticated
-- nas tabelas do portal que só são acessadas via RPCs SECURITY DEFINER.
-- Todas as RPCs (portal_get_ai_cache, portal_upsert_ai_cache,
-- portal_save_push_subscription, portal_remove_push_subscription) são
-- SECURITY DEFINER e bypassam RLS — este fix não afeta nenhuma funcionalidade.

-- ══ portal_ai_cache ═══════════════════════════════════════════════════════════
ALTER TABLE public.portal_ai_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_ai_cache FROM anon, authenticated;

-- ══ portal_push_subscriptions ═════════════════════════════════════════════════
ALTER TABLE public.portal_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_push_subscriptions FROM anon, authenticated;

-- ══ portal_profile_update_requests ════════════════════════════════════════════
-- RLS já estava habilitado (deny-all por falta de policies).
-- Revoga grants desnecessários de anon/authenticated.
REVOKE ALL ON TABLE public.portal_profile_update_requests FROM anon, authenticated;
