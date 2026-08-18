-- Documento que chegou ANTES do pedido: a solicitação nascer é o que manda reler.
--
-- 18/08/2026, conversa 00696f63 (Hiago Oliveira). Às 15:38:11 o cliente mandou a
-- reclamação do Procon em PDF; às 15:38:52 o advogado montou o checklist de
-- quatro itens, um deles "Reclamação procon". O arquivo estava lá, o item ficou
-- zerado — a triagem só olha para frente, e ninguém volta para conferir o que a
-- pessoa já tinha mandado.
--
-- Este gatilho fecha esse buraco na origem: quem cria a solicitação não precisa
-- lembrar de nada, e não importa por onde ela nasceu (modal do WhatsApp, ação da
-- IA, ficha do cliente, portal). Ao entrar item novo, a `whatsapp-doc-intake`
-- recebe o cliente e relê a conversa recente dele atrás do que já foi enviado.
--
-- É por ITEM, e não por `document_requests`, porque os itens entram DEPOIS da
-- solicitação, em outro INSERT: disparar na solicitação chegaria à função antes
-- de existir lista para comparar.
--
-- FOR EACH STATEMENT: os quatro itens de um checklist entram num INSERT só, e
-- uma varredura por checklist é o suficiente — quatro seriam quatro releituras
-- do mesmo acervo, cada uma cobrando visão de novo.

CREATE OR REPLACE FUNCTION public._wa_doc_intake_on_new_request_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_url    text := 'https://uajwkqipbyxzvwjpitxl.functions.supabase.co/whatsapp-doc-intake?token=wa-doc-intake-2026';
  v_client uuid;
BEGIN
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
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('client_id', v_client)
    );
  END LOOP;
  RETURN NULL;
END;
$func$;

DROP TRIGGER IF EXISTS trg_wa_doc_intake_on_new_request_items ON public.document_request_items;
CREATE TRIGGER trg_wa_doc_intake_on_new_request_items
AFTER INSERT ON public.document_request_items
REFERENCING NEW TABLE AS novos
FOR EACH STATEMENT EXECUTE FUNCTION public._wa_doc_intake_on_new_request_items();
