-- Atualiza portal_get_process para buscar publicações DJEN diretamente de
-- djen_comunicacoes (texto integral + orgao + data correta) em vez de
-- process_notifications (que só tem descrição curta sem o texto completo).
-- Isso resolve o campo "publications" no portal ficar vazio e a IA
-- não conseguir extrair valores (R$) da sentença.

CREATE OR REPLACE FUNCTION public.portal_get_process(p_portal_user_id uuid, p_process_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id   uuid    := public._portal_resolve_client(p_portal_user_id);
  v_process     jsonb;
  v_movements   jsonb   := '[]'::jsonb;
  v_deadlines   jsonb   := '[]'::jsonb;
  v_publications jsonb  := '[]'::jsonb;
  v_appointments jsonb  := '[]'::jsonb;
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

  -- Publicações DJEN com texto integral (campo "texto") para análise por IA
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

  -- Compromissos da agenda vinculados a este processo
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
    )
    INTO v_appointments
    FROM public.calendar_events e
    WHERE e.process_id = p_process_id
      AND (e.is_private IS NULL OR e.is_private = false)
      AND e.start_at >= (now() - interval '30 days');
  END IF;

  RETURN v_process || jsonb_build_object(
    'movements',    v_movements,
    'deadlines',    v_deadlines,
    'publications', v_publications,
    'appointments', v_appointments
  );
END;
$$;

-- Garante execute para portal_client
DO $$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.portal_get_process(uuid, uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
