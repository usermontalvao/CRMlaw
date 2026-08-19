-- ============================================================
-- A prévia da lista passa a dizer o que ACONTECEU.
--
-- A linha da inbox é a única leitura que a maioria das conversas recebe no
-- dia: ninguém abre 300 threads, todo mundo corre o olho pela coluna da
-- esquerda. Duas coisas mentiam ali.
--
--  1. FIGURINHA sumia. O tipo não estava no CASE e o `content` da figurinha é
--     NULL — a prévia virava vazio e a lista escrevia "—", como se a conversa
--     não tivesse última mensagem. O mesmo valia, em menor grau, para
--     localização, contato e enquete.
--
--  2. LEGENDA de foto/vídeo/documento era jogada fora. Quem manda "📷 Imagem"
--     três vezes seguidas na lista não sabe qual delas era o RG; o WhatsApp
--     mostra a legenda porque a legenda é a mensagem.
--
--  3. A CHAMADA não existia. `whatsapp_call_logs` nunca tocou a conversa, então
--     uma ligação de 6 minutos às 4h da manhã deixava a lista exibindo o texto
--     das 3h — o registro mais recente da conversa era invisível justamente na
--     tela onde se decide o que abrir. Aqui a chamada ganha lugar próprio na
--     linha da conversa (`last_call_*`), SEM se disfarçar de mensagem: nada de
--     mexer em `last_message_at`/`last_message_direction`, que são o relógio do
--     encerramento automático, do SLA e da 1ª resposta. Quem junta as duas
--     coisas para desenhar é a lista (ver `conversationPreview.ts`).
-- ============================================================

-- ── 1. A conversa passa a lembrar da última CHAMADA ────────────
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_call_at               timestamptz,
  ADD COLUMN IF NOT EXISTS last_call_direction        text,
  ADD COLUMN IF NOT EXISTS last_call_outcome          text,
  ADD COLUMN IF NOT EXISTS last_call_duration_seconds integer;

COMMENT ON COLUMN public.whatsapp_conversations.last_call_at IS
  'Fim da última chamada desta conversa. NÃO é atividade de mensagem: existe para a prévia da lista, e de propósito não alimenta SLA nem encerramento automático.';

