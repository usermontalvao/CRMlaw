-- O relógio do encerramento por inatividade passa a ser A ÚLTIMA MENSAGEM DA
-- CONVERSA — e ele só corre enquanto a resposta é do CLIENTE.
--
--   parada desde = última mensagem da conversa
--   encerra em   = parada desde + prazo do canal
--   ...mas só se a última mensagem for NOSSA.
--
-- São duas regras que só fazem sentido juntas:
--
-- 1. QUALQUER mensagem real reinicia a contagem do zero — do cliente, do
--    atendente ou da IA. Sem isto, uma conversa respondida às 14h14 continuava
--    contando desde as 10h38 e anunciava "encerra em 8min" às 15h, ignorando as
--    respostas do meio. Era o bug.
--
-- 2. Conversa em que o ESCRITÓRIO deve resposta não encerra nunca. Inatividade
--    de operador não é inatividade de cliente: encerrar ali apaga do painel
--    justamente o atendimento que ninguém assumiu — e o cliente, que está
--    esperando, recebe uma despedida no lugar da resposta.
--
-- Juntas, as duas dizem: o prazo conta da NOSSA última mensagem (que é a última
-- da conversa, quando a bola está com o cliente) e vale inteiro a cada mensagem
-- nova que sai daqui. A versão anterior tinha ainda uma carência de 1 hora
-- depois da resposta; ela sai — a nossa mensagem não pede carência, ela reinicia
-- o prazo cheio.
--
-- O aviso automático de fora do horário e o prompt de reabertura NÃO contam
-- como resposta nossa: são recado de secretária eletrônica, e depois deles a
-- conversa continua devendo atendimento. Sem esta exceção, mensagem que chega
-- às 22h05, recebe o aviso e nunca é atendida encerra sozinha no dia seguinte.

-- ── Desde quando a conversa está parada, com a bola do lado do cliente ──
-- NULL = não há prazo correndo: ou nós devemos resposta, ou ninguém falou nada
-- ainda. É este NULL que protege o atendimento não respondido.
--
-- As duas mensagens automáticas são reconhecidas pela marca que a própria
-- conversa guarda do envio (`absence_sent_at`, `reopen_prompt_sent_at`). A
-- janela existe porque a marca é gravada ANTES do envio: medido em produção, a
-- mensagem entra de 1 a 3 segundos depois da marca.
CREATE OR REPLACE FUNCTION public.wa_auto_close_idle_since(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, absence_sent_at, reopen_prompt_sent_at
      FROM whatsapp_conversations
     WHERE id = p_conversation_id
  ),
  -- Direto da tabela de mensagens, e não das colunas `last_*_at`: mensagem
  -- apagada não é atividade, e a coluna guarda o carimbo da última inserção
  -- mesmo depois de a mensagem sumir da conversa.
  --
  -- Nota interna, mudança de status, transferência e log moram em outras
  -- tabelas — nada disso reinicia o relógio.
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
  ),
  dele AS (
    SELECT max(m.wa_timestamp) AS ts
      FROM whatsapp_messages m
      JOIN c ON c.id = m.conversation_id
     WHERE m.direction = 'in'
       AND m.deleted_at IS NULL
  )
  SELECT nossa.ts
    FROM nossa, dele
   WHERE nossa.ts IS NOT NULL
     -- Cliente falou depois da nossa última resposta de verdade: a bola é
     -- nossa, e não há inatividade DELE para contar.
     AND (dele.ts IS NULL OR dele.ts <= nossa.ts);
$$;

COMMENT ON FUNCTION public.wa_auto_close_idle_since(uuid) IS
  'Desde quando a conversa está parada esperando o cliente — a nossa última mensagem, quando é a última da conversa. NULL = a resposta é nossa, ou ninguém falou ainda (aviso automático não é resposta).';

-- ── Quem está vencido ────────────────────────────────────────────────
-- Mesma assinatura de retorno de antes, de propósito: a Edge Function em
-- produção lê estas colunas e não precisa de redeploy para a regra mudar.
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
         (extract(epoch FROM (now() - a.ts)) / 60)::int,
         i.auto_close_business_hours_only,
         coalesce(nullif(btrim(coalesce(i.timezone, '')), ''), 'America/Cuiaba')
    FROM whatsapp_conversations c
    JOIN whatsapp_instances i ON i.id = c.instance_id
   CROSS JOIN LATERAL (SELECT public.wa_auto_close_idle_since(c.id) AS ts) a
   WHERE i.auto_close_enabled
     AND i.auto_close_minutes > 0
     AND coalesce(i.is_active, true)
     AND c.status IN ('open', 'pending')
     AND coalesce(c.is_blocked, false) = false
     AND coalesce(c.auto_close_suppressed, false) = false
     -- Transferência ainda não aceita é pendência DO ESCRITÓRIO, não silêncio do
     -- cliente. Encerrar aqui apagaria o rastro de um caso que ninguém assumiu.
     AND coalesce(c.awaiting_accept, false) = false
     AND a.ts IS NOT NULL
     AND a.ts < now() - make_interval(mins => i.auto_close_minutes)
     -- A escada do assistente de IA tem o próprio calendário: um lembrete
     -- marcado para depois de amanhã é justamente uma conversa em silêncio.
     -- Encerrá-la cancelaria o acompanhamento em vez de completá-lo.
     AND NOT EXISTS (
       SELECT 1 FROM whatsapp_ai_followups f
        WHERE f.conversation_id = c.id AND f.status = 'pending'
     )
   ORDER BY a.ts
   LIMIT greatest(1, coalesce(p_limit, 40));
$$;

COMMENT ON FUNCTION public.wa_auto_close_due(integer) IS
  'Conversas paradas esperando o cliente há mais que o prazo do canal, das mais paradas para as menos. Conversa em que o escritório deve resposta não entra.';

-- ── A reserva ────────────────────────────────────────────────────────
-- Encerra e reserva no MESMO UPDATE: se duas varreduras se cruzarem, só uma
-- fecha a conversa e só uma despedida sai. A condição repete a da varredura
-- porque entre escolher e encerrar pode ter entrado mensagem — do cliente
-- (a bola volta para nós) ou nossa (o prazo reinicia inteiro).
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
     AND public.wa_auto_close_idle_since(id)
         < now() - make_interval(mins => greatest(5, p_idle_minutes))
  RETURNING true;
$$;

COMMENT ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) IS
  'Encerra a conversa por inatividade se ela ainda estiver parada esperando o cliente. TRUE quando o encerramento foi desta chamada; NULL quando entrou mensagem no meio do caminho ou outra varredura chegou antes.';

-- Os relógios antigos saem de cena: dois relógios convivendo é a receita para
-- alguém corrigir o errado daqui a três meses.
DROP FUNCTION IF EXISTS public.wa_auto_close_owed_since(uuid);
DROP FUNCTION IF EXISTS public.wa_auto_close_last_activity(uuid);
DROP FUNCTION IF EXISTS public.wa_auto_close_due_at(uuid, integer);
DROP FUNCTION IF EXISTS public.wa_auto_close_clock(uuid);

-- O máximo das mensagens de ENTRADA passou a ser lido a cada varredura; o
-- índice de saída já existe desde a migration anterior.
CREATE INDEX IF NOT EXISTS idx_wa_msg_entrada_por_conversa
  ON public.whatsapp_messages (conversation_id, wa_timestamp DESC)
  WHERE direction = 'in' AND deleted_at IS NULL;

REVOKE ALL ON FUNCTION public.wa_auto_close_idle_since(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_idle_since(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_due(integer) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) TO service_role;
