-- =============================================================================
-- FONTE ÚNICA DE VERDADE para processes.status (consolidado)
--
-- Problema (provado): processes.status era escrito por 6 atores com lógicas
-- divergentes. Três crons (run-djen-sync, update-process-status, analyze-
-- intimations) classificavam o processo a partir de UMA publicação/intimação
-- usando keyword/IA sobre o TEXTO LIVRE do DJEN, que tratava AVISOS CONDICIONAIS
-- como arquivamento real — ex.: "o silêncio será interpretado como anuência ao
-- arquivamento definitivo dos autos" (intimação de execução) ou "após o trânsito,
-- arquivem-se os autos" (no corpo de uma sentença). Sem trava contra regressão,
-- o status corrigido pela timeline voltava a "arquivado" no cron seguinte.
--
-- Solução:
--   * Inferência ÚNICA (_infer_process_stage) calibrada ao vocabulário CNJ dos
--     MOVIMENTOS DataJud (estruturados/curtos), nunca ao texto livre do DJEN.
--   * Ordem "fase mais avançada vence": execução/recurso/sentença ANTES de
--     arquivamento; arquivamento só com linguagem definitiva incondicional.
--   * Trava monotônica no recompute: a automação só AVANÇA de fase (exceto
--     resgatar 'arquivado' indevido para fase substantiva >= instrução).
--   * Trava manual (status_manual): override do usuário nunca é sobrescrito.
--   * Trigger em datajud_movimentos persiste o status quando chega movimento.
--   * Os 3 crons deixam de gravar status por conta própria (ver edge functions).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 0. Trava de override manual
-- ----------------------------------------------------------------------------
ALTER TABLE public.processes
  ADD COLUMN IF NOT EXISTS status_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.processes.status_manual IS
  'true = status definido manualmente pelo usuário; a inferência automática (recompute/triggers) não sobrescreve.';