-- Fatos crus, não frase pronta: as palavras da chamada ("Chamada de voz
-- recebida", "Sem resposta", "Chamada de voz perdida") já moram num lugar só,
-- em `threadCalls.ts`, e a thread e a lista têm de dizer a mesma coisa. Guardar
-- texto aqui criaria uma segunda fonte que envelhece sozinha.
CREATE OR REPLACE FUNCTION public.wa_touch_conversation_call()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF NEW.conversation_id IS NULL THEN RETURN NEW; END IF;

  -- `ended_at` é o instante que interessa (é o fim que sabe duração e
  -- desfecho); `started_at` cobre a chamada em curso.
  v_at := COALESCE(NEW.ended_at, NEW.started_at);
  IF v_at IS NULL THEN RETURN NEW; END IF;

  UPDATE public.whatsapp_conversations c
     SET last_call_at               = v_at,
         last_call_direction        = NEW.direction,
         last_call_outcome          = NEW.outcome,
         last_call_duration_seconds = NEW.duration_seconds
   WHERE c.id = NEW.conversation_id
     -- Chamada mais velha não sobrescreve a mais nova (a gravação e a
     -- transcrição chegam por UPDATE, muito depois, e a esta altura já pode
     -- ter havido outra ligação).
     AND (c.last_call_at IS NULL OR v_at >= c.last_call_at)
     -- E um UPDATE que não muda nada não vira escrita: `updated_at` da conversa
     -- é realtime para toda a equipe, e o custo de WAL neste projeto é real.
     AND (c.last_call_at               IS DISTINCT FROM v_at
       OR c.last_call_direction        IS DISTINCT FROM NEW.direction
       OR c.last_call_outcome          IS DISTINCT FROM NEW.outcome
       OR c.last_call_duration_seconds IS DISTINCT FROM NEW.duration_seconds);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_touch_conversation_call ON public.whatsapp_call_logs;
CREATE TRIGGER trg_wa_touch_conversation_call
  AFTER INSERT OR UPDATE ON public.whatsapp_call_logs
  FOR EACH ROW EXECUTE FUNCTION public.wa_touch_conversation_call();

-- Retroativo: as ligações que já aconteceram aparecem na lista sem esperar a
-- próxima.
WITH ultima AS (
  SELECT DISTINCT ON (l.conversation_id)
         l.conversation_id,
         COALESCE(l.ended_at, l.started_at) AS at,
         l.direction, l.outcome, l.duration_seconds
    FROM public.whatsapp_call_logs l
   WHERE l.conversation_id IS NOT NULL
     AND COALESCE(l.ended_at, l.started_at) IS NOT NULL
   ORDER BY l.conversation_id, COALESCE(l.ended_at, l.started_at) DESC
)
UPDATE public.whatsapp_conversations c
   SET last_call_at               = u.at,
       last_call_direction        = u.direction,
       last_call_outcome          = u.outcome,
       last_call_duration_seconds = u.duration_seconds
  FROM ultima u
 WHERE c.id = u.conversation_id
   AND c.last_call_at IS DISTINCT FROM u.at;

-- ── 2. A prévia da MENSAGEM passa a cobrir tudo que chega ──────
-- Uma função só, usada pelo trigger e pelo retroativo, para não haver duas
-- versões da mesma regra.
CREATE OR REPLACE FUNCTION public.wa_message_preview(
  p_type          text,
  p_content       text,
  p_file_name     text,
  p_is_animated   boolean
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'text'  THEN left(coalesce(p_content, ''), 200)
    -- Mídia com legenda mostra a LEGENDA — é o que a pessoa escreveu, e é o que
    -- distingue uma foto da outra na lista.
    WHEN 'image' THEN '📷 ' || left(coalesce(nullif(btrim(p_content), ''), 'Imagem'), 200)
    WHEN 'video' THEN '🎬 ' || left(coalesce(nullif(btrim(p_content), ''), 'Vídeo'), 200)
    WHEN 'audio' THEN '🎤 Áudio'
    WHEN 'document' THEN '📎 ' || left(coalesce(
      nullif(btrim(p_content), ''), nullif(btrim(p_file_name), ''), 'Documento'), 200)
    -- Figurinha não tem texto nenhum: sem esta linha a prévia ficava vazia e a
    -- lista escrevia "—".
    WHEN 'sticker' THEN CASE WHEN p_is_animated THEN '🖼️ Figurinha animada' ELSE '🖼️ Figurinha' END
    WHEN 'location' THEN '📍 Localização'
    -- O nome do contato compartilhado está na 1ª linha do content.
    WHEN 'contact' THEN '👤 ' || left(coalesce(
      nullif(btrim(split_part(coalesce(p_content, ''), E'\n', 1)), ''), 'Contato'), 200)
    WHEN 'poll' THEN '📊 ' || left(coalesce(
      nullif(btrim(split_part(coalesce(p_content, ''), E'\n', 1)), ''), 'Enquete'), 200)
    -- reaction ("Reagiu com 👍"), album ("Álbum com 4 fotos"), interactive e
    -- unsupported ("Mensagem não suportada") já chegam legíveis do webhook.
    ELSE left(coalesce(nullif(btrim(p_content), ''), 'Mensagem'), 200)
  END;
$$;

CREATE OR REPLACE FUNCTION public.wa_touch_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_preview text;
BEGIN
  v_preview := public.wa_message_preview(NEW.type, NEW.content, NEW.file_name, NEW.is_animated);

  UPDATE public.whatsapp_conversations c
     SET last_message_at          = NEW.wa_timestamp,
         last_message_preview     = v_preview,
         last_message_direction   = NEW.direction,
         unread_count             = CASE WHEN NEW.direction = 'in'
                                         THEN c.unread_count + 1 ELSE c.unread_count END,
         last_customer_message_at = CASE WHEN NEW.direction = 'in'
                                         THEN NEW.wa_timestamp ELSE c.last_customer_message_at END,
         last_agent_message_at    = CASE WHEN NEW.direction = 'out'
                                         THEN NEW.wa_timestamp ELSE c.last_agent_message_at END,
         -- 1ª resposta do agente após o cliente ter falado.
         first_response_at        = CASE WHEN NEW.direction = 'out'
                                          AND c.first_response_at IS NULL
                                          AND c.last_customer_message_at IS NOT NULL
                                         THEN NEW.wa_timestamp ELSE c.first_response_at END,
         -- NÃO reabre aqui: a reabertura é decidida pelo evolution-webhook
         -- (classificação cortesia vs. nova demanda + liberação do atendente).
         updated_at               = now()
   WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

-- Retroativo da prévia: as conversas cuja ÚLTIMA mensagem é de um tipo que
-- antes caía fora do CASE (figurinha à frente) continuariam com "—" para
-- sempre, porque a prévia é congelada na linha da conversa.
--
-- `deleted_at` fica de fora de propósito: "Mensagem apagada" é escrita pelo
-- webhook/evolution-send e recalcular aqui traria de volta o conteúdo apagado.
WITH ultima AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id, m.type, m.content, m.file_name, m.is_animated, m.deleted_at
    FROM public.whatsapp_messages m
   ORDER BY m.conversation_id, m.wa_timestamp DESC, m.created_at DESC
)
UPDATE public.whatsapp_conversations c
   SET last_message_preview = public.wa_message_preview(u.type, u.content, u.file_name, u.is_animated)
  FROM ultima u
 WHERE c.id = u.conversation_id
   AND u.deleted_at IS NULL
   AND c.last_message_preview IS DISTINCT FROM
       public.wa_message_preview(u.type, u.content, u.file_name, u.is_animated);
