-- Portal do Cliente — Requerimentos Administrativos (INSS)
-- Expõe requirements filtrados por client_id de forma segura (SECURITY DEFINER).
-- Não inclui campos sensíveis: inss_password, notes internas.

-- ── portal_list_requirements ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_list_requirements(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.requirements') IS NULL THEN RETURN; END IF;

  RETURN QUERY
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
      'created_at',        r.created_at,
      'updated_at',        r.updated_at
    )
    FROM public.requirements r
    WHERE r.client_id = v_client_id
      AND (r.archived IS NULL OR r.archived = false)
    ORDER BY
      -- Prioridade: exigência e perícia primeiro (precisam de atenção)
      CASE r.status
        WHEN 'em_exigencia'     THEN 0
        WHEN 'aguardando_pericia' THEN 1
        ELSE 2
      END,
      r.updated_at DESC;
END;
$$;

-- ── portal_get_requirement ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_get_requirement(p_portal_user_id uuid, p_requirement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id    uuid := public._portal_resolve_client(p_portal_user_id);
  v_req          jsonb;
  v_appointments jsonb := '[]'::jsonb;
BEGIN
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
    'created_at',        r.created_at,
    'updated_at',        r.updated_at
  ) INTO v_req
  FROM public.requirements r
  WHERE r.id = p_requirement_id AND r.client_id = v_client_id
  LIMIT 1;

  IF v_req IS NULL THEN RETURN NULL; END IF;

  -- Compromissos da agenda vinculados a este requerimento
  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',         e.id,
          'title',      e.title,
          'event_type', e.event_type,
          'event_mode', e.event_mode,
          'start_at',   e.start_at,
          'end_at',     e.end_at,
          'status',     e.status,
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

  RETURN v_req || jsonb_build_object('appointments', v_appointments);
END;
$$;

-- ── Grants para portal_client ────────────────────────────────────────────────
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_list_requirements(uuid) TO portal_client';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_get_requirement(uuid, uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
