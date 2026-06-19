-- =============================================================================
-- Agenda · Rotina diária de revalidação DJEN dos compromissos futuros
-- =============================================================================
-- PROBLEMA
--   A confirmação DJEN de audiências/perícias era recalculada apenas:
--     (a) sob demanda, via fn_check_djen_status(event_id); e
--     (b) automaticamente pelo trigger trg_djen_intimation_arrived, quando uma
--         NOVA intimação era inserida em djen_comunicacoes.
--   A função fn_refresh_all_djen_statuses() existia mas NÃO era chamada por
--   nenhum cron nem por nenhum ponto do código (função órfã). Resultado:
--   eventos futuros já existentes — cuja intimação correspondente já havia sido
--   sincronizada antes — nunca eram reavaliados como rotina.
--
-- SOLUÇÃO
--   1. Reescrever fn_refresh_all_djen_statuses() reaproveitando a regra central
--      fn_check_djen_status(event_id) (sem duplicar lógica), agora restrita a:
--        - event_type IN ('hearing','pericia')
--        - start_at >= início do dia atual (America/Cuiaba) -> ignora passado
--        - process_id IS NOT NULL                          -> sem processo, sem match
--        - status NOT IN ('cancelado','concluido')         -> não reavalia encerrados
--   2. Agendar a execução DIÁRIA dedicada via pg_cron, logo após o sync DJEN
--      das 06:00 UTC (job 'djen-sync-diario', a cada 6h).
--
--   A camada de verdade continua 100% no banco; o frontend da Agenda segue
--   apenas consumindo djen_status / djen_intimation_id / djen_checked_at.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_refresh_all_djen_statuses()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count       int := 0;
  v_event_id    uuid;
  -- Início do dia atual no fuso da operação (America/Cuiaba), como timestamptz.
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Cuiaba')
                                 AT TIME ZONE 'America/Cuiaba';
BEGIN
  FOR v_event_id IN
    SELECT id
    FROM calendar_events
    WHERE process_id IS NOT NULL
      AND event_type IN ('hearing', 'pericia')
      AND start_at >= v_today_start
      AND status NOT IN ('cancelado', 'concluido')
  LOOP
    PERFORM fn_check_djen_status(v_event_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- ── Agendamento diário dedicado (pg_cron) ──
-- 07:00 UTC = 03:00 America/Cuiaba. Roda após o djen-sync das 06:00 UTC para
-- reprocessar eventos cuja intimação já estava sincronizada.
SELECT cron.unschedule('djen-refresh-agenda-diario')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'djen-refresh-agenda-diario');

SELECT cron.schedule(
  'djen-refresh-agenda-diario',
  '0 7 * * *',
  $$SELECT public.fn_refresh_all_djen_statuses();$$
);
