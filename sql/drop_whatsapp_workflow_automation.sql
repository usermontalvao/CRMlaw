-- ============================================================================
-- DROP da automação de WhatsApp (workflow/agentes/regras/follow-up)
-- Projeto: uajwkqipbyxzvwjpitxl
-- Gerado em 18/06/2026 — descarte definitivo a pedido do Pedro.
--
-- O QUE FAZ: remove TODAS as tabelas/funções criadas pela automação descartada.
-- NÃO toca em nada do core (conversas, mensagens, instâncias, assinatura, etc.).
-- As colunas extras (model_provider/objective/instructions/…) saem junto porque
-- ficam DENTRO das próprias tabelas da automação.
--
-- ⚠️ DESTRUTIVO E IRREVERSÍVEL. Faça em horário tranquilo. O código-fonte está
--    guardado em backups/discarded-automation-20260618.patch caso queira voltar.
--
-- COMO RODAR: cole no SQL Editor do Supabase (ou psql) e execute o bloco inteiro.
-- ============================================================================

-- ── 1) PRÉ-CHECAGEM (opcional): veja o que será apagado e quantas linhas há ──
SELECT c.relname AS tabela, c.reltuples::bigint AS linhas_aprox
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'whatsapp_workflows',
    'whatsapp_workflow_steps',
    'whatsapp_workflow_agents',
    'whatsapp_workflow_rules',
    'whatsapp_channel_workflows',
    'whatsapp_followup_policies',
    'whatsapp_followup_policy_steps',
    'whatsapp_conversation_workflow_state',
    'whatsapp_workflow_transition_log',
    'whatsapp_workflow_locks',
    'whatsapp_workflow_processed_events'
  )
ORDER BY tabela;

-- ── 2) DROP em transação (tudo ou nada) ──
BEGIN;

-- 2a) Funções RPC do motor (wa_workflow_acquire / release / mark_event).
--     Drop por nome, independente da assinatura.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'wa_workflow%'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

-- 2b) Tabelas (CASCADE resolve FKs internas, policies, triggers, realtime e seeds).
DROP TABLE IF EXISTS public.whatsapp_workflow_processed_events   CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflow_locks              CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflow_transition_log     CASCADE;
DROP TABLE IF EXISTS public.whatsapp_conversation_workflow_state CASCADE;
DROP TABLE IF EXISTS public.whatsapp_followup_policy_steps       CASCADE;
DROP TABLE IF EXISTS public.whatsapp_followup_policies           CASCADE;
DROP TABLE IF EXISTS public.whatsapp_channel_workflows           CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflow_rules              CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflow_steps              CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflow_agents             CASCADE;
DROP TABLE IF EXISTS public.whatsapp_workflows                   CASCADE;

COMMIT;

-- ── 3) PÓS-VERIFICAÇÃO: deve voltar 0 linhas ──
SELECT 'table' AS tipo, table_name AS nome
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'whatsapp_workflow%'
       OR table_name LIKE 'whatsapp_followup%'
       OR table_name LIKE 'whatsapp_channel_workflow%'
       OR table_name LIKE 'whatsapp_conversation_workflow%')
UNION ALL
SELECT 'function', p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'wa_workflow%';
