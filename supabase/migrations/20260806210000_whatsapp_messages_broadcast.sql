-- Passo 1 de 2: broadcast para as mensagens do WhatsApp.
--
-- Motivo: `whatsapp_messages` está na publicação do Realtime sem filtro nenhum.
-- Cada mensagem do escritório é decodificada LINHA INTEIRA pelo walrus e enviada
-- para TODA aba aberta do CRM — inclusive a coluna `raw` (1,2 kB em texto, 3,5 kB
-- em mídia) e a `transcription_text`. E são DOIS canais consumindo isso hoje: o
-- do módulo (`whatsapp-realtime`) e o do notificador (`whatsapp-notify-msg`),
-- então a linha é decodificada e trafegada duas vezes por aba.
--
-- O que o cliente realmente usa do payload são seis campos: id, conversation_id,
-- direction, type, status e content (só para o texto do aviso). Tudo o mais vem
-- por HTTP no `refreshMessages`. É isso — e só isso — que o broadcast manda.
--
-- Esta migration NÃO tira a tabela da publicação: enquanto o cliente antigo
-- estiver no ar, os dois caminhos convivem. A despublicação é o passo 2, depois
-- do deploy do front — mesmo roteiro de 20260805223000_broadcast_email_and_petitions.

-- ---------------------------------------------------------------------------
-- Leitura do canal privado
-- ---------------------------------------------------------------------------
-- `realtime.messages` tem RLS ligado; sem policy o canal privado é recusado.
-- Tópico único do escritório, espelhando o alcance que o postgres_changes tinha
-- (a assinatura antiga não tinha filtro: todo mundo recebia tudo).

DROP POLICY IF EXISTS "broadcast de mensagens do whatsapp" ON realtime.messages;
CREATE POLICY "broadcast de mensagens do whatsapp"
  ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND topic = 'whatsapp:messages');

-- ---------------------------------------------------------------------------
-- O aviso
-- ---------------------------------------------------------------------------
-- POR LINHA, e não por comando: ao contrário de e-mail e petições, aqui o
-- payload é usado de verdade (a thread mescla o status sem ir ao servidor, e o
-- notificador decide o toque a partir de `direction`). Um aviso por comando
-- perderia de qual mensagem se está falando.
--
-- `content` entra cortado em 200 caracteres: o preview do notificador usa 120, e
-- o texto de verdade a tela pega no `refreshMessages`. É o teto que impede uma
-- mensagem longa de reintroduzir pelo broadcast o peso que saiu do postgres_changes.

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

  -- Mensagem nova sempre manda reler. No UPDATE, só o que mexeu em algo ALÉM do
  -- status: transcrição que ficou pronta, mensagem editada, mídia que terminou
  -- de subir. Mudança só de status (sent → delivered → read) o cliente mescla
  -- na hora, sem ida ao servidor — é o caso de longe mais frequente.
  IF TG_OP = 'INSERT' THEN
    precisa_reler := true;
  ELSE
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
  END IF;

  payload := jsonb_build_object(
    'op',              TG_OP,
    'id',              NEW.id,
    'conversation_id', NEW.conversation_id,
    'direction',       NEW.direction,
    'type',            NEW.type,
    'status',          NEW.status,
    'content',         left(coalesce(NEW.content, ''), 200),
    'refresh',         precisa_reler
  );

  PERFORM realtime.send(payload, 'changed', 'whatsapp:messages', true);
  RETURN NULL;
END;
$function$;

-- INSERT e DELETE sempre avisam.
DROP TRIGGER IF EXISTS trg_whatsapp_messages_broadcast ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_broadcast
  AFTER INSERT OR DELETE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_whatsapp_message_changed();

-- UPDATE só avisa se mexeu em coluna que a tela mostra.
--
-- `raw` está DE FORA da lista de propósito: é o que permite reescrever a coluna
-- (a limpeza dos 36 MB de base64 já gravados) sem acordar aba nenhuma.
DROP TRIGGER IF EXISTS trg_whatsapp_messages_broadcast_update ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_broadcast_update
  AFTER UPDATE ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (
       OLD.status               IS DISTINCT FROM NEW.status
    OR OLD.content              IS DISTINCT FROM NEW.content
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
    OR OLD.doc_intake_status    IS DISTINCT FROM NEW.doc_intake_status
  )
  EXECUTE FUNCTION public.broadcast_whatsapp_message_changed();
