-- Bloqueio progressivo por conta de staff.
-- A cada N falhas (padrao 6), aplica bloqueio temporario progressivo.
-- Apos 3 rodadas completas de bloqueio temporario, a conta passa a ficar
-- suspensa para login ate liberacao administrativa.

CREATE TABLE IF NOT EXISTS public.staff_login_account_penalties (
  account_hash      text        PRIMARY KEY,
  fail_count        integer     NOT NULL DEFAULT 0,
  block_level       integer     NOT NULL DEFAULT 0,
  blocked_until     timestamptz,
  suspended_at      timestamptz,
  suspended_reason  text,
  first_fail_at     timestamptz,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_login_account_penalties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_login_account_penalties FROM PUBLIC, anon, authenticated, portal_client;
GRANT ALL ON public.staff_login_account_penalties TO service_role;

CREATE INDEX IF NOT EXISTS staff_login_account_penalties_blocked_idx
  ON public.staff_login_account_penalties (blocked_until DESC);
CREATE INDEX IF NOT EXISTS staff_login_account_penalties_suspended_idx
  ON public.staff_login_account_penalties (suspended_at DESC);
CREATE INDEX IF NOT EXISTS staff_login_account_penalties_activity_idx
  ON public.staff_login_account_penalties (last_activity_at DESC);

CREATE OR REPLACE FUNCTION public.staff_login_account_register_failure(
  p_account_hash text,
  p_max_attempts integer DEFAULT 6,
  p_ladder integer[] DEFAULT ARRAY[300, 900, 1800, 3600, 10800, 14400, 21600, 28800, 43200, 86400],
  p_suspend_after_rounds integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_row public.staff_login_account_penalties;
  v_max integer := greatest(coalesce(p_max_attempts, 6), 1);
  v_suspend_after integer := greatest(coalesce(p_suspend_after_rounds, 3), 1);
  v_next_level integer;
  v_idx integer;
  v_dur integer;
BEGIN
  IF coalesce(length(trim(p_account_hash)), 0) = 0 THEN
    RAISE EXCEPTION 'staff_login_account_register_failure: p_account_hash obrigatorio';
  END IF;
  IF coalesce(array_length(p_ladder, 1), 0) = 0 THEN
    RAISE EXCEPTION 'staff_login_account_register_failure: p_ladder vazio';
  END IF;

  INSERT INTO public.staff_login_account_penalties (account_hash, last_activity_at, updated_at)
  VALUES (p_account_hash, v_now, v_now)
  ON CONFLICT (account_hash) DO NOTHING;

  SELECT * INTO v_row
    FROM public.staff_login_account_penalties
   WHERE account_hash = p_account_hash
   FOR UPDATE;

  IF v_row.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'suspended', true,
      'retry_after_seconds', 0,
      'block_level', v_row.block_level,
      'attempts_remaining', 0
    );
  END IF;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'suspended', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_row.blocked_until - v_now)))::integer),
      'block_level', v_row.block_level,
      'attempts_remaining', 0
    );
  END IF;

  IF v_row.last_activity_at < v_now - interval '24 hours' THEN
    v_row.fail_count := 0;
    v_row.block_level := 0;
    v_row.first_fail_at := NULL;
  END IF;

  v_row.fail_count := coalesce(v_row.fail_count, 0) + 1;
  IF v_row.first_fail_at IS NULL THEN
    v_row.first_fail_at := v_now;
  END IF;

  IF v_row.fail_count >= v_max THEN
    v_next_level := coalesce(v_row.block_level, 0) + 1;

    IF v_next_level > v_suspend_after THEN
      UPDATE public.staff_login_account_penalties
         SET fail_count = 0,
             block_level = v_next_level,
             blocked_until = NULL,
             suspended_at = v_now,
             suspended_reason = format('Suspensa apos %s rodadas de bloqueio temporario.', v_suspend_after),
             first_fail_at = NULL,
             last_activity_at = v_now,
             updated_at = v_now
       WHERE account_hash = p_account_hash;

      RETURN jsonb_build_object(
        'blocked', false,
        'suspended', true,
        'retry_after_seconds', 0,
        'block_level', v_next_level,
        'attempts_remaining', 0
      );
    END IF;

    v_idx := least(v_next_level, array_length(p_ladder, 1));
    v_dur := p_ladder[v_idx];

    UPDATE public.staff_login_account_penalties
       SET fail_count = 0,
           block_level = v_next_level,
           blocked_until = v_now + make_interval(secs => v_dur),
           suspended_at = NULL,
           suspended_reason = NULL,
           first_fail_at = NULL,
           last_activity_at = v_now,
           updated_at = v_now
     WHERE account_hash = p_account_hash;

    RETURN jsonb_build_object(
      'blocked', true,
      'suspended', false,
      'retry_after_seconds', v_dur,
      'block_level', v_next_level,
      'attempts_remaining', 0
    );
  END IF;

  UPDATE public.staff_login_account_penalties
     SET fail_count = v_row.fail_count,
         first_fail_at = v_row.first_fail_at,
         block_level = v_row.block_level,
         last_activity_at = v_now,
         updated_at = v_now
   WHERE account_hash = p_account_hash;

  RETURN jsonb_build_object(
    'blocked', false,
    'suspended', false,
    'retry_after_seconds', 0,
    'block_level', v_row.block_level,
    'attempts_remaining', greatest(v_max - v_row.fail_count, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_login_account_status(p_account_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_row public.staff_login_account_penalties;
BEGIN
  IF coalesce(length(trim(p_account_hash)), 0) = 0 THEN
    RETURN jsonb_build_object('blocked', false, 'suspended', false, 'retry_after_seconds', 0);
  END IF;

  SELECT * INTO v_row
    FROM public.staff_login_account_penalties
   WHERE account_hash = p_account_hash;

  IF v_row.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'suspended', true,
      'retry_after_seconds', 0,
      'block_level', v_row.block_level,
      'attempts_remaining', 0
    );
  END IF;

  IF v_row.account_hash IS NOT NULL
     AND v_row.blocked_until IS NOT NULL
     AND v_row.blocked_until > v_now THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'suspended', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_row.blocked_until - v_now)))::integer),
      'block_level', v_row.block_level,
      'attempts_remaining', 0
    );
  END IF;

  RETURN jsonb_build_object('blocked', false, 'suspended', false, 'retry_after_seconds', 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_login_account_reset(p_account_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(length(trim(p_account_hash)), 0) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.staff_login_account_penalties
     SET fail_count = 0,
         block_level = 0,
         blocked_until = NULL,
         suspended_at = NULL,
         suspended_reason = NULL,
         first_fail_at = NULL,
         last_activity_at = now(),
         updated_at = now()
   WHERE account_hash = p_account_hash;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_login_account_register_failure(text, integer, integer[], integer) FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.staff_login_account_status(text) FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.staff_login_account_reset(text) FROM PUBLIC, anon, authenticated, portal_client;
GRANT EXECUTE ON FUNCTION public.staff_login_account_register_failure(text, integer, integer[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_login_account_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_login_account_reset(text) TO service_role;

CREATE OR REPLACE FUNCTION public.staff_login_admin_unlock_with_pin(
  p_email text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile record;
  v_row user_security_pins%ROWTYPE;
  v_max_attempts int := 5;
  v_lock_minutes int := 15;
  v_new_attempts int;
  v_new_locked timestamptz;
BEGIN
  IF coalesce(length(trim(p_email)), 0) = 0 OR coalesce(length(trim(p_pin)), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_fields', 'message', 'Informe e-mail e PIN.');
  END IF;

  SELECT p.user_id, p.email, p.role, p.is_active
    INTO v_profile
    FROM public.profiles p
   WHERE lower(trim(p.email)) = lower(trim(p_email))
   LIMIT 1;

  IF v_profile.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Conta nao encontrada.');
  END IF;

  IF lower(coalesce(v_profile.role, '')) <> 'administrador' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin', 'message', 'Desbloqueio por PIN disponivel apenas para administradores.');
  END IF;

  SELECT * INTO v_row FROM public.user_security_pins WHERE user_id = v_profile.user_id;

  IF NOT FOUND OR v_row.pin_hash = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pin', 'message', 'Nenhum PIN configurado para esta conta.');
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'pin_locked',
      'locked_until', v_row.locked_until,
      'message', 'PIN temporariamente bloqueado. Tente novamente mais tarde.'
    );
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until <= now() THEN
    UPDATE public.user_security_pins
       SET locked_until = NULL, failed_attempts = 0
     WHERE user_id = v_profile.user_id;
    v_row.failed_attempts := 0;
    v_row.locked_until := NULL;
  END IF;

  IF crypt(p_pin, v_row.pin_hash) = v_row.pin_hash THEN
    UPDATE public.user_security_pins
       SET failed_attempts = 0,
           locked_until = NULL,
           last_verified_at = now(),
           updated_at = now()
     WHERE user_id = v_profile.user_id;

    INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id, new_value)
    VALUES (
      v_profile.user_id,
      v_profile.email,
      'security_pin_login_unlock_verified',
      'user_security_pins',
      v_profile.user_id::text,
      jsonb_build_object('email', lower(trim(p_email)))
    );

    RETURN jsonb_build_object('ok', true, 'user_id', v_profile.user_id);
  END IF;

  v_new_attempts := coalesce(v_row.failed_attempts, 0) + 1;
  v_new_locked := CASE
    WHEN v_new_attempts >= v_max_attempts THEN now() + (v_lock_minutes || ' minutes')::interval
    ELSE NULL
  END;

  UPDATE public.user_security_pins
     SET failed_attempts = v_new_attempts,
         locked_until = v_new_locked,
         updated_at = now()
   WHERE user_id = v_profile.user_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity_type, entity_id)
  VALUES (
    v_profile.user_id,
    v_profile.email,
    'security_pin_login_unlock_failed',
    'user_security_pins',
    v_profile.user_id::text
  );

  IF v_new_locked IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'pin_locked',
      'locked_until', v_new_locked,
      'message', 'Muitas tentativas incorretas de PIN. Tente novamente mais tarde.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'error', 'wrong_pin',
    'attempts_left', greatest(v_max_attempts - v_new_attempts, 0),
    'message', 'PIN incorreto.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_login_admin_unlock_with_pin(text, text) FROM PUBLIC, anon, authenticated, portal_client;
GRANT EXECUTE ON FUNCTION public.staff_login_admin_unlock_with_pin(text, text) TO service_role;

SELECT cron.unschedule('staff-login-account-penalties-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'staff-login-account-penalties-cleanup');

SELECT cron.schedule(
  'staff-login-account-penalties-cleanup',
  '31 * * * *',
  $$
  DELETE FROM public.staff_login_account_penalties
   WHERE suspended_at IS NULL
     AND (blocked_until IS NULL OR blocked_until < now())
     AND last_activity_at < now() - interval '7 days'
  $$
);
