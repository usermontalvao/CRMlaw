-- Portal — Requerimentos: adiciona linked_processes ao portal_get_requirement
-- Corrige a ausência de processos vinculados (principal / ms) na resposta da RPC,
-- que impedia o frontend de exibir o "fork" e ajustar os compromissos corretamente.

CREATE OR REPLACE FUNCTION public.portal_get_requirement(p_portal_user_id uuid, p_requirement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id       uuid := public._portal_resolve_client(p_portal_user_id);
  v_req             jsonb;
  v_appointments    jsonb := '[]'::jsonb;
  v_linked_procs    jsonb := '[]'::jsonb;
BEGIN
  -- Valida posse do requerimento
  SELECT jsonb_build_object(
    'id',                r.id,
    'protocol',          r.protocol,
    'beneficiary',       r.beneficiary,
    'benefit_type',      r.benefit_type,
    'status',            r.status,
    'entry_date',        r.entry_date,
    'exigency_due_date', r.exigency_due_date,
    'pericia_medica_at', r.pericia_medica_at,
    'pericia_social_at', r.pericia_social_at,
    'observations',      r.observations,
    'archived',          r.archived,
    'created_at',        r.created_at,
    'updated_at',        r.updated_at
  ) INTO v_req
  FROM public.requirements r
  WHERE r.id = p_requirement_id AND r.client_id = v_client_id
  LIMIT 1;

  IF v_req IS NULL THEN RETURN NULL; END IF;

  -- Compromissos da agenda vinculados a este requerimento
  -- (30 dias no passado até qualquer data futura)
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
    ) INTO v_appointments
    FROM public.calendar_events e
    WHERE e.requirement_id = p_requirement_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= (now() - interval '30 days');
  END IF;

  -- Processos judiciais nascidos deste requerimento (principal ou MS)
  IF to_regclass('public.processes') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'processes'
      AND column_name  = 'requirement_id'
  ) THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'process_code',     p.process_code,
          'status',           p.status,
          'practice_area',    p.practice_area,
          'court',            p.court,
          'requirement_role', p.requirement_role,
          'distributed_at',   p.distributed_at
        )
        ORDER BY p.created_at ASC
      ),
      '[]'::jsonb
    ) INTO v_linked_procs
    FROM public.processes p
    WHERE p.requirement_id = p_requirement_id;
  END IF;

  RETURN v_req
    || jsonb_build_object('appointments',     v_appointments)
    || jsonb_build_object('linked_processes', v_linked_procs);
END;
$$;

-- Garante permissão (idempotente)
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_get_requirement(uuid, uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
