-- ============================================================
-- WhatsApp — Fase 4 (item pendente): ACEITE de transferência
--   Ao transferir, a conversa entra em "aguardando aceite". O destino
--   (pessoa-alvo, ou qualquer membro do setor de destino) precisa aceitar
--   explicitamente. Enquanto não aceita, a operação vê alerta de tempo
--   parado — fecha o gargalo de transferência muda/sem continuidade.
--
--   A visibilidade (Fase 5) já libera o destino a ver a conversa via
--   exceção de transferência (whatsapp_transfers from/to = usuário).
-- ============================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS awaiting_accept        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_pending_since timestamptz;

ALTER TABLE public.whatsapp_transfers
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índice para resolver a transferência pendente mais recente de uma conversa.
CREATE INDEX IF NOT EXISTS idx_wa_transfers_pending
  ON public.whatsapp_transfers (conversation_id, created_at DESC)
  WHERE accepted_at IS NULL;
