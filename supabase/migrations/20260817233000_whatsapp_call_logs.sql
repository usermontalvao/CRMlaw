-- O registro das chamadas de voz — e a gravação, quando houver.
--
-- Até aqui uma ligação não deixava rastro nenhum: acabou a conversa, acabou a
-- informação. Quem atendeu, a que horas, quanto durou, se o cliente atendeu ou
-- não — nada disso existia em lugar algum, e a ficha do cliente não sabia que a
-- ligação tinha acontecido.
--
-- Decisões que valem explicação:
--
--  • A CHAVE É O `call_id` DO WACALLS. Ele é único por chamada e é o mesmo em
--    todas as abas do escritório, o que faz o registro ser IDEMPOTENTE: duas
--    recepcionistas com o CRM aberto veem o mesmo convite tocar e as duas
--    tentam registrar a chamada perdida. Sem a chave única, seriam duas linhas.
--
--  • QUEM ATENDEU GANHA DE QUEM VIU TOCAR. É a regra do `wa_log_call` abaixo:
--    um registro que já tem `answered_at` nunca é rebaixado para "perdida" pelo
--    registro tardio de outra aba, mas uma "perdida" É promovida quando o
--    atendimento aparece.
--
--  • O CLIENTE É DESCOBERTO AQUI. A chamada conhece o telefone; a ficha do
--    cliente é o lugar onde essa ligação precisa aparecer. Quando o CRM não
--    reconheceu o número na hora (ligação para quem ainda não tem conversa
--    aberta), o casamento é feito pelos 8 últimos dígitos — a mesma tolerância
--    ao nono dígito que a agenda de contatos usa.
--
--  • A GRAVAÇÃO NÃO MORA AQUI. Fica no bucket `whatsapp-media`, sob
--    `call-recordings/`, e a linha guarda só o caminho. Áudio no banco encarece
--    backup e dump sem nenhuma vantagem.

CREATE TABLE IF NOT EXISTS public.whatsapp_call_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id            text NOT NULL UNIQUE,
  session_id         text,
  direction          text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone              text NOT NULL,
  client_id          uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  conversation_id    uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  -- Quem falou. Nulo numa chamada que ninguém atendeu.
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at         timestamptz NOT NULL,
  answered_at        timestamptz,
  ended_at           timestamptz NOT NULL DEFAULT now(),
  duration_seconds   integer NOT NULL DEFAULT 0,
  -- Motivo cru do servidor (user_ended, declined, timeout…) e o desfecho já
  -- traduzido para a leitura da ficha.
  end_reason         text,
  outcome            text NOT NULL CHECK (outcome IN ('answered', 'missed', 'declined', 'failed')),
  recording_path     text,
  recording_mime     text,
  recording_bytes    bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- A ficha do cliente abre por cliente e em ordem de tempo; a busca por número
-- serve a quem ligou para alguém que ainda não é cadastro.
CREATE INDEX IF NOT EXISTS whatsapp_call_logs_client_idx
  ON public.whatsapp_call_logs (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_call_logs_phone_idx
  ON public.whatsapp_call_logs (phone, started_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_call_logs_started_idx
  ON public.whatsapp_call_logs (started_at DESC);

ALTER TABLE public.whatsapp_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_call_logs_select ON public.whatsapp_call_logs;
CREATE POLICY wa_call_logs_select ON public.whatsapp_call_logs
  FOR SELECT USING (public.is_office_staff());

DROP POLICY IF EXISTS wa_call_logs_insert ON public.whatsapp_call_logs;
CREATE POLICY wa_call_logs_insert ON public.whatsapp_call_logs
  FOR INSERT WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_call_logs_update ON public.whatsapp_call_logs;
CREATE POLICY wa_call_logs_update ON public.whatsapp_call_logs
  FOR UPDATE USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());

DROP POLICY IF EXISTS wa_call_logs_delete ON public.whatsapp_call_logs;
CREATE POLICY wa_call_logs_delete ON public.whatsapp_call_logs
  FOR DELETE USING (public.is_office_staff());

-- Envio da gravação pelo navegador. O `whatsapp-media` só tinha políticas de
-- leitura/edição para o escritório porque tudo entrava por função de servidor;
-- a gravação nasce no navegador de quem falou, então a permissão de escrita é
-- aberta APENAS para a pasta das gravações.
DROP POLICY IF EXISTS wa_media_staff_insert_recordings ON storage.objects;
CREATE POLICY wa_media_staff_insert_recordings ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-media'
    AND public.is_office_staff()
    AND (storage.foldername(name))[1] = 'call-recordings'
  );

