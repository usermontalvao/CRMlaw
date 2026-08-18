-- O LID ganha um campo próprio no registro da chamada — e para de virar telefone.
--
-- O QUE FALTAVA. A migration `20260818010000_whatsapp_lid_map.sql` deu ao LID um
-- lugar na CONVERSA (`contact_lid`) e ensinou o CRM a consultá-lo. Mas o
-- registro da chamada continuou sem lugar nenhum para guardá-lo: quando o
-- convite chegava só com `<n>@lid` e o mapeamento ainda não conhecia aquele
-- apelido, a correção de leitura fazia a coisa certa (não inventar telefone) e
-- a coisa incompleta (jogar o LID fora). O resultado está no banco:
--
--   ...  inbound  phone=''                started_at 18/08 01:20  sem conversa
--   ...  inbound  phone=''                started_at 18/08 01:26  sem conversa
--
-- Duas ligações da mesma pessoa, anônimas para sempre — nem sequer dá para
-- dizer que as duas são da MESMA pessoa. E antes da correção o defeito era pior,
-- porque o apelido entrava no campo do telefone:
--
--   ...  inbound  phone='252677908865131'  (é LID, e o painel escreveu "+252…")
--   ...  inbound  phone='16758979195047'   (idem)
--
-- ESTA MIGRATION FAZ TRÊS COISAS:
--
--  1. `peer_lid`: o apelido é guardado como o que ele é, ao lado do telefone e
--     nunca no lugar dele. Uma chamada anônima hoje pode ser reconhecida amanhã,
--     quando o mapeamento aprender aquele LID — o dado não se perde mais.
--
--  2. A invariante `phone <> peer_lid`, no banco. É exatamente o defeito que
--     aconteceu, dito em uma linha que o Postgres cobra. Não é um teste de
--     formato (um cliente estrangeiro tem MSISDN de tamanho inesperado e não
--     pode ser recusado); é a proibição de copiar o apelido para o campo errado.
--
--  3. A APRENDIZAGEM POR CALLBACK. É a fonte de evidência que faltava, e a
--     razão de ela ser confiável está explicada em `wa_lid_from_callback`.

-- ── 1. O campo ───────────────────────────────────────────────────────────────

ALTER TABLE public.whatsapp_call_logs
  ADD COLUMN IF NOT EXISTS peer_lid text;

COMMENT ON COLUMN public.whatsapp_call_logs.peer_lid IS
  'Apelido interno do WhatsApp (LID) do outro lado da chamada, só dígitos. NÃO é telefone e nunca pode ser discado: existe para reconhecer depois quem ligou quando o convite veio endereçado por LID.';

-- Reparo do que já está gravado: o que está no campo `phone` e é longo demais
-- para ser um MSISDN só pode ser o apelido que o código antigo copiou para lá.
-- 13 é o teto de um telefone brasileiro (55 + DDD + 9 dígitos) e o teto que o
-- `toWaCallsPhone` produz; o E.164 inteiro para em 15, mas nenhuma dessas
-- linhas veio de um número estrangeiro — as duas são LID da mesma origem.
UPDATE public.whatsapp_call_logs
   SET peer_lid = phone,
       phone    = ''
 WHERE peer_lid IS NULL
   AND phone ~ '^\d{14,}$';

-- A invariante, agora que o passado está limpo.
ALTER TABLE public.whatsapp_call_logs
  DROP CONSTRAINT IF EXISTS whatsapp_call_logs_lid_nao_e_telefone;
ALTER TABLE public.whatsapp_call_logs
  ADD CONSTRAINT whatsapp_call_logs_lid_nao_e_telefone
  CHECK (peer_lid IS NULL OR phone IS NULL OR phone = '' OR phone <> peer_lid);

-- A consulta que importa é "quais chamadas ainda estão anônimas?" — a varredura
-- que roda quando o mapeamento aprende um apelido novo. Parcial: as resolvidas
-- não entram no índice, e elas são a maioria.
CREATE INDEX IF NOT EXISTS whatsapp_call_logs_peer_lid_pendente_idx
  ON public.whatsapp_call_logs (peer_lid)
  WHERE peer_lid IS NOT NULL AND conversation_id IS NULL;

