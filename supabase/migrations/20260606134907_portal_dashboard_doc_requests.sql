-- =============================================================================
-- Portal Dashboard: adiciona contagem de solicitações de documentos pendentes
--
-- Adiciona `docRequestsPending` ao retorno de portal_dashboard_summary,
-- contando document_requests com status 'pending' ou 'partial' do cliente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.portal_dashboard_summary(p_portal_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id              uuid    := public._portal_resolve_client(p_portal_user_id);
  v_processes_total        int     := 0;
  v_processes_active       int     := 0;
  v_requirements_total     int     := 0;
  v_signatures_pending     int     := 0;
  v_doc_requests_pending   int     := 0;
  v_deadlines_pending      int     := 0;
  v_deadlines_overdue      int     := 0;
  v_documents_count        int     := 0;
  v_total_value            numeric := 0;
  v_paid_value             numeric := 0;
  v_pending_value          numeric := 0;
  v_overdue_value          numeric := 0;
  v_next_event             jsonb   := NULL;
  v_next_deadline          jsonb   := NULL;
  v_next_installment       jsonb   := NULL;
  v_recent_movements       jsonb   := '[]'::jsonb;
BEGIN
  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    WITH names AS (
      SELECT m.process_id, string_agg(coalesce(m.nome,''), E'\n') AS nm
      FROM public.datajud_movimentos m
      JOIN public.processes p ON p.id = m.process_id AND p.client_id = v_client_id
      GROUP BY m.process_id
    )
    SELECT count(*),
           count(*) FILTER (WHERE public._portal_stage_from_names(names.nm, p.status) != 'arquivado')
    INTO v_processes_total, v_processes_active
    FROM public.processes p
    LEFT JOIN names ON names.process_id = p.id
    WHERE p.client_id = v_client_id;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE status != 'arquivado')
    INTO v_processes_total, v_processes_active
    FROM public.processes WHERE client_id = v_client_id;
  END IF;

  IF to_regclass('public.requirements') IS NOT NULL THEN
    SELECT count(*) INTO v_requirements_total
    FROM public.requirements WHERE client_id = v_client_id;
  END IF;

  IF to_regclass('public.signature_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_signatures_pending
    FROM public.signature_requests
    WHERE client_id = v_client_id
      AND deleted_at IS NULL AND archived_at IS NULL AND blocked_at IS NULL
      AND status IN ('pending','in_progress');
  END IF;

  IF to_regclass('public.document_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_doc_requests_pending
    FROM public.document_requests
    WHERE client_id = v_client_id
      AND status IN ('pending', 'partial');
  END IF;

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE status = 'pendente' AND due_date >= current_date),
      count(*) FILTER (WHERE status = 'pendente' AND due_date < current_date)
    INTO v_deadlines_pending, v_deadlines_overdue
    FROM (
      SELECT status, due_date FROM public.deadlines WHERE client_id = v_client_id
      UNION ALL
      SELECT d.status, d.due_date FROM public.deadlines d
      JOIN public.processes pr ON pr.id = d.process_id
      WHERE pr.client_id = v_client_id AND d.client_id IS DISTINCT FROM v_client_id
    ) dl;
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
    JOIN public.agreements a ON a.id = i.agreement_id
    WHERE a.client_id = v_client_id;

    SELECT to_jsonb(i) || jsonb_build_object('agreement_title', a.title)
      INTO v_next_installment
    FROM public.installments i
    JOIN public.agreements a ON a.id = i.agreement_id
    WHERE a.client_id = v_client_id AND i.status IN ('pendente','vencido')
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
    SELECT to_jsonb(d) || jsonb_build_object('process_code', pr.process_code)
      INTO v_next_deadline
    FROM public.deadlines d
    LEFT JOIN public.processes pr ON pr.id = d.process_id
    WHERE (d.client_id = v_client_id OR pr.client_id = v_client_id)
      AND d.status = 'pendente' AND d.due_date >= current_date
    ORDER BY d.due_date ASC LIMIT 1;
  END IF;

  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(to_jsonb(m) || jsonb_build_object('process_code', pr.process_code)
                ORDER BY m.data_hora DESC NULLS LAST), '[]'::jsonb)
    INTO v_recent_movements
    FROM (
      SELECT dm.* FROM public.datajud_movimentos dm
      JOIN public.processes pinner ON pinner.id = dm.process_id
      WHERE pinner.client_id = v_client_id
      ORDER BY dm.data_hora DESC NULLS LAST LIMIT 5
    ) m
    JOIN public.processes pr ON pr.id = m.process_id;
  END IF;

  RETURN jsonb_build_object(
    'processesTotal',       v_processes_total,
    'processesActive',      v_processes_active,
    'requirementsTotal',    v_requirements_total,
    'casesTotal',           v_processes_total + v_requirements_total,
    'signaturesPending',    v_signatures_pending,
    'docRequestsPending',   v_doc_requests_pending,
    'deadlinesPending',     v_deadlines_pending,
    'deadlinesOverdue',     v_deadlines_overdue,
    'documentsCount',       v_documents_count,
    'financial', jsonb_build_object('total', v_total_value, 'paid', v_paid_value,
                                    'pending', v_pending_value, 'overdue', v_overdue_value),
    'nextEvent',       v_next_event,
    'nextDeadline',    v_next_deadline,
    'nextInstallment', v_next_installment,
    'recentMovements', v_recent_movements
  );
END;
$$;
