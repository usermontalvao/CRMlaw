-- Distingue, na fila de mensagens agendadas, o que foi agendado PELO USUÁRIO do
-- que ficou RETIDO automaticamente aguardando a reconexão do canal. Sem isto a UI
-- mostrava ambos como "Agendada", confundindo o atendente.
--   hold_reason = NULL        → agendamento normal escolhido pelo usuário
--   hold_reason = 'reconnect' → retida automaticamente (canal desconectado/reconectando)
ALTER TABLE public.whatsapp_scheduled_messages
  ADD COLUMN IF NOT EXISTS hold_reason TEXT;

COMMENT ON COLUMN public.whatsapp_scheduled_messages.hold_reason IS
  'Origem da retenção: NULL = agendada pelo usuário; ''reconnect'' = retida aguardando reconexão automática do canal.';
