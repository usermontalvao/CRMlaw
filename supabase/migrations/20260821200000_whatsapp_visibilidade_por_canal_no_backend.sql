-- ============================================================================
-- WhatsApp — a regra do CANAL passa a valer para TUDO que sai do banco.
--
-- O QUE ESTAVA ERRADO
-- -------------------
-- A visibilidade por canal (`wa_can_see_conv`, migration 20260804131047) só
-- estava ligada em três lugares: `whatsapp_conversations`, `whatsapp_messages`
-- e `whatsapp_internal_notes`. Por isso abrir a conversa de um canal alheio não
-- mostrava mensagem nenhuma — a thread lê `whatsapp_messages` — enquanto a
-- LATERAL da inbox continuava contando a história do atendimento por outros
-- caminhos, todos parando em `is_office_staff()`:
--
--   · `whatsapp_call_logs`     → aba "Ligações": telefone, nome, foto, horário,
--                                duração e desfecho de TODAS as chamadas;
--   · `whatsapp_attendance_events` → quem assumiu/encerrou o quê, e quando;
--   · `whatsapp_transfers`     → o roster de quem passou por cada conversa;
--   · `whatsapp_ai_*`          → texto de entrada e de resposta do agente;
--   · `whatsapp_contact_blocks`→ telefone bloqueado e por quem;
--   · `whatsapp_dashboard_stats()` → contadores do escritório inteiro;
--   · o broadcast `whatsapp:messages` → 120 caracteres da mensagem, no fio, para
--                                toda aba aberta do escritório.
--
-- E havia dois caminhos de ESCALADA, que nenhum filtro de tela pega:
--   · as policies de UPDATE/DELETE de conversas e mensagens só exigiam
--     `is_office_staff()` — um PATCH direto no PostgREST com `assigned_user_id`
--     apontando para si mesmo dava visibilidade permanente sobre a conversa;
--   · as RPCs de atendimento (assumir, transferir, encerrar, marcar lida…) são
--     SECURITY DEFINER e não conferiam visibilidade nenhuma: bastava o id da
--     conversa para agir sobre — e passar a enxergar — o que era de outro canal.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Uma regra só, aplicada ANTES da consulta, em todo dado derivado de conversa.
-- `wa_can_see_conv_id(uuid)` é a mesma regra de sempre, agora endereçável pelo
-- id da conversa, e é ela que as policies novas chamam. Nada aqui depende de
-- id, canal ou permissão que venham do cliente: tudo sai de `auth.uid()`.
--
-- O QUE NÃO MUDA: administrador continua enxergando o que a regra atual já lhe
-- dá; quem é responsável pela conversa, ou participou de uma transferência
-- dela, continua enxergando o atendimento mesmo sem ser membro do canal.
-- ============================================================================

-- ── 1. Helpers ──────────────────────────────────────────────────────────────

-- A regra de sempre, endereçada pelo id. SECURITY DEFINER porque ela precisa
-- LER a conversa para decidir — e quem não pode vê-la é justamente quem está
-- perguntando. NULL devolve false: "não sei qual conversa" nunca é permissão.
CREATE OR REPLACE FUNCTION public.wa_can_see_conv_id(p_conv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
     WHERE c.id = p_conv
       AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
  );
$$;

