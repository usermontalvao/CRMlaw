-- =============================================================================
-- Inferência automática de fase processual — fonte única de verdade
--
-- Problema: o DataJud registra movimentos procedurais ("remessa ao arquivo",
-- "Evolução da Classe Processual") que faziam o status do processo virar
-- 'arquivado' incorretamente, mesmo com a execução/cumprimento ativos. A
-- correção só acontecia no frontend ao abrir a timeline e não persistia.
--
-- Solução (esta migration):
--   1. _portal_stage_from_names(): função PURA que infere a fase real a partir
--      de TODO o contexto de movimentos. Fonte única de verdade.
--   2. Todas as RPCs do portal (get_process, list_processes, dashboard) passam
--      a devolver o status inferido — correto em qualquer tela, automaticamente.
--   3. Trigger em datajud_movimentos: recalcula e PERSISTE processes.status
--      sempre que um movimento relevante chega — automático, sem depender de
--      abrir a timeline nem do sync de 2/2 dias.
--   4. recompute_process_statuses(): backfill/recompute sob demanda (cron/admin).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fonte única de verdade — inferência pura (IMMUTABLE, sem acesso a tabelas)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_stage_from_names(p_names text, p_db_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $func$
DECLARE
  n text := lower(coalesce(p_names, ''));
BEGIN
  IF n = '' THEN RETURN p_db_status; END IF;

  -- 1. Sinal EXPLÍCITO de cumprimento/execução (maior prioridade).
  IF n ~ '(cumprimento|execu[çc][ãa]o|liquida[çc][ãa]o|penhora|alvar[áa]|precat[óo]rio|\mrpv\M|pagamento do d[ée]bito|pagamento de debito|bloqueio de valores|bacenjud|sisbajud|renajud)' THEN
    RETURN 'cumprimento';
  END IF;

  -- 2. "Evolução da Classe Processual" (transição de fase CNJ) + sentença ⇒ cumprimento.
  IF n ~ 'evolu[çc][ãa]o da classe'
     AND n ~ '(senten[çc]a|tr[âa]nsito|proced[êe]ncia|improced[êe]ncia)' THEN
    RETURN 'cumprimento';
  END IF;

  -- 3. Recurso — só eleva se o status atual é fase inferior.
  IF n ~ '(apela[çc][ãa]o|agravo|\membargos\M|ac[óo]rd[ãa]o)'
     AND (p_db_status IS NULL OR p_db_status IN ('sentenca','instrucao','andamento','citacao','distribuido','arquivado')) THEN
    RETURN 'recurso';
  END IF;

  -- 4. Banco diz 'arquivado' mas há sentença (sem execução/recurso) ⇒ sentença.
  IF p_db_status = 'arquivado'
     AND n ~ '(senten[çc]a|tr[âa]nsito|proced[êe]ncia|improced[êe]ncia)' THEN
    RETURN 'sentenca';
  END IF;

  RETURN p_db_status;
END;
$func$;

GRANT EXECUTE ON FUNCTION public._portal_stage_from_names(text, text) TO anon, authenticated;
DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._portal_stage_from_names(text, text) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;

-- ----------------------------------------------------------------------------
-- 2. Recompute persistente (backfill/cron/admin) + trigger automático
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_process_statuses(p_process_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_count int := 0;
  r record;
  v_eff text;
BEGIN
  FOR r IN
    SELECT p.id, p.status AS st,
      (SELECT string_agg(coalesce(m.nome,''), E'\n')
         FROM public.datajud_movimentos m WHERE m.process_id = p.id) AS names
    FROM public.processes p
    WHERE (p_process_id IS NULL OR p.id = p_process_id)
  LOOP
    v_eff := public._portal_stage_from_names(r.names, r.st);
    IF v_eff IS NOT NULL AND v_eff IS DISTINCT FROM r.st THEN
      UPDATE public.processes SET status = v_eff, updated_at = now() WHERE id = r.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_process_statuses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_process_statuses(uuid) TO authenticated, service_role;

-- Trigger: recalcula processes.status quando um movimento RELEVANTE é gravado.
-- Pré-filtro por keyword mantém o trigger barato para movimentos irrelevantes.
CREATE OR REPLACE FUNCTION public._trg_recompute_process_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_names text;
  v_eff   text;
  v_cur   text;
BEGIN
  IF lower(coalesce(NEW.nome,'')) !~ '(cumprimento|execu|liquida|penhora|alvar|precat|\mrpv\M|bacenjud|sisbajud|renajud|evolu[çc][ãa]o da classe|senten|tr[âa]nsito|proced|apela|agravo|embargos|ac[óo]rd|arquiv|extin|cita)' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(coalesce(m.nome,''), E'\n') INTO v_names
  FROM public.datajud_movimentos m WHERE m.process_id = NEW.process_id;

  SELECT status INTO v_cur FROM public.processes WHERE id = NEW.process_id;

  v_eff := public._portal_stage_from_names(v_names, v_cur);
  IF v_eff IS NOT NULL AND v_eff IS DISTINCT FROM v_cur THEN
    UPDATE public.processes SET status = v_eff, updated_at = now() WHERE id = NEW.process_id;
  END IF;

  RETURN NEW;
END;
$func$;

-- Trigger function não deve ser chamável via REST (executa pelo mecanismo de trigger).
REVOKE ALL ON FUNCTION public._trg_recompute_process_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recompute_process_status ON public.datajud_movimentos;
CREATE TRIGGER trg_recompute_process_status
AFTER INSERT OR UPDATE OF nome ON public.datajud_movimentos
FOR EACH ROW EXECUTE FUNCTION public._trg_recompute_process_status();

-- Backfill inicial dos processos já existentes com status defasado.
SELECT public.recompute_process_statuses(NULL);

-- ----------------------------------------------------------------------------
-- 3. portal_get_process — devolve status inferido (analisa todo o contexto)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_process(p_portal_user_id uuid, p_process_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id    uuid    := public._portal_resolve_client(p_portal_user_id);
  v_process      jsonb;
  v_movements    jsonb   := '[]'::jsonb;
  v_deadlines    jsonb   := '[]'::jsonb;
  v_publications jsonb   := '[]'::jsonb;
  v_appointments jsonb   := '[]'::jsonb;
  v_names        text;
  v_raw_status   text;
  v_eff_status   text;
BEGIN
  SELECT to_jsonb(p) INTO v_process
  FROM public.processes p
  WHERE p.id = p_process_id AND p.client_id = v_client_id
  LIMIT 1;

  IF v_process IS NULL THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.datajud_movimentos') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.data_hora DESC NULLS LAST), '[]'::jsonb),
           string_agg(coalesce(m.nome,''), E'\n')
      INTO v_movements, v_names
    FROM public.datajud_movimentos m
    WHERE m.process_id = p_process_id;
  END IF;

  v_raw_status := v_process->>'status';
  v_eff_status := public._portal_stage_from_names(v_names, v_raw_status);

  IF to_regclass('public.deadlines') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.due_date ASC), '[]'::jsonb)
      INTO v_deadlines
    FROM public.deadlines d
    WHERE d.process_id = p_process_id;
  END IF;

  IF to_regclass('public.djen_comunicacoes') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',    dc.id,
          'data',  dc.data_disponibilizacao,
          'tipo',  COALESCE(dc.tipo_documento, dc.tipo_comunicacao, 'Publicação'),
          'orgao', dc.nome_orgao,
          'texto', dc.texto
        )
        ORDER BY dc.data_disponibilizacao DESC NULLS LAST
      ),
      '[]'::jsonb
    )
    INTO v_publications
    FROM public.djen_comunicacoes dc
    WHERE dc.process_id = p_process_id
      AND dc.ativo = true;
  END IF;

  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',          e.id,
          'title',       e.title,
          'event_type',  e.event_type,
          'event_mode',  e.event_mode,
          'start_at',    e.start_at,
          'end_at',      e.end_at,
          'status',      e.status,
          'description', e.description
        )
        ORDER BY e.start_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_appointments
    FROM public.calendar_events e
    WHERE e.process_id = p_process_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= (now() - interval '30 days');
  END IF;

  RETURN v_process || jsonb_build_object(
    'status',       v_eff_status,   -- fase REAL inferida (sobrescreve a gravada)
    'status_raw',   v_raw_status,   -- fase original no banco (transparência/debug)
    'movements',    v_movements,
    'deadlines',    v_deadlines,
    'publications', v_publications,
    'appointments', v_appointments
  );
