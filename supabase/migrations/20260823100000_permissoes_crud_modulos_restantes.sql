-- Completa a matriz de Configurações → Permissões nos módulos que ainda
-- dependiam apenas de `is_office_staff()` (ou apenas de autoria/supervisão).
--
-- A interface faz a checagem antes da confirmação/PIN; estas policies são a
-- autoridade final contra chamadas diretas à Data API e ao Storage.

-- Tabelas sem regra adicional de propriedade/visibilidade. O módulo de
-- leitura pode ser diferente do módulo que administra a configuração (caso
-- dos cadastros auxiliares do WhatsApp).
DO $migration$
DECLARE
  item record;
  old_policy record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('cloud_folders',                    'cloud',      'cloud'),
      ('cloud_files',                      'cloud',      'cloud'),
      ('cloud_folder_shares',              'cloud',      'cloud'),
      ('cloud_activity_logs',              'cloud',      'cloud'),
      ('document_templates',               'documentos', 'documentos'),
      ('generated_documents',              'documentos', 'documentos'),
      ('template_files',                    'documentos', 'documentos'),
      ('document_custom_fields',            'documentos', 'documentos'),
      ('template_custom_fields',            'documentos', 'documentos'),
      ('petition_blocks',                   'peticoes',   'peticoes'),
      ('petition_block_categories',         'peticoes',   'peticoes'),
      ('legal_areas',                       'peticoes',   'peticoes'),
      ('petition_standard_types',           'peticoes',   'peticoes'),
      ('petition_standard_type_blocks',     'peticoes',   'peticoes'),
      ('saved_petitions',                   'peticoes',   'peticoes'),
      ('standard_petitions',                'peticoes',   'peticoes'),
      ('email_spam_rules',                  'emails',     'emails'),
      ('email_spam_senders',                'emails',     'emails'),
      ('whatsapp_departments',              'whatsapp',   'configuracoes'),
      ('whatsapp_department_members',       'whatsapp',   'configuracoes'),
      ('whatsapp_channel_departments',      'whatsapp',   'configuracoes'),
      ('whatsapp_templates',                'whatsapp',   'configuracoes'),
      ('whatsapp_ai_assistants',            'whatsapp',   'configuracoes'),
      ('whatsapp_ai_channel_config',        'whatsapp',   'configuracoes'),
      ('whatsapp_business_hours',           'whatsapp',   'configuracoes'),
      ('whatsapp_ai_playbooks',             'whatsapp',   'configuracoes')
    ) AS mapped(table_name, read_module, write_module)
  LOOP
    IF to_regclass('public.' || item.table_name) IS NULL THEN
      CONTINUE;
    END IF;

    FOR old_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = item.table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy.policyname, item.table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY module_permission_select ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_module_permission(%L, %L)))',
      item.table_name, item.read_module, 'view'
    );
    EXECUTE format(
      'CREATE POLICY module_permission_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_module_permission(%L, %L)))',
      item.table_name, item.write_module, 'create'
    );
    EXECUTE format(
      'CREATE POLICY module_permission_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.has_module_permission(%L, %L))) WITH CHECK ((SELECT public.has_module_permission(%L, %L)))',
      item.table_name, item.write_module, 'edit', item.write_module, 'edit'
    );
    EXECUTE format(
      'CREATE POLICY module_permission_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT public.has_module_permission(%L, %L)))',
      item.table_name, item.write_module, 'delete'
    );
  END LOOP;
END
$migration$;

-- Uploads do portal mantêm as policies próprias do cliente. Aqui substituímos
-- somente o acesso amplo da equipe.
DROP POLICY IF EXISTS crm_full_document_uploads ON public.document_uploads;
CREATE POLICY document_uploads_staff_select ON public.document_uploads FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('documentos', 'view')) OR (SELECT public.has_module_permission('whatsapp', 'view')));
CREATE POLICY document_uploads_staff_insert ON public.document_uploads FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('documentos', 'create')) OR (SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY document_uploads_staff_update ON public.document_uploads FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('documentos', 'edit')) OR (SELECT public.has_module_permission('whatsapp', 'edit')))
  WITH CHECK ((SELECT public.has_module_permission('documentos', 'edit')) OR (SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY document_uploads_staff_delete ON public.document_uploads FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('documentos', 'delete')) OR (SELECT public.has_module_permission('whatsapp', 'delete')));

