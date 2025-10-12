-- Tabela de Acordos Trabalhistas
CREATE TABLE IF NOT EXISTS agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  
  -- Dados do Acordo
  title TEXT NOT NULL,
  description TEXT,
  agreement_date DATE NOT NULL,
  
  -- Valores
  total_value DECIMAL(15, 2) NOT NULL,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('percentage', 'fixed')),
  fee_percentage DECIMAL(5, 2),
  fee_fixed_value DECIMAL(15, 2),
  fee_value DECIMAL(15, 2) NOT NULL,
  net_value DECIMAL(15, 2) NOT NULL,
  
  -- Parcelamento
  payment_type TEXT NOT NULL DEFAULT 'installments' CHECK (payment_type IN ('upfront', 'installments')),
  installments_count INTEGER NOT NULL,
  installment_value DECIMAL(15, 2) NOT NULL,
  first_due_date DATE NOT NULL,
  
  -- Metadados
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('pendente', 'ativo', 'concluido', 'cancelado')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);

-- Tabela de Parcelas
CREATE TABLE IF NOT EXISTS installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  
  -- Dados da Parcela
  installment_number INTEGER NOT NULL,
  due_date DATE NOT NULL,
  value DECIMAL(15, 2) NOT NULL,
  
  -- Pagamento
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado')),
  payment_date DATE,
  payment_method TEXT CHECK (payment_method IN ('dinheiro', 'pix', 'transferencia', 'cheque', 'cartao_credito', 'cartao_debito')),
  paid_value DECIMAL(15, 2),
  
  -- Observações
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(agreement_id, installment_number)
);

-- Índices para Performance
CREATE INDEX IF NOT EXISTS idx_agreements_client_id ON agreements(client_id);
CREATE INDEX IF NOT EXISTS idx_agreements_process_id ON agreements(process_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON agreements(status);
CREATE INDEX IF NOT EXISTS idx_agreements_created_by ON agreements(created_by);
CREATE INDEX IF NOT EXISTS idx_installments_agreement_id ON installments(agreement_id);
CREATE INDEX IF NOT EXISTS idx_installments_status ON installments(status);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_payment_date ON installments(payment_date);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agreements_updated_at
  BEFORE UPDATE ON agreements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_installments_updated_at
  BEFORE UPDATE ON installments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;

-- Policies para agreements
CREATE POLICY "Usuários podem ver todos os acordos"
  ON agreements FOR SELECT
  USING (true);

CREATE POLICY "Usuários podem inserir acordos"
  ON agreements FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Usuários podem atualizar acordos"
  ON agreements FOR UPDATE
  USING (true);

CREATE POLICY "Usuários podem deletar acordos"
  ON agreements FOR DELETE
  USING (true);

-- Policies para installments
CREATE POLICY "Usuários podem ver todas as parcelas"
  ON installments FOR SELECT
  USING (true);

CREATE POLICY "Usuários podem inserir parcelas"
  ON installments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Usuários podem atualizar parcelas"
  ON installments FOR UPDATE
  USING (true);

CREATE POLICY "Usuários podem deletar parcelas"
  ON installments FOR DELETE
  USING (true);

-- Comentários nas tabelas
COMMENT ON TABLE agreements IS 'Acordos trabalhistas com clientes';
COMMENT ON TABLE installments IS 'Parcelas dos acordos trabalhistas';
COMMENT ON COLUMN agreements.fee_type IS 'Tipo de honorário: percentage (contrato de risco) ou fixed (contrato fixo)';
COMMENT ON COLUMN agreements.fee_percentage IS 'Percentual de honorários cobrado (ex: 30 para 30%) - usado se fee_type = percentage';
COMMENT ON COLUMN agreements.fee_fixed_value IS 'Valor fixo de honorários em reais - usado se fee_type = fixed';
COMMENT ON COLUMN agreements.fee_value IS 'Valor dos honorários em reais (calculado)';
COMMENT ON COLUMN agreements.net_value IS 'Valor líquido que o cliente receberá';
COMMENT ON COLUMN agreements.payment_type IS 'Tipo de pagamento: upfront (à vista) ou installments (parcelado)';
COMMENT ON COLUMN agreements.installments_count IS 'Número de parcelas (1 se pagamento à vista)';
COMMENT ON COLUMN installments.paid_value IS 'Valor efetivamente pago (pode diferir do valor original por descontos/juros)';
