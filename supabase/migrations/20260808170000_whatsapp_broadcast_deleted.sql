-- ============================================================
-- Broadcast de mensagem: apagar tem de acordar as outras abas
--
-- `broadcast_whatsapp_message_changed` decide, coluna por coluna, se um UPDATE
-- obriga a thread aberta a se reler por HTTP (`refresh`). A lista não conhecia
-- `deleted_at` — e ela não existia quando a função foi escrita.
--
-- Sem esta linha, apagar uma mensagem só aparecia para quem apagou: a colega com
-- a mesma conversa aberta continuaria vendo o áudio, e o "apagada" do contato
-- (revoke pelo webhook) só apareceria quando alguém saísse da conversa e
-- voltasse. Justamente o caso em que "sumiu da tela" precisa valer para todos ao
-- mesmo tempo — é o motivo de a pessoa ter apagado.
--
-- `deleted_scope` fica FORA da lista de propósito: ele nunca muda sozinho, muda
-- sempre junto com `deleted_at`, e incluí-lo só duplicaria a condição.
--
-- O corpo é o mesmo de antes, com UMA linha nova. Ele é reescrito inteiro porque
-- não há como acrescentar uma condição a uma função sem redeclará-la — e as
-- propriedades da original (INVOKER, não DEFINER; search_path 'public',
-- 'pg_catalog') são repetidas exatamente para o CREATE OR REPLACE não mudar em
-- silêncio quem a função é ao ser executada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.broadcast_whatsapp_message_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  payload jsonb;
  precisa_reler boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM realtime.send(
      jsonb_build_object('op', 'DELETE', 'id', OLD.id, 'conversation_id', OLD.conversation_id),
      'changed',
      'whatsapp:messages',
      true
    );
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
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
    precisa_reler :=
         OLD.content              IS DISTINCT FROM NEW.content
      OR OLD.edited_at            IS DISTINCT FROM NEW.edited_at
      OR OLD.deleted_at           IS DISTINCT FROM NEW.deleted_at
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
$$;
