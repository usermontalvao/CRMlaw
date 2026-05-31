-- ============================================================================
-- Portal do Cliente — Migration consolidada (FINAL)
-- ============================================================================
-- Substitui de forma idempotente TODAS as RPCs do portal.
-- Importante: dropa primeiro porque o tipo de retorno mudou de
--   `SETOF public.processes` para `SETOF jsonb`, e `CREATE OR REPLACE`
--   não permite trocar tipo de retorno.
--
-- Esta migration pode ser executada quantas vezes for necessário.
-- Aplique uma vez no Supabase e o portal funcionará 100%.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DROPs idempotentes — limpam versões antigas
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.portal_login(text, text)                CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_processes(uuid)             CASCADE;
DROP FUNCTION IF EXISTS public.portal_get_process(uuid, uuid)          CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_documents(uuid)             CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_signatures(uuid)            CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_agreements(uuid)            CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_calendar(uuid)              CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_notifications(uuid)         CASCADE;
DROP FUNCTION IF EXISTS public.portal_list_deadlines(uuid)             CASCADE;
DROP FUNCTION IF EXISTS public.portal_dashboard_summary(uuid)          CASCADE;
DROP FUNCTION IF EXISTS public.portal_get_client_photo(uuid)           CASCADE;

-- ----------------------------------------------------------------------------
-- Helper privado: resolve client_id pelo portal_user_id (validando ativo)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_resolve_client(p_portal_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id
  FROM public.client_portal_users
  WHERE id = p_portal_user_id
    AND is_active = true;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Sessão de portal inválida ou expirada' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_login (CPF + 4 últimos dígitos do telefone)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_login(p_cpf text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_pwd text := regexp_replace(coalesce(p_password, ''), '\D', '', 'g');
  v_client record;
  v_phone_last4 text;
  v_user record;
BEGIN
  IF length(v_cpf) <> 11 OR length(v_pwd) <> 4 THEN
    RAISE EXCEPTION 'CPF ou senha inválidos' USING ERRCODE = 'P0001';
  END IF;

  -- Busca cliente pelo CPF (também trazendo photo_path para o avatar)
  SELECT id, full_name, email, phone, cpf_cnpj, photo_path
    INTO v_client
  FROM public.clients
  WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = v_cpf
  LIMIT 1;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CPF não cadastrado' USING ERRCODE = 'P0001';
  END IF;

  -- Valida senha (4 últimos dígitos do telefone)
  v_phone_last4 := right(regexp_replace(coalesce(v_client.phone, ''), '\D', '', 'g'), 4);
  IF v_phone_last4 IS NULL OR length(v_phone_last4) <> 4 OR v_phone_last4 <> v_pwd THEN
    RAISE EXCEPTION 'Senha incorreta' USING ERRCODE = 'P0001';
  END IF;

  -- Garante portal_user
  SELECT * INTO v_user FROM public.client_portal_users
  WHERE client_id = v_client.id LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO public.client_portal_users (client_id, is_active, created_at)
    VALUES (v_client.id, true, now())
    RETURNING * INTO v_user;
  ELSIF v_user.is_active IS DISTINCT FROM true THEN
    UPDATE public.client_portal_users SET is_active = true WHERE id = v_user.id
    RETURNING * INTO v_user;
  END IF;

  -- Atualiza last_login (best-effort)
  BEGIN
    UPDATE public.client_portal_users
       SET last_login_at = now()
     WHERE id = v_user.id;
  EXCEPTION WHEN undefined_column THEN
    -- coluna pode não existir, ignora
    NULL;
  END;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id,
      'client_id', v_user.client_id,
      'is_active', v_user.is_active
    ),
    'client', jsonb_build_object(
      'id', v_client.id,
      'nome', v_client.full_name,
      'email', v_client.email,
      'telefone', v_client.phone,
      'photo_path', v_client.photo_path
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_get_client_photo — retorna photo_path para renovar signed URL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_client_photo(p_portal_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_path text;
BEGIN
  SELECT photo_path INTO v_path FROM public.clients WHERE id = v_client_id;
  RETURN v_path;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_processes (jsonb enriquecido)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_processes(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_has_movements boolean := to_regclass('public.datajud_movimentos') IS NOT NULL;
  v_has_deadlines boolean := to_regclass('public.deadlines') IS NOT NULL;
BEGIN
  RETURN QUERY
  SELECT to_jsonb(p)
    || jsonb_build_object(
      'movements_count', CASE WHEN v_has_movements THEN COALESCE((
          SELECT count(*) FROM public.datajud_movimentos m WHERE m.process_id = p.id
        ), 0) ELSE 0 END,
      'last_movement', CASE WHEN v_has_movements THEN (
          SELECT to_jsonb(m) FROM public.datajud_movimentos m
          WHERE m.process_id = p.id
          ORDER BY m.data_hora DESC NULLS LAST LIMIT 1
        ) ELSE NULL END,
      'pending_deadlines', CASE WHEN v_has_deadlines THEN COALESCE((
          SELECT count(*) FROM public.deadlines d
          WHERE d.process_id = p.id AND d.status = 'pendente'
        ), 0) ELSE 0 END
    )
  FROM public.processes p
  WHERE p.client_id = v_client_id
  ORDER BY
    CASE WHEN p.status = 'ativo' THEN 0 ELSE 1 END,
    p.updated_at DESC NULLS LAST,
    p.created_at DESC;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_get_process — detalhes completos (movimentos + prazos + publicações)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_process(p_portal_user_id uuid, p_process_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_process jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_deadlines jsonb := '[]'::jsonb;
  v_publications jsonb := '[]'::jsonb;
BEGIN
  SELECT to_jsonb(p) INTO v_process
  FROM public.processes p
  WHERE p.id = p_process_id AND p.client_id = v_client_id
  LIMIT 1;

  IF v_process IS NULL THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.data_hora DESC NULLS LAST), '[]'::jsonb)
      INTO v_movements
    FROM public.datajud_movimentos m
    WHERE m.process_id = p_process_id;
  END IF;

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.due_date ASC), '[]'::jsonb)
      INTO v_deadlines
    FROM public.deadlines d
    WHERE d.process_id = p_process_id;
  END IF;

  IF to_regclass('public.process_notifications') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
      INTO v_publications
    FROM public.process_notifications n
    WHERE n.process_id = p_process_id;
  END IF;

  RETURN v_process || jsonb_build_object(
    'movements', v_movements,
    'deadlines', v_deadlines,
    'publications', v_publications
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_documents
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_documents(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.cloud_files') IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.cloud_files t
      WHERE t.client_id = $1
      ORDER BY t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_signatures — filtra deletadas/arquivadas/bloqueadas/canceladas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_signatures(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.signature_requests') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) || jsonb_build_object(
        ''signers'', COALESCE((
          SELECT jsonb_agg(to_jsonb(s) ORDER BY s.order ASC NULLS LAST)
          FROM public.signature_signers s
          WHERE s.signature_request_id = t.id
        ), ''[]''::jsonb)
     )
     FROM public.signature_requests t
     WHERE t.client_id = $1
       AND t.deleted_at IS NULL
       AND t.archived_at IS NULL
       AND t.blocked_at IS NULL
       AND COALESCE(t.status, '''') <> ''cancelled''
     ORDER BY
       CASE WHEN COALESCE(t.status, '''') IN (''pending'',''in_progress'') THEN 0 ELSE 1 END,
       t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_agreements — financeiro com totais calculados
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_agreements(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.agreements') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    $sql$
    SELECT to_jsonb(a) || jsonb_build_object(
        'installments', COALESCE((
          SELECT jsonb_agg(to_jsonb(i) ORDER BY i.installment_number ASC)
          FROM public.installments i
          WHERE i.agreement_id = a.id
        ), '[]'::jsonb),
        'paid_total', COALESCE((
          SELECT sum(COALESCE(i.paid_value, i.value))
          FROM public.installments i
          WHERE i.agreement_id = a.id AND i.status = 'pago'
        ), 0),
        'pending_total', COALESCE((
          SELECT sum(i.value)
          FROM public.installments i
          WHERE i.agreement_id = a.id AND i.status = 'pendente'
        ), 0),
        'overdue_total', COALESCE((
          SELECT sum(i.value)
          FROM public.installments i
          WHERE i.agreement_id = a.id AND i.status = 'vencido'
        ), 0),
        'next_installment', (
          SELECT to_jsonb(i) FROM public.installments i
          WHERE i.agreement_id = a.id AND i.status IN ('pendente','vencido')
          ORDER BY i.due_date ASC LIMIT 1
        )
    )
    FROM public.agreements a
    WHERE a.client_id = $1
    ORDER BY COALESCE(a.agreement_date, a.created_at) DESC
    $sql$
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_calendar — eventos (passados recentes + futuros)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_calendar(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.calendar_events') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.calendar_events t
      WHERE t.client_id = $1
        AND (t.is_private IS NULL OR t.is_private = false)
        AND t.start_at >= (now() - interval ''30 days'')
      ORDER BY t.start_at ASC
      LIMIT 200'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_deadlines
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_deadlines(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.deadlines') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(d) || jsonb_build_object(
        ''process_code'', (SELECT p.process_code FROM public.processes p WHERE p.id = d.process_id)
     )
     FROM public.deadlines d
     WHERE (d.client_id = $1
            OR d.process_id IN (SELECT id FROM public.processes WHERE client_id = $1))
     ORDER BY
       CASE WHEN d.status = ''pendente'' THEN 0 ELSE 1 END,
       d.due_date ASC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_notifications — usa process_notifications (intimações reais)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_notifications(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.process_notifications') IS NULL THEN RETURN; END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(n) || jsonb_build_object(
        ''process_code'', (SELECT p.process_code FROM public.processes p WHERE p.id = n.process_id)
     )
     FROM public.process_notifications n
     WHERE n.process_id IN (SELECT id FROM public.processes WHERE client_id = $1)
     ORDER BY n.created_at DESC LIMIT 100'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_dashboard_summary — agregado para o dashboard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_dashboard_summary(p_portal_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_processes_total int := 0;
  v_processes_active int := 0;
  v_signatures_pending int := 0;
  v_deadlines_pending int := 0;
  v_deadlines_overdue int := 0;
  v_documents_count int := 0;
  v_total_value numeric := 0;
  v_paid_value numeric := 0;
  v_pending_value numeric := 0;
  v_overdue_value numeric := 0;
  v_next_event jsonb := NULL;
  v_next_deadline jsonb := NULL;
  v_next_installment jsonb := NULL;
  v_recent_movements jsonb := '[]'::jsonb;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'ativo')
    INTO v_processes_total, v_processes_active
  FROM public.processes WHERE client_id = v_client_id;

  IF to_regclass('public.signature_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_signatures_pending
    FROM public.signature_requests
    WHERE client_id = v_client_id
      AND deleted_at IS NULL AND archived_at IS NULL AND blocked_at IS NULL
      AND status IN ('pending','in_progress');
  END IF;

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE status = 'pendente' AND due_date >= current_date),
      count(*) FILTER (WHERE status = 'pendente' AND due_date < current_date)
    INTO v_deadlines_pending, v_deadlines_overdue
    FROM public.deadlines
    WHERE client_id = v_client_id
       OR process_id IN (SELECT id FROM public.processes WHERE client_id = v_client_id);
  END IF;

  IF to_regclass('public.cloud_files') IS NOT NULL THEN
    SELECT count(*) INTO v_documents_count
    FROM public.cloud_files WHERE client_id = v_client_id;
  END IF;

  IF to_regclass('public.agreements') IS NOT NULL AND to_regclass('public.installments') IS NOT NULL THEN
    SELECT COALESCE(sum(a.total_value), 0) INTO v_total_value
    FROM public.agreements a WHERE a.client_id = v_client_id;

    SELECT
      COALESCE(sum(COALESCE(i.paid_value, i.value)) FILTER (WHERE i.status = 'pago'), 0),
      COALESCE(sum(i.value) FILTER (WHERE i.status = 'pendente'), 0),
      COALESCE(sum(i.value) FILTER (WHERE i.status = 'vencido'), 0)
    INTO v_paid_value, v_pending_value, v_overdue_value
    FROM public.installments i
    WHERE i.agreement_id IN (SELECT id FROM public.agreements WHERE client_id = v_client_id);

    SELECT to_jsonb(i) || jsonb_build_object(
        'agreement_title', (SELECT a.title FROM public.agreements a WHERE a.id = i.agreement_id)
      )
      INTO v_next_installment
    FROM public.installments i
    WHERE i.agreement_id IN (SELECT id FROM public.agreements WHERE client_id = v_client_id)
      AND i.status IN ('pendente','vencido')
    ORDER BY i.due_date ASC LIMIT 1;
  END IF;

  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    SELECT to_jsonb(e) INTO v_next_event
    FROM public.calendar_events e
    WHERE e.client_id = v_client_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= now()
    ORDER BY e.start_at ASC LIMIT 1;
  END IF;

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT to_jsonb(d) || jsonb_build_object(
        'process_code', (SELECT p.process_code FROM public.processes p WHERE p.id = d.process_id)
      )
      INTO v_next_deadline
    FROM public.deadlines d
    WHERE (d.client_id = v_client_id
           OR d.process_id IN (SELECT id FROM public.processes WHERE client_id = v_client_id))
      AND d.status = 'pendente'
      AND d.due_date >= current_date
    ORDER BY d.due_date ASC LIMIT 1;
  END IF;

  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) || jsonb_build_object(
        'process_code', (SELECT p.process_code FROM public.processes p WHERE p.id = m.process_id)
      ) ORDER BY m.data_hora DESC NULLS LAST), '[]'::jsonb)
      INTO v_recent_movements
    FROM (
      SELECT * FROM public.datajud_movimentos
      WHERE process_id IN (SELECT id FROM public.processes WHERE client_id = v_client_id)
      ORDER BY data_hora DESC NULLS LAST
      LIMIT 5
    ) m;
  END IF;

  RETURN jsonb_build_object(
    'processesTotal', v_processes_total,
    'processesActive', v_processes_active,
    'signaturesPending', v_signatures_pending,
    'deadlinesPending', v_deadlines_pending,
    'deadlinesOverdue', v_deadlines_overdue,
    'documentsCount', v_documents_count,
    'financial', jsonb_build_object(
      'total', v_total_value,
      'paid', v_paid_value,
      'pending', v_pending_value,
      'overdue', v_overdue_value
    ),
    'nextEvent', v_next_event,
    'nextDeadline', v_next_deadline,
    'nextInstallment', v_next_installment,
    'recentMovements', v_recent_movements
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- GRANTs
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.portal_login(text, text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_client_photo(uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_processes(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_process(uuid, uuid)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_documents(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_signatures(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_agreements(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_calendar(uuid)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_deadlines(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_notifications(uuid)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid)      TO anon, authenticated;

-- Helper privado nunca exposto
REVOKE ALL ON FUNCTION public._portal_resolve_client(uuid) FROM PUBLIC, anon, authenticated;
