-- Migration: Adicionar hash de verificação para assinaturas
-- Criado em: 2025-06-12

-- Adicionar coluna de hash de verificação na tabela de signatários
ALTER TABLE signature_signers 
ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64);

-- Criar índice para busca por hash
CREATE INDEX IF NOT EXISTS idx_signature_signers_verification_hash 
ON signature_signers(verification_hash);

-- Adicionar coluna de hash na tabela principal também (para assinaturas únicas)
ALTER TABLE signature_requests 
ADD COLUMN IF NOT EXISTS verification_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_signature_requests_verification_hash 
ON signature_requests(verification_hash);