-- Estas duas tabelas históricas de petições nunca aceitaram todas as ações;
-- preservamos o conjunto original de operações enquanto protegemos as que
-- existem.
DROP POLICY IF EXISTS "Allow authenticated users to read generated_petition_documents" ON public.generated_petition_documents;
DROP POLICY IF EXISTS "Allow authenticated users to insert generated_petition_document" ON public.generated_petition_documents;
CREATE POLICY generated_petition_documents_select ON public.generated_petition_documents
  FOR SELECT TO authenticated USING ((SELECT public.has_module_permission('peticoes', 'view')));
CREATE POLICY generated_petition_documents_insert ON public.generated_petition_documents
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_module_permission('peticoes', 'create')));

DROP POLICY IF EXISTS "Allow authenticated users to read petition_documents" ON public.petition_documents;
CREATE POLICY petition_documents_select ON public.petition_documents
  FOR SELECT TO authenticated USING ((SELECT public.has_module_permission('peticoes', 'view')));

-- Contas, modelos e a caixa legada continuam pessoais, com a ação do cargo
-- aplicada por cima da propriedade.
DO $migration$
DECLARE
  table_name text;
  old_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['email_accounts', 'email_templates', 'emails']
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    FOR old_policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy.policyname, table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY personal_email_select ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''emails'', ''view'')))', table_name);
    EXECUTE format('CREATE POLICY personal_email_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''emails'', ''create'')))', table_name);
    EXECUTE format('CREATE POLICY personal_email_update ON public.%I FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''emails'', ''edit''))) WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''emails'', ''edit'')))', table_name);
    EXECUTE format('CREATE POLICY personal_email_delete ON public.%I FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''emails'', ''delete'')))', table_name);
  END LOOP;
END
$migration$;

-- Links públicos da Nuvem continuam legíveis sem sessão.
CREATE POLICY cloud_folders_anon_shared_view ON public.cloud_folders
  FOR SELECT TO anon USING (public.cloud_folder_has_active_share(id));
CREATE POLICY cloud_files_anon_shared_view ON public.cloud_files
  FOR SELECT TO anon USING (public.cloud_folder_has_active_share(folder_id));
CREATE POLICY cloud_folder_shares_anon_lookup ON public.cloud_folder_shares
  FOR SELECT TO anon
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- O modelo padrão é pessoal, além de obedecer às permissões do módulo.
DROP POLICY IF EXISTS "Users can view their own default template" ON public.petition_default_templates;
DROP POLICY IF EXISTS "Users can insert their own default template" ON public.petition_default_templates;
DROP POLICY IF EXISTS "Users can update their own default template" ON public.petition_default_templates;
DROP POLICY IF EXISTS "Users can delete their own default template" ON public.petition_default_templates;
CREATE POLICY petition_default_templates_select ON public.petition_default_templates
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('peticoes', 'view')));
CREATE POLICY petition_default_templates_insert ON public.petition_default_templates
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('peticoes', 'create')));
CREATE POLICY petition_default_templates_update ON public.petition_default_templates
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('peticoes', 'edit')))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('peticoes', 'edit')));
CREATE POLICY petition_default_templates_delete ON public.petition_default_templates
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('peticoes', 'delete')));

-- E-mail: preserva a restrição estrutural de rascunho na inserção.
DROP POLICY IF EXISTS email_messages_select_authenticated ON public.email_messages;
DROP POLICY IF EXISTS email_messages_insert_draft_authenticated ON public.email_messages;
DROP POLICY IF EXISTS email_messages_update_authenticated ON public.email_messages;
DROP POLICY IF EXISTS email_messages_delete_authenticated ON public.email_messages;
CREATE POLICY email_messages_select_by_permission ON public.email_messages
  FOR SELECT TO authenticated USING ((SELECT public.has_module_permission('emails', 'view')));
