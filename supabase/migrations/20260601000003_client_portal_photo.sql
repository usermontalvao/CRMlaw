-- ============================================================================
-- Portal Client RPCs — v3
-- ============================================================================
-- Atualiza apenas a função portal_login para incluir o `photo_path` do cliente
-- no retorno, permitindo que o front gere a signed URL e exiba a foto real
-- do cliente no Portal (perfil e sidebar) em vez de apenas iniciais.
-- ============================================================================

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

  -- Busca cliente (agora trazendo também photo_path)
  SELECT id, full_name, email, phone, cpf_cnpj, photo_path
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
      'telefone', v_client.phone,
      'photo_path', v_client.photo_path
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_login(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.portal_login(text, text)
  IS 'Autentica cliente no Portal por CPF + 4 últimos dígitos do telefone. Retorna {user, client com photo_path}.';

-- ----------------------------------------------------------------------------
-- portal_get_client_photo: retorna apenas o photo_path do cliente logado.
-- Útil para o front gerar a signed URL sem precisar de novo login.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_get_client_photo(p_portal_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid := public._portal_resolve_client(p_portal_user_id);
  v_path text;
BEGIN
  SELECT photo_path INTO v_path
  FROM public.clients
  WHERE id = v_client_id;
  RETURN v_path;
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_client_photo(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.portal_get_client_photo(uuid)
  IS 'Retorna o photo_path do cliente do Portal (para signed URL no front).';
