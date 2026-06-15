-- ============================================================
-- WhatsApp — Fase 7: NOTAS INTERNAS da conversa
--   Observações da equipe, separadas da visão do cliente (nunca vão pro
--   WhatsApp). Visibilidade segue a da conversa-pai (Fase 5): só quem
--   enxerga a conversa lê as notas. Autor (ou supervisor) pode apagar.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_internal_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  author_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_notes_conv ON public.whatsapp_internal_notes (conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_internal_notes ENABLE ROW LEVEL SECURITY;

-- Leitura: quem enxerga a conversa-pai (reaproveita a regra da Fase 5).
DROP POLICY IF EXISTS wa_note_select ON public.whatsapp_internal_notes;
CREATE POLICY wa_note_select ON public.whatsapp_internal_notes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
    WHERE c.id = conversation_id
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
  ));

-- Escrita: staff cria notas em próprio nome.
DROP POLICY IF EXISTS wa_note_insert ON public.whatsapp_internal_notes;
CREATE POLICY wa_note_insert ON public.whatsapp_internal_notes FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff() AND author_id = auth.uid());

-- Edição/remoção: o autor, ou um supervisor.
DROP POLICY IF EXISTS wa_note_update ON public.whatsapp_internal_notes;
CREATE POLICY wa_note_update ON public.whatsapp_internal_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.wa_is_supervisor())
  WITH CHECK (author_id = auth.uid() OR public.wa_is_supervisor());
DROP POLICY IF EXISTS wa_note_delete ON public.whatsapp_internal_notes;
CREATE POLICY wa_note_delete ON public.whatsapp_internal_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.wa_is_supervisor());

-- Realtime: notas aparecem ao vivo para a equipe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_internal_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_internal_notes;
  END IF;
END $$;
