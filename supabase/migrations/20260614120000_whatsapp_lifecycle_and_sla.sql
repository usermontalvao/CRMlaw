-- ============================================================
-- WhatsApp — Fase 3 (ciclo de vida) + Fase 4 (SLA)
--   Encerramento com motivo/autor; reabertura automática quando o
--   cliente volta a falar; timestamps para medir tempo parado/SLA.
-- ============================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS closed_at                timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closure_reason           text,
  ADD COLUMN IF NOT EXISTS reopened_at              timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at        timestamptz,
  ADD COLUMN IF NOT EXISTS last_customer_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_agent_message_at    timestamptz;

-- Trigger de resumo da conversa, agora com SLA + reabertura automática.
CREATE OR REPLACE FUNCTION public.wa_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_preview text;
BEGIN
  v_preview := CASE
    WHEN NEW.type = 'text' THEN left(coalesce(NEW.content, ''), 200)
    WHEN NEW.type = 'image' THEN '📷 Imagem'
    WHEN NEW.type = 'audio' THEN '🎤 Áudio'
    WHEN NEW.type = 'video' THEN '🎬 Vídeo'
    WHEN NEW.type = 'document' THEN '📎 Documento'
    ELSE left(coalesce(NEW.content, ''), 200)
  END;

  UPDATE public.whatsapp_conversations c
     SET last_message_at          = NEW.wa_timestamp,
         last_message_preview     = v_preview,
         last_message_direction   = NEW.direction,
         unread_count             = CASE WHEN NEW.direction = 'in'
                                         THEN c.unread_count + 1 ELSE c.unread_count END,
         last_customer_message_at = CASE WHEN NEW.direction = 'in'
                                         THEN NEW.wa_timestamp ELSE c.last_customer_message_at END,
         last_agent_message_at    = CASE WHEN NEW.direction = 'out'
                                         THEN NEW.wa_timestamp ELSE c.last_agent_message_at END,
         -- 1ª resposta do agente após o cliente ter falado.
         first_response_at        = CASE WHEN NEW.direction = 'out'
                                          AND c.first_response_at IS NULL
                                          AND c.last_customer_message_at IS NOT NULL
                                         THEN NEW.wa_timestamp ELSE c.first_response_at END,
         -- Reabertura automática: cliente volta a falar numa conversa encerrada.
         status                   = CASE WHEN NEW.direction = 'in' AND c.status = 'closed'
                                         THEN 'open' ELSE c.status END,
         reopened_at              = CASE WHEN NEW.direction = 'in' AND c.status = 'closed'
                                         THEN now() ELSE c.reopened_at END,
         updated_at               = now()
   WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;
