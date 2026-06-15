-- ============================================================
-- Módulo WhatsApp — Fase 0.2: Bloqueio de contato
--   Estado de bloqueio na conversa + log de auditoria de cada
--   ação de bloquear/desbloquear (quem, quando, motivo).
-- ============================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS is_blocked     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

-- Conversas bloqueadas saem da fila normal: índice parcial só do que está ativo.
CREATE INDEX IF NOT EXISTS idx_wa_conv_active
  ON public.whatsapp_conversations (last_message_at DESC NULLS LAST)
  WHERE is_blocked = false;

-- ── Auditoria de bloqueio/desbloqueio ──
CREATE TABLE IF NOT EXISTS public.whatsapp_contact_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  contact_phone   text,
  action          text NOT NULL,            -- 'block' | 'unblock'
  reason          text,
  performed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_blocks_conv
  ON public.whatsapp_contact_blocks (conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_contact_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_blocks_staff ON public.whatsapp_contact_blocks;
CREATE POLICY wa_blocks_staff ON public.whatsapp_contact_blocks FOR ALL TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
