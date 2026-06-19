-- =============================================================================
-- Agenda · Confirmação DJEN também para as AUDIÊNCIAS VIRTUAIS (read-only)
-- =============================================================================
-- PROBLEMA
--   O calendário monta eventos de duas fontes:
--     - calendar_events  (customEvents)  -> possuem djen_status, cobertos pela
--       rotina/trigger DJEN;
--     - processes/deadlines/requirements (systemEvents, virtuais) -> NÃO têm
--       djen_status.
--   As "AUDIÊNCIA - <modo> - <cliente>" exibidas na Agenda são geradas a partir
--   de processes.hearing_scheduled (CalendarModule.tsx, bloco "Audiências"),
--   com id `hearing-<process.id>`. Como nunca foram para calendar_events, a
--   confirmação DJEN jamais as alcançava: ficavam sempre com o ponto cinza.
--
-- SOLUÇÃO (somente confirmação/exibição — NÃO cria nem altera compromissos)
--   1. Extrair a regra de match para fn_match_djen_for_process(process_id, date),
--      tornando-a fonte única reutilizável.
--   2. fn_check_djen_status passa a DELEGAR a ela (comportamento idêntico ao
--      anterior; rotina diária e trigger seguem inalterados).
--   3. Nova RPC read-only fn_djen_hearing_statuses() devolve em lote o status
--      DJEN das audiências de processes (>= hoje). O frontend apenas consome
--      para acender o selo verde/âmbar/cinza — nenhuma gravação envolvida.
-- =============================================================================

-- 1) Regra central de match DJEN extraída para reuso (fonte única).
CREATE OR REPLACE FUNCTION public.fn_match_djen_for_process(
  p_process_id uuid,
  p_event_date date
)
RETURNS TABLE(status text, intimation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comm             record;
  v_found_match      bool := false;
  v_found_divergence bool := false;
  v_best_id          uuid;
  v_dates            date[];
BEGIN
  IF p_process_id IS NULL OR p_event_date IS NULL THEN
    RETURN QUERY SELECT 'unconfirmed'::text, NULL::uuid;
    RETURN;
  END IF;

  FOR v_comm IN
    SELECT dc.id, dc.texto
    FROM djen_comunicacoes dc
    WHERE dc.process_id = p_process_id
      AND (
        dc.texto ILIKE '%audiência%'   OR dc.texto ILIKE '%audiencia%' OR
        dc.texto ILIKE '%perícia%'     OR dc.texto ILIKE '%pericia%'   OR
        dc.texto ILIKE '%conciliação%' OR dc.texto ILIKE '%instrução%' OR
        dc.texto ILIKE '%una%'
      )
    ORDER BY dc.data_disponibilizacao DESC
  LOOP
    SELECT ARRAY(
      SELECT to_date(m[1], 'DD/MM/YYYY')
      FROM regexp_matches(v_comm.texto, '(\d{2}/\d{2}/\d{4})', 'g') AS m
    ) INTO v_dates;

    IF p_event_date = ANY(v_dates) THEN
      v_found_match := true;
      v_best_id     := v_comm.id;
      EXIT;
    ELSIF array_length(v_dates, 1) > 0 THEN
      v_found_divergence := true;
      IF v_best_id IS NULL THEN v_best_id := v_comm.id; END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    CASE WHEN v_found_match      THEN 'confirmed'
         WHEN v_found_divergence THEN 'divergence'
         ELSE                         'unconfirmed' END,
    v_best_id;
END;
$function$;

-- 2) fn_check_djen_status agora DELEGA à regra central (comportamento idêntico).
CREATE OR REPLACE FUNCTION public.fn_check_djen_status(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event record;
  v_match record;
BEGIN
  SELECT * INTO v_event FROM calendar_events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.process_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_match
  FROM fn_match_djen_for_process(
    v_event.process_id,
    (v_event.start_at AT TIME ZONE 'America/Cuiaba')::date
  );

  UPDATE calendar_events SET
    djen_status        = v_match.status,
    djen_intimation_id = v_match.intimation_id,
    djen_checked_at    = now()
  WHERE id = p_event_id;
END;
$function$;

-- 3) Leitura em lote (read-only) do status DJEN das AUDIÊNCIAS virtuais.
CREATE OR REPLACE FUNCTION public.fn_djen_hearing_statuses()
RETURNS TABLE(process_id uuid, djen_status text, djen_intimation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, m.status, m.intimation_id
  FROM processes p
  CROSS JOIN LATERAL fn_match_djen_for_process(p.id, p.hearing_date) AS m(status, intimation_id)
  WHERE p.hearing_scheduled = true
    AND p.hearing_date >= (now() AT TIME ZONE 'America/Cuiaba')::date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_djen_hearing_statuses() TO authenticated;
