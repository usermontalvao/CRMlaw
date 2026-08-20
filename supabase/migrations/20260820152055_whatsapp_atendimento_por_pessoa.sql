-- ============================================================
-- WhatsApp — um atendimento por pessoa, vários canais de transporte
--
-- A inbox e a thread já tratam as linhas (instance_id + remote_jid) do mesmo
-- contato como uma pessoa só. Este arquivo leva a mesma regra para as ações de
-- atendimento: encerrar, reabrir, assumir, distribuir, transferir, aceitar,
-- devolver à fila e ler/não ler passam a operar atomicamente sobre as linhas
-- irmãs. Envio, presença e bloqueio continuam pertencendo ao canal.
-- ============================================================

-- A mesma normalização usada por `contactThreads.ts`: DDI 55 quando ausente e
-- forma canônica sem o nono dígito. Telefone real vence; client_id é fallback
-- apenas para conversas endereçadas por LID/sem número utilizável.
CREATE OR REPLACE FUNCTION public.wa_attendance_key(
  p_phone text,
  p_remote_jid text,
  p_client_id uuid
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_digits) IN (10, 11) THEN v_digits := '55' || v_digits; END IF;

  IF length(v_digits) NOT IN (12, 13) AND coalesce(p_remote_jid, '') !~* '@lid$' THEN
    v_digits := regexp_replace(split_part(coalesce(p_remote_jid, ''), '@', 1), '[^0-9]', '', 'g');
    IF length(v_digits) IN (10, 11) THEN v_digits := '55' || v_digits; END IF;
  END IF;

  IF v_digits ~ '^55[0-9]{2}9[0-9]{8}$' THEN
    RETURN 'p:' || substring(v_digits FROM 1 FOR 4) || substring(v_digits FROM 6);
  END IF;
  IF v_digits ~ '^[0-9]{12,13}$' THEN RETURN 'p:' || v_digits; END IF;
  IF p_client_id IS NOT NULL THEN RETURN 'c:' || p_client_id::text; END IF;
  RETURN NULL;
END;
$$;

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS attendance_key text
  GENERATED ALWAYS AS (
    public.wa_attendance_key(contact_phone, remote_jid, client_id)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_wa_conv_attendance_status
  ON public.whatsapp_conversations (attendance_key, status)
  WHERE attendance_key IS NOT NULL;

-- Auditoria imutável dos atos que agora atingem o atendimento inteiro. O
-- before_state permite provar quem era o responsável em cada canal no instante
-- da ação, sem inferir pelo estado atual da conversa.
CREATE TABLE IF NOT EXISTS public.whatsapp_attendance_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_key          text NOT NULL,
  event_type              text NOT NULL CHECK (event_type IN (
    'closed', 'reopened', 'reopened_inbound', 'assumed', 'assigned',
    'released', 'transferred', 'transfer_accepted'
  )),
  primary_conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  affected_conversation_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  actor_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason                  text,
  before_state            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_attendance_events_key_created
  ON public.whatsapp_attendance_events (attendance_key, created_at DESC);

ALTER TABLE public.whatsapp_attendance_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_attendance_events_select ON public.whatsapp_attendance_events;
CREATE POLICY wa_attendance_events_select
  ON public.whatsapp_attendance_events FOR SELECT TO authenticated
  USING (public.is_office_staff());

REVOKE INSERT, UPDATE, DELETE ON public.whatsapp_attendance_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_attendance_events TO authenticated;

-- Retorna o estado mínimo necessário para auditoria antes de qualquer mutação.
CREATE OR REPLACE FUNCTION public.wa_attendance_before_state(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH selected AS (
    SELECT id, attendance_key FROM whatsapp_conversations WHERE id = p_conversation_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'conversation_id', c.id,
    'instance_id', c.instance_id,
    'status', c.status,
    'assigned_user_id', c.assigned_user_id,
    'department_id', c.department_id,
    'awaiting_accept', c.awaiting_accept,
    'last_message_at', c.last_message_at,
    'last_call_at', c.last_call_at
  ) ORDER BY c.id), '[]'::jsonb)
  FROM selected s
  JOIN whatsapp_conversations c
    ON c.id = s.id OR (s.attendance_key IS NOT NULL AND c.attendance_key = s.attendance_key);
$$;

REVOKE ALL ON FUNCTION public.wa_attendance_before_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_attendance_before_state(uuid) TO service_role;

