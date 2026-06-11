-- PIN de Segurança: tabela, RLS e RPCs
-- Substitui o desafio matemático para confirmação de ações críticas

-- Habilitar pgcrypto para bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tabela ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_security_pins (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash           text NOT NULL DEFAULT '',
  pin_set_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  failed_attempts    int NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_verified_at   timestamptz,
  pin_required_setup boolean NOT NULL DEFAULT false,
  removed_at         timestamptz,
  removed_by         uuid REFERENCES auth.users(id)
);

-- RLS: nenhum acesso direto ao hash — tudo via SECURITY DEFINER
ALTER TABLE public.user_security_pins ENABLE ROW LEVEL SECURITY;

-- Sem políticas de SELECT (o hash jamais deve sair pelo frontend)
-- Acesso apenas via funções SECURITY DEFINER abaixo

-- ─── RPC: verificar se usuário tem PIN ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_security_pin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM user_security_pins
    WHERE user_id = auth.uid()
      AND pin_hash <> ''
      AND pin_required_setup = false
  ) INTO v_exists;
  RETURN COALESCE(v_exists, false);
END;
$$;

-- ─── RPC: criar PIN ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_security_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF p_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'PIN deve ter exatamente 6 dígitos numéricos';
  END IF;

  IF p_pin IN ('000000','111111','222222','333333','444444','555555',
               '666666','777777','888888','999999','123456','654321',
               '012345','098765','111222','112233') THEN
    RAISE EXCEPTION 'PIN muito simples. Escolha uma combinação mais segura';
  END IF;

  v_hash := crypt(p_pin, gen_salt('bf', 10));

  INSERT INTO user_security_pins (user_id, pin_hash, pin_set_at, updated_at, failed_attempts, locked_until, pin_required_setup)
  VALUES (auth.uid(), v_hash, now(), now(), 0, NULL, false)
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = v_hash,
        pin_set_at = now(),
        updated_at = now(),
        failed_attempts = 0,
        locked_until = NULL,
        pin_required_setup = false;

  INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), 'security_pin_created', 'user_security_pins', auth.uid()::text);
END;
$$;

-- ─── RPC: verificar PIN ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.verify_security_pin(
  p_pin          text,
  p_action       text,
  p_resource_type text DEFAULT NULL,
  p_resource_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row          user_security_pins%ROWTYPE;
  v_max_attempts int := 5;
  v_lock_minutes int := 15;
  v_new_attempts int;
  v_new_locked   timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated', 'message', 'Usuário não autenticado');
  END IF;

  SELECT * INTO v_row FROM user_security_pins WHERE user_id = auth.uid();

  IF NOT FOUND OR v_row.pin_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pin', 'message', 'Nenhum PIN configurado');
  END IF;

  -- Verificar bloqueio
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'locked_until', v_row.locked_until,
      'message', 'Conta bloqueada temporariamente. Tente novamente mais tarde'
    );
  END IF;

  -- Limpar bloqueio expirado
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until <= now() THEN
    UPDATE user_security_pins SET locked_until = NULL, failed_attempts = 0 WHERE user_id = auth.uid();
    v_row.failed_attempts := 0;
    v_row.locked_until := NULL;
  END IF;

  -- Comparar hash
  IF crypt(p_pin, v_row.pin_hash) = v_row.pin_hash THEN
    UPDATE user_security_pins
    SET failed_attempts = 0, locked_until = NULL, last_verified_at = now()
    WHERE user_id = auth.uid();

    INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, new_value)
    VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
            'security_pin_verified', COALESCE(p_resource_type, 'system'),
            p_resource_id,
            jsonb_build_object('action', p_action));

    RETURN jsonb_build_object('ok', true);
  ELSE
    -- Falha: incrementar tentativas
    v_new_attempts := v_row.failed_attempts + 1;
    v_new_locked := CASE
      WHEN v_new_attempts >= v_max_attempts
        THEN now() + (v_lock_minutes || ' minutes')::interval
      ELSE NULL
    END;

    UPDATE user_security_pins
    SET failed_attempts = v_new_attempts, locked_until = v_new_locked
    WHERE user_id = auth.uid();

    INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id)
    VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
            'security_pin_failed', 'user_security_pins', auth.uid()::text);

    IF v_new_locked IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'locked',
        'locked_until', v_new_locked,
        'message', 'Muitas tentativas incorretas. Conta bloqueada por ' || v_lock_minutes || ' minutos'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'wrong_pin',
      'attempts_left', v_max_attempts - v_new_attempts,
      'message', 'PIN incorreto'
    );
  END IF;
