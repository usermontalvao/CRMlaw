-- ============================================================
-- Módulo WhatsApp — Fase 5: associação de usuários a CANAIS
--   Canal = whatsapp_instances (um número/conexão Evolution).
--   Espelha whatsapp_department_members. Sem membros = canal "aberto"
--   (visível a todo staff) — a regra de visibilidade (migration seguinte)
--   só recorta quando há ao menos um membro definido.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_channel_members (
  channel_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_channel_member_user ON public.whatsapp_channel_members (user_id);

ALTER TABLE public.whatsapp_channel_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_channel_member_staff ON public.whatsapp_channel_members;
CREATE POLICY wa_channel_member_staff ON public.whatsapp_channel_members FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