CREATE POLICY email_messages_insert_by_permission ON public.email_messages
  FOR INSERT TO authenticated
  WITH CHECK (is_draft = true AND direction = 'outbound' AND (SELECT public.has_module_permission('emails', 'create')));
CREATE POLICY email_messages_update_by_permission ON public.email_messages
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('emails', 'edit')))
  WITH CHECK ((SELECT public.has_module_permission('emails', 'edit')));
CREATE POLICY email_messages_delete_by_permission ON public.email_messages
  FOR DELETE TO authenticated USING ((SELECT public.has_module_permission('emails', 'delete')));

DROP POLICY IF EXISTS email_signatures_own ON public.email_signatures;
CREATE POLICY email_signatures_select_own ON public.email_signatures
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('emails', 'view')));
CREATE POLICY email_signatures_insert_own ON public.email_signatures
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('emails', 'create')));
CREATE POLICY email_signatures_update_own ON public.email_signatures
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('emails', 'edit')))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('emails', 'edit')));
CREATE POLICY email_signatures_delete_own ON public.email_signatures
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('emails', 'delete')));

DROP POLICY IF EXISTS "Users can view their own template fill links" ON public.template_fill_links;
DROP POLICY IF EXISTS "Users can create template fill links" ON public.template_fill_links;
DROP POLICY IF EXISTS "Users can update their own template fill links" ON public.template_fill_links;
CREATE POLICY template_fill_links_select_own ON public.template_fill_links FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'view')));
CREATE POLICY template_fill_links_insert_own ON public.template_fill_links FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'create')));
CREATE POLICY template_fill_links_update_own ON public.template_fill_links FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'edit')))
  WITH CHECK (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'edit')));

DROP POLICY IF EXISTS "Users can view own permalinks" ON public.template_fill_permalinks;
DROP POLICY IF EXISTS "Users can insert own permalinks" ON public.template_fill_permalinks;
DROP POLICY IF EXISTS "Users can update own permalinks" ON public.template_fill_permalinks;
DROP POLICY IF EXISTS "Users can delete own permalinks" ON public.template_fill_permalinks;
CREATE POLICY template_fill_permalinks_select_own ON public.template_fill_permalinks FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'view')));
CREATE POLICY template_fill_permalinks_insert_own ON public.template_fill_permalinks FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'create')));
CREATE POLICY template_fill_permalinks_update_own ON public.template_fill_permalinks FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'edit')))
  WITH CHECK (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'edit')));
CREATE POLICY template_fill_permalinks_delete_own ON public.template_fill_permalinks FOR DELETE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND (SELECT public.has_module_permission('documentos', 'delete')));

-- Feed: a interface oferece exclusão administrativa; a policy anterior só
-- permitia ao autor e fazia a operação administrativa parecer bem-sucedida.
DROP POLICY IF EXISTS "Usuários podem deletar seus próprios posts" ON public.feed_posts;
CREATE POLICY "Autores e administradores podem deletar posts" ON public.feed_posts
  FOR DELETE TO authenticated
  USING (author_id = (SELECT auth.uid()) OR (SELECT public.is_module_admin()));

-- Solicitações de documentos são consumidas tanto por Documentos quanto pelo
-- painel 360 do WhatsApp. Basta ter a ação em um dos dois módulos.
DO $migration$
DECLARE
  table_name text;
  old_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['document_requests', 'document_request_items']
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    FOR old_policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy.policyname, table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY document_request_select ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_module_permission(''documentos'', ''view'')) OR (SELECT public.has_module_permission(''whatsapp'', ''view'')))', table_name);
    EXECUTE format('CREATE POLICY document_request_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_module_permission(''documentos'', ''create'')) OR (SELECT public.has_module_permission(''whatsapp'', ''create'')))', table_name);
    EXECUTE format('CREATE POLICY document_request_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.has_module_permission(''documentos'', ''edit'')) OR (SELECT public.has_module_permission(''whatsapp'', ''edit''))) WITH CHECK ((SELECT public.has_module_permission(''documentos'', ''edit'')) OR (SELECT public.has_module_permission(''whatsapp'', ''edit'')))', table_name);
    EXECUTE format('CREATE POLICY document_request_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT public.has_module_permission(''documentos'', ''delete'')) OR (SELECT public.has_module_permission(''whatsapp'', ''delete'')))', table_name);
  END LOOP;
