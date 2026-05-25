-- Adiciona entry_type às parcelas para distinguir parcelas regulares de baixas avulsas
ALTER TABLE installments
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'parcela'
    CHECK (entry_type IN ('parcela', 'avulso'));

COMMENT ON COLUMN installments.entry_type IS
  'parcela = parcela do acordo; avulso = entrada manual fora do cronograma';
