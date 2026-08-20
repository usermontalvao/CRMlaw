-- ============================================================
-- As reações que já estavam no banco viram pastilha
--
-- Antes de existir a coluna `reactions`, toda reação recebida virava uma
-- MENSAGEM na thread, escrita "Reagiu com 👍". São 19 bolhas soltas no
-- histórico, cada uma logo abaixo da mensagem que ela comenta — o ruído que a
-- coluna nova veio tirar da tela. Elas não se consertam sozinhas: o webhook novo
-- só cuida das que chegarem daqui para frente.
--
-- Aqui cada uma é lida do `raw` (que guarda a chave da mensagem-alvo e o emoji),
-- gravada na mensagem certa e então REMOVIDA da thread. Removida de verdade, e
-- não marcada como apagada: "Esta mensagem foi apagada" no lugar da bolha de
-- reação seria trocar um ruído por outro pior.
--
-- Três cuidados:
--  · a reação cujo alvo não existe mais aqui FICA como estava — sem alvo, não há
--    onde pendurar a pastilha, e apagar a linha perderia o registro de que a
--    pessoa reagiu;
--  · a ordem é cronológica, para que a última reação da mesma pessoa seja a que
--    vale (é a regra de `aplicarReacao`: uma por ator);
--  · linha citada por uma execução da IA ou por um agendamento também fica —
--    as chaves estrangeiras são ON DELETE SET NULL e apagá-la cortaria o
--    rastro de auditoria em silêncio.
-- ============================================================

DO $$
DECLARE
  r record;
  v_actor text;
  v_gravou integer;
  v_convertidas uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT m.id,
           m.direction,
           m.wa_timestamp,
           m.raw->'message'->'reactionMessage'->>'text' AS emoji,
           m.raw->'message'->'reactionMessage'->'key'->>'id' AS alvo_evo_id
      FROM public.whatsapp_messages m
     WHERE m.type = 'reaction'
       AND m.raw->'message'->'reactionMessage'->'key'->>'id' IS NOT NULL
     ORDER BY m.wa_timestamp
  LOOP
    CONTINUE WHEN coalesce(r.emoji, '') = '';
    v_actor := CASE WHEN r.direction = 'out' THEN 'office' ELSE 'contact' END;

    WITH alvo AS (
      SELECT id, reactions FROM public.whatsapp_messages
       WHERE evolution_message_id = r.alvo_evo_id
       ORDER BY wa_timestamp
       LIMIT 1
    ), gravada AS (
      UPDATE public.whatsapp_messages t
         SET reactions = (
               SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
                 FROM jsonb_array_elements(t.reactions) x
                WHERE x->>'actor' IS DISTINCT FROM v_actor
             ) || jsonb_build_array(jsonb_build_object(
               'emoji', r.emoji,
               'from',  CASE WHEN r.direction = 'out' THEN 'out' ELSE 'in' END,
               'actor', v_actor,
               'name',  NULL,
               'at',    to_char(r.wa_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             ))
        FROM alvo
       WHERE t.id = alvo.id
      RETURNING t.id
    )
    -- `count(*)` e não `RETURNING` direto: uma CTE que não atualizou nada volta
    -- SEM LINHA, e um `SELECT ... INTO` sem linha zera a variável em silêncio —
    -- a lista de convertidas viraria nula no meio do laço.
    SELECT count(*) INTO v_gravou FROM gravada;
    IF v_gravou > 0 THEN
      v_convertidas := array_append(v_convertidas, r.id);
    END IF;
  END LOOP;

  DELETE FROM public.whatsapp_messages m
   WHERE m.id = ANY (v_convertidas)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_ai_executions e WHERE e.trigger_message_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_scheduled_messages s WHERE s.sent_message_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages o WHERE o.reply_to_id = m.id);

  RAISE NOTICE 'reações convertidas: %', coalesce(array_length(v_convertidas, 1), 0);
END $$;
