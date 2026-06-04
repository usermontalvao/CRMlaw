-- Invalida cache da análise IA do portal quando o status do processo muda.
-- Evita divergência entre badge/status atual e texto em linguagem simples.

CREATE OR REPLACE FUNCTION public._trg_invalidate_portal_process_ai_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.portal_ai_cache
  WHERE entity_type = 'process'
    AND entity_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_portal_process_ai_cache ON public.processes;
CREATE TRIGGER trg_invalidate_portal_process_ai_cache
  AFTER UPDATE OF status ON public.processes
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_invalidate_portal_process_ai_cache();