END
$migration$;

-- WhatsApp: permissões do módulo se somam à visibilidade por canal e à
-- autoridade de supervisor já existentes.
DROP POLICY IF EXISTS wa_inst_select ON public.whatsapp_instances;
DROP POLICY IF EXISTS wa_inst_insert ON public.whatsapp_instances;
DROP POLICY IF EXISTS wa_inst_update ON public.whatsapp_instances;
DROP POLICY IF EXISTS wa_inst_delete ON public.whatsapp_instances;
CREATE POLICY wa_inst_select ON public.whatsapp_instances FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_channel(id, visibility_mode));
CREATE POLICY wa_inst_insert ON public.whatsapp_instances FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('configuracoes', 'create')) AND public.wa_is_supervisor());
CREATE POLICY wa_inst_update ON public.whatsapp_instances FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('configuracoes', 'edit')) AND public.wa_is_supervisor())
  WITH CHECK ((SELECT public.has_module_permission('configuracoes', 'edit')) AND public.wa_is_supervisor());
CREATE POLICY wa_inst_delete ON public.whatsapp_instances FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('configuracoes', 'delete')) AND public.wa_is_supervisor());

DROP POLICY IF EXISTS wa_channel_member_select ON public.whatsapp_channel_members;
DROP POLICY IF EXISTS wa_channel_member_insert ON public.whatsapp_channel_members;
DROP POLICY IF EXISTS wa_channel_member_delete ON public.whatsapp_channel_members;
CREATE POLICY wa_channel_member_select ON public.whatsapp_channel_members FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')));
CREATE POLICY wa_channel_member_insert ON public.whatsapp_channel_members FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('configuracoes', 'edit')) AND public.wa_is_supervisor());
CREATE POLICY wa_channel_member_delete ON public.whatsapp_channel_members FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('configuracoes', 'edit')) AND public.wa_is_supervisor());

DROP POLICY IF EXISTS wa_conv_select ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_insert ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_update ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_delete ON public.whatsapp_conversations;
CREATE POLICY wa_conv_select ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id));
CREATE POLICY wa_conv_insert ON public.whatsapp_conversations FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY wa_conv_update ON public.whatsapp_conversations FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY wa_conv_delete ON public.whatsapp_conversations FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'delete')) AND public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id));

DROP POLICY IF EXISTS wa_msg_select ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_insert ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_update ON public.whatsapp_messages;
DROP POLICY IF EXISTS wa_msg_delete ON public.whatsapp_messages;
CREATE POLICY wa_msg_select ON public.whatsapp_messages FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_msg_insert ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY wa_msg_update ON public.whatsapp_messages FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY wa_msg_delete ON public.whatsapp_messages FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'delete')) AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_sched_select ON public.whatsapp_scheduled_messages;
DROP POLICY IF EXISTS wa_sched_insert ON public.whatsapp_scheduled_messages;
DROP POLICY IF EXISTS wa_sched_update ON public.whatsapp_scheduled_messages;
DROP POLICY IF EXISTS wa_sched_delete ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_select ON public.whatsapp_scheduled_messages FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_sched_insert ON public.whatsapp_scheduled_messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'create')) AND created_by = (SELECT auth.uid()));
CREATE POLICY wa_sched_update ON public.whatsapp_scheduled_messages FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND (created_by = (SELECT auth.uid()) OR public.wa_is_supervisor()))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')) AND (created_by = (SELECT auth.uid()) OR public.wa_is_supervisor()));
CREATE POLICY wa_sched_delete ON public.whatsapp_scheduled_messages FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'delete')) AND (created_by = (SELECT auth.uid()) OR public.wa_is_supervisor()));

