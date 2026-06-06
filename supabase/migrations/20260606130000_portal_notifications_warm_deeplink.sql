-- =============================================================================
-- Notificações proativas — mensagens calorosas por fase + deep-link ao processo
--
-- Contexto: o pipeline de notificação já existia (trigger de status → insert em
-- portal_client_notifications → trigger de push → portal-push → web push), e
-- agora é alimentado AUTOMATICAMENTE pela inferência de fase
-- (trg_recompute_process_status). Esta migration eleva a QUALIDADE:
--   1. Mensagens específicas por fase, calorosas e claras.
--   2. NUNCA insinuam erro/atraso/negligência do advogado.
--   3. Deep-link: a notificação/push abre o PROCESSO específico (não tela genérica).
--
-- Dedupe (process_id:status) já previne spam de repetição — mantido.
-- =============================================================================

-- Mudança de fase do processo: copy por fase + rota de deep-link no metadata.
CREATE OR REPLACE FUNCTION public._trg_process_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;

  CASE NEW.status
    WHEN 'aguardando_confeccao' THEN
      v_title := '📝 Preparando o seu processo';
      v_body  := 'Seu advogado está preparando os documentos para dar entrada no seu processo.';
    WHEN 'distribuido' THEN
      v_title := '✅ Seu processo foi protocolado';
      v_body  := 'Seu processo já está tramitando na Justiça. Seu advogado acompanha cada etapa.';
    WHEN 'citacao' THEN
      v_title := '📬 A outra parte foi notificada';
      v_body  := 'A parte contrária está sendo oficialmente notificada sobre o seu processo.';
    WHEN 'conciliacao' THEN
      v_title := '🤝 Audiência de conciliação';
      v_body  := 'Foi marcada uma tentativa de acordo no seu processo. Seu advogado vai te orientar.';
    WHEN 'contestacao' THEN
      v_title := '📄 Defesa apresentada pela outra parte';
      v_body  := 'A parte contrária apresentou defesa. Seu advogado já vai se manifestar.';
    WHEN 'instrucao' THEN
      v_title := '🔎 Fase de produção de provas';
      v_body  := 'Seu processo entrou na fase de provas (documentos, testemunhas, perícias).';
    WHEN 'sentenca' THEN
      v_title := '⚖️ Saiu a decisão do seu processo!';
      v_body  := 'O juiz proferiu uma decisão no seu processo. Toque para ver os detalhes.';
    WHEN 'recurso' THEN
      v_title := '📈 Recurso em análise';
      v_body  := 'Seu processo está sendo reavaliado por um tribunal superior.';
    WHEN 'cumprimento' THEN
      v_title := '💰 Fase de recebimento iniciada';
      v_body  := 'Seu processo entrou na fase final, de recebimento dos valores. Seu advogado conduz a execução.';
    WHEN 'andamento' THEN
      v_title := '📌 Atualização no seu processo';
      v_body  := 'Houve uma movimentação no seu processo. Seu advogado acompanha de perto.';
    WHEN 'arquivado' THEN
      v_title := '📁 Processo concluído';
      v_body  := 'Seu processo foi finalizado e arquivado. Em caso de dúvida, fale com seu advogado.';
    ELSE
      v_title := '📌 Atualização no seu processo';
      v_body  := 'Houve uma atualização no seu processo. Seu advogado acompanha cada etapa.';
  END CASE;

  PERFORM public._portal_notify_client(
    NEW.client_id, 'process_status_changed',
    v_title, v_body,
    jsonb_build_object(
      'process_id',   NEW.id,
      'process_code', NEW.process_code,
      'status',       NEW.status,
      'portal_route', 'casos',
      'portal_param', NEW.id,
      'url',          '/portal#/portal/casos/' || NEW.id::text
    )
  );
  RETURN NEW;
END;
$func$;

-- Push: encaminha rota de deep-link (portal_route/portal_param/url) à edge function.
CREATE OR REPLACE FUNCTION public._portal_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_portal_user_id uuid;
  v_title          text;
  v_body           text;
  v_url            text;
  v_route          text;
  v_param          text;
  v_supabase_url   text := 'https://uajwkqipbyxzvwjpitxl.supabase.co';
  v_anon_key       text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
BEGIN
  SELECT id INTO v_portal_user_id FROM public.client_portal_users WHERE client_id = NEW.client_id LIMIT 1;
  IF v_portal_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_push_subscriptions WHERE portal_user_id = v_portal_user_id) THEN RETURN NEW; END IF;

  v_title := COALESCE(NEW.title, 'Atualização do seu processo');
  v_body  := COALESCE(NEW.message, '');
  v_route := NEW.metadata->>'portal_route';
  v_param := NEW.metadata->>'portal_param';
  v_url   := COALESCE(NEW.metadata->>'url', '/portal#/portal/notificacoes');

  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/portal-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon_key),
    body    := jsonb_build_object(
      'portal_user_id', v_portal_user_id,
      'title', v_title,
      'body',  v_body,
      'url',   v_url,
      'portalRoute', v_route,
      'portalParam', v_param
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END; $func$;
