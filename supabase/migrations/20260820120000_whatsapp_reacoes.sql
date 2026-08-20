-- ============================================================
-- Reações de mensagem no WhatsApp
--
-- A reação é a única coisa na conversa que NÃO é uma mensagem: ela não ocupa
-- lugar na linha do tempo, não muda a prévia da inbox e não conta como não
-- lida — ela gruda numa mensagem que já está lá. Guardá-la numa tabela própria
-- custaria uma consulta a mais por thread aberta e uma linha a mais na
-- publicação do realtime (onde o custo é catálogo, não escrita). Por isso:
-- coluna `jsonb` na própria mensagem, lida junto com ela e apagada junto com
-- ela.
--
-- Formato de cada item (a regra mora em `utils/waReactions.ts` e no espelho
-- `_shared/wa-reactions.ts`):
--   { "emoji": "👍", "from": "in"|"out", "actor": "<jid|uuid>",
--     "name": "Ana"|null, "at": "2026-08-20T12:00:00.000Z" }
--
-- `actor` é quem reagiu — o JID do contato ou o id do usuário do CRM. É por ele
-- que vale a regra do aplicativo: UMA reação por pessoa por mensagem, e reagir
-- de novo troca (ou desfaz) a anterior.
-- ============================================================

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.whatsapp_messages.reactions IS
  'Reações à mensagem (contato e equipe). Uma por actor; ver utils/waReactions.ts.';

-- ── O broadcast precisa contar que a reação mudou ──
-- `broadcast_whatsapp_message_changed` decide, coluna por coluna, se um UPDATE
-- obriga a thread aberta a se reler por HTTP. Sem `reactions` na lista, a
-- reação apareceria só para quem reagiu: a colega com a mesma conversa aberta
-- continuaria vendo a bolha sem pastilha, e a reação DO CONTATO (que chega pelo
-- webhook, sem ninguém clicando em nada aqui) só apareceria quando alguém
-- saísse da conversa e voltasse.
--
-- O corpo é o mesmo de `20260808170000_whatsapp_broadcast_deleted.sql`, com UMA
-- linha nova. Ele é reescrito inteiro porque não há como acrescentar uma
-- condição a uma função sem redeclará-la — e as propriedades da original
-- (INVOKER, não DEFINER; search_path 'public', 'pg_catalog') são repetidas
-- exatamente para o CREATE OR REPLACE não mudar em silêncio quem a função é ao
-- ser executada.
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
      OR OLD.reactions            IS DISTINCT FROM NEW.reactions
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
