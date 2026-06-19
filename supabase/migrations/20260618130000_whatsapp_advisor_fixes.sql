-- WhatsApp: correções dos advisors do Supabase (RLS initplan, policies duplicadas,
-- FKs sem índice, search_path mutável). Apenas otimizações — sem mudança de
-- comportamento das regras de acesso.
--
-- 1) auth_rls_initplan: envolve auth.uid() em (select auth.uid()) para que o
--    planner avalie UMA vez por query em vez de por linha.
-- 2) multiple_permissive_policies: whatsapp_agent_settings tinha uma policy ALL
--    (self) + uma SELECT (staff) que se sobrepunham no SELECT; separa por comando.
-- 3) unindexed_foreign_keys: índices de cobertura nas 17 FKs sinalizadas.
-- 4) function_search_path_mutable: fixa search_path da função imutável.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) RLS initplan — whatsapp_conversation_mutes (role public)
-- ─────────────────────────────────────────────────────────────────────────────
alter policy mutes_delete_own on public.whatsapp_conversation_mutes
  using (((select auth.uid()) = user_id));
alter policy mutes_insert_own on public.whatsapp_conversation_mutes
  with check (((select auth.uid()) = user_id));
alter policy mutes_select_own on public.whatsapp_conversation_mutes
  using (((select auth.uid()) = user_id));
alter policy mutes_update_own on public.whatsapp_conversation_mutes
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) RLS initplan — whatsapp_internal_notes (role authenticated)
--    (a policy de SELECT não usa auth.uid() diretamente — fica inalterada)
-- ─────────────────────────────────────────────────────────────────────────────
alter policy wa_note_delete on public.whatsapp_internal_notes
  using (((author_id = (select auth.uid())) OR wa_is_supervisor()));
alter policy wa_note_insert on public.whatsapp_internal_notes
  with check ((is_office_staff() AND (author_id = (select auth.uid()))));
alter policy wa_note_update on public.whatsapp_internal_notes
  using (((author_id = (select auth.uid())) OR wa_is_supervisor()))
  with check (((author_id = (select auth.uid())) OR wa_is_supervisor()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) RLS initplan — whatsapp_scheduled_messages (role authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
alter policy wa_sched_delete on public.whatsapp_scheduled_messages
  using (((created_by = (select auth.uid())) OR wa_is_supervisor()));
alter policy wa_sched_insert on public.whatsapp_scheduled_messages
  with check ((is_office_staff() AND (created_by = (select auth.uid()))));
alter policy wa_sched_update on public.whatsapp_scheduled_messages
  using (((created_by = (select auth.uid())) OR wa_is_supervisor()))
  with check (((created_by = (select auth.uid())) OR wa_is_supervisor()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) multiple_permissive_policies + initplan — whatsapp_agent_settings
--    Antes: wa_agent_self_write (ALL, self) + wa_agent_staff_read (SELECT, staff)
--    → ambas avaliadas em todo SELECT. Reescreve separando por comando, mantendo
--    a mesma semântica: self lê/escreve a própria linha; staff lê todas.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists wa_agent_self_write on public.whatsapp_agent_settings;
drop policy if exists wa_agent_staff_read on public.whatsapp_agent_settings;

create policy wa_agent_select on public.whatsapp_agent_settings
  for select to authenticated
  using ((user_id = (select auth.uid())) OR is_office_staff());
create policy wa_agent_insert on public.whatsapp_agent_settings
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy wa_agent_update on public.whatsapp_agent_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy wa_agent_delete on public.whatsapp_agent_settings
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Índices de cobertura para FKs (unindexed_foreign_keys)
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_wa_ai_channel_config_playbook        on public.whatsapp_ai_channel_config (playbook_id);
create index if not exists idx_wa_ai_sessions_playbook              on public.whatsapp_ai_sessions (playbook_id);
create index if not exists idx_wa_contact_blocks_performed_by       on public.whatsapp_contact_blocks (performed_by);
create index if not exists idx_wa_conversations_blocked_by          on public.whatsapp_conversations (blocked_by);
create index if not exists idx_wa_conversations_closed_by           on public.whatsapp_conversations (closed_by);
create index if not exists idx_wa_internal_notes_author_id          on public.whatsapp_internal_notes (author_id);
create index if not exists idx_wa_messages_sender_user_id           on public.whatsapp_messages (sender_user_id);
create index if not exists idx_wa_scheduled_messages_channel_id     on public.whatsapp_scheduled_messages (channel_id);
create index if not exists idx_wa_scheduled_messages_created_by     on public.whatsapp_scheduled_messages (created_by);
create index if not exists idx_wa_templates_channel_id             on public.whatsapp_templates (channel_id);
create index if not exists idx_wa_templates_department_id          on public.whatsapp_templates (department_id);
create index if not exists idx_wa_transfers_accepted_by           on public.whatsapp_transfers (accepted_by);
create index if not exists idx_wa_transfers_from_department_id     on public.whatsapp_transfers (from_department_id);
create index if not exists idx_wa_transfers_from_user_id          on public.whatsapp_transfers (from_user_id);
create index if not exists idx_wa_transfers_performed_by          on public.whatsapp_transfers (performed_by);
create index if not exists idx_wa_transfers_to_department_id      on public.whatsapp_transfers (to_department_id);
create index if not exists idx_wa_transfers_to_user_id           on public.whatsapp_transfers (to_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) function_search_path_mutable — whatsapp_phone_match_key
--    Função IMMUTABLE pura (usa só built-ins de pg_catalog) → search_path vazio é seguro.
-- ─────────────────────────────────────────────────────────────────────────────
alter function public.whatsapp_phone_match_key(text) set search_path = '';