-- Encerramento humano: somente o responsável da conversa selecionada ou um
-- supervisor. Um atendente comum nunca encerra por tabela uma linha que está
-- com outro responsável ou aguardando aceite. O UPDATE único é a transação.
CREATE OR REPLACE FUNCTION public.wa_close_contact_attendance(
  p_conversation_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_supervisor boolean;
  v_before jsonb;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;

  SELECT * INTO v_selected FROM whatsapp_conversations
   WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;

  v_supervisor := public.wa_is_supervisor();
  IF NOT v_supervisor AND v_selected.assigned_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Assuma o atendimento antes de encerrá-lo.';
  END IF;

  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;

  IF NOT v_supervisor AND EXISTS (
    SELECT 1 FROM whatsapp_conversations c
     WHERE (c.id = v_selected.id
        OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
       AND c.status IN ('open', 'pending')
       AND (c.assigned_user_id IS DISTINCT FROM v_actor OR coalesce(c.awaiting_accept, false))
       AND NOT (
         c.assigned_user_id IS NULL
         AND NOT coalesce(c.awaiting_accept, false)
         AND c.last_message_at IS NULL
         AND c.last_call_at IS NULL
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Há outro canal ativo com responsável ou transferência diferente. Um supervisor deve revisar o encerramento.';
  END IF;

  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');

  UPDATE whatsapp_conversations c
     SET status = 'closed',
         closed_at = now(),
         closed_by = v_actor,
         closure_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
         absence_suppressed = false,
         auto_close_suppressed = false
   WHERE c.id = ANY(v_ids);

  IF cardinality(v_ids) > 0 THEN
    INSERT INTO whatsapp_attendance_events (
      attendance_key, event_type, primary_conversation_id,
      affected_conversation_ids, actor_id, reason, before_state
    ) VALUES (
      coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'closed',
      v_selected.id, v_ids, v_actor,
      nullif(left(btrim(coalesce(p_reason, '')), 300), ''), v_before
    );
  END IF;

  RETURN jsonb_build_object(
    'attendance_key', coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text),
    'affected_ids', to_jsonb(v_ids),
    'affected_count', cardinality(v_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_reopen_contact_attendance(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF v_selected.assigned_user_id IS NOT NULL
     AND v_selected.assigned_user_id <> v_actor
     AND NOT public.wa_is_supervisor() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente o responsável ou um supervisor pode reabrir este atendimento.';
  END IF;

  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status = 'closed';

  UPDATE whatsapp_conversations
     SET status = 'open', reopened_at = now(), awaiting_accept = false,
         transfer_pending_since = NULL
   WHERE id = ANY(v_ids);

  IF cardinality(v_ids) > 0 THEN
    INSERT INTO whatsapp_attendance_events (
      attendance_key, event_type, primary_conversation_id,
      affected_conversation_ids, actor_id, before_state
    ) VALUES (
      coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'reopened',
      v_selected.id, v_ids, v_actor, v_before
    );
  END IF;
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_assume_contact_attendance(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');

  UPDATE whatsapp_conversations
     SET assigned_user_id = v_actor, awaiting_accept = false,
         transfer_pending_since = NULL
   WHERE id = ANY(v_ids);
  INSERT INTO whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) VALUES (
    coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'assumed',
    v_selected.id, v_ids, v_actor, v_before
  );
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_release_contact_attendance(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF v_selected.assigned_user_id IS DISTINCT FROM v_actor AND NOT public.wa_is_supervisor() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente o responsável ou um supervisor pode devolver este atendimento à fila.';
  END IF;
  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');
  UPDATE whatsapp_conversations
     SET assigned_user_id = NULL, awaiting_accept = false, transfer_pending_since = NULL
   WHERE id = ANY(v_ids);
  INSERT INTO whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) VALUES (
    coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'released',
    v_selected.id, v_ids, v_actor, v_before
  );
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_assign_contact_attendance(
  p_conversation_id uuid,
  p_to_user_id uuid,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_to_user_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'Atendente de destino inválido ou inativo.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');

  INSERT INTO whatsapp_transfers (
    conversation_id, from_user_id, to_user_id, from_department_id,
    to_department_id, note, performed_by, accepted_at, accepted_by
  )
  SELECT c.id, c.assigned_user_id, p_to_user_id, c.department_id,
         NULL, coalesce(nullif(btrim(p_note), ''), 'Distribuição da fila'),
         v_actor, v_now, p_to_user_id
    FROM whatsapp_conversations c WHERE c.id = ANY(v_ids);

  UPDATE whatsapp_conversations
     SET assigned_user_id = p_to_user_id, awaiting_accept = false,
         transfer_pending_since = NULL
   WHERE id = ANY(v_ids);
  INSERT INTO whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) VALUES (
    coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'assigned',
    v_selected.id, v_ids, v_actor, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_before
  );
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_transfer_contact_attendance(
  p_conversation_id uuid,
  p_to_user_id uuid DEFAULT NULL,
  p_to_department_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  IF p_to_user_id IS NULL AND p_to_department_id IS NULL THEN
    RAISE EXCEPTION 'Informe uma pessoa ou setor de destino.';
  END IF;
  IF p_to_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_to_user_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'Atendente de destino inválido ou inativo.';
  END IF;
  IF p_to_department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM whatsapp_departments WHERE id = p_to_department_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'Setor de destino inválido ou inativo.';
  END IF;

  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF v_selected.assigned_user_id IS NOT NULL
     AND v_selected.assigned_user_id <> v_actor
     AND NOT public.wa_is_supervisor() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente o responsável ou um supervisor pode transferir este atendimento.';
  END IF;
  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  IF NOT public.wa_is_supervisor() AND EXISTS (
    SELECT 1 FROM whatsapp_conversations c
     WHERE (c.id = v_selected.id
        OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
       AND c.status IN ('open', 'pending')
       AND c.assigned_user_id IS NOT NULL
       AND c.assigned_user_id <> v_actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Outro canal deste atendimento está com responsável diferente.';
  END IF;

  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');

  INSERT INTO whatsapp_transfers (
    conversation_id, from_user_id, to_user_id, from_department_id,
    to_department_id, note, performed_by
  )
  SELECT c.id, c.assigned_user_id, p_to_user_id, c.department_id,
         p_to_department_id, nullif(btrim(p_note), ''), v_actor
    FROM whatsapp_conversations c WHERE c.id = ANY(v_ids);

  UPDATE whatsapp_conversations
     SET assigned_user_id = p_to_user_id,
         department_id = CASE WHEN p_to_department_id IS NOT NULL THEN p_to_department_id ELSE department_id END,
         awaiting_accept = true,
         transfer_pending_since = v_now
   WHERE id = ANY(v_ids);
  INSERT INTO whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, reason, before_state
  ) VALUES (
    coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'transferred',
    v_selected.id, v_ids, v_actor, nullif(left(btrim(coalesce(p_note, '')), 300), ''), v_before
  );
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_accept_contact_transfer(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_selected whatsapp_conversations%ROWTYPE;
  v_transfer whatsapp_transfers%ROWTYPE;
  v_before jsonb;
  v_ids uuid[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  SELECT * INTO v_transfer FROM whatsapp_transfers
   WHERE conversation_id = p_conversation_id AND accepted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_transfer.to_user_id IS NOT NULL AND v_transfer.to_user_id <> v_actor THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Esta transferência é destinada a outro atendente.';
    END IF;
    IF v_transfer.to_user_id IS NULL AND v_transfer.to_department_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM whatsapp_department_members
          WHERE department_id = v_transfer.to_department_id AND user_id = v_actor
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Você não pertence ao setor de destino desta transferência.';
    END IF;
  END IF;

  PERFORM c.id FROM whatsapp_conversations c
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key)
   ORDER BY c.id FOR UPDATE;
  v_before := public.wa_attendance_before_state(v_selected.id);
  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[]) INTO v_ids
    FROM whatsapp_conversations c
   WHERE (c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key))
     AND c.status IN ('open', 'pending');

  UPDATE whatsapp_conversations
     SET assigned_user_id = coalesce(assigned_user_id, v_actor),
         awaiting_accept = false, transfer_pending_since = NULL
   WHERE id = ANY(v_ids);
  UPDATE whatsapp_transfers
     SET accepted_at = now(), accepted_by = v_actor
   WHERE conversation_id = ANY(v_ids) AND accepted_at IS NULL;
  INSERT INTO whatsapp_attendance_events (
    attendance_key, event_type, primary_conversation_id,
    affected_conversation_ids, actor_id, before_state
  ) VALUES (
    coalesce(v_selected.attendance_key, 'r:' || v_selected.id::text), 'transfer_accepted',
    v_selected.id, v_ids, v_actor, v_before
  );
  RETURN jsonb_build_object('affected_ids', to_jsonb(v_ids), 'affected_count', cardinality(v_ids));
END;
$$;

-- Estado de leitura acompanha a thread unificada. "Não lida" usa uma única
-- linha como sinal, evitando somar artificialmente um lembrete por canal.
CREATE OR REPLACE FUNCTION public.wa_mark_contact_read(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_selected whatsapp_conversations%ROWTYPE; v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE whatsapp_conversations c SET unread_count = 0
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_mark_contact_unread(p_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_selected whatsapp_conversations%ROWTYPE; v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_office_staff() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessão de atendente inválida.';
  END IF;
  SELECT * INTO v_selected FROM whatsapp_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE whatsapp_conversations c SET unread_count = CASE WHEN c.id = v_selected.id THEN 1 ELSE 0 END
   WHERE c.id = v_selected.id
      OR (v_selected.attendance_key IS NOT NULL AND c.attendance_key = v_selected.attendance_key);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Qualquer reabertura real (mensagem recebida, envio humano ou comando manual)
-- leva junto as linhas irmãs. Só propaga abertura; encerramento humano continua
-- exclusivamente na RPC autorizada acima.
CREATE OR REPLACE FUNCTION public.wa_propagate_attendance_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR OLD.status = NEW.status OR NEW.status = 'closed' THEN RETURN NEW; END IF;
  IF NEW.attendance_key IS NULL THEN RETURN NEW; END IF;
  UPDATE whatsapp_conversations
     SET status = 'open', reopened_at = coalesce(NEW.reopened_at, now())
   WHERE attendance_key = NEW.attendance_key AND id <> NEW.id AND status = 'closed';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_propagate_attendance_reopen ON public.whatsapp_conversations;
CREATE TRIGGER trg_wa_propagate_attendance_reopen
  AFTER UPDATE OF status ON public.whatsapp_conversations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'closed')
  EXECUTE FUNCTION public.wa_propagate_attendance_reopen();

-- Fechamentos legados/automáticos de uma linha também eliminam rascunhos vazios
-- dos canais irmãos. Conversas com atividade não são fechadas silenciosamente:
-- para elas vale a RPC de encerramento do atendimento inteiro.
CREATE OR REPLACE FUNCTION public.wa_close_empty_sibling_drafts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.attendance_key IS NULL THEN RETURN NEW; END IF;
  UPDATE whatsapp_conversations
     SET status = 'closed', closed_at = NEW.closed_at, closed_by = NEW.closed_by,
         closure_reason = NEW.closure_reason, absence_suppressed = false,
         auto_close_suppressed = false
   WHERE attendance_key = NEW.attendance_key
     AND id <> NEW.id
     AND status IN ('open', 'pending')
     AND assigned_user_id IS NULL
     AND NOT coalesce(awaiting_accept, false)
     AND last_message_at IS NULL
     AND last_call_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_close_empty_sibling_drafts ON public.whatsapp_conversations;
CREATE TRIGGER trg_wa_close_empty_sibling_drafts
  AFTER UPDATE OF status ON public.whatsapp_conversations
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'closed')
  EXECUTE FUNCTION public.wa_close_empty_sibling_drafts();

-- As RPCs são endpoints intencionais para a equipe autenticada. Todas validam
-- auth.uid(), vínculo com o escritório e, nas ações sensíveis, responsabilidade.
REVOKE ALL ON FUNCTION public.wa_close_contact_attendance(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_reopen_contact_attendance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_assume_contact_attendance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_release_contact_attendance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_assign_contact_attendance(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_transfer_contact_attendance(uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_accept_contact_transfer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_mark_contact_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_mark_contact_unread(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wa_propagate_attendance_reopen() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_close_empty_sibling_drafts() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wa_close_contact_attendance(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reopen_contact_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_assume_contact_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_release_contact_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_assign_contact_attendance(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_transfer_contact_attendance(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_accept_contact_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_mark_contact_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_mark_contact_unread(uuid) TO authenticated;

COMMENT ON COLUMN public.whatsapp_conversations.attendance_key IS
  'Identidade canônica do atendimento: a mesma pessoa pode ter uma linha de transporte em cada canal.';
COMMENT ON TABLE public.whatsapp_attendance_events IS
  'Auditoria append-only das ações que atingem todas as linhas de canal de uma pessoa.';
