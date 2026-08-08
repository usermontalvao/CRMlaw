-- ============================================================================
-- Remoção do Atendente de IA do WhatsApp
--
-- Desfaz as três migrations da feature:
--   20260808025820_whatsapp_atendente_ia.sql
--   20260808135420_whatsapp_ai_meeting_requests.sql
--   20260808141023_whatsapp_ai_approval_queue.sql
--
-- POR QUE UMA MIGRATION E NÃO APAGAR OS ARQUIVOS: as três já foram aplicadas em
-- produção. Apagá-las do repositório deixaria o histórico descrevendo um banco
-- que não é o real. O caminho de volta é para a frente.
--
-- CONTEXTO DA REMOÇÃO: o atendente nunca conversou com um cliente. Na hora do
-- drop havia 4 agentes cadastrados, 1 versão de prompt e ZERO em tudo o mais —
-- zero runs, zero estado por conversa, zero aprovações, zero reuniões, zero
-- sessões, e nenhum canal com ai_enabled. Os 4 prompts foram arquivados em
-- docs/arquivo/whatsapp-atendente-ia-prompts.md antes disto rodar.
--
-- NÃO TOCA em nada do núcleo: conversas, mensagens, instâncias, funil,
-- documentos, assinatura e clientes seguem intactos.
--
-- As tabelas da Fase J (whatsapp_ai_channel_config, whatsapp_ai_playbooks,
-- whatsapp_ai_sessions) são de junho e NÃO fazem parte desta feature — ficam de
-- pé, vazias. Removê-las é decisão separada.
-- ============================================================================

begin;

-- Ordem: dependentes primeiro. O CASCADE cobre índices, triggers e policies.
drop table if exists public.whatsapp_ai_tool_approvals   cascade;  -- fila de aprovação
drop table if exists public.whatsapp_ai_meeting_requests cascade;  -- reuniões pendentes
drop table if exists public.whatsapp_ai_runs             cascade;  -- log de decisões
drop table if exists public.whatsapp_ai_agent_state      cascade;  -- estado por conversa
drop table if exists public.whatsapp_ai_agent_versions   cascade;  -- histórico de prompt
drop table if exists public.whatsapp_ai_agents           cascade;  -- os agentes

-- Trigger de updated_at própria da feature. Não é helper compartilhado: foi
-- criada em 20260808025820 justamente para não acoplar a outra automação.
drop function if exists public.wa_ai_touch() cascade;

commit;
