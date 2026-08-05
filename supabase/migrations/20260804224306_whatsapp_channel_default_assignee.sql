-- Responsável inicial por canal. A atribuição acontece antes dos gatilhos de
-- resumo e push, para que a própria primeira mensagem já gere o aviso.

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS default_assignee_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_instances'::regclass
      AND conname = 'whatsapp_instances_default_assignee_id_fkey'
  ) THEN
    ALTER TABLE public.whatsapp_instances
      ADD CONSTRAINT whatsapp_instances_default_assignee_id_fkey
      FOREIGN KEY (default_assignee_id)
      REFERENCES public.profiles(user_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.whatsapp_instances.default_assignee_id IS
  'Usuário atribuído a mensagens de entrada quando a conversa ainda não possui responsável.';

CREATE OR REPLACE FUNCTION public.wa_assign_channel_default_assignee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.direction <> 'in' THEN
    RETURN NEW;
  END IF;

  UPDATE public.whatsapp_conversations AS conversation
     SET assigned_user_id = channel.default_assignee_id,
         updated_at = now()
    FROM public.whatsapp_instances AS channel
    JOIN public.profiles AS staff
      ON staff.user_id = channel.default_assignee_id
     AND staff.is_active IS TRUE
   WHERE conversation.id = NEW.conversation_id
     AND channel.id = conversation.instance_id
     AND conversation.assigned_user_id IS NULL
     AND conversation.status IN ('open', 'pending')
     AND COALESCE(conversation.is_blocked, FALSE) IS FALSE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wa_assign_channel_default_assignee_before_message
  ON public.whatsapp_messages;

CREATE TRIGGER wa_assign_channel_default_assignee_before_message
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.wa_assign_channel_default_assignee();
