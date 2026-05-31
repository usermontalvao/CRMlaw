-- ============================================================================
-- Portal do Cliente — RPCs v2 (dados ricos, filtros completos)
-- ============================================================================
-- Substitui as RPCs anteriores com:
--   • Filtro de assinaturas deletadas/arquivadas/bloqueadas
--   • Processos com movimentações DataJud + prazos + audiência
--   • Prazos do cliente (deadlines)
--   • Notificações de processos (process_notifications) em vez de user_notifications
--   • Contratos financeiros com totais já calculados
--   • Dashboard com agregados completos
-- ============================================================================

-- ----------------------------------------------------------------------------
-- portal_list_processes (enriquecido)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_processes(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  RETURN QUERY
  SELECT to_jsonb(p) || jsonb_build_object(
    'movements_count', COALESCE((
      SELECT count(*) FROM public.datajud_movimentos m WHERE m.process_id = p.id
    ), 0),
    'last_movement', (
      SELECT to_jsonb(m) FROM public.datajud_movimentos m
      WHERE m.process_id = p.id
      ORDER BY m.data DESC NULLS LAST LIMIT 1
    ),
    'pending_deadlines', COALESCE((
      SELECT count(*) FROM public.deadlines d
      WHERE d.process_id = p.id AND d.status = 'pendente'
    ), 0)
  )
  FROM public.processes p
  WHERE p.client_id = v_client_id
  ORDER BY
    CASE WHEN p.status = 'ativo' THEN 0 ELSE 1 END,
    p.updated_at DESC;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_get_process (detalhes completos)
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
  v_movements jsonb;
  v_deadlines jsonb;
  v_notifications jsonb;
BEGIN
  SELECT to_jsonb(p) INTO v_process
  FROM public.processes p
  WHERE p.id = p_process_id AND p.client_id = v_client_id
  LIMIT 1;

  IF v_process IS NULL THEN
    RETURN NULL;
  END IF;

  -- Movimentações DataJud (timeline)
  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.data DESC NULLS LAST), '[]'::jsonb)
    INTO v_movements
    FROM public.datajud_movimentos m
    WHERE m.process_id = p_process_id;
  ELSE
    v_movements := '[]'::jsonb;
  END IF;

  -- Prazos relacionados
  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.due_date ASC), '[]'::jsonb)
    INTO v_deadlines
    FROM public.deadlines d
    WHERE d.process_id = p_process_id;
  ELSE
    v_deadlines := '[]'::jsonb;
  END IF;

  -- Publicações / intimações
  IF to_regclass('public.process_notifications') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO v_notifications
    FROM public.process_notifications n
    WHERE n.process_id = p_process_id;
  ELSE
    v_notifications := '[]'::jsonb;
  END IF;

  RETURN v_process || jsonb_build_object(
    'movements', v_movements,
    'deadlines', v_deadlines,
    'publications', v_notifications
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
  IF to_regclass('public.cloud_files') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.cloud_files t
     WHERE t.client_id = $1
     ORDER BY t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_signatures (exclui deletadas/arquivadas/bloqueadas/canceladas)
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
  IF to_regclass('public.signature_requests') IS NULL THEN
    RETURN;
  END IF;

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
       AND t.status <> ''cancelled''
     ORDER BY
       CASE WHEN t.status IN (''pending'',''in_progress'') THEN 0 ELSE 1 END,
       t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_agreements (financeiro com totais)
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
  IF to_regclass('public.agreements') IS NULL THEN
    RETURN;
  END IF;

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
    ORDER BY a.agreement_date DESC, a.created_at DESC
    $sql$
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_calendar (todos os eventos relevantes, não só futuros)
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
  IF to_regclass('public.calendar_events') IS NULL THEN
    RETURN;
  END IF;

  -- Eventos vinculados ao cliente (não-privados) — passados e futuros
  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.calendar_events t
     WHERE t.client_id = $1
       AND (t.is_private IS NULL OR t.is_private = false)
       AND t.start_at >= (now() - interval ''30 days'')
     ORDER BY t.start_at ASC LIMIT 100'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_deadlines (prazos vinculados ao cliente OU aos processos dele)
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
  IF to_regclass('public.deadlines') IS NULL THEN
    RETURN;
  END IF;

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
-- portal_list_notifications (process_notifications dos processos do cliente)
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
  IF to_regclass('public.process_notifications') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(n) FROM public.process_notifications n
     WHERE n.process_id IN (SELECT id FROM public.processes WHERE client_id = $1)
     ORDER BY n.created_at DESC LIMIT 100'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_dashboard_summary (agregado completo)
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
  -- Processos
  SELECT count(*), count(*) FILTER (WHERE status = 'ativo')
  INTO v_processes_total, v_processes_active
  FROM public.processes WHERE client_id = v_client_id;

  -- Assinaturas pendentes
  IF to_regclass('public.signature_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_signatures_pending
    FROM public.signature_requests
    WHERE client_id = v_client_id
      AND deleted_at IS NULL AND archived_at IS NULL AND blocked_at IS NULL
      AND status IN ('pending','in_progress');
  END IF;

  -- Prazos
  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE status = 'pendente' AND due_date >= current_date),
      count(*) FILTER (WHERE status = 'pendente' AND due_date < current_date)
    INTO v_deadlines_pending, v_deadlines_overdue
    FROM public.deadlines
    WHERE client_id = v_client_id
       OR process_id IN (SELECT id FROM public.processes WHERE client_id = v_client_id);
  END IF;

  -- Documentos
  IF to_regclass('public.cloud_files') IS NOT NULL THEN
    SELECT count(*) INTO v_documents_count
    FROM public.cloud_files WHERE client_id = v_client_id;
  END IF;

  -- Financeiro
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

  -- Próximo evento
  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    SELECT to_jsonb(e) INTO v_next_event
    FROM public.calendar_events e
    WHERE e.client_id = v_client_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= now()
    ORDER BY e.start_at ASC LIMIT 1;
  END IF;

  -- Próximo prazo
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

  -- Últimas movimentações
  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) || jsonb_build_object(
        'process_code', (SELECT p.process_code FROM public.processes p WHERE p.id = m.process_id)
      ) ORDER BY m.data DESC NULLS LAST), '[]'::jsonb)
    INTO v_recent_movements
    FROM (
      SELECT * FROM public.datajud_movimentos
      WHERE process_id IN (SELECT id FROM public.processes WHERE client_id = v_client_id)
      ORDER BY data DESC NULLS LAST
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
-- GRANT execução
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.portal_list_deadlines(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO anon, authenticated;
