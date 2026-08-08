-- ============================================================
-- Agendamento do Resumo Semanal via pg_cron + Supabase Edge Function
--
-- HISTÓRICO — por que este arquivo foi reescrito (07/08/2026):
--
-- A versão anterior montava a chamada com
--     current_setting('app.supabase_url') || ...
--     'Bearer ' || current_setting('app.supabase_anon_key')
-- e esses dois GUCs NÃO existem mais no banco (`current_setting('app.supabase_url', true)`
-- devolve NULL). Mais importante: o job 17 que estava em produção também NÃO usava
-- current_setting — tinha um token literal de 76 caracteres embutido, ou seja, alguém
-- reagendou o job pelo Dashboard em algum momento e este arquivo ficou defasado.
--
-- 76 caracteres é curto demais para ser uma chave real: a anon key deste projeto tem
-- 208 (header 36 + payload 127 + assinatura 43), e a assinatura HS256 sozinha já tem
-- 43. O token do job 17 era um JWT MALFORMADO — com cara de JWT, sem assinatura
-- válida. Daí o 401, uma vez por hora, de 24/06/2026 a 07/08/2026, em silêncio.
--
-- TABELA DE ERROS DO GATEWAY — medida em 07/08/2026 contra este projeto, mandando
-- POST {"keys":[]} em /functions/v1/check-env-keys (função no-op, não grava nada):
--
--   anon key completa (208 chars) ....... 200  {"ok":true,"results":{}}
--   3 segmentos, assinatura inválida .... 401  UNAUTHORIZED_LEGACY_JWT
--   2 segmentos (truncado no meio) ...... 401  UNAUTHORIZED_INVALID_JWT_FORMAT
--   sem header Authorization ............ 401  UNAUTHORIZED_NO_AUTH_HEADER
--   sb_publishable_... inexistente ...... 401  "Invalid API key"
--
-- CUIDADO COM A LEITURA DE UNAUTHORIZED_LEGACY_JWT: ele NÃO quer dizer "o projeto
-- desativou as chaves legadas". Quer dizer apenas "veio um token de 3 segmentos e a
-- assinatura não confere". As chaves legadas eyJ... continuam sendo aceitas neste
-- projeto — a linha de 200 acima é a prova. Foi por isso que a correção abaixo pôde
-- continuar usando a anon key legada em vez de migrar para sb_publishable_.
--
-- Por que passou seis semanas despercebido: `cron.job_run_details` marca o job como
-- `succeeded` porque o `net.http_post` foi ENFILEIRADO com sucesso. A resposta real
-- só aparece em `net._http_response`. Nunca valide um job destes pelo job_run_details.
--
-- DECISÕES DESTA VERSÃO:
--   * URL e chave são LITERAIS, não GUCs — GUC some numa restauração/upgrade e o job
--     quebra em silêncio. A URL do projeto não muda.
--   * Usa a chave ANON, não a service_role. O gateway das Edge Functions só exige um
--     JWT válido do projeto; a própria função usa SUPABASE_SERVICE_ROLE_KEY do env dela
--     para acessar o banco. A anon key é pública (já está no bundle do front e em
--     20260602000002_portal_push_trigger.sql), então este arquivo pode ficar versionado
--     e ser colado inteiro — sem placeholder para esquecer, sem chave para vazar.
--   * Tem um GUARD que aborta antes de agendar se o token estiver mascarado, truncado
--     ou for um placeholder. Ver o bloco DO abaixo — foi exatamente esse tipo de erro
--     que criou o job quebrado duas vezes neste projeto.
--
-- COMO RODAR: Supabase Dashboard → SQL Editor → colar este arquivo inteiro → Run.
--
-- Para testar sem esperar o cron:
--   POST /functions/v1/weekly-digest  body: { "force": true }
--   ou para um e-mail específico:     body: { "force": true, "to": "seu@email.com" }
--   ATENÇÃO: { "force": true } DISPARA o envio real para toda a equipe.
--   Use sempre junto com "to" para testar sem incomodar ninguém.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $do$
DECLARE
  v_url  text := 'https://uajwkqipbyxzvwjpitxl.supabase.co';
  v_key  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
  v_cmd  text;