DROP POLICY IF EXISTS wa_note_select ON public.whatsapp_internal_notes;
DROP POLICY IF EXISTS wa_note_insert ON public.whatsapp_internal_notes;
DROP POLICY IF EXISTS wa_note_update ON public.whatsapp_internal_notes;
DROP POLICY IF EXISTS wa_note_delete ON public.whatsapp_internal_notes;
CREATE POLICY wa_note_select ON public.whatsapp_internal_notes FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_note_insert ON public.whatsapp_internal_notes FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'create')) AND author_id = (SELECT auth.uid()));
CREATE POLICY wa_note_update ON public.whatsapp_internal_notes FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND (author_id = (SELECT auth.uid()) OR public.wa_is_supervisor()))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')) AND (author_id = (SELECT auth.uid()) OR public.wa_is_supervisor()));
CREATE POLICY wa_note_delete ON public.whatsapp_internal_notes FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'delete')) AND (author_id = (SELECT auth.uid()) OR public.wa_is_supervisor()));

DROP POLICY IF EXISTS ai_sessions_select ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_insert ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_update ON public.whatsapp_ai_sessions;
DROP POLICY IF EXISTS ai_sessions_delete ON public.whatsapp_ai_sessions;
CREATE POLICY ai_sessions_select ON public.whatsapp_ai_sessions FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY ai_sessions_insert ON public.whatsapp_ai_sessions FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY ai_sessions_update ON public.whatsapp_ai_sessions FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY ai_sessions_delete ON public.whatsapp_ai_sessions FOR DELETE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'delete')) AND public.wa_can_see_conv_id(conversation_id));

DROP POLICY IF EXISTS wa_ai_followups_staff_read ON public.whatsapp_ai_followups;
DROP POLICY IF EXISTS wa_ai_followups_staff_update ON public.whatsapp_ai_followups;
CREATE POLICY wa_ai_followups_staff_read ON public.whatsapp_ai_followups FOR SELECT TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_can_see_conv_id(conversation_id));
CREATE POLICY wa_ai_followups_staff_update ON public.whatsapp_ai_followups FOR UPDATE TO authenticated
  USING ((SELECT public.has_module_permission('whatsapp', 'edit')) AND public.wa_can_see_conv_id(conversation_id))
  WITH CHECK ((SELECT public.has_module_permission('whatsapp', 'edit')));

-- Preferências pessoais ainda são pessoais; agora também exigem acesso ao
-- módulo para não virarem uma rota lateral de escrita.
DROP POLICY IF EXISTS wa_agent_select ON public.whatsapp_agent_settings;
DROP POLICY IF EXISTS wa_agent_insert ON public.whatsapp_agent_settings;
DROP POLICY IF EXISTS wa_agent_update ON public.whatsapp_agent_settings;
DROP POLICY IF EXISTS wa_agent_delete ON public.whatsapp_agent_settings;
CREATE POLICY wa_agent_select ON public.whatsapp_agent_settings FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('whatsapp', 'view')));
CREATE POLICY wa_agent_insert ON public.whatsapp_agent_settings FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY wa_agent_update ON public.whatsapp_agent_settings FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('whatsapp', 'edit')))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY wa_agent_delete ON public.whatsapp_agent_settings FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission('whatsapp', 'delete')));

-- Rascunhos e silenciamentos são pessoais. Para estas preferências, editar é
-- a ação adequada para inserir, alterar e remover estado.
DO $migration$
DECLARE
  table_name text;
  old_policy record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_drafts', 'whatsapp_conversation_mutes']
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    FOR old_policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old_policy.policyname, table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY personal_whatsapp_select ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''whatsapp'', ''view'')))', table_name);
    EXECUTE format('CREATE POLICY personal_whatsapp_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''whatsapp'', ''edit'')))', table_name);
    EXECUTE format('CREATE POLICY personal_whatsapp_update ON public.%I FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''whatsapp'', ''edit''))) WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''whatsapp'', ''edit'')))', table_name);
    EXECUTE format('CREATE POLICY personal_whatsapp_delete ON public.%I FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) AND (SELECT public.has_module_permission(''whatsapp'', ''edit'')))', table_name);
  END LOOP;