-- ── 2. O registro passa a aceitar o LID ──────────────────────────────────────

/**
 * Registra (ou completa) uma chamada — agora guardando o LID separadamente.
 *
 * Mesma função de `20260817233000_whatsapp_call_logs.sql`, com duas mudanças:
 *
 *  · `p_peer_lid` entra e é guardado como apelido, jamais como telefone. A
 *    trava não fica só no `CHECK`: se quem chamou mandar o LID nos dois campos
 *    (foi o defeito de origem), o telefone é ESVAZIADO aqui e a chamada é
 *    registrada honestamente como "não identificada" em vez de ser recusada —
 *    perder o registro da ligação seria pior do que registrá-la sem número.
 *
 *  · a descoberta do cliente pelo telefone só roda com telefone de verdade.
 *    Antes, `length(v_digits) >= 8` deixava um LID de 15 dígitos entrar na
 *    busca do cadastro e casar com qualquer ficha cujos 8 últimos dígitos
 *    coincidissem por acaso.
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
  p_recording_bytes bigint DEFAULT NULL,
  p_peer_lid        text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := p_client_id;
  v_digits    text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_lid       text := nullif(regexp_replace(coalesce(p_peer_lid, ''), '\D', '', 'g'), '');
  v_duration  integer;
  v_id        uuid;
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'sem permissão para registrar chamadas';
  END IF;

  -- O apelido não ocupa o lugar do número. Nem quando quem chamou insiste.
  IF v_lid IS NOT NULL AND v_digits = v_lid THEN
    v_digits := '';
  END IF;
  -- E o que tem cara de apelido também não: nenhum caminho deste CRM produz um
  -- "telefone" com mais de 13 dígitos.
  IF length(v_digits) > 13 THEN
    IF v_lid IS NULL THEN v_lid := v_digits; END IF;
    v_digits := '';
  END IF;

  -- Sem cliente informado, tenta o cadastro pelos 8 últimos dígitos. Casando
  -- com mais de uma ficha, não escolhe nenhuma: um registro no cliente errado é
  -- pior do que um registro sem cliente.
  IF v_client_id IS NULL AND v_digits ~ '^\d{10,13}$' THEN
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
     HAVING count(*) = 1;
  END IF;

  v_duration := GREATEST(0, COALESCE(
    EXTRACT(EPOCH FROM (p_ended_at - COALESCE(p_answered_at, p_ended_at)))::integer, 0));

  INSERT INTO public.whatsapp_call_logs AS l (
    call_id, session_id, direction, phone, peer_lid, client_id, conversation_id, user_id,
    started_at, answered_at, ended_at, duration_seconds, end_reason, outcome,
    recording_path, recording_mime, recording_bytes
  ) VALUES (
    p_call_id, p_session_id, p_direction, v_digits, v_lid, v_client_id, p_conversation_id,
    CASE WHEN p_answered_at IS NULL THEN NULL ELSE auth.uid() END,
    p_started_at, p_answered_at, p_ended_at, v_duration, p_end_reason, p_outcome,
    p_recording_path, p_recording_mime, p_recording_bytes
  )
  ON CONFLICT (call_id) DO UPDATE SET
    answered_at      = COALESCE(l.answered_at, EXCLUDED.answered_at),
    user_id          = COALESCE(l.user_id, EXCLUDED.user_id),
    ended_at         = GREATEST(l.ended_at, EXCLUDED.ended_at),
    duration_seconds = GREATEST(l.duration_seconds, EXCLUDED.duration_seconds),
    outcome          = CASE WHEN l.outcome = 'answered' THEN l.outcome ELSE EXCLUDED.outcome END,
    end_reason       = COALESCE(EXCLUDED.end_reason, l.end_reason),
    client_id        = COALESCE(l.client_id, EXCLUDED.client_id),
    conversation_id  = COALESCE(l.conversation_id, EXCLUDED.conversation_id),
    -- A aba que descobriu o telefone completa a que só viu o apelido; o
    -- contrário (apagar um telefone já resolvido) nunca acontece.
    phone            = CASE WHEN l.phone IS NULL OR l.phone = '' THEN EXCLUDED.phone ELSE l.phone END,
    peer_lid         = COALESCE(l.peer_lid, EXCLUDED.peer_lid),
    recording_path   = COALESCE(EXCLUDED.recording_path, l.recording_path),
    recording_mime   = COALESCE(EXCLUDED.recording_mime, l.recording_mime),
    recording_bytes  = COALESCE(EXCLUDED.recording_bytes, l.recording_bytes)
  RETURNING l.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_log_call(text, text, text, timestamptz, timestamptz, text, text, uuid, uuid, timestamptz, text, text, text, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_log_call(text, text, text, timestamptz, timestamptz, text, text, uuid, uuid, timestamptz, text, text, text, bigint, text) TO authenticated;

-- A assinatura antiga (sem `p_peer_lid`) sai de circulação: mantê-la deixaria o
-- PostgREST escolher entre duas sobrecargas e o navegador com cache antigo
-- continuaria gravando chamada sem LID sem ninguém perceber.
DROP FUNCTION IF EXISTS public.wa_log_call(text, text, text, timestamptz, timestamptz, text, text, uuid, uuid, timestamptz, text, text, text, bigint);

-- ── 3. Aprender o LID por callback ───────────────────────────────────────────

/**
 * De quem é este LID? — a pergunta feita ao HISTÓRICO DE CHAMADAS.
 *
 * O mapeamento (`wa_phone_by_lid`) responde quando alguém já registrou aquele
 * apelido. Quando ninguém registrou, sobra uma segunda evidência, e ela é forte:
 *
 *     23:28:51  SAÍDA   para 556596128787   (nós discamos: sabemos o número)
 *     23:29:42  ENTRADA de 252677908865131@lid
 *
 * Ligamos para alguém, desligamos, e a pessoa ligou de volta. O apelido que
 * chegou é o daquele número — não por serem próximos no relógio, mas porque a
 * MESMA sessão do WhatsApp discou aquele número e mais nenhum outro na janela.
 *
 * PROXIMIDADE DE HORÁRIO NÃO BASTA, e é por isso que há quatro travas:
 *
 *   1. MESMA SESSÃO (`session_id`). Duas linhas do escritório ligando ao mesmo
 *      tempo são dois telefones diferentes; correlacionar entre sessões
 *      atribuiria a ligação de um canal ao contato do outro.
 *   2. UM ÚNICO DESTINO NA JANELA. Se a sessão discou para dois números
 *      distintos antes do callback, não há como saber qual voltou — e o palpite
 *      colocaria o nome errado numa ligação. Empate não se resolve no chute:
 *      recusa.
 *   3. UM ÚNICO APELIDO NA JANELA. O espelho da trava anterior. Se duas pessoas
 *      diferentes ligaram por LID depois da mesma saída, uma delas é o callback
 *      e a outra não — e não dá para dizer qual.
 *   4. O APELIDO NÃO PODE JÁ SER DE OUTRO. Se aquele LID já está registrado em
 *      outra conversa, a evidência mais antiga (confirmada) manda.
 *
 * NÃO ESCREVE NADA: devolve o telefone e para. Quem chama é que registra o
 * mapeamento (`wa_link_lid`), e é de propósito — a evidência é lida no meio de
 * um convite tocando, e uma consulta que não escreve pode ser refeita, testada
 * e cancelada sem deixar rastro no cadastro de ninguém.
 *
 * SECURITY DEFINER pelo mesmo motivo de `wa_phone_by_lid`: a chamada toca para
 * o escritório inteiro e quem atende nem sempre enxerga aquela conversa.
 */