/**
 * Registra (ou completa) uma chamada.
 *
 * SECURITY DEFINER com a trava explícita de `is_office_staff()`: o `clients`
 * precisa ser lido para casar o telefone com a ficha, e essa leitura não pode
 * depender das políticas de quem chamou.
 */
CREATE OR REPLACE FUNCTION public.wa_log_call(
  p_call_id         text,
  p_direction       text,
  p_phone           text,
  p_started_at      timestamptz,
  p_ended_at        timestamptz,
  p_outcome         text,
  p_session_id      text DEFAULT NULL,
  p_client_id       uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_answered_at     timestamptz DEFAULT NULL,
  p_end_reason      text DEFAULT NULL,
  p_recording_path  text DEFAULT NULL,
  p_recording_mime  text DEFAULT NULL,
  p_recording_bytes bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := p_client_id;
  v_digits    text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_duration  integer;
  v_id        uuid;
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'sem permissão para registrar chamadas';
  END IF;

  -- Sem cliente informado, tenta o cadastro pelos 8 últimos dígitos. Casando
  -- com mais de uma ficha, não escolhe nenhuma: um registro no cliente errado é
  -- pior do que um registro sem cliente.
  IF v_client_id IS NULL AND length(v_digits) >= 8 THEN
    -- Uma consulta só decide "existe exatamente uma ficha com este número?" e
    -- já devolve qual é. `array_agg` no lugar de `min` porque o Postgres não
    -- tem `min(uuid)`; o `LIMIT 2` de dentro basta para distinguir uma de
    -- várias sem varrer o cadastro inteiro.
    SELECT (array_agg(t.id))[1] INTO v_client_id
      FROM (
        SELECT c.id
          FROM public.clients c
         WHERE c.merged_into_client_id IS NULL
           AND (
             right(regexp_replace(coalesce(c.mobile, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
             OR right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8) = right(v_digits, 8)
           )
         LIMIT 2
      ) t
     -- Duas fichas com o mesmo número (marido e esposa, empresa e sócio) não
     -- dão empate resolvido no chute: o registro fica sem cliente e a chamada
     -- ainda aparece na busca por número.
     HAVING count(*) = 1;
  END IF;

  v_duration := GREATEST(0, COALESCE(
    EXTRACT(EPOCH FROM (p_ended_at - COALESCE(p_answered_at, p_ended_at)))::integer, 0));

  INSERT INTO public.whatsapp_call_logs AS l (
    call_id, session_id, direction, phone, client_id, conversation_id, user_id,
    started_at, answered_at, ended_at, duration_seconds, end_reason, outcome,
    recording_path, recording_mime, recording_bytes
  ) VALUES (
    p_call_id, p_session_id, p_direction, v_digits, v_client_id, p_conversation_id,
    CASE WHEN p_answered_at IS NULL THEN NULL ELSE auth.uid() END,
    p_started_at, p_answered_at, p_ended_at, v_duration, p_end_reason, p_outcome,
    p_recording_path, p_recording_mime, p_recording_bytes
  )
  ON CONFLICT (call_id) DO UPDATE SET
    -- Quem atendeu manda: uma aba que só viu tocar não rebaixa o registro de
    -- quem falou. O contrário (promover "perdida" a "atendida") é permitido.
    answered_at      = COALESCE(l.answered_at, EXCLUDED.answered_at),
    user_id          = COALESCE(l.user_id, EXCLUDED.user_id),
    ended_at         = GREATEST(l.ended_at, EXCLUDED.ended_at),
    duration_seconds = GREATEST(l.duration_seconds, EXCLUDED.duration_seconds),
    outcome          = CASE WHEN l.outcome = 'answered' THEN l.outcome ELSE EXCLUDED.outcome END,
    end_reason       = COALESCE(EXCLUDED.end_reason, l.end_reason),
    client_id        = COALESCE(l.client_id, EXCLUDED.client_id),
    conversation_id  = COALESCE(l.conversation_id, EXCLUDED.conversation_id),
    recording_path   = COALESCE(EXCLUDED.recording_path, l.recording_path),
    recording_mime   = COALESCE(EXCLUDED.recording_mime, l.recording_mime),
    recording_bytes  = COALESCE(EXCLUDED.recording_bytes, l.recording_bytes)
  RETURNING l.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_log_call(text, text, text, timestamptz, timestamptz, text, text, uuid, uuid, timestamptz, text, text, text, bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_log_call(text, text, text, timestamptz, timestamptz, text, text, uuid, uuid, timestamptz, text, text, text, bigint) TO authenticated;

COMMENT ON TABLE public.whatsapp_call_logs IS
  'Registro das chamadas de voz do WhatsApp (WaCalls): horário, duração, desfecho e a gravação, quando o operador gravou.';
