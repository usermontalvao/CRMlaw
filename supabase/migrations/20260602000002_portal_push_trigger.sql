-- Trigger: chama edge function portal-push ao inserir portal_client_notifications

CREATE OR REPLACE FUNCTION public._portal_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal_user_id uuid;
  v_title          text;
  v_body           text;
  v_supabase_url   text := 'https://uajwkqipbyxzvwjpitxl.supabase.co';
  v_anon_key       text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
BEGIN
  SELECT id INTO v_portal_user_id FROM public.client_portal_users WHERE client_id = NEW.client_id LIMIT 1;
  IF v_portal_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_push_subscriptions WHERE portal_user_id = v_portal_user_id) THEN RETURN NEW; END IF;
  v_title := COALESCE(NEW.title, 'Atualização do seu processo');
  v_body  := COALESCE(NEW.message, '');
  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/portal-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon_key),
    body    := jsonb_build_object('portal_user_id', v_portal_user_id, 'title', v_title, 'body', v_body, 'url', '/portal#portal/notificacoes')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS portal_push_on_notification ON public.portal_client_notifications;
CREATE TRIGGER portal_push_on_notification
  AFTER INSERT ON public.portal_client_notifications
  FOR EACH ROW EXECUTE FUNCTION public._portal_push_on_notification();