-- ----------------------------------------------------------------------------
-- 1. Cérebro único — inferência pura calibrada ao vocabulário CNJ (IMMUTABLE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._infer_process_stage(p_text text, p_db_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $func$
DECLARE
  n text := lower(coalesce(p_text, ''));
BEGIN
  IF n = '' THEN RETURN p_db_status; END IF;

  -- 1. CUMPRIMENTO / EXECUÇÃO (fase mais avançada)
  IF n ~ '(cumprimento|execu[çc]|liquida[çc][ãa]o|penhora|\malvar[áa]|levantamento|precat[óo]rio|\mrpv\M|bacenjud|sisbajud|renajud|exequente|interesse processual|demonstrativo[^.\n]{0,40}d[ée]bito|satisfa[çc][ãa]o volunt)' THEN
    RETURN 'cumprimento';
  END IF;

  -- 2. "Evolução da Classe Processual" + sentença/trânsito ⇒ cumprimento
  IF n ~ 'evolu[çc][ãa]o da classe' AND n ~ '(senten|tr[âa]nsito|proced)' THEN
    RETURN 'cumprimento';
  END IF;

  -- 3. RECURSO
  IF n ~ '(apela[çc][ãa]o|\magravo|embargos de declara|recurso especial|recurso extraordin|recurso ordin|\mac[óo]rd[ãa]o|turma recursal|n[ãa]o[ -]?provimento|\mprovimento\M|denega[çc]|n[ãa]o conhecimento de recurso)' THEN
    RETURN 'recurso';
  END IF;

  -- 4. SENTENÇA
  IF n ~ '(\msenten[çc]a|julgo procedente|julgo improcedente|julgo parcialmente|extingo o processo|extin[çc][ãa]o do processo|homologa[çc][ãa]o de transa|\mproced[êe]ncia|improced[êe]ncia|\mm[ée]rito|julgamento de m[ée]rito|indeferimento da peti[çc][ãa]o inicial|perda do objeto|dispositivo da senten)' THEN
    RETURN 'sentenca';
  END IF;

  -- 5. INSTRUÇÃO
  IF n ~ '(audi[êe]ncia de instru|\mde instru|instru[çc][ãa]o e julgamento|produ[çc][ãa]o de provas|oitiva de testemunha|\mper[íi]cia)' THEN
    RETURN 'instrucao';
  END IF;

  -- 6. CONTESTAÇÃO
  IF n ~ '(contesta[çc][ãa]o|defesa apresentada)' THEN
    RETURN 'contestacao';
  END IF;

  -- 7. CONCILIAÇÃO
  IF n ~ '(concilia[çc][ãa]o|\mcejusc\M|media[çc][ãa]o)' THEN
    RETURN 'conciliacao';
  END IF;

  -- 8. CITAÇÃO
  IF n ~ '(\mcita[çc][ãa]o|cite-se|fica citado)' THEN
    RETURN 'citacao';
  END IF;

  -- 9. ARQUIVAMENTO definitivo INCONDICIONAL (exclui avisos condicionais/futuros)
  IF n ~ '(arquivamento definitivo|baixa definitiva|autos arquivados definitiv|arquivem-se[^.\n]{0,25}definitiv|arquivado definitivamente)'
     AND n !~ '(sob pena|sil[êe]ncio[^.\n]{0,20}interpretad|an[uú][êe]ncia ao arquiv|caso[^.\n]{0,60}arquiv|poder[áa][^.\n]{0,40}arquiv|ser[áa] interpretado)' THEN
    RETURN 'arquivado';
  END IF;

  -- 10. DISTRIBUIÇÃO
  IF n ~ '(distribu[íi]|distribui[çc][ãa]o|emenda . inicial)' THEN
    RETURN 'distribuido';
  END IF;

  RETURN p_db_status;
END;
$func$;

GRANT EXECUTE ON FUNCTION public._infer_process_stage(text, text) TO anon, authenticated, service_role;

-- Compatibilidade: nome antigo delega ao cérebro único (portal RPCs continuam usando).
CREATE OR REPLACE FUNCTION public._portal_stage_from_names(p_names text, p_db_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $func$ SELECT public._infer_process_stage(p_names, p_db_status); $func$;

-- ----------------------------------------------------------------------------
-- 2. Blob de contexto (SÓ movimentos DataJud estruturados) + status efetivo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_status_blob(p_process_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT coalesce(
    (SELECT string_agg(coalesce(m.nome,''), E'\n')
       FROM public.datajud_movimentos m WHERE m.process_id = p_process_id), '');
$func$;

GRANT EXECUTE ON FUNCTION public.process_status_blob(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_effective_status(p_process_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_status text;
  v_manual boolean;
BEGIN
  SELECT status, status_manual INTO v_status, v_manual
  FROM public.processes WHERE id = p_process_id;
  IF v_status IS NULL THEN RETURN NULL; END IF;
  IF v_manual THEN RETURN v_status; END IF;
  RETURN public._infer_process_stage(public.process_status_blob(p_process_id), v_status);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.process_effective_status(uuid) TO authenticated, service_role;
DO $g$ BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.process_effective_status(uuid) TO portal_client';
EXCEPTION WHEN OTHERS THEN NULL; END $g$;

-- ----------------------------------------------------------------------------
-- 3. Ordem canônica das fases + recompute com trava monotônica
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._process_stage_rank(p_status text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $func$
  SELECT CASE p_status
    WHEN 'nao_protocolado'      THEN 0
    WHEN 'aguardando_confeccao' THEN 1
    WHEN 'distribuido'          THEN 2
    WHEN 'citacao'              THEN 3
    WHEN 'conciliacao'          THEN 4
    WHEN 'contestacao'          THEN 5
    WHEN 'instrucao'            THEN 6
    WHEN 'andamento'            THEN 6
    WHEN 'sentenca'             THEN 7
    WHEN 'recurso'              THEN 8
    WHEN 'cumprimento'          THEN 9
    WHEN 'arquivado'            THEN 10
    ELSE 1
  END;
$func$;

-- Recompute: pula travados manualmente; só AVANÇA de fase OU resgata 'arquivado'
-- indevido para fase substantiva clara (>= instrução). Nunca regride.
CREATE OR REPLACE FUNCTION public.recompute_process_statuses(p_process_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_count int := 0;
  r record;
  v_eff text;
BEGIN
  FOR r IN
    SELECT p.id, p.status AS st
    FROM public.processes p
    WHERE (p_process_id IS NULL OR p.id = p_process_id)
      AND p.status_manual = false
  LOOP
    v_eff := public._infer_process_stage(public.process_status_blob(r.id), r.st);

    IF v_eff IS NULL OR v_eff IS NOT DISTINCT FROM r.st THEN
      CONTINUE;
    END IF;

    IF public._process_stage_rank(v_eff) > public._process_stage_rank(r.st)
       OR (r.st = 'arquivado' AND public._process_stage_rank(v_eff) >= public._process_stage_rank('instrucao')) THEN
      UPDATE public.processes SET status = v_eff, updated_at = now() WHERE id = r.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$func$;

REVOKE ALL ON FUNCTION public.recompute_process_statuses(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_process_statuses(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Trigger — recalcula o processo quando chega movimento DataJud relevante
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_recompute_process_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF lower(coalesce(NEW.nome,'')) !~ '(cumprimento|execu|liquida|penhora|alvar|levantamento|precat|\mrpv\M|bacen|sisba|renajud|exequente|evolu[çc][ãa]o da classe|apela|agravo|embargos|ac[óo]rd|provimento|denega|recurso|senten|proced|improced|m[ée]rito|homologa[çc][ãa]o de transa|indeferimento da peti|perda do objeto|instru|contesta|concilia|cejusc|media[çc]|cita|distribu|arquiv|baixa definitiva)' THEN
    RETURN NEW;
  END IF;
  PERFORM public.recompute_process_statuses(NEW.process_id);
  RETURN NEW;
END;
$func$;

REVOKE ALL ON FUNCTION public._trg_recompute_process_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_recompute_process_status ON public.datajud_movimentos;
CREATE TRIGGER trg_recompute_process_status
AFTER INSERT OR UPDATE OF nome ON public.datajud_movimentos
FOR EACH ROW EXECUTE FUNCTION public._trg_recompute_process_status();

-- Backfill: rodar manualmente após o deploy das edge functions
--   SELECT public.recompute_process_statuses(NULL);
