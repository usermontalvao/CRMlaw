-- ============================================================================
-- Portal do Cliente — Funções RPC (SECURITY DEFINER)
-- ============================================================================
-- O Portal do Cliente NÃO usa Supabase Auth (não há auth.uid() do cliente),
-- portanto todas as operações chegam ao banco como role `anon`. Para evitar
-- abrir RLS para anon, expomos funções RPC SECURITY DEFINER que validam o
-- portal_user_id em cada chamada e retornam apenas os dados do cliente dono.
--
-- Padrão:
--   - portal_login(cpf, password)               → autentica e retorna sessão
--   - portal_get_dashboard(portal_user_id)      → resumo
--   - portal_list_processes(portal_user_id)     → lista processos
--   - portal_get_process(portal_user_id, id)    → detalhes
--   - portal_list_documents(portal_user_id)
--   - portal_list_signatures(portal_user_id)
--   - portal_list_agreements(portal_user_id)
--   - portal_list_calendar(portal_user_id)
--   - portal_list_notifications(portal_user_id)
--
-- Toda função valida `portal_user_id` e busca o `client_id` correspondente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper privado: resolve client_id a partir de portal_user_id
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_resolve_client(p_portal_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
BEGIN
  SELECT client_id INTO v_client_id
  FROM public.client_portal_users
  WHERE id = p_portal_user_id
    AND is_active = true;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Sessão de portal inválida ou expirada' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_login: autentica por CPF + senha (4 últimos dígitos do phone)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_login(p_cpf text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_pwd text := regexp_replace(coalesce(p_password, ''), '\D', '', 'g');
  v_client record;
  v_portal_user record;
  v_expected text;
BEGIN
  IF length(v_cpf) <> 11 THEN
    RAISE EXCEPTION 'CPF inválido. Digite os 11 dígitos.' USING ERRCODE = '22023';
  END IF;
  IF length(v_pwd) <> 4 THEN
    RAISE EXCEPTION 'Senha inválida. Digite os 4 últimos dígitos do seu telefone.' USING ERRCODE = '22023';
  END IF;

  -- Busca cliente
  SELECT id, full_name, email, phone, cpf_cnpj
    INTO v_client
  FROM public.clients
  WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = v_cpf
  LIMIT 1;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'CPF não encontrado. Entre em contato com o escritório para liberar seu acesso.' USING ERRCODE = 'P0001';
  END IF;

  -- Valida senha (4 últimos dígitos do phone)
  v_expected := right(regexp_replace(coalesce(v_client.phone, ''), '\D', '', 'g'), 4);
  IF v_expected IS NULL OR length(v_expected) <> 4 THEN
    RAISE EXCEPTION 'Telefone não cadastrado. Entre em contato com o escritório para cadastrar seu telefone.' USING ERRCODE = 'P0001';
  END IF;
  IF v_expected <> v_pwd THEN
    RAISE EXCEPTION 'Senha incorreta. Use os 4 últimos dígitos do seu telefone.' USING ERRCODE = 'P0001';
  END IF;

  -- Cria/atualiza portal_user
  INSERT INTO public.client_portal_users (client_id, cpf, email, phone, is_active, last_login_at)
  VALUES (v_client.id, v_cpf, v_client.email, v_client.phone, true, now())
  ON CONFLICT (client_id) DO UPDATE
    SET last_login_at = now(),
        cpf = excluded.cpf,
        email = excluded.email,
        phone = excluded.phone,
        is_active = true
  RETURNING * INTO v_portal_user;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_portal_user.id,
      'client_id', v_portal_user.client_id,
      'auth_user_id', v_portal_user.auth_user_id,
      'cpf', v_portal_user.cpf,
      'email', v_portal_user.email,
      'phone', v_portal_user.phone,
      'is_active', v_portal_user.is_active,
      'last_login_at', v_portal_user.last_login_at,
      'created_at', v_portal_user.created_at,
      'updated_at', v_portal_user.updated_at
    ),
    'client', jsonb_build_object(
      'id', v_client.id,
      'nome', v_client.full_name,
      'email', v_client.email,
      'telefone', v_client.phone
    )
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_processes
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_processes(p_portal_user_id uuid)
RETURNS SETOF public.processes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  RETURN QUERY
  SELECT * FROM public.processes
  WHERE client_id = v_client_id
  ORDER BY created_at DESC;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_get_process
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_process(p_portal_user_id uuid, p_process_id uuid)
RETURNS public.processes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_row public.processes;
BEGIN
  SELECT * INTO v_row FROM public.processes
  WHERE id = p_process_id AND client_id = v_client_id
  LIMIT 1;
  RETURN v_row;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_documents (cloud_files, tolerante se a tabela não existir)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_documents(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.cloud_files') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.cloud_files t WHERE client_id = $1 ORDER BY created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_signatures
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_signatures(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.signature_requests') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) || jsonb_build_object(
        ''signers'', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.signature_signers s WHERE s.signature_request_id = t.id), ''[]''::jsonb)
     )
     FROM public.signature_requests t
     WHERE t.client_id = $1
       AND t.status IN (''pending'',''in_progress'')
     ORDER BY t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_agreements (financeiro)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_agreements(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.agreements') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) || jsonb_build_object(
        ''installments'', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.number) FROM public.installments i WHERE i.agreement_id = t.id), ''[]''::jsonb)
     )
     FROM public.agreements t
     WHERE t.client_id = $1
     ORDER BY t.created_at DESC'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_calendar
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_calendar(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.calendar_events') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.calendar_events t
     WHERE t.client_id = $1 AND t.start_at >= now()
     ORDER BY t.start_at ASC LIMIT 50'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- portal_list_notifications
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_list_notifications(p_portal_user_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
BEGIN
  IF to_regclass('public.user_notifications') IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT to_jsonb(t) FROM public.user_notifications t
     WHERE t.target_client_id = $1
     ORDER BY t.created_at DESC LIMIT 50'
    USING v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- GRANT execução para anon (o portal não usa Supabase Auth)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.portal_login(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_processes(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_process(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_documents(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_signatures(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_agreements(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_calendar(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_list_notifications(uuid) TO anon, authenticated;

-- O helper NÃO é exposto a anon (apenas as funções públicas acima podem chamá-lo)
REVOKE ALL ON FUNCTION public._portal_resolve_client(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.portal_login(text, text)
  IS 'Autentica cliente no Portal por CPF + 4 últimos dígitos do telefone. Retorna {user, client}.';
COMMENT ON FUNCTION public.portal_list_processes(uuid)
  IS 'Lista processos do cliente logado no Portal (valida portal_user_id internamente).';
