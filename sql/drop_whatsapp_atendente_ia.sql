-- ============================================================================
-- Remoção completa do Atendente de IA do WhatsApp
-- Projeto: uajwkqipbyxzvwjpitxl
--
-- Escrito JUNTO com a migration 20260809120000_whatsapp_atendente_ia.sql, antes
-- de qualquer linha entrar em produção. O caminho de volta não é remendo: é
-- parte do desenho.
--
-- O QUE FAZ: apaga as 4 tabelas do atendente e a função de trigger dela.
-- O QUE NÃO TOCA: conversas, mensagens, instâncias, funil, documentos,
-- assinatura, clientes — nada do núcleo. O módulo de WhatsApp volta exatamente
-- ao que era antes.
--
-- ⚠️ DESTRUTIVO. Apaga a configuração dos agentes e todo o histórico de decisões.
--    As conversas em si NÃO são afetadas.
--
-- ANTES DE CHEGAR AQUI, tente o degrau mais barato — desligar sem apagar nada:
--
--     UPDATE public.whatsapp_ai_agents SET is_active = false;
--     UPDATE public.whatsapp_ai_channel_config SET ai_enabled = false;
--
--  Isso para o atendente na hora, sem deploy e sem perder o histórico. Só siga
--  para o DROP abaixo se quiser mesmo apagar a feature.
--
-- COMO RODAR: cole no SQL Editor do Supabase e execute o bloco inteiro.
-- ============================================================================

-- ── 1) Pré-checagem: o que será apagado e quanto há ─────────────────────────
SELECT 'whatsapp_ai_agents'         AS tabela, count(*) AS linhas FROM public.whatsapp_ai_agents
UNION ALL
SELECT 'whatsapp_ai_agent_versions', count(*) FROM public.whatsapp_ai_agent_versions
UNION ALL
SELECT 'whatsapp_ai_agent_state',    count(*) FROM public.whatsapp_ai_agent_state
UNION ALL
SELECT 'whatsapp_ai_runs',           count(*) FROM public.whatsapp_ai_runs;

-- ── 2) DROP em transação: tudo ou nada ──────────────────────────────────────
BEGIN;

DROP TABLE IF EXISTS public.whatsapp_ai_runs           CASCADE;
DROP TABLE IF EXISTS public.whatsapp_ai_agent_state    CASCADE;
DROP TABLE IF EXISTS public.whatsapp_ai_agent_versions CASCADE;
DROP TABLE IF EXISTS public.whatsapp_ai_agents         CASCADE;

DROP FUNCTION IF EXISTS public.wa_ai_touch() CASCADE;

COMMIT;

-- ── 3) Conferência: deve voltar zero linhas ─────────────────────────────────
SELECT c.relname AS tabela_restante
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'whatsapp_ai_agents',
    'whatsapp_ai_agent_versions',
    'whatsapp_ai_agent_state',
    'whatsapp_ai_runs'
  );

-- ── 4) O que ainda falta fazer fora do banco ────────────────────────────────
-- a) apagar a edge function do atendente no painel do Supabase;
-- b) reverter no repositório: a chamada no evolution-webhook, a edge function,
--    supabase/functions/_shared/wa-agent-tools.ts e as telas do atendente.
-- Nada disso é urgente: sem as tabelas, o motor falha e o webhook engole o erro
-- dentro do try/catch — a inbox segue funcionando normalmente.
