-- ============================================================================
-- O gatilho da triagem documental também carregava o token na URL.
--
-- `_wa_doc_intake_on_new_request_items` dispara a releitura da conversa quando
-- nasce uma solicitação de documento, e chamava a Edge Function com
-- `?token=<literal>` — o mesmo segredo do repositório que a migration
-- 20260821250000 aposentou, e no mesmo lugar errado (a linha de endereço, que
-- vai para log de acesso e histórico).
--
-- Passa a ler o segredo de `private.app_secrets` na hora da chamada e a mandá-lo
-- no header, exatamente como o cron. Se o segredo sumir, o gatilho AVISA e não
-- dispara — em vez de chamar e tomar 401 em silêncio, que é o modo de falha que
-- fez o weekly-digest passar seis semanas quebrado (ver a memória do projeto).
-- ============================================================================
CREATE OR REPLACE FUNCTION public._wa_doc_intake_on_new_request_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_url    text := 'https://uajwkqipbyxzvwjpitxl.functions.supabase.co/whatsapp-doc-intake';
  v_token  text;
  v_client uuid;
BEGIN
  SELECT value INTO v_token FROM private.app_secrets WHERE key = 'wa_doc_intake_token';
  IF v_token IS NULL THEN
    RAISE WARNING '[wa-doc-intake] segredo da rotina ausente; varredura não disparada';
    RETURN NULL;
  END IF;

  -- Um disparo por CLIENTE tocado, e só para cliente que tem conversa de
  -- WhatsApp: sem conversa não há acervo para varrer, e a chamada seria vazia.
  FOR v_client IN
    SELECT DISTINCT r.client_id
      FROM novos n
      JOIN public.document_requests r ON r.id = n.request_id
     WHERE r.client_id IS NOT NULL
       AND r.status IN ('pending', 'partial')
       AND EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.client_id = r.client_id)
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-job-token', v_token),
      body    := jsonb_build_object('client_id', v_client)
    );
  END LOOP;
  RETURN NULL;
END;
$function$;
