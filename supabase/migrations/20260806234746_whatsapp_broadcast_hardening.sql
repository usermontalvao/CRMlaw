-- Correção do broadcast de mensagens do WhatsApp: quem pode ouvir, e o que trafega.
--
-- Corretiva de 20260806210000_whatsapp_messages_broadcast.sql (aplicada; ver
-- supabase/migrations/README.md para o mapa de versões). Aquela migration segue
-- intacta — o que muda vem por CREATE OR REPLACE / DROP POLICY aqui, sem editar
-- arquivo já aplicado e sem duplicar gatilho.
--
-- Duas frentes:
--
--  1. A policy aceitava QUALQUER papel `authenticated`. O Portal do Cliente
--     autentica no mesmo projeto Supabase, então "authenticated" inclui cliente.
--     Ele não tem linha em `public.profiles` (verificado: 0 de 7 usuários do
--     portal têm perfil), mas depender disso sem dizer no SQL é frágil: bastaria
--     alguém passar a criar perfil para o portal e a caixa do escritório inteira
--     ficaria audível. A regra passa a estar escrita.
--
--  2. O payload levava `content` (200 caracteres) em TODO evento. No UPDATE
--     ninguém lê: `useWaRealtime` usa só `status` + `refresh`, e o notificador
--     descarta o que não for INSERT. Texto de mensagem trafegando para toda aba
--     aberta a cada `sent → delivered → read` é exposição sem consumidor.

-- ---------------------------------------------------------------------------
-- Quem pode ouvir o tópico
-- ---------------------------------------------------------------------------
-- Função própria em vez de `is_office_staff()`: aquela responde só "existe
-- perfil?" e ignora `is_active`, então atendente desligado continuaria ouvindo a
-- caixa toda enquanto o JWT não expirasse. Mexer nela seria mexer em dezenas de
-- policies de outros módulos — fora do escopo desta correção.
--
-- SECURITY DEFINER não é atalho para furar RLS: é obrigatório aqui. A policy é
-- avaliada pelo papel `authenticated` dentro do schema `realtime`, e a leitura de
-- `public.profiles` está ela mesma sob RLS (`Authenticated can read profiles`
-- USING is_office_staff()) — sem DEFINER a checagem se auto-referenciaria. É o
-- mesmo desenho já usado por `is_office_staff()` e `wa_is_supervisor()`.
--
-- STABLE, e não VOLATILE: o Realtime reavalia a policy a cada join do canal, e
-- dentro de uma mesma avaliação o resultado não pode mudar.

CREATE OR REPLACE FUNCTION public.wa_can_read_message_broadcast()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND p.is_active IS TRUE
  );
$function$;

COMMENT ON FUNCTION public.wa_can_read_message_broadcast() IS
  'Equipe interna ATIVA. Gate do tópico broadcast whatsapp:messages — mais estrita '
  'que is_office_staff(), que ignora is_active.';

-- `anon` nunca precisa: o tópico é privado e a policy é TO authenticated.
REVOKE ALL ON FUNCTION public.wa_can_read_message_broadcast() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wa_can_read_message_broadcast() TO authenticated, service_role;

DROP POLICY IF EXISTS "broadcast de mensagens do whatsapp" ON realtime.messages;
CREATE POLICY "broadcast de mensagens do whatsapp"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND topic = 'whatsapp:messages'
    AND public.wa_can_read_message_broadcast()
  );

-- ---------------------------------------------------------------------------
-- O aviso, sem o texto que ninguém lê
-- ---------------------------------------------------------------------------
-- Só o INSERT carrega `content`/`direction`/`type`, e só porque o notificador
-- realmente os usa: `direction` filtra ('in'), e `previewOf` monta o preview com
-- `content` — cortado em 120, que é exatamente o que ele exibe (era 200; os 80
-- extras nunca chegaram à tela).
--
-- O UPDATE fica com o mínimo: `status` para o merge no lugar e `refresh` para a
-- releitura. Ver src/components/whatsapp/hooks/useWaRealtime.ts e
-- src/hooks/useWhatsAppNotifications.ts — são os dois únicos consumidores.
--
-- `raw` continua fora da lista de `precisa_reler` de propósito: é o que permite
-- reescrever a coluna sem acordar aba nenhuma.

