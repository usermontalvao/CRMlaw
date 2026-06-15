-- P1.3: Colunas da Fase O (aprovação humana de IA) ausentes na migration original.
-- A migration 20260614230000_whatsapp_ai_flow.sql criou as tabelas sem esses campos;
-- as edge functions e UI os exigem. Esta migration adiciona o que faltava.

-- require_human_approval: quando true, IA aguarda aprovação antes de enviar
ALTER TABLE public.whatsapp_ai_channel_config
  ADD COLUMN IF NOT EXISTS require_human_approval BOOLEAN NOT NULL DEFAULT false;

-- Campos de fila de aprovação: texto pendente e próximo step após aprovação
ALTER TABLE public.whatsapp_ai_sessions
  ADD COLUMN IF NOT EXISTS pending_ai_reply TEXT,
  ADD COLUMN IF NOT EXISTS pending_ai_next_step INT;

-- Amplia CHECK de status para incluir 'pending_approval'
ALTER TABLE public.whatsapp_ai_sessions
  DROP CONSTRAINT IF EXISTS whatsapp_ai_sessions_status_check;

ALTER TABLE public.whatsapp_ai_sessions
  ADD CONSTRAINT whatsapp_ai_sessions_status_check
  CHECK (status IN ('active', 'completed', 'handed_off', 'aborted', 'pending_approval'));

-- Índice para polling eficiente de sessões aguardando aprovação
CREATE INDEX IF NOT EXISTS idx_wa_ai_sessions_pending
  ON public.whatsapp_ai_sessions (conversation_id)
  WHERE status = 'pending_approval';
