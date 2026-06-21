-- =============================================================================
-- Refino da inferência: "Trânsito em julgado" passa a ser reconhecido.
--
-- Gap (provado em amostra de 50): processos com movimento DataJud "Trânsito em
-- julgado" mas SEM keyword de liquidação/execução/sentença caíam em fases iniciais
-- (conciliacao/distribuido), porque nenhuma regra cobria o trânsito. Trânsito em
-- julgado implica que o mérito foi decidido e a decisão é final -> piso 'sentenca'
-- (fase mais avançada já capturada antes: cumprimento/recurso vencem se houver
-- liquidação/execução ou sinal recursal). Sem status canônico 'transito' próprio,
-- 'sentenca' é o piso correto e monotônico-seguro.
--
-- Também: o trigger de recompute passa a disparar em "trânsito" (em julgado)
-- (antes só baixa/arquiv/senten/etc.), senão um movimento de trânsito isolado
-- não recalcula.
--
-- Backfill aplicado após o deploy: SELECT public.recompute_process_statuses(NULL);
-- =============================================================================
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

  -- 4. SENTENÇA (inclui trânsito em julgado: mérito decidido e final)
  IF n ~ '(\msenten[çc]a|julgo procedente|julgo improcedente|julgo parcialmente|extingo o processo|extin[çc][ãa]o do processo|homologa[çc][ãa]o de transa|\mproced[êe]ncia|improced[êe]ncia|\mm[ée]rito|julgamento de m[ée]rito|indeferimento da peti[çc][ãa]o inicial|perda do objeto|dispositivo da senten|tr[âa]nsito em julgado)' THEN
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

-- Trigger passa a disparar também em "trânsito" (em julgado)
CREATE OR REPLACE FUNCTION public._trg_recompute_process_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF lower(coalesce(NEW.nome,'')) !~ '(cumprimento|execu|liquida|penhora|alvar|levantamento|precat|\mrpv\M|bacen|sisba|renajud|exequente|evolu[çc][ãa]o da classe|apela|agravo|embargos|ac[óo]rd|provimento|denega|recurso|senten|proced|improced|m[ée]rito|homologa[çc][ãa]o de transa|indeferimento da peti|perda do objeto|tr[âa]nsito|instru|contesta|concilia|cejusc|media[çc]|cita|distribu|arquiv|baixa definitiva)' THEN
    RETURN NEW;
  END IF;
  PERFORM public.recompute_process_statuses(NEW.process_id);
  RETURN NEW;
END;
$func$;

REVOKE ALL ON FUNCTION public._trg_recompute_process_status() FROM PUBLIC, anon, authenticated;