END;
$function$;

DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_get_process(uuid, uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;

-- ----------------------------------------------------------------------------
-- 4. portal_list_processes — status inferido também na lista de casos
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
    RETURN QUERY
    WITH proc_ids AS (
      SELECT p.id FROM public.processes p WHERE p.client_id = v_client_id
    ),
    last_mov AS (
      SELECT DISTINCT ON (m.process_id) m.process_id, to_jsonb(m) AS j
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
    name_agg AS (
      SELECT m.process_id, string_agg(coalesce(m.nome,''), E'\n') AS names
      FROM public.datajud_movimentos m
      WHERE m.process_id IN (SELECT id FROM proc_ids)
      GROUP BY m.process_id
    ),
    dl_counts AS (
      SELECT d.process_id, count(*)::int AS cnt
      FROM public.deadlines d
      WHERE d.process_id IN (SELECT id FROM proc_ids) AND d.status = 'pendente'
      GROUP BY d.process_id
    ),
    next_apt AS (
      SELECT DISTINCT ON (e.process_id) e.process_id,
        jsonb_build_object('id', e.id, 'title', e.title, 'event_type', e.event_type,
                           'event_mode', e.event_mode, 'start_at', e.start_at) AS j
      FROM public.calendar_events e
      WHERE e.process_id IN (SELECT id FROM proc_ids)
        AND (e.is_private IS NULL OR e.is_private = false)
        AND e.start_at >= now()
      ORDER BY e.process_id, e.start_at ASC
    )
    SELECT to_jsonb(p) || jsonb_build_object(
        'status',            public._portal_stage_from_names(na2.names, p.status),
        'status_raw',        p.status,
        'movements_count',   COALESCE(mc.cnt, 0),
        'last_movement',     lm.j,
        'pending_deadlines', COALESCE(dc.cnt, 0),
        'next_appointment',  na.j
      )
    FROM public.processes p
    LEFT JOIN last_mov   lm  ON lm.process_id  = p.id
    LEFT JOIN mov_counts mc  ON mc.process_id  = p.id
    LEFT JOIN name_agg   na2 ON na2.process_id = p.id
    LEFT JOIN dl_counts  dc  ON dc.process_id  = p.id
    LEFT JOIN next_apt   na  ON na.process_id  = p.id
    WHERE p.client_id = v_client_id
    ORDER BY
      CASE WHEN public._portal_stage_from_names(na2.names, p.status) = 'arquivado' THEN 1 ELSE 0 END,
      p.updated_at DESC NULLS LAST,
      p.created_at DESC;

  ELSE
    RETURN QUERY
    SELECT to_jsonb(p) || jsonb_build_object(
        'movements_count',
          CASE WHEN v_has_movements THEN COALESCE((
            SELECT count(*) FROM public.datajud_movimentos m WHERE m.process_id = p.id
          ), 0) ELSE 0 END,
        'last_movement',
          CASE WHEN v_has_movements THEN (
            SELECT to_jsonb(m) FROM public.datajud_movimentos m
            WHERE m.process_id = p.id ORDER BY m.data_hora DESC NULLS LAST LIMIT 1
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
      CASE WHEN p.status = 'arquivado' THEN 1 ELSE 0 END,
      p.updated_at DESC NULLS LAST, p.created_at DESC;
  END IF;
END;
$func$;

DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_list_processes(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;

-- ----------------------------------------------------------------------------
-- 5. portal_dashboard_summary — "casos ativos" considera a fase real
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
    'processesTotal',    v_processes_total,
    'processesActive',   v_processes_active,
    'requirementsTotal', v_requirements_total,
    'casesTotal',        v_processes_total + v_requirements_total,
    'signaturesPending', v_signatures_pending,
    'deadlinesPending',  v_deadlines_pending,
    'deadlinesOverdue',  v_deadlines_overdue,
    'documentsCount',    v_documents_count,
    'financial', jsonb_build_object('total', v_total_value, 'paid', v_paid_value,
                                    'pending', v_pending_value, 'overdue', v_overdue_value),
    'nextEvent',       v_next_event,
    'nextDeadline',    v_next_deadline,
    'nextInstallment', v_next_installment,
    'recentMovements', v_recent_movements
  );
END;
$func$;

DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_dashboard_summary(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;
