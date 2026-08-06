-- Corrige um efeito colateral da expiração automática de presença.
--
-- public.profiles tem um trigger BEFORE UPDATE (update_user_presence) que
-- carimba last_seen_at = now() em qualquer atualização da linha. Isso está
-- certo para os sinais de presença do próprio usuário, mas erra feio para o
-- job expire_stale_presence: ele marca 'offline' até 15 minutos depois do
-- último sinal real, e o carimbo faria last_seen_at apontar para o momento da
-- expiração.
--
-- O estrago apareceria no chat, que mostra "visto {last_seen_at}" quando a
-- pessoa não está online (ChatModule e ChatFloatingWidget): diria "visto
-- agora" justamente para quem acabou de ser marcado como ausente.
--
-- Solução: uma chave de configuração local à transação que o trigger respeita.
-- Só a expiração a usa; todo o resto continua carimbando como antes.

CREATE OR REPLACE FUNCTION public.update_user_presence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Quando quem escreve já sabe que o horário real do último sinal é outro,
  -- preserva o valor existente em vez de carimbar agora.
  IF COALESCE(current_setting('app.preserve_last_seen', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.last_seen_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_presence()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- true = escopo de transação; a chave some sozinha ao fim da execução.
  PERFORM set_config('app.preserve_last_seen', 'on', true);

  UPDATE public.profiles
  SET presence_status = 'offline'
  WHERE presence_status IS DISTINCT FROM 'offline'
    AND (last_seen_at IS NULL OR last_seen_at < now() - interval '15 minutes');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.preserve_last_seen', 'off', true);
  RETURN v_count;
END;
$function$;
