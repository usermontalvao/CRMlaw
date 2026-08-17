-- O relógio do encerramento por inatividade passa a ser "desde quando o CLIENTE
-- deve resposta" — e mensagem automática não faz o cliente dever nada.
--
-- A primeira versão contava de `last_message_at`, que o gatilho move nas duas
-- direções. Isso quebrava justamente no caso mais comum da noite:
--
--   22h05  cliente escreve
--   22h05  o aviso automático responde "estamos fora do horário"
--   ...    ninguém do escritório responde no dia seguinte
--   22h05  o sistema encerra "por inatividade da outra parte"
--
-- Só que a outra parte não devia nada: quem devia era o escritório. O aviso de
-- ausência é um recado da secretária eletrônica, não atendimento, e o
-- encerramento apagava do painel exatamente o caso que ninguém atendeu.
--
-- Agora:
--   1. Conversa em que o ESCRITÓRIO deve resposta nunca encerra sozinha.
--   2. O relógio começa na nossa última resposta de verdade — a que passou a
--      bola para o cliente.
--   3. O aviso de ausência e o prompt de reabertura não são resposta: não
--      iniciam contagem nenhuma.

-- ── Quem está devendo, e desde quando ────────────────────────────────
-- Devolve o instante em que o cliente passou a dever resposta, ou NULL quando
-- ele não deve nada (nós é que devemos, ou ninguém nunca atendeu).
--
-- As duas mensagens automáticas são reconhecidas pela marca que a própria
-- conversa guarda do envio (`absence_sent_at`, `reopen_prompt_sent_at`). A
-- janela existe porque a marca é gravada ANTES do envio: medido em produção, a
-- mensagem entra de 1 a 3 segundos depois da marca. Errar para o lado largo só
-- adia um encerramento; errar para o estreito é reintroduzir o bug de cima.
CREATE OR REPLACE FUNCTION public.wa_auto_close_owed_since(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, last_customer_message_at, absence_sent_at, reopen_prompt_sent_at
      FROM whatsapp_conversations
     WHERE id = p_conversation_id
  ),
  nossa AS (
    SELECT max(m.wa_timestamp) AS ts
      FROM whatsapp_messages m
      JOIN c ON c.id = m.conversation_id
     WHERE m.direction = 'out'
       AND m.deleted_at IS NULL
       AND NOT (c.absence_sent_at IS NOT NULL
                AND m.wa_timestamp >= c.absence_sent_at - interval '5 seconds'
                AND m.wa_timestamp <= c.absence_sent_at + interval '60 seconds')
       AND NOT (c.reopen_prompt_sent_at IS NOT NULL
                AND m.wa_timestamp >= c.reopen_prompt_sent_at - interval '5 seconds'
                AND m.wa_timestamp <= c.reopen_prompt_sent_at + interval '60 seconds')
  )
  SELECT nossa.ts
    FROM nossa, c
   WHERE nossa.ts IS NOT NULL
     -- Cliente falou depois da nossa última resposta: a bola é nossa.
     AND (c.last_customer_message_at IS NULL OR c.last_customer_message_at < nossa.ts);
$$;

COMMENT ON FUNCTION public.wa_auto_close_owed_since(uuid) IS
  'Desde quando o cliente deve resposta nesta conversa. NULL = quem deve somos nós, ou ninguém respondeu ainda (aviso automático não conta como resposta).';

-- A varredura busca o máximo das mensagens NOSSAS de cada conversa; sem isto o
-- índice existente ainda traria as mensagens do cliente para depois descartar.
CREATE INDEX IF NOT EXISTS idx_wa_msg_saida_por_conversa
  ON public.whatsapp_messages (conversation_id, wa_timestamp DESC)
  WHERE direction = 'out' AND deleted_at IS NULL;

