-- Fase L: Governança e retenção do módulo WhatsApp
-- SEGURO de aplicar: apenas DDL. A edge whatsapp-retention (que faz a purga)
-- NÃO deve ser deployada sem autorização explícita — exclusão é irreversível.

-- 1. Guarda jurídica: conversas com legal_hold=true são ignoradas pela retenção.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS legal_hold        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT;

-- 2. Marca de purga: quando a retenção limpa uma mensagem, registra quando.
--    Metadados operacionais (timestamps, direction, type, status, sender)
--    são preservados; conteúdo e storage_path são zerados.
ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS retention_purged_at TIMESTAMPTZ;

-- 3. Log de rodadas da retenção (schema compatível com a edge whatsapp-retention).
CREATE TABLE IF NOT EXISTS whatsapp_retention_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cutoff          TIMESTAMPTZ NOT NULL,
  months          INT NOT NULL DEFAULT 6,
  messages_purged INT NOT NULL DEFAULT 0,
  media_purged    INT NOT NULL DEFAULT 0,
  held_skipped    INT NOT NULL DEFAULT 0,
  details         JSONB
);

ALTER TABLE whatsapp_retention_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "retention_log_staff" ON whatsapp_retention_log
  FOR SELECT TO authenticated USING (public.is_office_staff());

-- Índice para acelerar a query de purga (mensagens antigas não purgadas).
CREATE INDEX IF NOT EXISTS idx_wa_msg_retention
  ON whatsapp_messages (wa_timestamp, retention_purged_at)
  WHERE retention_purged_at IS NULL;

-- Cron mensal (DESABILITADO — remova o bloco de comentário para ativar):
--
-- SELECT cron.schedule(
--   'whatsapp-retention-monthly',
--   '0 3 1 * *',
--   $$
--   SELECT net.http_post(
--     url     := current_setting('app.supabase_url') || '/functions/v1/whatsapp-retention',
--     headers := jsonb_build_object('Content-Type', 'application/json'),
--     body    := ('{"months":6,"dry_run":false}')::jsonb,
--     params  := jsonb_build_object('token', current_setting('app.wa_retention_token'))
--   );
--   $$
-- );
