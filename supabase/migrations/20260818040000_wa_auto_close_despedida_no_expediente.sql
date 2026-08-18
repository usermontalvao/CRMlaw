-- O expediente deixa de segurar o ENCERRAMENTO e passa a segurar a DESPEDIDA.
--
-- Como estava: canal marcado como "só dentro do horário comercial" simplesmente
-- não encerrava fora do expediente. O prazo vencia e a conversa ficava de pé
-- esperando a abertura. Com prazo de 4h e expediente até as 18h, TODA conversa
-- cuja última mensagem sai depois das 14h vence com o escritório fechado — e
-- passa a noite inteira aberta no painel para só encerrar às 08h do dia
-- seguinte, com um "16h sem retorno" que ninguém reconhece.
--
-- Como fica: o encerramento acontece na hora em que o prazo vence, seja que
-- horas for. O prazo continua honesto (nada é antecipado, nada é adiado), o
-- painel amanhece limpo, e o que respeita o expediente é a única parte que o
-- cliente vê: a mensagem de despedida. Vencendo fora do horário, a conversa
-- fecha e a despedida fica RESERVADA — sai na primeira varredura depois da
-- abertura.
--
-- Foi descartado antecipar o encerramento para o fim do expediente: encerraria
-- antes de o prazo vencer, e num canal de prazo curto mataria a conversa que
-- recebeu resposta dez minutos antes de fechar.

-- Desde quando esta conversa deve uma despedida de encerramento automático.
-- NULL = não deve nenhuma (o caso de quase toda conversa). O carimbo é a hora
-- do encerramento, e é ele que vira o "há quanto tempo" do log quando o envio
-- finalmente sai.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS auto_close_farewell_due_at timestamptz;

COMMENT ON COLUMN public.whatsapp_conversations.auto_close_farewell_due_at IS
  'Despedida de encerramento automático reservada: a conversa fechou fora do expediente e o aviso sai na abertura. NULL = não há despedida pendente.';

-- Índice parcial: a varredura pergunta de minuto em minuto quem tem despedida
-- reservada, e a resposta é "ninguém" quase sempre.
CREATE INDEX IF NOT EXISTS idx_wa_conv_despedida_reservada
  ON public.whatsapp_conversations (auto_close_farewell_due_at)
  WHERE auto_close_farewell_due_at IS NOT NULL;

-- ── A reserva, agora com a despedida opcionalmente guardada ──────────────
-- Mesmo UPDATE de antes; o que muda é o quarto argumento. `p_hold_farewell`
-- verdadeiro grava a marca no MESMO comando que fecha a conversa: se o processo
-- morrer entre uma coisa e outra, ou a conversa está aberta sem marca, ou está
-- fechada com a despedida garantida — nunca fechada e muda.
--
-- O argumento tem DEFAULT de propósito: entre aplicar esta migration e
-- reimplantar a Edge Function, a chamada de três argumentos que está em
-- produção continua resolvendo para cá.
DROP FUNCTION IF EXISTS public.wa_auto_close_claim(uuid, integer, text);
CREATE FUNCTION public.wa_auto_close_claim(
  p_conversation_id uuid,
  p_idle_minutes    integer,
  p_reason          text,
  p_hold_farewell   boolean DEFAULT false
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE whatsapp_conversations
     SET status                     = 'closed',
         closed_at                  = now(),
         closed_by                  = NULL,   -- NULL = encerrado pelo sistema
         closure_reason             = left(coalesce(p_reason, 'Encerrado por inatividade.'), 300),
         -- As duas pausas de conversa valem até o fim do atendimento.
         absence_suppressed         = false,
         auto_close_suppressed      = false,
         auto_close_farewell_due_at = CASE WHEN coalesce(p_hold_farewell, false) THEN now() END
   WHERE id = p_conversation_id
     AND status IN ('open', 'pending')
     AND coalesce(is_blocked, false) = false
     AND coalesce(auto_close_suppressed, false) = false
     AND coalesce(awaiting_accept, false) = false
     AND public.wa_auto_close_idle_since(id)
         < now() - make_interval(mins => greatest(5, p_idle_minutes))
  RETURNING true;
$$;

COMMENT ON FUNCTION public.wa_auto_close_claim(uuid, integer, text, boolean) IS
  'Encerra a conversa por inatividade se ela ainda estiver parada esperando o cliente. Com p_hold_farewell, reserva a despedida para a abertura do expediente. TRUE quando o encerramento foi desta chamada; NULL quando entrou mensagem no meio do caminho ou outra varredura chegou antes.';

-- ── Quem tem despedida reservada ─────────────────────────────────────────
-- Sai com o texto e o fuso do canal porque quem decide se o expediente já
-- abriu é a Edge Function, que é quem lê a agenda.
CREATE OR REPLACE FUNCTION public.wa_auto_close_farewells_due(p_limit integer DEFAULT 40)
RETURNS TABLE (
  conversation_id     uuid,
  channel_id          uuid,
  farewell            text,
  waiting_minutes     integer,
  business_hours_only boolean,
  channel_timezone    text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         i.id,
         nullif(btrim(coalesce(i.auto_close_message, '')), ''),
         (extract(epoch FROM (now() - c.auto_close_farewell_due_at)) / 60)::int,
         i.auto_close_business_hours_only,
         coalesce(nullif(btrim(coalesce(i.timezone, '')), ''), 'America/Cuiaba')
    FROM whatsapp_conversations c
    JOIN whatsapp_instances i ON i.id = c.instance_id
   WHERE c.auto_close_farewell_due_at IS NOT NULL
   ORDER BY c.auto_close_farewell_due_at
   LIMIT greatest(1, coalesce(p_limit, 40));
$$;

COMMENT ON FUNCTION public.wa_auto_close_farewells_due(integer) IS
  'Conversas encerradas fora do expediente cuja despedida ainda não saiu, das mais antigas para as mais novas.';

-- ── Tirar a reserva da fila ──────────────────────────────────────────────
-- A marca sai SEMPRE, tenha ou não despedida a enviar: uma reserva que
-- sobrevive ao envio é uma despedida repetida a cada minuto.
--
-- O que a resposta diz é se ainda faz sentido falar:
--   TRUE  → a conversa continua encerrada, manda a despedida;
--   FALSE → o cliente voltou a escrever (ou alguém reabriu) durante a espera —
--           a reserva morre calada, porque despedir-se de quem acabou de
--           chegar é pior do que não se despedir;
--   NULL  → outra varredura levou esta reserva antes.
CREATE OR REPLACE FUNCTION public.wa_auto_close_farewell_claim(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE whatsapp_conversations
     SET auto_close_farewell_due_at = NULL
   WHERE id = p_conversation_id
     AND auto_close_farewell_due_at IS NOT NULL
  RETURNING status = 'closed';
$$;

COMMENT ON FUNCTION public.wa_auto_close_farewell_claim(uuid) IS
  'Retira a despedida reservada da fila. TRUE = ainda encerrada, pode enviar; FALSE = a conversa foi reaberta e o aviso não deve sair; NULL = outra varredura levou.';

REVOKE ALL ON FUNCTION public.wa_auto_close_claim(uuid, integer, text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_claim(uuid, integer, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_farewells_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_farewells_due(integer) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_farewell_claim(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_farewell_claim(uuid) TO service_role;