END
$migration$;

-- Storage: banco e arquivo obedecem à mesma ação. Policies públicas/portal de
-- leitura continuam intactas e são recriadas apenas onde a policy ampla foi
-- removida acima.
DROP POLICY IF EXISTS cloud_files_storage_authenticated_all ON storage.objects;
CREATE POLICY cloud_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cloud-files' AND (SELECT public.has_module_permission('cloud', 'view')));
CREATE POLICY cloud_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cloud-files' AND (SELECT public.has_module_permission('cloud', 'create')));
CREATE POLICY cloud_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cloud-files' AND (SELECT public.has_module_permission('cloud', 'edit')))
  WITH CHECK (bucket_id = 'cloud-files' AND (SELECT public.has_module_permission('cloud', 'edit')));
CREATE POLICY cloud_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cloud-files' AND (SELECT public.has_module_permission('cloud', 'delete')));

DROP POLICY IF EXISTS crm_full_documents ON storage.objects;
CREATE POLICY client_documents_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-documents' AND (
    (SELECT public.has_module_permission('documentos', 'view')) OR
    (SELECT public.has_module_permission('whatsapp', 'view'))
  ));
CREATE POLICY client_documents_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-documents' AND (
    (SELECT public.has_module_permission('documentos', 'create')) OR
    (SELECT public.has_module_permission('whatsapp', 'create'))
  ));
CREATE POLICY client_documents_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-documents' AND (
    (SELECT public.has_module_permission('documentos', 'edit')) OR
    (SELECT public.has_module_permission('whatsapp', 'edit'))
  ))
  WITH CHECK (bucket_id = 'client-documents' AND (
    (SELECT public.has_module_permission('documentos', 'edit')) OR
    (SELECT public.has_module_permission('whatsapp', 'edit'))
  ));
CREATE POLICY client_documents_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-documents' AND (
    (SELECT public.has_module_permission('documentos', 'delete')) OR
    (SELECT public.has_module_permission('whatsapp', 'delete'))
  ));

DROP POLICY IF EXISTS "Allow read document templates (authenticated)" ON storage.objects;
DROP POLICY IF EXISTS "Allow upload document templates (authenticated)" ON storage.objects;
DROP POLICY IF EXISTS "Allow update document templates" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete document templates" ON storage.objects;
CREATE POLICY document_templates_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'document-templates' AND (SELECT public.has_module_permission('documentos', 'view')));
CREATE POLICY document_templates_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'document-templates' AND (SELECT public.has_module_permission('documentos', 'create')));
CREATE POLICY document_templates_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'document-templates' AND (SELECT public.has_module_permission('documentos', 'edit')))
  WITH CHECK (bucket_id = 'document-templates' AND (SELECT public.has_module_permission('documentos', 'edit')));
CREATE POLICY document_templates_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'document-templates' AND (SELECT public.has_module_permission('documentos', 'delete')));

DROP POLICY IF EXISTS authenticated_select_generated_documents ON storage.objects;
DROP POLICY IF EXISTS authenticated_insert_generated_documents ON storage.objects;
DROP POLICY IF EXISTS authenticated_update_generated_documents ON storage.objects;
DROP POLICY IF EXISTS authenticated_delete_generated_documents ON storage.objects;
DROP POLICY IF EXISTS "Allow upload signature request PDFs" ON storage.objects;
CREATE POLICY generated_documents_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'generated-documents' AND (
    (SELECT public.has_module_permission('documentos', 'view')) OR
    (SELECT public.has_module_permission('assinaturas', 'view'))
  ));
