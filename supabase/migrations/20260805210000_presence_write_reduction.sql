-- Reduz drasticamente a escrita em public.profiles causada pela presença.
--
-- Contexto: profiles é publicada no Realtime. Cada UPDATE gera WAL que o
-- walrus decodifica e avalia contra todas as assinaturas da tabela. O cliente
-- gravava presença a cada 2 minutos por usuário logado, o que tornou profiles
-- a tabela com maior volume de escrita do banco (62 mil UPDATEs para 4 linhas).
--
-- Esta migration faz duas coisas:
--   1. As RPCs de presença passam a ser idempotentes: não escrevem quando o
--      estado já é o mesmo e a última confirmação é recente. Reconfirmações
--      redundantes (várias abas, remontagem de componente) deixam de gerar WAL.
--   2. Um job expira presença travada. Hoje existem perfis marcados como
--      'online' com last_seen_at de dias atrás — o Portal do Cliente mostra
--      "atendente online" para gente que não está. Sem o heartbeat de 2 min,
--      essa expiração passa a ser a garantia de que o estado não fica preso.

-- ---------------------------------------------------------------------------
-- 1. RPCs idempotentes
-- ---------------------------------------------------------------------------

-- Janela de tolerância para reconfirmar 'online'. Precisa ser menor que o
-- intervalo de reconfirmação do cliente (5 min) para que a atualização
-- legítima de last_seen_at sempre passe.
CREATE OR REPLACE FUNCTION public.set_user_online(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'online',
      last_seen_at = now()
  WHERE user_id = p_user_id
    AND (
      presence_status IS DISTINCT FROM 'online'
      OR last_seen_at IS NULL
      OR last_seen_at < now() - interval '4 minutes'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_away(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'away',
      last_seen_at = now()
  WHERE user_id = p_user_id
    AND presence_status IS DISTINCT FROM 'away';
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_user_offline(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  UPDATE public.profiles
  SET presence_status = 'offline',
      last_seen_at = now()
  WHERE user_id = p_user_id
    AND presence_status IS DISTINCT FROM 'offline';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Expiração de presença travada
-- ---------------------------------------------------------------------------

-- 15 minutos = três reconfirmações perdidas do cliente (que reconfirma a cada
-- 5 min enquanto há atividade). Quem está trabalhando nunca é expirado.
CREATE OR REPLACE FUNCTION public.expire_stale_presence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.profiles
  SET presence_status = 'offline'
  WHERE presence_status IS DISTINCT FROM 'offline'
    AND (last_seen_at IS NULL OR last_seen_at < now() - interval '15 minutes');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_presence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_presence() FROM anon;
REVOKE ALL ON FUNCTION public.expire_stale_presence() FROM authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('expire-stale-presence');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'expire-stale-presence',
  '*/5 * * * *',
  $$SELECT public.expire_stale_presence();$$
);

-- Limpa o estado travado que já existe hoje.
SELECT public.expire_stale_presence();