CREATE OR REPLACE FUNCTION public.broadcast_whatsapp_message_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  payload jsonb;
  precisa_reler boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Só a chave: é tudo que o cliente precisa para tirar a mensagem da thread.
    PERFORM realtime.send(
      jsonb_build_object('op', 'DELETE', 'id', OLD.id, 'conversation_id', OLD.conversation_id),
      'changed',
      'whatsapp:messages',
      true
    );
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Mensagem nova: a thread relê, e o notificador precisa do preview.
    payload := jsonb_build_object(
      'op',              'INSERT',
      'id',              NEW.id,
      'conversation_id', NEW.conversation_id,
      'direction',       NEW.direction,
      'type',            NEW.type,
      'status',          NEW.status,
      'content',         left(coalesce(NEW.content, ''), 120),
      'refresh',         true
    );
  ELSE
    -- No UPDATE, só o que mexeu em algo ALÉM do status manda reler: transcrição
    -- que ficou pronta, mensagem editada, mídia que terminou de subir. Mudança
    -- só de status (sent → delivered → read) o cliente mescla na hora — é o caso
    -- de longe mais frequente, e o texto novo (se houver) vem no `refreshMessages`.
    precisa_reler :=
         OLD.content              IS DISTINCT FROM NEW.content
      OR OLD.edited_at            IS DISTINCT FROM NEW.edited_at
      OR OLD.transcription_text   IS DISTINCT FROM NEW.transcription_text
      OR OLD.transcription_status IS DISTINCT FROM NEW.transcription_status
      OR OLD.storage_path         IS DISTINCT FROM NEW.storage_path
      OR OLD.media_url            IS DISTINCT FROM NEW.media_url
      OR OLD.media_mime           IS DISTINCT FROM NEW.media_mime
      OR OLD.media_size           IS DISTINCT FROM NEW.media_size
      OR OLD.file_name            IS DISTINCT FROM NEW.file_name
      OR OLD.is_animated          IS DISTINCT FROM NEW.is_animated
      OR OLD.reply_to_id          IS DISTINCT FROM NEW.reply_to_id
      OR OLD.doc_intake_status    IS DISTINCT FROM NEW.doc_intake_status;

    payload := jsonb_build_object(
      'op',              'UPDATE',
      'id',              NEW.id,
      'conversation_id', NEW.conversation_id,
      'status',          NEW.status,
      'refresh',         precisa_reler
    );
  END IF;

  PERFORM realtime.send(payload, 'changed', 'whatsapp:messages', true);
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- `wa_slim_raw` fora do alcance de quem não a chama
-- ---------------------------------------------------------------------------
-- Ela nasceu com EXECUTE para PUBLIC (padrão do CREATE FUNCTION). É pura e não
-- toca tabela, então não vaza dado — mas é recursiva sobre jsonb arbitrário, e um
-- `anon` podia queimar CPU do banco de graça. Quem a usa é `wa_purge_raw_blobs`,
-- que é SECURITY DEFINER de `postgres` e portanto não depende deste grant.
REVOKE ALL ON FUNCTION public.wa_slim_raw(jsonb, integer) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- Não destrutiva: nenhuma linha de mensagem é lida, escrita ou apagada. Para
-- voltar ao estado anterior, reaplique 20260806210000_whatsapp_messages_broadcast.sql
-- (repõe a policy aberta e o payload com content=200) e, se quiser o grant de volta:
--   GRANT EXECUTE ON FUNCTION public.wa_slim_raw(jsonb, integer) TO public;
--   DROP FUNCTION IF EXISTS public.wa_can_read_message_broadcast();