-- Uma CHAMADA não tem canal próprio (`whatsapp_call_logs` não guarda
-- `instance_id`), então ela herda o do atendimento a que pertence:
--
--   · a MINHA ligação é minha — quem discou ou atendeu vê o próprio registro,
--     e esta é a primeira pergunta porque é a mais barata e a mais comum;
--   · supervisor enxerga tudo, como no resto do módulo;
--   · ligação AMARRADA a uma conversa: quem decide é aquela conversa, e só
--     ela. Não vale procurar uma segunda conversa do mesmo número em canal
--     permitido — a ligação pertence ao atendimento em que foi registrada;
--   · ligação SEM conversa amarrada: casa pelo TELEFONE (os 8 últimos dígitos,
--     a mesma tolerância ao nono dígito que a agenda e a ficha do cliente
--     usam), e aparece se alguma conversa visível for daquele número;
--   · número que não pertence a conversa NENHUMA continua visível: ele não é
--     dado de canal algum, e esconder a perdida de um número desconhecido
--     apagaria a única tela que responde "quem ligou e ninguém atendeu?".
--
-- O `offset 0` é cerca de otimizador: sem ele o planejador mistura o casamento
-- por telefone com a checagem de visibilidade e avalia a regra inteira para
-- cada conversa da base, por linha de chamada. O índice logo abaixo é o que
-- faz o casamento por telefone ser uma busca, e não uma varredura.
CREATE OR REPLACE FUNCTION public.wa_can_see_call(p_conv uuid, p_phone text, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_office_staff() AND (
    (p_user IS NOT NULL AND p_user = auth.uid())
    OR public.wa_is_supervisor()
    OR CASE WHEN p_conv IS NOT NULL THEN public.wa_can_see_conv_id(p_conv)
       ELSE (
         EXISTS (
           SELECT 1 FROM (
             SELECT k.instance_id, k.department_id, k.assigned_user_id, k.id
               FROM public.whatsapp_conversations k
              WHERE length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
                AND right(regexp_replace(coalesce(k.contact_phone, ''), '\D', '', 'g'), 8)
                  = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8)
              OFFSET 0
           ) c
          WHERE public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.whatsapp_conversations k
            WHERE right(regexp_replace(coalesce(k.contact_phone, ''), '\D', '', 'g'), 8)
                = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8)
         )
       ) END
  );
$$;

