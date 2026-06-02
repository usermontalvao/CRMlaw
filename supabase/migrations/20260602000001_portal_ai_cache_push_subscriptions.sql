-- Portal: cache de análise IA + push subscriptions + backfill distributed_at
-- Aplicado via MCP em 02/06/2026

-- ══ portal_ai_cache ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.portal_ai_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text        NOT NULL CHECK (entity_type IN ('process','requirement')),
  entity_id     uuid        NOT NULL,
  generated_text text       NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  model         text,
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_ai_cache_entity ON public.portal_ai_cache(entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.portal_get_ai_cache(p_portal_user_id uuid, p_entity_type text, p_entity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client_id uuid := public._portal_resolve_client(p_portal_user_id); v_row public.portal_ai_cache%ROWTYPE;
BEGIN
  IF p_entity_type = 'process' THEN IF NOT EXISTS (SELECT 1 FROM public.processes WHERE id = p_entity_id AND client_id = v_client_id) THEN RETURN NULL; END IF;
  ELSIF p_entity_type = 'requirement' THEN IF NOT EXISTS (SELECT 1 FROM public.requirements WHERE id = p_entity_id AND client_id = v_client_id) THEN RETURN NULL; END IF;
  ELSE RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.portal_ai_cache WHERE entity_type = p_entity_type AND entity_id = p_entity_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('generated_text', v_row.generated_text, 'generated_at', v_row.generated_at, 'model', v_row.model);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_upsert_ai_cache(p_portal_user_id uuid, p_entity_type text, p_entity_id uuid, p_text text, p_model text DEFAULT 'gpt-4o')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF p_entity_type = 'process' THEN IF NOT EXISTS (SELECT 1 FROM public.processes WHERE id = p_entity_id AND client_id = v_client_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  ELSIF p_entity_type = 'requirement' THEN IF NOT EXISTS (SELECT 1 FROM public.requirements WHERE id = p_entity_id AND client_id = v_client_id) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  ELSE RAISE EXCEPTION 'Tipo inválido'; END IF;
  INSERT INTO public.portal_ai_cache (entity_type, entity_id, generated_text, generated_at, model) VALUES (p_entity_type, p_entity_id, p_text, now(), p_model)
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET generated_text = EXCLUDED.generated_text, generated_at = EXCLUDED.generated_at, model = EXCLUDED.model;
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_get_ai_cache(uuid,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_upsert_ai_cache(uuid,text,uuid,text,text) TO anon, authenticated;
DO $$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_get_ai_cache(uuid,text,uuid) TO portal_client'; EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_upsert_ai_cache(uuid,text,uuid,text,text) TO portal_client'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ══ portal_push_subscriptions ═════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.portal_push_subscriptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid        NOT NULL REFERENCES public.client_portal_users(id) ON DELETE CASCADE,
  endpoint       text        NOT NULL,
  p256dh         text        NOT NULL,
  auth           text        NOT NULL,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  UNIQUE (portal_user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_portal_push_subs_user ON public.portal_push_subscriptions(portal_user_id);

CREATE OR REPLACE FUNCTION public.portal_save_push_subscription(p_portal_user_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_portal_users WHERE id = p_portal_user_id) THEN RAISE EXCEPTION 'Usuário inválido'; END IF;
  INSERT INTO public.portal_push_subscriptions (portal_user_id, endpoint, p256dh, auth, user_agent) VALUES (p_portal_user_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (portal_user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, last_used_at = now();
END; $$;

CREATE OR REPLACE FUNCTION public.portal_remove_push_subscription(p_portal_user_id uuid, p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.portal_push_subscriptions WHERE portal_user_id = p_portal_user_id AND endpoint = p_endpoint; END; $$;

GRANT EXECUTE ON FUNCTION public.portal_save_push_subscription(uuid,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_remove_push_subscription(uuid,text) TO anon, authenticated;
DO $$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_save_push_subscription(uuid,text,text,text,text) TO portal_client'; EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_remove_push_subscription(uuid,text) TO portal_client'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ══ backfill distributed_at ═══════════════════════════════════════════════════
UPDATE public.processes p SET distributed_at = sub.oldest_date
FROM (SELECT process_id, MIN(data_hora)::date AS oldest_date FROM public.datajud_movimentos GROUP BY process_id) sub
WHERE p.id = sub.process_id AND p.distributed_at IS NULL AND sub.oldest_date IS NOT NULL;
