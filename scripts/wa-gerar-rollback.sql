-- ============================================================================
-- Gera o rollback da série `20260822*_whatsapp_*` A PARTIR DO BANCO VIVO.
--
-- Rode ANTES de aplicar as migrations. A saída é um arquivo .sql pronto:
--
--     psql "$DATABASE_URL" -At -f scripts/wa-gerar-rollback.sql \
--       > supabase/rollback/whatsapp_permissoes_$(date +%Y%m%d%H%M).sql
--
-- ── POR QUE GERAR, E NÃO GUARDAR UM RETRATO ─────────────────────────────────
--
-- Existe um retrato versionado em `supabase/rollback/` — tirado no dia em que a
-- série foi escrita. Ele serve, mas envelhece: qualquer migration que toque
-- nestas funções depois disso e antes do deploy o deixa desatualizado, e um
-- rollback desatualizado não devolve o estado anterior — ele instala um estado
-- que nunca existiu, que é pior que não ter rollback nenhum.
--
-- Este arquivo lê o que está lá AGORA. É a única fonte que não mente.
--
-- ── O QUE ELE NÃO DESFAZ ────────────────────────────────────────────────────
--
-- Colunas e tabelas novas (`whatsapp_transfers.status`, `sender_role`,
-- `channel_members.role`, `whatsapp_conversation_collaborators`,
-- `whatsapp_call_logs.instance_id`) são ADITIVAS: o código antigo as ignora, e
-- derrubá-las apagaria dados que já teriam sido gravados. O rollback restaura
-- comportamento, não esquema. Se a intenção for apagar as colunas também, isso
-- é uma decisão separada — e depois de a operação já ter usado o estado das
-- transferências, é perda de auditoria.
-- ============================================================================

select
E'-- Rollback gerado de ' || current_database() || ' em ' || now()::text || E'\n'
|| E'-- Restaura o COMPORTAMENTO anterior à série 20260822*_whatsapp_*.\n'
|| E'-- Colunas e tabelas novas são aditivas e NÃO são removidas aqui (ver o gerador).\n\n'
|| E'begin;\n\n'
|| E'-- ── Funções ────────────────────────────────────────────────────────────\n\n'
|| coalesce((
     select string_agg(pg_get_functiondef(p.oid) || E';\n', E'\n' order by p.proname)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'is_office_staff', 'wa_is_supervisor', 'wa_can_see_channel', 'wa_can_see_conv',
          'wa_can_see_call', 'whatsapp_contact_book', 'broadcast_whatsapp_message_changed',
          'wa_assume_contact_attendance', 'wa_assign_contact_attendance',
          'wa_transfer_contact_attendance', 'wa_accept_contact_transfer',
          'wa_release_contact_attendance', 'wa_close_contact_attendance',
          'wa_reopen_contact_attendance', 'wa_mark_contact_read', 'wa_mark_contact_unread'
        )
   ), '-- (nenhuma função encontrada)')
|| E'\n-- ── Policies ───────────────────────────────────────────────────────────\n\n'
|| coalesce((
     select string_agg(stmt, E'\n' order by tbl, polname) from (
       select c.relname tbl, pol.polname,
         format(
           'drop policy if exists %I on public.%I;' || E'\n' ||
           'create policy %I on public.%I for %s to %s%s%s;',
           pol.polname, c.relname, pol.polname, c.relname,
           case pol.polcmd
             when 'r' then 'select' when 'a' then 'insert'
             when 'w' then 'update' when 'd' then 'delete' else 'all' end,
           coalesce((select string_agg(quote_ident(r.rolname), ', ')
                       from pg_roles r where r.oid = any(pol.polroles)), 'public'),
           coalesce(E'\n  using (' || pg_get_expr(pol.polqual, pol.polrelid) || ')', ''),
           coalesce(E'\n  with check (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')', '')
         ) stmt
         from pg_policy pol
         join pg_class c on c.oid = pol.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'whatsapp_transfers', 'whatsapp_messages', 'whatsapp_conversations',
            'whatsapp_internal_notes', 'whatsapp_contact_blocks',
            'whatsapp_scheduled_messages', 'whatsapp_call_logs',
            'whatsapp_ai_meeting_requests', 'whatsapp_ai_sessions',
            'whatsapp_ai_agents', 'whatsapp_ai_agent_versions',
            'whatsapp_ai_channel_config', 'whatsapp_ai_playbooks',
            'whatsapp_ai_assistants', 'whatsapp_department_members',
            'whatsapp_departments', 'whatsapp_channel_departments',
            'whatsapp_channel_members'
          )
     ) x
   ), '-- (nenhuma policy encontrada)')
|| E'\n\n-- ── Objetos criados pela série, que o rollback desliga ─────────────────\n\n'
|| E'-- O gatilho de desligamento automático. A FUNÇÃO fica (é chamável à mão\n'
|| E'-- e não faz mal parada); o que sai é o disparo automático.\n'
|| E'drop trigger if exists wa_offboard_ao_desativar on public.profiles;\n'
|| E'drop trigger if exists wa_transfer_revoga_colaboradores on public.whatsapp_transfers;\n\n'
|| E'-- A policy do broadcast por canal. O tópico único volta a ser o caminho,\n'
|| E'-- e o gatilho restaurado acima já publica nele.\n'
|| E'drop policy if exists "broadcast de mensagens do whatsapp por canal" on realtime.messages;\n\n'
|| E'-- A agenda volta à assinatura sem parâmetros (o front-end tem queda para ela).\n'
|| E'drop function if exists public.whatsapp_contact_book(text, integer);\n\n'
|| E'commit;\n'
as rollback_sql;