-- O casamento por telefone da regra acima, indexado. Sem ele, cada linha de
-- chamada varre a tabela de conversas inteira: 141 chamadas × 221 conversas na
-- base de hoje, e pior a cada mês. A expressão precisa ser IDÊNTICA à da
-- função, senão o índice não é usado e o custo volta em silêncio.
CREATE INDEX IF NOT EXISTS idx_wa_conv_telefone_8
  ON public.whatsapp_conversations
  (right(regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g'), 8));

REVOKE EXECUTE ON FUNCTION public.wa_can_see_conv_id(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.wa_can_see_call(uuid, text, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.wa_can_see_conv_id(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.wa_can_see_call(uuid, text, uuid) TO authenticated;

-- ── 2. Conversas e mensagens: fechar a escalada por ESCRITA ─────────────────
--
-- O SELECT já era recortado. O UPDATE/DELETE não era, e escrever numa linha que
-- não se pode ler é como se lê: `PATCH /whatsapp_conversations?id=eq.<id>` com
-- `assigned_user_id` = eu mesmo torna a conversa minha — e, sendo minha, ela
-- passa a ser visível pela própria regra.
--
-- O WITH CHECK continua em `is_office_staff()` de propósito: transferir uma
-- conversa PARA FORA do próprio escopo tem de continuar possível (é o que a
-- migration 20260614140000 já dizia). O que se exige é poder vê-la ANTES.
DROP POLICY IF EXISTS wa_conv_update ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_delete ON public.whatsapp_conversations;
CREATE POLICY wa_conv_update ON public.whatsapp_conversations FOR UPDATE TO authenticated
  USING (public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_conv_delete ON public.whatsapp_conversations FOR DELETE TO authenticated
  USING (public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id));

DROP POLICY IF EXISTS wa_msg_update ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_delete ON public.whatsapp_messages;
CREATE POLICY wa_msg_update ON public.whatsapp_messages FOR UPDATE TO authenticated
  USING (public.wa_can_see_conv_id(conversation_id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_msg_delete ON public.whatsapp_messages FOR DELETE TO authenticated
  USING (public.wa_can_see_conv_id(conversation_id));

-- ── 3. Ligações ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS wa_call_logs_select ON public.whatsapp_call_logs;
DROP POLICY IF EXISTS wa_call_logs_update ON public.whatsapp_call_logs;
DROP POLICY IF EXISTS wa_call_logs_delete ON public.whatsapp_call_logs;
CREATE POLICY wa_call_logs_select ON public.whatsapp_call_logs FOR SELECT TO authenticated
  USING (public.wa_can_see_call(conversation_id, phone, user_id));
CREATE POLICY wa_call_logs_update ON public.whatsapp_call_logs FOR UPDATE TO authenticated
  USING (public.wa_can_see_call(conversation_id, phone, user_id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_call_logs_delete ON public.whatsapp_call_logs FOR DELETE TO authenticated
  USING (public.wa_can_see_call(conversation_id, phone, user_id));

-- ── 4. Eventos de atendimento (quem assumiu, transferiu, encerrou) ──────────
DROP POLICY IF EXISTS wa_attendance_events_select ON public.whatsapp_attendance_events;
CREATE POLICY wa_attendance_events_select ON public.whatsapp_attendance_events FOR SELECT TO authenticated
  USING (
    public.is_office_staff()
    AND (actor_id = auth.uid() OR public.wa_can_see_conv_id(primary_conversation_id))
  );

-- ── 5. Transferências ───────────────────────────────────────────────────────
-- A escrita continua como estava (as RPCs de atendimento é que gravam aqui, e
-- elas são SECURITY DEFINER); só a LEITURA passa a seguir a conversa.
DROP POLICY IF EXISTS wa_transfers_staff ON public.whatsapp_transfers;
DROP POLICY IF EXISTS wa_transfers_select ON public.whatsapp_transfers;
DROP POLICY IF EXISTS wa_transfers_insert ON public.whatsapp_transfers;
DROP POLICY IF EXISTS wa_transfers_update ON public.whatsapp_transfers;
DROP POLICY IF EXISTS wa_transfers_delete ON public.whatsapp_transfers;
CREATE POLICY wa_transfers_select ON public.whatsapp_transfers FOR SELECT TO authenticated
  USING (
    public.is_office_staff()
    AND (
      auth.uid() IN (from_user_id, to_user_id, performed_by, accepted_by)
      OR public.wa_can_see_conv_id(conversation_id)
    )
  );
CREATE POLICY wa_transfers_insert ON public.whatsapp_transfers FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_transfers_update ON public.whatsapp_transfers FOR UPDATE TO authenticated
  USING (public.is_office_staff()) WITH CHECK (public.is_office_staff());
CREATE POLICY wa_transfers_delete ON public.whatsapp_transfers FOR DELETE TO authenticated
  USING (public.is_office_staff());

-- ── 6. Bloqueios de contato ────────────────────────────────────────────────
DROP POLICY IF EXISTS wa_blocks_staff ON public.whatsapp_contact_blocks;
DROP POLICY IF EXISTS wa_blocks_select ON public.whatsapp_contact_blocks;
DROP POLICY IF EXISTS wa_blocks_insert ON public.whatsapp_contact_blocks;
DROP POLICY IF EXISTS wa_blocks_update ON public.whatsapp_contact_blocks;
DROP POLICY IF EXISTS wa_blocks_delete ON public.whatsapp_contact_blocks;
CREATE POLICY wa_blocks_select ON public.whatsapp_contact_blocks FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_blocks_insert ON public.whatsapp_contact_blocks FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_blocks_update ON public.whatsapp_contact_blocks FOR UPDATE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_blocks_delete ON public.whatsapp_contact_blocks FOR DELETE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

-- ── 7. Rastros do agente de IA ──────────────────────────────────────────────
-- Todos guardam texto do atendimento (o que o cliente escreveu, o que a IA
-- respondeu, o que ela coletou). A escrita destes vem das Edge Functions com
-- service role — que ignora RLS —, então o que se recorta aqui é a leitura.
DROP POLICY IF EXISTS wa_ai_executions_staff_read ON public.whatsapp_ai_executions;
CREATE POLICY wa_ai_executions_staff_read ON public.whatsapp_ai_executions FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_runs_staff_read ON public.whatsapp_ai_runs;
CREATE POLICY wa_ai_runs_staff_read ON public.whatsapp_ai_runs FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_state_staff_read ON public.whatsapp_ai_agent_state;
CREATE POLICY wa_ai_state_staff_read ON public.whatsapp_ai_agent_state FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_approvals_staff_read ON public.whatsapp_ai_tool_approvals;
CREATE POLICY wa_ai_approvals_staff_read ON public.whatsapp_ai_tool_approvals FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_followups_staff_read ON public.whatsapp_ai_followups;
CREATE POLICY wa_ai_followups_staff_read ON public.whatsapp_ai_followups FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));
-- (o UPDATE de followup — cancelar um acompanhamento — segue como estava, mas
--  só sobre o que se enxerga.)
DROP POLICY IF EXISTS wa_ai_followups_staff_update ON public.whatsapp_ai_followups;
CREATE POLICY wa_ai_followups_staff_update ON public.whatsapp_ai_followups FOR UPDATE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK (public.is_office_staff());

-- `whatsapp_ai_sessions` e `whatsapp_ai_meeting_requests` tinham policy FOR ALL:
-- o recorte entra na leitura e a escrita fica exatamente como era.
DROP POLICY IF EXISTS ai_sessions_staff ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_select ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_insert ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_update ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_delete ON public.whatsapp_ai_sessions;
CREATE POLICY ai_sessions_select ON public.whatsapp_ai_sessions FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY ai_sessions_insert ON public.whatsapp_ai_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY ai_sessions_update ON public.whatsapp_ai_sessions FOR UPDATE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY ai_sessions_delete ON public.whatsapp_ai_sessions FOR DELETE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_meetings_staff ON public.whatsapp_ai_meeting_requests;
DROP POLICY IF EXISTS wa_ai_meetings_staff_read ON public.whatsapp_ai_meeting_requests;
DROP POLICY IF EXISTS wa_ai_meetings_select ON public.whatsapp_ai_meeting_requests;
DROP POLICY IF EXISTS wa_ai_meetings_insert ON public.whatsapp_ai_meeting_requests;
DROP POLICY IF EXISTS wa_ai_meetings_update ON public.whatsapp_ai_meeting_requests;
DROP POLICY IF EXISTS wa_ai_meetings_delete ON public.whatsapp_ai_meeting_requests;
CREATE POLICY wa_ai_meetings_select ON public.whatsapp_ai_meeting_requests FOR SELECT TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_ai_meetings_insert ON public.whatsapp_ai_meeting_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_ai_meetings_update ON public.whatsapp_ai_meeting_requests FOR UPDATE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK (public.is_office_staff());
CREATE POLICY wa_ai_meetings_delete ON public.whatsapp_ai_meeting_requests FOR DELETE TO authenticated
  USING (public.is_office_staff() AND public.wa_can_see_conv_id(conversation_id));

-- ── 8. RPCs de atendimento: id de conversa não é permissão ──────────────────
--
-- As nove RPCs de atendimento são SECURITY DEFINER — elas existem justamente
-- para escrever em linhas-irmãs que o RLS do chamador não alcança. O preço
-- disso é que a policy da tabela não as protege: quem conhecesse (ou chutasse)
-- um id de conversa podia assumir, transferir, encerrar, reabrir ou marcar como
-- lida uma conversa de canal alheio — e "assumir" devolve visibilidade, porque
-- ser responsável é uma das portas da regra.
--
-- A trava entra logo depois de a conversa ser carregada, quando já se sabe
-- canal, setor e responsável dela. O 42501 é o mesmo código que as RPCs já usam
-- para "sessão inválida" e chega ao cliente como HTTP 403.
--
-- Por que remendo de texto e não nove corpos copiados: copiar 400 linhas de
-- lógica de atendimento para inserir duas linhas de guarda convida ao erro de
-- transcrição. A âncora é única em cada função, o remendo é idempotente (função
-- que já cite `wa_can_see_conv` é pulada) e o bloco de verificação no fim
-- FALHA a migration se alguma delas ficar sem a trava.
DO $patch$
DECLARE
  v_nome  text;
  v_def   text;
  v_anc   text;
  v_falta text[] := '{}';
  v_guarda constant text :=
    E'\n  IF NOT public.wa_can_see_conv(v_selected.instance_id, v_selected.department_id, v_selected.assigned_user_id, v_selected.id) THEN\n'
    || E'    RAISE EXCEPTION USING ERRCODE = ''42501'', MESSAGE = ''Você não tem acesso a este atendimento.'';\n'
    || E'  END IF;';
  v_alvos constant text[] := ARRAY[
    'wa_assume_contact_attendance', 'wa_assign_contact_attendance',
    'wa_transfer_contact_attendance', 'wa_accept_contact_transfer',
    'wa_release_contact_attendance', 'wa_close_contact_attendance',
    'wa_reopen_contact_attendance', 'wa_mark_contact_read', 'wa_mark_contact_unread'
  ];
BEGIN
  FOREACH v_nome IN ARRAY v_alvos LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_nome;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'RPC de atendimento ausente: %', v_nome;
    END IF;
    IF position('wa_can_see_conv' IN v_def) > 0 THEN
      CONTINUE; -- já protegida (reexecução da migration)
    END IF;
    v_anc := CASE
      WHEN v_nome LIKE 'wa_mark_contact_%'
        THEN '  IF NOT FOUND THEN RETURN 0; END IF;'
      ELSE '  IF NOT FOUND THEN RAISE EXCEPTION ''Conversa não encontrada.''; END IF;'
    END;
    IF position(v_anc IN v_def) = 0 THEN
      RAISE EXCEPTION 'âncora de guarda não encontrada em %', v_nome;
    END IF;
    EXECUTE replace(v_def, v_anc, v_anc || v_guarda);
  END LOOP;

  -- Verificação: nenhuma pode ficar de fora, em silêncio.
  SELECT coalesce(array_agg(nome), '{}') INTO v_falta FROM (
    SELECT p.proname AS nome
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY(v_alvos)
       AND position('wa_can_see_conv' IN pg_get_functiondef(p.oid)) = 0
  ) f;
  IF cardinality(v_falta) > 0 THEN
    RAISE EXCEPTION 'RPCs de atendimento sem trava de visibilidade: %', v_falta;
  END IF;
END
$patch$;

-- ── 9. LID → contato: o apelido interno também não é chave de acesso ────────
-- Estas duas traduzem `<n>@lid` em telefone/nome lendo QUALQUER conversa. Com
-- o `p_lid` vindo do cliente, eram um oráculo de agenda para quem não enxerga
-- o canal. Passam a só responder pelo que o usuário já poderia ler.
CREATE OR REPLACE FUNCTION public.wa_phone_by_lid(p_lid text)
RETURNS TABLE(contact_phone text, contact_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.contact_phone, c.contact_name
    FROM public.whatsapp_conversations c
   WHERE public.is_office_staff()
     AND c.contact_lid = regexp_replace(coalesce(p_lid, ''), '\D', '', 'g')
     AND regexp_replace(coalesce(p_lid, ''), '\D', '', 'g') <> ''
     AND c.contact_phone ~ '^\d{12,13}$'
     AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
   ORDER BY c.last_message_at DESC NULLS LAST
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.wa_contact_by_lid(p_lid text)
RETURNS TABLE(conversation_id uuid, contact_phone text, contact_name text,
              contact_avatar_path text, client_id uuid, assigned_user_id uuid,
              instance_id uuid, is_blocked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH lid AS (
    SELECT regexp_replace(coalesce(p_lid, ''), '\D', '', 'g') AS digits
  )
  SELECT
    c.id,
    CASE WHEN c.contact_phone ~ '^\d{12,13}$' THEN c.contact_phone ELSE '' END,
    c.contact_name,
    c.contact_avatar_path,
    c.client_id,
    c.assigned_user_id,
    c.instance_id,
    coalesce(c.is_blocked, false)
  FROM public.whatsapp_conversations c, lid
  WHERE public.is_office_staff()
    AND lid.digits <> ''
    AND (c.contact_lid = lid.digits OR c.remote_jid = lid.digits || '@lid')
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
  ORDER BY (c.client_id IS NOT NULL) DESC,
           (nullif(btrim(coalesce(c.contact_name, '')), '') IS NOT NULL) DESC,
           (c.contact_phone ~ '^\d{12,13}$') DESC,
           c.last_message_at DESC NULLS LAST
  LIMIT 1;
$$;

-- `wa_lid_from_callback` deduz o telefone pela ligação que acabou de sair e
-- devolve o contato. A dedução continua igual; o que ela DEVOLVE passa pela
-- mesma peneira.
CREATE OR REPLACE FUNCTION public.wa_lid_from_callback(
  p_lid text, p_session_id text,
  p_at timestamptz DEFAULT now(), p_window_minutes integer DEFAULT 15
) RETURNS TABLE(contact_phone text, contact_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_lid    text := regexp_replace(coalesce(p_lid, ''), '\D', '', 'g');
  v_desde  timestamptz := p_at - make_interval(mins => GREATEST(1, LEAST(60, coalesce(p_window_minutes, 15))));
  v_phone  text;
  v_outros integer;
BEGIN
  IF NOT public.is_office_staff() THEN RETURN; END IF;
  IF v_lid = '' OR coalesce(p_session_id, '') = '' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.whatsapp_conversations WHERE contact_lid = v_lid) THEN
    RETURN;
  END IF;

  SELECT (array_agg(DISTINCT l.phone))[1] INTO v_phone
    FROM public.whatsapp_call_logs l
   WHERE l.session_id = p_session_id
     AND l.direction = 'outbound'
     AND l.started_at BETWEEN v_desde AND p_at
     AND l.phone ~ '^\d{12,13}$'
   HAVING count(DISTINCT l.phone) = 1;
  IF v_phone IS NULL THEN RETURN; END IF;

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
       AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT 1;
END;
$$;

-- ── 10. Contadores do painel ───────────────────────────────────────────────
-- Um número também conta história: "38 conversas abertas" e "quem está com
-- quantas" desenham o movimento de um canal que a pessoa não pode abrir. Passa
-- a contar só o que ela poderia listar — e a exigir equipe interna, que a
-- versão anterior nem checava.
CREATE OR REPLACE FUNCTION public.whatsapp_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_by_status       JSONB;
  v_by_agent        JSONB;
  v_sla_breached    INT;
  v_sla_warning     INT;
  v_unassigned      INT;
  v_opened_today    INT;
  v_closed_today    INT;
  v_msgs_today      INT;
  v_avg_first_resp  NUMERIC;
  v_today_start     TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  IF NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;

  SELECT jsonb_object_agg(status, cnt)
  INTO v_by_status
  FROM (
    SELECT status, count(*) AS cnt
    FROM whatsapp_conversations c
    WHERE status IN ('open', 'pending')
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    GROUP BY status
  ) s;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_by_agent
  FROM (
    SELECT
      COALESCE(p.name, 'Sem nome') AS agent_name,
      count(*) AS total,
      count(*) FILTER (
        WHERE c.last_message_direction = 'in'
        AND (c.last_agent_message_at IS NULL OR c.last_agent_message_at < c.last_customer_message_at)
      ) AS waiting_reply
    FROM whatsapp_conversations c
    LEFT JOIN profiles p ON p.id = c.assigned_user_id
    WHERE c.status IN ('open', 'pending')
      AND c.assigned_user_id IS NOT NULL
      AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id)
    GROUP BY c.assigned_user_id, p.name
    ORDER BY total DESC
    LIMIT 20
  ) t;

  SELECT
    count(*) FILTER (WHERE extract(epoch FROM (now() - last_customer_message_at)) / 3600 > 4),
    count(*) FILTER (WHERE extract(epoch FROM (now() - last_customer_message_at)) / 3600 BETWEEN 2 AND 4)
  INTO v_sla_breached, v_sla_warning
  FROM whatsapp_conversations c
  WHERE status IN ('open', 'pending')
    AND last_customer_message_at IS NOT NULL
    AND (last_agent_message_at IS NULL OR last_agent_message_at < last_customer_message_at)
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_unassigned
  FROM whatsapp_conversations c
  WHERE status IN ('open', 'pending') AND assigned_user_id IS NULL
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_opened_today
  FROM whatsapp_conversations c
  WHERE created_at >= v_today_start
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_closed_today
  FROM whatsapp_conversations c
  WHERE status = 'closed' AND closed_at >= v_today_start
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  SELECT count(*) INTO v_msgs_today
  FROM whatsapp_messages m
  WHERE m.direction = 'out' AND m.created_at >= v_today_start
    AND public.wa_can_see_conv_id(m.conversation_id);

  SELECT avg(extract(epoch FROM (first_response_at - created_at)) / 60)
  INTO v_avg_first_resp
  FROM whatsapp_conversations c
  WHERE first_response_at IS NOT NULL
    AND created_at >= now() - interval '7 days'
    AND public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id);

  RETURN jsonb_build_object(
    'by_status',              COALESCE(v_by_status, '{}'::jsonb),
    'by_agent',               COALESCE(v_by_agent, '[]'::jsonb),
    'sla_breached',           COALESCE(v_sla_breached, 0),
    'sla_warning',            COALESCE(v_sla_warning, 0),
    'unassigned',             COALESCE(v_unassigned, 0),
    'opened_today',           COALESCE(v_opened_today, 0),
    'closed_today',           COALESCE(v_closed_today, 0),
    'messages_sent_today',    COALESCE(v_msgs_today, 0),
    'avg_first_response_min', v_avg_first_resp
  );
END;
$$;

-- ── 11. Agenda de contatos: a foto vinha da conversa ───────────────────────
-- A agenda é do CADASTRO (tabela `clients`) e continua igual. O que ela buscava
-- em `whatsapp_conversations` era o rosto do contato — e buscava em qualquer
-- conversa. Agora só nas visíveis; sem conversa visível, fica a foto do cadastro.
CREATE OR REPLACE FUNCTION public.whatsapp_contact_book()
RETURNS TABLE(client_id uuid, full_name text, cpf_cnpj text, phone text,
              phone_kind text, photo_path text, wa_avatar_path text,
              is_pre_cadastro boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH permitido AS (SELECT public.is_office_staff() AS ok),
  numeros AS (
    SELECT c.id, c.full_name, c.cpf_cnpj, c.photo_path, c.is_pre_cadastro,
           t.kind,
           regexp_replace(t.raw, '\D', '', 'g') AS digitos
      FROM clients c, permitido p
      CROSS JOIN LATERAL (VALUES (c.mobile, 'mobile'), (c.phone, 'phone')) AS t(raw, kind)
     WHERE p.ok
       AND c.status <> 'arquivado'
       AND c.merged_into_client_id IS NULL
       AND t.raw IS NOT NULL
  ),
  unicos AS (
    SELECT DISTINCT ON (id, digitos) *
      FROM numeros
     WHERE length(digitos) >= 10
     ORDER BY id, digitos, kind
  )
  SELECT u.id, u.full_name, u.cpf_cnpj, u.digitos, u.kind, u.photo_path,
         (SELECT w.contact_avatar_path
            FROM whatsapp_conversations w
           WHERE w.contact_avatar_path IS NOT NULL
             AND right(regexp_replace(w.contact_phone, '\D', '', 'g'), 8) = right(u.digitos, 8)
             AND public.wa_can_see_conv(w.instance_id, w.department_id, w.assigned_user_id, w.id)
           ORDER BY w.last_message_at DESC NULLS LAST
           LIMIT 1),
         u.is_pre_cadastro
    FROM unicos u
   ORDER BY u.full_name, u.kind;
$$;

-- ── 12. Tempo real: o fio não pode carregar o que a consulta esconde ───────
--
-- `whatsapp:messages` é UM tópico para o escritório inteiro. A policy de
-- `realtime.messages` decide quem ENTRA no tópico, não o que cada um recebe —
-- então tudo que o gatilho põe no payload chega a todas as abas, inclusive as
-- de quem não enxerga aquele canal. O `content` (120 caracteres da mensagem)
-- era exatamente a prévia que a lista lateral não deveria mostrar.
--
-- Sai do fio. Quem precisa do texto (o notificador) passa a lê-lo por HTTP,
-- onde o RLS de `whatsapp_messages` responde — e responde vazio para quem não
-- pode ver. O `refresh` continua sendo o sinal para a thread reler.
CREATE OR REPLACE FUNCTION public.broadcast_whatsapp_message_changed()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $$
DECLARE
  payload jsonb;
  precisa_reler boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM realtime.send(
      jsonb_build_object('op', 'DELETE', 'id', OLD.id, 'conversation_id', OLD.conversation_id),
      'changed',
      'whatsapp:messages',
      true
    );
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    payload := jsonb_build_object(
      'op',              'INSERT',
      'id',              NEW.id,
      'conversation_id', NEW.conversation_id,
      'direction',       NEW.direction,
      'type',            NEW.type,
      'status',          NEW.status,
      'refresh',         true
    );
  ELSE
    precisa_reler :=
         OLD.content              IS DISTINCT FROM NEW.content
      OR OLD.edited_at            IS DISTINCT FROM NEW.edited_at
      OR OLD.deleted_at           IS DISTINCT FROM NEW.deleted_at
      OR OLD.reactions            IS DISTINCT FROM NEW.reactions
      OR OLD.transcription_text   IS DISTINCT FROM NEW.transcription_text
      OR OLD.transcription_status IS DISTINCT FROM NEW.transcription_status
      OR OLD.storage_path         IS DISTINCT FROM NEW.storage_path
      OR OLD.media_url            IS DISTINCT FROM NEW.media_url
      OR OLD.media_mime           IS DISTINCT FROM NEW.media_mime
      OR OLD.media_size           IS DISTINCT FROM NEW.media_size
      OR OLD.file_name            IS DISTINCT FROM NEW.file_name
      OR OLD.is_animated          IS DISTINCT FROM NEW.is_animated
      OR OLD.reply_to_id          IS DISTINCT FROM NEW.reply_to_id
      OR OLD.doc_intake_status    IS DISTINCT FROM NEW.doc_intake_status;

    payload := jsonb_build_object(
      'op',              'UPDATE',
      'id',              NEW.id,
      'conversation_id', NEW.conversation_id,
      'status',          NEW.status,
      'refresh',         precisa_reler
    );
  END IF;

  PERFORM realtime.send(payload, 'changed', 'whatsapp:messages', true);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.wa_can_see_conv_id(uuid) IS
  'Visibilidade da conversa pelo id — a mesma regra de wa_can_see_conv, para as tabelas derivadas.';
COMMENT ON FUNCTION public.wa_can_see_call(uuid, text, uuid) IS
  'Visibilidade de uma ligação: própria, ou do atendimento a que ela pertence.';
