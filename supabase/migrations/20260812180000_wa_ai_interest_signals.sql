-- ============================================================================
-- Sinais de interesse do cliente na sessão do Assistente de IA.
--
-- Duas colunas em `whatsapp_ai_sessions`, nada mais. Elas existem porque as
-- duas decisões que dependem delas NÃO PODEM depender do modelo lembrar de
-- chamar uma ferramenta — mesma lição que o acompanhamento automático:
--
--   followup_opt_out       — o cliente pediu para parar ("me tira da lista",
--                            "já contratei outro advogado", "para de mandar").
--                            Enquanto for true, nenhuma retomada é agendada nem
--                            enviada. É um estado da CONVERSA, não do turno:
--                            precisa sobreviver ao processo que o detectou.
--   interest_checked_at    — quando a IA já perguntou "quer dar continuidade?".
--                            Sem esta marca, uma pessoa que responde evasivo
--                            duas vezes receberia a mesma pergunta duas vezes.
--
-- `/clear` zera as duas (ver buildWaAiResetSessionPatch): reiniciar a conversa
-- tem de devolver o cliente ao estado de quem nunca disse nada.
-- ============================================================================

begin;

alter table public.whatsapp_ai_sessions
  add column if not exists followup_opt_out        boolean not null default false,
  add column if not exists followup_opt_out_reason text,
  add column if not exists interest_checked_at     timestamptz;

comment on column public.whatsapp_ai_sessions.followup_opt_out is
  'Cliente pediu para não receber mais retomadas. Trava o agendamento e o envio.';
comment on column public.whatsapp_ai_sessions.followup_opt_out_reason is
  'O trecho da mensagem que foi lido como recusa — para o operador conferir.';
comment on column public.whatsapp_ai_sessions.interest_checked_at is
  'Quando a IA perguntou se o cliente quer dar continuidade. Pergunta uma vez só.';

commit;
