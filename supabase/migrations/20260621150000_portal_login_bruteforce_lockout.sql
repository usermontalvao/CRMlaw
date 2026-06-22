-- Proteção anti-brute-force no login do Portal do Cliente.
--
-- PROBLEMA: a senha do portal são os 4 últimos dígitos do telefone (10.000
-- combinações) e o login (RPC portal_login) não tinha rate limit/lockout. Com o
-- CPF (frequentemente conhecido) um atacante quebra a senha em minutos. Pior:
-- `portal_login` estava com EXECUTE para anon/authenticated/portal_client, então
-- dava pra chamar a RPC direto via PostgREST e ignorar qualquer trava na edge.
--
-- CORREÇÃO (política definida pelo dono: 10 tentativas → bloqueio de 24h):
--  1) Revoga acesso direto à RPC portal_login — o frontend só loga via edge
--     `portal-login` (service role), então anon/authenticated não precisam dela.
--  2) Tabela de tentativas + RPCs de contagem chamadas pela edge em transações
--     separadas (o RAISE da validação faria rollback se a contagem fosse junto).

-- ============================================================================
-- 1) Fecha o acesso direto à RPC de login (só a edge, via service role).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.portal_login(text, text) FROM anon, authenticated, portal_client, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.portal_login(text, text) TO service_role;

-- ============================================================================
-- 2) Estado de tentativas por CPF (sem PII; chave = CPF normalizado).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.portal_login_attempts (
  cpf            text PRIMARY KEY,
  failed_count   int  NOT NULL DEFAULT 0,
  last_failed_at timestamptz,
  locked_until   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Deny-by-default: só service role (edge) e SECURITY DEFINER tocam aqui.
ALTER TABLE public.portal_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_login_attempts FROM anon, authenticated, portal_client, PUBLIC;
GRANT  ALL ON public.portal_login_attempts TO service_role;

-- ============================================================================
-- 3) RPCs de lockout (chamadas pela edge; cada call é sua própria transação).
-- ============================================================================

-- Está bloqueado agora?  → { locked: bool, locked_until?: timestamptz }
CREATE OR REPLACE FUNCTION public.portal_login_is_locked(p_cpf text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_locked timestamptz;
BEGIN
  IF length(v_cpf) <> 11 THEN RETURN jsonb_build_object('locked', false); END IF;
  SELECT locked_until INTO v_locked FROM public.portal_login_attempts WHERE cpf = v_cpf;
  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN jsonb_build_object('locked', true, 'locked_until', v_locked);
  END IF;
  RETURN jsonb_build_object('locked', false);
END;
$function$;

-- Registra uma falha; ao chegar em 10 dentro do ciclo, bloqueia por 24h.
-- Se um bloqueio anterior já expirou, o ciclo recomeça do zero.
CREATE OR REPLACE FUNCTION public.portal_login_record_failure(p_cpf text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_count int;
  v_locked timestamptz;
BEGIN
  IF length(v_cpf) <> 11 THEN RETURN; END IF;
  SELECT failed_count, locked_until INTO v_count, v_locked
    FROM public.portal_login_attempts WHERE cpf = v_cpf FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.portal_login_attempts (cpf, failed_count, last_failed_at, updated_at)
    VALUES (v_cpf, 1, now(), now());
    RETURN;
  END IF;
  -- Bloqueio anterior expirou → zera o ciclo antes de contar esta falha.
  IF v_locked IS NOT NULL AND v_locked <= now() THEN
    v_count := 0;
  END IF;
  v_count := coalesce(v_count, 0) + 1;
  UPDATE public.portal_login_attempts
     SET failed_count   = v_count,
         locked_until   = CASE WHEN v_count >= 10 THEN now() + interval '24 hours' ELSE NULL END,
         last_failed_at = now(),
         updated_at     = now()
   WHERE cpf = v_cpf;
END;
$function$;

-- Login bem-sucedido → limpa o estado de tentativas.
CREATE OR REPLACE FUNCTION public.portal_login_record_success(p_cpf text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
BEGIN
  IF length(v_cpf) <> 11 THEN RETURN; END IF;
  DELETE FROM public.portal_login_attempts WHERE cpf = v_cpf;
END;
$function$;

REVOKE ALL ON FUNCTION public.portal_login_is_locked(text)      FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.portal_login_record_failure(text) FROM PUBLIC, anon, authenticated, portal_client;
REVOKE ALL ON FUNCTION public.portal_login_record_success(text) FROM PUBLIC, anon, authenticated, portal_client;
GRANT EXECUTE ON FUNCTION public.portal_login_is_locked(text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_record_failure(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_login_record_success(text) TO service_role;
