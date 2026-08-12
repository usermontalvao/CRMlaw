-- Marco zero do contexto do agente de IA.
--
-- Limpar a memória (resumo, fatos, pendências) não recomeça a conversa: o
-- agente também lê as últimas mensagens do WhatsApp, e elas continuam lá. Sem
-- um corte, o "/clear" apagaria o caderno e deixaria a conversa inteira à
-- vista — o agente continuaria sabendo o nome, o assunto e o que já perguntou.
--
-- `history_from` é esse corte: o turno só enxerga mensagens a partir dele.
-- NULL = conversa inteira, que é o comportamento de sempre.

alter table public.whatsapp_ai_sessions
  add column if not exists history_from timestamptz;

comment on column public.whatsapp_ai_sessions.history_from is
  'Marco zero do contexto: o agente ignora mensagens anteriores a esta data. Gravado pelo comando /clear. NULL = lê a conversa toda.';
