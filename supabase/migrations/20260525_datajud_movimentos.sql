-- Tabela de movimentos DataJud (CNJ)
-- Persiste o histórico de andamentos processuais vindos da API pública do CNJ
CREATE TABLE IF NOT EXISTS datajud_movimentos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id     uuid        REFERENCES processes(id) ON DELETE CASCADE,
  process_code   text        NOT NULL,
  tribunal       text,
  grau           text,
  codigo         integer,
  nome           text        NOT NULL,
  data_hora      timestamptz NOT NULL,
  orgao_julgador text,
  complementos   jsonb,
  categoria      text,       -- sentenca | decisao | audiencia | citacao | recurso | arquivamento | despacho | outro
  process_stage  text,       -- estágio mapeado: sentenca | recurso | cumprimento | instrucao | conciliacao | citacao | andamento | arquivado
  created_at     timestamptz DEFAULT now(),

  -- Evitar duplicatas: mesmo processo + código TPU + data/hora
  UNIQUE (process_code, codigo, data_hora)
);

CREATE INDEX IF NOT EXISTS idx_datajud_movimentos_process_id   ON datajud_movimentos(process_id);
CREATE INDEX IF NOT EXISTS idx_datajud_movimentos_data_hora    ON datajud_movimentos(process_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_datajud_movimentos_process_code ON datajud_movimentos(process_code);

COMMENT ON TABLE datajud_movimentos IS
  'Andamentos processuais sincronizados da API pública DataJud/CNJ. Alimentado pelo datajud-sync edge function.';
