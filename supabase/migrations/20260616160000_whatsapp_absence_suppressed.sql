-- Pausa por conversa da mensagem automática de ausência (fora do horário comercial).
-- Pensado para um atendimento que segue fora do horário: o atendente pausa o aviso
-- comercial só nesta conversa; ao encerrar o atendimento, o flag é zerado e a
-- limitação volta sozinha no próximo contato (lógica no app/edge function).
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS absence_suppressed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_conversations.absence_suppressed IS
  'Quando true, o evolution-webhook não envia a auto-mensagem de ausência (fora do horário) para esta conversa. Zerado ao encerrar o atendimento.';
