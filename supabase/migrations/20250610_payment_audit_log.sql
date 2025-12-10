-- Migration: Criar tabela de auditoria de pagamentos
-- Data: 2025-06-10

-- Tabela de log de auditoria de pagamentos
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES installments(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'payment_registered',
    'payment_cancelled',
    'payment_edited',
    'installment_created',
    'installment_cancelled',
    'agreement_created',
    'agreement_edited',
    'agreement_cancelled'
  )),
  description TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_agreement_id ON payment_audit_log(agreement_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_installment_id ON payment_audit_log(installment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_user_id ON payment_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_action ON payment_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_created_at ON payment_audit_log(created_at DESC);

-- RLS Policies
ALTER TABLE payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Política de leitura: usuários autenticados podem ver logs
CREATE POLICY "Users can view payment audit logs" ON payment_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

-- Política de inserção: usuários autenticados podem inserir logs
CREATE POLICY "Users can insert payment audit logs" ON payment_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Comentários
COMMENT ON TABLE payment_audit_log IS 'Log de auditoria de pagamentos e operações financeiras';
COMMENT ON COLUMN payment_audit_log.action IS 'Tipo de ação: payment_registered, payment_cancelled, payment_edited, etc.';
COMMENT ON COLUMN payment_audit_log.old_value IS 'Valores anteriores à alteração (JSON)';
COMMENT ON COLUMN payment_audit_log.new_value IS 'Novos valores após a alteração (JSON)';

-- =====================================================
-- MIGRAÇÃO DE DADOS: Criar registros retroativos para pagamentos já realizados
-- =====================================================

INSERT INTO payment_audit_log (
  agreement_id,
  installment_id,
  user_id,
  user_name,
  action,
  description,
  old_value,
  new_value,
  created_at
)
SELECT 
  i.agreement_id,
  i.id as installment_id,
  a.created_by as user_id,
  '(Migração automática)' as user_name,
  'payment_registered' as action,
  CONCAT(
    'Baixa registrada na parcela ', i.installment_number, 
    ' - Valor: R$ ', ROUND(COALESCE(i.paid_value, i.value)::numeric, 2),
    ' - Método: ', COALESCE(
      CASE i.payment_method
        WHEN 'pix' THEN 'PIX'
        WHEN 'dinheiro' THEN 'Dinheiro'
        WHEN 'transferencia' THEN 'Transferência'
        WHEN 'cheque' THEN 'Cheque'
        WHEN 'cartao_credito' THEN 'Cartão de Crédito'
        WHEN 'cartao_debito' THEN 'Cartão de Débito'
        ELSE i.payment_method
      END,
      'Não informado'
    ),
    ' (registro retroativo)'
  ) as description,
  NULL as old_value,
  jsonb_build_object(
    'status', 'pago',
    'payment_date', i.payment_date,
    'payment_method', i.payment_method,
    'paid_value', COALESCE(i.paid_value, i.value),
    'notes', i.notes,
    'migrated', true
  ) as new_value,
  COALESCE(i.payment_date::timestamptz, i.updated_at, NOW()) as created_at
FROM installments i
JOIN agreements a ON a.id = i.agreement_id
WHERE i.status = 'pago'
  AND i.payment_date IS NOT NULL
ORDER BY i.payment_date;
