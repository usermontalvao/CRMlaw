-- Consentimento explícito e SEPARADO para reutilizar a selfie da assinatura
-- como foto cadastral do cliente. A selfie continua sendo coletada para
-- evidência/validação do ato de assinar; o uso como foto de perfil só é
-- permitido com este consentimento (default false).
ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS allow_signature_selfie_for_profile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selfie_profile_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS selfie_profile_consent_version text;

COMMENT ON COLUMN public.signature_signers.allow_signature_selfie_for_profile IS 'Signatário autorizou usar a selfie da assinatura também como foto cadastral (LGPD). Default false.';
COMMENT ON COLUMN public.signature_signers.selfie_profile_consent_at IS 'Quando a autorização de uso como foto cadastral foi dada.';
COMMENT ON COLUMN public.signature_signers.selfie_profile_consent_version IS 'Versão do termo de autorização de uso da foto como cadastral.';
