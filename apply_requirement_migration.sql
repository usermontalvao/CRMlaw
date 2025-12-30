-- Execute este script no painel do Supabase (SQL Editor)
-- para adicionar os campos de requerimento à tabela de assinaturas

-- Adicionar campos de requerimento à tabela signature_requests
ALTER TABLE signature_requests 
ADD COLUMN IF NOT EXISTS requirement_id UUID REFERENCES requirements(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS requirement_number VARCHAR(100);

-- Criar índice para o campo requirement_id
CREATE INDEX IF NOT EXISTS idx_signature_requests_requirement_id ON signature_requests(requirement_id);

-- Verificar se os campos foram adicionados
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'signature_requests' 
AND column_name IN ('requirement_id', 'requirement_number');

-- Comentários
COMMENT ON COLUMN signature_requests.requirement_id IS 'ID do requerimento criado a partir desta assinatura';
COMMENT ON COLUMN signature_requests.requirement_number IS 'Número do protocolo do requerimento';
