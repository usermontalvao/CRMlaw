-- ============================================================================
-- Portal Chat — notificação ao cliente quando o escritório responde no ticket
-- ============================================================================

CREATE OR REPLACE FUNCTION public._portal_notify_on_chat_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_sender_name text;
  v_preview text;
BEGIN
  IF COALESCE(NEW.is_system, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.portal_client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT portal_client_id
    INTO v_client_id
    FROM public.chat_rooms
   WHERE id = NEW.room_id
     AND type = 'portal_client'
   LIMIT 1;

  IF v_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, 'Escritório Jurídico')
    INTO v_sender_name
    FROM public.profiles
   WHERE user_id = NEW.user_id
   LIMIT 1;

  v_preview := btrim(COALESCE(NEW.content, ''));
  IF v_preview = '' THEN
    RETURN NEW;
  END IF;

  IF v_preview LIKE '__anexo__:%' THEN
    v_preview := 'Você recebeu um anexo no chat.';
  ELSE
    v_preview := left(v_preview, 140);
  END IF;

  PERFORM public._portal_notify_client(
    v_client_id,
    'chat_reply',
    COALESCE(v_sender_name, 'Escritório Jurídico') || ' respondeu no chat',
    v_preview,
    jsonb_build_object(
      'room_id', NEW.room_id,
      'message_id', NEW.id,
      'source', 'portal_chat'
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_notify_on_chat_reply ON public.chat_messages;
CREATE TRIGGER trg_portal_notify_on_chat_reply
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public._portal_notify_on_chat_reply();
