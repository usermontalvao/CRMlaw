-- =============================================================================
-- Trava monotônica também na LEITURA do status (process_effective_status).
--
-- Bug: o caminho de ESCRITA (recompute_process_statuses) tem trava monotônica e
-- nunca regride; mas o caminho de LEITURA (process_effective_status) re-inferia
-- do blob de movimentos DataJud SEM trava e rebaixava o estágio já consolidado.
-- Ex.: processo com status persistido 'recurso' (sinal só no DJEN, ausente nos
-- movimentos DataJud) era exibido como 'sentenca' porque a inferência sobre os
-- nomes dos movimentos só alcança 'Procedência em Parte' -> sentenca. O stepper
-- da timeline (ProcessTimeline) e o portal leem por esta RPC, então o estágio
-- aparecia regredido na UI mesmo com processes.status correto.
--
-- Correção: a leitura espelha EXATAMENTE a decisão do recompute — só devolve a
-- inferência quando ela AVANÇA, ou quando resgata um 'arquivado' indevido para
-- fase substantiva (>= instrução); caso contrário mantém o status persistido.
-- Nunca regride. Override manual (status_manual) continua soberano.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.process_effective_status(p_process_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_status   text;
  v_manual   boolean;
  v_inferred text;
BEGIN
  SELECT status, status_manual INTO v_status, v_manual
  FROM public.processes WHERE id = p_process_id;
  IF v_status IS NULL THEN RETURN NULL; END IF;
  IF v_manual THEN RETURN v_status; END IF;

  v_inferred := public._infer_process_stage(public.process_status_blob(p_process_id), v_status);
  IF v_inferred IS NULL THEN RETURN v_status; END IF;

  -- Mesma regra do recompute: avança de fase OU resgata 'arquivado' indevido.
  IF public._process_stage_rank(v_inferred) > public._process_stage_rank(v_status)
     OR (v_status = 'arquivado'
         AND public._process_stage_rank(v_inferred) >= public._process_stage_rank('instrucao')) THEN
    RETURN v_inferred;
  END IF;

  RETURN v_status;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.process_effective_status(uuid) TO authenticated, service_role;
DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.process_effective_status(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;
