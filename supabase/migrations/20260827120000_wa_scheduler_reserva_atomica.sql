-- WhatsApp — reserva atômica do que o cron de minuto em minuto despacha.
--
-- O PROBLEMA. `whatsapp-scheduler` (cron 18, `* * * * *`) escolhia as linhas
-- `pending` vencidas com um SELECT e só marcava `sent` DEPOIS de o envio voltar.
-- Entre uma coisa e outra a linha continua `pending` para quem olhar. Como o
-- pg_cron dispara por `net.http_post` (fire-and-forget, sem esperar a resposta),
-- uma execução que passe de 60s encontra a seguinte no meio do laço, lê as
-- MESMAS linhas e manda a mesma mensagem de novo.
--
-- Isso ainda NÃO aconteceu, e a medida importa para não vender o conserto como
-- correção de incidente: em 27/08/2026, sobre 1.432 execuções de 24h, a média
-- foi de 1,1s e o pico, 23,8s — nenhuma passou de 30s. O que assusta é de onde
-- vem o pico: não do envio, mas da reconciliação de canais, que gasta até 10s
-- por canal calado antes de desistir. Meia dúzia de canais fora do ar ao mesmo
-- tempo chega nos 60s sem nenhuma mensagem a mais na fila. A releitura que existia antes do envio não fecha essa
-- janela — ela só reduz o alvo, porque continua sendo ler-e-depois-escrever.
--
-- A SOLUÇÃO É A MESMA DO `wa_auto_close_claim`: escolher e reservar no MESMO
-- comando. `FOR UPDATE SKIP LOCKED` faz a segunda execução PULAR a linha que a
-- primeira já pegou (em vez de esperar por ela), e a reserva fica gravada em
-- `locked_until` — um arrendamento com prazo, não um estado novo.
--
-- POR QUE ARRENDAMENTO E NÃO UM STATUS `processing`. Um status novo teria de
-- ser ensinado a todo mundo que hoje lê `pending`: o índice único do follow-up
-- pendente, o `wa_auto_close_due` (que não encerra conversa com lembrete
-- pendente), a tela de agendadas, o `ensureWaAiFollowupScheduled`. E, pior,
-- uma execução que morresse no meio deixaria a linha presa em `processing`
-- para sempre, precisando de uma varredura de recuperação. O `locked_until`
-- vence sozinho: passou o prazo, a linha volta a ser elegível sem que ninguém
-- precise consertá-la.
--
-- O QUE ISTO NÃO RESOLVE. Se o envio SAIR e a execução morrer antes de gravar
-- `sent`, o arrendamento vence e a mensagem sai de novo. Fechar essa última
-- fresta exige chave de idempotência no `evolution-send` (o envio externo
-- reconhecer que já mandou aquilo), que é outra mudança. O prazo do
-- arrendamento é o que segura o estrago enquanto isso: 5 minutos, folgado para
-- um envio e curto para a espera de quem precisa de nova tentativa.

ALTER TABLE public.whatsapp_scheduled_messages
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;
COMMENT ON COLUMN public.whatsapp_scheduled_messages.locked_until IS
  'Reserva com prazo: uma execução do cron pegou esta linha e está enviando. Vence sozinha se a execução morrer.';

ALTER TABLE public.whatsapp_ai_followups
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;
COMMENT ON COLUMN public.whatsapp_ai_followups.locked_until IS
  'Reserva com prazo: uma execução do cron pegou este lembrete e está enviando. Vence sozinha se a execução morrer.';

-- ── A reserva das mensagens agendadas ───────────────────────────────────────
-- Devolve exatamente o que o laço precisa, já com o estado da conversa-pai:
-- a releitura que o dispatcher fazia à mão vira parte do mesmo comando, e o
-- retrato que ele recebe é o de DEPOIS da reserva, não o de antes.
CREATE OR REPLACE FUNCTION public.wa_scheduled_due_claim(
  p_limit         integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300
) RETURNS TABLE (
  id                      uuid,
  conversation_id         uuid,
  type                    text,
  body                    text,
  storage_path            text,
  mime_type               text,
  file_name               text,
  created_by              uuid,
  hold_since              timestamptz,
  conversation_is_blocked boolean,
  conversation_status     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH escolhidas AS (
    SELECT m.id
      FROM whatsapp_scheduled_messages m
     WHERE m.status = 'pending'
       AND m.scheduled_at <= now()
       AND (m.locked_until IS NULL OR m.locked_until < now())
     ORDER BY m.scheduled_at
     LIMIT greatest(1, coalesce(p_limit, 25))
     FOR UPDATE SKIP LOCKED
  ), reservadas AS (
    UPDATE whatsapp_scheduled_messages m
       SET locked_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300)))
      FROM escolhidas e
     WHERE m.id = e.id
    RETURNING m.id, m.conversation_id, m.type, m.body, m.storage_path, m.mime_type,
              m.file_name, m.created_by, m.hold_since, m.scheduled_at
  )
  SELECT r.id, r.conversation_id, r.type, r.body, r.storage_path, r.mime_type,
         r.file_name, r.created_by, r.hold_since,
         coalesce(c.is_blocked, false), c.status
    FROM reservadas r
    LEFT JOIN whatsapp_conversations c ON c.id = r.conversation_id
   ORDER BY r.scheduled_at;
$$;

COMMENT ON FUNCTION public.wa_scheduled_due_claim(integer, integer) IS
  'Escolhe e RESERVA as mensagens agendadas vencidas no mesmo comando. Duas execuções cruzadas nunca recebem a mesma linha.';

REVOKE ALL ON FUNCTION public.wa_scheduled_due_claim(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_scheduled_due_claim(integer, integer) TO service_role;

-- ── A reserva dos lembretes do assistente ───────────────────────────────────
-- Aqui o laço relê conversa, sessão e agente de qualquer jeito (é o que o
-- `decideFollowup` pesa), então a reserva devolve só a linha do lembrete.
CREATE OR REPLACE FUNCTION public.wa_ai_followup_due_claim(
  p_limit         integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 300
) RETURNS TABLE (
  id              uuid,
  conversation_id uuid,
  assistant_id    uuid,
  attempt         integer,
  scheduled_at    timestamptz,
  message         text,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH escolhidos AS (
    SELECT f.id
      FROM whatsapp_ai_followups f
     WHERE f.status = 'pending'
       AND f.scheduled_at <= now()
       AND (f.locked_until IS NULL OR f.locked_until < now())
     ORDER BY f.scheduled_at
     LIMIT greatest(1, coalesce(p_limit, 20))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE whatsapp_ai_followups f
     SET locked_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300)))
    FROM escolhidos e
   WHERE f.id = e.id
  RETURNING f.id, f.conversation_id, f.assistant_id, f.attempt,
            f.scheduled_at, f.message, f.created_at;
$$;

COMMENT ON FUNCTION public.wa_ai_followup_due_claim(integer, integer) IS
  'Escolhe e RESERVA os lembretes vencidos do assistente no mesmo comando, com arrendamento que vence sozinho.';

REVOKE ALL ON FUNCTION public.wa_ai_followup_due_claim(integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_followup_due_claim(integer, integer) TO service_role;
