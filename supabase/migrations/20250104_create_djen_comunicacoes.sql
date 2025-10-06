-- Tabela para armazenar comunicações do DJEN
CREATE TABLE IF NOT EXISTS djen_comunicacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Dados da comunicação original
  djen_id INTEGER NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  numero_comunicacao INTEGER,
  
  -- Informações do processo
  numero_processo TEXT NOT NULL,
  numero_processo_mascara TEXT,
  codigo_classe TEXT,
  nome_classe TEXT,
  
  -- Tribunal e órgão
  sigla_tribunal TEXT NOT NULL,
  nome_orgao TEXT,
  
  -- Conteúdo
  texto TEXT NOT NULL,
  tipo_comunicacao TEXT,
  tipo_documento TEXT,
  meio TEXT, -- 'D' para Diário, 'E' para Edital
  meio_completo TEXT,
  link TEXT,
  
  -- Datas
  data_disponibilizacao TIMESTAMPTZ NOT NULL,
  
  -- Status de leitura
  lida BOOLEAN DEFAULT FALSE,
  lida_em TIMESTAMPTZ,
  
  -- Vinculações
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  
  -- Metadados
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para armazenar advogados das comunicações
CREATE TABLE IF NOT EXISTS djen_advogados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunicacao_id UUID NOT NULL REFERENCES djen_comunicacoes(id) ON DELETE CASCADE,
  
  nome TEXT NOT NULL,
  numero_oab TEXT NOT NULL,
  uf_oab TEXT NOT NULL,
  tipo_inscricao TEXT,
  email TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para armazenar destinatários das comunicações
CREATE TABLE IF NOT EXISTS djen_destinatarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comunicacao_id UUID NOT NULL REFERENCES djen_comunicacoes(id) ON DELETE CASCADE,
  
  nome TEXT NOT NULL,
  polo TEXT,
  cpf_cnpj TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_numero_processo ON djen_comunicacoes(numero_processo);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_data_disponibilizacao ON djen_comunicacoes(data_disponibilizacao);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_client_id ON djen_comunicacoes(client_id);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_process_id ON djen_comunicacoes(process_id);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_lida ON djen_comunicacoes(lida);
CREATE INDEX IF NOT EXISTS idx_djen_comunicacoes_hash ON djen_comunicacoes(hash);
CREATE INDEX IF NOT EXISTS idx_djen_advogados_comunicacao_id ON djen_advogados(comunicacao_id);
CREATE INDEX IF NOT EXISTS idx_djen_destinatarios_comunicacao_id ON djen_destinatarios(comunicacao_id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_djen_comunicacoes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_djen_comunicacoes_updated_at
  BEFORE UPDATE ON djen_comunicacoes
  FOR EACH ROW
  EXECUTE FUNCTION update_djen_comunicacoes_updated_at();

-- RLS Policies
ALTER TABLE djen_comunicacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE djen_advogados ENABLE ROW LEVEL SECURITY;
ALTER TABLE djen_destinatarios ENABLE ROW LEVEL SECURITY;

-- Políticas para djen_comunicacoes
CREATE POLICY "Usuários autenticados podem visualizar comunicações"
  ON djen_comunicacoes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários autenticados podem inserir comunicações"
  ON djen_comunicacoes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Usuários autenticados podem atualizar comunicações"
  ON djen_comunicacoes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Usuários autenticados podem deletar comunicações"
  ON djen_comunicacoes FOR DELETE
  TO authenticated
  USING (true);

-- Políticas para djen_advogados
CREATE POLICY "Usuários autenticados podem visualizar advogados"
  ON djen_advogados FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários autenticados podem inserir advogados"
  ON djen_advogados FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Políticas para djen_destinatarios
CREATE POLICY "Usuários autenticados podem visualizar destinatários"
  ON djen_destinatarios FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários autenticados podem inserir destinatários"
  ON djen_destinatarios FOR INSERT
  TO authenticated
  WITH CHECK (true);
