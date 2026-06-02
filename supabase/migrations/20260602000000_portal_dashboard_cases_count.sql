-- Corrige portal_dashboard_summary:
-- 1. processesTotal agora inclui requerimentos INSS (total de casos do cliente)
-- 2. processesActive conta processos com status != 'arquivado' (em vez de status = 'ativo' que nunca batia)
-- 3. Adiciona requirementsTotal e casesTotal ao retorno

CREATE OR REPLACE FUNCTION public.portal_dashboard_summary(p_portal_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Processos judiciais
  SELECT
    count(*),
    count(*) FILTER (WHERE status != 'arquivado')
  INTO v_processes_total, v_processes_active
  FROM public.processes
  WHERE client_id = v_client_id;

  -- Requerimentos INSS
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
$$;

GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO anon, authenticated;

DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
