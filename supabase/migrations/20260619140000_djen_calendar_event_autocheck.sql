-- =============================================================================
-- Agenda · Recalcular confirmação DJEN ao CRIAR/EDITAR a audiência
-- =============================================================================
-- PROBLEMA
--   djen_status só era calculado: (a) pelo trigger de nova intimação em
--   djen_comunicacoes; (b) pelo refresh diário (cron djen-refresh-agenda-diario).
--   Um compromisso (hearing/pericia) recém-CRIADO ou EDITADO nascia/permanecia
--   'unconfirmed' até a próxima rotina — dando a impressão de que a confirmação
--   "não funcionou" logo após salvar.
--
-- SOLUÇÃO
--   Trigger BEFORE INSERT/UPDATE em calendar_events que recalcula a confirmação
--   na hora, reaproveitando fn_match_djen_for_process. Preenche apenas as colunas
--   djen_* (read-model de confirmação) — NÃO altera dados do compromisso.
--
-- SEGURANÇA CONTRA RECURSÃO
--   É BEFORE e apenas atribui em NEW (não emite UPDATE). Dispara só em INSERT ou
--   quando process_id/start_at/event_type mudam; portanto NÃO re-dispara quando
--   fn_check_djen_status (refresh/trigger de intimação) grava as colunas djen_*.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_calendar_event_djen_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match record;
BEGIN
  IF NEW.event_type IN ('hearing','pericia') AND NEW.process_id IS NOT NULL THEN
    SELECT * INTO v_match
    FROM fn_match_djen_for_process(
      NEW.process_id,
      (NEW.start_at AT TIME ZONE 'America/Cuiaba')::date
    );
    NEW.djen_status        := v_match.status;
    NEW.djen_intimation_id := v_match.intimation_id;
    NEW.djen_checked_at    := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_calendar_event_djen_check ON public.calendar_events;
CREATE TRIGGER trg_calendar_event_djen_check
BEFORE INSERT OR UPDATE OF process_id, start_at, event_type
ON public.calendar_events
FOR EACH ROW
EXECUTE FUNCTION fn_calendar_event_djen_check();
