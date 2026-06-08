-- Atualiza portal_get_process para incluir análise IA (summary, urgency, deadline)
-- de intimation_ai_analysis em cada publicação DJEN retornada.
-- Antes: cliente via só o texto bruto da intimação.
-- Depois: cliente vê badge de urgência + resumo em linguagem simples.

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
          'id',                   dc.id,
          'data',                 dc.data_disponibilizacao,
          'tipo',                 COALESCE(dc.tipo_documento, dc.tipo_comunicacao, 'Publicação'),
          'orgao',                dc.nome_orgao,
          'texto',                dc.texto,
          'ai_summary',           ia.summary,
          'ai_urgency',           ia.urgency,
          'ai_deadline_days',     ia.deadline_days,
          'ai_deadline_due_date', ia.deadline_due_date
        )
        ORDER BY dc.data_disponibilizacao DESC NULLS LAST
      ),
      '[]'::jsonb
    )
    INTO v_publications
    FROM public.djen_comunicacoes dc
    LEFT JOIN public.intimation_ai_analysis ia ON ia.intimation_id = dc.id
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
    'status',       v_eff_status,
    'status_raw',   v_raw_status,
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
