-- ============================================================
-- Agendamento do Resumo Semanal via pg_cron + Supabase Edge Function
--
-- INSTRUÇÕES:
-- 1. Acesse o Supabase Dashboard → SQL Editor
-- 2. Cole e execute este script
-- 3. O dia/horário padrão é domingo às 08:00 UTC
--    Ajuste o cron expression conforme o admin configurar
--
-- Cron expressions:
--   Domingo  08:00 UTC → '0 8 * * 0'
--   Segunda  08:00 UTC → '0 8 * * 1'
--   Domingo  20:00 UTC → '0 20 * * 0'
-- ============================================================

-- Habilitar pg_cron (rodar uma vez pelo admin do projeto no Supabase)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remover job anterior se existir
SELECT cron.unschedule('weekly-digest')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest'
);

-- Criar job semanal (domingo às 08:00 UTC)
SELECT cron.schedule(
  'weekly-digest',
  '0 8 * * 0',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  )
  $$
);

-- Verificar jobs ativos
SELECT jobname, schedule, command, active FROM cron.job;
