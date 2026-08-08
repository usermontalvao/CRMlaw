-- ============================================================
-- Agendamento das Automações de Prazo via pg_cron + Edge Function
--
-- Fica FORA da numeração das migrations de propósito: o comando do cron precisa
-- carregar a service role key, e ela não entra em arquivo versionado. É o mesmo
-- tratamento dado a weekly_digest_cron.sql.
--
-- ATENÇÃO — este passo TEM de ser feito por uma sessão privilegiada (SQL Editor
-- do Dashboard). Não adianta tentar copiar o comando de um job existente com
--
--   replace((select command from cron.job where jobname = '...'), ...)
--
-- porque o SELECT em cron.job devolve a chave MASCARADA (8 caracteres reais +
-- 200 bullets) para sessões sem privilégio. O replace grava os bullets, o job
-- é criado com aparência normal, e só falha em runtime com 401 Invalid JWT —
-- silenciosamente, todo dia. Testado e confirmado em 07/08/2026.
--
-- INSTRUÇÕES (rodar UMA VEZ no SQL Editor do Supabase):
--
--   1. Aplique antes a migration 20260808120000_deadline_automations.sql
--   2. Faça o deploy da função:  supabase functions deploy deadline-automations
--   3. Substitua <SERVICE_ROLE_KEY> abaixo pela chave real (Dashboard →
--      Settings → API → service_role) e execute este script
--
-- Horário: 09:00 UTC = 05:00 em America/Cuiaba (UTC-4, fixo desde 2019).
-- Antes de o escritório abrir, para que o prazo já esteja na fila do dia.
-- pg_cron agenda em UTC; se o fuso-âncora do escritório mudar, este horário
-- precisa ser recalculado à mão.
--
-- Para testar sem esperar o cron (não escreve nada, nem no ledger):
--   POST /functions/v1/deadline-automations   body: { "dry_run": true }
-- Para testar uma regra só:
--   body: { "dry_run": true, "automation_id": "<uuid>" }
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('deadline-automations-diario')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'deadline-automations-diario'
);

SELECT cron.schedule(
  'deadline-automations-diario',
  '0 9 * * *',   -- 09:00 UTC = 05:00 em Cuiabá
  $$
  SELECT net.http_post(
    url     := 'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/deadline-automations',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  )
  $$
);

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'deadline-automations-diario';
