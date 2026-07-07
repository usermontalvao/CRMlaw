-- Instantes REAIS de cada etapa probatória do fluxo público de assinatura.
-- Sem estas colunas, o dossiê/relatório sintetizava os eventos de Autenticação,
-- Biometria facial e Localização reutilizando viewed_at — todos os eventos
-- apareciam com o MESMO segundo, o que não reflete a cronologia real.
-- Os valores são reportados pelo cliente no ato de cada etapa e CLAMPADOS pelo
-- servidor (public-sign-document) à janela [viewed_at, now()].

ALTER TABLE public.signature_signers
  ADD COLUMN IF NOT EXISTS auth_at timestamptz,
  ADD COLUMN IF NOT EXISTS facial_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS geolocation_captured_at timestamptz;

COMMENT ON COLUMN public.signature_signers.auth_at IS
  'Instante real da autenticação (Google/OTP e-mail/OTP telefone) no fluxo público, clampado pelo servidor.';
COMMENT ON COLUMN public.signature_signers.facial_captured_at IS
  'Instante real da captura da selfie (biometria facial), clampado pelo servidor.';
COMMENT ON COLUMN public.signature_signers.geolocation_captured_at IS
  'Instante real da concessão de localização, clampado pelo servidor.';
