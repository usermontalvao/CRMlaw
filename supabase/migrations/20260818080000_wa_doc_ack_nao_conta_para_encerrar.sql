-- "Recebemos os seus arquivos": aviso automático não é resposta do escritório.
--
-- O relógio do encerramento por inatividade (`wa_auto_close_idle_since`) só
-- começa a correr quando a ÚLTIMA mensagem da conversa é NOSSA — é assim que o
-- painel deixa de esconder o caso que ninguém atendeu. O aviso de ausência e o
-- prompt de reabertura já eram exceção pelo mesmo motivo: são o robô falando,
-- não o escritório atendendo.
--
-- O aviso de chegada de documentos entra na mesma lista. Sem isto, o cliente
-- manda cinco arquivos, o sistema responde "recebemos, vamos analisar" e essa
-- resposta automática passa a valer como atendimento: 4 horas depois a conversa
-- é encerrada sozinha com o documento por analisar.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS document_ack_sent_at timestamptz;

COMMENT ON COLUMN public.whatsapp_conversations.document_ack_sent_at IS
  'Quando o aviso automático de "recebemos os seus arquivos" saiu. Serve para não repetir o aviso na mesma rajada e para excluí-lo da conta do encerramento por inatividade.';

CREATE OR REPLACE FUNCTION public.wa_auto_close_idle_since(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT id, absence_sent_at, reopen_prompt_sent_at, document_ack_sent_at
      FROM whatsapp_conversations
     WHERE id = p_conversation_id
  ),
  nossa AS (
    SELECT max(m.wa_timestamp) AS ts
      FROM whatsapp_messages m
      JOIN c ON c.id = m.conversation_id
     WHERE m.direction = 'out'
       AND m.deleted_at IS NULL
       AND NOT (c.absence_sent_at IS NOT NULL
                AND m.wa_timestamp >= c.absence_sent_at - interval '5 seconds'
                AND m.wa_timestamp <= c.absence_sent_at + interval '60 seconds')
       AND NOT (c.reopen_prompt_sent_at IS NOT NULL
                AND m.wa_timestamp >= c.reopen_prompt_sent_at - interval '5 seconds'
                AND m.wa_timestamp <= c.reopen_prompt_sent_at + interval '60 seconds')
       AND NOT (c.document_ack_sent_at IS NOT NULL
                AND m.wa_timestamp >= c.document_ack_sent_at - interval '60 seconds'
                AND m.wa_timestamp <= c.document_ack_sent_at + interval '60 seconds')
  ),
  dele AS (
    SELECT max(m.wa_timestamp) AS ts
      FROM whatsapp_messages m
      JOIN c ON c.id = m.conversation_id
     WHERE m.direction = 'in'
       AND m.deleted_at IS NULL
  )
  SELECT nossa.ts
    FROM nossa, dele
   WHERE nossa.ts IS NOT NULL
     AND (dele.ts IS NULL OR dele.ts <= nossa.ts);
$function$;
