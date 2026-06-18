-- Web Push para o STAFF no módulo WhatsApp: notifica o atendente mesmo com o
-- navegador FECHADO. Espelha a infra do portal do cliente
-- (portal_push_subscriptions + edge portal-push), mas o escopo é o usuário
-- interno (auth.uid()) e o gatilho é mensagem inbound de conversa atribuída.
--
-- Decisão: usar TRIGGER no insert da mensagem (não editar o evolution-webhook,
-- que sofre de drift repo↔deploy). O mesmo sinal que o aviso in-app
-- (useWhatsAppNotifications) usa: INSERT da mensagem direction='in'.

CREATE TABLE IF NOT EXISTS public.staff_push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL,
  p256dh       text        NOT NULL,
  auth         text        NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_staff_push_subs_user ON public.staff_push_subscriptions(user_id);

ALTER TABLE public.staff_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_push_own ON public.staff_push_subscriptions;
CREATE POLICY staff_push_own ON public.staff_push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_office_staff())
  WITH CHECK (user_id = auth.uid() AND public.is_office_staff());

-- Salva/atualiza a subscription do PRÓPRIO usuário (usa auth.uid(); não confia
-- em parâmetro de identidade). Idempotente por (user_id, endpoint).
CREATE OR REPLACE FUNCTION public.staff_save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_office_staff() THEN RAISE EXCEPTION 'Não autorizado'; END IF;
  INSERT INTO public.staff_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_uid, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (user_id, endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent, last_used_at = now();
END; $$;

CREATE OR REPLACE FUNCTION public.staff_remove_push_subscription(p_endpoint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  DELETE FROM public.staff_push_subscriptions WHERE user_id = v_uid AND endpoint = p_endpoint;
END; $$;

GRANT EXECUTE ON FUNCTION public.staff_save_push_subscription(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_remove_push_subscription(text) TO authenticated;

-- Gatilho: mensagem inbound de conversa ATRIBUÍDA e NÃO bloqueada → dispara o
-- whatsapp-push para o responsável (se ele tiver subscription). Best-effort:
-- qualquer erro vira RETURN NEW (nunca bloqueia a ingestão de mensagens).
CREATE OR REPLACE FUNCTION public._wa_push_on_inbound_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_assigned     uuid;
  v_name         text;
  v_phone        text;
  v_blocked      boolean;
  v_body         text;
  v_supabase_url text := 'https://uajwkqipbyxzvwjpitxl.supabase.co';
  v_anon_key     text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;
  SELECT assigned_user_id, contact_name, contact_phone, is_blocked
    INTO v_assigned, v_name, v_phone, v_blocked
    FROM public.whatsapp_conversations WHERE id = NEW.conversation_id;
  IF v_assigned IS NULL OR v_blocked THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_push_subscriptions WHERE user_id = v_assigned) THEN RETURN NEW; END IF;
  v_body := CASE NEW.type
    WHEN 'image'    THEN '[Imagem]'
    WHEN 'audio'    THEN '[Audio]'
    WHEN 'video'    THEN '[Video]'
    WHEN 'document' THEN '[Documento]'
    WHEN 'sticker'  THEN 'Figurinha'
    ELSE COALESCE(NULLIF(left(NEW.content, 120), ''), 'Nova mensagem') END;
  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/whatsapp-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon_key),
    body    := jsonb_build_object(
      'user_id', v_assigned,
      'title',   'WhatsApp - ' || COALESCE(NULLIF(v_name, ''), v_phone, 'Contato'),
      'body',    v_body,
      'conversation_id', NEW.conversation_id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS wa_push_on_inbound_message ON public.whatsapp_messages;
CREATE TRIGGER wa_push_on_inbound_message
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public._wa_push_on_inbound_message();
