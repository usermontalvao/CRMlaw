-- ============================================================
-- WhatsApp — Fase 8.1: MENSAGENS AGENDADAS
--   Envio programado (texto e mídia) por data/hora. Estados claros:
--   pending → sent | canceled | failed. Disparo por edge function
--   `whatsapp-scheduler` chamada por pg_cron a cada minuto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_scheduled_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  channel_id      uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  type            text NOT NULL DEFAULT 'text',  -- text | image | audio | video | document
  body            text,                          -- texto ou legenda
  storage_path    text,
  mime_type       text,
  file_name       text,
  scheduled_at    timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | sent | canceled | failed
  error           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_wa_sched_due ON public.whatsapp_scheduled_messages (scheduled_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wa_sched_conv ON public.whatsapp_scheduled_messages (conversation_id, scheduled_at);

ALTER TABLE public.whatsapp_scheduled_messages ENABLE ROW LEVEL SECURITY;

-- Leitura: quem enxerga a conversa-pai (Fase 5).
DROP POLICY IF EXISTS wa_sched_select ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_select ON public.whatsapp_scheduled_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
    WHERE c.id = conversation_id
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
  ));
-- Criação: staff agenda em próprio nome.
DROP POLICY IF EXISTS wa_sched_insert ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_insert ON public.whatsapp_scheduled_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff() AND created_by = auth.uid());
-- Edição/cancelamento: o autor ou supervisor, apenas enquanto pendente.
DROP POLICY IF EXISTS wa_sched_update ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_update ON public.whatsapp_scheduled_messages FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.wa_is_supervisor()))
  WITH CHECK ((created_by = auth.uid() OR public.wa_is_supervisor()));
DROP POLICY IF EXISTS wa_sched_delete ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_delete ON public.whatsapp_scheduled_messages FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.wa_is_supervisor());

-- Realtime: a equipe vê o estado mudar (pending→sent/failed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_scheduled_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_scheduled_messages;
  END IF;
END $$;