CREATE OR REPLACE FUNCTION public.wa_lid_from_callback(
  p_lid            text,
  p_session_id     text,
  p_at             timestamptz DEFAULT now(),
  p_window_minutes integer DEFAULT 15
) RETURNS TABLE (contact_phone text, contact_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lid    text := regexp_replace(coalesce(p_lid, ''), '\D', '', 'g');
  v_desde  timestamptz := p_at - make_interval(mins => GREATEST(1, LEAST(60, coalesce(p_window_minutes, 15))));
  v_phone  text;
  v_outros integer;
BEGIN
  IF NOT public.is_office_staff() THEN RETURN; END IF;
  IF v_lid = '' OR coalesce(p_session_id, '') = '' THEN RETURN; END IF;

  -- Trava 4: apelido já registrado pertence a quem o registrou primeiro.
  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE contact_lid = v_lid) THEN
    RETURN;
  END IF;

  -- Travas 1 e 2: um único destino discado por ESTA sessão na janela.
  SELECT (array_agg(DISTINCT l.phone))[1] INTO v_phone
    FROM public.whatsapp_call_logs l
   WHERE l.session_id = p_session_id
     AND l.direction = 'outbound'
     AND l.started_at BETWEEN v_desde AND p_at
     AND l.phone ~ '^\d{12,13}$'
   HAVING count(DISTINCT l.phone) = 1;
  IF v_phone IS NULL THEN RETURN; END IF;

  -- Trava 3: nenhum OUTRO apelido chegou nesta sessão dentro da janela.
  SELECT count(DISTINCT l.peer_lid) INTO v_outros
    FROM public.whatsapp_call_logs l
   WHERE l.session_id = p_session_id
     AND l.direction = 'inbound'
     AND l.peer_lid IS NOT NULL
     AND l.peer_lid <> v_lid
     AND l.started_at BETWEEN v_desde AND p_at + interval '2 minutes';
  IF coalesce(v_outros, 0) > 0 THEN RETURN; END IF;

  RETURN QUERY
    SELECT c.contact_phone, c.contact_name
      FROM public.whatsapp_conversations c
     WHERE c.contact_phone = v_phone
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_lid_from_callback(text, text, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_lid_from_callback(text, text, timestamptz, integer) TO authenticated;

-- ── 4. Reprocessar o que ficou anônimo ───────────────────────────────────────

/**
 * Devolve identidade às chamadas que foram registradas só com o apelido.
 *
 * Roda depois de o mapeamento aprender um LID — pelo callback acima, pelo
 * webhook ou pela mão de alguém. Percorre as chamadas sem conversa que têm
 * `peer_lid`, consulta o mapeamento e preenche telefone, conversa e cliente.
 *
 * Só ESCREVE onde estava vazio: uma chamada que já tem conversa não é mexida, e
 * o telefone que vem daqui é sempre o da conversa mapeada — nunca o apelido.
 */
CREATE OR REPLACE FUNCTION public.wa_resolve_call_lids(p_lid text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lid   text := nullif(regexp_replace(coalesce(p_lid, ''), '\D', '', 'g'), '');
  v_count integer;
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION 'sem permissão para reprocessar chamadas';
  END IF;

  WITH alvo AS (
    SELECT l.id,
           c.id            AS conversation_id,
           c.client_id     AS client_id,
           c.contact_phone AS phone
      FROM public.whatsapp_call_logs l
      JOIN LATERAL (
        SELECT k.id, k.client_id, k.contact_phone
          FROM public.whatsapp_conversations k
         WHERE k.contact_lid = l.peer_lid
           AND k.contact_phone ~ '^\d{12,13}$'
         ORDER BY k.last_message_at DESC NULLS LAST
         LIMIT 1
      ) c ON true
     WHERE l.peer_lid IS NOT NULL
       AND l.conversation_id IS NULL
       AND (v_lid IS NULL OR l.peer_lid = v_lid)
  )
  UPDATE public.whatsapp_call_logs l
     SET conversation_id = alvo.conversation_id,
         client_id       = COALESCE(l.client_id, alvo.client_id),
         phone           = CASE WHEN l.phone IS NULL OR l.phone = '' THEN alvo.phone ELSE l.phone END
    FROM alvo
   WHERE l.id = alvo.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.wa_resolve_call_lids(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_resolve_call_lids(text) TO authenticated;
