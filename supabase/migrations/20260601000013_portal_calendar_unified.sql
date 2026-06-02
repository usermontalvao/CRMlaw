-- portal_list_calendar — versão unificada
-- Retorna UNION de:
--   1. calendar_events do cliente (agenda manual)
--   2. Audiências registradas em processes.hearing_date
--      (somente se não existir calendar_event de hearing para o mesmo processo
--       na mesma data — evita duplicata quando ambas as fontes cobrem o mesmo evento)

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

  RETURN QUERY
  SELECT combined.evt
  FROM (

    -- 1. Eventos manuais da agenda (calendar_events)
    SELECT
      t.start_at AS sort_key,
      to_jsonb(t) AS evt
    FROM public.calendar_events t
    WHERE t.client_id = v_client_id
      AND (t.is_private IS NULL OR t.is_private = false)
      AND t.start_at >= (now() - interval '30 days')

    UNION ALL

    -- 2. Audiências do módulo Processos (hearing_date)
    -- Excluídas quando já existe calendar_event de hearing para o mesmo processo na mesma data
    SELECT
      -- Combina data + hora para ordenação correta
      CASE
        WHEN p.hearing_time IS NOT NULL
          THEN (p.hearing_date::text || 'T' || left(p.hearing_time::text, 8))::timestamptz
        ELSE p.hearing_date::date::timestamptz
      END AS sort_key,
      jsonb_build_object(
        'id',          'process-hearing-' || p.id,
        'title',       'Audiência — ' || p.process_code,
        'event_type',  'hearing',
        'event_mode',  p.hearing_mode,
        'start_at',    CASE
                         WHEN p.hearing_time IS NOT NULL
                           THEN p.hearing_date::text || 'T' || left(p.hearing_time::text, 5)
                         ELSE p.hearing_date::text
                       END,
        'end_at',      null,
        'status',      'pendente',
        'description', null,
        'process_id',  p.id,
        'client_id',   p.client_id,
        'is_private',  false,
        'created_at',  p.updated_at,
        'updated_at',  p.updated_at
      ) AS evt
    FROM public.processes p
    WHERE p.client_id = v_client_id
      AND p.hearing_scheduled = true
      AND p.hearing_date IS NOT NULL
      AND p.hearing_date >= (current_date - 30)
      -- Não duplica se já há calendar_event de hearing para este processo na mesma data
      AND NOT EXISTS (
        SELECT 1
        FROM public.calendar_events ce
        WHERE ce.process_id = p.id
          AND ce.event_type = 'hearing'
          AND DATE(ce.start_at AT TIME ZONE 'UTC') = p.hearing_date
      )

  ) combined
  ORDER BY combined.sort_key ASC
  LIMIT 200;
END;
$$;

-- Garante execute para portal_client
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_list_calendar(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
