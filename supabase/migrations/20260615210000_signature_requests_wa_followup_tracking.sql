-- Follow-up automático de assinatura DIRETA (sem kit): contador + carimbo do
-- último lembrete enviado no WhatsApp. O follow-up anterior só cobria
-- template_fill_links; assinaturas diretas ficavam sem nenhum lembrete.
-- Consumido pela edge function whatsapp-signature-followup (cron */5).
ALTER TABLE public.signature_requests
  ADD COLUMN IF NOT EXISTS wa_followup_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wa_followup_last_at timestamptz;

COMMENT ON COLUMN public.signature_requests.wa_followup_count IS
  'Quantos lembretes de assinatura pendente ja foram enviados no WhatsApp.';
COMMENT ON COLUMN public.signature_requests.wa_followup_last_at IS
  'Quando o ultimo lembrete de assinatura pendente foi enviado no WhatsApp.';