END;
$$;

-- ─── RPC: alterar PIN (exige PIN atual) ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.change_security_pin(p_old_pin text, p_new_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_verify jsonb;
  v_hash   text;
BEGIN
  v_verify := verify_security_pin(p_old_pin, 'change_pin');
  IF NOT (v_verify->>'ok')::boolean THEN
    RETURN v_verify;
  END IF;

  IF p_new_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'PIN deve ter exatamente 6 dígitos numéricos';
  END IF;

  IF p_new_pin IN ('000000','111111','222222','333333','444444','555555',
                   '666666','777777','888888','999999','123456','654321',
                   '012345','098765','111222','112233') THEN
    RAISE EXCEPTION 'PIN muito simples. Escolha uma combinação mais segura';
  END IF;

  v_hash := crypt(p_new_pin, gen_salt('bf', 10));

  UPDATE user_security_pins
  SET pin_hash = v_hash, updated_at = now(), pin_set_at = now(),
      failed_attempts = 0, locked_until = NULL
  WHERE user_id = auth.uid();

  INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
          'security_pin_changed', 'user_security_pins', auth.uid()::text);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── RPC: reset pelo admin ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reset_security_pin(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Administrador'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Permissão negada. Apenas administradores podem resetar PINs';
  END IF;

  INSERT INTO user_security_pins (user_id, pin_hash, pin_required_setup, updated_at)
  VALUES (p_target_user_id, '', true, now())
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = '', failed_attempts = 0, locked_until = NULL,
        pin_required_setup = true, updated_at = now();

  INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, new_value)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
          'security_pin_admin_reset', 'user_security_pins', p_target_user_id::text,
          jsonb_build_object('target_user_id', p_target_user_id));
END;
$$;

-- ─── RPC: remover PIN (exige PIN atual) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.remove_security_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verify jsonb;
BEGIN
  v_verify := verify_security_pin(p_pin, 'remove_pin');
  IF NOT (v_verify->>'ok')::boolean THEN
    RETURN v_verify;
  END IF;

  UPDATE user_security_pins
  SET pin_hash = '', failed_attempts = 0, locked_until = NULL,
      pin_required_setup = true, updated_at = now()
  WHERE user_id = auth.uid();

  INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
          'security_pin_removed', 'user_security_pins', auth.uid()::text);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_security_pin(text) TO authenticated;

-- ─── RPC: metadados do PIN (sem hash) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_security_pin_meta(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
  v_row       user_security_pins%ROWTYPE;
  v_is_admin  boolean;
BEGIN
  v_target_id := COALESCE(p_user_id, auth.uid());

  IF v_target_id <> auth.uid() THEN
    SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Administrador')
    INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Permissão negada';
    END IF;
  END IF;

  SELECT * INTO v_row FROM user_security_pins WHERE user_id = v_target_id;

  IF NOT FOUND OR v_row.pin_hash = '' THEN
    RETURN jsonb_build_object('has_pin', false, 'pin_required_setup', COALESCE(v_row.pin_required_setup, false));
  END IF;

  RETURN jsonb_build_object(
    'has_pin',            true,
    'pin_set_at',         v_row.pin_set_at,
    'updated_at',         v_row.updated_at,
    'failed_attempts',    v_row.failed_attempts,
    'locked_until',       v_row.locked_until,
    'last_verified_at',   v_row.last_verified_at,
    'pin_required_setup', v_row.pin_required_setup
  );
END;
$$;
