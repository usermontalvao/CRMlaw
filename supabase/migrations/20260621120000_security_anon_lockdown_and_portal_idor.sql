-- ============================================================================
-- Endurecimento de segurança (21/06/2026)
--
-- 1) Revoga EXECUTE de `anon`/PUBLIC em funções SECURITY DEFINER que vazavam
--    dados ou eram exclusivas da equipe (chamáveis sem login via a anon key).
-- 2) Fecha IDOR central do portal: _portal_resolve_client passa a exigir que o
--    p_portal_user_id pertença à sessão atual (auth.uid()).
--
-- Contexto: o portal usa sessão GoTrue real (role `authenticated`), então
-- revogar `anon` das portal_* pós-login não quebra o portal. As funções de
-- pré-login (login_identify, portal_login, portal_login_enabled,
-- portal_public_stats, portal_phone_hint, configs) e o fluxo público de
-- assinatura (public_*, get_public_signing_bundle) permanecem acessíveis a anon.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Revogações de EXECUTE para anon
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
  -- staff/admin/interno -> authenticated + service_role
  staff_fns text[] := ARRAY[
    'whatsapp_search_clients(text)',
    'whatsapp_match_client_by_phone(text)',
    'whatsapp_dashboard_stats()',
    'count_clients_by_marital_status(text)',
    'count_processes_by_practice_area(text)',
    'count_requirements_by_benefit_type(text)',
    'count_tasks_by_priority(text)',
    'count_pending_uploads(uuid)',
    'admin_approve_profile_update(uuid,uuid)',
    'admin_reject_profile_update(uuid,text,uuid)',
    'admin_list_profile_update_requests(uuid,text)',
    'admin_portal_push_active(uuid)',
    'fn_check_djen_status(uuid)',
    'fn_djen_hearing_statuses()',
    'fn_match_djen_for_process(uuid,date)',
    'fn_refresh_all_djen_statuses()',
    'fn_effective_djen_status(date,uuid,timestamp with time zone,date)',
    'fn_manual_confirm_hearing(uuid,text)',
    'fn_manual_unconfirm_hearing(uuid)',
    'process_effective_status(uuid)',
    'process_status_blob(uuid)',
    'get_cron_job_latest()',
    'staff_save_push_subscription(text,text,text,text)',
    'staff_remove_push_subscription(text)'
  ];
  -- portal pós-login -> authenticated + portal_client + service_role
  portal_fns text[] := ARRAY[
    'portal_dashboard_summary(uuid)',
    'portal_get_ai_cache(uuid,text,uuid)',
    'portal_get_client_photo(uuid)',
    'portal_get_or_create_chat_room(uuid)',
    'portal_get_process(uuid,uuid)',
    'portal_get_profile(uuid)',
    'portal_get_requirement(uuid,uuid)',
    'portal_get_file_url(uuid,text)',
    'portal_list_agreements(uuid)',
    'portal_list_calendar(uuid)',
    'portal_list_chat_messages(uuid,integer)',
    'portal_list_deadlines(uuid)',
    'portal_list_documents(uuid)',
    'portal_list_document_requests(uuid)',
    'portal_list_notifications(uuid)',
    'portal_list_processes(uuid)',
    'portal_list_profile_requests(uuid)',
    'portal_list_requirements(uuid)',
    'portal_list_signatures(uuid)',
    'portal_mark_all_notifications_read(uuid)',
    'portal_mark_notification_read(uuid,uuid)',
    'portal_mark_notifications_seen(uuid,timestamp with time zone)',
    'portal_notify_document_uploaded(uuid,uuid)',
    'portal_remove_push_subscription(uuid,text)',
    'portal_save_push_subscription(uuid,text,text,text,text)',
    'portal_request_profile_update(uuid,jsonb)',
    'portal_send_chat_message(uuid,text)',
    'portal_close_chat_room(uuid,uuid)',
    'portal_reopen_chat_room(uuid)',
    'portal_accept_ticket(uuid)',
    'portal_upsert_ai_cache(uuid,text,uuid,text,text)',
    'get_portal_client_rooms(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY staff_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, PUBLIC', f);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY portal_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, PUBLIC', f);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%s TO authenticated, portal_client, service_role', f);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Fix IDOR central do portal
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_resolve_client(p_portal_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id
  FROM public.client_portal_users
  WHERE id = p_portal_user_id
    AND is_active = true
    AND auth_user_id = auth.uid();   -- amarra à sessão GoTrue do cliente
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Sessão de portal inválida ou expirada' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_client_id;
END;
$function$;
