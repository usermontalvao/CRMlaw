-- Monitoramento de uso de índices — coleta, não remoção.
--
-- Contexto: 611 índices apareceram com idx_scan = 0, somando 48 MB. Além do
-- disco, eles engordam o catálogo que o decodificador do Realtime percorre a
-- cada ciclo (~1,6×/s). Mas 4 horas de estatística NÃO provam que um índice é
-- inútil: relatório mensal, tela de admin usada de vez em quando e rotina de
-- fechamento existem. Derrubar índice com base nessa janela seria chute.
--
-- Então aqui só se coleta. A decisão fica para depois de uma ou duas semanas
-- de dados.
--
-- Fica no esquema `ops`, e não em `public`, de propósito: o PostgREST expõe
-- `public`, e uma tabela operacional não tem por que virar endpoint HTTP.

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS ops.index_usage_snapshots (
  captured_at   timestamptz NOT NULL DEFAULT now(),
  schemaname    text        NOT NULL,
  relname       text        NOT NULL,
  indexrelname  text        NOT NULL,
  idx_scan      bigint      NOT NULL,
  idx_tup_read  bigint      NOT NULL,
  idx_tup_fetch bigint      NOT NULL,
  size_bytes    bigint      NOT NULL,
  is_unique     boolean     NOT NULL,
  is_constraint boolean     NOT NULL,
  PRIMARY KEY (captured_at, schemaname, relname, indexrelname)
);

COMMENT ON TABLE ops.index_usage_snapshots IS
  'Fotografias periódicas de pg_stat_user_indexes, para decidir com dados quais índices são realmente ociosos.';

-- ---------------------------------------------------------------------------
-- Coleta
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.snapshot_index_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'ops', 'pg_catalog', 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO ops.index_usage_snapshots (
    captured_at, schemaname, relname, indexrelname,
    idx_scan, idx_tup_read, idx_tup_fetch, size_bytes, is_unique, is_constraint
  )
  SELECT
    now(), s.schemaname, s.relname, s.indexrelname,
    s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
    pg_relation_size(s.indexrelid),
    i.indisunique,
    -- Índice que sustenta PK ou UNIQUE não é candidato a remoção mesmo com
    -- idx_scan zerado: ele existe para garantir a restrição, não para consulta.
    EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = s.indexrelid)
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION ops.snapshot_index_usage() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Relatório
-- ---------------------------------------------------------------------------
-- Compara a primeira e a última fotografia. Só considera índice cuja janela de
-- observação já tenha `p_min_dias`; assim o relatório não devolve conclusão
-- precipitada se for consultado cedo demais.

CREATE OR REPLACE FUNCTION ops.report_unused_indexes(p_min_dias integer DEFAULT 7)
RETURNS TABLE (
  tabela         text,
  indice         text,
  buscas_periodo bigint,
  tamanho        text,
  unico          boolean,
  de_restricao   boolean,
  dias_observado numeric,
  veredito       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'ops', 'pg_catalog', 'public'
AS $function$
  WITH janela AS (
    SELECT min(captured_at) AS inicio, max(captured_at) AS fim
    FROM ops.index_usage_snapshots
  ),
  primeiro AS (
    SELECT s.* FROM ops.index_usage_snapshots s, janela j WHERE s.captured_at = j.inicio
  ),
  ultimo AS (
    SELECT s.* FROM ops.index_usage_snapshots s, janela j WHERE s.captured_at = j.fim
  )
  SELECT
    u.schemaname || '.' || u.relname,
    u.indexrelname,
    u.idx_scan - COALESCE(p.idx_scan, 0),
    pg_size_pretty(u.size_bytes),
    u.is_unique,
    u.is_constraint,
    round(EXTRACT(epoch FROM (j.fim - j.inicio)) / 86400.0, 1),
    CASE
      WHEN EXTRACT(epoch FROM (j.fim - j.inicio)) / 86400.0 < p_min_dias
        THEN 'janela curta demais para concluir'
      WHEN u.is_constraint OR u.is_unique
        THEN 'manter (sustenta restricao)'
      WHEN u.idx_scan - COALESCE(p.idx_scan, 0) = 0
        THEN 'candidato a remocao'
      ELSE 'em uso'
    END
  FROM ultimo u
  CROSS JOIN janela j
  LEFT JOIN primeiro p
    ON p.schemaname = u.schemaname AND p.relname = u.relname AND p.indexrelname = u.indexrelname
  ORDER BY (u.idx_scan - COALESCE(p.idx_scan, 0)), u.size_bytes DESC;
$function$;

REVOKE ALL ON FUNCTION ops.report_unused_indexes(integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Agendamento diário
-- ---------------------------------------------------------------------------
-- Diário, e não semanal: 743 índices por coleta é barato, e uma curva com
-- vários pontos mostra o índice que só é usado no fechamento do mês.

DO $$
BEGIN
  PERFORM cron.unschedule('snapshot-index-usage');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'snapshot-index-usage',
  '10 3 * * *',
  $$SELECT ops.snapshot_index_usage();$$
);
