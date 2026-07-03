-- Bloqueio PROGRESSIVO por IP para o login do escritório (staff).
-- Após N falhas (padrão 6) o IP é bloqueado por um tempo que escala a cada
-- reincidência: 5min, 15min, 30min, 1h, 3h, 4h, 6h, 8h, 12h e máximo 24h.
-- Um login bem-sucedido zera o contador e o nível. Sem atividade por 24h o
-- nível também decai. Chamado pela Edge Function staff-login-guard (service_role).

CREATE TABLE IF NOT EXISTS public.staff_login_ip_penalties (
  ip_hash          text        PRIMARY KEY,
  fail_count       integer     NOT NULL DEFAULT 0,
  block_level      integer     NOT NULL DEFAULT 0,
  blocked_until    timestamptz,
  first_fail_at    timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_login_ip_penalties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_login_ip_penalties FROM PUBLIC, anon, authenticated, portal_client;
GRANT ALL ON public.staff_login_ip_penalties TO service_role;

CREATE INDEX IF NOT EXISTS staff_login_ip_penalties_blocked_idx
  ON public.staff_login_ip_penalties (blocked_until DESC);
CREATE INDEX IF NOT EXISTS staff_login_ip_penalties_activity_idx
  ON public.staff_login_ip_penalties (last_activity_at);

-- Registra uma falha e devolve se o IP passou a estar bloqueado.
CREATE OR REPLACE FUNCTION public.staff_login_ip_register_failure(
  p_ip_hash text,
  p_max_attempts integer DEFAULT 6,
  p_ladder integer[] DEFAULT ARRAY[300, 900, 1800, 3600, 10800, 14400, 21600, 28800, 43200, 86400]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now       timestamptz := now();
  v_row       public.staff_login_ip_penalties;
  v_max       integer := greatest(coalesce(p_max_attempts, 6), 1);
  v_level     integer;
  v_idx       integer;
  v_dur       integer;
BEGIN
  IF coalesce(length(trim(p_ip_hash)), 0) = 0 THEN
    RAISE EXCEPTION 'staff_login_ip_register_failure: p_ip_hash obrigatório';
  END IF;
  IF coalesce(array_length(p_ladder, 1), 0) = 0 THEN
    RAISE EXCEPTION 'staff_login_ip_register_failure: p_ladder vazio';
  END IF;

  INSERT INTO public.staff_login_ip_penalties (ip_hash, last_activity_at, updated_at)
  VALUES (p_ip_hash, v_now, v_now)
  ON CONFLICT (ip_hash) DO NOTHING;

  SELECT * INTO v_row
    FROM public.staff_login_ip_penalties
   WHERE ip_hash = p_ip_hash
   FOR UPDATE;

  -- Já bloqueado: devolve o tempo restante sem incrementar.
  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_row.blocked_until - v_now)))::integer),
      'block_level', v_row.block_level,
      'blocked_until', v_row.blocked_until,
      'attempts_remaining', 0
    );
  END IF;

  -- Decaimento por bom comportamento: 24h sem atividade zera contador e nível.
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
    v_level := coalesce(v_row.block_level, 0) + 1;
    v_idx := least(v_level, array_length(p_ladder, 1));
    v_dur := p_ladder[v_idx];

    UPDATE public.staff_login_ip_penalties
       SET fail_count = 0,
           block_level = v_level,
           blocked_until = v_now + make_interval(secs => v_dur),
           first_fail_at = NULL,
           last_activity_at = v_now,
           updated_at = v_now
     WHERE ip_hash = p_ip_hash;

    RETURN jsonb_build_object(
      'blocked', true,
      'retry_after_seconds', v_dur,
      'block_level', v_level,
      'blocked_until', v_now + make_interval(secs => v_dur),
      'attempts_remaining', 0
    );
  END IF;

  UPDATE public.staff_login_ip_penalties
     SET fail_count = v_row.fail_count,
         first_fail_at = v_row.first_fail_at,
         block_level = v_row.block_level,
         last_activity_at = v_now,
         updated_at = v_now
   WHERE ip_hash = p_ip_hash;

  RETURN jsonb_build_object(
    'blocked', false,
    'retry_after_seconds', 0,
    'block_level', v_row.block_level,
    'attempts_remaining', greatest(v_max - v_row.fail_count, 0)
  );
END;
$function$;

-- Consulta (peek) sem incrementar — usado antes de tentar o login.
CREATE OR REPLACE FUNCTION public.staff_login_ip_status(p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_row public.staff_login_ip_penalties;
BEGIN
  IF coalesce(length(trim(p_ip_hash)), 0) = 0 THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after_seconds', 0);
  END IF;

  SELECT * INTO v_row
    FROM public.staff_login_ip_penalties
   WHERE ip_hash = p_ip_hash;

  IF v_row.ip_hash IS NOT NULL
     AND v_row.blocked_until IS NOT NULL
     AND v_row.blocked_until > v_now THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_row.blocked_until - v_now)))::integer),
      'block_level', v_row.block_level,
      'blocked_until', v_row.blocked_until,
      'attempts_remaining', 0
    );
  END IF;

  RETURN jsonb_build_object('blocked', false, 'retry_after_seconds', 0);
END;
$function$;

-- Zera contador e nível após login bem-sucedido.
CREATE OR REPLACE FUNCTION public.staff_login_ip_reset(p_ip_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(length(trim(p_ip_hash)), 0) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.staff_login_ip_penalties
     SET fail_count = 0,
         block_level = 0,
         blocked_until = NULL,
         first_fail_at = NULL,
         last_activity_at = now(),
         updated_at = now()
   WHERE ip_hash = p_ip_hash;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_login_ip_register_failure(text, integer, integer[]) FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.staff_login_ip_status(text) FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.staff_login_ip_reset(text) FROM PUBLIC, anon, authenticated, portal_client;
GRANT EXECUTE ON FUNCTION public.staff_login_ip_register_failure(text, integer, integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_login_ip_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_login_ip_reset(text) TO service_role;

-- Limpeza: remove linhas antigas sem bloqueio ativo e ociosas há dias.
SELECT cron.unschedule('staff-login-ip-penalties-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'staff-login-ip-penalties-cleanup');

SELECT cron.schedule(
  'staff-login-ip-penalties-cleanup',
  '23 * * * *',
  $$
  DELETE FROM public.staff_login_ip_penalties
   WHERE (blocked_until IS NULL OR blocked_until < now())
     AND last_activity_at < now() - interval '7 days'
  $$
);
