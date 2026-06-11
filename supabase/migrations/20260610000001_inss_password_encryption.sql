-- Migration aditiva: suporte a criptografia AES-GCM da senha INSS
-- Adiciona coluna inss_password_enc para armazenar a senha INSS encriptada via edge function inss-crypto.
-- A coluna inss_password existente é mantida para retrocompatibilidade (registros antigos).
-- Fluxo de migração gradual:
--   - Saves novos: gravar em inss_password_enc (encriptado), zerar inss_password
--   - Leituras: preferir inss_password_enc se preenchido, cair em inss_password como fallback
--   - Após backfill completo: deprecar inss_password em migration futura

ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS inss_password_enc TEXT;

COMMENT ON COLUMN public.requirements.inss_password_enc IS
  'Senha INSS encriptada com AES-GCM (IV + ciphertext, base64). '
  'Encriptada/descriptografada via edge function inss-crypto com chave em INSS_CRYPTO_KEY. '
  'Preferir este campo sobre inss_password (legado, plain text).';
