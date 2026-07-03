-- Rate limit global reutilizável para fluxos sensíveis expostos via Edge Functions.
-- Objetivo: dar uma camada central de proteção por IP / identidade / token sem
-- duplicar lógica em cada endpoint de segurança.

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  scope             text        NOT NULL,
  bucket_type       text        NOT NULL,
  bucket_hash       text        NOT NULL,
  window_seconds    integer     NOT NULL,
  window_started_at timestamptz NOT NULL,
  hits              integer     NOT NULL DEFAULT 0,
  blocked_until     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_rate_limits_pkey
    PRIMARY KEY (scope, bucket_type, bucket_hash, window_seconds, window_started_at)
);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_rate_limits FROM PUBLIC, anon, authenticated, portal_client;
GRANT ALL ON public.security_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS security_rate_limits_lookup_idx
  ON public.security_rate_limits (scope, bucket_type, bucket_hash, blocked_until DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS security_rate_limits_updated_at_idx
  ON public.security_rate_limits (updated_at DESC);

CREATE OR REPLACE FUNCTION public.security_rate_limit_hit(
  p_scope text,
  p_bucket_type text,
  p_bucket_hash text,
  p_window_seconds integer,
  p_limit integer,
  p_block_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_hits integer;
  v_blocked_until timestamptz;
  v_retry_after integer := 0;
  v_effective_block_seconds integer;
BEGIN
  IF coalesce(length(trim(p_scope)), 0) = 0 THEN
    RAISE EXCEPTION 'security_rate_limit_hit: p_scope obrigatório';
  END IF;
  IF coalesce(length(trim(p_bucket_type)), 0) = 0 THEN
    RAISE EXCEPTION 'security_rate_limit_hit: p_bucket_type obrigatório';
  END IF;
  IF coalesce(length(trim(p_bucket_hash)), 0) = 0 THEN
    RAISE EXCEPTION 'security_rate_limit_hit: p_bucket_hash obrigatório';
  END IF;
  IF coalesce(p_window_seconds, 0) <= 0 THEN
    RAISE EXCEPTION 'security_rate_limit_hit: p_window_seconds inválido';
  END IF;
  IF coalesce(p_limit, 0) <= 0 THEN
    RAISE EXCEPTION 'security_rate_limit_hit: p_limit inválido';
  END IF;

  v_effective_block_seconds := greatest(coalesce(p_block_seconds, p_window_seconds), 1);
  v_window_start := to_timestamp(floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds);

  -- Se já existe um bloqueio ativo para esta chave, devolve imediatamente.
  SELECT blocked_until
    INTO v_blocked_until
    FROM public.security_rate_limits
   WHERE scope = p_scope
     AND bucket_type = p_bucket_type
     AND bucket_hash = p_bucket_hash
     AND blocked_until IS NOT NULL
     AND blocked_until > v_now
   ORDER BY blocked_until DESC
   LIMIT 1;

  IF v_blocked_until IS NOT NULL THEN
    v_retry_after := greatest(1, ceil(extract(epoch FROM (v_blocked_until - v_now)))::integer);
    RETURN jsonb_build_object(
      'allowed', false,
      'scope', p_scope,
      'bucket_type', p_bucket_type,
      'limit', p_limit,
      'window_seconds', p_window_seconds,
      'retry_after_seconds', v_retry_after,
      'blocked_until', v_blocked_until
    );
  END IF;

  INSERT INTO public.security_rate_limits (
    scope,
    bucket_type,
    bucket_hash,
    window_seconds,
    window_started_at,
    hits,
    blocked_until,
    created_at,
    updated_at
  )
  VALUES (
    p_scope,
    p_bucket_type,
    p_bucket_hash,
    p_window_seconds,
    v_window_start,
    1,
    NULL,
    v_now,
    v_now
  )
  ON CONFLICT (scope, bucket_type, bucket_hash, window_seconds, window_started_at)
  DO UPDATE
     SET hits = public.security_rate_limits.hits + 1,
         blocked_until = CASE
           WHEN public.security_rate_limits.hits + 1 > p_limit
             THEN v_now + make_interval(secs => v_effective_block_seconds)
           ELSE public.security_rate_limits.blocked_until
         END,
         updated_at = v_now
  RETURNING hits, blocked_until
       INTO v_hits, v_blocked_until;

  IF v_blocked_until IS NOT NULL AND v_blocked_until > v_now THEN
    v_retry_after := greatest(1, ceil(extract(epoch FROM (v_blocked_until - v_now)))::integer);
    RETURN jsonb_build_object(
      'allowed', false,
      'scope', p_scope,
      'bucket_type', p_bucket_type,
      'limit', p_limit,
      'window_seconds', p_window_seconds,
      'retry_after_seconds', v_retry_after,
      'blocked_until', v_blocked_until,
      'hits', v_hits
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'scope', p_scope,
    'bucket_type', p_bucket_type,
    'limit', p_limit,
    'window_seconds', p_window_seconds,
    'hits', v_hits,
    'remaining', greatest(p_limit - v_hits, 0),
    'retry_after_seconds', 0
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.security_rate_limit_hit(text, text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated, portal_client;
GRANT EXECUTE ON FUNCTION public.security_rate_limit_hit(text, text, text, integer, integer, integer)
  TO service_role;