BEGIN
  -- ── GUARD: nada é agendado se a chave não for um JWT íntegro ────────────────
  -- Pega os três modos de falha já vistos neste projeto:
  --   1. chave mascarada pelo servidor  (8 reais + 200 bullets '•')
  --   2. placeholder esquecido          ('<SERVICE_ROLE_KEY>')
  --   3. chave truncada                 (o caso do job 17, 76 caracteres)
  IF position('•' in v_key) > 0 THEN
    RAISE EXCEPTION 'Chave MASCARADA (contém bullets). Ela veio de um SELECT em cron.job. Cole a chave real do Dashboard → Settings → API.';
  END IF;
  IF position('<' in v_key) > 0 OR position('ANON_KEY' in v_key) > 0 THEN
    RAISE EXCEPTION 'Placeholder não substituído: %', left(v_key, 24);
  END IF;
  IF array_length(string_to_array(v_key, '.'), 1) <> 3 THEN
    RAISE EXCEPTION 'Não é um JWT: esperados 3 segmentos separados por ponto, veio %', array_length(string_to_array(v_key, '.'), 1);
  END IF;
  IF length(v_key) < 150 THEN
    RAISE EXCEPTION 'Chave curta demais para um JWT (% caracteres) — provavelmente truncada. Foi assim que o job 17 quebrou.', length(v_key);
  END IF;

  -- ── Remove o job quebrado (pelo nome; jobid 17 em 07/08/2026) ───────────────
  PERFORM cron.unschedule('weekly-digest')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest');

  -- ── Reagenda ───────────────────────────────────────────────────────────────
  -- De hora em hora, todo dia. A própria função verifica o dia/horário configurado
  -- na UI (Configurações → Notificações → Resumo Semanal) e sai sem enviar se não
  -- for a hora certa — por isso o cron pode ser burro e disparar sempre.
  v_cmd := format(
    $fmt$
    SELECT net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || %L
      ),
      body    := '{}'::jsonb
    )
    $fmt$,
    v_url || '/functions/v1/weekly-digest',
    v_key
  );

  PERFORM cron.schedule('weekly-digest', '0 * * * *', v_cmd);

  RAISE NOTICE 'weekly-digest reagendado. Token com % caracteres, íntegro.', length(v_key);
END
$do$;

-- ============================================================
-- VALIDAÇÃO — nesta ordem, e NÃO confie no job_run_details
-- ============================================================

-- 1. O job existe e está ativo?
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'weekly-digest';

-- 2. O token gravado está íntegro? (reais ≈ 208, bullets = 0)
--    Se 'reais' vier 8 e 'bullets' 200, a SUA sessão não tem privilégio para ler —
--    rode no SQL Editor do Dashboard, não por uma conexão comum.
SELECT jobname,
       length(replace(tok, '•', ''))             AS caracteres_reais,
       length(tok) - length(replace(tok,'•','')) AS bullets
FROM (SELECT jobname, substring(command FROM '(eyJ[A-Za-z0-9_.•-]+)') AS tok
      FROM cron.job WHERE jobname = 'weekly-digest') s;

-- 3. Dispara um tick manual (não espera a virada da hora).
--    Sem { "force": true } a função checa o gate de dia/hora e sai sem enviar — que é
--    o que queremos: só a resposta HTTP e a linha no log. A ÚNICA exceção é rodar
--    justamente no dia/hora configurados na UI, aí o resumo sai de verdade. Se não
--    quiser correr esse risco, rode este passo fora da janela configurada.
--    Usa a chave literal deste arquivo de propósito — não relê de cron.job, para o
--    teste não ser contaminado por uma leitura mascarada.
SELECT net.http_post(
  url     := 'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/weekly-digest',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8'
  ),
  body    := '{}'::jsonb
) AS request_id;   -- ← ANOTE este número

-- 4. Espere ~5 segundos e confira a RESPOSTA REAL. Tem que ser 200.
--    Troque o número abaixo pelo request_id do passo 3. Não pegue "a última linha":
--    outros jobs (whatsapp-scheduler roda a cada minuto) escrevem aqui no mesmo
--    segundo, e já houve leitura do 200 do vizinho achando que era o nosso.
SELECT id, status_code, left(content, 300) AS corpo
FROM net._http_response
WHERE id = 0;  -- ← substitua pelo request_id do passo 3

-- 5. Prova à prova de erro: a função só grava esta linha se ela REALMENTE executou.
--    Se não apareceu linha nova, o gateway barrou a requisição antes da função rodar.
SELECT id, job_name, status, started_at, finished_at, result, error
FROM public.cron_job_logs
WHERE job_name = 'weekly-digest'
ORDER BY started_at DESC
LIMIT 3;

-- 6. Varredura: algum OUTRO job está com o mesmo problema?
SELECT date_trunc('hour', created) AS hora, count(*), min(status_code) AS status
FROM net._http_response
WHERE status_code = 401 AND created > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1 DESC;

-- 7. E o inverso — jobs cujo token está visivelmente quebrado, antes de falharem:
SELECT jobid, jobname,
       length(replace(tok,'•','')) AS reais,
       length(tok)-length(replace(tok,'•','')) AS bullets
FROM (SELECT jobid, jobname, substring(command FROM '(eyJ[A-Za-z0-9_.•-]+)') AS tok FROM cron.job) s
WHERE tok IS NOT NULL
ORDER BY reais;
-- Leitura: bullets>0 = mascarado (normal, é a chave atual vista sem privilégio).
--          bullets=0 e reais<150 = QUEBRADO, chave truncada/legada. Era o caso do 17.
