-- Encerramento automático por inatividade.
--
-- Atendimento que ninguém retomou fica aberto para sempre: entope a fila, suja
-- o SLA e some do radar de quem faz gestão. A regra é do CANAL, e não global,
-- porque canais servidos por IA têm a própria escada de acompanhamento — se o
-- encerramento passasse por cima deles, mataria o follow-up no meio.
--
-- O relógio da inatividade é `last_message_at`, que o gatilho
-- `trg_wa_touch_conversation` atualiza nas DUAS direções: qualquer mensagem,
-- do cliente ou do escritório, zera a contagem.

-- ── Configuração por canal ───────────────────────────────────────────
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS auto_close_enabled              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_close_minutes              integer NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS auto_close_message              text,
  ADD COLUMN IF NOT EXISTS auto_close_business_hours_only  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.whatsapp_instances.auto_close_enabled IS
  'Encerra sozinho as conversas paradas deste canal. Desligado por padrão — canal com IA/follow-up costuma querer isto desligado.';
COMMENT ON COLUMN public.whatsapp_instances.auto_close_minutes IS
  'Minutos de silêncio tolerados antes do encerramento automático. Conta a partir da última mensagem, de qualquer lado.';
COMMENT ON COLUMN public.whatsapp_instances.auto_close_message IS
  'Despedida enviada ao cliente antes de encerrar. Em branco = encerra sem avisar.';
COMMENT ON COLUMN public.whatsapp_instances.auto_close_business_hours_only IS
  'Só encerra dentro do horário de atendimento do canal. Evita a despedida chegando às 3h da manhã só porque o prazo venceu de madrugada.';

-- Um teto de sanidade: minuto zero ou negativo encerraria tudo no primeiro
-- varrimento, e o formulário já limita o valor. Aqui a regra fica no banco.
ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_auto_close_minutes_check;
ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_auto_close_minutes_check
  CHECK (auto_close_minutes BETWEEN 5 AND 43200);

-- ── Pausa por conversa ───────────────────────────────────────────────
-- Mesmo desenho de `absence_suppressed`: vale só naquela conversa e volta ao
-- normal quando o atendimento encerra, para que a pausa não vire permanente
-- sem ninguém lembrar de ter ligado.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS auto_close_suppressed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_conversations.auto_close_suppressed IS
  'O atendente desligou o encerramento automático SÓ nesta conversa. Zerado ao encerrar (manual ou automático).';

-- ── Quem está vencido ────────────────────────────────────────────────
-- Precisa ser função porque a comparação é entre COLUNAS de tabelas diferentes
-- (o silêncio da conversa contra o prazo do canal) — coisa que o PostgREST não
-- expressa. De quebra, o relógio passa a ser o do Postgres, e não o de cada
-- isolate da Edge Function.
CREATE OR REPLACE FUNCTION public.wa_auto_close_due(p_limit integer DEFAULT 40)
RETURNS TABLE (
  conversation_id     uuid,
  channel_id          uuid,
  contact_name        text,
  farewell            text,
  idle_minutes        integer,
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
         i.auto_close_business_hours_only,
         coalesce(nullif(btrim(coalesce(i.timezone, '')), ''), 'America/Cuiaba')
    FROM whatsapp_conversations c
    JOIN whatsapp_instances i ON i.id = c.instance_id
   WHERE i.auto_close_enabled
     AND i.auto_close_minutes > 0
     AND coalesce(i.is_active, true)
     AND c.status IN ('open', 'pending')
     AND coalesce(c.is_blocked, false) = false
     AND coalesce(c.auto_close_suppressed, false) = false
     -- Transferência ainda não aceita é pendência DO ESCRITÓRIO, não silêncio do
     -- cliente. Encerrar aqui apagaria o rastro de um caso que ninguém assumiu.
     AND coalesce(c.awaiting_accept, false) = false
     AND coalesce(c.last_message_at, c.created_at)
         < now() - make_interval(mins => i.auto_close_minutes)
     -- A escada do assistente de IA tem o próprio calendário: um lembrete
     -- marcado para depois de amanhã é justamente uma conversa em silêncio.
     -- Encerrá-la cancelaria o acompanhamento em vez de completá-lo.
     AND NOT EXISTS (
       SELECT 1 FROM whatsapp_ai_followups f
        WHERE f.conversation_id = c.id AND f.status = 'pending'
     )
   ORDER BY coalesce(c.last_message_at, c.created_at)
   LIMIT greatest(1, coalesce(p_limit, 40));
$$;

COMMENT ON FUNCTION public.wa_auto_close_due(integer) IS
  'Conversas vencidas pelo prazo de inatividade do próprio canal, das mais paradas para as menos.';

-- ── A reserva ────────────────────────────────────────────────────────
-- Encerra e reserva no MESMO UPDATE: se duas varreduras se cruzarem, só uma
-- fecha a conversa e só uma despedida sai. Por isso o encerramento vem ANTES do
-- envio, ao contrário do encerramento manual — ali quem confirma é gente e não
-- há corrida; aqui a corrida é a regra.
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
     AND coalesce(last_message_at, created_at)
         < now() - make_interval(mins => greatest(5, p_idle_minutes))
  RETURNING true;
$$;

COMMENT ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) IS
  'Encerra a conversa por inatividade se ela ainda estiver elegível. TRUE quando o encerramento foi desta chamada; NULL quando outra varredura chegou antes ou a conversa saiu da regra.';

-- Só a varredura usa. Encerrar à mão continua sendo UPDATE comum sob RLS.
REVOKE ALL ON FUNCTION public.wa_auto_close_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_due(integer) TO service_role;

REVOKE ALL ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_auto_close_claim(uuid, integer, text) TO service_role;
