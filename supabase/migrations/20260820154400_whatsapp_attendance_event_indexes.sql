-- Índices de apoio às chaves estrangeiras da trilha de auditoria do atendimento.
CREATE INDEX IF NOT EXISTS idx_wa_attendance_events_primary_conversation
  ON public.whatsapp_attendance_events (primary_conversation_id);

CREATE INDEX IF NOT EXISTS idx_wa_attendance_events_actor
  ON public.whatsapp_attendance_events (actor_id);
