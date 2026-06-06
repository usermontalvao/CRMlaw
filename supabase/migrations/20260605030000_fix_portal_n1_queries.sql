-- =============================================================================
-- Fix performance: portal_list_processes e portal_dashboard_summary
--
-- Problema raiz: N+1 — para cada processo, 3 subqueries correlacionadas rodavam
-- separadamente no portal_list_processes. Com 10 processos = 30 queries extras.
-- portal_dashboard_summary tambem tinha subquery correlacionada dentro de
-- jsonb_agg e OR que impedia uso de indice em deadlines.
--
-- Solucao:
--   1. portal_list_processes -> CTEs + LEFT JOINs (3 queries totais, nao N*3)
--   2. portal_dashboard_summary -> JOIN para process_code, CTE para deadlines
--   3. Indices nos hot paths
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Indices nos hot paths
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_processes_client_id
  ON public.processes(client_id);

CREATE INDEX IF NOT EXISTS idx_datajud_movimentos_process_data
  ON public.datajud_movimentos(process_id, data_hora DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_deadlines_process_status
  ON public.deadlines(process_id, status);

CREATE INDEX IF NOT EXISTS idx_deadlines_client_id
  ON public.deadlines(client_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_process_start
  ON public.calendar_events(process_id, start_at ASC);

-- ----------------------------------------------------------------------------
-- 2. portal_list_processes: elimina N+1 via CTEs
--    Antes: N processos = N*3 subqueries correlacionadas
--    Depois: sempre 4 queries totais (1 por CTE + 1 JOIN final)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_list_processes(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_client_id     uuid    := public._portal_resolve_client(p_portal_user_id);
  v_has_movements boolean := to_regclass('public.datajud_movimentos') IS NOT NULL;
  v_has_deadlines boolean := to_regclass('public.deadlines') IS NOT NULL;
  v_has_calendar  boolean := to_regclass('public.calendar_events') IS NOT NULL;
BEGIN
  IF v_has_movements AND v_has_deadlines AND v_has_calendar THEN
    -- Caminho otimizado: CTEs + LEFT JOINs
    RETURN QUERY
    WITH proc_ids AS (
      SELECT p.id FROM public.processes p WHERE p.client_id = v_client_id
    ),
    last_mov AS (
      SELECT DISTINCT ON (m.process_id)
        m.process_id,
        to_jsonb(m) AS j
      FROM public.datajud_movimentos m
      WHERE m.process_id IN (SELECT id FROM proc_ids)
      ORDER BY m.process_id, m.data_hora DESC NULLS LAST
    ),
    mov_counts AS (
      SELECT m.process_id, count(*)::int AS cnt
      FROM public.datajud_movimentos m
      WHERE m.process_id IN (SELECT id FROM proc_ids)
      GROUP BY m.process_id
    ),
    dl_counts AS (
      SELECT d.process_id, count(*)::int AS cnt
      FROM public.deadlines d
      WHERE d.process_id IN (SELECT id FROM proc_ids)
        AND d.status = 'pendente'
      GROUP BY d.process_id
    ),
    next_apt AS (
      SELECT DISTINCT ON (e.process_id)
        e.process_id,
        jsonb_build_object(
          'id',         e.id,
          'title',      e.title,
          'event_type', e.event_type,
          'event_mode', e.event_mode,
          'start_at',   e.start_at
        ) AS j
      FROM public.calendar_events e
      WHERE e.process_id IN (SELECT id FROM proc_ids)
        AND (e.is_private IS NULL OR e.is_private = false)
        AND e.start_at >= now()
      ORDER BY e.process_id, e.start_at ASC
    )
    SELECT to_jsonb(p) || jsonb_build_object(
        'movements_count',   COALESCE(mc.cnt, 0),
        'last_movement',     lm.j,
        'pending_deadlines', COALESCE(dc.cnt, 0),
        'next_appointment',  na.j
      )
    FROM public.processes p
    LEFT JOIN last_mov   lm ON lm.process_id = p.id
    LEFT JOIN mov_counts mc ON mc.process_id = p.id
    LEFT JOIN dl_counts  dc ON dc.process_id = p.id
    LEFT JOIN next_apt   na ON na.process_id = p.id
    WHERE p.client_id = v_client_id
    ORDER BY
      CASE WHEN p.status = 'ativo' THEN 0 ELSE 1 END,
      p.updated_at DESC NULLS LAST,
      p.created_at DESC;

  ELSE
    -- Fallback para ambientes sem todas as tabelas (dev/staging antigo)
    RETURN QUERY
    SELECT to_jsonb(p) || jsonb_build_object(
        'movements_count',
          CASE WHEN v_has_movements THEN COALESCE((
            SELECT count(*) FROM public.datajud_movimentos m WHERE m.process_id = p.id
          ), 0) ELSE 0 END,
        'last_movement',
          CASE WHEN v_has_movements THEN (
            SELECT to_jsonb(m) FROM public.datajud_movimentos m
            WHERE m.process_id = p.id
            ORDER BY m.data_hora DESC NULLS LAST LIMIT 1
          ) ELSE NULL END,
        'pending_deadlines',
          CASE WHEN v_has_deadlines THEN COALESCE((
            SELECT count(*) FROM public.deadlines d
            WHERE d.process_id = p.id AND d.status = 'pendente'
          ), 0) ELSE 0 END,
        'next_appointment', NULL::jsonb
      )
    FROM public.processes p
    WHERE p.client_id = v_client_id
    ORDER BY
      CASE WHEN p.status = 'ativo' THEN 0 ELSE 1 END,
      p.updated_at DESC NULLS LAST,
      p.created_at DESC;
  END IF;
END;
$func$;

-- ----------------------------------------------------------------------------
-- 3. portal_dashboard_summary: elimina subquery correlacionada em jsonb_agg
--    e reescreve OR de deadlines como UNION (OR bloqueia uso de indice)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portal_dashboard_summary(p_portal_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_client_id           uuid    := public._portal_resolve_client(p_portal_user_id);
  v_processes_total     int     := 0;
  v_processes_active    int     := 0;
  v_requirements_total  int     := 0;
  v_signatures_pending  int     := 0;
  v_deadlines_pending   int     := 0;
  v_deadlines_overdue   int     := 0;
  v_documents_count     int     := 0;
  v_total_value         numeric := 0;
  v_paid_value          numeric := 0;
  v_pending_value       numeric := 0;
  v_overdue_value       numeric := 0;
  v_next_event          jsonb   := NULL;
  v_next_deadline       jsonb   := NULL;
  v_next_installment    jsonb   := NULL;
  v_recent_movements    jsonb   := '[]'::jsonb;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status != 'arquivado')
  INTO v_processes_total, v_processes_active
  FROM public.processes
  WHERE client_id = v_client_id;

  IF to_regclass('public.requirements') IS NOT NULL THEN
    SELECT count(*) INTO v_requirements_total
    FROM public.requirements
    WHERE client_id = v_client_id;
  END IF;

  IF to_regclass('public.signature_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_signatures_pending
    FROM public.signature_requests
    WHERE client_id = v_client_id
      AND deleted_at IS NULL AND archived_at IS NULL AND blocked_at IS NULL
      AND status IN ('pending','in_progress');
  END IF;

  -- Prazos: UNION em vez de OR (OR impede uso de indice em ambas as colunas)
  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE status = 'pendente' AND due_date >= current_date),
      count(*) FILTER (WHERE status = 'pendente' AND due_date < current_date)
    INTO v_deadlines_pending, v_deadlines_overdue
    FROM (
      SELECT status, due_date
      FROM public.deadlines
      WHERE client_id = v_client_id
      UNION ALL
      SELECT d.status, d.due_date
      FROM public.deadlines d
      JOIN public.processes pr ON pr.id = d.process_id
      WHERE pr.client_id = v_client_id
        AND d.client_id IS DISTINCT FROM v_client_id
    ) dl;
  END IF;

  IF to_regclass('public.cloud_files') IS NOT NULL THEN
    SELECT count(*) INTO v_documents_count
    FROM public.cloud_files WHERE client_id = v_client_id;
  END IF;

  IF to_regclass('public.agreements') IS NOT NULL AND to_regclass('public.installments') IS NOT NULL THEN
    SELECT COALESCE(sum(a.total_value), 0) INTO v_total_value
    FROM public.agreements a WHERE a.client_id = v_client_id;

    -- JOIN em vez de subquery IN(subquery)
    SELECT
      COALESCE(sum(COALESCE(i.paid_value, i.value)) FILTER (WHERE i.status = 'pago'), 0),
      COALESCE(sum(i.value) FILTER (WHERE i.status = 'pendente'), 0),
      COALESCE(sum(i.value) FILTER (WHERE i.status = 'vencido'), 0)
    INTO v_paid_value, v_pending_value, v_overdue_value
    FROM public.installments i
    JOIN public.agreements a ON a.id = i.agreement_id
    WHERE a.client_id = v_client_id;

    -- Proxima parcela com JOIN em vez de subquery correlacionada
    SELECT to_jsonb(i) || jsonb_build_object('agreement_title', a.title)
      INTO v_next_installment
    FROM public.installments i
    JOIN public.agreements a ON a.id = i.agreement_id
    WHERE a.client_id = v_client_id
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

  -- Proximo prazo com JOIN em vez de subquery correlacionada
  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT to_jsonb(d) || jsonb_build_object('process_code', pr.process_code)
      INTO v_next_deadline
    FROM public.deadlines d
    LEFT JOIN public.processes pr ON pr.id = d.process_id
    WHERE (d.client_id = v_client_id OR pr.client_id = v_client_id)
      AND d.status = 'pendente'
      AND d.due_date >= current_date
    ORDER BY d.due_date ASC LIMIT 1;
  END IF;

  -- Movimentos recentes: JOIN em vez de subquery correlacionada dentro de jsonb_agg
  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        to_jsonb(m) || jsonb_build_object('process_code', pr.process_code)
        ORDER BY m.data_hora DESC NULLS LAST
      ),
      '[]'::jsonb
    )
    INTO v_recent_movements
    FROM (
      SELECT dm.*
      FROM public.datajud_movimentos dm
      JOIN public.processes pinner ON pinner.id = dm.process_id
      WHERE pinner.client_id = v_client_id
      ORDER BY dm.data_hora DESC NULLS LAST
      LIMIT 5
    ) m
    JOIN public.processes pr ON pr.id = m.process_id;
  END IF;

  RETURN jsonb_build_object(
    'processesTotal',    v_processes_total,
    'processesActive',   v_processes_active,
    'requirementsTotal', v_requirements_total,
    'casesTotal',        v_processes_total + v_requirements_total,
    'signaturesPending', v_signatures_pending,
    'deadlinesPending',  v_deadlines_pending,
    'deadlinesOverdue',  v_deadlines_overdue,
    'documentsCount',    v_documents_count,
    'financial', jsonb_build_object(
      'total',   v_total_value,
      'paid',    v_paid_value,
      'pending', v_pending_value,
      'overdue', v_overdue_value
    ),
    'nextEvent',       v_next_event,
    'nextDeadline',    v_next_deadline,
    'nextInstallment', v_next_installment,
    'recentMovements', v_recent_movements
  );
END;
$func$;

-- ----------------------------------------------------------------------------
-- 4. GRANTs
-- ----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.portal_list_processes(uuid)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO anon, authenticated;

DO $grant$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_list_processes(uuid)    TO portal_client';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $grant$;
