-- ============================================================
-- Agendamento do Resumo Semanal via pg_cron + Supabase Edge Function
--
-- INSTRUÇÕES (rodar UMA VEZ no SQL Editor do Supabase):
--
--   1. Acesse: Supabase Dashboard → SQL Editor
--   2. Cole e execute este script inteiro
--   3. O cron chama a edge function a cada hora.
--      A própria função verifica o dia/horário configurado na UI
--      (Configurações → Notificações → Resumo Semanal por Email)
--      e sai sem enviar se não for a hora certa.
--
-- Para testar imediatamente sem esperar o cron:
--   POST /functions/v1/weekly-digest  body: { "force": true }
--   ou para um e-mail específico:    body: { "force": true, "to": "seu@email.com" }
-- ============================================================

-- 1. Habilitar pg_cron (apenas se ainda não estiver ativo)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Habilitar pg_net para HTTP requests (necessário para chamar Edge Functions)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Remover job anterior se existir
SELECT cron.unschedule('weekly-digest')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest'
);

-- 4. Criar job horário — a edge function decide se envia baseada nas settings da UI
SELECT cron.schedule(
  'weekly-digest',
  '0 * * * *',   -- todo início de hora, todo dia
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- 5. Verificar se o job foi criado
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'weekly-digest';
