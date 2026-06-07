-- ============================================================================
-- RPC: get_client_calendar_events
-- Retorna eventos de agenda vinculados a um cliente por:
--   - client_id direto
--   - process_id de processo do cliente
--   - requirement_id de requerimento do cliente
-- Substitui o carregamento global + filtragem client-side no ClientDetails.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_client_calendar_events(p_client_id uuid)
RETURNS SETOF public.calendar_events
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ce.*
  FROM public.calendar_events ce
  WHERE
    ce.client_id = p_client_id
    OR ce.process_id     IN (SELECT id FROM public.processes     WHERE client_id = p_client_id)
    OR ce.requirement_id IN (SELECT id FROM public.requirements  WHERE client_id = p_client_id)
  ORDER BY ce.start_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_calendar_events(uuid) TO authenticated;
