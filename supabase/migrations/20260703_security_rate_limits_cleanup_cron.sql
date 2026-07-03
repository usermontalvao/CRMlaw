-- Limpeza periódica da tabela public.security_rate_limits.
--
-- A RPC security_rate_limit_hit insere uma linha por janela fixa e nunca apaga,
-- então a tabela cresceria indefinidamente. Este job purga janelas antigas já
-- expiradas, preservando qualquer bloqueio (blocked_until) ainda ativo.
--
-- Depende de: 20260702230000_global_security_rate_limits.sql (tabela + RPC).

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove job anterior se existir (idempotente em re-execução).
SELECT cron.unschedule('security-rate-limits-cleanup')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'security-rate-limits-cleanup'
);

-- Roda de hora em hora (minuto 17 para não colidir com outros jobs no minuto 0).
SELECT cron.schedule(
  'security-rate-limits-cleanup',
  '17 * * * *',
  $$
  DELETE FROM public.security_rate_limits
   WHERE updated_at < now() - interval '2 days'
     AND (blocked_until IS NULL OR blocked_until < now())
  $$
);

-- Conferência.
SELECT jobname, schedule, active
  FROM cron.job
 WHERE jobname = 'security-rate-limits-cleanup';