-- ── Quem está vencido ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.wa_auto_close_due(integer);
CREATE FUNCTION public.wa_auto_close_due(p_limit integer DEFAULT 40)
RETURNS TABLE (
  conversation_id     uuid,
  channel_id          uuid,
  contact_name        text,
  farewell            text,
  idle_minutes        integer,
  silent_minutes      integer,
  business_hours_only boolean,
  channel_timezone    text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id,
         i.id,
         c.contact_name,
         nullif(btrim(coalesce(i.auto_close_message, '')), ''),
         i.auto_close_minutes,
         (extract(epoch FROM (now() - o.desde)) / 60)::int,
         i.auto_close_business_hours_only,
         coalesce(nullif(btrim(coalesce(i.timezone, '')), ''), 'America/Cuiaba')
    FROM whatsapp_conversations c
    JOIN whatsapp_instances i ON i.id = c.instance_id
   CROSS JOIN LATERAL (SELECT public.wa_auto_close_owed_since(c.id) AS desde) o
   WHERE i.auto_close_enabled
     AND i.auto_close_minutes > 0
     AND coalesce(i.is_active, true)
     AND c.status IN ('open', 'pending')
     AND coalesce(c.is_blocked, false) = false
     AND coalesce(c.auto_close_suppressed, false) = false
     -- Transferência ainda não aceita é pendência DO ESCRITÓRIO, não silêncio do
     -- cliente. Encerrar aqui apagaria o rastro de um caso que ninguém assumiu.
     AND coalesce(c.awaiting_accept, false) = false
     -- O relógio da bola: NULL aqui já exclui a conversa em que nós devemos
     -- resposta e a que só recebeu aviso automático.
     AND o.desde IS NOT NULL
     AND o.desde < now() - make_interval(mins => i.auto_close_minutes)
     -- A escada do assistente de IA tem o próprio calendário: um lembrete
     -- marcado para depois de amanhã é justamente uma conversa em silêncio.
     -- Encerrá-la cancelaria o acompanhamento em vez de completá-lo.
     AND NOT EXISTS (
       SELECT 1 FROM whatsapp_ai_followups f
        WHERE f.conversation_id = c.id AND f.status = 'pending'
     )
   ORDER BY o.desde
   LIMIT greatest(1, coalesce(p_limit, 40));
$$;

COMMENT ON FUNCTION public.wa_auto_close_due(integer) IS
  'Conversas em que o CLIENTE deve resposta há mais tempo que o prazo do canal, das mais paradas para as menos.';

-- ── A reserva ────────────────────────────────────────────────────────
-- Encerra e reserva no MESMO UPDATE: se duas varreduras se cruzarem, só uma
-- fecha a conversa e só uma despedida sai. A condição repete a da varredura —
-- inclusive o relógio da bola — porque entre escolher e encerrar o cliente pode
-- ter respondido.
CREATE OR REPLACE FUNCTION public.wa_auto_close_claim(
  p_conversation_id uuid,
  p_idle_minutes    integer,
  p_reason          text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE whatsapp_conversations
     SET status                = 'closed',
         closed_at             = now(),
         closed_by             = NULL,   -- NULL = encerrado pelo sistema
         closure_reason        = left(coalesce(p_reason, 'Encerrado por inatividade.'), 300),
         -- As duas pausas de conversa valem até o fim do atendimento.
         absence_suppressed    = false,
         auto_close_suppressed = false
   WHERE id = p_conversation_id
     AND status IN ('open', 'pending')
     AND coalesce(is_blocked, false) = false
     AND coalesce(auto_close_suppressed, false) = false
     AND coalesce(awaiting_accept, false) = false
     AND public.wa_auto_close_owed_since(id)
         < now() - make_interval(mins => greatest(5, p_idle_minutes))
  RETURNING true;
$$;

COMMENT ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) IS
  'Encerra a conversa por inatividade se ela ainda estiver elegível. TRUE quando o encerramento foi desta chamada; NULL quando o cliente respondeu no meio do caminho ou outra varredura chegou antes.';

REVOKE ALL ON FUNCTION public.wa_auto_close_owed_since(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_owed_since(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_due(integer) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) TO service_role;