CREATE POLICY generated_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'generated-documents' AND (
    (SELECT public.has_module_permission('documentos', 'create')) OR
    (name LIKE 'signature-requests/%' AND (SELECT public.has_module_permission('assinaturas', 'create')))
  ));
CREATE POLICY generated_documents_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'generated-documents' AND (
    (SELECT public.has_module_permission('documentos', 'edit')) OR
    (name LIKE 'signature-requests/%' AND (SELECT public.has_module_permission('assinaturas', 'edit')))
  ))
  WITH CHECK (bucket_id = 'generated-documents' AND (
    (SELECT public.has_module_permission('documentos', 'edit')) OR
    (name LIKE 'signature-requests/%' AND (SELECT public.has_module_permission('assinaturas', 'edit')))
  ));
CREATE POLICY generated_documents_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'generated-documents' AND (
    (SELECT public.has_module_permission('documentos', 'delete')) OR
    (name LIKE 'signature-requests/%' AND (SELECT public.has_module_permission('assinaturas', 'delete')))
  ));

-- Buckets das petições.
DROP POLICY IF EXISTS "Allow authenticated users to read standard-petitions" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to insert standard-petitions" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update standard-petitions" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete standard-petitions" ON storage.objects;
DROP POLICY IF EXISTS petition_documents_storage_read ON storage.objects;
DROP POLICY IF EXISTS petition_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS petition_documents_storage_delete ON storage.objects;
DROP POLICY IF EXISTS petition_templates_storage_read ON storage.objects;
DROP POLICY IF EXISTS petition_templates_storage_insert ON storage.objects;
DROP POLICY IF EXISTS petition_templates_storage_delete ON storage.objects;
CREATE POLICY petitions_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('standard-petitions', 'petition-documents', 'petition-templates') AND (SELECT public.has_module_permission('peticoes', 'view')));
CREATE POLICY petitions_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('standard-petitions', 'petition-documents', 'petition-templates') AND (SELECT public.has_module_permission('peticoes', 'create')));
CREATE POLICY petitions_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('standard-petitions', 'petition-documents', 'petition-templates') AND (SELECT public.has_module_permission('peticoes', 'edit')))
  WITH CHECK (bucket_id IN ('standard-petitions', 'petition-documents', 'petition-templates') AND (SELECT public.has_module_permission('peticoes', 'edit')));
CREATE POLICY petitions_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('standard-petitions', 'petition-documents', 'petition-templates') AND (SELECT public.has_module_permission('peticoes', 'delete')));

-- Mídia do WhatsApp mantém a visibilidade da conversa e a exceção de gravações
-- administrativas, acrescentando a ação do cargo.
DROP POLICY IF EXISTS wa_media_staff_select ON storage.objects;
DROP POLICY IF EXISTS wa_media_staff_insert ON storage.objects;
DROP POLICY IF EXISTS wa_media_staff_insert_recordings ON storage.objects;
DROP POLICY IF EXISTS wa_media_staff_update ON storage.objects;
DROP POLICY IF EXISTS wa_media_staff_delete ON storage.objects;
CREATE POLICY wa_media_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'whatsapp-media' AND (SELECT public.has_module_permission('whatsapp', 'view')) AND public.wa_media_visivel(name));
CREATE POLICY wa_media_staff_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media' AND COALESCE((storage.foldername(name))[1], '') <> 'call-recordings' AND (SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY wa_media_staff_insert_recordings ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'whatsapp-media' AND (storage.foldername(name))[1] = 'call-recordings' AND (SELECT public.has_module_permission('whatsapp', 'create')));
CREATE POLICY wa_media_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'whatsapp-media' AND (SELECT public.has_module_permission('whatsapp', 'edit')) AND public.wa_media_visivel(name))
  WITH CHECK (bucket_id = 'whatsapp-media' AND (SELECT public.has_module_permission('whatsapp', 'edit')));
CREATE POLICY wa_media_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'whatsapp-media' AND COALESCE((storage.foldername(name))[1], '') <> 'call-recordings' AND (SELECT public.has_module_permission('whatsapp', 'delete')) AND public.wa_media_visivel(name));
